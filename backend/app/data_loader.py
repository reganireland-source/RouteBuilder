"""Data access layer for the RouteBuilder backend — the ONLY place that reads
or writes application data.

WHAT THIS FILE DOES
-------------------
Every API router in ``app/api/`` calls the ``load_*`` / ``save_*`` /
``create_* / update_* / delete_*`` functions here instead of touching storage
directly. Each function returns/accepts the Pydantic models from
``app/models.py`` (Node, CableSegment, SolutionNote, ...), so callers never
see raw SQL rows or raw JSON.

DUAL STORAGE MODE
-----------------
The backend runs against one of two storage backends, chosen at runtime by
whether the ``DATABASE_URL`` environment variable is set (see ``_use_db``):

- ``DATABASE_URL`` set (production, e.g. Railway + Postgres): data lives in
  Postgres, one JSONB document per row (see ``app/db.py`` for the schema).
- ``DATABASE_URL`` unset (local dev / tests): data lives in the JSON files
  bundled in ``backend/data/`` (nodes.json, segments.json, ...), and writes
  rewrite those files in place.

Every function below has an ``if _use_db(): ... else: ...`` split implementing
both modes, and both modes round-trip through the same Pydantic models — so
behaviour is identical apart from persistence location.

CACHING
-------
A single process-wide dict (``_cache``) memoises whole collections
("nodes" → list[Node], etc.). The route-search engine reads the full node and
segment sets on every request, so caching keeps performance on par with the
old pure-JSON-file design. Any write busts the relevant key (``_bust``) so the
next read reloads from storage. Note the cache is per-process: it assumes a
single backend process (or acceptably-stale reads across processes).
Solution notes and note categories are NOT cached — they are low-volume and
always read fresh.

TYPICAL FLOW
------------
``GET /api/nodes`` → ``app/api/nodes.py`` → ``load_nodes()`` → cache hit? →
else ``_db_load_all("nodes", "id", Node)`` (or read nodes.json) → cache and
return ``list[Node]``. A subsequent ``PUT`` → ``save_nodes(...)`` → bust
cache → ``_db_replace_all`` (or rewrite nodes.json).
"""

import json
from pathlib import Path
from .models import Node, CableSystem, CableSegment, InterconnectRule, SegmentCapacity, SegmentOutage, InterfaceType, TechLookupItem, Project, SolutionNote, NoteCategory

DATA_DIR = Path(__file__).parent.parent / "data"

# ── In-memory cache ───────────────────────────────────────────────────────────
# Populated on first read, invalidated on any write.
# Keeps route-search performance on par with the old JSON-file approach while
# still persisting all mutations to PostgreSQL.
_cache: dict[str, object] = {}

def _get(key: str):
    """Return the cached collection for `key` ("nodes", "segments", ...) or None."""
    return _cache.get(key)

def _set(key: str, value: object) -> None:
    """Store a freshly loaded collection in the cache under `key`."""
    _cache[key] = value

def _bust(key: str) -> None:
    """Invalidate one cache key. Called at the START of every save_* so the
    next load re-reads from storage even if the write partially fails."""
    _cache.pop(key, None)


def _use_db() -> bool:
    """True → Postgres mode; False → bundled-JSON-file mode.

    Decided purely by whether DATABASE_URL is set. Imported lazily (inside the
    function) so tests can monkeypatch app.db.DATABASE_URL and flip modes at
    runtime — a top-level `from .db import DATABASE_URL` would freeze the
    value at import time.
    """
    from .db import DATABASE_URL
    return bool(DATABASE_URL)


def _get_conn():
    """Open a new Postgres connection (thin lazy wrapper around db.get_conn)."""
    from .db import get_conn
    return get_conn()


def _write(path: Path, data: list) -> None:
    """JSON-file mode: overwrite `path` with `data` pretty-printed (2-space indent)."""
    with open(path, "w") as f:
        json.dump(data, f, indent=2)


# ── Generic DB helpers ────────────────────────────────────────────────────────

