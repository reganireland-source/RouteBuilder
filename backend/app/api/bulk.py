"""
Bulk CSV import / export for reference data tables (nodes, segments,
systems, capacity, coverage). Mounted under /api/bulk by main.py.

WORKFLOW: every table follows the same two-phase pattern, mirrored in this
file's two sections below:

  1. POST /bulk/validate/<table> — dry run. Parses the uploaded CSV, checks
     every row against the same rules the API itself enforces (required
     fields, allowed enum values, foreign keys, numeric ranges, id format),
     and returns a full diff against the current data (added/modified/
     unchanged/deleted rows, with before/after values and which fields
     changed) WITHOUT writing anything. The frontend's import screen renders
     this diff for an operator to review before committing.
  2. POST /bulk/import/<table> — actually applies the same CSV. Re-derives
     each row into a model (no result from validate/ is reused — the two
     endpoints are independent parses of the same file) and writes the
     result via data_loader's save_*. A row that fails to build a model is
     SKIPPED and reported back, never silently dropped (see Finding #9
     below) — the import always completes and returns a per-row report
     rather than failing the whole request over one bad row.

MODES (BulkMode, applied identically by both phases): "upsert" adds new rows
and updates existing ones, leaving rows absent from the file untouched;
"add_only" adds new rows and leaves existing ones (even if the file's version
differs) untouched, skipping them; "full_replace" adds/updates like upsert
AND deletes every existing row whose id is not present in the file — the only
mode capable of data loss, which is why validate/ always shows the deletion
list before import/ is called.

Every export/import path shares one governing rule: never let a bulk
operation on N columns wipe fields the CSV doesn't mention. See _merged()'s
docstring for how that is enforced on the import side, and note that
export_* functions are exhaustive projections of the model — deliberately
not sharing that "unlisted fields survive" property, since a column simply
absent from a CSV schema is never expected to round-trip.
"""
import csv
import io
import json
import logging
from typing import Any, Literal, get_args

from fastapi import APIRouter, File, Query, UploadFile
from fastapi.responses import StreamingResponse

