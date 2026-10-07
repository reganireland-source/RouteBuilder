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
import re
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
#: Persist a ship's latest fix as its last_known at most this often, so a
#: ship broadcasting every few seconds costs one DB write per window, not
#: one per broadcast.
PERSIST_EVERY_SECONDS = 300.0
#: AIS position-report message types — each carries speed/course/heading.
_POSITION_TYPES = ("PositionReport", "StandardClassBPositionReport", "ExtendedClassBPositionReport")
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
        # Connection health, read by GET /api/health/sources for the status
        # bar. `_started` distinguishes "still connecting" from "never ran".
        self._started = False
        self._connected = False
        self._last_error: Optional[str] = None
        self._last_report_monotonic: Optional[float] = None
        # Set by shiptracker/hub.py: every fix is handed to the hub, which
        # merges sources and owns last-known persistence.
        self.on_fix = None
        # When this process first got a working connection, and when any
        # tracked ship was last heard — both ISO UTC, for the status line.
        self._connected_since: Optional[str] = None
        self._listening_since_monotonic: Optional[float] = None
        self._last_ping_utc: Optional[str] = None

    # ── reads (sync — safe to call from a request handler) ────────────────
    def get(self, mmsi: str) -> Optional[TrackedShipLive]:
        return self._cache.get(mmsi)

    def get_all(self) -> dict[str, TrackedShipLive]:
        return dict(self._cache)

    def status(self) -> dict:
        """Connection health for the status bar and Ship Tracker: ok / error /
        checking / disabled, a one-line detail, and the raw facts behind it
        (connected_since, ships_heard/ships_tracked, last_ping_utc) so the UI
        can tell "backend broken" apart from "ships just not heard yet".
        Reads in-memory state only."""
        facts = {
            "connected_since": self._connected_since,
            "ships_tracked": len(self._tracked),
            "ships_heard": sum(1 for m in self._tracked if m in self._cache),
            "last_ping_utc": self._last_ping_utc,
        }
        if not aisstream_api_key():
            return {"status": "disabled", "detail": "Not configured (MARITIME_AISSTREAM_API_KEY)", **facts}
        if self._connected:
            detail = f"Connected · {facts['ships_heard']}/{facts['ships_tracked']} ships heard since restart"
            if self._listening_since_monotonic is not None:
                detail += f" · listening {_duration(time.monotonic() - self._listening_since_monotonic)}"
            if self._last_report_monotonic is not None:
                detail += f" · last ping {_duration(time.monotonic() - self._last_report_monotonic)} ago"
            return {"status": "ok", "detail": detail, **facts}
        if self._last_error:
            return {"status": "error", "detail": self._last_error, **facts}
        return {"status": "checking", "detail": "Connecting…" if self._started else "Not started", **facts}

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
        self._started = True
        while not self._stopped:
            self._reconnect_requested.clear()
            try:
                async with websockets.connect(AISSTREAM_URL, open_timeout=10) as ws:
                    self._ws = ws
                    await ws.send(json.dumps({
                        "APIKey": api_key,
                        "BoundingBoxes": GLOBAL_BBOX,
                        "FiltersShipMMSI": sorted(self._tracked),
                        # No FilterMessageTypes: the MMSI filter already keeps
                        # volume tiny, and on aisstream.io's patchy free
                        # coverage every message type is a chance at a fix —
                        # static-data frames carry a position in MetaData too.
                    }))
                    self._connected = True
                    if self._connected_since is None:
                        self._connected_since = _utc_now_iso()
                        self._listening_since_monotonic = time.monotonic()
                    log.info("aisstream.io connected, tracking %d ship(s).", len(self._tracked))
                    backoff = _INITIAL_BACKOFF_SECONDS  # reset after a successful connect
                    async for raw in ws:
                        if self._reconnect_requested.is_set():
                            break
                        updated = self._handle_message(raw)
                        if updated and self.on_fix:
                            await self.on_fix(updated)
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 — any failure here must not crash the app; just retry
                self._last_error = f"Connection error: {exc}"[:200]
                log.warning("aisstream.io connection error, retrying in %.0fs: %s", backoff, exc)
            finally:
                self._ws = None
                self._connected = False
            if self._stopped:
                break
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, _MAX_BACKOFF_SECONDS)

    def _handle_message(self, raw: str) -> Optional[str]:
        """Apply one aisstream.io frame to the cache. Returns the MMSI whose
        position was updated, or None if the frame changed nothing."""
        try:
            msg = json.loads(raw)
        except json.JSONDecodeError:
            return None
        # aisstream.io reports a rejected subscription (e.g. an invalid API
        # key) as {"error": "..."} and then closes the socket.
        if isinstance(msg, dict) and msg.get("error"):
            self._last_error = f"aisstream.io: {msg['error']}"[:200]
            log.warning("aisstream.io rejected subscription: %s", msg["error"])
            return None
        msg_type = msg.get("MessageType")
        meta = msg.get("MetaData") or {}
        mmsi = str(meta.get("MMSI", "")).strip()
        if not msg_type or not mmsi or mmsi not in self._tracked:
            return None
        lat, lon = meta.get("Latitude"), meta.get("Longitude")
        if not _valid_position(lat, lon):
            return None
        seen = _iso_from_aisstream(meta.get("time_utc"))
        if msg_type in _POSITION_TYPES:
            report = (msg.get("Message") or {}).get(msg_type) or {}
            true_heading = report.get("TrueHeading")
            live = TrackedShipLive(
                lat=lat, lon=lon,
                sog=report.get("Sog"),
                cog=report.get("Cog"),
                # 511 is AIS's own "not available" sentinel for TrueHeading.
                true_heading=true_heading if isinstance(true_heading, int) and true_heading != 511 else None,
                # Class B reports have no navigational status.
                nav_status=report.get("NavigationalStatus"),
                last_seen_utc=seen,
            )
        else:
            # Any other frame (static data, safety messages, ...) still tells us
            # where the ship was heard; keep the last known motion fields.
            prev = self._cache.get(mmsi)
            live = (prev.model_copy(update={"lat": lat, "lon": lon, "last_seen_utc": seen})
                    if prev else TrackedShipLive(lat=lat, lon=lon, last_seen_utc=seen))
        self._cache[mmsi] = live.model_copy(update={"source": "aisstream"})
        self._last_ping_utc = seen
        self._last_report_monotonic = time.monotonic()
        self._last_error = None
        return mmsi

    async def stop(self) -> None:
        """Signal run_forever() to stop reconnecting and close the socket.
        Called from main.py's lifespan shutdown."""
        self._stopped = True
        if self._ws is not None:
            await self._ws.close()


