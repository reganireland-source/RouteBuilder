# ─────────────────────────────────────────────────────────────────────────────
# systems.py — CRUD for cable systems (named submarine cables).
#
# Route prefix: /api/systems  (this router has prefix="/systems"; main.py mounts
# it under "/api", so the paths are /api/systems...).
#
# Domain: a "system" is a named submarine cable (e.g. EAC, C2C). Segments (cable
# hops) belong to a system via their system_id, and route searches can be
# constrained to include/avoid particular systems. Each CableSystem has an id,
# name, description, and an optional "margin". IDs are normalised on write via
# normalize_id.
#
# Endpoints:
#   GET    /api/systems              — list all cable systems.
#   POST   /api/systems              — create a cable system.
#   PUT    /api/systems/{system_id}  — patch a cable system.
#   DELETE /api/systems/{system_id}  — delete a cable system.
# ─────────────────────────────────────────────────────────────────────────────
from fastapi import APIRouter, HTTPException
from ..models import CableSystem, CableSystemUpdate
from ..data_loader import load_systems, save_systems
from ..id_utils import normalize_id

router = APIRouter(prefix="/systems", tags=["systems"])


@router.get("", response_model=list[CableSystem])
def get_systems():
    """GET /api/systems — list all cable systems.

    Params: none.
    Response: a JSON array of CableSystem objects.

    Auth: public read endpoint; no token required.
    """
    return load_systems()


@router.post("", response_model=CableSystem, status_code=201)
def create_system(system: CableSystem):
    """POST /api/systems — create a new cable system.

    Params: request body is a CableSystem (id, name, description, optional
    margin).
    Response: the created CableSystem (HTTP 201). Returns HTTP 409 if the
    (normalised) id already exists.

    Auth: requires the x-admin-token header when ADMIN_KEY is set — enforced
    centrally by the admin_write_guard middleware in app/main.py, not here.
    """
    # Normalise the id before the uniqueness check (same as nodes/segments).
    system = system.model_copy(update={"id": normalize_id(system.id, "system")})
    systems = load_systems()
    if any(s.id == system.id for s in systems):
        raise HTTPException(status_code=409, detail=f"System '{system.id}' already exists")
    systems.append(system)
    save_systems(systems)
    return system


@router.put("/{system_id}", response_model=CableSystem)
def update_system(system_id: str, updates: CableSystemUpdate):
    """PUT /api/systems/{system_id} — partially update a cable system.

    Params:
      - system_id (path): which system to update.
      - request body: a CableSystemUpdate with only the fields to change.
    Response: the updated CableSystem. Returns HTTP 404 if unknown.

    Auth: requires the x-admin-token header when ADMIN_KEY is set — enforced
    centrally by the admin_write_guard middleware in app/main.py, not here.
    """
    systems = load_systems()
    for i, sys in enumerate(systems):
        if sys.id == system_id:
            # Merge only supplied fields onto the existing system.
            updated = sys.model_copy(update=updates.model_dump(exclude_unset=True))
            systems[i] = updated
            save_systems(systems)
            return updated
    raise HTTPException(status_code=404, detail=f"System '{system_id}' not found")


@router.delete("/{system_id}", status_code=204)
def delete_system(system_id: str):
    """DELETE /api/systems/{system_id} — delete a cable system.

    Params: system_id (path) — which system to remove. Does not cascade to the
    segments that reference it; that consistency is surfaced by the
    /api/health/checks integrity checks.
    Response: empty body, HTTP 204 on success. Returns HTTP 404 if unknown.

    Auth: requires the x-admin-token header when ADMIN_KEY is set — enforced
    centrally by the admin_write_guard middleware in app/main.py, not here.
    """
    systems = load_systems()
    new_systems = [s for s in systems if s.id != system_id]
    # No rows removed => id did not exist.
    if len(new_systems) == len(systems):
        raise HTTPException(status_code=404, detail=f"System '{system_id}' not found")
    save_systems(new_systems)
