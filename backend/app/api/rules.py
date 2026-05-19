from fastapi import APIRouter, HTTPException
from ..models import InterconnectRule, InterconnectRuleUpdate
from ..data_loader import load_rules, save_rules

router = APIRouter(prefix="/rules", tags=["rules"])


@router.get("", response_model=list[InterconnectRule])
def get_rules():
    return load_rules()


@router.post("", response_model=InterconnectRule, status_code=201)
def create_rule(rule: InterconnectRule):
    rules = load_rules()
    if any(r.node_id == rule.node_id for r in rules):
        raise HTTPException(status_code=409, detail=f"Rule for node '{rule.node_id}' already exists")
    rules.append(rule)
    save_rules(rules)
    return rule


@router.put("/{node_id}", response_model=InterconnectRule)
def update_rule(node_id: str, updates: InterconnectRuleUpdate):
    rules = load_rules()
    for i, r in enumerate(rules):
        if r.node_id == node_id:
            updated = r.model_copy(update=updates.model_dump(exclude_unset=True))
            rules[i] = updated
            save_rules(rules)
            return updated
    raise HTTPException(status_code=404, detail=f"Rule for node '{node_id}' not found")


@router.delete("/{node_id}", status_code=204)
def delete_rule(node_id: str):
    rules = load_rules()
    new_rules = [r for r in rules if r.node_id != node_id]
    if len(new_rules) == len(rules):
        raise HTTPException(status_code=404, detail=f"Rule for node '{node_id}' not found")
    save_rules(new_rules)
