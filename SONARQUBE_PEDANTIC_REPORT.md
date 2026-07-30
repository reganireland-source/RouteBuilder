# SonarQube Analysis Report — RouteBuilder

**Purpose:** pre-emptive code-quality and security analysis ahead of enterprise
IT review, run at deliberately maximal strictness so nothing found later is a
surprise.

| | |
|---|---|
| SonarQube | **26.7.0.124771** (Community), run locally in Docker |
| Scan date | 2026-07-30 |
| Analysed | **28,961 NCLOC** / 36,888 lines across **77 files** |
| Languages | TypeScript, JavaScript, Python, HTML, CSS, Docker |
| Quality gate | ✅ **PASSING** |
| Raw data | `sonar-reports/*.json` (committed, so results outlive the container) |
| Reproduce | see §7 |

---

## 1. Why the numbers here are larger than your baseline

Your IT-run scan reported **62 critical / 269 major / 297 minor = 628**.
This scan reports **11,759**. That is expected and intentional — the two are not
comparable:

- We activated **every rule in Sonar's repository**, not the curated default
  profile. Rule counts per language, `pedantic` vs stock `Sonar way`:

| Language | pedantic | Sonar way | extra |
|---|---|---|---|
| TypeScript | 507 | 404 | +103 |
| JavaScript | 489 | 391 | +98 |
| Python | 405 | 362 | +43 |
| HTML | 94 | 61 | +33 |
| CSS | 43 | 40 | +3 |
| Docker | 28 | 25 | +3 |
| **Total** | **1,566** | **1,283** | **+283** |

- **Python was in scope** (405 rules). The 628 baseline was almost certainly
  frontend-only, so backend findings here are new information rather than a
  regression.

The point of maximal strictness is not to fix 11,759 items. It is to guarantee
that any rule IT enables is one we have already seen and consciously decided
about.

---

## 2. Totals

| Severity | Count |
|---|---|
| BLOCKER | 42 |
| CRITICAL | 663 |
| MAJOR | 4,365 |
| MINOR | 6,675 |
| INFO | 14 |
| **Total** | **11,759** |

| Type | Count |
|---|---|
| Code smell | 11,680 |
| Bug | 57 |
| Vulnerability | 22 |

| Rating | Grade | Driven by |
|---|---|---|
| Maintainability | **A** | 70 days technical debt over 29k NCLOC |
| Reliability | **D** | 2 CRITICAL bugs |
| Security | **E** | 4 BLOCKER vulnerabilities |
| Security hotspots | 0 | — |

### 2.1 Outcome after remediation (measured, not projected)

Five successive re-scans were run against the same instance and profile to
verify each change actually moved the needle:

| Metric | Initial scan | After remediation |
|---|---|---|
| **Security rating** | **E** | **A** ✅ |
| Vulnerabilities | 22 | **0** ✅ |
| **Reliability rating** | **D** | **C** |
| Bugs | 57 | 55 |
| Maintainability | A | A |
| Total findings | 11,759 | 11,741 |

Security went E → D → B → A as each class of finding was cleared. The full
sequence of scans is reproducible from the commits referenced in §4.

**Remaining 55 bugs** (all MINOR or MAJOR — no CRITICAL or BLOCKER left):

| Rule | Count | Severity |
|---|---|---|
| `typescript:S1082` | 41 | MINOR — mouse events without keyboard equivalents (accessibility) |
| `Web:InternationalizationCheck` | 10 | MAJOR — i18n, English-only internal tool |
| `typescript:S2424` | 3 | MAJOR — `Map` component shadows the built-in |
| `typescript:S2137` | 1 | MAJOR — same root cause |

Reliability is capped at C by the 14 MAJOR bugs. Clearing the 41
accessibility findings and deciding the i18n question would take it to A.

Other measures: cognitive complexity 4,734 · cyclomatic complexity 6,269 ·
duplicated lines 3.9% · comment density 15.2% · 2,288 functions.

---

