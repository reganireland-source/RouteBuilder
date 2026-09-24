# ─────────────────────────────────────────────────────────────────────────────
# interfaces.py — CRUD for interface types (a reference/lookup list).
#
# Route prefix: /api/interfaces  (this router has prefix="/interfaces"; main.py
# mounts it under "/api", so the paths are /api/interfaces...).
#
# Domain: "interface types" are a small editable catalogue of physical/optical
# interface options (e.g. the port/handoff types offered on equipment) that the
# solution-design UI uses to populate dropdowns. Each record is an InterfaceType
# keyed by its id. Standard list/create/update/delete CRUD, backed by
# load_interfaces/save_interfaces.
#
# Endpoints:
#   GET    /api/interfaces             — list all interface types.
#   POST   /api/interfaces             — create an interface type.
#   PUT    /api/interfaces/{iface_id}  — patch an interface type.
#   DELETE /api/interfaces/{iface_id}  — delete an interface type.
# ─────────────────────────────────────────────────────────────────────────────
from fastapi import APIRouter, HTTPException
from ..models import InterfaceType, InterfaceTypeUpdate
from ..data_loader import load_interfaces, save_interfaces

router = APIRouter(prefix="/interfaces", tags=["interfaces"])


@router.get("", response_model=list[InterfaceType])
def get_interfaces():
    """GET /api/interfaces — list all interface types.

    Params: none.
    Response: a JSON array of InterfaceType objects.

    Auth: public read endpoint; no token required.
    """
    return load_interfaces()


@router.post("", response_model=InterfaceType, status_code=201)
def create_interface(iface: InterfaceType):
    """POST /api/interfaces — create a new interface type.

    Params: request body is an InterfaceType (includes its id).
    Response: the created InterfaceType (HTTP 201). Returns HTTP 409 if an
    interface with the same id already exists.

    Auth: requires the x-admin-token header when ADMIN_KEY is set — enforced
    centrally by the admin_write_guard middleware in app/main.py, not here.
    """
    interfaces = load_interfaces()
    # Reject duplicate ids (ids are the primary key for this table).
    if any(i.id == iface.id for i in interfaces):
        raise HTTPException(status_code=409, detail=f"Interface '{iface.id}' already exists")
    interfaces.append(iface)
    save_interfaces(interfaces)
    return iface


@router.put("/{iface_id}", response_model=InterfaceType)
def update_interface(iface_id: str, updates: InterfaceTypeUpdate):
    """PUT /api/interfaces/{iface_id} — partially update an interface type.

    Params:
      - iface_id (path): which interface type to update.
      - request body: an InterfaceTypeUpdate with only the fields to change.
    Response: the updated InterfaceType. Returns HTTP 404 if the id is unknown.

    Auth: requires the x-admin-token header when ADMIN_KEY is set — enforced
    centrally by the admin_write_guard middleware in app/main.py, not here.
    """
    interfaces = load_interfaces()
    for i, iface in enumerate(interfaces):
        if iface.id == iface_id:
            # Merge only supplied fields onto the existing record.
            updated = iface.model_copy(update=updates.model_dump(exclude_unset=True))
            interfaces[i] = updated
            save_interfaces(interfaces)
            return updated
    raise HTTPException(status_code=404, detail=f"Interface '{iface_id}' not found")


@router.delete("/{iface_id}", status_code=204)
def delete_interface(iface_id: str):
    """DELETE /api/interfaces/{iface_id} — delete an interface type.

    Params: iface_id (path) — which interface type to remove.
    Response: empty body, HTTP 204 on success. Returns HTTP 404 if the id is
    unknown.

    Auth: requires the x-admin-token header when ADMIN_KEY is set — enforced
    centrally by the admin_write_guard middleware in app/main.py, not here.
    """
    interfaces = load_interfaces()
    new_interfaces = [i for i in interfaces if i.id != iface_id]
    # No rows removed => id did not exist.
    if len(new_interfaces) == len(interfaces):
        raise HTTPException(status_code=404, detail=f"Interface '{iface_id}' not found")
    save_interfaces(new_interfaces)
