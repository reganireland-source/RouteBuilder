# ─────────────────────────────────────────────────────────────────────────────
# outages.py — CRUD for cable outages (faults) on segments.
#
# Route prefix: /api/outages  (this router has no prefix of its own; the paths
# below start with "/outages", and main.py mounts the router under "/api").
#
# Domain: an "outage" is a cable fault — a segment that is currently down. Each
# record is a SegmentOutage keyed by a fault_id and references the affected
# segment_id. The route-search pathfinder reads the set of outaged segment_ids
# so it can avoid routing traffic over broken cables.
#
# Endpoints:
#   GET    /api/outages             — list all outages.
#   POST   /api/outages             — record a new outage.
#   PUT    /api/outages             — REPLACE the whole outage set (bulk).
#   PUT    /api/outages/{fault_id}  — patch an outage.
#   DELETE /api/outages/{fault_id}  — clear/delete an outage.
# ─────────────────────────────────────────────────────────────────────────────
from fastapi import APIRouter, HTTPException
from ..data_loader import load_outages, save_outages
from ..models import SegmentOutage, SegmentOutageUpdate

router = APIRouter()


@router.put("/outages", response_model=list[SegmentOutage])
def replace_all_outages(entries: list[SegmentOutage]):
    """PUT /api/outages — replace the ENTIRE outage set in one call.

    Destructive bulk operation: every existing outage is discarded and replaced
    by `entries`. This backs the Outage Parser's "Accept All & Replace" flow,
    where a freshly parsed table supersedes the whole current fault list.

    Params: request body is a JSON array of SegmentOutage objects.
    Response: the stored array (echoes what was saved).

    Auth: requires the x-admin-token header when ADMIN_KEY is set — enforced
    centrally by the admin_write_guard middleware in app/main.py, not here.
    """
    save_outages(entries)
    return entries


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
