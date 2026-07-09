# ─────────────────────────────────────────────────────────────────────────────
# city_pairs.py — City-to-city route lookup (a friendlier front door to search).
#
# Route prefix: /api/city-pairs  (this router has no prefix of its own; the
# paths below start with "/city-pairs", and main.py mounts the router under
# "/api").
#
# Domain: end users often think in cities ("Singapore to Hong Kong"), but the
# network graph is made of nodes (individual locations — CLS/PoP/branching
# units) joined by segments (cable hops) that belong to systems (named cables).
# One city can contain several nodes. This module groups nodes by city and then
# finds routes between all node pairs of two cities.
#
# Endpoints:
#   GET  /api/city-pairs/cities  — list all cities and which node IDs each holds.
#   POST /api/city-pairs/search  — find routes between two named cities.
# ─────────────────────────────────────────────────────────────────────────────
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from ..data_loader import load_nodes, load_segments, load_systems
from ..city_pair_finder import get_cities, find_city_pair_routes

router = APIRouter()


class CityPairRequest(BaseModel):
    # Request body for POST /api/city-pairs/search.
    origin_city: str          # source city name (as returned by /city-pairs/cities)
    destination_city: str     # destination city name
    max_results: int = 15     # cap on the number of routes returned


@router.get("/city-pairs/cities")
def list_cities():
    """GET /api/city-pairs/cities — list selectable cities and their nodes.

    Groups every node by its city name so the frontend can offer city pickers
    without exposing individual node IDs.

    Params: none.
    Response: a JSON array of {"name", "node_ids", "country"} objects, sorted by
    country then city name. "node_ids" is the list of node IDs located in that
    city; "country" is taken from the city's first node.

    Auth: public read endpoint; no token required.
    """
    nodes = load_nodes()
    cities = get_cities(nodes)
    node_map = {n.id: n for n in nodes}
    result = []
    for city_name, node_ids in cities.items():
        # Every node in a city shares a country, so read it off the first node.
        country = node_map[node_ids[0]].country if node_ids else ""
        result.append({"name": city_name, "node_ids": node_ids, "country": country})
    result.sort(key=lambda x: (x["country"], x["name"]))
    return result


@router.post("/city-pairs/search")
def search_city_pairs(req: CityPairRequest):
    """POST /api/city-pairs/search — find routes between two cities.

    Loads the full network (nodes, segments, systems), then delegates to
    find_city_pair_routes, which expands each city to its member nodes and
    searches for paths between them.

    Params: request body is a CityPairRequest (origin_city, destination_city,
    optional max_results, default 15).
    Response: {"origin_city", "destination_city", "routes"} where "routes" is
    the list of matching routes. Returns HTTP 400 if either city name is unknown
    or otherwise invalid (raised as ValueError by the finder).

    Auth: this is a read-style query that happens to use POST, so it is one of
    the EXEMPT write paths in app/main.py — no admin token is required even when
    ADMIN_KEY is set. It is rate limited instead by the admin_write_guard
    middleware.
    """
    nodes = load_nodes()
    segments = load_segments()
    systems = load_systems()
    systems_by_id = {s.id: s for s in systems}
    try:
        routes = find_city_pair_routes(
            origin_city=req.origin_city,
            destination_city=req.destination_city,
            nodes=nodes,
            segments=segments,
            systems_by_id=systems_by_id,
            max_results=req.max_results,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {
        "origin_city": req.origin_city,
        "destination_city": req.destination_city,
        "routes": routes,
    }
