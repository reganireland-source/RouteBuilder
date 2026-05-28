"""Bulk CSV import / export for reference data tables."""
import csv
import io
import json
from typing import Any, Literal

from fastapi import APIRouter, File, Query, UploadFile
from fastapi.responses import StreamingResponse

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
    SegmentCapacity,
    UnderlayCapabilities,
)

router = APIRouter(prefix="/bulk", tags=["bulk"])

BulkMode = Literal["upsert", "add_only", "full_replace"]

# ── Column schemas ─────────────────────────────────────────────────────────────

NODE_COLS = [
    "id", "name", "lat", "lng", "type", "country", "owner", "trading_name", "description",
]
SEGMENT_COLS = [
    "id", "name", "system_id", "start_node_id", "end_node_id", "type",
    "length_km", "latency", "reliability", "cost_weight", "ownership",
]
SYSTEM_COLS   = ["id", "name", "description", "margin"]
CAPACITY_COLS = ["segment_id", "total_capacity_t", "available_capacity_t"]
COVERAGE_COLS = [
    "node_id", "ipt_speeds", "epl_speeds", "evpl_speeds",
    "gid_speeds", "ipvpn_speeds", "colocation_category",
]

VALID_NODE_TYPES = {"landing_station", "terrestrial_pop", "branching_unit"}
VALID_SEG_TYPES  = {"wet", "terrestrial"}
VALID_OWNERSHIPS = {"owned", "iru", "consortium", "integrated_lit_lease", "offnet_resell"}
VALID_BB_SPEEDS  = {"1G", "10G", "100G", "400G"}
VALID_UL_SPEEDS  = {"1G", "10G"}


# ── Shared helpers ─────────────────────────────────────────────────────────────

def _norm(v: Any) -> str:
    """Canonical string for diff comparison — normalises floats, None, empty."""
    if v is None or v == "" or v == []:
        return ""
    if isinstance(v, float):
        return f"{v:.8g}"
    if isinstance(v, list):
        return json.dumps(v, separators=(",", ":"))
    return str(v).strip()


def _changed_fields(new: dict, old: dict) -> list[str]:
    keys = set(new) | set(old)
    return [k for k in keys if _norm(new.get(k)) != _norm(old.get(k))]


def _err(row_num: int, id_: str, field: str, value: str, message: str) -> dict:
    return {"row_num": row_num, "id": id_, "field": field, "value": str(value)[:80], "message": message}


def _result(table: str, mode: str, errors: list, changes: list,
            total: int, added: int, modified: int, unchanged: int,
            deleted: int, kept: int) -> dict:
    return {
        "table": table,
        "mode": mode,
        "validation_errors": errors,
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


def _csv_stream(rows: list[dict], cols: list[str], filename: str) -> StreamingResponse:
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=cols, extrasaction="ignore")
    w.writeheader()
    w.writerows(rows)
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


async def _read_csv(file: UploadFile) -> list[dict]:
    raw = await file.read()
    text = raw.decode("utf-8-sig")  # strip BOM written by Excel
    return list(csv.DictReader(io.StringIO(text)))


def _enum_val(v: Any) -> str:
    return v.value if hasattr(v, "value") else str(v)


def _apply_deletions(updated: dict, existing_keys: set, file_ids: set, mode: str, applied: dict) -> None:
    if mode == "full_replace":
        for did in existing_keys - file_ids:
            updated.pop(did, None)
            applied["deleted"] = applied.get("deleted", 0) + 1


# ── Export ─────────────────────────────────────────────────────────────────────

@router.get("/export/nodes")
async def export_nodes():
    rows = []
    for n in load_nodes():
        rows.append({
            "id": n.id, "name": n.name, "lat": n.lat, "lng": n.lng,
            "type": _enum_val(n.type), "country": n.country, "owner": n.owner or "",
            "trading_name": n.trading_name or "", "description": n.description or "",
        })
    return _csv_stream(rows, NODE_COLS, "nodes.csv")


@router.get("/export/segments")
async def export_segments():
    rows = []
    for s in load_segments():
        rows.append({
            "id": s.id, "name": s.name, "system_id": s.system_id,
            "start_node_id": s.start_node_id, "end_node_id": s.end_node_id,
            "type": _enum_val(s.type), "length_km": s.length_km,
            "latency": s.latency if s.latency is not None else "",
            "reliability": s.reliability, "cost_weight": s.cost_weight,
            "ownership": _enum_val(s.ownership),
        })
    return _csv_stream(rows, SEGMENT_COLS, "segments.csv")