from ..id_utils import ID_MAX_LEN, ID_RULE_DESCRIPTION, ID_SAFE_RE, invalid_chars
from ..data_loader import (
    load_capacity,
    load_nodes,
    load_segments,
    load_systems,
    save_capacity,
    save_nodes,
    save_segments,
    save_systems,
)
from ..models import (
    BackboneCapabilities,
    CableSegment,
    CableSystem,
    ColocationCapabilities,
    Node,
    NodeCapabilities,
    NodeType,
    Ownership,
    SegmentCapacity,
    SegmentType,
    UnderlayCapabilities,
    VerificationStatus,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/bulk", tags=["bulk"])

BulkMode = Literal["upsert", "add_only", "full_replace"]

# ── Column schemas ─────────────────────────────────────────────────────────────

NODE_COLS = [
    "id", "name", "lat", "lng", "type", "country", "owner", "trading_name",
    "city", "street_address", "description", "verification_status", "last_verified_date",
]
SEGMENT_COLS = [
    "id", "name", "system_id", "start_node_id", "end_node_id", "type",
    "length_km", "latency", "reliability", "cost_weight", "ownership",
    "verification_status", "last_verified_date",
]
SYSTEM_COLS   = ["id", "name", "description", "margin"]
CAPACITY_COLS = ["segment_id", "total_capacity_t", "available_capacity_t"]
COVERAGE_COLS = [
    "node_id", "ipt_speeds", "epl_speeds", "evpl_speeds",
    "gid_speeds", "ipvpn_speeds", "colocation_category",
]

# ── Allowed-value sets ─────────────────────────────────────────────────────────
#
# Finding #10: these sets used to be hand-copied literals and had DRIFTED from
# models.py (VALID_NODE_TYPES was missing "off_net", so validate/nodes rejected
# a row that import/nodes happily accepted). They are now DERIVED from the
# single source of truth in models.py, so they can never drift again — adding a
# member to NodeType / SegmentType / Ownership / VerificationStatus is picked up
# here automatically. Do NOT re-introduce literal copies.

def _allowed_values(alias: Any) -> set[str]:
    """Allowed string values of a models.py type alias.

    Handles both spellings so this keeps working if models.py switches between
    them: ``Literal[...]`` aliases (values come from ``typing.get_args``) and
    ``str, Enum`` classes (values come from the members).
    """
    args = get_args(alias)
    if args:
        return {str(getattr(a, "value", a)) for a in args}
    return {str(member.value) for member in alias}


VALID_NODE_TYPES   = _allowed_values(NodeType)
VALID_SEG_TYPES    = _allowed_values(SegmentType)
VALID_OWNERSHIPS   = _allowed_values(Ownership)
VALID_VERIF_STATUS = _allowed_values(VerificationStatus)
# Speed grades are bulk-CSV-only vocabularies (models.py stores them as free
# list[str]), so there is no upstream type to derive these two from.
VALID_BB_SPEEDS  = {"1G", "10G", "100G", "400G"}
VALID_UL_SPEEDS  = {"1G", "10G"}

# ── ID validation (rules imported from id_utils; only bulk-specific hints here) ─

import re as _re

_NODE_HINT_RE    = _re.compile(r'^[A-Z][A-Z0-9]{2,14}$')
_SYSTEM_HINT_RE  = _re.compile(r'^[A-Z][A-Z0-9_]{1,14}$')


def _validate_id(
    raw: str, entity: str, row_num: int,
) -> tuple[str, list[dict], list[dict]]:
    """Return (normalized_id, blocking_errors, non_blocking_warnings)."""
    errors: list[dict] = []
    warnings: list[dict] = []
    rid = raw.strip()

    # ── 1. Block unsafe characters (same rule as API) ─────────────────────────
    # Both the character class and the wording come from id_utils, so a bulk
    # import can never accept an id the API would refuse, or explain the rule
    # differently from the way the form does.
    if not ID_SAFE_RE.match(rid):
        errors.append(_err(row_num, rid, "id", rid,
            f"Contains invalid characters {invalid_chars(rid)!r}. {ID_RULE_DESCRIPTION}"))
        return rid.upper(), errors, warnings

    # ── 2. Auto-uppercase ─────────────────────────────────────────────────────
    normalized = rid.upper()
    if rid != normalized:
        warnings.append({"row_num": row_num, "id": normalized, "field": "id",
            "message": f"Auto-uppercased: '{rid}' → '{normalized}'"})

    # ── 3. Max length (same limits as API) ────────────────────────────────────
    max_len = ID_MAX_LEN.get(entity, 30)
    if len(normalized) > max_len:
        errors.append(_err(row_num, normalized, "id", normalized,
            f"ID is {len(normalized)} characters; maximum for {entity} is {max_len}"))

    # ── 4. Pattern hints (bulk-only advisory, non-blocking) ───────────────────
    if entity == "node" and not _NODE_HINT_RE.match(normalized):
        warnings.append({"row_num": row_num, "id": normalized, "field": "id",
            "message": f"Unusual node ID '{normalized}'. Typical format: 3-4 uppercase letters + 1-2 digits (e.g. SIN3, HKG1, BOM2)"})
    elif entity == "segment" and "-" not in normalized:
        warnings.append({"row_num": row_num, "id": normalized, "field": "id",
            "message": f"Unusual segment ID '{normalized}' — no hyphen found. Typical format: SYSTEM-NODEA-NODEB (e.g. EAC-SIN-HKG)"})
    elif entity == "system" and not _SYSTEM_HINT_RE.match(normalized):
        warnings.append({"row_num": row_num, "id": normalized, "field": "id",
            "message": f"Unusual system ID '{normalized}'. Typical format: short uppercase code (e.g. EAC, AAG, INDIGO_C)"})

    return normalized, errors, warnings


# ── Shared helpers ─────────────────────────────────────────────────────────────

def _norm(v: Any) -> str:
    """Canonical string for diff comparison — normalises floats, None, empty.

    Used by _changed_fields() so that e.g. None, "" and [] all compare equal
    (a CSV blank should not register as "changed" against a stored None), and
    so a float's string form doesn't spuriously differ by trailing-zero
    formatting (1.0 vs 1.00000000) between the CSV's parsed value and the
    stored model's value — both go through the same "%.8g" formatting here."""
    if v is None or v == "" or v == []:
        return ""
    if isinstance(v, float):
        return f"{v:.8g}"
    if isinstance(v, list):
        return json.dumps(v, separators=(",", ":"))
    return str(v).strip()


def _changed_fields(new: dict, old: dict) -> list[str]:
    """Names of every key whose normalised value differs between `new` (the
    row as parsed from the CSV) and `old` (the corresponding stored record).
    Takes the union of both dicts' keys, so a field present in one but not
    the other is treated as changed too (via _norm's None/blank handling)."""
    keys = set(new) | set(old)
    return [k for k in keys if _norm(new.get(k)) != _norm(old.get(k))]


def _err(row_num: int, id_: str, field: str, value: str, message: str) -> dict:
    """Build one validation-error entry for a /validate/* response. `value` is
    truncated to 80 chars so a pathological cell can't bloat the response."""
    return {"row_num": row_num, "id": id_, "field": field, "value": str(value)[:80], "message": message}


def _result(table: str, mode: str, errors: list, warnings: list, changes: list,
            total: int, added: int, modified: int, unchanged: int,
            deleted: int, kept: int) -> dict:
    """Assemble a /validate/<table> response: the dry-run diff plus its
    summary counts. `can_import` is derived (no errors present) rather than
    passed in, so it can never be set inconsistently with `errors`. `kept`
    counts rows that exist in the DB but are absent from the file and are
    NOT being deleted (i.e. every mode except full_replace); `deleted` is its
    complement, populated only under full_replace — see the module docstring
    for what each mode does."""
    return {
        "table": table,
        "mode": mode,
        "validation_errors": errors,
        "warnings": warnings,
        "summary": {
            "total_in_file": total,
            "added": added,
            "modified": modified,
            "unchanged": unchanged,
            "deleted": deleted,
            "kept_in_db": kept,
        },
        "changes": changes,
        "can_import": len(errors) == 0,
    }


# Finding #22 (CWE-1236): a cell that starts with one of these is interpreted as
# a formula by Excel / LibreOffice / Google Sheets when the export is opened, so
# an exported node name like '=HYPERLINK("http://evil","click")' would execute.
_CSV_INJECTION_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def _csv_safe(v: Any) -> Any:
    """Neutralise spreadsheet formula injection in a single cell.

    Finding #22: string cells beginning with a formula trigger get a leading
    single quote, which spreadsheets treat as "the rest is literal text".
    Non-string values (ints, floats, None) are returned untouched so numeric
    columns — including genuinely negative numbers — keep their type.
    """
    if isinstance(v, str) and v[:1] in _CSV_INJECTION_PREFIXES:
        return "'" + v
    return v


def _csv_stream(rows: list[dict], cols: list[str], filename: str) -> StreamingResponse:
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=cols, extrasaction="ignore")
    w.writeheader()
    # Finding #22: sanitise every string cell on the way out.
    w.writerows({k: _csv_safe(v) for k, v in row.items()} for row in rows)
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _read_csv(file: UploadFile) -> list[dict]:
    """Read an uploaded CSV synchronously.

    Finding #6: the bulk handlers are plain ``def`` so Starlette runs them in a
    threadpool instead of on the event loop. That means we cannot ``await
    file.read()`` here — ``file.file`` is the underlying SpooledTemporaryFile
    and is the correct blocking accessor for sync code.
    """
    raw = file.file.read()
    text = raw.decode("utf-8-sig")  # strip BOM written by Excel
    return list(csv.DictReader(io.StringIO(text)))


# ── Import row-failure reporting (Finding #9) ─────────────────────────────────
#
# Rows that cannot be turned into a model used to be swallowed by a bare
# `except Exception: continue`, so operators lost records while the endpoint
# still answered {"status": "ok"}. Failures are now counted, logged at warning
# level and returned to the caller.

# CSV data rows are enumerated from 2 so the reported row number matches what
# the user sees in their spreadsheet (row 1 is the header).
_FIRST_DATA_ROW = 2


def _merged(model_cls, existing, values: dict):
    """
    Build a model from the values a CSV row carries, PRESERVING every field of
    an existing record that the CSV does not carry a column for.

    Why this exists: each importer used to hand-list the fields worth keeping
    and reconstruct the model from that list, so every field nobody remembered
    to add to the list was silently wiped on import. Different importers leaked
    different fields — nodes dropped `on_net`, segments dropped the RFS/EOL
    lifecycle dates, systems dropped both, and the coverage importer dropped
    five node fields at once. Merging onto the existing record inverts that: the
    CSV names only what it changes, so a field added to a model in future is
    carried through automatically instead of becoming the next silent data loss.

    The merge goes through the model CONSTRUCTOR rather than `model_copy`, so
    every validator still runs — including the cross-field rules on the RFS and
    EOL quarters. `model_copy(update=...)` would skip them and let an import
    write a combination the API itself would reject.
    """
    base = existing.model_dump() if existing is not None else {}
    return model_cls(**{**base, **values})


