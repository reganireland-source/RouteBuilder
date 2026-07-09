# ─────────────────────────────────────────────────────────────────────────────
# routes.py — THE main route-search endpoint (the core feature of the app).
#
# Route prefix: /api/routes  (this router has prefix="/routes"; main.py mounts
# it under "/api", so the path is exactly /api/routes).
#
# What it does: given a start and end node plus a bag of constraints, it finds
# candidate paths across the cable network. The overall flow is:
#
#     RouteRequest (JSON body)  →  build_graph(nodes, segments)  →
#     pathfinder.find_routes(...)  →  RouteResponse (ranked routes)
#
# Along the way it loads the live network state — nodes (locations), segments
# (cable hops: wet=submarine, terrestrial=land), interconnect rules (which
# systems may hand off at a node), per-segment capacity, and current outages —
# so the search respects real constraints. Constraints in the request include
# must-include / must-avoid nodes/segments/systems/countries, hop limits, a
# diversity flag, and an optimisation objective.
#
# Endpoints:
#   POST /api/routes  — search for routes between two nodes.
# ─────────────────────────────────────────────────────────────────────────────
from fastapi import APIRouter
from ..models import RouteRequest, RouteResponse
from ..data_loader import load_nodes, load_segments, load_rules, load_capacity, load_outages
from ..graph import build_graph
from ..pathfinder import find_routes

router = APIRouter(prefix="/routes", tags=["routes"])


@router.post("", response_model=RouteResponse)
def search_routes(request: RouteRequest):
    """POST /api/routes — find routes between two nodes (the main search).

    Loads the full network state (nodes, segments, interconnect rules, capacity,
    outages), builds the routing graph, and hands everything plus the request's
    constraints to pathfinder.find_routes, returning its ranked results.

    Params: request body is a RouteRequest, whose fields include:
      - start_node_id / end_node_id: the endpoints of the search.
      - must_include_nodes / must_avoid_nodes: node-level constraints.
      - must_include_segments / must_avoid_segments: segment-level constraints.
      - must_include_systems / must_avoid_systems: cable-system constraints.
      - must_include_countries / must_avoid_countries: country constraints.
      - max_wet_hops / max_terrestrial_hops: limits on submarine/land hops.
      - diversity: request physically diverse alternative routes.
      - optimise_for: the objective to rank by (e.g. latency/cost).
    Response: a RouteResponse containing the matching routes.

    Auth: this is a read-style QUERY that happens to use POST (it never mutates
    data), so it is one of the EXEMPT write paths in app/main.py — no admin
    token is required even when ADMIN_KEY is set. It IS rate limited by the
    admin_write_guard middleware to protect the server from scripted abuse.
    """
    nodes = load_nodes()
    segments = load_segments()
    rules = load_rules()
    capacities = load_capacity()
    outages = load_outages()

    G = build_graph(nodes, segments)
    segments_by_id = {s.id: s for s in segments}
    capacities_by_id = {c.segment_id: c for c in capacities}
    outage_segment_ids = {o.segment_id for o in outages}

    # Build non-BU node index by country for country constraints.
    # Branching units (undersea splits) are excluded because they are not real
    # "in-country" locations a route should be counted as visiting.
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
