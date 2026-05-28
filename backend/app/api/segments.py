from fastapi import APIRouter, HTTPException
from ..models import CableSegment, CableSegmentUpdate
from ..data_loader import load_segments, save_segments
from ..id_utils import normalize_id

router = APIRouter(prefix="/segments", tags=["segments"])


@router.get("", response_model=list[CableSegment])
def get_segments():
    return load_segments()


@router.post("", response_model=CableSegment, status_code=201)
def create_segment(segment: CableSegment):
    segment = segment.model_copy(update={"id": normalize_id(segment.id, "segment")})
    segments = load_segments()
    if any(s.id == segment.id for s in segments):
        raise HTTPException(status_code=409, detail=f"Segment '{segment.id}' already exists")
    segments.append(segment)
    save_segments(segments)
    return segment


@router.put("/{segment_id}", response_model=CableSegment)
def update_segment(segment_id: str, updates: CableSegmentUpdate):
    segments = load_segments()
    for i, seg in enumerate(segments):
        if seg.id == segment_id:
            updated = seg.model_copy(update=updates.model_dump(exclude_unset=True))
            segments[i] = updated
            save_segments(segments)
            return updated
    raise HTTPException(status_code=404, detail=f"Segment '{segment_id}' not found")


@router.delete("/{segment_id}", status_code=204)
def delete_segment(segment_id: str):
    segments = load_segments()
    new_segments = [s for s in segments if s.id != segment_id]
    if len(new_segments) == len(segments):
        raise HTTPException(status_code=404, detail=f"Segment '{segment_id}' not found")
    save_segments(new_segments)
