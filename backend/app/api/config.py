# ─────────────────────────────────────────────────────────────────────────────
# config.py — Global application settings (a single shared AppConfig document).
#
# Route prefix: /api/config  (this router has prefix="/config"; main.py mounts
# it under "/api", so the paths are exactly /api/config).
#
# There is one global config object for the whole app (not per-user). Known keys:
#   - on_net_ownership: list[str] — which segment ownership types count as
#     "on-net" (Telstra-owned) for the route UI's on-net/off-net styling.
#   - maps_provider: str — which basemap to render, either "osm"
#     (OpenStreetMap) or "google".
# Only these two keys are read/written here; anything else in the stored config
# is left untouched.
#
# Endpoints:
#   GET /api/config  — return the whole config document.
#   PUT /api/config  — update on_net_ownership and/or maps_provider.
# ─────────────────────────────────────────────────────────────────────────────
from fastapi import APIRouter, HTTPException
from ..data_loader import load_config, save_config

router = APIRouter(prefix="/config", tags=["config"])

VALID_MAPS_PROVIDERS = {'osm', 'google'}


@router.get("")
def get_config() -> dict:
    """GET /api/config — return the global application config.

    Params: none.
    Response: the full config dict (includes at least on_net_ownership and
    maps_provider).

    Auth: public read endpoint; no token required.
    """
    return load_config()


@router.put("")
def update_config(body: dict) -> dict:
    """PUT /api/config — update the global application config.

    Accepts a partial config body and applies only the recognised keys
    (on_net_ownership and maps_provider); any other keys in the body are
    ignored, and unspecified keys keep their current values.

    Params: request body is a JSON object that may contain:
      - on_net_ownership: must be a list (validated), else HTTP 400.
      - maps_provider: must be one of {"osm", "google"} (validated), else 400.
    Response: the full updated config dict.

    Auth: requires the x-admin-token header when ADMIN_KEY is set — enforced
    centrally by the admin_write_guard middleware in app/main.py, not here.
    """
    # Validate incoming values before touching the stored config so a bad
    # request never partially writes.
    if "on_net_ownership" in body and not isinstance(body["on_net_ownership"], list):
        raise HTTPException(status_code=400, detail="on_net_ownership must be a list")
    if "maps_provider" in body and body["maps_provider"] not in VALID_MAPS_PROVIDERS:
        raise HTTPException(status_code=400, detail=f"maps_provider must be one of {VALID_MAPS_PROVIDERS}")

    config = load_config()
    # Merge in only the recognised keys that were actually supplied.
    if "on_net_ownership" in body:
        config["on_net_ownership"] = body["on_net_ownership"]
    if "maps_provider" in body:
        config["maps_provider"] = body["maps_provider"]
    save_config(config)
    return config