def _valid_position(lat, lon) -> bool:
    """AIS uses 91/181 for "not available", and (0, 0) is the classic
    unset-GPS artefact — neither is a real fix."""
    if not isinstance(lat, (int, float)) or not isinstance(lon, (int, float)):
        return False
    if lat == 0 and lon == 0:
        return False
    return -90 <= lat <= 90 and -180 <= lon <= 180


def persist_last_known(mmsi: str, live: TrackedShipLive) -> None:
    """Write `live` as the stored ship's last_known. Skips silently if the
    ship has been removed in the meantime, so a late write can't resurrect it."""
    from ..data_loader import load_ships, upsert_ship
    ship = next((s for s in load_ships() if s.mmsi == mmsi), None)
    if ship is not None:
        upsert_ship(ship.model_copy(update={"last_known": live}))


_AISSTREAM_TIME = re.compile(r"^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})")


def _iso_from_aisstream(raw) -> str:
    """aisstream.io's time_utc looks like "2026-10-07 13:00:00.318 +0000 UTC",
    which browsers' Date() can't parse. Normalise to ISO 8601 UTC; fall back
    to now if it's missing or unrecognised."""
    m = _AISSTREAM_TIME.match(raw) if isinstance(raw, str) else None
    return f"{m.group(1)}T{m.group(2)}Z" if m else _utc_now_iso()


def _duration(seconds: float) -> str:
    """Compact human duration: 45s, 12m, 2h 14m, 3d 4h."""
    s = int(seconds)
    if s < 60:
        return f"{s}s"
    m = s // 60
    if m < 60:
        return f"{m}m"
    h, m = divmod(m, 60)
    if h < 48:
        return f"{h}h {m}m"
    d, h = divmod(h, 24)
    return f"{d}d {h}h"


def _utc_now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


#: One instance per process, same convention as hazards/service.py's module-
#: level `service` singleton. Constructed at import time (cheap — no I/O
#: happens until run_forever() is scheduled as a task from main.py's
#: lifespan), so api/shiptracker.py can import and use it directly.
client = AisStreamClient()