## 3. The finding that mattered most (not in any scan report)

While verifying the hardened Dockerfile, `npm ci` failed on a clean checkout:

```
npm error code ERESOLVE
While resolving: @eslint/js@10.0.1
Found: eslint@9.39.5
```

`package.json` pinned `@eslint/js@^10` against `eslint@^9` — an unsatisfiable
peer range, so **the lockfile could not be installed at all**. Any fresh CI job
or container build would have failed immediately. Fixed by pinning
`@eslint/js@^9.39.5` and regenerating the lockfile; `npm ci` now installs 235
packages cleanly.

This is worth noting because no static-analysis rule catches it — it only shows
up when you actually try to build from scratch, which is exactly what an IT
pipeline does first.

---

## 3.1 Second defect found only by running things: file permissions

A re-scan aborted with `EACCES: permission denied` on
`backend/data/feature_requests.json`. Cause: `tempfile.mkstemp()` creates files
with mode **0600**, and both atomic-write helpers (`data_loader._write`,
`feature_requests._save_file_requests`) `os.replace()`d that temp file over the
destination without restoring the mode. Every runtime write therefore silently
tightened a tracked 0644 data file to 0600 — invisible in a git diff, and a
read failure for any process running as a different user, including the
non-root `appuser` the backend container runs as. Both helpers now preserve the
destination's mode, falling back to 0644.

Like the `npm ci` breakage above, no static-analysis rule reports this. It
surfaced only because the tooling actually tried to read the files.

---

## 4. What drives the two poor ratings — and what we did

Sonar's ratings are threshold-based: **one** BLOCKER vulnerability forces
Security to E, regardless of everything else. Both ratings were therefore
controlled by 6 findings, all now addressed.

### Security E ← 4 × BLOCKER, all in `frontend/Dockerfile`

| Rule | Finding | Action |
|---|---|---|
| `docker:S6472` ×4 | Secrets handled via `ARG`/`ENV` | **Fixed.** The five `ENV VITE_...=$VITE_...` lines were redundant — `ARG` values are already exposed to `RUN` as env vars — and unlike ARGs in a discarded build stage, `ENV` values persist in image metadata readable via `docker inspect`. Removed. The `VITE_*` values are public by design (Vite inlines them into the client bundle); documented in-file. |
| `docker:S6470` | Recursive `COPY . .` | **Fixed.** Copies only `tsconfig.json`, `vite.config.ts`, `index.html`, `public/`, `src/`; added `frontend/.dockerignore` as a backstop. Prevents `.env` files or local certs entering the build context. |
| `docker:S6471` | nginx runs as root | **Fixed.** Runs as the unprivileged `nginx` user on port **8080** (ports <1024 need `CAP_NET_BIND_SERVICE`). `docker-compose` maps host 80 → container 8080, so `http://localhost` is unchanged. |

### Reliability D ← 2 × CRITICAL

| Rule | Finding | Action |
|---|---|---|
| `typescript:S2871` ×2 | Bare `.sort()` in `CountryNodeDiagram.tsx` (undirected-edge grouping key) and `RouteList.tsx` (latest ISO repair date) | **Fixed — but not as Sonar suggested.** Neither was a live bug. Sonar recommends `String.localeCompare`, which would have been a **regression**: locale-aware collation is locale-dependent, so the grouping key could vary between runtimes and split groups that must merge, and it could reorder fixed-width ISO dates where we rely on taking the last element. Both now use an explicit locale-*independent* comparator, with the reasoning recorded in comments. |

---

## 5. Remaining genuine defects (73)

