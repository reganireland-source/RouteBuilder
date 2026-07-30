# RouteBuilder — Code Scan Remediation Status

Live tracker for the remediation of (a) the enterprise SonarQube scan
(62 critical / 269 major / 297 minor) and (b) the principal-engineer
consolidated review (31 defects + D1–D11 design + S1–S10 structure + DEP1–4).

**Status key:** ✅ fixed & verified · 🔄 in progress · ⏸ scheduled · 📋 deferred (with rationale)

---

## 1. How the two reports relate

The SonarQube scan and the engineering review are different instruments and
they do not reconcile 1:1:

| Source | Count | What it measures |
|---|---|---|
| SonarQube (enterprise) | 628 (62/269/297) | Its own rule profile — cognitive complexity, nested conditionals, code smells. **Believed frontend-only** (see below). |
| `eslint-plugin-sonarjs` run locally | 270 (frontend) | SonarQube's *actual* JS/TS analyzer, so these are the same rule classes. |
| `ruff` broad profile | 1066 (backend), ~257 excl. line-length | Python equivalent of Sonar's Python rules. |
| Engineering review | 31 defects + 25 design/structure | Real exploitable/correctness defects — **higher value than the lint count**. |

**Is the SonarQube scan frontend-only?** Evidence suggests yes: there is no
`sonar-project.properties` in the repo (scope was set externally), no Python
analyzer configuration, and 628 issues over 24,486 frontend lines is a
plausible density for a previously unlinted TypeScript codebase.
**To confirm:** SonarQube → project → *Code* tab (does `backend/` appear?), or
*Issues* → *Language* facet (is Python listed?).

Consequence for sequencing: the frontend work is what moves the *SonarQube
number*; the backend blockers matter for IT sign-off on their own merits.

---

## 2. Tooling now in the repo (so this cannot regress)

