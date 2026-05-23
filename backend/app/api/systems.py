from fastapi import APIRouter, HTTPException
from ..models import CableSystem, CableSystemUpdate
from ..data_loader import load_systems, save_systems

router = APIRouter(prefix="/systems", tags=["systems"])


@router.get("", response_model=list[CableSystem])
def get_systems():
    return load_systems()


@router.post("", response_model=CableSystem, status_code=201)
def create_system(system: CableSystem):
    systems = load_systems()
    if any(s.id == system.id for s in systems):
        raise HTTPException(status_code=409, detail=f"System '{system.id}' already exists")
    systems.append(system)
    save_systems(systems)
    return system


@router.put("/{system_id}", response_model=CableSystem)
def update_system(system_id: str, updates: CableSystemUpdate):
    systems = load_systems()
    for i, sys in enumerate(systems):
        if sys.id == system_id:
            updated = sys.model_copy(update=updates.model_dump(exclude_unset=True))
            systems[i] = updated
            save_systems(systems)
            return updated
    raise HTTPException(status_code=404, detail=f"System '{system_id}' not found")


@router.delete("/{system_id}", status_code=204)
def delete_system(system_id: str):
    systems = load_systems()
    new_systems = [s for s in systems if s.id != system_id]
    if len(new_systems) == len(systems):
        raise HTTPException(status_code=404, detail=f"System '{system_id}' not found")
    save_systems(new_systems)
