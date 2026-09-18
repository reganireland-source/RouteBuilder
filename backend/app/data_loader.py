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

TWO WRITE GRANULARITIES (see Finding #1 below)
----------------------------------------------
- ``save_X(list)``  — REPLACE THE WHOLE COLLECTION. Correct only when the
  caller genuinely means "this list is now the entire collection" (e.g. the
  Outage Parser replacing every outage record, or a bulk import).
- ``upsert_X(item)`` / ``delete_X_row(id)`` — touch exactly ONE row. This is
  what single-entity endpoints (POST/PUT/DELETE /api/nodes/{id}, ...) should
  use: concurrent writers to *different* rows can no longer clobber each
  other, and the write cost stops being proportional to collection size.
"""

import json
import os
import tempfile
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


def _write(path: Path, data) -> None:
    """JSON-file mode: overwrite `path` with `data` pretty-printed (2-space indent).

    Finding #23: this used to be `open(path, "w")` + `json.dump()`, which
    TRUNCATES the real file first and then streams the new content into it. If
    the process died, the disk filled, or the serialisation raised part-way
    through (e.g. an un-JSON-able value deep in a document), the seed file was
    left truncated or half-written — i.e. permanent data loss, and a backend
    that then fails to start because nodes.json no longer parses. Any concurrent
    reader could also observe a partial file.

    The fix is the standard atomic-replace dance: serialise into a temp file in
    the SAME directory (same filesystem, so the rename cannot cross devices),
    fsync it so the bytes are really on disk, then os.replace() — which is
    atomic on POSIX and Windows. Readers see either the complete old file or the
    complete new one, never a mixture. On any failure we remove the temp file
    and leave the original untouched.
    """
    fd, tmp_path = tempfile.mkstemp(
        dir=str(path.parent), prefix=f".{path.name}.", suffix=".tmp"
    )
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(data, f, indent=2)
            f.flush()
            os.fsync(f.fileno())      # durability: content hits disk before the swap
        # tempfile.mkstemp() deliberately creates 0600 files. Left as-is, every
        # runtime write would silently tighten the permissions of a tracked data
        # file from 0644 to 0600 — which breaks any process running as a
        # different user from the writer (e.g. the non-root appuser in
        # backend/Dockerfile) and diverges from what git has checked out.
        # Preserve the destination's existing mode, else fall back to 0644.
        try:
            mode = os.stat(path).st_mode & 0o777
        except FileNotFoundError:
            mode = 0o644
        os.chmod(tmp_path, mode)
        os.replace(tmp_path, path)    # atomic swap — the whole point of Finding #23
    except BaseException:
        # Never leave stray .tmp files behind, and never damage the original.
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


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
    """Replace the ENTIRE contents of a JSONB document table in one transaction.

    This is the write-side twin of _db_load_all: the save_* functions follow a
    load-everything / mutate-in-memory / save-everything pattern, so persisting
    means DELETE all rows then bulk INSERT the new list. Both statements share
    one transaction, so readers never observe a half-empty table.

    Parameters:
        table:    allowlisted table name, e.g. "segments".
        pk:       allowlisted primary-key COLUMN name in SQL, e.g. "segment_id".
        pk_field: attribute name on the model that supplies the key value —
                  usually identical to `pk` but passed separately.
        items:    iterable of Pydantic models; each is serialised with
                  model_dump() into the row's `data` JSONB column.

    Example:
        _db_replace_all("capacity", "segment_id", "segment_id", capacity_list)

    Finding #1 — WHEN NOT TO USE THIS: because it DELETEs everything first, it
    is only safe when the caller's `items` really is the whole intended
    collection. Using it to persist a single-row edit means "load all → mutate
    one → rewrite all", and two concurrent single-row edits then silently lose
    one of the two changes (last writer wins over the *entire* table, not just
    over the row it touched). Single-row edits must use _db_upsert_one /
    _db_delete_one below.
    """
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


# ── Per-row DB primitives (Finding #1) ────────────────────────────────────────
# WHY THESE EXIST
# ---------------
# Every write used to funnel through _db_replace_all, i.e. DELETE the whole
# table then re-INSERT the in-memory list. Two problems:
#
# 1. LOST UPDATES (data integrity, the serious one). Request A loads all 900
#    nodes, edits node X. Request B loads all 900 nodes, edits node Y. Both save
#    the full list. Whoever commits second wipes the other's row — no error, no
#    conflict, the edit just disappears. That is unavoidable with
#    load-all/save-all: the write's footprint is the whole table even though the
#    user changed one field.
# 2. WRITE AMPLIFICATION. Editing one node rewrote every row (O(N) I/O, N dead
#    tuples for VACUUM, and a table-wide lock for the duration).
#
# A single-row UPSERT/DELETE fixes both: the statement's footprint is exactly
# the row being changed, so concurrent edits to different rows commit
# independently and cost O(1).

def _db_upsert_one(table: str, pk: str, pk_value: str, item_dict: dict) -> None:
    """Insert-or-replace ONE row of a JSONB document table, atomically.

    Parameters:
        table:     allowlisted table name, e.g. "nodes".
        pk:        allowlisted primary-key COLUMN, e.g. "segment_id".
        pk_value:  the key value for this row.
        item_dict: the document to store (already model_dump()ed to plain JSON
                   types) — becomes the row's `data` JSONB column.

    Uses INSERT ... ON CONFLICT DO UPDATE so create and update are the same
    statement (and the same single round trip); no read-modify-write window
    exists for another writer to slip into.
    """
    table, pk = _safe_ident(table), _safe_ident(pk)
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            # nosec B608 — table/pk went through the _safe_ident allowlist above
            cur.execute(
                f"INSERT INTO {table} ({pk}, data) VALUES (%s, %s::jsonb) "
                f"ON CONFLICT ({pk}) DO UPDATE SET data = EXCLUDED.data",
                (pk_value, json.dumps(item_dict)),
            )
        conn.commit()
    finally:
        conn.close()


def _db_delete_one(table: str, pk: str, pk_value: str) -> bool:
    """Delete ONE row by primary key. Returns True if a row was actually removed
    (so callers can turn a miss into a 404 instead of a silent success)."""
    table, pk = _safe_ident(table), _safe_ident(pk)
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            # nosec B608 — identifiers allowlisted by _safe_ident above
            cur.execute(f"DELETE FROM {table} WHERE {pk} = %s", (pk_value,))
            deleted = cur.rowcount > 0
        conn.commit()
    finally:
        conn.close()
    return deleted


# ── Per-row JSON-file primitives (Finding #1, file mode) ──────────────────────
# File mode has no transactions, so "atomic" here means: read the current file,
# apply the one-row change, and swap the new file in with _write() (which is
# atomic since Finding #23). The read-modify-write window still exists in file
# mode — but file mode is the local-dev/test backend (single process, single
# developer), and behaviour stays identical to the save_* path, which is the
# requirement.

def _file_read_docs(path: Path) -> list[dict]:
    """Return the raw JSON list stored at `path` ([] if the file is absent).

    Deliberately returns plain dicts rather than Pydantic models: a per-row
    write must not silently rewrite the OTHER rows through the current model
    schema (that would inject new default fields into documents the caller never
    touched, turning a one-row edit back into a whole-file rewrite).
    """
    if not path.exists():
        return []
    with open(path) as f:
        return json.load(f)


def _file_upsert_one(path: Path, pk_field: str, item) -> None:
    """Replace-or-append ONE document in a JSON collection file, then swap it in.

    `pk_field` is the document key that identifies the row ("id",
    "segment_id", "fault_id"); `item` is a Pydantic model. Existing rows keep
    their position in the file (so diffs stay readable); new rows are appended,
    matching what save_X(list) produced before.
    """
    docs = _file_read_docs(path)
    doc = item.model_dump()
    key = getattr(item, pk_field)
    for i, existing in enumerate(docs):
        if existing.get(pk_field) == key:
            docs[i] = doc
            break
    else:
        docs.append(doc)
    _write(path, docs)


def _file_delete_one(path: Path, pk_field: str, pk_value: str) -> bool:
    """Remove ONE document from a JSON collection file. Returns True if it was
    present (mirrors _db_delete_one's contract so both modes behave the same).
    No write happens at all when nothing matched."""
    docs = _file_read_docs(path)
    remaining = [d for d in docs if d.get(pk_field) != pk_value]
    if len(remaining) == len(docs):
        return False
    _write(path, remaining)
    return True


# ── Nodes ─────────────────────────────────────────────────────────────────────
# NOTE: every load_X/save_X pair from here down to Projects follows the same
# template, so their docstrings are kept short:
#   load_X(): return cache if warm; else read all rows from Postgres (DB mode)
#             or the matching backend/data/X.json file (file mode); cache; return.
#   save_X(list): bust the cache, then replace the whole collection in Postgres
#             (_db_replace_all) or rewrite the JSON file.
# Writers therefore work "wholesale": callers load the full list, modify it in
# memory, and save the full list back.
#
# Finding #1: each entity below now ALSO has a row-level pair:
#   upsert_X(item)     → insert-or-replace just that one record.
#   delete_X_row(id)   → delete just that one record; returns False if absent.
# Prefer those in single-entity endpoints. save_X(list) is retained unchanged
# for the genuine "this is the whole collection now" cases (bulk import,
# reseed, the Outage Parser's replace-all).

def load_nodes() -> list[Node]:
    """Return all nodes (CLSs, PoPs, branching units) as list[Node]. Cached."""
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
    """Replace the full node collection (see template note above)."""
    _bust("nodes")
    if _use_db():
        _db_replace_all("nodes", "id", "id", nodes)
        return
    _write(DATA_DIR / "nodes.json", [n.model_dump() for n in nodes])

def upsert_node(node: Node) -> Node:
    """Finding #1: create-or-update ONE node without rewriting the collection.
    Returns the node as stored. Use this for POST/PUT /api/nodes/{id}."""
    _bust("nodes")
    if _use_db():
        _db_upsert_one("nodes", "id", node.id, node.model_dump())
    else:
        _file_upsert_one(DATA_DIR / "nodes.json", "id", node)
    return node

def delete_node_row(node_id: str) -> bool:
    """Finding #1: delete ONE node. True if it existed, False if not found."""
    _bust("nodes")
    if _use_db():
        return _db_delete_one("nodes", "id", node_id)
    return _file_delete_one(DATA_DIR / "nodes.json", "id", node_id)


# ── Systems ───────────────────────────────────────────────────────────────────

def load_systems() -> list[CableSystem]:
    """Return all cable systems (named submarine cables, e.g. EAC, C2C). Cached."""
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
    """Replace the full cable-system collection."""
    _bust("systems")
    if _use_db():
        _db_replace_all("systems", "id", "id", systems)
        return
    _write(DATA_DIR / "systems.json", [s.model_dump() for s in systems])

def upsert_system(system: CableSystem) -> CableSystem:
    """Finding #1: create-or-update ONE cable system, row-level."""
    _bust("systems")
    if _use_db():
        _db_upsert_one("systems", "id", system.id, system.model_dump())
    else:
        _file_upsert_one(DATA_DIR / "systems.json", "id", system)
    return system

def delete_system_row(system_id: str) -> bool:
    """Finding #1: delete ONE cable system. True if it existed."""
    _bust("systems")
    if _use_db():
        return _db_delete_one("systems", "id", system_id)
    return _file_delete_one(DATA_DIR / "systems.json", "id", system_id)


# ── Segments ──────────────────────────────────────────────────────────────────

def load_segments() -> list[CableSegment]:
    """Return all segments — wet (submarine cable sections) and terrestrial
    (land backhaul) — as list[CableSegment]. Cached; hot path for route search."""
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
    """Replace the full segment collection."""
    _bust("segments")
    if _use_db():
        _db_replace_all("segments", "id", "id", segments)
        return
    _write(DATA_DIR / "segments.json", [s.model_dump() for s in segments])

def upsert_segment(segment: CableSegment) -> CableSegment:
    """Finding #1: create-or-update ONE segment, row-level. Especially important
    here — segments are the biggest collection and the one most often edited
    one-at-a-time (waypoint tweaks), so whole-table rewrites were both the
    slowest and the likeliest to lose a concurrent edit."""
    _bust("segments")
    if _use_db():
        _db_upsert_one("segments", "id", segment.id, segment.model_dump())
    else:
        _file_upsert_one(DATA_DIR / "segments.json", "id", segment)
    return segment

def delete_segment_row(segment_id: str) -> bool:
    """Finding #1: delete ONE segment. True if it existed."""
    _bust("segments")
    if _use_db():
        return _db_delete_one("segments", "id", segment_id)
    return _file_delete_one(DATA_DIR / "segments.json", "id", segment_id)


# ── Capacity ──────────────────────────────────────────────────────────────────

def load_capacity() -> list[SegmentCapacity]:
    """Return per-segment capacity records (total/available Tbps), keyed by
    segment_id. Cached."""
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
    """Replace the full capacity collection."""
    _bust("capacity")
    if _use_db():
        _db_replace_all("capacity", "segment_id", "segment_id", capacity)
        return
    _write(DATA_DIR / "capacity.json", [c.model_dump() for c in capacity])

def upsert_capacity(capacity: SegmentCapacity) -> SegmentCapacity:
    """Finding #1: create-or-update ONE capacity record, row-level. Keyed by
    segment_id (the capacity table's primary key), not 'id'."""
    _bust("capacity")
    if _use_db():
        _db_upsert_one(
            "capacity", "segment_id", capacity.segment_id, capacity.model_dump()
        )
    else:
        _file_upsert_one(DATA_DIR / "capacity.json", "segment_id", capacity)
    return capacity

def delete_capacity_row(segment_id: str) -> bool:
    """Finding #1: delete ONE capacity record by segment_id. True if it existed."""
    _bust("capacity")
    if _use_db():
        return _db_delete_one("capacity", "segment_id", segment_id)
    return _file_delete_one(DATA_DIR / "capacity.json", "segment_id", segment_id)


# ── Outages ───────────────────────────────────────────────────────────────────

def load_outages() -> list[SegmentOutage]:
    """Return active/historic cable-fault records. Cached. In file mode a
    missing outages.json means "no outages" (returns []) — note that this
    early-return path intentionally skips caching the empty result."""
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
    """Replace the full outage collection."""
    _bust("outages")
    if _use_db():
        _db_replace_all("outages", "fault_id", "fault_id", outages)
        return
    _write(DATA_DIR / "outages.json", [o.model_dump() for o in outages])

def upsert_outage(outage: SegmentOutage) -> SegmentOutage:
    """Finding #1: create-or-update ONE outage record, row-level (keyed by
    fault_id). NOTE: the Outage Parser deliberately keeps using
    save_outages(list) — for it, "replace the whole collection" is the intended
    semantic, not an accident."""
    _bust("outages")
    if _use_db():
        _db_upsert_one("outages", "fault_id", outage.fault_id, outage.model_dump())
    else:
        _file_upsert_one(DATA_DIR / "outages.json", "fault_id", outage)
    return outage

def delete_outage_row(fault_id: str) -> bool:
    """Finding #1: delete ONE outage record by fault_id. True if it existed."""
    _bust("outages")
    if _use_db():
        return _db_delete_one("outages", "fault_id", fault_id)
    return _file_delete_one(DATA_DIR / "outages.json", "fault_id", fault_id)


# ── Rules ─────────────────────────────────────────────────────────────────────

def load_rules() -> list[InterconnectRule]:
    """Return per-node interconnect rules (which cable systems may hand off to
    which at a given node — see InterconnectRule in models.py). Cached."""
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
    """Replace the full interconnect-rule collection."""
    _bust("rules")
    if _use_db():
        _db_replace_all("rules", "node_id", "node_id", rules)
        return
    _write(DATA_DIR / "rules.json", [r.model_dump() for r in rules])


# ── Config ────────────────────────────────────────────────────────────────────

def load_config() -> dict:
    """Return the global app configuration as a plain dict (NOT a Pydantic
    model — config is free-form). Stored as a single row keyed 'main' in the
    config table (DB mode) or config.json (file mode). Falls back to a default
    that classifies owned/consortium/IRU segments as on-net. Cached."""
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
    """Return the interface-type reference list (physical handoff options,
    e.g. 100GBase-LR4) used by project circuit forms. Cached."""
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
    """Replace the full interface-type collection."""
    _bust("interfaces")
    if _use_db():
        _db_replace_all("interfaces", "id", "id", interfaces)
        return
    _write(DATA_DIR / "interfaces.json", [i.model_dump() for i in interfaces])

def upsert_interface(interface: InterfaceType) -> InterfaceType:
    """Finding #1: create-or-update ONE interface type, row-level."""
    _bust("interfaces")
    if _use_db():
        _db_upsert_one("interfaces", "id", interface.id, interface.model_dump())
    else:
        _file_upsert_one(DATA_DIR / "interfaces.json", "id", interface)
    return interface

def delete_interface_row(interface_id: str) -> bool:
    """Finding #1: delete ONE interface type. True if it existed."""
    _bust("interfaces")
    if _use_db():
        return _db_delete_one("interfaces", "id", interface_id)
    return _file_delete_one(DATA_DIR / "interfaces.json", "id", interface_id)


# ── Technical Enrichment Lookups ──────────────────────────────────────────────

# The seven dropdown-lookup tables that back the circuit-design forms.
# They share one model (TechLookupItem) and one generic load/save pair below;
# the assert guards keep arbitrary table names out of the SQL layer (the
# _safe_ident allowlist would also catch them — belt and braces).
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
    """Return one tech lookup table (must be a name from _TECH_TABLES), sorted
    by its 'order' field. Cached per table. File mode has no JSON source for
    these — returns [] (they only exist seeded in Postgres)."""
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
    """Replace one tech lookup table. Silently a no-op in file mode (no JSON
    backing store), apart from busting the cache."""
    assert table in _TECH_TABLES, f"Unknown tech lookup table: {table}"
    _bust(table)
    if _use_db():
        _db_replace_all(table, "id", "id", items)


# ── Projects ──────────────────────────────────────────────────────────────────

def load_projects() -> list[Project]:
    """Return all customer solution projects (saved route designs with their
    circuits and endpoint details). Cached."""
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
    """Replace the full project collection."""
    _bust("projects")
    if _use_db():
        _db_replace_all("projects", "id", "id", projects)
        return
    _write(DATA_DIR / "projects.json", [p.model_dump() for p in projects])

def upsert_project(project: Project) -> Project:
    """Finding #1: create-or-update ONE project, row-level. Projects are the
    documents users edit most concurrently (two people saving different
    solutions at the same time), so this is where load-all/save-all lost real
    customer work."""
    _bust("projects")
    if _use_db():
        _db_upsert_one("projects", "id", project.id, project.model_dump())
    else:
        _file_upsert_one(DATA_DIR / "projects.json", "id", project)
    return project

def delete_project_row(project_id: str) -> bool:
    """Finding #1: delete ONE project. True if it existed."""
    _bust("projects")
    if _use_db():
        return _db_delete_one("projects", "id", project_id)
    return _file_delete_one(DATA_DIR / "projects.json", "id", project_id)


# ── Solution Notes & Note Categories ─────────────────────────────────────────
# Unlike everything above, these two entities live in PROPER RELATIONAL
# COLUMNS (not JSONB documents — see migration m055 in db.py) and support
# row-level create/update/delete instead of wholesale replace. They are also
# deliberately NOT cached: low read volume, and per-row edits make cache
# invalidation more trouble than it is worth.
# A "solution note" is free-text operational knowledge attached to a node or
# segment (site access rules, IRU terms, repair history, ...), grouped by a
# NoteCategory.

def _row_to_note(row: dict) -> SolutionNote:
    """Convert a solution_notes SQL row (RealDictCursor dict) into a SolutionNote."""
    return SolutionNote(
        id=row["id"], node_id=row.get("node_id"), segment_id=row.get("segment_id"),
        category_id=row["category_id"], title=row["title"], text=row["text"],
        severity=row["severity"], created_at=row.get("created_at"),
    )


def _row_to_cat(row: dict) -> NoteCategory:
    """Convert a note_categories SQL row into a NoteCategory. The SQL column is
    'order_num' (because ORDER is a SQL reserved word) but the model field is
    'order' — this is where that mapping happens on the read path."""
    return NoteCategory(
        id=row["id"], label=row["label"], applies_to=row["applies_to"],
        order=row.get("order_num", row.get("order", 0)),
    )


def _json_notes() -> list[SolutionNote]:
    """File-mode source of truth for solution notes ([] if the file is absent)."""
    path = DATA_DIR / "solution_notes.json"
    if not path.exists():
        return []
    with open(path) as f:
        return [SolutionNote(**item) for item in json.load(f)]


def _json_cats() -> list[NoteCategory]:
    """File-mode source of truth for note categories ([] if the file is absent)."""
    path = DATA_DIR / "note_categories.json"
    if not path.exists():
        return []
    with open(path) as f:
        return [NoteCategory(**item) for item in json.load(f)]


def load_solution_notes() -> list[SolutionNote]:
    """Return ALL solution notes, oldest first (created_at, NULLs last).
    Filtering by node/segment happens in the API layer, not here. Not cached."""
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
    """Insert one solution note (caller supplies a fully-populated model,
    including id) and return it unchanged."""
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


def _get_note_by_id(note_id: str) -> SolutionNote | None:
    """Fetch one note by id, or None. Finding #8: used by update_solution_note to
    answer a no-op PATCH with the current state instead of building broken SQL."""
    if _use_db():
        conn = _get_conn()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT id, node_id, segment_id, category_id, title, text,"
                    " severity, created_at FROM solution_notes WHERE id = %s",
                    (note_id,),
                )
                row = cur.fetchone()
        finally:
            conn.close()
        return _row_to_note(row) if row else None
    return next((n for n in _json_notes() if n.id == note_id), None)


def _get_cat_by_id(cat_id: str) -> NoteCategory | None:
    """Fetch one note category by id, or None (Finding #8 counterpart of
    _get_note_by_id, used for no-op PATCHes on categories)."""
    if _use_db():
        conn = _get_conn()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT id, label, applies_to, order_num"
                    " FROM note_categories WHERE id = %s",
                    (cat_id,),
                )
                row = cur.fetchone()
        finally:
            conn.close()
        return _row_to_cat(row) if row else None
    return next((c for c in _json_cats() if c.id == cat_id), None)


