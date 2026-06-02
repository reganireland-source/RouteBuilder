from fastapi import APIRouter, HTTPException
from ..models import InterfaceType, InterfaceTypeUpdate
from ..data_loader import load_interfaces, save_interfaces

router = APIRouter(prefix="/interfaces", tags=["interfaces"])


@router.get("", response_model=list[InterfaceType])
def get_interfaces():
    return load_interfaces()


@router.post("", response_model=InterfaceType, status_code=201)
def create_interface(iface: InterfaceType):
    interfaces = load_interfaces()
    if any(i.id == iface.id for i in interfaces):
        raise HTTPException(status_code=409, detail=f"Interface '{iface.id}' already exists")
    interfaces.append(iface)
    save_interfaces(interfaces)
    return iface


@router.put("/{iface_id}", response_model=InterfaceType)
def update_interface(iface_id: str, updates: InterfaceTypeUpdate):
    interfaces = load_interfaces()
    for i, iface in enumerate(interfaces):
        if iface.id == iface_id:
            updated = iface.model_copy(update=updates.model_dump(exclude_unset=True))
            interfaces[i] = updated
            save_interfaces(interfaces)
            return updated
    raise HTTPException(status_code=404, detail=f"Interface '{iface_id}' not found")


@router.delete("/{iface_id}", status_code=204)
def delete_interface(iface_id: str):
    interfaces = load_interfaces()
    new_interfaces = [i for i in interfaces if i.id != iface_id]
    if len(new_interfaces) == len(interfaces):
        raise HTTPException(status_code=404, detail=f"Interface '{iface_id}' not found")
    save_interfaces(new_interfaces)
