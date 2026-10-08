# ─────────────────────────────────────────────────────────────────────────────
# shiptracker/lookup.py — resolve a bare MMSI into a ship name at add-time.
#
# Same shape as app/cableimport/research.py: one identifier in, a best-effort
# fetch from an external source, a result handed back for the caller to store
# — never writes directly. Unlike research.py this has exactly one source
# (aisstream.io itself; there is no Wikipedia-style fallback for "what is MMSI
# 525300321 called"), so a miss just means the admin types the name in by hand
# — POST /api/ships accepts an optional `name` override for exactly that case.
#
# WHY A SEPARATE, SHORT-LIVED CONNECTION rather than reusing the persistent
# AisStreamClient from ais_client.py: that client's cache only holds the live
# POSITION fields (TrackedShipLive) that every tracked ship needs continuously;
# a ship's NAME is only needed once, at add-time. Opening one throwaway
# WebSocket, filtered to just this MMSI, and closing it the moment a message
# arrives (or a short timeout elapses) keeps that one-off lookup out of the
# persistent client's long-lived state entirely.
#
# NOTE ON IMO: only the name is resolved here, from whichever frame arrives
# first. Callers that know a ship's IMO (e.g. the 3 seed ships, resolved via
# maritime registries) pass it explicitly instead.
# ─────────────────────────────────────────────────────────────────────────────
import asyncio
import json
import logging
from typing import Optional

import websockets

from .ais_client import AISSTREAM_URL, GLOBAL_BBOX, aisstream_api_key

log = logging.getLogger("routebuilder.shiptracker")

_LOOKUP_TIMEOUT_SECONDS = 12.0


async def lookup_ship_name(mmsi: str) -> Optional[str]:
    """Best-effort ship name for `mmsi` via a short-lived aisstream.io
    connection. Returns None (never raises) if no API key is configured, the
    ship hasn't transmitted recently enough to be seen within the timeout, or
    aisstream.io is unreachable — any of which just means the admin supplies
    the name manually instead."""
    api_key = aisstream_api_key()
    if not api_key:
        return None
    try:
        async with websockets.connect(AISSTREAM_URL, open_timeout=8) as ws:
            await ws.send(json.dumps({
                "APIKey": api_key,
                "BoundingBoxes": GLOBAL_BBOX,
                "FiltersShipMMSI": [mmsi],
                # All types: ShipStaticData is the frame that actually carries
                # the name, and on patchy coverage any frame is a chance.
            }))
            async with asyncio.timeout(_LOOKUP_TIMEOUT_SECONDS):
                async for raw in ws:
                    try:
                        msg = json.loads(raw)
                    except json.JSONDecodeError:
                        continue
                    name = ((msg.get("MetaData") or {}).get("ShipName") or "").strip()
                    if name:
                        return name
    except (TimeoutError, asyncio.TimeoutError):
        log.info("No AIS name resolved for MMSI %s within %.0fs — ship not transmitting right now.", mmsi, _LOOKUP_TIMEOUT_SECONDS)
    except Exception as exc:  # noqa: BLE001 — a lookup failure must never block adding a ship
        log.info("AIS name lookup failed for MMSI %s: %s", mmsi, exc)
    return None
