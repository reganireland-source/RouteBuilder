# ─────────────────────────────────────────────────────────────────────────────
# shiptracker/ais_client.py — a persistent outbound connection to aisstream.io,
# kept open for the life of the process.
#
# WHY A PERSISTENT CONNECTION, NOT A POLLED REQUEST/RESPONSE CALL
# -----------------------------------------------------------------------------
# aisstream.io has no "give me this ship's current position" endpoint — it is
# a push feed: you open one WebSocket, tell it which MMSIs you care about, and
# it forwards AIS position reports as the underlying terrestrial/satellite
# receiver network hears them. So "refresh" in this feature means "read
# whatever we've already received," not "ask again" — GET /api/ships always
# answers from this client's in-memory cache, never by making an outbound call
# on the request path.
#
# WHY NOT MARINETRAFFIC
# -----------------------------------------------------------------------------
# The endpoint originally requested (marinetraffic.com/map/getvesseljson) was
# checked directly and returns a Cloudflare bot-challenge (403) to any
# non-browser client — confirmed live, not a sandbox artifact, the same shape
# of dead end app/cableimport/research.py hit with submarinenetworks.com.
# MarineTraffic's real API is now an enterprise/contact-sales product sold by
# Kpler post-acquisition, with no published self-serve price. aisstream.io is
# free, confirmed directly against its own site/docs, and more than sufficient
# for tracking a handful of specific ships.
#
# RECONNECTION
# -----------------------------------------------------------------------------
# This socket has to outlive aisstream.io's own hiccups and ordinary network
# blips for as long as the backend process runs, so run_forever() is a loop,
# not a single connection attempt: any disconnect or error reconnects with
# capped exponential backoff rather than giving up or crashing the app.
#
# CHANGING WHICH SHIPS ARE TRACKED MID-CONNECTION
# -----------------------------------------------------------------------------
# aisstream.io's documented protocol is "send one subscription message right
# after connecting" — there is no documented way to amend an open
# subscription's MMSI filter without reconnecting. So subscribe()/unsubscribe()
# update the tracked-MMSI set and then close the current connection; the
# run_forever() loop's reconnect picks up the new set on its next subscribe
# message. This is simple and correct, at the cost of a brief reconnect
# (sub-second) whenever an admin adds or removes a ship — an acceptable
# trade-off for how rarely that happens.
# ─────────────────────────────────────────────────────────────────────────────
import asyncio
import json
import logging
import os
import time
from typing import Optional

import websockets

from ..models import TrackedShipLive

log = logging.getLogger("routebuilder.shiptracker")

AISSTREAM_URL = "wss://stream.aisstream.io/v0/stream"
#: Whole-globe bounding box — BoundingBoxes is a required field in
#: aisstream's subscribe message, but filtering actually happens via
#: FiltersShipMMSI, so this box is intentionally unrestrictive.
GLOBAL_BBOX = [[[-90.0, -180.0], [90.0, 180.0]]]
_MAX_BACKOFF_SECONDS = 60.0
_INITIAL_BACKOFF_SECONDS = 1.0


def aisstream_api_key() -> str:
    """The aisstream.io API key, or "" if unset. An empty key means live
    tracking is simply not configured — see main.py's gating — not an
    error condition this module needs to raise about."""
    return os.getenv("MARITIME_AISSTREAM_API_KEY", "").strip()