| Tool | Scope | Purpose |
|---|---|---|
| `eslint` + `eslint-plugin-sonarjs` | frontend | Reproduces the SonarQube TS/JS scan locally |
| `eslint-plugin-react-hooks` | frontend | Catches the suppressed-deps class (#27) |
| `ruff` | backend | Python lint ≈ Sonar Python rules |
| `mypy` | backend | Static types |
| `pytest` | backend | Behaviour |
| `pip-audit` / `npm audit` | both | Dependency CVEs |

Run locally: `cd frontend && npx eslint src` · `cd backend && ruff check app/ && mypy app/ --ignore-missing-imports && pytest tests/ -q`

---

## 3. Defect remediation — Wave 1 (backend blockers)

Agents work on **disjoint file sets** so they cannot conflict. Every agent must
pass: 29 tests green, app imports, ruff clean, a behavioural proof script, and
`git diff backend/data/` empty (no seed-data damage).

| # | Sev | Finding | Status |
|---|---|---|---|
| 1 | **Critical** | Non-atomic load-modify-save loses data under concurrent writes | 🔄 per-row upsert/delete primitives |
| 2 | High | Write auth **fails open** when `ADMIN_KEY` unset | 🔄 fail-closed + `ALLOW_OPEN_WRITES` dev opt-in |
| 3 | High | feature-requests hard-require Postgres (break file mode) | 🔄 dual-mode split |
| 4 | High | Admin token in `sessionStorage`; no CSP | 🔄 backend CSP now; in-memory token in W2 |
| 5 | High | `/api/health` returns `ok` while DB is down | 🔄 503 + `status: degraded`; new `/health/live` |
| 6 | High | `bulk.py` blocks the event loop | 🔄 sync handlers / threadpool offload |
| 7 | Medium | PUT/DELETE don't normalise path id | 🔄 |
| 8 | Medium | Empty PATCH builds malformed SQL (500) | 🔄 |
| 9 | Medium | Bulk import silently drops rows, reports `ok` | 🔄 per-row errors + `partial` status |
| 10 | Medium | `VALID_NODE_TYPES` drifted from `NodeType` | 🔄 derived via `get_args()` |
| 11 | Medium | Pydantic models lack value constraints | 🔄 |
| 13 | Medium | No DB pool / timeouts | 🔄 pooled conns + connect/statement timeouts |
| 19 | Medium | NLP: no input cap, no timeout, leaks raw errors | 🔄 |
| 21 | Medium | Frontend dep hygiene | 🔄 semgrep→devDeps; Vite bump deferred |
| 22 | Low | CSV export formula injection (CWE-1236) | 🔄 |
| 23 | Low | JSON-file writes non-atomic | 🔄 temp file + `os.replace` |
| 24 | Low | No operational logging / correlation ids | 🔄 backend half |
| 25 | Low | Body cap trusts `Content-Length` | 🔄 enforce on bytes read |
| 29 | Medium | `python-multipart` unpinned + vulnerable at floor | 🔄 pin to patched, verified by `pip-audit` |
| 20a | Medium | No CI lint/type gate | 🔄 CI workflow + `ruff.toml` |

## 4. Wave 2 — frontend (scheduled)

| # | Finding | Plan |
|---|---|---|
| — | **270 sonarjs findings** (147 nested-conditional, 37 nested-function, 24 cognitive-complexity, 16 nested-template) | ⏸ The wave that moves the SonarQube number |
| 17 | No error boundary — render throw blanks the SPA | ⏸ top-level + panel-level boundaries |
| 4a | Admin token in `sessionStorage` | ⏸ in-memory only |
| DEP3 | No security headers on the frontend | ⏸ `vercel.json` + nginx CSP/HSTS/XFO |
| 26 | `as unknown as Route` double-casts | ⏸ |
| 24b | Frontend errors swallowed (`handleDataChange` no `.catch`) | ⏸ |
| 15 | Map/App rebuild lookups every render | ⏸ `React.memo` + `useMemo` |
| 27 | Suppressed `exhaustive-deps` (7 effects) | ⏸ |
| 28 | No ARIA / focus management / Escape | ⏸ shared `Modal` wrapper |

## 5. Wave 3 — confidence (scheduled)

| # | Finding | Plan |
|---|---|---|
| 20b | No tests on route engine or auth guard | ⏸ `find_routes` per diversity mode, hop caps, include/avoid; auth-guard status codes |

---

## 6. Deliberately deferred (with rationale)

These are **not** dismissed — they are sequenced, and the reasoning is recorded
so reviewers can see the decision was deliberate.

| # | Item | Why deferred |
|---|---|---|
| D1–D4 | Repository pattern, entity registry, CRUD factory, service layer | Correctly identified as the highest-leverage refactor, but it rewrites the data layer across ~26 functions in a **live production** app. Doing it *during* blocker remediation would make every security fix un-reviewable. Scheduled as its own phase once blockers are green and tests exist to protect the refactor. |
| 16 | `App.tsx` god component (1800 lines) | Same reasoning — decompose after the blocker set lands, guarded by the new tests. |
| 21 (Vite) | Vite/esbuild major upgrade | Dev-toolchain only (not in the shipped bundle). A major bump mid-remediation risks breaking the build; scheduled separately. |
| 14 | Route-search DoS budget / graph cache | Needs a load profile to size correctly; rate limiter (#18) bounds abuse meanwhile. |
| S2 | Orphaned `seed.sql` / `data/migrations/*.sql` | Safe deletion, but wants confirmation nobody's runbook references them. |
| 12 | Dangling refs on delete | Needs a product decision: block with 409 vs cascade. |

## 7. Line-length decision (documented)

`ruff` reports ~809 `E501` line-too-long at its 88-char default. We set
`line-length = 120` deliberately: mechanically rewrapping 800+ lines across a
live codebase is a large, high-risk diff with no correctness benefit, and 120 is
a common enterprise standard. Genuinely unreadable lines are fixed as they are
touched.
