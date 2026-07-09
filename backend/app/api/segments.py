# ─────────────────────────────────────────────────────────────────────────────
# segments.py — CRUD for segments (the cable hops that connect nodes).
#
# Route prefix: /api/segments  (this router has prefix="/segments"; main.py
# mounts it under "/api", so the paths are /api/segments...).
#
# Domain: a "segment" is one cable hop between two nodes — the edges of the
# routing graph. type is "wet" (submarine cable) or "terrestrial" (over land).
# A segment usually belongs to a "system" (a named submarine cable such as EAC
# or C2C) via system_id, and carries routing weights (length_km, latency,
# reliability, cost_weight) and an ownership type. IDs are normalised on write
# via normalize_id.
#
# Endpoints:
#   GET    /api/segments               — list all segments.
#   POST   /api/segments               — create a segment.
#   PUT    /api/segments/{segment_id}  — patch a segment.
#   DELETE /api/segments/{segment_id}  — delete a segment.
# ─────────────────────────────────────────────────────────────────────────────
from fastapi import APIRouter, HTTPException
from ..models import CableSegment, CableSegmentUpdate
from ..data_loader import load_segments, save_segments
from ..id_utils import normalize_id

router = APIRouter(prefix="/segments", tags=["segments"])


@router.get("", response_model=list[CableSegment])
def get_segments():
    """GET /api/segments — list all cable segments.

    Params: none.
    Response: a JSON array of CableSegment objects (the graph edges).

    Auth: public read endpoint; no token required.
    """
    return load_segments()


@router.post("", response_model=CableSegment, status_code=201)
def create_segment(segment: CableSegment):
    """POST /api/segments — create a new cable segment.

    Params: request body is a CableSegment (id, system_id, start/end node ids,
    type wet|terrestrial, routing weights, ...).
    Response: the created CableSegment (HTTP 201). Returns HTTP 409 if the
    (normalised) id already exists.

    Auth: requires the x-admin-token header when ADMIN_KEY is set — enforced
    centrally by the admin_write_guard middleware in app/main.py, not here.
    """
    # Normalise the id before the uniqueness check (same as nodes/systems).
    segment = segment.model_copy(update={"id": normalize_id(segment.id, "segment")})
    segments = load_segments()
    if any(s.id == segment.id for s in segments):
        raise HTTPException(status_code=409, detail=f"Segment '{segment.id}' already exists")
    segments.append(segment)
    save_segments(segments)
    return segment


@router.put("/{segment_id}", response_model=CableSegment)
def update_segment(segment_id: str, updates: CableSegmentUpdate):
    """PUT /api/segments/{segment_id} — partially update a segment.

    Params:
      - segment_id (path): which segment to update.
      - request body: a CableSegmentUpdate with only the fields to change.
    Response: the updated CableSegment. Returns HTTP 404 if unknown.

    Auth: requires the x-admin-token header when ADMIN_KEY is set — enforced
    centrally by the admin_write_guard middleware in app/main.py, not here.
    """
    segments = load_segments()
    for i, seg in enumerate(segments):
        if seg.id == segment_id:
            # Merge only supplied fields onto the existing segment.
            updated = seg.model_copy(update=updates.model_dump(exclude_unset=True))
            segments[i] = updated
            save_segments(segments)
            return updated
    raise HTTPException(status_code=404, detail=f"Segment '{segment_id}' not found")


@router.delete("/{segment_id}", status_code=204)
def delete_segment(segment_id: str):
    """DELETE /api/segments/{segment_id} — delete a segment.

    Params: segment_id (path) — which segment to remove.
    Response: empty body, HTTP 204 on success. Returns HTTP 404 if unknown.

    Auth: requires the x-admin-token header when ADMIN_KEY is set — enforced
    centrally by the admin_write_guard middleware in app/main.py, not here.
    """
    segments = load_segments()
    new_segments = [s for s in segments if s.id != segment_id]
    # No rows removed => id did not exist.
    if len(new_segments) == len(segments):
        raise HTTPException(status_code=404, detail=f"Segment '{segment_id}' not found")
    save_segments(new_segments)