def _fail_row(row_errors: list[dict], applied: dict, table: str,
              row_num: int, reason: str) -> None:
    """Record (and log) a row that was skipped instead of dropping it silently."""
    clean = " ".join(str(reason).split())[:300]
    row_errors.append({"row": row_num, "error": clean})
    applied["failed"] = applied.get("failed", 0) + 1
    logger.warning("bulk import %s: row %d skipped — %s", table, row_num, clean)


def _import_result(table: str, mode: str, applied: dict,
                   row_errors: list[dict]) -> dict:
    """Finding #9: status reflects reality — 'partial' whenever rows were lost.

    Existing keys (status / table / mode / applied) keep their meaning; `applied`
    stays a flat str→int map for the frontend and gains a "failed" counter.
    `row_errors` and `failed` are new.
    """
    return {
        "status": "ok" if not row_errors else "partial",
        "table": table,
        "mode": mode,
        "applied": applied,
        "failed": len(row_errors),
        "row_errors": row_errors,
    }


def _enum_val(v: Any) -> str:
    return v.value if hasattr(v, "value") else str(v)


def _apply_deletions(updated: dict, existing_keys: set, file_ids: set, mode: str, applied: dict) -> None:
    """Mutates `updated` in place: under full_replace mode only, removes every
    id that exists in the DB (`existing_keys`) but was not seen in the
    uploaded file (`file_ids`), and increments applied["deleted"] for each.
    A no-op for "upsert" and "add_only" — those modes never delete, so rows
    missing from the file are simply left as they were in `updated`."""
    if mode == "full_replace":
        for did in existing_keys - file_ids:
            updated.pop(did, None)
            applied["deleted"] = applied.get("deleted", 0) + 1


# ── Export ─────────────────────────────────────────────────────────────────────

@router.get("/export/nodes")
def export_nodes():
    """GET /api/bulk/export/nodes — every Node as a downloadable nodes.csv,
    columns per NODE_COLS. Optional fields are exported as "" rather than
    the string "None", and enum fields are exported as their plain string
    value (not the Python enum repr) via _enum_val."""
    rows = []
    for n in load_nodes():
        rows.append({
            "id": n.id, "name": n.name, "lat": n.lat, "lng": n.lng,
            "type": _enum_val(n.type), "country": n.country, "owner": n.owner or "",
            "trading_name": n.trading_name or "",
            "city": n.city or "",
            "street_address": n.street_address or "",
            "description": n.description or "",
            "verification_status": _enum_val(n.verification_status) if n.verification_status else "draft",
            "last_verified_date": n.last_verified_date or "",
        })
    return _csv_stream(rows, NODE_COLS, "nodes.csv")


@router.get("/export/segments")
def export_segments():
    """GET /api/bulk/export/segments — every CableSegment as segments.csv,
    columns per SEGMENT_COLS. Note RFS/EOL lifecycle fields and waypoints are
    NOT in SEGMENT_COLS and so are not exported here — this CSV format
    predates those fields and only round-trips the columns it always has;
    see _merged()'s use in import_segments for how those fields survive an
    import that goes through this narrower CSV anyway."""
    rows = []
    for s in load_segments():
        rows.append({
            "id": s.id, "name": s.name, "system_id": s.system_id,
            "start_node_id": s.start_node_id, "end_node_id": s.end_node_id,
            "type": _enum_val(s.type), "length_km": s.length_km,
            "latency": s.latency if s.latency is not None else "",
            "reliability": s.reliability, "cost_weight": s.cost_weight,
            "ownership": _enum_val(s.ownership),
            "verification_status": _enum_val(s.verification_status) if s.verification_status else "draft",
            "last_verified_date": s.last_verified_date or "",
        })
    return _csv_stream(rows, SEGMENT_COLS, "segments.csv")


@router.get("/export/systems")
def export_systems():
    """GET /api/bulk/export/systems — every CableSystem as systems.csv,
    columns per SYSTEM_COLS. Like export_segments, this predates the RFS/EOL
    and fiber_pair_count/consortium_owners fields and does not export them."""
    rows = []
    for s in load_systems():
        rows.append({
            "id": s.id, "name": s.name, "description": s.description,
            "margin": s.margin if s.margin is not None else "",
        })
    return _csv_stream(rows, SYSTEM_COLS, "systems.csv")


@router.get("/export/capacity")
def export_capacity():
    """GET /api/bulk/export/capacity — every SegmentCapacity as capacity.csv,
    columns per CAPACITY_COLS."""
    rows = []
    for c in load_capacity():
        rows.append({
            "segment_id": c.segment_id,
            "total_capacity_t": c.total_capacity_t,
            "available_capacity_t": c.available_capacity_t,
        })
    return _csv_stream(rows, CAPACITY_COLS, "capacity.csv")


@router.get("/export/coverage")
def export_coverage():
    """GET /api/bulk/export/coverage — every Node's product-coverage facet
    (NodeCapabilities) flattened to one row of coverage.csv, columns per
    COVERAGE_COLS. Nodes with no capabilities set still get a row, with every
    speed-list column as "" and colocation_category as "". Multi-value speed
    lists are joined into a single comma-separated cell (the inverse of the
    split done by validate_coverage's parse_speeds / import_coverage's sp)."""
    rows = []
    for n in load_nodes():
        cap = n.capabilities
        bb   = cap.backbone   if cap and cap.backbone   else None
        ul   = cap.underlay   if cap and cap.underlay   else None
        colo = cap.colocation if cap and cap.colocation else None
        rows.append({
            "node_id":             n.id,
            "ipt_speeds":          ",".join(bb.ipt   or []) if bb   else "",
            "epl_speeds":          ",".join(bb.epl   or []) if bb   else "",
            "evpl_speeds":         ",".join(bb.evpl  or []) if bb   else "",
            "gid_speeds":          ",".join(ul.gid   or []) if ul   else "",
            "ipvpn_speeds":        ",".join(ul.ipvpn or []) if ul   else "",
            "colocation_category": str(colo.category)       if colo else "",
        })
    return _csv_stream(rows, COVERAGE_COLS, "coverage.csv")


# ── Validate ───────────────────────────────────────────────────────────────────

