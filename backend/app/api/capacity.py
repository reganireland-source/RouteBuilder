# ─────────────────────────────────────────────────────────────────────────────
# capacity.py — CRUD for per-segment spectrum/wavelength capacity.
#
# Route prefix: /api/capacity  (this router has no prefix of its own; the paths
# below already start with "/capacity", and main.py mounts the router under
# "/api").
#
# Domain: "capacity" = how much bandwidth (available spectrum / wavelengths,
# measured in Tbps here) exists on a cable segment. A "segment" is one cable hop
# between two nodes. Each capacity record is keyed by its segment_id (one record
# per segment) and stores total_capacity_t and available_capacity_t. The
# route-search pathfinder reads this to know which segments can carry a circuit.
#
# Endpoints:
#   GET    /api/capacity                — list every segment's capacity record.
#   POST   /api/capacity                — create a capacity record for a segment.
#   PUT    /api/capacity/{segment_id}   — patch an existing capacity record.
#   DELETE /api/capacity/{segment_id}   — remove a capacity record.
# ─────────────────────────────────────────────────────────────────────────────
from fastapi import APIRouter, HTTPException
from ..data_loader import load_capacity, save_capacity
from ..models import SegmentCapacity, SegmentCapacityUpdate

router = APIRouter()


@router.get("/capacity", response_model=list[SegmentCapacity])
def get_capacity():
    """GET /api/capacity — list all segment capacity records.

    Params: none.
    Response: a JSON array of SegmentCapacity objects, one per segment that has
    a capacity record (segment_id, total_capacity_t, available_capacity_t).

    Auth: public read endpoint; no token required.
    """
    return load_capacity()


@router.post("/capacity", response_model=SegmentCapacity, status_code=201)
def create_capacity(entry: SegmentCapacity):
    """POST /api/capacity — create a capacity record for one segment.

    Params: request body is a SegmentCapacity JSON object (segment_id plus the
    total/available Tbps figures).
    Response: the created SegmentCapacity (HTTP 201). Returns HTTP 409 if a
    record for that segment_id already exists (capacity is one-per-segment).

    Auth: requires the x-admin-token header when ADMIN_KEY is set — enforced
    centrally by the admin_write_guard middleware in app/main.py, not here.
    """
    capacity = load_capacity()
    # Reject duplicates: capacity is keyed by segment_id, one record per segment.
    if any(c.segment_id == entry.segment_id for c in capacity):
        raise HTTPException(status_code=409, detail=f"Capacity entry for '{entry.segment_id}' already exists")
    capacity.append(entry)
    save_capacity(capacity)
    return entry


@router.put("/capacity/{segment_id}", response_model=SegmentCapacity)
def update_capacity(segment_id: str, updates: SegmentCapacityUpdate):
    """PUT /api/capacity/{segment_id} — partially update a capacity record.

    Params:
      - segment_id (path): which segment's capacity record to update.
      - request body: a SegmentCapacityUpdate with only the fields to change.
    Response: the updated SegmentCapacity. Returns HTTP 404 if no record exists
    for that segment_id.

    Auth: requires the x-admin-token header when ADMIN_KEY is set — enforced
    centrally by the admin_write_guard middleware in app/main.py, not here.
    """
    capacity = load_capacity()
    for i, cap in enumerate(capacity):
        if cap.segment_id == segment_id:
            # Merge only the explicitly-supplied fields (exclude_unset) onto the
            # existing record so omitted fields keep their current values.
            updated = cap.model_copy(update=updates.model_dump(exclude_unset=True))
            capacity[i] = updated
            save_capacity(capacity)
            return updated
    raise HTTPException(status_code=404, detail=f"Capacity entry for '{segment_id}' not found")


@router.delete("/capacity/{segment_id}", status_code=204)
def delete_capacity(segment_id: str):
    """DELETE /api/capacity/{segment_id} — delete a segment's capacity record.

    Params: segment_id (path) — which record to remove.
    Response: empty body, HTTP 204 on success. Returns HTTP 404 if there was no
    record for that segment_id.

    Auth: requires the x-admin-token header when ADMIN_KEY is set — enforced
    centrally by the admin_write_guard middleware in app/main.py, not here.
    """
    capacity = load_capacity()
    new_capacity = [c for c in capacity if c.segment_id != segment_id]
    # If nothing was filtered out, the id did not exist — surface a 404.
    if len(new_capacity) == len(capacity):
        raise HTTPException(status_code=404, detail=f"Capacity entry for '{segment_id}' not found")
    save_capacity(new_capacity)
