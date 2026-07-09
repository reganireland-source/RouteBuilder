# ─────────────────────────────────────────────────────────────────────────────
# nodes.py — CRUD for nodes (the locations that make up the network).
#
# Route prefix: /api/nodes  (this router has prefix="/nodes"; main.py mounts it
# under "/api", so the paths are /api/nodes...).
#
# Domain: a "node" is a location in the network — a Cable Landing Station (CLS),
# a PoP (point of presence), or a branching unit (an undersea split in a cable).
# Nodes are the vertices of the routing graph; "segments" (cable hops) connect
# them. Each node has an id, name, lat/lng, type, country, and optional
# capability metadata. IDs are normalised (e.g. upper-cased) on write via
# normalize_id.
#
# Endpoints:
#   GET    /api/nodes            — list all nodes.
#   POST   /api/nodes            — create a node.
#   PUT    /api/nodes/{node_id}  — patch a node.
#   DELETE /api/nodes/{node_id}  — delete a node.
# ─────────────────────────────────────────────────────────────────────────────
from fastapi import APIRouter, HTTPException
from ..models import Node, NodeUpdate
from ..data_loader import load_nodes, save_nodes
from ..id_utils import normalize_id

router = APIRouter(prefix="/nodes", tags=["nodes"])


@router.get("", response_model=list[Node])
def get_nodes():
    """GET /api/nodes — list all nodes.

    Params: none.
    Response: a JSON array of Node objects (the full network location list).

    Auth: public read endpoint; no token required.
    """
    return load_nodes()


@router.post("", response_model=Node, status_code=201)
def create_node(node: Node):
    """POST /api/nodes — create a new node.

    Params: request body is a Node object (id, name, lat, lng, type, country,
    ...).
    Response: the created Node (HTTP 201). Returns HTTP 409 if the (normalised)
    id already exists.

    Auth: requires the x-admin-token header when ADMIN_KEY is set — enforced
    centrally by the admin_write_guard middleware in app/main.py, not here.
    """
    # Normalise the id (e.g. upper-case) before the uniqueness check so that
    # "sin1" and "SIN1" cannot both be created.
    node = node.model_copy(update={"id": normalize_id(node.id, "node")})
    nodes = load_nodes()
    if any(n.id == node.id for n in nodes):
        raise HTTPException(status_code=409, detail=f"Node '{node.id}' already exists")
    nodes.append(node)
    save_nodes(nodes)
    return node


@router.put("/{node_id}", response_model=Node)
def update_node(node_id: str, updates: NodeUpdate):
    """PUT /api/nodes/{node_id} — partially update a node.

    Params:
      - node_id (path): which node to update.
      - request body: a NodeUpdate with only the fields to change.
    Response: the updated Node. Returns HTTP 404 if the id is unknown.

    Auth: requires the x-admin-token header when ADMIN_KEY is set — enforced
    centrally by the admin_write_guard middleware in app/main.py, not here.
    """
    nodes = load_nodes()
    for i, node in enumerate(nodes):
        if node.id == node_id:
            # Merge only supplied fields; omitted fields keep current values.
            updated = node.model_copy(update=updates.model_dump(exclude_unset=True))
            nodes[i] = updated
            save_nodes(nodes)
            return updated
    raise HTTPException(status_code=404, detail=f"Node '{node_id}' not found")


@router.delete("/{node_id}", status_code=204)
def delete_node(node_id: str):
    """DELETE /api/nodes/{node_id} — delete a node.

    Params: node_id (path) — which node to remove. Note this does not cascade to
    segments that reference the node; that consistency is surfaced by the
    /api/health/checks integrity checks.
    Response: empty body, HTTP 204 on success. Returns HTTP 404 if unknown.

    Auth: requires the x-admin-token header when ADMIN_KEY is set — enforced
    centrally by the admin_write_guard middleware in app/main.py, not here.
    """
    nodes = load_nodes()
    new_nodes = [n for n in nodes if n.id != node_id]
    # No rows removed => id did not exist.
    if len(new_nodes) == len(nodes):
        raise HTTPException(status_code=404, detail=f"Node '{node_id}' not found")
    save_nodes(new_nodes)