@router.post("/validate/nodes")
def validate_nodes(file: UploadFile = File(...), mode: BulkMode = Query("upsert")):
    """POST /api/bulk/validate/nodes — dry-run validate+diff a nodes CSV.

    Per row: checks id (via _validate_id, blocking on unsafe chars/length/
    duplicates), that `type` is a recognised NodeType, that lat/lng parse as
    numbers, that country is non-blank, and that verification_status (if
    given) is a recognised value — falling back to the existing record's
    status (or "draft" for a new row) when the CSV cell is blank or invalid,
    so an unrecognised value never silently becomes an error AND a bad
    default at once. Diffs each valid row against the current node with that
    id via _changed_fields. Writes nothing; see the module docstring for the
    validate/import two-phase workflow and what `mode` changes.
    """
    rows = _read_csv(file)
    existing = {n.id: n for n in load_nodes()}

    errors, warnings, changes = [], [], []
    seen: set[str] = set()
    added = modified = unchanged = 0

    for i, row in enumerate(rows, 1):
        raw_id = row.get("id", "").strip()
        if not raw_id:
            errors.append(_err(i, "", "id", "", "id is required"))
            continue

        rid, id_errs, id_warns = _validate_id(raw_id, "node", i)
        errors.extend(id_errs)
        warnings.extend(id_warns)
        if id_errs:
            continue

        if rid in seen:
            errors.append(_err(i, rid, "id", rid, f"Duplicate id '{rid}' in file (after normalisation)"))
            continue
        seen.add(rid)

        ntype = row.get("type", "").strip()
        if ntype not in VALID_NODE_TYPES:
            errors.append(_err(i, rid, "type", ntype,
                f"Must be one of: {', '.join(sorted(VALID_NODE_TYPES))}"))

        for fld in ("lat", "lng"):
            try:
                float(row.get(fld, "") or 0)
            except ValueError:
                errors.append(_err(i, rid, fld, row.get(fld, ""), f"'{fld}' must be a number"))

        if not row.get("country", "").strip():
            errors.append(_err(i, rid, "country", "", "country (ISO-2) is required"))

        verif_raw = row.get("verification_status", "").strip()
        if verif_raw and verif_raw not in VALID_VERIF_STATUS:
            errors.append(_err(i, rid, "verification_status", verif_raw,
                f"Must be one of: {', '.join(sorted(VALID_VERIF_STATUS))}"))

        ex_verif = _enum_val(existing[rid].verification_status) if rid in existing else "draft"
        verif = verif_raw if verif_raw in VALID_VERIF_STATUS else ex_verif

        try:
            new = {
                "id": rid, "name": row.get("name", "").strip(),
                "lat": float(row.get("lat", 0) or 0), "lng": float(row.get("lng", 0) or 0),
                "type": ntype, "country": row.get("country", "").strip().upper(),
                "owner": (row.get("owner") or "Telstra").strip(),
                "trading_name": row.get("trading_name", "").strip() or None,
                "city": row.get("city", "").strip() or None,
                "street_address": row.get("street_address", "").strip() or None,
                "description":  row.get("description", "").strip() or None,
                "verification_status": verif,
                "last_verified_date": row.get("last_verified_date", "").strip() or None,
            }
        # This is a plain dict build, not model construction, so about the
        # only thing that can raise here is float() on lat/lng — already
        # validated above — so this is a defensive belt-and-braces catch: on
        # the rare exception the row is dropped from the diff (not counted
        # as added/modified/unchanged, and no error is recorded for it)
        # rather than raising and failing the whole /validate/ request.
        except Exception:
            continue

        if rid in existing:
            ex = existing[rid]
            old = {
                "id": ex.id, "name": ex.name, "lat": ex.lat, "lng": ex.lng,
                "type": _enum_val(ex.type), "country": ex.country, "owner": ex.owner,
                "trading_name": ex.trading_name, "city": ex.city, "street_address": ex.street_address,
                "description": ex.description,
                "verification_status": _enum_val(ex.verification_status) if ex.verification_status else "draft",
                "last_verified_date": ex.last_verified_date,
            }
            cf = _changed_fields(new, old)
            if cf:
                changes.append({"status": "modified", "id": rid, "data": new, "prev_data": old, "changed_fields": cf})
                modified += 1
            else:
                unchanged += 1
        else:
            changes.append({"status": "added", "id": rid, "data": new})
            added += 1

    deleted_ids = set(existing) - seen
    deleted = len(deleted_ids) if mode == "full_replace" else 0
    kept    = len(deleted_ids) if mode != "full_replace" else 0
    if mode == "full_replace":
        for did in sorted(deleted_ids):
            ex = existing[did]
            changes.append({"status": "deleted", "id": did, "prev_data": {
                "id": ex.id, "name": ex.name, "type": _enum_val(ex.type), "country": ex.country,
            }})

    return _result("nodes", mode, errors, warnings, changes, len(rows), added, modified, unchanged, deleted, kept)


