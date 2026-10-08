# Entra ID SSO feature — pedantic scan and manual security review

**Purpose:** the same pre-emptive, maximal-strictness analysis
`docs/okta-security-scan.md` ran for the Okta SSO feature, scoped to the
Entra ID addition (`backend/app/auth/entra.py`, the shared
`backend/app/auth/oidc.py` re-verified after its Okta-specific rename,
`main.py`'s tri-mode `auth_guard`, `app/api/auth.py`'s `entra` branch,
`frontend/src/auth/entra.ts`, `frontend/src/auth/mode.ts`,
`EntraGate.tsx`, `GateMessage.tsx`, and the shared files touched to add a
third mode: `AuthContext.tsx`, `AuthGate.tsx`, `api/client.ts`, `App.tsx`).

| | |
|---|---|
| Scope | The Entra ID SSO addition only (see file list above) — not a re-scan of the whole repo, and not a re-review of Okta-only code already covered by `docs/okta-security-scan.md` |
| Scan date | 2026-09-22 |
| Tooling | Same substitute toolchain as `docs/okta-security-scan.md` §1 — see that document for why (Docker/SonarQube unavailable in this sandbox) |
| Bugs / Vulnerabilities found in new code | **0** |
| Findings requiring IT action | **0** |

---

## 0. Bottom line

Nothing in this addition is a confirmed bug or vulnerability as shipped.
Unlike the Okta scan, **there was no dependency CVE to fix and no hardening
gap to close** — `@azure/msal-browser` introduced zero new `npm audit`
findings, and MSAL's own default token storage (`sessionStorage`) already
matches the hardened choice this repo made explicitly for Okta, so setting
it here is documentation of an already-correct default, not a fix (see §4).
Full backend suite (400 tests, including all 25 covering the shared OIDC
verifier plus Okta's and Entra's own settings loading) green; frontend
`tsc`/`eslint` identical to the pre-feature baseline.

---

## 1. Why this isn't run through the same Docker/SonarQube setup

Same constraint, same substitute toolchain, as `docs/okta-security-scan.md`
§1 — not repeated here. See that document.

---

## 2. Static analysis results

```
$ cd backend && ruff check app/auth/ app/main.py app/api/auth.py \
    tests/test_entra_auth.py tests/test_oidc.py
All checks passed!

$ cd backend && python3 -m bandit -r app/auth/ app/api/auth.py
No issues identified. (372 lines scanned)

$ cd backend && python3 -m bandit app/main.py
No issues identified. (428 lines scanned)

$ cd backend && mypy app/auth/entra.py app/auth/oidc.py --ignore-missing-imports
Success: no issues found in 2 source files

$ cd backend && python3 -m pytest tests/ -q
400 passed

$ cd frontend && npx eslint src/auth/entra.ts src/auth/mode.ts \
    src/components/EntraGate.tsx src/components/GateMessage.tsx \
    src/components/OktaGate.tsx src/auth/okta.ts src/components/AuthGate.tsx \
    src/context/AuthContext.tsx src/api/client.ts
7 pre-existing findings, all in api/client.ts, none in any file this
feature added (entra.ts, mode.ts, EntraGate.tsx, GateMessage.tsx: zero
findings). Verified against the pre-feature baseline via `git stash`:
identical 7 findings, same lines (modulo line-number shift from the
docstring additions), before any of this feature's code existed.

$ cd frontend && npx tsc --noEmit
(no output — zero errors)
```

`ruff`'s `S` (flake8-bandit) rule family — hardcoded secrets, weak crypto,
unsafe deserialization, SQL injection, insecure `assert`/request handling —
is zero here, same as the Okta scan. `mypy` on `app/main.py` itself (not
scoped to just the two new files above) shows 23 errors, all pre-existing
and unrelated to this feature (missing third-party stubs for `networkx`/
`psycopg2`/`openpyxl`, unrelated `Optional` narrowing in `app/kml/`/
`app/hazards/`) — one below the pre-feature baseline of 24, because this
feature's own `main.py` changes fixed two pre-existing narrowing errors as
a side effect of restructuring the boot-log branch (see the commit that
introduced `app/auth/oidc.py`).

---

## 3. Dependency scan

