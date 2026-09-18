# RouteBuilder — Developer Guide

Plain-English handover documentation for human developers and AI coding
assistants. Read this first; every source file also carries a header comment
explaining its own role.

---

## 1. What this application is

RouteBuilder is an internal tool for designing and solutioning circuits over a
global submarine (subsea) and terrestrial telecom network. Users pick two
endpoints, and the app finds ranked, physically-plausible routes over the cable
network, including *diverse* (physically separate) backup paths. Solutions are
saved as **projects** and exported as diagrams (PDF SLD, DrawIO, Visio).

### Domain glossary

| Term | Meaning |
|---|---|
| **Node** | A physical location: Cable Landing Station (CLS), Point of Presence (PoP), branching unit, or off-net site |
| **CLS** | Cable Landing Station — where a submarine cable comes ashore |
| **Segment** | One hop of cable between two nodes. `wet` = submarine, `terrestrial` = land backhaul |
| **System** | A named submarine cable system (e.g. EAC, C2C, SJC2) made up of many segments |
| **Waypoints** | Extra lat/lng points on a wet segment so the map draws it around landmasses instead of straight through them |
| **Diversity** | A second route sharing no physical infrastructure with the first (node-, segment-, or wet-path-disjoint) |
| **IRU** | Indefeasible Right of Use — a long-term lease of capacity on someone else's cable |
| **On-net / Off-net** | Whether we control the infrastructure (configurable by ownership type) |
| **Pinned route** | A search result the user keeps on the map for comparison |
| **Project / Circuit** | A saved solution; each circuit snapshots a route (+ optional protect route) plus technical config (bandwidth, interfaces, A/Z end details) |
| **SLD** | Straight Line Diagram — the exported schematic of a circuit |

---

## 2. Architecture at a glance

```
┌─────────────────────┐         ┌──────────────────────┐        ┌──────────┐
│  React SPA (Vite)   │  HTTPS  │  FastAPI backend     │  SQL   │ Postgres │
│  Vercel             │────────▶│  Railway             │───────▶│ Railway  │
│  frontend/          │  /api/* │  backend/            │        │ (JSONB)  │
└─────────────────────┘         └──────────────────────┘        └──────────┘
        │                                │
        │ static /suite.html             │ falls back to bundled JSON files
        │ (RouteSuite portal)            │ in backend/data/ when DATABASE_URL
        ▼                                ▼ is unset (local dev without DB)
```

- **Frontend**: React 18 + TypeScript + Vite. Map is Leaflet (react-leaflet),
  with optional Google Maps tiles. Deployed on **Vercel**. No server-side code.
- **Backend**: FastAPI + networkx (route computation) + psycopg2. Deployed on
  **Railway**. Every deploy runs pending DB migrations on startup.
- **Database**: Postgres used as a **document store** — every table is
  `(primary_key TEXT, data JSONB)`. Pydantic models in
  `backend/app/models.py` define the document shapes.
- **Storage fallback**: with no `DATABASE_URL`, the backend reads/writes the
  JSON seed files in `backend/data/` directly. Handy for local dev and tests.

### Repository layout

```
backend/
  app/
    main.py            FastAPI app: CORS, security middleware, router registry
    models.py          Pydantic models = API contract + JSONB document shapes
    db.py              Postgres schema, seeding, and the m001..m0NN migrations
    data_loader.py     Storage abstraction: Postgres or JSON files
    pathfinder.py      Route-finding algorithms (the core IP of the app)
    graph.py           networkx graph construction from nodes+segments
    city_pair_finder.py City-to-city high-level route summaries
    data_checks.py     Data integrity checks (surfaced in UI + tests)
    api/               One module per REST resource (nodes, segments, ...)
    nlp/               Optional natural-language query parsing (Claude/OpenAI)
  data/                JSON seed data (source of truth for fresh databases)
  tests/               pytest suite (data integrity)
  add_waypoints.py     Ops script: push map waypoints via the API
  dump_postgres_to_json.py  Ops script: export DB back to JSON seeds
frontend/
  src/
    App.tsx            Root component: all top-level state, mode switching
    api/client.ts      Typed fetch wrapper for every backend endpoint
    types/index.ts     TypeScript mirror of backend models
    components/        UI panels/modals (see file headers)
    utils/generateDiagram.ts  PDF/DrawIO/Visio exporters
  public/suite.html    RouteSuite landing portal (static page)
SECURITY_REVIEW.md     Security posture, accepted risks, env var reference
DEVELOPER_GUIDE.md     This file
```

---

## 3. Data flow — one worked example

**User searches Hong Kong → Tokyo with wet diversity:**

1. `SearchForm.tsx` builds a `RouteRequest` and calls `api.findRoutes()`
   (`frontend/src/api/client.ts`) → `POST /api/routes`.
2. `backend/app/api/routes.py` validates via Pydantic and calls
   `pathfinder.find_routes()`.
3. `pathfinder.py` builds a networkx graph from all nodes/segments
   (`graph.py`), applies constraints (avoid/include lists, interconnect
   rules, max hops), finds candidate paths, scores them (latency, cost,
   reliability), then finds disjoint alternates for the requested diversity.
