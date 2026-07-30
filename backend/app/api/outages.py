# ─────────────────────────────────────────────────────────────────────────────
# outages.py — CRUD for cable outages AND planned events on segments.
#
# Route prefix: /api/outages  (this router has no prefix of its own; the paths
# below start with "/outages", and main.py mounts the router under "/api").
#
# Domain: this table holds two kinds of time-bound segment event, distinguished
# by `event_type`:
#   - "outage"        — a cable fault: a segment that is CURRENTLY down. The
#                        route-search pathfinder reads the set of outaged
#                        segment_ids so it can avoid routing traffic over
#                        broken cables.
#   - "planned_event"  — a FUTURE scheduled work window (e.g. a maintenance
#                        window) that MAY take a segment down later. Purely
#                        informational: it must never affect route search (see
#                        app/api/routes.py, which filters to event_type ==
#                        "outage" before building the avoidance set).
# Each record is a SegmentOutage keyed by a fault_id and references the
# affected segment_id.
#
# Endpoints:
#   GET    /api/outages                          — list all records (both types).
#   POST   /api/outages                           — record a new outage or planned event.
#   PUT    /api/outages?event_type=outage|planned_event
#                                                  — REPLACE all records of just that
#                                                    type (bulk); the other type's
#                                                    records are left untouched.
#   PUT    /api/outages/{fault_id}                — patch a record.
#   DELETE /api/outages/{fault_id}                — clear/delete a record.
# ─────────────────────────────────────────────────────────────────────────────
from fastapi import APIRouter, HTTPException
from ..data_loader import load_outages, save_outages
from ..models import SegmentOutage, SegmentOutageUpdate

router = APIRouter()


@router.put("/outages", response_model=list[SegmentOutage])
def replace_all_outages(entries: list[SegmentOutage], event_type: str = "outage"):
    """PUT /api/outages?event_type=outage|planned_event — replace only the
    records of the given type, leaving the other type's records untouched.

    Destructive bulk operation, but TYPE-SCOPED: since outages and planned
    events share this one table, a full-table wipe would delete the other
    type's records as a side effect of parsing/replacing this one. Instead we
    load everything, keep every record whose event_type differs from the one
    requested, and splice in `entries` (filtered to the same event_type, as a
    safety net against a caller sending mixed-type rows) in place of the old
    ones of that type. This backs the Outage Parser's "Accept All & Replace"
    flow, where a freshly parsed table supersedes the current fault list OR
    the current planned-event list — never both.

    Params:
      - event_type (query, default "outage"): which type's records to replace.
      - request body: a JSON array of SegmentOutage objects (only entries
        matching `event_type` are kept; others are silently dropped).
    Response: the stored array for this type (echoes what was saved).

    Auth: requires the x-admin-token header when ADMIN_KEY is set — enforced
    centrally by the admin_write_guard middleware in app/main.py, not here.
    """
    existing = load_outages()
    kept = [o for o in existing if o.event_type != event_type]
    incoming = [e for e in entries if e.event_type == event_type]
    save_outages(kept + incoming)
    return incoming


@router.get("/outages", response_model=list[SegmentOutage])
def get_outages():
    """GET /api/outages — list all recorded cable outages.

    Params: none.
    Response: a JSON array of SegmentOutage objects (each with a fault_id and
    the affected segment_id).

    Auth: public read endpoint; no token required.
    """
    return load_outages()


@router.post("/outages", response_model=SegmentOutage, status_code=201)
def create_outage(entry: SegmentOutage):
    """POST /api/outages — record a new cable outage.

    Params: request body is a SegmentOutage (fault_id, segment_id, ...).
    Response: the created SegmentOutage (HTTP 201). Returns HTTP 409 if an
    outage with the same fault_id already exists.

    Auth: requires the x-admin-token header when ADMIN_KEY is set — enforced
    centrally by the admin_write_guard middleware in app/main.py, not here.
    """
    outages = load_outages()
    # fault_id is the unique key for an outage record.
    if any(o.fault_id == entry.fault_id for o in outages):
        raise HTTPException(status_code=409, detail=f"Outage with fault_id '{entry.fault_id}' already exists")
    outages.append(entry)
    save_outages(outages)
    return entry


@router.put("/outages/{fault_id}", response_model=SegmentOutage)
def update_outage(fault_id: str, updates: SegmentOutageUpdate):
    """PUT /api/outages/{fault_id} — partially update an outage record.

    Params:
      - fault_id (path): which outage to update.
      - request body: a SegmentOutageUpdate with only the fields to change.
    Response: the updated SegmentOutage. Returns HTTP 404 if the fault_id is
    unknown.

    Auth: requires the x-admin-token header when ADMIN_KEY is set — enforced
    centrally by the admin_write_guard middleware in app/main.py, not here.
    """
    outages = load_outages()
    for i, o in enumerate(outages):
        if o.fault_id == fault_id:
            # Merge only supplied fields onto the existing record.
            updated = o.model_copy(update=updates.model_dump(exclude_unset=True))
            outages[i] = updated
            save_outages(outages)
            return updated
    raise HTTPException(status_code=404, detail=f"Outage with fault_id '{fault_id}' not found")


@router.delete("/outages/{fault_id}", status_code=204)
def delete_outage(fault_id: str):
    """DELETE /api/outages/{fault_id} — clear (delete) an outage record.

    Use this when a fault is repaired so the affected segment becomes routable
    again.

    Params: fault_id (path) — which outage to remove.
    Response: empty body, HTTP 204 on success. Returns HTTP 404 if unknown.

    Auth: requires the x-admin-token header when ADMIN_KEY is set — enforced
    centrally by the admin_write_guard middleware in app/main.py, not here.
    """
    outages = load_outages()
    new_outages = [o for o in outages if o.fault_id != fault_id]
    # No rows removed => fault_id did not exist.
    if len(new_outages) == len(outages):
        raise HTTPException(status_code=404, detail=f"Outage with fault_id '{fault_id}' not found")
    save_outages(new_outages)