@router.post("/validate/segments")
def validate_segments(file: UploadFile = File(...), mode: BulkMode = Query("upsert")):
    """POST /api/bulk/validate/segments — dry-run validate+diff a segments
    CSV. Per row, beyond the id check: `type` and `ownership` must be
    recognised enum values; `system_id` must reference an existing system OR
    be the literal sentinel "TERRESTRIAL" (a terrestrial link not tied to any
    cable system); start_node_id/end_node_id must reference existing nodes;
    length_km/reliability/cost_weight must parse as numbers, with
    reliability additionally range-checked to [0, 1] and length_km to > 0.
    See validate_nodes for the verification_status fallback pattern (mirrored
    here) and the module docstring for the two-phase workflow."""
    rows = _read_csv(file)
    existing = {s.id: s for s in load_segments()}
    node_ids = {n.id for n in load_nodes()}
    sys_ids  = {s.id for s in load_systems()}

    errors, warnings, changes = [], [], []
    seen: set[str] = set()
    added = modified = unchanged = 0

    for i, row in enumerate(rows, 1):
        raw_id = row.get("id", "").strip()
        if not raw_id:
            errors.append(_err(i, "", "id", "", "id is required"))
            continue

        rid, id_errs, id_warns = _validate_id(raw_id, "segment", i)
        errors.extend(id_errs)
        warnings.extend(id_warns)
        if id_errs:
            continue

        if rid in seen:
            errors.append(_err(i, rid, "id", rid, f"Duplicate id '{rid}' in file (after normalisation)"))
            continue
        seen.add(rid)

        stype = row.get("type", "").strip()
        if stype not in VALID_SEG_TYPES:
            errors.append(_err(i, rid, "type", stype,
                f"Must be one of: {', '.join(sorted(VALID_SEG_TYPES))}"))

        own = row.get("ownership", "").strip()
        if own not in VALID_OWNERSHIPS:
            errors.append(_err(i, rid, "ownership", own,
                f"Must be one of: {', '.join(sorted(VALID_OWNERSHIPS))}"))

        sys_id = row.get("system_id", "").strip()
        if sys_id and sys_id not in sys_ids and sys_id != "TERRESTRIAL":
            errors.append(_err(i, rid, "system_id", sys_id, f"'{sys_id}' not found in Systems"))

        for fk_fld, fk_set in [("start_node_id", node_ids), ("end_node_id", node_ids)]:
            fk_v = row.get(fk_fld, "").strip()
            if fk_v and fk_v not in fk_set:
                errors.append(_err(i, rid, fk_fld, fk_v, f"'{fk_v}' not found in Nodes"))

        for num_fld in ("length_km", "reliability", "cost_weight"):
            raw = (row.get(num_fld) or "").strip()
            try:
                v = float(raw or 0)
                if num_fld == "reliability" and not 0 <= v <= 1:
                    errors.append(_err(i, rid, num_fld, raw, "Must be between 0 and 1"))
                if num_fld == "length_km" and v <= 0:
                    errors.append(_err(i, rid, num_fld, raw, "Must be > 0"))
            except ValueError:
                errors.append(_err(i, rid, num_fld, raw, f"'{num_fld}' must be a number"))

        seg_verif_raw = row.get("verification_status", "").strip()
        if seg_verif_raw and seg_verif_raw not in VALID_VERIF_STATUS:
            errors.append(_err(i, rid, "verification_status", seg_verif_raw,
                f"Must be one of: {', '.join(sorted(VALID_VERIF_STATUS))}"))

        ex_seg_verif = _enum_val(existing[rid].verification_status) if rid in existing else "draft"
        seg_verif = seg_verif_raw if seg_verif_raw in VALID_VERIF_STATUS else ex_seg_verif

        try:
            lat_raw = (row.get("latency") or "").strip()
            new = {
                "id": rid, "name": row.get("name", "").strip(), "system_id": sys_id,
                "start_node_id": row.get("start_node_id", "").strip(),
                "end_node_id": row.get("end_node_id", "").strip(), "type": stype,
                "length_km": float(row.get("length_km", 0) or 0),
                "latency": float(lat_raw) if lat_raw else None,
                "reliability": float(row.get("reliability", 0) or 0),
                "cost_weight": float(row.get("cost_weight", 0) or 0),
                "ownership": own,
                "verification_status": seg_verif,
                "last_verified_date": row.get("last_verified_date", "").strip() or None,
            }
        except Exception:
            continue

        if rid in existing:
            ex = existing[rid]
            old = {
                "id": ex.id, "name": ex.name, "system_id": ex.system_id,
                "start_node_id": ex.start_node_id, "end_node_id": ex.end_node_id,
                "type": _enum_val(ex.type), "length_km": ex.length_km, "latency": ex.latency,
                "reliability": ex.reliability, "cost_weight": ex.cost_weight,
                "ownership": _enum_val(ex.ownership),
                "verification_status": _enum_val(ex.verification_status) if ex.verification_status else "draft",
                "last_verified_date": ex.last_verified_date,
            }
            cf = _changed_fields(new, old)
            if cf:
                changes.append({"status": "modified", "id": rid, "data": new, "prev_data": old, "changed_fields": cf})
                modified += 1
            else:
                unchanged += 1
        else:
            changes.append({"status": "added", "id": rid, "data": new})
            added += 1

    deleted_ids = set(existing) - seen
    deleted = len(deleted_ids) if mode == "full_replace" else 0
    kept    = len(deleted_ids) if mode != "full_replace" else 0
    if mode == "full_replace":
        for did in sorted(deleted_ids):
            ex = existing[did]
            changes.append({"status": "deleted", "id": did, "prev_data": {"id": ex.id, "name": ex.name}})

    return _result("segments", mode, errors, warnings, changes, len(rows), added, modified, unchanged, deleted, kept)


@router.post("/validate/systems")
def validate_systems(file: UploadFile = File(...), mode: BulkMode = Query("upsert")):
    """POST /api/bulk/validate/systems — dry-run validate+diff a systems CSV.
    Per row: name is required, and margin (if given) must parse as a number
    in [1.0, 10.0]. No RFS/EOL or fiber_pair_count/consortium_owners fields
    are handled here — this bulk CSV format predates them, matching
    SYSTEM_COLS/export_systems (see that function's docstring)."""
    rows = _read_csv(file)
    existing = {s.id: s for s in load_systems()}

    errors, warnings, changes = [], [], []
    seen: set[str] = set()
    added = modified = unchanged = 0

    for i, row in enumerate(rows, 1):
        raw_id = row.get("id", "").strip()
        if not raw_id:
            errors.append(_err(i, "", "id", "", "id is required"))
            continue

        rid, id_errs, id_warns = _validate_id(raw_id, "system", i)
        errors.extend(id_errs)
        warnings.extend(id_warns)
        if id_errs:
            continue

        if rid in seen:
            errors.append(_err(i, rid, "id", rid, f"Duplicate id '{rid}' in file (after normalisation)"))
            continue
        seen.add(rid)

        if not row.get("name", "").strip():
            errors.append(_err(i, rid, "name", "", "name is required"))

        margin_raw = (row.get("margin") or "").strip()
        margin_val = None
        if margin_raw:
            try:
                margin_val = float(margin_raw)
                if not 1 <= margin_val <= 10:
                    errors.append(_err(i, rid, "margin", margin_raw, "Must be between 1.0 and 10.0"))
            except ValueError:
                errors.append(_err(i, rid, "margin", margin_raw, "Must be a number between 1 and 10"))

        new = {
            "id": rid, "name": row.get("name", "").strip(),
            "description": row.get("description", "").strip(), "margin": margin_val,
        }

        if rid in existing:
            ex = existing[rid]
            old = {"id": ex.id, "name": ex.name, "description": ex.description, "margin": ex.margin}
            cf = _changed_fields(new, old)
            if cf:
                changes.append({"status": "modified", "id": rid, "data": new, "prev_data": old, "changed_fields": cf})
                modified += 1
            else:
                unchanged += 1
        else:
            changes.append({"status": "added", "id": rid, "data": new})
            added += 1

    deleted_ids = set(existing) - seen
    deleted = len(deleted_ids) if mode == "full_replace" else 0
    kept    = len(deleted_ids) if mode != "full_replace" else 0
    if mode == "full_replace":
        for did in sorted(deleted_ids):
            ex = existing[did]
            changes.append({"status": "deleted", "id": did, "prev_data": {"id": ex.id, "name": ex.name}})

    return _result("systems", mode, errors, warnings, changes, len(rows), added, modified, unchanged, deleted, kept)