```
$ pip-audit -r backend/requirements.txt
No known vulnerabilities found

# No new backend dependency was added for Entra ID — JWT/JWKS verification
# is generic OIDC (already covered by the PyJWT pin the Okta scan fixed);
# MSAL is a browser-only concern.

$ cd frontend && npm audit --json | jq '[.vulnerabilities[] | select(.name | test("msal|azure"))]'
[]   # zero, in @azure/msal-browser or anything it pulls in

$ npm audit
9 vulnerabilities (3 moderate, 6 high) — ALL pre-existing dev-tooling
(vite/esbuild/postcss/browserslist/js-yaml/nanoid/brace-expansion/dompurify),
confirmed via `git stash` to be an IDENTICAL count, identical package list,
with or without @azure/msal-browser in package.json. Build-time only; none
of them ship in the production bundle.
```

**Bundle tree-shaking, verified by content, not just size:** a default
(`admin_key`-mode) production build was grepped for MSAL/Okta runtime
signatures (`acquireTokenSilent`, `BrowserAuthError`, `PublicClientApplication`,
`OktaAuth`) across every emitted chunk — none found; only a pre-existing,
unrelated documentation string in the UserGuide bundle happened to contain
the substring `@azure/msal` (stale roadmap copy fixed separately, see the
UserGuide.tsx update). A build with `VITE_AUTH_MODE=entra` set was then
grepped the same way and DOES contain `acquireTokenSilent`/
`BrowserAuthError`, confirming the dependency is genuinely conditional on
the env var actually being set, not merely small enough to be missed by a
size comparison alone. Main chunk size: 798.96 kB (admin_key default,
identical to pre-feature) vs 1,059.80 kB (`entra` mode, MSAL included) —
the ~260 kB delta is the same ballpark as `@okta/okta-auth-js`'s own
+280 kB, documented in the Okta scan.

---

## 4. Manual review — the things a tool can't catch in an auth flow

Reviewed by hand against the same classic SSO/OIDC mistake list the Okta
scan used, noting explicitly where this addition inherits Okta's already-
reviewed code unchanged versus where MSAL's own behaviour differs:

- **Algorithm confusion (RS256→HS256).** Unchanged from the Okta scan:
  `ALGORITHMS = ["RS256"]` in `app/auth/oidc.py` is a single-element,
  hardcoded constant shared by both providers — Entra ID tokens go through
  the exact same verification path already reviewed, not a second one.
- **CSRF / replay on the OAuth redirect (`state`, `nonce`).** Not
  hand-rolled: MSAL's `PublicClientApplication.loginRedirect()` /
  `handleRedirectPromise()` generate and validate `state` and `nonce`
  internally, per the OIDC spec, as part of MSAL's own documented
  Authorization Code + PKCE flow — same guarantee as okta-auth-js provides,
  different SDK. This feature's code never touches those parameters
  directly.
- **PKCE.** Unlike okta-auth-js (which exposes an explicit `pkce: true`
  option this repo sets), MSAL has no equivalent toggle for a browser SPA:
  PKCE code-challenge/verifier generation is unconditionally built into
  `PublicClientApplication`'s authorization-code request path (confirmed by
  reading `addCodeChallengeParams` in the installed package) — there is
  nothing to configure, and nothing here could accidentally disable it.
- **Open redirect via the post-login return URL.** `EntraGate.tsx` never
  passes or accepts a `redirect_to`-style parameter; MSAL's
  `redirectUri` is a fixed value built from `window.location.origin` in
  `auth/entra.ts`, never attacker-influenced input, same pattern as
  `OktaGate.tsx`'s `originalUri`.
- **Token storage / XSS exposure — the one place this scan's finding
  DIFFERS from Okta's.** The Okta scan found and fixed a real gap:
  okta-auth-js's own default preference order put `localStorage` first.
  Checked the equivalent for MSAL by reading
  `node_modules/@azure/msal-browser`'s own `DEFAULT_CACHE_OPTIONS`
  directly: **MSAL's own default `cacheLocation` is already
  `sessionStorage`** (with a 5-day cache-entry retention policy, unrelated
  to token lifetime). `auth/entra.ts`'s explicit
  `cache: { cacheLocation: 'sessionStorage' }` is therefore not a fix —
  it's the same value MSAL would have used anyway, set explicitly so the
  choice is documented in this codebase rather than relying on an upstream
  default that could change. Same caveat as the Okta code comment: not an
  XSS defence (both storages are equally JS-readable), just bounds a stolen
  token's usable window to the tab's lifetime.
- **Timing attacks.** No hand-rolled secret comparison anywhere in this
  addition — JWT signature verification is delegated entirely to PyJWT
  (same shared `oidc.py` as Okta), and the App Role check
  (`role_value in roles`) compares a **role name**, not a secret.
