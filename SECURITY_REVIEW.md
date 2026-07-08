# RouteBuilder — Security Review & Uplift Report

**Date:** 2026-07-08
**Scope:** Full repository (backend FastAPI service, React frontend, Docker/deploy config)
**Purpose:** Pre-emptive review ahead of enterprise IT hosting assessment.

---

## Methodology

| Check | Tool / Method | Result after uplift |
|---|---|---|
| Python dependency CVEs | `pip-audit` | **0 known vulnerabilities** |
| Python SAST | `bandit -r backend/app` | **0 medium/high findings** (8 informational lows, triaged below) |
| JS dependency CVEs | `npm audit` | 2 advisories, **dev-server only** (see Accepted Risks) |
| Secret scanning | pattern sweep across repo + git index | **No secrets committed** (`.env.example` templates only) |
| Manual pentest-style review | auth flow, all write endpoints, SQL construction, CORS, headers, Docker | Findings fixed or documented below |
| Test suite | `pytest` (29 tests) | **29/29 passing** on the upgraded dependency stack |
| Live behaviour verification | in-process HTTP client against hardened app | 403 on unauthenticated writes, 422 on oversized input, security headers present |

---

## Issues Found & Fixed in This Uplift

### 1. Vulnerable dependencies (High priority)
`starlette 0.46.2` carried multiple published vulnerabilities, including two
unauthenticated denial-of-service vectors (crafted `Range` header quadratic
processing, multipart spool exhaustion) and Host-header URL-reconstruction
issues. `python-dotenv 1.1.0` had a symlink-following CVE.

**Fix:** Upgraded `fastapi 0.115 → 0.139.0`, `starlette → 1.3.1`,
`pydantic 2.7.1 → 2.13.4`, `python-dotenv → 1.2.2`. Full test suite passes on
the new stack; `pip-audit` is clean.

### 2. Non-constant-time admin token comparison (CWE-208)
Admin tokens were compared with `==` in both the write-guard middleware and
`/api/auth/verify`, theoretically enabling timing side-channel attacks.

**Fix:** Both comparisons now use `secrets.compare_digest`.

### 3. Database error detail leaked to clients (CWE-209)
`GET /api/health` returned raw exception text (potentially containing DB
host/user fragments) in `db_detail` on connection failure.

**Fix:** Client now receives a generic message; full detail goes to server logs.

### 4. No rate limiting on unauthenticated endpoints
The deliberately open POST endpoints (route search, NLP parse, city-pair
search, feature requests) had no throttling — the NLP endpoint in particular
proxies to a paid LLM API.

**Fix:** Per-IP sliding-window rate limiter (default 120 req/min, tunable via
`RATE_LIMIT_PER_MINUTE`) returning 429.

### 5. No request body size cap
No payload size limit ahead of handlers.

**Fix:** Requests with `Content-Length` over 10 MB (tunable via
`MAX_BODY_BYTES`) are rejected with 413.

### 6. Unbounded input on public feedback endpoint
`POST /api/feature-requests` (intentionally unauthenticated) accepted
arbitrarily large strings.

**Fix:** Pydantic field caps — title 200, description 5 000, category 50 chars.

### 7. Dynamic SQL identifier construction (SAST findings, CWE-89)
Several helpers interpolated table/column names into SQL f-strings. All call
sites were traced: identifiers come exclusively from internal constants or
Pydantic model field names (`extra` fields are ignored), so **none were
exploitable** — but the pattern was fragile against future changes.

**Fix:** Central `_safe_ident()` allowlist now validates every interpolated
identifier; constant-table sites are annotated. Values were already
parameterized everywhere.

### 8. Docker container ran as root
**Fix:** Backend image now creates and runs as unprivileged `appuser`
(UID 10001), with write access limited to the data directory.

### 9. Missing HSTS / deprecated header
**Fix:** Added `Strict-Transport-Security` (2-year, includeSubDomains);
removed the deprecated `X-XSS-Protection` header. `X-Content-Type-Options`,
`X-Frame-Options: DENY` and `Referrer-Policy` were already present.

### 10. Silent insecure-default configuration
Nothing warned when the service started with open write access.

