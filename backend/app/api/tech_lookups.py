from fastapi import APIRouter, HTTPException
from ..models import TechLookupItem, TechLookupItemUpdate
from ..data_loader import load_tech_lookup, save_tech_lookup, _TECH_TABLES

router = APIRouter(prefix="/tech-lookups", tags=["tech-lookups"])

VALID_TABLES = set(_TECH_TABLES)


def _check(table: str):
    if table not in VALID_TABLES:
        raise HTTPException(status_code=404, detail=f"Unknown lookup table: {table}")


@router.get("/{table}", response_model=list[TechLookupItem])
def list_items(table: str):
    _check(table)
    return load_tech_lookup(table)


@router.post("/{table}", response_model=TechLookupItem, status_code=201)
def create_item(table: str, item: TechLookupItem):
    _check(table)
    items = load_tech_lookup(table)
    if any(i.id == item.id for i in items):
        raise HTTPException(status_code=409, detail=f"Item '{item.id}' already exists")
    items.append(item)
    items.sort(key=lambda x: x.order)
    save_tech_lookup(table, items)
    return item


@router.put("/{table}/{item_id}", response_model=TechLookupItem)
def update_item(table: str, item_id: str, updates: TechLookupItemUpdate):
    _check(table)
    items = load_tech_lookup(table)
    for i, item in enumerate(items):
        if item.id == item_id:
            updated = item.model_copy(update=updates.model_dump(exclude_unset=True))
            items[i] = updated
            items.sort(key=lambda x: x.order)
            save_tech_lookup(table, items)
            return updated
    raise HTTPException(status_code=404, detail=f"Item '{item_id}' not found")


@router.delete("/{table}/{item_id}", status_code=204)
def delete_item(table: str, item_id: str):
    _check(table)
    items = load_tech_lookup(table)
    new_items = [i for i in items if i.id != item_id]
    if len(new_items) == len(items):
        raise HTTPException(status_code=404, detail=f"Item '{item_id}' not found")
    save_tech_lookup(table, new_items)