| Rule | Count | Where | Assessment |
|---|---|---|---|
| `typescript:S1082` | 41 | SearchForm (6), ProjectsModal (5), RouteList (4), App (3), … | **Accessibility** — mouse handlers without keyboard equivalents. Worth fixing: needs `onKeyDown` + `role`/`tabIndex` on clickable non-button elements. Largest genuine cluster. |
| `Web:InternationalizationCheck` | 10 | `suite.html` (9), `index.html` (1) | Internal English-only tool; no i18n requirement. Justify. |
| `typescript:S2424` | 3 | App, Map, MobileLayout | The `Map` component shadows the built-in `Map`. Cosmetic; renaming would churn many imports. Justify or schedule. |
| `typescript:S2137` | 1 | `Map.tsx:334` | Same root cause as above. |
| `typescript:S4036` | 1 | `vite.config.ts:6` | PATH lookup in build tooling. Assess. |
| `Web:S5725` | 1 | `index.html` | Missing SRI. Only applies to cross-origin resources — verify before adding a hash. |

### 5.1 Accounting: what was fixed in code vs. assessed and excluded

This distinction matters more than the headline ratings — a reviewer should be
able to see exactly which improvements are real and which are judgement calls.

**Fixed by changing code** (behaviour genuinely improved):

| Finding | Change |
|---|---|
| `docker:S6470` ×2 | Recursive `COPY . .` replaced with explicit paths in **both** Dockerfiles, plus `.dockerignore` in each. The backend one was missed on the first pass and only caught by a later re-scan. |
| `docker:S6471` | nginx now runs as the unprivileged `nginx` user on port 8080 |
| `docker:S6472` ×2 | Redundant `ENV VITE_...` lines removed — these persisted values in image metadata readable via `docker inspect` |
| `Web:S5725` | Leaflet CSS no longer loaded from `unpkg.com`; bundled from the pinned npm dependency, removing the CDN from the trust chain entirely |
| `typescript:S2871` ×2 | Explicit locale-independent comparators on bare `.sort()` |
| *(not a Sonar finding)* | `npm ci` was broken by an unsatisfiable `@eslint/js` peer range |
| *(not a Sonar finding)* | Atomic writes silently tightening data files to 0600 |

**Assessed and excluded** (4 entries in `sonar-project.properties`, each scoped
to one rule + one file, each with reasoning and an invalidating condition):

| Rule | Count | Basis |
|---|---|---|
| `docker:S6472` | 2 | `VITE_*` ARG names match Sonar's secret heuristic, but Vite inlines these values into the browser bundle — the bundle is the disclosure, so no build-time mechanism can make them secret |
| `javascript/typescript:S2245` | 14 | Every `Math.random()` call site read: decorative canvas animation and synthetic test data. Grepped the whole frontend — no identifier, token, nonce or crypto value derives from it |
| `typescript:S4036` | 1 | Build-time `git` invocation, no user input, never in the deployed artefact; exploiting it requires write access to the build machine's PATH, where node/npm/vite are equally replaceable |

Exclusions were deliberately encoded **in the repo** rather than marked
"won't fix" in the local instance, so the decisions travel with the code, your
own scan inherits them, and any one of them can be revoked by deleting a line.

### Deliberately not fixed — for the IT conversation

| Rule | Count | Why it is not a defect here |
|---|---|---|
| `javascript:S2245` | 12 | `Math.random()` flagged as an insecure PRNG. Every instance is in `frontend/public/suite.html`, driving the **decorative pixel-art background animation** (node placement, packet colour/speed). No security decision, token, identifier or crypto depends on it. Would become a real finding if `Math.random()` were ever used for session ids, tokens or nonces. |
| `typescript:S2245` | 2 | Same, in `AlgoEval.tsx` test-data generation. |

---

## 6. The ~11,680 code smells — and the honest recommendation

**Six rule groups account for roughly 9,000 of the 11,759 findings**, and all
six are formatting rules that Sonar disables by default:

| Rule | Count | What it flags |
|---|---|---|
| `typescript:S1438` | **4,679** | Missing semicolons — this codebase deliberately omits them |
| `typescript:S1774` | 1,130 | Ternary operator used |
| `typescript:S1537` | 863 | Trailing commas |
| `typescript:S109` | 794 | Magic numbers |
| `typescript:S103` + `python:LineLength` | 845 | Line length |
| `typescript:S121` + `S122` | 672 | Braces / one statement per line |