@router.post("/validate/capacity")
def validate_capacity(file: UploadFile = File(...), mode: BulkMode = Query("upsert")):
    """POST /api/bulk/validate/capacity — dry-run validate+diff a capacity
    CSV, keyed by segment_id rather than a standalone id. Per row: segment_id
    must reference an existing segment; total_capacity_t/available_capacity_t
    must each parse as a non-negative number, and available must not exceed
    total (checked only when total_val > 0, i.e. skipped for an all-zero/
    unparsed row rather than reported as an available > 0 > total error)."""
    rows = _read_csv(file)
    existing = {c.segment_id: c for c in load_capacity()}
    seg_ids  = {s.id for s in load_segments()}

    errors, warnings, changes = [], [], []
    seen: set[str] = set()
    added = modified = unchanged = 0

    for i, row in enumerate(rows, 1):
        raw_id = row.get("segment_id", "").strip()
        if not raw_id:
            errors.append(_err(i, "", "segment_id", "", "segment_id is required"))
            continue

        rid, id_errs, id_warns = _validate_id(raw_id, "capacity", i)
        errors.extend(id_errs)
        warnings.extend(id_warns)
        if id_errs:
            continue

        if rid in seen:
            errors.append(_err(i, rid, "segment_id", rid, f"Duplicate segment_id '{rid}' in file (after normalisation)"))
            continue
        seen.add(rid)

        if rid not in seg_ids:
            errors.append(_err(i, rid, "segment_id", rid, f"'{rid}' not found in Segments"))

        total_val = avail_val = 0.0
        for fld in ("total_capacity_t", "available_capacity_t"):
            raw = (row.get(fld) or "").strip()
            try:
                v = float(raw or 0)
                if v < 0:
                    errors.append(_err(i, rid, fld, raw, f"{fld} cannot be negative"))
                if fld == "total_capacity_t":
                    total_val = v
                else:
                    avail_val = v
            except ValueError:
                errors.append(_err(i, rid, fld, raw, f"{fld} must be a number"))

        if total_val > 0 and avail_val > total_val:
            errors.append(_err(i, rid, "available_capacity_t", str(avail_val),
                f"Available ({avail_val}) cannot exceed total ({total_val})"))

        new = {"segment_id": rid, "total_capacity_t": total_val, "available_capacity_t": avail_val}

        if rid in existing:
            ex = existing[rid]
            old = {"segment_id": ex.segment_id, "total_capacity_t": ex.total_capacity_t,
                   "available_capacity_t": ex.available_capacity_t}
            cf = _changed_fields(new, old)
            if cf:
                changes.append({"status": "modified", "id": rid, "data": new, "prev_data": old, "changed_fields": cf})
                modified += 1
            else:
                unchanged += 1
        else:
            changes.append({"status": "added", "id": rid, "data": new})
            added += 1

    deleted_ids = set(existing) - seen
    deleted = len(deleted_ids) if mode == "full_replace" else 0
    kept    = len(deleted_ids) if mode != "full_replace" else 0
    if mode == "full_replace":
        for did in sorted(deleted_ids):
            ex = existing[did]
            changes.append({"status": "deleted", "id": did, "prev_data": {"segment_id": ex.segment_id}})

    return _result("capacity", mode, errors, warnings, changes, len(rows), added, modified, unchanged, deleted, kept)


@router.post("/validate/coverage")
def validate_coverage(file: UploadFile = File(...), mode: BulkMode = Query("upsert")):
    """POST /api/bulk/validate/coverage — dry-run validate+diff a coverage
    CSV. Unlike the other validate_* endpoints, coverage never *adds* rows
    (a coverage row only ever modifies an existing node's capabilities, so
    node_id not found in Nodes is a blocking error, not a candidate "added"
    row) and never reports deletions (there is no standalone coverage
    record to delete — clearing coverage means uploading a row with blank
    speed/category cells, which this diff reports as a normal "modified").
    Each of ipt/epl/evpl_speeds and gid/ipvpn_speeds is a comma-separated
    list validated against its own allowed-speed set (VALID_BB_SPEEDS for
    backbone products, VALID_UL_SPEEDS for underlay), and
    colocation_category must be an integer 1-5 if given."""
    rows = _read_csv(file)
    existing = {n.id: n for n in load_nodes()}

    errors, warnings, changes = [], [], []
    seen: set[str] = set()
    modified = unchanged = 0

    for i, row in enumerate(rows, 1):
        raw_id = row.get("node_id", "").strip()
        if not raw_id:
            errors.append(_err(i, "", "node_id", "", "node_id is required"))
            continue

        rid, id_errs, id_warns = _validate_id(raw_id, "coverage", i)
        errors.extend(id_errs)
        warnings.extend(id_warns)
        if id_errs:
            continue

        if rid in seen:
            errors.append(_err(i, rid, "node_id", rid, f"Duplicate node_id '{rid}' in file (after normalisation)"))
            continue
        seen.add(rid)

        if rid not in existing:
            errors.append(_err(i, rid, "node_id", rid, f"'{rid}' not found in Nodes"))
            continue

        def parse_speeds(field: str, valid_set: set) -> list[str]:
            raw = (row.get(field) or "").strip()
            if not raw:
                return []
            speeds = [s.strip() for s in raw.split(",") if s.strip()]
            for sp in speeds:
                if sp not in valid_set:
                    errors.append(_err(i, rid, field, raw,
                        f"Invalid speed '{sp}'. Must be: {', '.join(sorted(valid_set))}"))
            return speeds

        ipt   = parse_speeds("ipt_speeds",   VALID_BB_SPEEDS)
        epl   = parse_speeds("epl_speeds",   VALID_BB_SPEEDS)
        evpl  = parse_speeds("evpl_speeds",  VALID_BB_SPEEDS)
        gid   = parse_speeds("gid_speeds",   VALID_UL_SPEEDS)
        ipvpn = parse_speeds("ipvpn_speeds", VALID_UL_SPEEDS)

        cat_raw = (row.get("colocation_category") or "").strip()
        cat_val = None
        if cat_raw:
            try:
                cat_val = int(cat_raw)
                if not 1 <= cat_val <= 5:
                    errors.append(_err(i, rid, "colocation_category", cat_raw, "Must be an integer 1–5"))
            except ValueError:
                errors.append(_err(i, rid, "colocation_category", cat_raw, "Must be an integer 1–5"))

        new_cap = {
            "ipt_speeds": ",".join(ipt), "epl_speeds": ",".join(epl), "evpl_speeds": ",".join(evpl),
            "gid_speeds": ",".join(gid), "ipvpn_speeds": ",".join(ipvpn),
            "colocation_category": str(cat_val) if cat_val else "",
        }

        ex_n   = existing[rid]
        ex_cap = ex_n.capabilities
        ex_bb  = ex_cap.backbone   if ex_cap and ex_cap.backbone   else None
        ex_ul  = ex_cap.underlay   if ex_cap and ex_cap.underlay   else None
        ex_cl  = ex_cap.colocation if ex_cap and ex_cap.colocation else None
        old_cap = {
            "ipt_speeds":          ",".join(ex_bb.ipt   or []) if ex_bb else "",
            "epl_speeds":          ",".join(ex_bb.epl   or []) if ex_bb else "",
            "evpl_speeds":         ",".join(ex_bb.evpl  or []) if ex_bb else "",
            "gid_speeds":          ",".join(ex_ul.gid   or []) if ex_ul else "",
            "ipvpn_speeds":        ",".join(ex_ul.ipvpn or []) if ex_ul else "",
            "colocation_category": str(ex_cl.category)         if ex_cl else "",
        }

        cf = _changed_fields(new_cap, old_cap)
        if cf:
            changes.append({"status": "modified", "id": rid,
                           "data": {**new_cap, "node_id": rid},
                           "prev_data": {**old_cap, "node_id": rid},
                           "changed_fields": cf})
            modified += 1
        else:
            unchanged += 1

    return _result("coverage", mode, errors, warnings, changes, len(rows), 0, modified, unchanged, 0, 0)


