from fastapi import APIRouter
from ..models import RouteRequest, RouteResponse
from ..data_loader import load_nodes, load_segments, load_rules
from ..graph import build_graph
from ..pathfinder import find_routes

router = APIRouter(prefix="/routes", tags=["routes"])


@router.post("", response_model=RouteResponse)
def search_routes(request: RouteRequest):
    nodes = load_nodes()
    segments = load_segments()
    rules = load_rules()

    G = build_graph(nodes, segments)
    segments_by_id = {s.id: s for s in segments}

    return find_routes(
        G=G,
        start=request.start_node_id,
        end=request.end_node_id,
        must_include_nodes=request.must_include_nodes,
        must_avoid_nodes=request.must_avoid_nodes,
        must_avoid_segments=request.must_avoid_segments,
        must_include_segments=request.must_include_segments,
        diversity=request.diversity,
        segments_by_id=segments_by_id,
        rules=rules,
    )
