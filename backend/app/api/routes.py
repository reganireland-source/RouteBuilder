from fastapi import APIRouter
from ..models import RouteRequest, RouteResponse
from ..data_loader import load_nodes, load_segments, load_rules, load_capacity, load_outages
from ..graph import build_graph
from ..pathfinder import find_routes

router = APIRouter(prefix="/routes", tags=["routes"])


@router.post("", response_model=RouteResponse)
def search_routes(request: RouteRequest):
    nodes = load_nodes()
    segments = load_segments()
    rules = load_rules()
    capacities = load_capacity()
    outages = load_outages()

    G = build_graph(nodes, segments)
    segments_by_id = {s.id: s for s in segments}
    capacities_by_id = {c.segment_id: c for c in capacities}
    outage_segment_ids = {o.segment_id for o in outages}

    # Build non-BU node index by country for country constraints
    from collections import defaultdict
    country_to_node_ids: dict[str, set[str]] = defaultdict(set)
    for n in nodes:
        if n.type != "branching_unit":
            country_to_node_ids[n.country].add(n.id)

    return find_routes(
        G=G,
        start=request.start_node_id,
        end=request.end_node_id,
        must_include_nodes=request.must_include_nodes,
        must_avoid_nodes=request.must_avoid_nodes,
        must_avoid_segments=request.must_avoid_segments,
        must_include_segments=request.must_include_segments,
        must_include_systems=request.must_include_systems,
        must_avoid_systems=request.must_avoid_systems,
        diversity=request.diversity,
        segments_by_id=segments_by_id,
        rules=rules,
        max_wet_hops=request.max_wet_hops,
        max_terrestrial_hops=request.max_terrestrial_hops,
        capacities_by_id=capacities_by_id,
        optimise_for=request.optimise_for,
        outage_segment_ids=outage_segment_ids,
        must_avoid_countries=request.must_avoid_countries,
        must_include_countries=request.must_include_countries,
        country_to_node_ids=dict(country_to_node_ids),
    )
