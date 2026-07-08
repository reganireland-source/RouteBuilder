# Copilot instructions for RouteBuilder

Read `DEVELOPER_GUIDE.md` at the repo root for full architecture, domain
glossary, and how-to recipes. Key facts for generating correct code:

## What this is
Internal telecom tool: designs circuits over a global submarine + terrestrial
cable network. React/TypeScript/Vite frontend (Vercel) + FastAPI backend
(Railway) + Postgres used as a JSONB document store.

## Hard rules
- **Storage**: every Postgres table is `(pk TEXT, data JSONB)`. Document
  shapes are defined by Pydantic models in `backend/app/models.py` and
  mirrored in `frontend/src/types/index.ts`. Change both together.
- **Migrations**: append-only. Add `_run_migration_0NN(cur)` in
  `backend/app/db.py` and register with `_once(cur, 'm0NN', ...)` at the END
  of the list in `init_db()`. Never edit or renumber shipped migrations.
- **SQL safety**: parameterize all values. Dynamic table/column names must go
  through `_safe_ident()` (allowlist in `backend/app/data_loader.py`).
- **Auth**: do NOT add per-endpoint auth checks. The middleware in
  `backend/app/main.py` guards all write methods centrally via the
  `x-admin-token` header (`ADMIN_KEY` env var). Read-style POST endpoints
  (searches) belong in `_EXEMPT_WRITE_PATHS` and are rate limited.
- **Dual storage mode**: `backend/app/data_loader.py` uses Postgres when
  `DATABASE_URL` is set, else the JSON files in `backend/data/`. New
  persistence code must support both paths.
- **Map longitudes are Pacific-centered**: longitudes < -30° are shifted
  +360 for rendering (`normalizeLng` in `frontend/src/components/Map.tsx`).
  Wet-segment `waypoints` are `[lat, lng]` pairs threading cables around
  landmasses.
- **Frontend styling**: inline style objects + theme tokens from
  `useTheme()` (`frontend/src/theme.ts`). No CSS framework, no CSS files.
- **VITE_* env vars** are baked at build time (set in Vercel, not runtime).

## Domain terms
CLS = Cable Landing Station; wet segment = submarine cable hop; system =
named cable (EAC, C2C, SJC2); diversity = physically disjoint backup route;
IRU = long-term capacity lease; SLD = straight-line circuit diagram;
project/circuit = saved solution snapshotting routes + technical config.

## Verify changes with
- Backend: `cd backend && python3 -m pytest tests/ -q` and
  `python3 -c "from app.main import app"`
- Frontend: `cd frontend && npx tsc --noEmit`
