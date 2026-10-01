# ─────────────────────────────────────────────────────────────────────────────
# health.py — Service health, data-integrity checks, and admin data ops.
#
# Route prefix: /api/health  (this router has prefix="/health"; main.py mounts
# it under "/api", so all paths are /api/health/...).
#
# This module mixes two kinds of endpoint:
#   1. Read-only status probes (safe, public): overall health, integrity checks,
#      and NLP provider status.
#   2. Admin data-maintenance operations that MUTATE storage: reseeding the
#      database from the bundled JSON seed files, and dumping the database back
#      out to those JSON files. Because these change data, they are POSTs and are
#      subject to the admin token when ADMIN_KEY is set.
#
# The app stores its data either in Postgres (when DATABASE_URL is set) or in
# local JSON files under backend/data/ (dev fallback). The reseed/dump endpoints
# only do anything in Postgres mode; in JSON mode they return "skipped".
#
#
# LIVENESS vs READINESS (review finding #5): /api/health is the READINESS probe —
# it reports whether this instance can actually serve traffic, so a failed DB
# probe returns HTTP 503 (not 200), letting Railway's healthcheckPath and the
# docker-compose healthcheck detect a DB outage. /api/health/live is the
# LIVENESS probe: trivially 200 as long as the process is running, so a DB
# outage does not get the container needlessly killed and restarted.
#
# Endpoints:
#   GET  /api/health               — READINESS: DB connectivity + data counts.
#   GET  /api/health/live          — LIVENESS: always 200, touches nothing.
#   GET  /api/health/checks        — run all data-integrity checks, summarised.
#   POST /api/health/admin/reseed  — overwrite Postgres from the JSON seed files.
#   POST /api/health/admin/dump-to-json — export Postgres back to the JSON files.
#   GET  /api/health/nlp           — report NLP feature status / LLM provider.
# ─────────────────────────────────────────────────────────────────────────────
import os
import json
import logging
from pathlib import Path
from fastapi import APIRouter
from fastapi.responses import JSONResponse
from ..data_loader import load_nodes, load_segments, load_systems, save_nodes, save_systems, save_segments, save_capacity, save_outages, save_rules, load_capacity, load_outages, load_rules
from ..data_checks import run_all_checks, checks_summary

router = APIRouter(prefix="/health", tags=["health"])

DATA_DIR = Path(__file__).parent.parent.parent / "data"


@router.get("/live")
def liveness_probe():
    """GET /api/health/live — LIVENESS probe (review finding #5).

    Deliberately trivial: it touches no storage, no database, and no data
    loaders, so it answers exactly one question — "is this process up and
    serving HTTP?". Use this for container liveness/restart policies, where
    killing the process because a *dependency* is down would be wrong.

    Params: none.
    Response: {"status": "ok"} with HTTP 200, always.

    Auth: public read endpoint; no token required.
    """
    return {"status": "ok"}


