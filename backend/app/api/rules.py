# ─────────────────────────────────────────────────────────────────────────────
# rules.py — CRUD for interconnect rules (per-node handoff restrictions).
#
# Route prefix: /api/rules  (this router has prefix="/rules"; main.py mounts it
# under "/api", so the paths are /api/rules...).
#
# Domain: an "interconnect rule" describes which cable systems are allowed to
# hand off to each other at a given node — i.e. at this location, can traffic on
# system A cross over to system B? The route-search pathfinder consults these
# rules so it never builds a path that switches systems where that isn't
# permitted. Each InterconnectRule is keyed by node_id (one rule record per
# node).
#
# Endpoints:
#   GET    /api/rules            — list all interconnect rules.
#   POST   /api/rules            — create a rule for a node.
#   PUT    /api/rules/{node_id}  — patch a node's rule.
#   DELETE /api/rules/{node_id}  — delete a node's rule.
# ─────────────────────────────────────────────────────────────────────────────
from fastapi import APIRouter, HTTPException
from ..models import InterconnectRule, InterconnectRuleUpdate
from ..data_loader import load_rules, save_rules

router = APIRouter(prefix="/rules", tags=["rules"])


@router.get("", response_model=list[InterconnectRule])
def get_rules():
    """GET /api/rules — list all interconnect rules.

    Params: none.
    Response: a JSON array of InterconnectRule objects (each keyed by node_id).

    Auth: public read endpoint; no token required.
    """
    return load_rules()


@router.post("", response_model=InterconnectRule, status_code=201)
def create_rule(rule: InterconnectRule):
    """POST /api/rules — create an interconnect rule for a node.

    Params: request body is an InterconnectRule (includes its node_id).
    Response: the created InterconnectRule (HTTP 201). Returns HTTP 409 if a
    rule for that node_id already exists (one rule per node).

    Auth: requires the x-admin-token header when ADMIN_KEY is set — enforced
    centrally by the admin_write_guard middleware in app/main.py, not here.
    """
    rules = load_rules()
    # node_id is the unique key: at most one rule record per node.
    if any(r.node_id == rule.node_id for r in rules):
        raise HTTPException(status_code=409, detail=f"Rule for node '{rule.node_id}' already exists")
    rules.append(rule)
    save_rules(rules)
    return rule


@router.put("/{node_id}", response_model=InterconnectRule)
def update_rule(node_id: str, updates: InterconnectRuleUpdate):
    """PUT /api/rules/{node_id} — partially update a node's interconnect rule.

    Params:
      - node_id (path): which node's rule to update.
      - request body: an InterconnectRuleUpdate with only the fields to change.
    Response: the updated InterconnectRule. Returns HTTP 404 if no rule exists
    for that node_id.

    Auth: requires the x-admin-token header when ADMIN_KEY is set — enforced
    centrally by the admin_write_guard middleware in app/main.py, not here.
    """
    rules = load_rules()
    for i, r in enumerate(rules):
        if r.node_id == node_id:
            # Merge only supplied fields onto the existing rule.
            updated = r.model_copy(update=updates.model_dump(exclude_unset=True))
            rules[i] = updated
            save_rules(rules)
            return updated
    raise HTTPException(status_code=404, detail=f"Rule for node '{node_id}' not found")


@router.delete("/{node_id}", status_code=204)
def delete_rule(node_id: str):
    """DELETE /api/rules/{node_id} — delete a node's interconnect rule.

    Params: node_id (path) — which node's rule to remove.
    Response: empty body, HTTP 204 on success. Returns HTTP 404 if no rule
    exists for that node_id.

    Auth: requires the x-admin-token header when ADMIN_KEY is set — enforced
    centrally by the admin_write_guard middleware in app/main.py, not here.
    """
    rules = load_rules()
    new_rules = [r for r in rules if r.node_id != node_id]
    # No rows removed => node_id had no rule.
    if len(new_rules) == len(rules):
        raise HTTPException(status_code=404, detail=f"Rule for node '{node_id}' not found")
    save_rules(new_rules)