# SQL identifiers are never taken from request data: every table/column name
# interpolated below must appear in this allowlist. Values always go through
# parameterized placeholders.
#
# WHY AN ALLOWLIST? psycopg2 placeholders (%s) can only parameterize VALUES,
# not identifiers (table/column names). A few helpers below therefore build
# SQL with f-strings — e.g. _db_load_all's `SELECT data FROM {table}` and
# update_solution_note's `SET {col} = %s` where the column names come from a
# Pydantic Update model's field names. Today every such name originates from
# hard-coded constants or model definitions, so this is defence in depth: if
# a future caller ever passes a user-supplied string, _safe_ident raises
# instead of letting it reach the SQL text (SQL-injection guard). The set
# contains every table name plus every column used in the two relational
# tables (solution_notes, note_categories).
_ALLOWED_IDENTIFIERS = frozenset({
    "nodes", "systems", "segments", "capacity", "outages", "rules",
    "interfaces", "projects", "feature_requests", "solution_notes",
    "note_categories", "config",
    "tech_service_types", "tech_bandwidths", "tech_protections",
    "tech_frame_sizes", "tech_access_types", "tech_arranged_by",
    "tech_l1_settings",
    "id", "segment_id", "node_id", "fault_id", "category_id",
    "title", "text", "severity", "label", "applies_to", "order_num",
    "created_at",
})


def _safe_ident(name: str) -> str:
    """Return the identifier if allowlisted, else raise — defense in depth
    against any future caller passing untrusted strings into SQL."""
    if name not in _ALLOWED_IDENTIFIERS:
        raise ValueError(f"SQL identifier not allowlisted: {name!r}")
    return name


def _db_load_all(table: str, pk: str, model_class):
    """Load every row of a JSONB document table and parse into Pydantic models.

    Parameters:
        table:       allowlisted table name, e.g. "nodes".
        pk:          allowlisted primary-key column, e.g. "id" — used only
                     for a stable ORDER BY.
        model_class: the Pydantic class to hydrate each row's `data` JSONB
                     document into.

    Returns a list of model_class instances (may be empty).

    Example:
        nodes = _db_load_all("nodes", "id", Node)
        caps  = _db_load_all("capacity", "segment_id", SegmentCapacity)

    Gotcha: raises pydantic.ValidationError if a stored document no longer
    matches the current model schema — migrations in db.py must keep old
    documents compatible (or backfill them).
    """
    table, pk = _safe_ident(table), _safe_ident(pk)
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(f"SELECT data FROM {table} ORDER BY {pk}")  # nosec B608 — identifiers allowlisted
            return [model_class(**row["data"]) for row in cur.fetchall()]
    finally:
        conn.close()


def _db_replace_all(table: str, pk: str, pk_field: str, items) -> None:
    import psycopg2.extras
    table, pk = _safe_ident(table), _safe_ident(pk)
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(f"DELETE FROM {table}")  # nosec B608 — identifier allowlisted
            if items:
                psycopg2.extras.execute_values(
                    cur,
                    f"INSERT INTO {table} ({pk}, data) VALUES %s",  # nosec B608 — identifiers allowlisted
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


# ── Technical Enrichment Lookups ──────────────────────────────────────────────

_TECH_TABLES = [
    "tech_service_types",
    "tech_bandwidths",
    "tech_protections",
    "tech_frame_sizes",
    "tech_access_types",
    "tech_arranged_by",
    "tech_l1_settings",
]

def load_tech_lookup(table: str) -> list[TechLookupItem]:
    assert table in _TECH_TABLES, f"Unknown tech lookup table: {table}"
    cached = _get(table)
    if cached is not None:
        return cached  # type: ignore[return-value]
    if _use_db():
        result = _db_load_all(table, "id", TechLookupItem)
    else:
        result = []
    result.sort(key=lambda x: x.order)
    _set(table, result)
    return result

def save_tech_lookup(table: str, items: list[TechLookupItem]) -> None:
    assert table in _TECH_TABLES, f"Unknown tech lookup table: {table}"
    _bust(table)
    if _use_db():
        _db_replace_all(table, "id", "id", items)


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


def _row_to_note(row: dict) -> SolutionNote:
    return SolutionNote(
        id=row["id"], node_id=row.get("node_id"), segment_id=row.get("segment_id"),
        category_id=row["category_id"], title=row["title"], text=row["text"],
        severity=row["severity"], created_at=row.get("created_at"),
    )


def _row_to_cat(row: dict) -> NoteCategory:
    return NoteCategory(
        id=row["id"], label=row["label"], applies_to=row["applies_to"],
        order=row.get("order_num", row.get("order", 0)),
    )


def _json_notes() -> list[SolutionNote]:
    path = DATA_DIR / "solution_notes.json"
    if not path.exists():
        return []
    with open(path) as f:
        return [SolutionNote(**item) for item in json.load(f)]


def _json_cats() -> list[NoteCategory]:
    path = DATA_DIR / "note_categories.json"
    if not path.exists():
        return []
    with open(path) as f:
        return [NoteCategory(**item) for item in json.load(f)]


def load_solution_notes() -> list[SolutionNote]:
    if _use_db():
        conn = _get_conn()
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT id, node_id, segment_id, category_id, title, text, severity, created_at FROM solution_notes ORDER BY created_at NULLS LAST, id")
                return [_row_to_note(r) for r in cur.fetchall()]
        finally:
            conn.close()
    return _json_notes()


def create_solution_note(note: SolutionNote) -> SolutionNote:
    if _use_db():
        conn = _get_conn()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO solution_notes (id, node_id, segment_id, category_id, title, text, severity, created_at) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
                    (note.id, note.node_id, note.segment_id, note.category_id, note.title, note.text, note.severity, note.created_at),
                )
            conn.commit()
        finally:
            conn.close()
        return note
    notes = _json_notes()
    notes.append(note)
    _write(DATA_DIR / "solution_notes.json", [n.model_dump() for n in notes])
    return note