# ── Import ─────────────────────────────────────────────────────────────────────

@router.post("/import/nodes")
def import_nodes(file: UploadFile = File(...), mode: BulkMode = Query("upsert")):
    """POST /api/bulk/import/nodes — actually apply a nodes CSV (see the
    module docstring for the validate/import two-phase workflow and what
    `mode` does). Builds each row via _merged(Node, ...) so any field a Node
    carries but this CSV format doesn't (notably `capabilities`, explicitly
    preserved below, and `on_net`) survives untouched rather than being
    wiped. A row whose model fails to construct (bad enum value, etc.) is
    skipped and reported via _fail_row rather than aborting the whole
    import — see _import_result's docstring for the "partial" status this
    produces."""
    rows = _read_csv(file)
    existing = {n.id: n for n in load_nodes()}
    updated  = dict(existing)
    applied  = {"added": 0, "modified": 0, "unchanged": 0, "deleted": 0,
                "skipped": 0, "failed": 0}
    row_errors: list[dict] = []
    file_ids: set[str] = set()

    # Finding #9: enumerate from 2 so a reported row number lines up with the
    # spreadsheet row the operator is looking at (row 1 = header).
    for row_num, row in enumerate(rows, _FIRST_DATA_ROW):
        rid = row.get("id", "").strip().upper()
        if not rid:
            _fail_row(row_errors, applied, "nodes", row_num,
                      "'id' is empty — row skipped")
            continue
        file_ids.add(rid)

        if mode == "add_only" and rid in existing:
            applied["skipped"] += 1
            continue

        try:
            verif_raw = row.get("verification_status", "").strip()
            ex_node = existing.get(rid)
            verif = verif_raw if verif_raw in VALID_VERIF_STATUS else (
                _enum_val(ex_node.verification_status) if ex_node and ex_node.verification_status else "draft"
            )
            last_verified = row.get("last_verified_date", "").strip() or (
                ex_node.last_verified_date if ex_node else None
            )
            node = _merged(Node, ex_node, {
                "id": rid, "name": row.get("name", "").strip(),
                "lat": float(row.get("lat", 0) or 0), "lng": float(row.get("lng", 0) or 0),
                "type": row.get("type", "landing_station").strip(),
                "country": row.get("country", "").strip().upper(),
                "owner": (row.get("owner") or "Telstra").strip(),
                "trading_name": row.get("trading_name", "").strip() or None,
                "city": row.get("city", "").strip() or None,
                "street_address": row.get("street_address", "").strip() or None,
                "description": row.get("description", "").strip() or None,
                "capabilities": ex_node.capabilities if ex_node else None,
                "verification_status": verif,
                "last_verified_date": last_verified or None,
            })
        except Exception as exc:
            # Finding #9: report the discarded row instead of swallowing it.
            _fail_row(row_errors, applied, "nodes", row_num, f"id '{rid}': {exc}")
            continue

        if rid in existing:
            applied["modified"] += 1
        else:
            applied["added"] += 1
        updated[rid] = node

    _apply_deletions(updated, set(existing), file_ids, mode, applied)
    save_nodes(list(updated.values()))
    return _import_result("nodes", mode, applied, row_errors)


@router.post("/import/segments")
def import_segments(file: UploadFile = File(...), mode: BulkMode = Query("upsert")):
    rows = _read_csv(file)
    existing = {s.id: s for s in load_segments()}
    updated  = dict(existing)
    applied  = {"added": 0, "modified": 0, "unchanged": 0, "deleted": 0,
                "skipped": 0, "failed": 0}
    row_errors: list[dict] = []
    file_ids: set[str] = set()

    # Finding #9: row numbers include the header offset (row 1 = header).
    for row_num, row in enumerate(rows, _FIRST_DATA_ROW):
        rid = row.get("id", "").strip().upper()
        if not rid:
            _fail_row(row_errors, applied, "segments", row_num,
                      "'id' is empty — row skipped")
            continue
        file_ids.add(rid)

        if mode == "add_only" and rid in existing:
            applied["skipped"] += 1
            continue

        try:
            lat_raw = (row.get("latency") or "").strip()
            seg_verif_raw = row.get("verification_status", "").strip()
            ex_seg = existing.get(rid)
            seg_verif = seg_verif_raw if seg_verif_raw in VALID_VERIF_STATUS else (
                _enum_val(ex_seg.verification_status) if ex_seg and ex_seg.verification_status else "draft"
            )
            seg_last_verified = row.get("last_verified_date", "").strip() or (
                ex_seg.last_verified_date if ex_seg else None
            )
            seg = _merged(CableSegment, ex_seg, {
                "id": rid, "name": row.get("name", "").strip(),
                "system_id": row.get("system_id", "").strip(),
                "start_node_id": row.get("start_node_id", "").strip(),
                "end_node_id": row.get("end_node_id", "").strip(),
                "type": row.get("type", "wet").strip(),
                "length_km": float(row.get("length_km", 0) or 0),
                "latency": float(lat_raw) if lat_raw else None,
                "reliability": float(row.get("reliability", 1) or 1),
                "cost_weight": float(row.get("cost_weight", 1) or 1),
                "ownership": row.get("ownership", "offnet_resell").strip(),
                "waypoints": ex_seg.waypoints if ex_seg else None,
                "verification_status": seg_verif,
                "last_verified_date": seg_last_verified or None,
            })
        except Exception as exc:
            # Finding #9: report the discarded row instead of swallowing it.
            _fail_row(row_errors, applied, "segments", row_num, f"id '{rid}': {exc}")
            continue

        if rid in existing:
            applied["modified"] += 1
        else:
            applied["added"] += 1
        updated[rid] = seg

    _apply_deletions(updated, set(existing), file_ids, mode, applied)
    save_segments(list(updated.values()))
    return _import_result("segments", mode, applied, row_errors)


