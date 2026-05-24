import json
from pathlib import Path
from .models import Node, CableSystem, CableSegment, InterconnectRule, SegmentCapacity, SegmentOutage

DATA_DIR = Path(__file__).parent.parent / "data"


def _use_db() -> bool:
    from .db import DATABASE_URL
    return bool(DATABASE_URL)


def _get_conn():
    from .db import get_conn
    return get_conn()


def _write(path: Path, data: list) -> None:
    with open(path, "w") as f:
        json.dump(data, f, indent=2)


# ── Generic DB helpers ────────────────────────────────────────────────────────

def _db_load_all(table: str, pk: str, model_class):
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(f"SELECT data FROM {table} ORDER BY {pk}")
            return [model_class(**row["data"]) for row in cur.fetchall()]
    finally:
        conn.close()


def _db_replace_all(table: str, pk: str, pk_field: str, items) -> None:
    import psycopg2.extras
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(f"DELETE FROM {table}")
            if items:
                psycopg2.extras.execute_values(
                    cur,
                    f"INSERT INTO {table} ({pk}, data) VALUES %s",
                    [(getattr(item, pk_field), json.dumps(item.model_dump())) for item in items],
                )
        conn.commit()
    finally:
        conn.close()


# ── Nodes ─────────────────────────────────────────────────────────────────────

def load_nodes() -> list[Node]:
    if _use_db():
        return _db_load_all("nodes", "id", Node)
    with open(DATA_DIR / "nodes.json") as f:
        return [Node(**item) for item in json.load(f)]

def save_nodes(nodes: list[Node]) -> None:
    if _use_db():
        _db_replace_all("nodes", "id", "id", nodes)
        return
    _write(DATA_DIR / "nodes.json", [n.model_dump() for n in nodes])


# ── Systems ───────────────────────────────────────────────────────────────────

def load_systems() -> list[CableSystem]:
    if _use_db():
        return _db_load_all("systems", "id", CableSystem)
    with open(DATA_DIR / "systems.json") as f:
        return [CableSystem(**item) for item in json.load(f)]

def save_systems(systems: list[CableSystem]) -> None:
    if _use_db():
        _db_replace_all("systems", "id", "id", systems)
        return
    _write(DATA_DIR / "systems.json", [s.model_dump() for s in systems])


# ── Segments ──────────────────────────────────────────────────────────────────

def load_segments() -> list[CableSegment]:
    if _use_db():
        return _db_load_all("segments", "id", CableSegment)
    with open(DATA_DIR / "segments.json") as f:
        return [CableSegment(**item) for item in json.load(f)]

def save_segments(segments: list[CableSegment]) -> None:
    if _use_db():
        _db_replace_all("segments", "id", "id", segments)
        return
    _write(DATA_DIR / "segments.json", [s.model_dump() for s in segments])


# ── Capacity ──────────────────────────────────────────────────────────────────

def load_capacity() -> list[SegmentCapacity]:
    if _use_db():
        return _db_load_all("capacity", "segment_id", SegmentCapacity)
    with open(DATA_DIR / "capacity.json") as f:
        return [SegmentCapacity(**item) for item in json.load(f)]

def save_capacity(capacity: list[SegmentCapacity]) -> None:
    if _use_db():
        _db_replace_all("capacity", "segment_id", "segment_id", capacity)
        return
    _write(DATA_DIR / "capacity.json", [c.model_dump() for c in capacity])


# ── Outages ───────────────────────────────────────────────────────────────────

def load_outages() -> list[SegmentOutage]:
    if _use_db():
        return _db_load_all("outages", "fault_id", SegmentOutage)
    path = DATA_DIR / "outages.json"
    if not path.exists():
        return []
    with open(path) as f:
        return [SegmentOutage(**item) for item in json.load(f)]

def save_outages(outages: list[SegmentOutage]) -> None:
    if _use_db():
        _db_replace_all("outages", "fault_id", "fault_id", outages)
        return
    _write(DATA_DIR / "outages.json", [o.model_dump() for o in outages])


# ── Rules ─────────────────────────────────────────────────────────────────────

def load_rules() -> list[InterconnectRule]:
    if _use_db():
        return _db_load_all("rules", "node_id", InterconnectRule)
    with open(DATA_DIR / "rules.json") as f:
        return [InterconnectRule(**item) for item in json.load(f)]

def save_rules(rules: list[InterconnectRule]) -> None:
    if _use_db():
        _db_replace_all("rules", "node_id", "node_id", rules)
        return
    _write(DATA_DIR / "rules.json", [r.model_dump() for r in rules])


# ── Config ────────────────────────────────────────────────────────────────────

def load_config() -> dict:
    if _use_db():
        conn = _get_conn()
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT value FROM config WHERE key = 'main'")
                row = cur.fetchone()
                return row["value"] if row else {"on_net_ownership": ["owned", "consortium", "iru"]}
        finally:
            conn.close()
    path = DATA_DIR / "config.json"
    if not path.exists():
        return {"on_net_ownership": ["owned", "consortium", "iru"]}
    with open(path) as f:
        return json.load(f)

def save_config(config: dict) -> None:
    if _use_db():
        conn = _get_conn()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO config (key, value) VALUES ('main', %s) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
                    (json.dumps(config),),
                )
            conn.commit()
        finally:
            conn.close()
        return
    with open(DATA_DIR / "config.json", "w") as f:
        json.dump(config, f, indent=2)
