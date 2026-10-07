# ─────────────────────────────────────────────────────────────────────────────
# shiptracker/hub.py — one place that knows every position source, merges
# their fixes, and decides which sources run.
#
# WHY MORE THAN ONE SOURCE
# aisstream.io (free) only hears ships near volunteer shore receivers; in
# measured tests it heard almost nothing in East Asian waters. Commercial
# providers with large receiver networks and/or satellite AIS cover far more,
# for a fee. So sources are selectable, and two can run together:
#
#   preferred  — always used.
#   secondary  — optional. "always": runs alongside the preferred source.
#                "fallback": a polled secondary is only asked about ships the
#                preferred source hasn't located within `stale_minutes`
#                (keeps per-call costs down); a streaming secondary
#                (aisstream) costs nothing, so it simply runs.
#
# MERGING: per ship, the freshest fix across the enabled sources wins; on a
# tie (or when timestamps are missing) the preferred source wins. Every fix
# carries `source` so the UI can say where a position came from.
#
# Source KINDS: "stream" (aisstream.io — pushes fixes as they arrive, see
# ais_client.py) and "poll" (REST providers, see sources.py — asked every
# `poll_minutes` for the tracked MMSIs). API keys live only in environment
# variables, never in the database or the UI; a source without its key is
# listed but not selectable.
#
# Settings live under config["ship_tracking"] (see api/config.py for
# validation), editable by admins from the Ship Tracker dialog.
# ─────────────────────────────────────────────────────────────────────────────
import asyncio
import logging
import time
from datetime import datetime
from typing import Optional

from ..models import TrackedShipLive
from .ais_client import client as ais_client, aisstream_api_key, persist_last_known, PERSIST_EVERY_SECONDS, _duration
from .sources import POLL_ADAPTERS, SourceError

log = logging.getLogger("routebuilder.shiptracker")

STREAM_SOURCES = {
    "aisstream": {
        "label": "aisstream.io",
        "env_key": "MARITIME_AISSTREAM_API_KEY",
        "coverage": "Free · volunteer shore receivers only — patchy, very thin in East Asia",
        "pricing": "Free",
    },
}

DEFAULT_SETTINGS = {
    "preferred": "aisstream",
    "secondary": None,
    "secondary_mode": "fallback",
    "poll_minutes": 5,
    "stale_minutes": 30,
}

SECONDARY_MODES = ("fallback", "always")


def all_source_ids() -> list[str]:
    return list(STREAM_SOURCES) + list(POLL_ADAPTERS)


def source_configured(source_id: str) -> bool:
    if source_id == "aisstream":
        return bool(aisstream_api_key())
    adapter = POLL_ADAPTERS.get(source_id)
    return bool(adapter and adapter.configured())


def validate_settings(raw: dict) -> dict:
    """Merge `raw` over the defaults and validate. Raises ValueError with a
    user-facing message on anything invalid. Used by PUT /api/config."""
    s = {**DEFAULT_SETTINGS, **(raw or {})}
    known = all_source_ids()
    if s["preferred"] not in known:
        raise ValueError(f"Unknown preferred source '{s['preferred']}'.")
    if s["secondary"] in ("", "none"):
        s["secondary"] = None
    if s["secondary"] is not None:
        if s["secondary"] not in known:
            raise ValueError(f"Unknown secondary source '{s['secondary']}'.")
        if s["secondary"] == s["preferred"]:
            raise ValueError("The secondary source must differ from the preferred one.")
    if s["secondary_mode"] not in SECONDARY_MODES:
        raise ValueError("secondary_mode must be 'fallback' or 'always'.")
    for key, lo, hi in (("poll_minutes", 1, 60), ("stale_minutes", 5, 1440)):
        try:
            s[key] = int(s[key])
        except (TypeError, ValueError):
            raise ValueError(f"{key} must be a whole number.") from None
        if not lo <= s[key] <= hi:
            raise ValueError(f"{key} must be between {lo} and {hi}.")
    return {k: s[k] for k in DEFAULT_SETTINGS}


