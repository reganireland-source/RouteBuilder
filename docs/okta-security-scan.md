# Okta SSO feature — pedantic scan and manual security review

**Purpose:** the same pre-emptive, maximal-strictness analysis
`SONARQUBE_PEDANTIC_REPORT.md` did for the whole repo, scoped to the Okta
SSO feature (`backend/app/auth/`, `main.py`'s `auth_guard`, `app/api/auth.py`,
`frontend/src/auth/`, `AuthContext.tsx`, `AuthGate.tsx`, `OktaGate.tsx`,
`api/client.ts`), run before handing this off so IT's own review starts from
as close to zero as this can get it.

| | |
|---|---|
| Scope | The Okta SSO feature only (see file list above) — not a re-scan of the whole repo |
| Scan date | 2026-09-21 |
| Tooling | See §1 — **not** the Docker-based SonarQube setup §7 of the main report uses |
| Bugs / Vulnerabilities found in new code | **0** confirmed exploitable against this feature's actual usage; **1** real dependency CVE class, fixed (§3) |
| Findings requiring IT action | **0** |

---

## 0. Bottom line

Nothing in this feature is a confirmed bug or vulnerability as shipped.
**One thing was found and already fixed** before this report was written,
not left as a to-do: the pinned `PyJWT==2.10.1` carried several disclosed
CVEs, one of which is a real (if narrow) risk class for JWKS-based verifiers
in general. It's bumped to `2.14.0` — see §3 for exactly which CVEs applied
to this code's specific usage pattern and which didn't, verified by reading
each advisory's proof-of-concept against the actual call, not assumed from
the CVE title. Full test suite (385 tests, including all 17 for this
feature) re-run and green against the new pin.

---

## 1. Why this isn't run through the same Docker/SonarQube setup

