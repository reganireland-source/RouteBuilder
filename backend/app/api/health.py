import os
import json
from pathlib import Path
from fastapi import APIRouter
from ..data_loader import load_nodes, load_segments, load_systems, save_nodes, save_systems, save_segments, save_capacity, save_outages, save_rules, load_capacity, load_outages, load_rules
from ..data_checks import run_all_checks, checks_summary

router = APIRouter(prefix="/health", tags=["health"])

DATA_DIR = Path(__file__).parent.parent.parent / "data"


@router.get("")
def health_check():
    from ..db import DATABASE_URL, get_conn
    nodes    = load_nodes()
    segments = load_segments()
    systems  = load_systems()

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
            # Log full detail server-side; never echo DSN/host fragments to clients
            import logging
            logging.getLogger("routebuilder.health").warning("DB health check failed: %s", e)
            db_detail = "Connection failed (see server logs)"

    return {
        "status":    "ok",
        "nodes":     len(nodes),
        "segments":  len(segments),
        "systems":   len(systems),
        "storage":   "postgres" if DATABASE_URL else "json",
        "db_ok":     db_ok,
        "db_detail": db_detail,
    }


@router.get("/checks")
def integrity_checks():
    return checks_summary(run_all_checks())


@router.post("/admin/reseed")
def admin_reseed():
    """Force-write all data from the bundled JSON files into Postgres and bust the cache.
    Safe to call repeatedly — does a full replace on each table.
    No-op (returns skipped) when not using Postgres."""
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
    """Export the current Postgres state back to the JSON seed files.

    Overwrites data/*.json with whatever is currently in the database so the
    JSON files stay in sync with user-entered data and API mutations.
    No-op (returns skipped) when not using Postgres.
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
    if os.getenv("NLP_ENABLED", "").lower() != "true":
        return {"status": "disabled", "provider": None, "detail": "NLP disabled"}
    if os.getenv("ANTHROPIC_API_KEY"):
        return {"status": "ok", "provider": "claude", "detail": "Claude (Haiku)"}
    if os.getenv("AZURE_OPENAI_ENDPOINT"):
        return {"status": "ok", "provider": "azure", "detail": "Azure OpenAI"}
    if os.getenv("OPENAI_API_KEY"):
        return {"status": "ok", "provider": "openai", "detail": "GPT-4o-mini"}
    return {"status": "error", "provider": None, "detail": "No API key set"}