**Fix:** Startup now logs explicit warnings when `ADMIN_KEY` is unset (writes
open) or `ALLOWED_ORIGINS` is `*` (CORS open).

### 11. Data integrity failure in test suite
Three JUNO segments had no capacity records, failing one integrity test.

**Fix:** Capacity rows added; suite fully green.

---

## Accepted Risks & Recommendations for Hosting Team

These items are documented decisions rather than code fixes — most need an
infrastructure-level control that the hosting environment should provide.

| # | Item | Risk | Recommendation |
|---|---|---|---|
| R1 | **Client-side app password.** The frontend password gate (`VITE_APP_PASSWORD`) is compiled into the JS bundle — it deters casual access only. All GET/read API endpoints are unauthenticated by design; write endpoints require `ADMIN_KEY`. | Anyone who discovers the API URL can read network reference data and solution projects. Customer PII has already been stripped from the data model (names removed; only technical/site data and opportunity IDs remain). | Front the app with the enterprise SSO/zero-trust gateway (e.g. Azure AD App Proxy, Cloudflare Access) when hosted internally. This is the single highest-value control the hosting team can add. |
| R2 | **CORS default is `*`.** | Cross-origin reads of the (unauthenticated) API. | Set `ALLOWED_ORIGINS=https://<frontend-domain>` in the deployment environment. The app logs a startup warning if unset. |
| R3 | **`ADMIN_KEY` must be set in production.** Without it all writes are open (dev mode). | Full data mutation by anonymous users. | Already set in the current Railway deployment; ensure it is set (and rotated periodically) in enterprise hosting. |
| R4 | **Vite/esbuild dev-server advisories** (`npm audit`: 2 findings, both affect the *development server only*). Production is a static build — the dev server never runs in production. | None in production; source-read risk on a developer's machine while `npm run dev` is active. | Upgrade to Vite 8 during the next planned frontend maintenance window (major-version migration). |
| R5 | **Rate limiter is in-memory per process.** | Resets on restart; not shared across replicas. | Adequate for single-instance hosting. If scaled horizontally, enforce rate limits at the gateway/WAF instead. |
| R6 | **No audit logging of admin mutations.** | Reduced forensic traceability. | Add structured audit logs (who/what/when on write endpoints) or capture at the reverse proxy. |
| R7 | **Bandit informational lows.** 6× `try/except/continue` in bulk import (intentional per-row error tolerance), 2× `assert` in data loading (dev-time invariants, not security controls). | Negligible. | No action required. |
| R8 | **Google Maps browser key** is a public client-side key by design. | Quota abuse if unrestricted. | Keep HTTP-referrer restriction limited to the production frontend domain(s) and restrict the key to the Maps JavaScript API (already advised during setup). |

---

## Environment Variables (security-relevant)

| Variable | Where | Purpose |
|---|---|---|
| `ADMIN_KEY` | backend | Required token for all write (POST/PUT/DELETE/PATCH) endpoints |
| `ALLOWED_ORIGINS` | backend | Comma-separated CORS allowlist; **set in production** |
| `RATE_LIMIT_PER_MINUTE` | backend | Per-IP limit for open POST endpoints (default 120) |
| `MAX_BODY_BYTES` | backend | Request body cap (default 10 MB) |
| `DATABASE_URL` | backend | Postgres DSN; falls back to bundled JSON files if unset |
| `ANTHROPIC_API_KEY` / `NLP_ENABLED` | backend | Optional NLP feature; endpoint absent unless enabled |
| `VITE_APP_PASSWORD` | frontend build | Client-side access gate (obfuscation only — see R1) |
| `VITE_GMAPS_API_KEY` | frontend build | Public browser key, referrer-restricted |

---

## Verification Evidence

- `pip-audit -r backend/requirements.txt` → *No known vulnerabilities found*
- `bandit -r backend/app` → 0 medium/high severity findings
- `pytest backend/tests` → 29 passed
- Live checks against the hardened app: unauthenticated `POST /api/nodes` → **403**; wrong token → **403**; valid token → **200**; 300-char feature-request title → **422**; response carries `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`.
