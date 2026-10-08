# ─────────────────────────────────────────────────────────────────────────────
# tech_lookups.py — Generic CRUD over the tech-lookup dropdown lists.
#
# Route prefix: /api/tech-lookups  (this router has prefix="/tech-lookups";
# main.py mounts it under "/api", so paths are /api/tech-lookups/{table}...).
#
# Domain: "tech lookups" are the small editable option lists that populate
# dropdowns in the solution-design UI. Rather than one router per list, this
# module is generic: the {table} path segment selects which lookup list to
# operate on. Only the names in _TECH_TABLES (from data_loader) are valid — any
# other {table} yields HTTP 404. Each item is a TechLookupItem with an id and an
# "order" field; the list is kept sorted by "order" after every create/update so
# the UI renders options in a stable sequence.
#
# Endpoints (all take a {table} path param naming the lookup list):
#   GET    /api/tech-lookups/{table}            — list items in that list.
#   POST   /api/tech-lookups/{table}            — add an item.
#   PUT    /api/tech-lookups/{table}/{item_id}  — update an item.
#   DELETE /api/tech-lookups/{table}/{item_id}  — delete an item.
# ─────────────────────────────────────────────────────────────────────────────
from fastapi import APIRouter, HTTPException
from ..models import TechLookupItem, TechLookupItemUpdate
from ..data_loader import load_tech_lookup, save_tech_lookup, _TECH_TABLES

router = APIRouter(prefix="/tech-lookups", tags=["tech-lookups"])

VALID_TABLES = set(_TECH_TABLES)


def _check(table: str):
    # Guard: reject any {table} that isn't a known lookup list (prevents reading
    # or writing arbitrary table names supplied in the URL).
    if table not in VALID_TABLES:
        raise HTTPException(status_code=404, detail=f"Unknown lookup table: {table}")


@router.get("/{table}", response_model=list[TechLookupItem])
def list_items(table: str):
    """GET /api/tech-lookups/{table} — list all items in one lookup list.

    Params: table (path) — which lookup list to read; must be a known table
    (else HTTP 404).
    Response: a JSON array of TechLookupItem objects for that list.

    Auth: public read endpoint; no token required.
    """
    _check(table)
    return load_tech_lookup(table)


@router.post("/{table}", response_model=TechLookupItem, status_code=201)
def create_item(table: str, item: TechLookupItem):
    """POST /api/tech-lookups/{table} — add an item to a lookup list.

    Params:
      - table (path): which lookup list; must be a known table (else 404).
      - request body: a TechLookupItem (id and order).
    Response: the created TechLookupItem (HTTP 201). Returns HTTP 409 if an item
    with the same id already exists in that list.

    Auth: requires the x-admin-token header when ADMIN_KEY is set — enforced
    centrally by the admin_write_guard middleware in app/main.py, not here.
    """
    _check(table)
    items = load_tech_lookup(table)
    if any(i.id == item.id for i in items):
        raise HTTPException(status_code=409, detail=f"Item '{item.id}' already exists")
    items.append(item)
    # Keep the list ordered by "order" so dropdowns render in a stable sequence.
    items.sort(key=lambda x: x.order)
    save_tech_lookup(table, items)
    return item


@router.put("/{table}/{item_id}", response_model=TechLookupItem)
def update_item(table: str, item_id: str, updates: TechLookupItemUpdate):
    """PUT /api/tech-lookups/{table}/{item_id} — update a lookup item.

    Params:
      - table (path): which lookup list; must be a known table (else 404).
      - item_id (path): which item to update.
      - request body: a TechLookupItemUpdate with only the fields to change.
    Response: the updated TechLookupItem. Returns HTTP 404 if the item id isn't
    in that list.

    Auth: requires the x-admin-token header when ADMIN_KEY is set — enforced
    centrally by the admin_write_guard middleware in app/main.py, not here.
    """
    _check(table)
    items = load_tech_lookup(table)
    for i, item in enumerate(items):
        if item.id == item_id:
            # Merge only supplied fields, then re-sort (order may have changed).
            updated = item.model_copy(update=updates.model_dump(exclude_unset=True))
            items[i] = updated
            items.sort(key=lambda x: x.order)
            save_tech_lookup(table, items)
            return updated
    raise HTTPException(status_code=404, detail=f"Item '{item_id}' not found")


@router.delete("/{table}/{item_id}", status_code=204)
def delete_item(table: str, item_id: str):
    """DELETE /api/tech-lookups/{table}/{item_id} — delete a lookup item.

    Params:
      - table (path): which lookup list; must be a known table (else 404).
      - item_id (path): which item to remove.
    Response: empty body, HTTP 204 on success. Returns HTTP 404 if the item id
    isn't in that list.

    Auth: requires the x-admin-token header when ADMIN_KEY is set — enforced
    centrally by the admin_write_guard middleware in app/main.py, not here.
    """
    _check(table)
    items = load_tech_lookup(table)
    new_items = [i for i in items if i.id != item_id]
    # No rows removed => item id was not in this list.
    if len(new_items) == len(items):
        raise HTTPException(status_code=404, detail=f"Item '{item_id}' not found")
    save_tech_lookup(table, new_items)
