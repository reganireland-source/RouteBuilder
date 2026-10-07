# ─────────────────────────────────────────────────────────────────────────────
# shiptracker.py — CRUD for ShipTracker's tracked cable repair ships, merged
# with their live AIS position at read time.
#
# Route prefix: /api/ships (this router has no prefix of its own; main.py
# mounts it under "/api", same convention as outages.py).
#
# UNLIKE hazards/cable-import-research, this router is ALWAYS mounted (see
# main.py) — manually tracking "which ships are mobilised for repair" is
# useful even with no live feed configured; only the live position fields
# depend on MARITIME_AISSTREAM_API_KEY being set, and GET /api/ships degrades
# gracefully (`live: null` per ship) when it isn't, rather than the whole
# feature disappearing. See shiptracker/ais_client.py's module docstring for
# why aisstream.io and not MarineTraffic.
#
# Endpoints:
#   GET    /api/ships          — list all tracked ships, each merged with its
#                                 live position (null if nothing received yet).
#   POST   /api/ships          — start tracking a ship by MMSI.
#   DELETE /api/ships/{mmsi}   — stop tracking a ship.
# ─────────────────────────────────────────────────────────────────────────────
import logging
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..data_loader import load_ships, upsert_ship, delete_ship_row
from ..models import TrackedShip, TrackedShipView
from ..shiptracker.ais_client import client as ais_client
from ..shiptracker.lookup import lookup_ship_name

log = logging.getLogger("routebuilder.shiptracker")

router = APIRouter()


def _to_view(ship: TrackedShip) -> TrackedShipView:
    return TrackedShipView(**ship.model_dump(), live=ais_client.get(ship.mmsi))


@router.get("/ships", response_model=list[TrackedShipView])
def get_ships():
    """GET /api/ships — list all tracked ships with their live position.

    Params: none.
    Response: a JSON array of TrackedShipView objects. `live` is null for a
    ship that hasn't transmitted an AIS position since the backend started,
    or when live tracking isn't configured at all (MARITIME_AISSTREAM_API_KEY
    unset) — not an error, just "nothing received yet".

    Auth: public read endpoint; no token required.
    """
    return [_to_view(s) for s in load_ships()]


class CreateShipRequest(BaseModel):
    """POST /api/ships body — mmsi is the only required field; name is
    resolved from AIS if the ship is currently transmitting and no name is
    given, matching the Cable Import Research pattern of "auto-fill, but the
    caller may always override"."""
    mmsi: str = Field(pattern=r"^\d{9}$")  # an MMSI is exactly nine digits
    name: str | None = None
    imo: str | None = None
    sprite: str = "generic"


@router.post("/ships", response_model=TrackedShipView, status_code=201)
async def create_ship(entry: CreateShipRequest):
    """POST /api/ships — start tracking a ship by MMSI.

    Params: request body is a CreateShipRequest (mmsi required; name/imo/
    sprite optional — name is looked up from AIS if omitted and the ship is
    currently transmitting, otherwise it falls back to the MMSI itself so
    the record is never nameless).
    Response: the created TrackedShipView (HTTP 201). Returns HTTP 409 if a
    ship with this mmsi is already tracked.

    Auth: requires the x-admin-token header when ADMIN_KEY is set — enforced
    centrally by the auth_guard middleware in app/main.py, not here.
    """
    mmsi = entry.mmsi.strip()
    if any(s.mmsi == mmsi for s in load_ships()):
        raise HTTPException(status_code=409, detail=f"Ship with mmsi '{mmsi}' is already tracked")

    name = entry.name.strip() if entry.name and entry.name.strip() else None
    if name is None:
        name = await lookup_ship_name(mmsi)
    if name is None:
        name = mmsi  # last resort — never store a blank name

    ship = TrackedShip(
        mmsi=mmsi, name=name, imo=entry.imo, sprite=entry.sprite or "generic",
        added_at=datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
    )
    upsert_ship(ship)
    await ais_client.subscribe(mmsi)
    return _to_view(ship)


@router.delete("/ships/{mmsi}", status_code=204)
async def delete_ship(mmsi: str):
    """DELETE /api/ships/{mmsi} — stop tracking a ship.

    Params: mmsi (path) — which ship to remove.
    Response: empty body, HTTP 204 on success. Returns HTTP 404 if unknown.

    Auth: requires the x-admin-token header when ADMIN_KEY is set — enforced
    centrally by the auth_guard middleware in app/main.py, not here.
    """
    if not delete_ship_row(mmsi):
        raise HTTPException(status_code=404, detail=f"Ship with mmsi '{mmsi}' not found")
    await ais_client.unsubscribe(mmsi)