def update_solution_note(note_id: str, updates: dict) -> SolutionNote | None:
    """PATCH-style partial update of one note.

    `updates` contains only the fields the client actually sent — the API
    layer builds it from SolutionNoteUpdate via model_dump(exclude_unset=True),
    so the dict KEYS are Pydantic field names that double as SQL column names.
    That is exactly why each key is pushed through _safe_ident before being
    interpolated into the SET clause (values stay parameterized).

    Returns the updated note, or None if no note has that id.

    Finding #8: an empty `updates` dict (a PATCH with no recognised fields, e.g.
    `{}` or a body of only unknown keys — perfectly legal for the client to
    send) used to produce `UPDATE solution_notes SET  WHERE id = %s`, a syntax
    error that surfaced as an HTTP 500. "Change nothing" is not an error, so we
    now short-circuit: fetch and return the row as it stands (or None if the id
    does not exist, matching the normal not-found contract).
    """
    if not updates:
        return _get_note_by_id(note_id)
    if _use_db():
        conn = _get_conn()
        try:
            with conn.cursor() as cur:
                # Build "col1 = %s, col2 = %s" from the update keys; every key
                # must pass the identifier allowlist (SQL-injection guard).
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
    """Delete one note by id. Returns True if something was deleted."""
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
    """Return all note categories, sorted by (applies_to, order) so 'node'
    categories group together and 'segment' ones follow. Not cached."""
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
    """Insert one note category and return it unchanged. Model field 'order'
    is written to SQL column 'order_num'."""
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
    """PATCH-style partial update of one category (same pattern as
    update_solution_note: keys of `updates` become SQL column names via the
    _safe_ident allowlist). Returns None if no category has that id.

    Finding #8: same empty-PATCH guard as update_solution_note — with no fields
    to set, `SET  WHERE id = %s` is a SQL syntax error (HTTP 500). Return the
    unchanged row instead; a PATCH that asks for no changes has succeeded.
    """
    if not updates:
        return _get_cat_by_id(cat_id)
    if _use_db():
        # Model field 'order' → SQL column 'order_num' (ORDER is reserved in SQL)
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
    """Delete one category by id. Returns True if something was deleted.
    (Does not cascade: notes referencing the category keep their category_id.)"""
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
    """Persist the global config dict: upsert of the single 'main' row in DB
    mode, rewrite of config.json in file mode. Counterpart of load_config."""
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
    # Finding #23: go through _write() (temp file + os.replace) like every other
    # file-mode write, so a crash mid-write cannot leave config.json truncated —
    # an unparseable config file breaks every request that reads on_net rules.
    _write(DATA_DIR / "config.json", config)