def current_settings() -> dict:
    from ..data_loader import load_config
    try:
        return validate_settings(load_config().get("ship_tracking") or {})
    except ValueError:
        log.warning("Stored ship_tracking settings invalid — using defaults")
        return dict(DEFAULT_SETTINGS)


def _fix_time(live: TrackedShipLive) -> float:
    try:
        return datetime.fromisoformat((live.last_seen_utc or "").replace("Z", "+00:00")).timestamp()
    except ValueError:
        return float("-inf")


class PositionHub:
    """Per-source caches for polled providers, the merge policy, throttled
    last-known persistence, and the poll loop. One instance per process."""

    def __init__(self) -> None:
        self._poll_cache: dict[str, dict[str, TrackedShipLive]] = {sid: {} for sid in POLL_ADAPTERS}
        self._poll_state: dict[str, dict] = {sid: {"last_ok": None, "last_error": None, "calls": 0} for sid in POLL_ADAPTERS}
        self._last_persisted: dict[str, float] = {}
        self._stopped = False
        ais_client.on_fix = self.on_fix   # aisstream fixes flow through the same persistence path

    # ── which sources are in play ────────────────────────────────────────
    def enabled(self, settings: Optional[dict] = None) -> list[str]:
        """Selected AND configured sources, preferred first."""
        s = settings or current_settings()
        return [sid for sid in (s["preferred"], s["secondary"]) if sid and source_configured(sid)]

    def _source_fix(self, source_id: str, mmsi: str) -> Optional[TrackedShipLive]:
        if source_id == "aisstream":
            return ais_client.get(mmsi)
        return self._poll_cache.get(source_id, {}).get(mmsi)

    def best(self, mmsi: str, settings: Optional[dict] = None) -> Optional[TrackedShipLive]:
        """Freshest fix across enabled sources; ties go to the preferred one
        (it comes first, and max() keeps the first of equal keys)."""
        fixes = [f for f in (self._source_fix(sid, mmsi) for sid in self.enabled(settings)) if f]
        if not fixes:
            return None
        return max(fixes, key=_fix_time)

    def tracked(self) -> list[str]:
        return sorted(ais_client._tracked)

    # ── persistence (shared by every source) ────────────────────────────
    async def on_fix(self, mmsi: str) -> None:
        """A source just updated `mmsi`: persist the merged best fix as its
        last_known, throttled per ship. Never raises."""
        now = time.monotonic()
        if now - self._last_persisted.get(mmsi, -PERSIST_EVERY_SECONDS) < PERSIST_EVERY_SECONDS:
            return
        live = self.best(mmsi)
        if live is None:
            return
        self._last_persisted[mmsi] = now
        try:
            await asyncio.to_thread(persist_last_known, mmsi, live)
        except Exception:  # noqa: BLE001
            log.exception("Could not persist last-known position for MMSI %s", mmsi)

    # ── polling ──────────────────────────────────────────────────────────
    def _mmsis_to_poll(self, source_id: str, settings: dict) -> list[str]:
        tracked = self.tracked()
        is_fallback_secondary = source_id == settings["secondary"] and settings["secondary_mode"] == "fallback"
        if not is_fallback_secondary:
            return tracked
        # Fallback: only ships the preferred source hasn't located recently.
        cutoff = time.time() - settings["stale_minutes"] * 60
        need = []
        for mmsi in tracked:
            pref = self._source_fix(settings["preferred"], mmsi)
            if pref is None or _fix_time(pref) < cutoff:
                need.append(mmsi)
        return need

    async def poll_once(self) -> None:
        settings = current_settings()
        for source_id in self.enabled(settings):
            adapter = POLL_ADAPTERS.get(source_id)
            if adapter is None:
                continue  # streaming source — nothing to poll
            mmsis = self._mmsis_to_poll(source_id, settings)
            if not mmsis:
                continue
            state = self._poll_state[source_id]
            try:
                fixes = await asyncio.to_thread(adapter.fetch, mmsis)
            except SourceError as exc:
                state["last_error"] = str(exc)[:200]
                log.warning("%s poll failed: %s", source_id, exc)
                continue
            except Exception as exc:  # noqa: BLE001 — one bad provider must not stop the loop
                state["last_error"] = f"Unexpected error: {type(exc).__name__}"
                log.exception("%s poll raised", source_id)
                continue
            state["calls"] += 1
            state["last_ok"] = time.monotonic()
            state["last_error"] = None
            for mmsi, live in fixes.items():
                self._poll_cache[source_id][mmsi] = live.model_copy(update={"source": source_id})
                await self.on_fix(mmsi)

    async def run_forever(self) -> None:
        while not self._stopped:
            try:
                await self.poll_once()
            except Exception:  # noqa: BLE001
                log.exception("ship position poll cycle failed")
            await asyncio.sleep(current_settings()["poll_minutes"] * 60)

    def stop(self) -> None:
        self._stopped = True

    def forget(self, mmsi: str) -> None:
        for cache in self._poll_cache.values():
            cache.pop(mmsi, None)
        self._last_persisted.pop(mmsi, None)

    # ── status ───────────────────────────────────────────────────────────
    def _source_status(self, source_id: str, settings: dict) -> dict:
        tracked = self.tracked()
        role = "preferred" if source_id == settings["preferred"] else (
            settings["secondary_mode"] if source_id == settings["secondary"] else "unused")
        meta = STREAM_SOURCES.get(source_id) or POLL_ADAPTERS[source_id].meta
        base = {
            "id": source_id, "label": meta["label"], "kind": "stream" if source_id in STREAM_SOURCES else "poll",
            "env_key": meta["env_key"], "coverage": meta["coverage"], "pricing": meta["pricing"],
            "configured": source_configured(source_id), "role": role,
            "ships_located": sum(1 for m in tracked if self._source_fix(source_id, m)),
            "ships_tracked": len(tracked),
        }
        if not base["configured"]:
            return {**base, "status": "disabled", "detail": f"Not configured ({meta['env_key']})"}
        if source_id == "aisstream":
            st = ais_client.status()
            return {**base, "status": st["status"], "detail": st["detail"]}
        state = self._poll_state[source_id]
        if role == "unused":
            return {**base, "status": "disabled", "detail": "Configured, not selected"}
        if state["last_error"]:
            return {**base, "status": "error", "detail": state["last_error"]}
        if state["last_ok"] is None:
            return {**base, "status": "checking", "detail": "Waiting for first poll"}
        ago = _duration(time.monotonic() - state["last_ok"])
        return {**base, "status": "ok", "detail": f"Polled {ago} ago · {base['ships_located']}/{len(tracked)} ships located"}

    def sources_status(self) -> dict:
        settings = current_settings()
        return {"settings": settings, "sources": [self._source_status(sid, settings) for sid in all_source_ids()]}

    def summary(self) -> dict:
        """One-line roll-up for the bottom status bar and AisFeedLine."""
        settings = current_settings()
        statuses = {s["id"]: s for s in self.sources_status()["sources"]}
        tracked = self.tracked()
        located = sum(1 for m in tracked if self.best(m, settings))
        pref = statuses[settings["preferred"]]
        parts = [f"{pref['label']}: {pref['detail']}"]
        if settings["secondary"]:
            sec = statuses[settings["secondary"]]
            parts.append(f"{sec['label']} ({settings['secondary_mode']}): {sec['detail']}")
        in_use = [statuses[sid] for sid in (settings["preferred"], settings["secondary"]) if sid]
        if any(s["status"] == "ok" for s in in_use):
            status = "ok"
        elif all(s["status"] == "disabled" for s in in_use):
            status = "disabled"
        elif any(s["status"] == "error" for s in in_use):
            status = "error"
        else:
            status = "checking"
        fixes = [f for f in (self.best(m, settings) for m in tracked) if f]
        latest = max(fixes, key=_fix_time).last_seen_utc if fixes else None
        return {
            "status": status,
            "detail": f"{located}/{len(tracked)} ships located · " + " · ".join(parts),
            "connected_since": ais_client.status().get("connected_since"),
            "ships_heard": located,
            "ships_tracked": len(tracked),
            "last_ping_utc": latest,
        }


hub = PositionHub()