4. Response (`RouteResponse`) returns primary + diverse route lists.
5. `App.tsx` stores it in `response` state; `RouteList.tsx` renders ranked
   results; selecting routes highlights them on `Map.tsx`.
6. User pins a route, opens Projects, and saves it into a circuit —
   `POST /api/projects` persists the whole project document as JSONB.

---

## 4. How-to recipes

### Add a new API endpoint
1. Define request/response models in `backend/app/models.py` (or module-local
   for one-offs).
2. Create/extend a router module in `backend/app/api/`.
3. Register it in `backend/app/main.py` (`app.include_router(...)`).
4. Add the typed call in `frontend/src/api/client.ts`.
5. Remember: **writes are auth-guarded centrally** by middleware in `main.py`.
   If your new POST endpoint is a *read disguised as POST* (a search), add its
   path to `_EXEMPT_WRITE_PATHS` — it then gets rate limiting instead.

### Add a database migration
Migrations live at the bottom of `backend/app/db.py` and run **exactly once**
per database, in order, on backend startup (the `_once()` pattern records
applied IDs in the `migrations` table).

1. Write `def _run_migration_060(cur) -> None:` following the existing ones.
   Use parameterized SQL only.
2. Append `_once(cur, 'm060', _run_migration_060)` at the END of the list in
   `init_db()` — never renumber or edit an already-shipped migration.
3. If the change also affects fresh installs, update the JSON seeds in
   `backend/data/` to match (fresh DBs seed from JSON *then* run migrations).
4. Deploying to Railway applies it automatically on boot.

### Fix a cable drawing through land on the map
The map draws each wet segment as a smooth spline between its endpoints,
threaded through the segment's `waypoints` array (lat/lng pairs). If a cable
crosses land: pick 3–7 sea coordinates routing around the landmass, then ship
them BOTH ways:
- a migration in `db.py` (updates existing production DBs), and
- the `WAYPOINTS` dict in `backend/add_waypoints.py` (documentation + API
  re-push tooling).
Longitudes: the map is Pacific-centered; anything west of -30° renders
shifted +360, so use e.g. `135` not `-225`. See `normalizeLng` in `Map.tsx`.

### Add a field to Projects (or any stored document)
1. Add the field to the Pydantic model(s) in `backend/app/models.py` —
   optional with a default, so old JSONB documents still parse.
2. Mirror it in `frontend/src/types/index.ts`.
3. Wire the UI (e.g. `ProjectsModal.tsx`) and any exports
   (`generateDiagram.ts`).
No migration needed — JSONB documents are schemaless; old rows simply lack
the key and Pydantic fills the default.

### Add a reference-data admin control
`RefDataModal.tsx` hosts the admin UI (tabs: nodes, segments, systems,
capacity, outages, rules, checks, config, coverage, bulk, tech, notes).
App-level settings live in the generic config document —
`GET/PUT /api/config` (`backend/app/api/config.py`) — see `maps_provider`
for a worked example of an admin toggle end to end.

---

## 5. Running it locally

```bash
# Backend (JSON-file mode — no database needed)
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8001

# Backend against local Postgres instead
export DATABASE_URL=postgresql://routebuilder:routebuilder@localhost:5432/routebuilder

# Frontend
cd frontend
npm ci
npm run dev          # http://localhost:5173, proxies /api to the backend

# Tests / checks
cd backend && python3 -m pytest tests/ -q
cd frontend && npx tsc --noEmit
```

---

## 6. Deployment & environments

| Piece | Where | Trigger |
|---|---|---|
| Frontend | Vercel | push to `main` |
| Backend | Railway | push to `main` (runs migrations on boot) |
| Database | Railway Postgres | reached via `DATABASE_URL` |

Security-relevant environment variables are catalogued in
`SECURITY_REVIEW.md` §Environment Variables. The important ones:
`ADMIN_KEY` (write auth), `ALLOWED_ORIGINS` (CORS), `VITE_APP_PASSWORD`
(client-side gate), `VITE_GMAPS_API_KEY` (browser maps key, referrer-locked).

**Note:** `VITE_*` variables are baked into the frontend bundle at **build
time** — set them in Vercel, and redeploy for changes to take effect.

---

## 7. Conventions

- **Comments**: every file starts with a plain-English header saying what it
  does and how it connects; non-obvious logic gets a WHY comment.
- **SQL**: values always parameterized; any dynamic identifier must pass the
  `_safe_ident()` allowlist in `data_loader.py`.
- **Auth**: never per-endpoint checks — the write guard in `main.py` covers
  every POST/PUT/DELETE/PATCH centrally.
- **Migrations**: append-only, numbered, idempotent-safe (`_once`).
- **Frontend styling**: inline style objects with theme tokens from
  `theme.ts` (`useTheme()`); no CSS framework.
- **Data model changes**: backend model + frontend type + UI + exporters, in
  the same commit.
- **JSON seeds**: keep `backend/data/*.json` consistent with production after
  data migrations (use `dump_postgres_to_json.py` or the
  `POST /api/health/admin/dump-to-json` admin endpoint).
