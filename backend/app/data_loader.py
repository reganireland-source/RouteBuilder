import json
from pathlib import Path
from .models import Node, CableSystem, CableSegment, InterconnectRule, SegmentCapacity, SegmentOutage, InterfaceType, Project

DATA_DIR = Path(__file__).parent.parent / "data"

# ── In-memory cache ───────────────────────────────────────────────────────────
# Populated on first read, invalidated on any write.
# Keeps route-search performance on par with the old JSON-file approach while
# still persisting all mutations to PostgreSQL.
_cache: dict[str, object] = {}

def _get(key: str):
    return _cache.get(key)

def _set(key: str, value: object) -> None:
    _cache[key] = value

def _bust(key: str) -> None:
    _cache.pop(key, None)


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
    cached = _get("nodes")
    if cached is not None:
        return cached  # type: ignore[return-value]
    if _use_db():
        result = _db_load_all("nodes", "id", Node)
    else:
        with open(DATA_DIR / "nodes.json") as f:
            result = [Node(**item) for item in json.load(f)]
    _set("nodes", result)
    return result

def save_nodes(nodes: list[Node]) -> None:
    _bust("nodes")
    if _use_db():
        _db_replace_all("nodes", "id", "id", nodes)
        return
    _write(DATA_DIR / "nodes.json", [n.model_dump() for n in nodes])


# ── Systems ───────────────────────────────────────────────────────────────────

def load_systems() -> list[CableSystem]:
    cached = _get("systems")
    if cached is not None:
        return cached  # type: ignore[return-value]
    if _use_db():
        result = _db_load_all("systems", "id", CableSystem)
    else:
        with open(DATA_DIR / "systems.json") as f:
            result = [CableSystem(**item) for item in json.load(f)]
    _set("systems", result)
    return result

def save_systems(systems: list[CableSystem]) -> None:
    _bust("systems")
    if _use_db():
        _db_replace_all("systems", "id", "id", systems)
        return
    _write(DATA_DIR / "systems.json", [s.model_dump() for s in systems])


# ── Segments ──────────────────────────────────────────────────────────────────

def load_segments() -> list[CableSegment]:
    cached = _get("segments")
    if cached is not None:
        return cached  # type: ignore[return-value]
    if _use_db():
        result = _db_load_all("segments", "id", CableSegment)
    else:
        with open(DATA_DIR / "segments.json") as f:
            result = [CableSegment(**item) for item in json.load(f)]
    _set("segments", result)
    return result

def save_segments(segments: list[CableSegment]) -> None:
    _bust("segments")
    if _use_db():
        _db_replace_all("segments", "id", "id", segments)
        return
    _write(DATA_DIR / "segments.json", [s.model_dump() for s in segments])


# ── Capacity ──────────────────────────────────────────────────────────────────

def load_capacity() -> list[SegmentCapacity]:
    cached = _get("capacity")
    if cached is not None:
        return cached  # type: ignore[return-value]
    if _use_db():
        result = _db_load_all("capacity", "segment_id", SegmentCapacity)
    else:
        with open(DATA_DIR / "capacity.json") as f:
            result = [SegmentCapacity(**item) for item in json.load(f)]
    _set("capacity", result)
    return result

def save_capacity(capacity: list[SegmentCapacity]) -> None:
    _bust("capacity")
    if _use_db():
        _db_replace_all("capacity", "segment_id", "segment_id", capacity)
        return
    _write(DATA_DIR / "capacity.json", [c.model_dump() for c in capacity])


# ── Outages ───────────────────────────────────────────────────────────────────

def load_outages() -> list[SegmentOutage]:
    cached = _get("outages")
    if cached is not None:
        return cached  # type: ignore[return-value]
    if _use_db():
        result = _db_load_all("outages", "fault_id", SegmentOutage)
    else:
        path = DATA_DIR / "outages.json"
        if not path.exists():
            return []
        with open(path) as f:
            result = [SegmentOutage(**item) for item in json.load(f)]
    _set("outages", result)
    return result

def save_outages(outages: list[SegmentOutage]) -> None:
    _bust("outages")
    if _use_db():
        _db_replace_all("outages", "fault_id", "fault_id", outages)
        return
    _write(DATA_DIR / "outages.json", [o.model_dump() for o in outages])


# ── Rules ─────────────────────────────────────────────────────────────────────

def load_rules() -> list[InterconnectRule]:
    cached = _get("rules")
    if cached is not None:
        return cached  # type: ignore[return-value]
    if _use_db():
        result = _db_load_all("rules", "node_id", InterconnectRule)
    else:
        with open(DATA_DIR / "rules.json") as f:
            result = [InterconnectRule(**item) for item in json.load(f)]
    _set("rules", result)
    return result

def save_rules(rules: list[InterconnectRule]) -> None:
    _bust("rules")
    if _use_db():
        _db_replace_all("rules", "node_id", "node_id", rules)
        return
    _write(DATA_DIR / "rules.json", [r.model_dump() for r in rules])


# ── Config ────────────────────────────────────────────────────────────────────

def load_config() -> dict:
    cached = _get("config")
    if cached is not None:
        return cached  # type: ignore[return-value]
    if _use_db():
        conn = _get_conn()
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT value FROM config WHERE key = 'main'")
                row = cur.fetchone()
                result = row["value"] if row else {"on_net_ownership": ["owned", "consortium", "iru"]}
        finally:
            conn.close()
    else:
        path = DATA_DIR / "config.json"
        if not path.exists():
            return {"on_net_ownership": ["owned", "consortium", "iru"]}
        with open(path) as f:
            result = json.load(f)
    _set("config", result)
    return result

# ── Interface Types ───────────────────────────────────────────────────────────

def load_interfaces() -> list[InterfaceType]:
    cached = _get("interfaces")
    if cached is not None:
        return cached  # type: ignore[return-value]
    if _use_db():
        result = _db_load_all("interfaces", "id", InterfaceType)
    else:
        path = DATA_DIR / "interfaces.json"
        if not path.exists():
            return []
        with open(path) as f:
            result = [InterfaceType(**item) for item in json.load(f)]
    _set("interfaces", result)
    return result

def save_interfaces(interfaces: list[InterfaceType]) -> None:
    _bust("interfaces")
    if _use_db():
        _db_replace_all("interfaces", "id", "id", interfaces)
        return
    _write(DATA_DIR / "interfaces.json", [i.model_dump() for i in interfaces])


# ── Projects ──────────────────────────────────────────────────────────────────

def load_projects() -> list[Project]:
    cached = _get("projects")
    if cached is not None:
        return cached  # type: ignore[return-value]
    if _use_db():
        result = _db_load_all("projects", "id", Project)
    else:
        path = DATA_DIR / "projects.json"
        if not path.exists():
            return []
        with open(path) as f:
            result = [Project(**item) for item in json.load(f)]
    _set("projects", result)
    return result

def save_projects(projects: list[Project]) -> None:
    _bust("projects")
    if _use_db():
        _db_replace_all("projects", "id", "id", projects)
        return
    _write(DATA_DIR / "projects.json", [p.model_dump() for p in projects])


def save_config(config: dict) -> None:
    _bust("config")
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