@router.get("/export/systems")
async def export_systems():
    rows = []
    for s in load_systems():
        rows.append({
            "id": s.id, "name": s.name, "description": s.description,
            "margin": s.margin if s.margin is not None else "",
        })
    return _csv_stream(rows, SYSTEM_COLS, "systems.csv")


@router.get("/export/capacity")
async def export_capacity():
    rows = []
    for c in load_capacity():
        rows.append({
            "segment_id": c.segment_id,
            "total_capacity_t": c.total_capacity_t,
            "available_capacity_t": c.available_capacity_t,
        })
    return _csv_stream(rows, CAPACITY_COLS, "capacity.csv")


@router.get("/export/coverage")
async def export_coverage():
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
async def validate_nodes(file: UploadFile = File(...), mode: BulkMode = Query("upsert")):
    rows = await _read_csv(file)
    existing = {n.id: n for n in load_nodes()}

    errors, changes = [], []
    seen: set[str] = set()
    added = modified = unchanged = 0

    for i, row in enumerate(rows, 1):
        rid = row.get("id", "").strip()
        if not rid:
            errors.append(_err(i, "", "id", "", "id is required"))
            continue
        if rid in seen:
            errors.append(_err(i, rid, "id", rid, f"Duplicate id '{rid}' in file"))
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

        try:
            new = {
                "id": rid, "name": row.get("name", "").strip(),
                "lat": float(row.get("lat", 0) or 0), "lng": float(row.get("lng", 0) or 0),
                "type": ntype, "country": row.get("country", "").strip().upper(),
                "owner": (row.get("owner") or "Telstra").strip(),
                "trading_name": row.get("trading_name", "").strip() or None,
                "description":  row.get("description", "").strip() or None,
            }
        except Exception:
            continue

        if rid in existing:
            ex = existing[rid]
            old = {
                "id": ex.id, "name": ex.name, "lat": ex.lat, "lng": ex.lng,
                "type": _enum_val(ex.type), "country": ex.country, "owner": ex.owner,
                "trading_name": ex.trading_name, "description": ex.description,
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

    return _result("nodes", mode, errors, changes, len(rows), added, modified, unchanged, deleted, kept)


@router.post("/validate/segments")
async def validate_segments(file: UploadFile = File(...), mode: BulkMode = Query("upsert")):
    rows = await _read_csv(file)
    existing = {s.id: s for s in load_segments()}
    node_ids = {n.id for n in load_nodes()}
    sys_ids  = {s.id for s in load_systems()}

    errors, changes = [], []
    seen: set[str] = set()
    added = modified = unchanged = 0

    for i, row in enumerate(rows, 1):
        rid = row.get("id", "").strip()
        if not rid:
            errors.append(_err(i, "", "id", "", "id is required"))
            continue
        if rid in seen:
            errors.append(_err(i, rid, "id", rid, f"Duplicate id '{rid}' in file"))
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

    return _result("segments", mode, errors, changes, len(rows), added, modified, unchanged, deleted, kept)


@router.post("/validate/systems")
async def validate_systems(file: UploadFile = File(...), mode: BulkMode = Query("upsert")):
    rows = await _read_csv(file)
    existing = {s.id: s for s in load_systems()}

    errors, changes = [], []
    seen: set[str] = set()
    added = modified = unchanged = 0

    for i, row in enumerate(rows, 1):
        rid = row.get("id", "").strip()
        if not rid:
            errors.append(_err(i, "", "id", "", "id is required"))
            continue
        if rid in seen:
            errors.append(_err(i, rid, "id", rid, f"Duplicate id '{rid}' in file"))
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

    return _result("systems", mode, errors, changes, len(rows), added, modified, unchanged, deleted, kept)


@router.post("/validate/capacity")
async def validate_capacity(file: UploadFile = File(...), mode: BulkMode = Query("upsert")):
    rows = await _read_csv(file)
    existing = {c.segment_id: c for c in load_capacity()}
    seg_ids  = {s.id for s in load_segments()}

    errors, changes = [], []
    seen: set[str] = set()
    added = modified = unchanged = 0

    for i, row in enumerate(rows, 1):
        rid = row.get("segment_id", "").strip()
        if not rid:
            errors.append(_err(i, "", "segment_id", "", "segment_id is required"))
            continue
        if rid in seen:
            errors.append(_err(i, rid, "segment_id", rid, f"Duplicate segment_id '{rid}'"))
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

    return _result("capacity", mode, errors, changes, len(rows), added, modified, unchanged, deleted, kept)


@router.post("/validate/coverage")
async def validate_coverage(file: UploadFile = File(...), mode: BulkMode = Query("upsert")):
    rows = await _read_csv(file)
    existing = {n.id: n for n in load_nodes()}

    errors, changes = [], []
    seen: set[str] = set()
    modified = unchanged = 0

    for i, row in enumerate(rows, 1):
        rid = row.get("node_id", "").strip()
        if not rid:
            errors.append(_err(i, "", "node_id", "", "node_id is required"))
            continue
        if rid in seen:
            errors.append(_err(i, rid, "node_id", rid, f"Duplicate node_id '{rid}'"))
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

    return _result("coverage", mode, errors, changes, len(rows), 0, modified, unchanged, 0, 0)


# ── Import ─────────────────────────────────────────────────────────────────────

@router.post("/import/nodes")
async def import_nodes(file: UploadFile = File(...), mode: BulkMode = Query("upsert")):
    rows = await _read_csv(file)
    existing = {n.id: n for n in load_nodes()}
    updated  = dict(existing)
    applied  = {"added": 0, "modified": 0, "unchanged": 0, "deleted": 0, "skipped": 0}
    file_ids: set[str] = set()

    for row in rows:
        rid = row.get("id", "").strip()
        if not rid:
            continue
        file_ids.add(rid)

        if mode == "add_only" and rid in existing:
            applied["skipped"] += 1
            continue

        try:
            node = Node(
                id=rid, name=row.get("name", "").strip(),
                lat=float(row.get("lat", 0) or 0), lng=float(row.get("lng", 0) or 0),
                type=row.get("type", "landing_station").strip(),
                country=row.get("country", "").strip().upper(),
                owner=(row.get("owner") or "Telstra").strip(),
                trading_name=row.get("trading_name", "").strip() or None,
                description=row.get("description", "").strip() or None,
                capabilities=existing[rid].capabilities if rid in existing else None,
            )
        except Exception:
            continue

        if rid in existing:
            applied["modified"] += 1
        else:
            applied["added"] += 1
        updated[rid] = node

    _apply_deletions(updated, set(existing), file_ids, mode, applied)
    save_nodes(list(updated.values()))
    return {"status": "ok", "table": "nodes", "mode": mode, "applied": applied}


@router.post("/import/segments")
async def import_segments(file: UploadFile = File(...), mode: BulkMode = Query("upsert")):
    rows = await _read_csv(file)
    existing = {s.id: s for s in load_segments()}
    updated  = dict(existing)
    applied  = {"added": 0, "modified": 0, "unchanged": 0, "deleted": 0, "skipped": 0}
    file_ids: set[str] = set()

    for row in rows:
        rid = row.get("id", "").strip()
        if not rid:
            continue
        file_ids.add(rid)

        if mode == "add_only" and rid in existing:
            applied["skipped"] += 1
            continue

        try:
            lat_raw = (row.get("latency") or "").strip()
            seg = CableSegment(
                id=rid, name=row.get("name", "").strip(),
                system_id=row.get("system_id", "").strip(),
                start_node_id=row.get("start_node_id", "").strip(),
                end_node_id=row.get("end_node_id", "").strip(),
                type=row.get("type", "wet").strip(),
                length_km=float(row.get("length_km", 0) or 0),
                latency=float(lat_raw) if lat_raw else None,
                reliability=float(row.get("reliability", 1) or 1),
                cost_weight=float(row.get("cost_weight", 1) or 1),
                ownership=row.get("ownership", "offnet_resell").strip(),
                waypoints=existing[rid].waypoints if rid in existing else None,
            )
        except Exception:
            continue

        if rid in existing:
            applied["modified"] += 1
        else:
            applied["added"] += 1
        updated[rid] = seg

    _apply_deletions(updated, set(existing), file_ids, mode, applied)
    save_segments(list(updated.values()))
    return {"status": "ok", "table": "segments", "mode": mode, "applied": applied}


@router.post("/import/systems")
async def import_systems(file: UploadFile = File(...), mode: BulkMode = Query("upsert")):
    rows = await _read_csv(file)
    existing = {s.id: s for s in load_systems()}
    updated  = dict(existing)
    applied  = {"added": 0, "modified": 0, "unchanged": 0, "deleted": 0, "skipped": 0}
    file_ids: set[str] = set()

    for row in rows:
        rid = row.get("id", "").strip()
        if not rid:
            continue
        file_ids.add(rid)

        if mode == "add_only" and rid in existing:
            applied["skipped"] += 1
            continue

        try:
            margin_raw = (row.get("margin") or "").strip()
            sys = CableSystem(
                id=rid, name=row.get("name", "").strip(),
                description=row.get("description", "").strip(),
                margin=float(margin_raw) if margin_raw else None,
            )
        except Exception:
            continue

        if rid in existing:
            applied["modified"] += 1
        else:
            applied["added"] += 1
        updated[rid] = sys

    _apply_deletions(updated, set(existing), file_ids, mode, applied)
    save_systems(list(updated.values()))
    return {"status": "ok", "table": "systems", "mode": mode, "applied": applied}


@router.post("/import/capacity")
async def import_capacity(file: UploadFile = File(...), mode: BulkMode = Query("upsert")):
    rows = await _read_csv(file)
    existing = {c.segment_id: c for c in load_capacity()}
    updated  = dict(existing)
    applied  = {"added": 0, "modified": 0, "unchanged": 0, "deleted": 0, "skipped": 0}
    file_ids: set[str] = set()

    for row in rows:
        rid = row.get("segment_id", "").strip()
        if not rid:
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
        except Exception:
            continue

        if rid in existing:
            applied["modified"] += 1
        else:
            applied["added"] += 1
        updated[rid] = cap

    _apply_deletions(updated, set(existing), file_ids, mode, applied)
    save_capacity(list(updated.values()))
    return {"status": "ok", "table": "capacity", "mode": mode, "applied": applied}


@router.post("/import/coverage")
async def import_coverage(file: UploadFile = File(...), mode: BulkMode = Query("upsert")):
    rows = await _read_csv(file)
    nodes_list = load_nodes()
    by_id = {n.id: n for n in nodes_list}
    applied = {"added": 0, "modified": 0, "unchanged": 0, "deleted": 0, "skipped": 0}

    for row in rows:
        rid = row.get("node_id", "").strip()
        if not rid or rid not in by_id:
            continue

        def sp(field: str) -> list[str]:
            raw = (row.get(field) or "").strip()
            return [s.strip() for s in raw.split(",") if s.strip()] if raw else []

        cat_raw = (row.get("colocation_category") or "").strip()
        cat_val = int(cat_raw) if cat_raw and cat_raw.isdigit() else None

        ipt  = sp("ipt_speeds");  epl  = sp("epl_speeds");  evpl = sp("evpl_speeds")
        gid  = sp("gid_speeds");  ipvpn = sp("ipvpn_speeds")

        backbone   = BackboneCapabilities(ipt=ipt or None, epl=epl or None, evpl=evpl or None) if any([ipt, epl, evpl]) else None
        underlay   = UnderlayCapabilities(gid=gid or None, ipvpn=ipvpn or None)                if any([gid, ipvpn])    else None
        colocation = ColocationCapabilities(category=cat_val)                                  if cat_val              else None
        new_cap    = NodeCapabilities(backbone=backbone, underlay=underlay, colocation=colocation) if any([backbone, underlay, colocation]) else None

        old_n = by_id[rid]
        by_id[rid] = Node(
            id=old_n.id, name=old_n.name, lat=old_n.lat, lng=old_n.lng,
            type=old_n.type, country=old_n.country, owner=old_n.owner,
            trading_name=old_n.trading_name, description=old_n.description,
            capabilities=new_cap,
        )
        applied["modified"] += 1

    save_nodes(list(by_id.values()))
    return {"status": "ok", "table": "coverage", "mode": mode, "applied": applied}