- **Fail-open vs fail-closed on every branch.** Re-verified end to end for
  the `entra` branch specifically: missing `ENTRA_TENANT_ID`/
  `ENTRA_CLIENT_ID` → 503, refuse everything (via the same
  `_oidc_settings is None` check `okta` mode uses). Missing/invalid token →
  401. Valid token, wrong/missing role, writing → 403. Missing
  `ENTRA_ADMIN_ROLE` → `OidcVerifier.is_admin()` always `False`, never
  `True` (same shared method Okta uses, just reading `roles` instead of
  `groups` — see `admin_claim_type` in `OidcSettings`). No branch defaults
  to "allow" on any kind of missing configuration.
- **CORS on the new responses.** `auth_guard` runs at the identical
  middleware position for `entra` as it already does for `okta` — inside
  CORS, per `main.py`'s own middleware-ordering documentation, unchanged by
  this addition.
- **The App Role vs. group-overage design choice, security-reviewed on its
  own terms.** Entra ID CAN express admin access via group membership
  instead (`groupMembershipClaims` in the app manifest), which this build
  deliberately does NOT use — a user in 200+ Entra groups gets no usable
  `groups` claim at all (just a `hasgroups`/`_claim_names` flag requiring a
  follow-up Microsoft Graph call this backend does not make and has no
  credentials to make). App Roles have no such limit and are Microsoft's
  own documented pattern for app-level RBAC — see `docs/entra-setup.md`
  Step 3 and `app/auth/entra.py`'s own module docstring for the full
  reasoning. This was a design decision confirmed with the user during
  scoping (see the interview before this feature was built), not something
  discovered during this scan — recorded here because it's exactly the
  kind of choice a reviewer would otherwise ask about.
- **The async/sync token-cache bridge (`refreshEntraToken()` /
  `currentEntraAccessToken()`), reviewed as a correctness-adjacent security
  concern, not just a design note.** Because MSAL has no background
  renewal timer, `auth/entra.ts` maintains its own small synchronous cache
  refreshed on a 5-minute interval (see that module's own docstring). The
  security-relevant question is whether a STALE cached token could ever be
  sent when a fresher, more-privileged (or less-privileged) one should have
  been — reviewed: `refreshEntraToken()` re-reads the account's current
  `idTokenClaims.roles` alongside the token itself in the same refresh
  cycle (`EntraAuthProvider`'s `refreshClaims()`), so `isAdmin` in the UI
  and the access token sent to the backend are always refreshed together,
  never independently stale relative to each other. The backend's own
  `is_admin()` check on the verified token is the actual authorization
  decision regardless — this cache only affects how current the UI's own
  hint is, and how current the token attempting a request is, both of
  which fail toward 401/403 (re-auth required), never toward a
  stale-but-still-valid elevated token being silently accepted past its
  real expiry (PyJWT's own `exp` check on the backend is what actually
  bounds that, unaffected by anything in this cache).

No new finding beyond the documented-default note in this pass.

---

## 5. What this review does not claim

- It does not replace Step 6 of `docs/entra-setup.md` — a real end-to-end
  test against a live Entra tenant, which nothing short of that can prove.
  A live browser redirect to `login.microsoftonline.com` was confirmed to
  fire correctly during development (MSAL's `loginRedirect()` genuinely
  navigates there with no client-side error, failing only on this
  sandbox's own TLS-intercepting network proxy) — the one thing that
  couldn't be tested from here is a real tenant answering on the other end.
- It covers the code in this addition; it does not re-review the Okta-only
  code `docs/okta-security-scan.md` already covered, except where this
  addition's refactor touched shared code (`app/auth/oidc.py`), which was
  re-run through the same static analysis as a matter of course (§2) and
  found unchanged in behaviour, only in naming.
- It is not a re-scan of the rest of the repo, which
  `SONARQUBE_PEDANTIC_REPORT.md` already covers separately.
- "Zero findings requiring IT action" describes the CODE. It does not
  cover the Entra tenant-side configuration IT is responsible for (the
  Expose an API scope, the App Role assignment, the redirect URI
  allowlist) — the Troubleshooting table in `docs/entra-setup.md` exists
  precisely because those are real, common misconfigurations this code
  cannot detect or fix from the outside.

---

## 6. Related documents

- `docs/okta-security-scan.md` — the equivalent review for Okta, whose
  tooling rationale (§1) and PyJWT dependency findings (§3) this document
  builds on rather than repeats.
- `SONARQUBE_PEDANTIC_REPORT.md` — the repo-wide scan both feature-scoped
  reviews are scoped down from.
- `SECURITY_REVIEW.md` — whole-app security review; §Environment Variables
  and Finding R1 were updated as part of this feature to reflect the new
  auth mode.
- `docs/entra-setup.md` — the IT-facing setup checklist this scan is
  clearing the way for.
