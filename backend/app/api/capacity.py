from fastapi import APIRouter, HTTPException
from ..data_loader import load_capacity, save_capacity
from ..models import SegmentCapacity, SegmentCapacityUpdate

router = APIRouter()


@router.get("/capacity", response_model=list[SegmentCapacity])
def get_capacity():
    return load_capacity()


@router.post("/capacity", response_model=SegmentCapacity, status_code=201)
def create_capacity(entry: SegmentCapacity):
    capacity = load_capacity()
    if any(c.segment_id == entry.segment_id for c in capacity):
        raise HTTPException(status_code=409, detail=f"Capacity entry for '{entry.segment_id}' already exists")
    capacity.append(entry)
    save_capacity(capacity)
    return entry


@router.put("/capacity/{segment_id}", response_model=SegmentCapacity)
def update_capacity(segment_id: str, updates: SegmentCapacityUpdate):
    capacity = load_capacity()
    for i, cap in enumerate(capacity):
        if cap.segment_id == segment_id:
            updated = cap.model_copy(update=updates.model_dump(exclude_unset=True))
            capacity[i] = updated
            save_capacity(capacity)
            return updated
    raise HTTPException(status_code=404, detail=f"Capacity entry for '{segment_id}' not found")


@router.delete("/capacity/{segment_id}", status_code=204)
def delete_capacity(segment_id: str):
    capacity = load_capacity()
    new_capacity = [c for c in capacity if c.segment_id != segment_id]
    if len(new_capacity) == len(capacity):
        raise HTTPException(status_code=404, detail=f"Capacity entry for '{segment_id}' not found")
    save_capacity(new_capacity)