@router.post("/import/systems")
def import_systems(file: UploadFile = File(...), mode: BulkMode = Query("upsert")):
    rows = _read_csv(file)
    existing = {s.id: s for s in load_systems()}
    updated  = dict(existing)
    applied  = {"added": 0, "modified": 0, "unchanged": 0, "deleted": 0,
                "skipped": 0, "failed": 0}
    row_errors: list[dict] = []
    file_ids: set[str] = set()

    # Finding #9: row numbers include the header offset (row 1 = header).
    for row_num, row in enumerate(rows, _FIRST_DATA_ROW):
        rid = row.get("id", "").strip().upper()
        if not rid:
            _fail_row(row_errors, applied, "systems", row_num,
                      "'id' is empty — row skipped")
            continue
        file_ids.add(rid)

        if mode == "add_only" and rid in existing:
            applied["skipped"] += 1
            continue

        try:
            margin_raw = (row.get("margin") or "").strip()
            sys = _merged(CableSystem, existing.get(rid), {
                "id": rid, "name": row.get("name", "").strip(),
                "description": row.get("description", "").strip(),
                "margin": float(margin_raw) if margin_raw else None,
            })
        except Exception as exc:
            # Finding #9: report the discarded row instead of swallowing it.
            _fail_row(row_errors, applied, "systems", row_num, f"id '{rid}': {exc}")
            continue

        if rid in existing:
            applied["modified"] += 1
        else:
            applied["added"] += 1
        updated[rid] = sys

    _apply_deletions(updated, set(existing), file_ids, mode, applied)
    save_systems(list(updated.values()))
    return _import_result("systems", mode, applied, row_errors)


@router.post("/import/capacity")
def import_capacity(file: UploadFile = File(...), mode: BulkMode = Query("upsert")):
    rows = _read_csv(file)
    existing = {c.segment_id: c for c in load_capacity()}
    updated  = dict(existing)
    applied  = {"added": 0, "modified": 0, "unchanged": 0, "deleted": 0,
                "skipped": 0, "failed": 0}
    row_errors: list[dict] = []
    file_ids: set[str] = set()

    # Finding #9: row numbers include the header offset (row 1 = header).
    for row_num, row in enumerate(rows, _FIRST_DATA_ROW):
        rid = row.get("segment_id", "").strip().upper()
        if not rid:
            _fail_row(row_errors, applied, "capacity", row_num,
                      "'segment_id' is empty — row skipped")
            continue
        file_ids.add(rid)

        if mode == "add_only" and rid in existing:
            applied["skipped"] += 1
            continue

        try:
            cap = SegmentCapacity(
                segment_id=rid,
                total_capacity_t=float(row.get("total_capacity_t", 0) or 0),
                available_capacity_t=float(row.get("available_capacity_t", 0) or 0),
            )
        except Exception as exc:
            # Finding #9: report the discarded row instead of swallowing it.
            _fail_row(row_errors, applied, "capacity", row_num,
                      f"segment_id '{rid}': {exc}")
            continue

        if rid in existing:
            applied["modified"] += 1
        else:
            applied["added"] += 1
        updated[rid] = cap

    _apply_deletions(updated, set(existing), file_ids, mode, applied)
    save_capacity(list(updated.values()))
    return _import_result("capacity", mode, applied, row_errors)


@router.post("/import/coverage")
def import_coverage(file: UploadFile = File(...), mode: BulkMode = Query("upsert")):
    rows = _read_csv(file)
    nodes_list = load_nodes()
    by_id = {n.id: n for n in nodes_list}
    applied = {"added": 0, "modified": 0, "unchanged": 0, "deleted": 0,
               "skipped": 0, "failed": 0}
    row_errors: list[dict] = []

    # Finding #9: row numbers include the header offset (row 1 = header).
    for row_num, row in enumerate(rows, _FIRST_DATA_ROW):
        rid = row.get("node_id", "").strip().upper()
        if not rid:
            _fail_row(row_errors, applied, "coverage", row_num,
                      "'node_id' is empty — row skipped")
            continue
        if rid not in by_id:
            # Finding #9: unknown node used to be dropped without a trace.
            _fail_row(row_errors, applied, "coverage", row_num,
                      f"node_id '{rid}' not found in Nodes — row skipped")
            continue

        def sp(field: str) -> list[str]:
            raw = (row.get(field) or "").strip()
            return [s.strip() for s in raw.split(",") if s.strip()] if raw else []

        cat_raw = (row.get("colocation_category") or "").strip()
        if cat_raw and not cat_raw.isdigit():
            # Finding #9: previously coerced to None, silently wiping colocation.
            _fail_row(row_errors, applied, "coverage", row_num,
                      f"node_id '{rid}': colocation_category '{cat_raw}' is not an "
                      "integer 1-5 — row skipped")
            continue
        cat_val = int(cat_raw) if cat_raw else None

        ipt  = sp("ipt_speeds");  epl  = sp("epl_speeds");  evpl = sp("evpl_speeds")
        gid  = sp("gid_speeds");  ipvpn = sp("ipvpn_speeds")

        try:
            backbone   = BackboneCapabilities(ipt=ipt or None, epl=epl or None, evpl=evpl or None) if any([ipt, epl, evpl]) else None
            underlay   = UnderlayCapabilities(gid=gid or None, ipvpn=ipvpn or None)                if any([gid, ipvpn])    else None
            colocation = ColocationCapabilities(category=cat_val)                                  if cat_val              else None
            new_cap    = NodeCapabilities(backbone=backbone, underlay=underlay, colocation=colocation) if any([backbone, underlay, colocation]) else None

            # A coverage CSV changes ONE field. Everything else about the node
            # must survive untouched — the old reconstruction listed nine fields
            # and silently wiped city, street_address, verification_status,
            # last_verified_date, on_net and the RFS/EOL lifecycle dates.
            new_n = _merged(Node, by_id[rid], {"capabilities": new_cap})
        except Exception as exc:
            # Finding #9: report the discarded row instead of swallowing it.
            _fail_row(row_errors, applied, "coverage", row_num,
                      f"node_id '{rid}': {exc}")
            continue

        by_id[rid] = new_n
        applied["modified"] += 1

    save_nodes(list(by_id.values()))
    return _import_result("coverage", mode, applied, row_errors)