@router.get("")
def health_check():
    """GET /api/health — READINESS probe: service health and data summary.

    Loads the core tables (nodes, segments, systems) and, if a DATABASE_URL is
    configured, runs a trivial "SELECT 1" to confirm the database is reachable.

    Review finding #5: this endpoint used to return HTTP 200 with status "ok"
    even when the DB probe failed, which meant Railway's healthcheckPath and the
    docker-compose healthcheck (both pointed here) could NEVER detect a database
    outage. It is now a real readiness probe:
      - Postgres mode (DATABASE_URL set) + DB probe fails → HTTP 503, status
        "degraded", db_ok false. Orchestration can act on that.
      - Postgres mode + DB reachable → HTTP 200, status "ok".
      - JSON-file mode (no DATABASE_URL) → HTTP 200, status "ok": there is no DB
        dependency to be unready about, the data lives in backend/data/*.json.
    Use /api/health/live if you want a probe that ignores dependencies.

    Params: none.
    Response: JSON with the same fields as before (the frontend HealthBar reads
    all of them, so the shape must not change):
      - status: "ok", or "degraded" when the DB dependency is down.
      - nodes / segments / systems: row counts of each core table.
      - storage: "postgres" or "json" depending on DATABASE_URL.
      - db_ok: bool, whether the DB connectivity probe succeeded.
      - db_detail: human-readable connectivity note (never leaks DSN/host).
    Status code: 200 when ready, 503 when degraded.

    Auth: public read endpoint; no token required.
    """
    from ..db import DATABASE_URL, get_conn

    # Load the core collections defensively. In Postgres mode these go through
    # the DB too, so an outage makes them raise — and an unhandled 500 here would
    # defeat the point of the probe (review finding #5): we want a structured
    # "degraded" answer, not a stack trace. On failure we report zero counts and
    # force the degraded verdict below.
    load_ok = True
    nodes = segments = systems = []
    try:
        nodes    = load_nodes()
        segments = load_segments()
        systems  = load_systems()
    except Exception as e:
        load_ok = False
        logging.getLogger("routebuilder.health").warning("Data load failed during health check: %s", e)

    db_ok = False
    db_detail = "No DATABASE_URL configured"
    if DATABASE_URL:
        try:
            conn = get_conn()
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
            conn.close()
            db_ok = True
            db_detail = "Connected"
        except Exception as e:
            # Security: log the real error server-side only; the client response
            # must never echo DSN/host fragments that could leak credentials.
            # Log full detail server-side; never echo DSN/host fragments to clients
            logging.getLogger("routebuilder.health").warning("DB health check failed: %s", e)
            db_detail = "Connection failed (see server logs)"

    # Readiness verdict. Two things can make this instance unready:
    #   - the Postgres dependency is down (only meaningful when DATABASE_URL is
    #     set — in JSON-file mode db_ok is False simply because there is no DB to
    #     probe, which must NOT be reported as degraded); or
    #   - the core collections could not be read at all, in either mode: we
    #     cannot serve routes without nodes and segments.
    degraded = (bool(DATABASE_URL) and not db_ok) or not load_ok
    if not load_ok and not DATABASE_URL:
        # File mode: there is no DB to blame, so say what actually broke (still
        # without leaking paths or raw exception text).
        db_detail = "Data files unreadable (see server logs)"

    payload = {
        "status":    "degraded" if degraded else "ok",
        "nodes":     len(nodes),
        "segments":  len(segments),
        "systems":   len(systems),
        "storage":   "postgres" if DATABASE_URL else "json",
        "db_ok":     db_ok,
        "db_detail": db_detail,
    }
    # 503 Service Unavailable is what Railway / docker-compose / k8s treat as a
    # failed probe. Returning JSONResponse lets us keep the body identical while
    # controlling the status code.
    return JSONResponse(status_code=503, content=payload) if degraded else payload


@router.get("/checks")
def integrity_checks():
    """GET /api/health/checks — run all data-integrity checks and summarise them.

    Executes every registered consistency check (e.g. segments pointing at nodes
    that exist, no dangling references) and returns a rolled-up summary.

    Params: none.
    Response: the summary object produced by checks_summary() over the raw check
    results (counts and per-check findings).

    Auth: public read endpoint; no token required.
    """
    return checks_summary(run_all_checks())


@router.post("/admin/reseed")
def admin_reseed():
    """POST /api/health/admin/reseed — reload Postgres from the bundled JSON seeds.

    Force-writes all data from the bundled JSON files (backend/data/*.json) into
    the corresponding Postgres tables and busts the in-memory cache. Does a full
    replace on each table (nodes, systems, segments, capacity, outages, rules),
    so it is safe to call repeatedly. A missing seed file is treated as empty.

    Params: none.
    Response: {"status": "ok", "reseeded": {<table>: <row count>, ...}} on
    success, or {"status": "skipped", "reason": ...} when DATABASE_URL is not
    set (in JSON mode the data already lives in the files — nothing to reseed).

    Auth: this MUTATES all data, so it requires the x-admin-token header when
    ADMIN_KEY is set — enforced centrally by the admin_write_guard middleware in
    app/main.py, not here.
    """
    from ..db import DATABASE_URL
    from ..models import Node, CableSystem, CableSegment, SegmentCapacity, SegmentOutage, InterconnectRule

    if not DATABASE_URL:
        return {"status": "skipped", "reason": "not using postgres — data lives in JSON files already"}

    def _load(filename, model):
        path = DATA_DIR / filename
        if not path.exists():
            return []
        return [model(**item) for item in json.loads(path.read_text())]

    nodes    = _load("nodes.json",    Node)
    systems  = _load("systems.json",  CableSystem)
    segments = _load("segments.json", CableSegment)
    capacity = _load("capacity.json", SegmentCapacity)
    outages  = _load("outages.json",  SegmentOutage)
    rules    = _load("rules.json",    InterconnectRule)

    save_nodes(nodes)
    save_systems(systems)
    save_segments(segments)
    save_capacity(capacity)
    save_outages(outages)
    save_rules(rules)

    return {
        "status": "ok",
        "reseeded": {
            "nodes":    len(nodes),
            "systems":  len(systems),
            "segments": len(segments),
            "capacity": len(capacity),
            "outages":  len(outages),
            "rules":    len(rules),
        },
    }