class AisStreamClient:
    """Owns the socket, the tracked-MMSI set and the live-position cache.
    One instance per process (constructed in main.py's lifespan when an API
    key is configured)."""

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._cache: dict[str, TrackedShipLive] = {}
        self._tracked: set[str] = set()
        self._ws = None  # type: ignore[var-annotated]  # websockets.WebSocketClientProtocol, once connected
        self._reconnect_requested = asyncio.Event()
        self._stopped = False

    # ── reads (sync — safe to call from a request handler) ────────────────
    def get(self, mmsi: str) -> Optional[TrackedShipLive]:
        return self._cache.get(mmsi)

    def get_all(self) -> dict[str, TrackedShipLive]:
        return dict(self._cache)

    # ── tracked-set mutation ───────────────────────────────────────────────
    async def subscribe(self, mmsi: str) -> None:
        """Start tracking one more MMSI. Forces a reconnect so the new
        subscribe message includes it — see module docstring."""
        self._tracked.add(mmsi)
        self._reconnect_requested.set()
        if self._ws is not None:
            await self._ws.close()

    async def unsubscribe(self, mmsi: str) -> None:
        """Stop tracking one MMSI and drop its cached position. Forces a
        reconnect for the same reason as subscribe()."""
        self._tracked.discard(mmsi)
        self._cache.pop(mmsi, None)
        self._reconnect_requested.set()
        if self._ws is not None:
            await self._ws.close()

    def seed_tracked(self, mmsis: list[str]) -> None:
        """Set the initial tracked-MMSI set from the stored ship list, before
        the first connection attempt. Call once at startup, not after."""
        self._tracked = set(mmsis)

    # ── connection loop ─────────────────────────────────────────────────────
    async def run_forever(self) -> None:
        """Connect, subscribe, read PositionReports into the cache forever —
        reconnecting with capped exponential backoff on any disconnect or
        error. Returns only when stop() has been called (main.py cancels this
        task directly rather than relying on a clean return, but stop() keeps
        a tight reconnect loop from spinning during shutdown's brief window)."""
        backoff = _INITIAL_BACKOFF_SECONDS
        api_key = aisstream_api_key()
        if not api_key:
            log.info("MARITIME_AISSTREAM_API_KEY not set — ShipTracker live positions disabled.")
            return
        while not self._stopped:
            self._reconnect_requested.clear()
            try:
                async with websockets.connect(AISSTREAM_URL, open_timeout=10) as ws:
                    self._ws = ws
                    await ws.send(json.dumps({
                        "APIKey": api_key,
                        "BoundingBoxes": GLOBAL_BBOX,
                        "FiltersShipMMSI": sorted(self._tracked),
                        "FilterMessageTypes": ["PositionReport"],
                    }))
                    log.info("aisstream.io connected, tracking %d ship(s).", len(self._tracked))
                    backoff = _INITIAL_BACKOFF_SECONDS  # reset after a successful connect
                    async for raw in ws:
                        if self._reconnect_requested.is_set():
                            break
                        self._handle_message(raw)
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 — any failure here must not crash the app; just retry
                log.warning("aisstream.io connection error, retrying in %.0fs: %s", backoff, exc)
            finally:
                self._ws = None
            if self._stopped:
                break
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, _MAX_BACKOFF_SECONDS)

    def _handle_message(self, raw: str) -> None:
        try:
            msg = json.loads(raw)
        except json.JSONDecodeError:
            return
        if msg.get("MessageType") != "PositionReport":
            return
        meta = msg.get("MetaData") or {}
        mmsi = str(meta.get("MMSI", "")).strip()
        if not mmsi or mmsi not in self._tracked:
            return
        report = (msg.get("Message") or {}).get("PositionReport") or {}
        true_heading = report.get("TrueHeading")
        self._cache[mmsi] = TrackedShipLive(
            lat=meta.get("Latitude"),
            lon=meta.get("Longitude"),
            sog=report.get("Sog"),
            cog=report.get("Cog"),
            # 511 is AIS's own "not available" sentinel for TrueHeading.
            true_heading=true_heading if isinstance(true_heading, int) and true_heading != 511 else None,
            nav_status=report.get("NavigationalStatus"),
            last_seen_utc=meta.get("time_utc") or _utc_now_iso(),
        )

    async def stop(self) -> None:
        """Signal run_forever() to stop reconnecting and close the socket.
        Called from main.py's lifespan shutdown."""
        self._stopped = True
        if self._ws is not None:
            await self._ws.close()


def _utc_now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


#: One instance per process, same convention as hazards/service.py's module-
#: level `service` singleton. Constructed at import time (cheap — no I/O
#: happens until run_forever() is scheduled as a task from main.py's
#: lifespan), so api/shiptracker.py can import and use it directly.
client = AisStreamClient()
