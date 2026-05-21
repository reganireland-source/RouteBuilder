from fastapi import APIRouter, HTTPException
from ..data_loader import load_config, save_config

router = APIRouter(prefix="/config", tags=["config"])


@router.get("")
def get_config() -> dict:
    return load_config()


@router.put("")
def update_config(body: dict) -> dict:
    if "on_net_ownership" not in body:
        raise HTTPException(status_code=400, detail="on_net_ownership field required")
    if not isinstance(body["on_net_ownership"], list):
        raise HTTPException(status_code=400, detail="on_net_ownership must be a list")
    config = load_config()
    config["on_net_ownership"] = body["on_net_ownership"]
    save_config(config)
    return config