@router.post("/admin/dump-to-json")
def admin_dump_to_json():
    """POST /api/health/admin/dump-to-json — export Postgres back to JSON seeds.

    The inverse of reseed. Overwrites backend/data/*.json with whatever is
    currently in the database, so the JSON seed files stay in sync with
    user-entered data and API mutations (useful for committing snapshots back to
    the repo). Reads a fixed allowlist of tables (constant TABLES, so the table
    name is never user input); a per-table read error is recorded and skipped
    rather than aborting the whole dump.

    Params: none.
    Response: {"status": "ok", "written": {<table>: <row count or "ERROR: ...">}}
    on success, or {"status": "skipped", "reason": ...} when DATABASE_URL is not
    set (in JSON mode the files are already the source of truth).

    Auth: this MUTATES the on-disk seed files, so it requires the x-admin-token
    header when ADMIN_KEY is set — enforced centrally by the admin_write_guard
    middleware in app/main.py, not here.
    """
    from ..db import DATABASE_URL, get_conn

    if not DATABASE_URL:
        return {"status": "skipped", "reason": "not using postgres — data lives in JSON files already"}

    TABLES = [
        ("nodes",    "nodes.json"),
        ("systems",  "systems.json"),
        ("segments", "segments.json"),
        ("capacity", "capacity.json"),
        ("outages",  "outages.json"),
        ("rules",    "rules.json"),
    ]

    results = {}
    conn = get_conn()
    try:
        for table, filename in TABLES:
            with conn.cursor() as cur:
                try:
                    cur.execute(f"SELECT data FROM {table} ORDER BY 1")  # nosec B608 — table from constant TABLES list
                    rows = [row["data"] for row in cur.fetchall()]
                except Exception as e:
                    results[table] = f"ERROR: {e}"
                    continue
            dest = DATA_DIR / filename
            with open(dest, "w") as f:
                json.dump(rows, f, indent=2)
            results[table] = len(rows)
    finally:
        conn.close()

    return {"status": "ok", "written": results}


@router.get("/nlp")
def nlp_status():
    """GET /api/health/nlp — report whether natural-language parsing is available.

    Checks the NLP feature flag and which LLM provider (if any) is configured,
    so the frontend knows whether to show the natural-language route search box.

    Params: none.
    Response: {"status", "provider", "detail"} where:
      - status "disabled" when NLP_ENABLED is not "true";
      - status "ok" with provider "claude"/"azure"/"openai" when a matching API
        key env var is present;
      - status "error" when NLP is enabled but no provider key is set.

    Auth: public read endpoint; no token required.
    """
    if os.getenv("NLP_ENABLED", "").lower() != "true":
        return {"status": "disabled", "provider": None, "detail": "NLP disabled"}
    if os.getenv("ANTHROPIC_API_KEY"):
        return {"status": "ok", "provider": "claude", "detail": "Claude (Haiku)"}
    if os.getenv("AZURE_OPENAI_ENDPOINT"):
        return {"status": "ok", "provider": "azure", "detail": "Azure OpenAI"}
    if os.getenv("OPENAI_API_KEY"):
        return {"status": "ok", "provider": "openai", "detail": "GPT-4o-mini"}
    return {"status": "error", "provider": None, "detail": "No API key set"}
