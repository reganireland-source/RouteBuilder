from fastapi import APIRouter, HTTPException
from ..data_loader import load_outages, save_outages
from ..models import SegmentOutage, SegmentOutageUpdate

router = APIRouter()


@router.get("/outages", response_model=list[SegmentOutage])
def get_outages():
    return load_outages()


@router.post("/outages", response_model=SegmentOutage, status_code=201)
def create_outage(entry: SegmentOutage):
    outages = load_outages()
    if any(o.fault_id == entry.fault_id for o in outages):
        raise HTTPException(status_code=409, detail=f"Outage with fault_id '{entry.fault_id}' already exists")
    outages.append(entry)
    save_outages(outages)
    return entry


@router.put("/outages/{fault_id}", response_model=SegmentOutage)
def update_outage(fault_id: str, updates: SegmentOutageUpdate):
    outages = load_outages()
    for i, o in enumerate(outages):
        if o.fault_id == fault_id:
            updated = o.model_copy(update=updates.model_dump(exclude_unset=True))
            outages[i] = updated
            save_outages(outages)
            return updated
    raise HTTPException(status_code=404, detail=f"Outage with fault_id '{fault_id}' not found")


@router.delete("/outages/{fault_id}", status_code=204)
def delete_outage(fault_id: str):
    outages = load_outages()
    new_outages = [o for o in outages if o.fault_id != fault_id]
    if len(new_outages) == len(outages):
        raise HTTPException(status_code=404, detail=f"Outage with fault_id '{fault_id}' not found")
    save_outages(new_outages)
