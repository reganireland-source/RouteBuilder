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