`SONARQUBE_PEDANTIC_REPORT.md` §7 spins up SonarQube Community + Elasticsearch
in Docker. This sandbox's Docker daemon cannot be started here (no
permission to set the container's own resource limits — `ulimit: error
setting limit (Operation not permitted)` — this is a constraint of the
environment this review is running in, not a decision). Rather than skip
the review, this substitutes tools that cover the same ground and are
already load-bearing parts of this exact repo's own CI gate:

| Tool | Covers | Already used by this repo for |
|---|---|---|
| `ruff` (full ruleset incl. `S`=flake8-bandit, `PL`=pylint, `B`=bugbear) | Python bugs, security, complexity | `backend/ruff.toml` — this **is** the project's real lint gate, not a substitute for one |
| `eslint-plugin-sonarjs` | TS/JS — literally SonarQube's own JS/TS analyzer, packaged as an ESLint plugin | `frontend/eslint.config.js`, whose own header comment says exactly this: "SonarQube's JavaScript/TypeScript analyzer is published as `eslint-plugin-sonarjs` ... running it here reproduces the same rule set locally" |
| `bandit` | Python security (same rule family `ruff -S` wraps; run standalone too, as direct confirmation rather than trusting one tool's implementation of the other's rules) | cited in `SECURITY_REVIEW.md`'s own verification evidence |
| `mypy` | Python type-safety | — |
| `pip-audit` | Python dependency CVEs | cited in `SECURITY_REVIEW.md`'s own verification evidence, same invocation (`pip-audit -r backend/requirements.txt`) |
| `npm audit` | JS dependency CVEs | standard for this repo's frontend |
| Manual adversarial review | The things static tools structurally can't catch in an auth flow — algorithm confusion, token storage, redirect handling, trust boundaries | — |

What this can't do that the Docker setup can: produce the same numeric
"11,847 code smells repo-wide" style rollup, or a `sonar-reports/*.json`
export. What it does do: every one of the tools above is either already the
project's own established gate, or the literal upstream implementation
SonarQube's own engine is built from — this isn't a weaker approximation of
the same rules, it's the same rules run a different way.

---

## 2. Static analysis results

```
$ cd backend && ruff check app/auth/ app/main.py app/api/auth.py tests/test_okta_auth.py
All checks passed!

$ cd backend && python3 -m bandit -r app/auth/ app/api/auth.py
No issues identified. (234 lines scanned)

$ cd backend && python3 -m bandit app/main.py
No issues identified. (406 lines scanned)

$ cd backend && mypy app/auth/okta.py --ignore-missing-imports
Success: no issues found in 1 source file

$ cd frontend && npx eslint src/auth/okta.ts src/components/AuthGate.tsx \
    src/components/OktaGate.tsx src/context/AuthContext.tsx src/api/client.ts \
    src/main.tsx
(no output — zero findings)

$ cd frontend && npx eslint src/App.tsx
2 pre-existing findings, both cognitive-complexity, both in functions this
feature did not introduce (App's root component; the pre-AUTH_MODE admin-key
unlock form, split out of AdminBar into its own AdminKeyBar component as
part of this work — its complexity went from 19 to 18, i.e. down, not up).
Verified against the pre-feature baseline via `git stash`: identical 2
findings, same two functions, before any of this feature's code existed.
```

`ruff`'s `S` (flake8-bandit) rule family covers, among others: hardcoded
secrets/passwords (`S105`–`S107`), weak crypto and insecure hashing
(`S303`–`S324`), unsafe deserialization (`S301`, `S506`), SQL injection
(`S608`), `assert` used for security control (`S101`), and insecure request
handling (`S113`) — all zero here. `bandit` run standalone against the same
files independently confirms zero.

---

## 3. Dependency scan — the one real finding, and what was done about it

```
$ pip-audit -r backend/requirements.txt      # BEFORE the fix
Found 12 known vulnerabilities in 1 package
pyjwt 2.10.1  PYSEC-2026-120  PYSEC-2025-183  PYSEC-2026-179  PYSEC-2026-175
              PYSEC-2026-177  PYSEC-2026-178  PYSEC-2026-176
```

Six distinct CVEs (some listed twice under different fix-version groupings)
against the pinned `PyJWT==2.10.1`. Read every one of them in full — not
just the title — against this code's actual call shape, before deciding
what to do:

| Advisory | What it is | Applies to this code? |
|---|---|---|
| **PYSEC-2026-176** | Algorithm allow-list bypass when `jwt.decode()` is called with a `PyJWK` **object** as the key — verification silently uses the algorithm bound to the JWK, not the header `alg`, letting an attacker with a registered signing key sign with a disallowed algorithm. | **No.** The PoC passes the `PyJWK` object itself (`jwt.decode(token, jwk, ...)`). This code passes `signing_key.key` — the unwrapped key, already extracted from the `PyJWK` — which the advisory itself confirms goes through PyJWT's normal PEM/public-key path, "which shows the bug is specific to `PyJWK` verification." Confirmed by reading `app/auth/okta.py:168`. |
| **PYSEC-2026-179** | RSA/HMAC algorithm-confusion — requires the caller's `algorithms=[...]` to mix an HMAC algorithm with an asymmetric one AND pass a raw JWK JSON string as key. | **No.** This code's `algorithms=["RS256"]` is a single asymmetric algorithm — HS256/384/512 are never in the allow-list — and the key passed is a key **object**, not a JWK JSON string. Neither precondition is met. |
| **PYSEC-2026-177** | `PyJWKClient` makes an unbounded, uncached HTTP request to the JWKS endpoint for every token bearing an unrecognised `kid` — and `kid` comes from the unverified token header, so any caller can trigger one just by sending a bogus token. | **Yes, real.** `auth_guard` calls `verify()` on every request in okta mode (whole-app gate), so a flood of garbage bearer tokens could drive unbounded outbound calls to Okta's JWKS endpoint. This is the finding that mattered. |
| **PYSEC-2026-178** | Detached-JWS (`b64:false`, RFC 7797) payload-decoding bug. | **No.** This code never decodes detached/unencoded-payload JWS — Okta access tokens aren't detached JWS. |
| **PYSEC-2026-175** | `PyJWKClient` passes its URI straight to `urllib.request.urlopen()`, which supports non-HTTP schemes (`file://`, `ftp://`, ...) — a risk if the URI is attacker-influenced. | **No direct path.** `jwks_uri` is derived from `OKTA_ISSUER`, an operator-set environment variable — never request input. |
| **PYSEC-2026-120** | `crit` (RFC 7515 §4.1.11) header extensions not validated. | **Negligible.** Okta doesn't set `crit` on its tokens. |
| **PYSEC-2025-183** | "Weak encryption" — **disputed by PyJWT's own maintainers**: key length is the caller's choice, not the library's. | Not actionable; not a defect in this usage. |

**Fix applied:** bumped `PyJWT[crypto]` from `2.10.1` to `2.14.0` in
`backend/requirements.txt` (all six advisories are fixed by 2.12.0–2.13.0;
2.14.0 is simply current). This is a version bump only — the call pattern
that already avoided the two exploitable-in-principle CVEs (176, 179)
needed no code change, and the DoS-relevant one (177) needed no workaround
because the upstream fix (a refresh cooldown) is exactly the right one.

```
$ pip-audit -r backend/requirements.txt      # AFTER the fix
No known vulnerabilities found

$ pytest backend/tests/ -q                    # full suite, same pin
385 passed
```

```
$ cd frontend && npm audit --json | jq '[.vulnerabilities[] | select(.name | test("okta"))]'
[]   # zero, in @okta/okta-auth-js or anything it pulls in

$ npm audit
9 vulnerabilities (3 moderate, 6 high) — ALL pre-existing dev-tooling
(vite/esbuild/postcss/browserslist/js-yaml/nanoid/brace-expansion/dompurify),
confirmed via `git stash` to be identical in count and package with or
without this feature's `package.json` changes. Build-time only; none of
them ship in the production bundle.
```

---

## 4. Manual review — the things a tool can't catch in an auth flow

Static analysis is necessary but not sufficient for something whose whole
job is trust decisions. Reviewed by hand against the classic SSO/OIDC
mistake list:

- **Algorithm confusion (RS256→HS256).** `ALGORITHMS = ["RS256"]` is a
  single-element, hardcoded constant (`app/auth/okta.py`) — never derived
  from the token itself, never a caller-supplied list. Combined with §3's
  finding on PYSEC-2026-176/179, this is defended twice over: once by the
  single-algorithm allow-list, once by never passing a bare `PyJWK` object
  into `jwt.decode()`.
- **CSRF / replay on the OAuth redirect (`state`, `nonce`).** Not
  hand-rolled: `@okta/okta-auth-js`'s `signInWithRedirect()` /
  `handleLoginRedirect()` generate and validate `state` and `nonce`
  internally, per the OIDC spec, as part of the SDK's own documented
  Authorization Code + PKCE flow. This feature's code never touches those
  parameters directly.
- **PKCE.** Explicitly set (`pkce: true` in `frontend/src/auth/okta.ts`),
  closing the classic "stolen authorization code" interception risk for a
  public (no-client-secret) client.
- **Open redirect via the post-login return URL.** `OktaGate.tsx` passes
  `originalUri: window.location.href` — always this app's own current-tab
  URL, never attacker-supplied input, and `okta-auth-js`'s own
  `restoreOriginalUri` only ever navigates within the app's own origin.
  Nothing here accepts a `redirect_to`-style query parameter from the URL.
- **Token storage / XSS exposure.** The SDK's own DEFAULT preference order
  is `['localStorage', 'sessionStorage', 'cookie']` — this feature
  overrides that to `sessionStorage` only (see the fix in `auth/okta.ts`,
  found and fixed as part of this same review, not left as an accepted
  risk). Documented honestly in the code comment: this is not an XSS
  defence (both storages are equally JS-readable) — it bounds how long a
  stolen token would remain usable (tab-lifetime, not indefinite) rather
  than eliminating the exposure. A true XSS-proof design (tokens never
  reachable from page JS) needs httpOnly cookies from a same-origin
  backend-for-frontend, which this app's separate SPA + API architecture
  (Vercel + Railway, different origins) doesn't support without a much
  larger restructuring — out of scope for this feature, and not what was
  asked for.
- **Timing attacks.** No new hand-rolled secret comparison exists in this
  feature — JWT signature verification is delegated entirely to PyJWT's
  cryptographic verify (not a raw `==`), and the admin-group check
  (`group_name in groups`) compares a **group name**, not a secret, so
  timing leakage is not a meaningful concern there. The pre-existing
  `ADMIN_KEY` comparison (a real secret) already correctly used
  `secrets.compare_digest` before this feature existed and is untouched.
- **Fail-open vs fail-closed on every branch.** Re-verified by re-reading
  `app/auth/okta.py` and `main.py`'s `_okta_auth_check` end to end: missing
  `OKTA_ISSUER`/`OKTA_CLIENT_ID` → 503, refuse everything. Missing/invalid
  token → 401. Valid token, wrong group, writing → 403. Missing
  `OKTA_ADMIN_GROUP` → `is_admin()` always `False`, never `True`. No branch
  defaults to "allow" on any kind of missing configuration — the same
  standard `SECURITY_REVIEW.md` documents for `ADMIN_KEY` (Finding #2)
  applied consistently to the new mode rather than as a special case.
- **CORS on the new 401/403 responses.** `auth_guard` runs at the same
  middleware position `admin_write_guard` always did — inside CORS, which
  `main.py`'s own extensively-commented middleware-ordering block explains
  is load-bearing (a short-circuit response that skips CORS arrives at the
  browser as an opaque `Failed to fetch`, not a readable status). Okta
  mode's new GET-blocking 401s go through the identical path as the
  existing write-blocking 403s always have — verified live in the original
  feature work (see the commit history), not re-derived here.

No new finding from this pass beyond the token-storage default already
covered in §0.

---

## 5. What this review does not claim

- It does not replace Step 5 of `docs/okta-setup.md` — a real end-to-end
  test against a live Okta org, which nothing short of that can prove.
- It covers the code in this feature; it is not a re-scan of the rest of
  the repo, which `SONARQUBE_PEDANTIC_REPORT.md` already covers separately
  (and whose own numbers this feature's changes are small enough not to
  meaningfully move).
- "Zero findings requiring IT action" describes the CODE. It does not
  cover the Okta tenant-side configuration IT is responsible for (the
  groups claim mapping, redirect URI allowlist, app assignment) — the
  Troubleshooting table in `docs/okta-setup.md` exists precisely because
  those are real, common misconfigurations this code cannot detect or fix
  from the outside.

---

## 6. Related documents

- `SONARQUBE_PEDANTIC_REPORT.md` — the repo-wide scan this one is scoped
  down from, using the real Docker/SonarQube setup where that's available.
- `SECURITY_REVIEW.md` — whole-app security review; §Environment Variables
  and Finding R1 were updated as part of this feature to reflect the new
  auth mode.
- `docs/okta-setup.md` — the IT-facing setup checklist this scan is
  clearing the way for.
- `docs/entra-security-scan.md` — the equivalent review for Microsoft Entra
  ID, added later as a second SSO provider alongside Okta (not a
  replacement) — reuses this scan's tooling rationale (§1) and PyJWT
  dependency findings (§3) rather than repeating them, since the backend
  JWT/JWKS verification is shared code.
