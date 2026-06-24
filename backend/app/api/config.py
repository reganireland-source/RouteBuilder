from fastapi import APIRouter, HTTPException
from ..data_loader import load_config, save_config

router = APIRouter(prefix="/config", tags=["config"])

VALID_MAPS_PROVIDERS = {'osm', 'google'}


@router.get("")
def get_config() -> dict:
    return load_config()


@router.put("")
def update_config(body: dict) -> dict:
    if "on_net_ownership" in body and not isinstance(body["on_net_ownership"], list):
        raise HTTPException(status_code=400, detail="on_net_ownership must be a list")
    if "maps_provider" in body and body["maps_provider"] not in VALID_MAPS_PROVIDERS:
        raise HTTPException(status_code=400, detail=f"maps_provider must be one of {VALID_MAPS_PROVIDERS}")

    config = load_config()
    if "on_net_ownership" in body:
        config["on_net_ownership"] = body["on_net_ownership"]
    if "maps_provider" in body:
        config["maps_provider"] = body["maps_provider"]
    save_config(config)
    return config
