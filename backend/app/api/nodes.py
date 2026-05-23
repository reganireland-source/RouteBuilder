from fastapi import APIRouter, HTTPException
from ..models import Node, NodeUpdate
from ..data_loader import load_nodes, save_nodes

router = APIRouter(prefix="/nodes", tags=["nodes"])


@router.get("", response_model=list[Node])
def get_nodes():
    return load_nodes()


@router.post("", response_model=Node, status_code=201)
def create_node(node: Node):
    nodes = load_nodes()
    if any(n.id == node.id for n in nodes):
        raise HTTPException(status_code=409, detail=f"Node '{node.id}' already exists")
    nodes.append(node)
    save_nodes(nodes)
    return node


@router.put("/{node_id}", response_model=Node)
def update_node(node_id: str, updates: NodeUpdate):
    nodes = load_nodes()
    for i, node in enumerate(nodes):
        if node.id == node_id:
            updated = node.model_copy(update=updates.model_dump(exclude_unset=True))
            nodes[i] = updated
            save_nodes(nodes)
            return updated
    raise HTTPException(status_code=404, detail=f"Node '{node_id}' not found")


@router.delete("/{node_id}", status_code=204)
def delete_node(node_id: str):
    nodes = load_nodes()
    new_nodes = [n for n in nodes if n.id != node_id]
    if len(new_nodes) == len(nodes):
        raise HTTPException(status_code=404, detail=f"Node '{node_id}' not found")
    save_nodes(new_nodes)