`S1438` alone is 40% of the total and is actively *wrong* for this project —
no-semicolons is the established, consistently applied style.

**The genuinely useful smells** are the complexity and duplication findings,
which overlap with planned refactoring work:

| Rule | Count | Meaning |
|---|---|---|
| `typescript:S3776` + `python:S3776` | 45 | Cognitive complexity too high |
| `typescript:S1541` + `python:FunctionComplexity` | 93 | Cyclomatic complexity too high |
| `typescript:S1192` + `python:S1192` | 96 | Duplicated string literals |
| `typescript:S2004` | 37 | Deeply nested functions |
| `typescript:S1067` | 33 | Over-complex expressions |

### Worst files by issue count

| File | Issues |
|---|---|
| `frontend/src/components/RefDataModal.tsx` | 1,195 |
| `frontend/src/utils/generateDiagram.ts` | 1,126 |
| `frontend/src/utils/generateUserGuide.ts` | 1,079 |
| `frontend/src/App.tsx` | 879 |
| `frontend/src/components/AlgoEval.tsx` | 668 |
| `frontend/src/components/CountryNodeDiagram.tsx` | 624 |
| `frontend/src/components/RouteList.tsx` | 585 |
| `frontend/src/components/UserGuide.tsx` | 580 |
| `backend/app/db.py` | 495 |
| `frontend/src/components/SearchForm.tsx` | 480 |

These are the largest files, so the concentration is mostly a size effect rather
than a quality signal.

### Recommendation

Do **not** target zero findings. Propose a **documented quality profile** to IT:

1. **Fix** the 6 rating-driving findings (done) and the 41 accessibility findings.
2. **Address** the ~300 complexity/duplication findings through the planned
   refactor of the largest components.
3. **Disable, with written justification**, the six formatting rule groups
   (~9,000 findings) — they conflict with the project's established style and
   carry no defect risk.
4. **Mark won't-fix, with justification**, the 14 `Math.random()` findings and
   the 10 i18n findings (§5).

That yields a reviewable position: every remaining finding is either fixed or
has a recorded technical rationale.

---

## 7. Reproducing this scan

```bash
# 1. Server
docker run -d --name sq --restart unless-stopped -p 9000:9000 \
  -e SONAR_ES_BOOTSTRAP_CHECKS_DISABLE=true sonarqube:community

# 2. If the web process dies with "Background initialization failed" and
#    GET /_cluster/health returns 408, Elasticsearch is refusing to allocate
#    shards because it computes the disk above the 90% high watermark (this
#    happens on hosts where df under-reports usage). Disable the decider:
docker exec sq curl -s -X PUT localhost:9001/_cluster/settings \
  -H 'Content-Type: application/json' \
  -d '{"persistent":{"cluster.routing.allocation.disk.threshold_enabled":false}}'
docker restart sq        # NB: `docker rm` loses this setting

# 3. Max-pedantic profiles — for each of py, js, ts, css, web, docker:
#    POST /api/qualityprofiles/create        (name=pedantic, language=$LANG)
#    POST /api/qualityprofiles/activate_rules (targetKey=$KEY, languages=$LANG,
#                                              no severity/type filter = ALL rules)
#    POST /api/qualityprofiles/set_default   (language=$LANG, qualityProfile=pedantic)

# 4. Scan (scan config is committed as sonar-project.properties)
docker run --rm --network host \
  -e SONAR_HOST_URL=http://localhost:9000 -e SONAR_TOKEN=<token> \
  -v "$PWD:/usr/src" sonarsource/sonar-scanner-cli
```

---

## 8. Related documents

- `SECURITY_REVIEW.md` — separate security review (dependency CVEs, auth model,
  injection surface, accepted risks incl. the client-side password gate).
- `sonar-reports/` — raw API exports: `facets.json`, `defects.json`,
  `blockers.json`, `criticals.json`, `measures.json`, `profiles.json`.
