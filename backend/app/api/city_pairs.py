from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from ..data_loader import load_nodes, load_segments, load_systems
from ..city_pair_finder import get_cities, find_city_pair_routes

router = APIRouter()


class CityPairRequest(BaseModel):
    origin_city: str
    destination_city: str
    max_results: int = 15


@router.get("/city-pairs/cities")
def list_cities():
    nodes = load_nodes()
    cities = get_cities(nodes)
    node_map = {n.id: n for n in nodes}
    result = []
    for city_name, node_ids in cities.items():
        country = node_map[node_ids[0]].country if node_ids else ""
        result.append({"name": city_name, "node_ids": node_ids, "country": country})
    result.sort(key=lambda x: (x["country"], x["name"]))
    return result


@router.post("/city-pairs/search")
def search_city_pairs(req: CityPairRequest):
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