def update_solution_note(note_id: str, updates: dict) -> SolutionNote | None:
    if _use_db():
        conn = _get_conn()
        try:
            with conn.cursor() as cur:
                sets = ", ".join(f"{_safe_ident(k)} = %s" for k in updates)
                cur.execute(
                    f"UPDATE solution_notes SET {sets} WHERE id = %s RETURNING id, node_id, segment_id, category_id, title, text, severity, created_at",  # nosec B608 — columns allowlisted
                    [*updates.values(), note_id],
                )
                row = cur.fetchone()
            conn.commit()
        finally:
            conn.close()
        return _row_to_note(row) if row else None
    notes = _json_notes()
    for i, n in enumerate(notes):
        if n.id == note_id:
            updated = n.model_copy(update=updates)
            notes[i] = updated
            _write(DATA_DIR / "solution_notes.json", [x.model_dump() for x in notes])
            return updated
    return None


def delete_solution_note(note_id: str) -> bool:
    if _use_db():
        conn = _get_conn()
        try:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM solution_notes WHERE id = %s", (note_id,))
                deleted = cur.rowcount > 0
            conn.commit()
        finally:
            conn.close()
        return deleted
    notes = _json_notes()
    new_notes = [n for n in notes if n.id != note_id]
    if len(new_notes) == len(notes):
        return False
    _write(DATA_DIR / "solution_notes.json", [n.model_dump() for n in new_notes])
    return True


def load_note_categories() -> list[NoteCategory]:
    if _use_db():
        conn = _get_conn()
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT id, label, applies_to, order_num FROM note_categories ORDER BY applies_to, order_num, id")
                return [_row_to_cat(r) for r in cur.fetchall()]
        finally:
            conn.close()
    result = _json_cats()
    result.sort(key=lambda x: (x.applies_to, x.order))
    return result


def create_note_category(cat: NoteCategory) -> NoteCategory:
    if _use_db():
        conn = _get_conn()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO note_categories (id, label, applies_to, order_num) VALUES (%s,%s,%s,%s)",
                    (cat.id, cat.label, cat.applies_to, cat.order),
                )
            conn.commit()
        finally:
            conn.close()
        return cat
    cats = _json_cats()
    cats.append(cat)
    _write(DATA_DIR / "note_categories.json", [c.model_dump() for c in cats])
    return cat


def update_note_category(cat_id: str, updates: dict) -> NoteCategory | None:
    if _use_db():
        col_map = {"order": "order_num"}
        db_updates = {col_map.get(k, k): v for k, v in updates.items()}
        conn = _get_conn()
        try:
            with conn.cursor() as cur:
                sets = ", ".join(f"{_safe_ident(k)} = %s" for k in db_updates)
                cur.execute(
                    f"UPDATE note_categories SET {sets} WHERE id = %s RETURNING id, label, applies_to, order_num",  # nosec B608 — columns allowlisted
                    [*db_updates.values(), cat_id],
                )
                row = cur.fetchone()
            conn.commit()
        finally:
            conn.close()
        return _row_to_cat(row) if row else None
    cats = _json_cats()
    for i, c in enumerate(cats):
        if c.id == cat_id:
            updated = c.model_copy(update=updates)
            cats[i] = updated
            _write(DATA_DIR / "note_categories.json", [x.model_dump() for x in cats])
            return updated
    return None


def delete_note_category(cat_id: str) -> bool:
    if _use_db():
        conn = _get_conn()
        try:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM note_categories WHERE id = %s", (cat_id,))
                deleted = cur.rowcount > 0
            conn.commit()
        finally:
            conn.close()
        return deleted
    cats = _json_cats()
    new_cats = [c for c in cats if c.id != cat_id]
    if len(new_cats) == len(cats):
        return False
    _write(DATA_DIR / "note_categories.json", [c.model_dump() for c in new_cats])
    return True


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
