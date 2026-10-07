# ─────────────────────────────────────────────────────────────────────────────
# shiptracker/hub.py — one place that knows every position source, merges
# their fixes, and decides which source asks about which ship, when.
#
# WHY MORE THAN ONE SOURCE
# aisstream.io (free) only hears ships near volunteer shore receivers; in
# measured tests it heard almost nothing in East Asian waters. Other
# providers cover more, some free within call limits, some paid. Sources are
# listed in PRIORITY ORDER (`order`, free first by default) and run in one of
# three modes:
#
#   share    — (default) round robin. Every source with call limits (the free
#              tiers) takes its turn as soon as its limits allow, and each
#              turn goes to the ship that has gone longest without a fresh
#              position, so the free capacity of all sources adds up and no
#              two sources chase the same ship. A source that recently came
#              back empty-handed for a ship (e.g. out of its coverage) leaves
#              that ship to the others for MISS_COOLDOWN. Sources without
#              limits (paid) only fill gaps: ships with nothing fresher than
#              `stale_minutes`.
#   fallback — the first source is asked about every ship; each later source
#              only about ships no earlier source has located within
#              `stale_minutes`.
#   always   — every source is asked about every ship; the freshest fix wins.
#
# LIMITS & BUSY HOURS: see schedule.py. Each polled source has per-hour and
# per-month call limits (its free tier by default), never exceeded; monthly
# allowances are spread with more calls in busy hours (`peak`, default
# 04:00–20:00 SGT ×1.5). Sources without limits are checked every
# `poll_minutes` in busy hours and `poll_minutes × weight` otherwise. The loop
# sleeps until the next source is due, so free capacity is never left unused.
# Usage is persisted (config["ship_tracking_usage"]) so restarts don't reset it.
#
# MERGING: per ship, the freshest fix across the enabled sources wins; on a
# tie (or when timestamps are missing) the earlier source in the order wins.
# Every fix carries `source` so the UI can say where a position came from.
#
# API keys live only in environment variables, never in the database or the
# UI; a source without its key is listed but skipped.
#
# Settings live under config["ship_tracking"] (see api/config.py for
# validation), editable by admins from the Ship Tracker dialog.
# ─────────────────────────────────────────────────────────────────────────────
import asyncio
import logging
import time
from collections import defaultdict
from datetime import UTC, datetime
from typing import Optional

from ..models import TrackedShipLive
from . import schedule
from .ais_client import client as ais_client, aisstream_api_key, persist_last_known, PERSIST_EVERY_SECONDS, _duration
from .sources import POLL_ADAPTERS, SourceError

log = logging.getLogger("routebuilder.shiptracker")

STREAM_SOURCES = {
    "aisstream": {
        "label": "aisstream.io",
        "env_key": "MARITIME_AISSTREAM_API_KEY",
        "coverage": "Volunteer shore receivers only — patchy, very thin in East Asia",
        "pricing": "Free",
        "free": True,
    },
}

DEFAULT_PEAK = {"start_hour": 4, "end_hour": 20, "utc_offset": 8, "weight": 1.5}   # 04:00–20:00 SGT

DEFAULT_SETTINGS = {
    # Free sources first; paid ones are added by an admin when wanted.
    "order": ["aisstream", "marinesia", "vesselapi"],
    "mode": "share",
    # Sources without call limits: check interval in busy hours (minutes).
    "poll_minutes": 90,
    "stale_minutes": 180,
    # Per polled source {"per_month", "per_hour"}; missing → its free tier.
    "limits": {},
    "peak": DEFAULT_PEAK,
}

MODES = ("share", "fallback", "always")
MAX_LIMIT = 1_000_000
MISS_COOLDOWN = 12 * 3600       # share mode: leave a ship a source couldn't find to the others this long
MIN_SLEEP, MAX_SLEEP = 30, 90 * 60
SAME_PASS_S = 60                # share mode: asked within this long = taken in the current pass

# Built-in monthly defaults before per-hour limits existed — a stored value
# equal to one of these was never an admin's choice, so it maps to the new default.
_LEGACY_DEFAULT_BUDGETS = {"marinesia": 700, "vesselapi": 150}


def all_source_ids() -> list[str]:
    return list(STREAM_SOURCES) + list(POLL_ADAPTERS)


def source_meta(source_id: str) -> dict:
    return STREAM_SOURCES.get(source_id) or POLL_ADAPTERS[source_id].meta


def free_limits(source_id: str) -> dict:
    fl = POLL_ADAPTERS[source_id].meta.get("free_limits") or {}
    return {"per_month": fl.get("per_month"), "per_hour": fl.get("per_hour")}


def source_configured(source_id: str) -> bool:
    if source_id == "aisstream":
        return bool(aisstream_api_key())
    adapter = POLL_ADAPTERS.get(source_id)
    return bool(adapter and adapter.configured())


# ── settings ─────────────────────────────────────────────────────────────────

def _from_legacy(raw: dict) -> dict:
    """Older stored shapes: preferred/secondary, and monthly `budgets`."""
    out = dict(raw)
    if "order" not in out and "preferred" in out:
        sec = out.get("secondary")
        out["order"] = [out["preferred"]] + ([sec] if sec not in (None, "", "none") else [])
        out["mode"] = out.get("secondary_mode", "fallback")
    if "limits" not in out and isinstance(out.get("budgets"), dict):
        # Saved before round robin existed, when "fallback" was the default:
        # adopt the new default so free sources take turns.
        if out.get("mode") == "fallback":
            out["mode"] = "share"
        out["limits"] = {
            sid: {"per_month": v}
            for sid, v in out["budgets"].items()
            if sid in POLL_ADAPTERS and v != _LEGACY_DEFAULT_BUDGETS.get(sid)
        }
    for k in ("preferred", "secondary", "secondary_mode", "budgets"):
        out.pop(k, None)
    return out


def _int_in_range(key: str, value, lo: int, hi: int) -> int:
    try:
        n = int(value)
    except (TypeError, ValueError):
        raise ValueError(f"{key} must be a whole number.") from None
    if not lo <= n <= hi:
        raise ValueError(f"{key} must be between {lo} and {hi}.")
    return n


def _validate_limits(raw) -> dict:
    """Every polled source gets explicit {"per_month", "per_hour"} (int or None)."""
    raw = raw or {}
    if not isinstance(raw, dict):
        raise ValueError("limits must be an object of source → {per_month, per_hour}.")
    unknown = set(raw) - set(POLL_ADAPTERS)
    if unknown:
        raise ValueError(f"Unknown polled source in limits: {', '.join(sorted(unknown))}.")
    out = {}
    for sid in POLL_ADAPTERS:
        lim = {**free_limits(sid), **(raw.get(sid) or {})}
        label = POLL_ADAPTERS[sid].meta["label"]
        out[sid] = {
            kind: None if lim.get(kind) in (None, "", 0) else _int_in_range(f"{label} calls {kind.replace('_', ' ')}", lim[kind], 1, MAX_LIMIT)
            for kind in ("per_month", "per_hour")
        }
    return out


def _validate_peak(raw) -> dict:
    p = {**DEFAULT_PEAK, **(raw if isinstance(raw, dict) else {})}
    out = {
        "start_hour": _int_in_range("Busy hours start", p["start_hour"], 0, 23),
        "end_hour": _int_in_range("Busy hours end", p["end_hour"], 0, 24),
        "utc_offset": _int_in_range("Busy hours UTC offset", p["utc_offset"], -12, 14),
    }
    try:
        w = round(float(p["weight"]), 2)
    except (TypeError, ValueError):
        raise ValueError("Busy-hours boost must be a number.") from None
    if not 1.0 <= w <= 4.0:
        raise ValueError("Busy-hours boost must be between 1 and 4.")
    out["weight"] = w
    return out


def validate_settings(raw: dict) -> dict:
    """Merge `raw` over the defaults and validate. Raises ValueError with a
    user-facing message on anything invalid. Used by PUT /api/config."""
    s = {**DEFAULT_SETTINGS, **_from_legacy(raw or {})}
    known = all_source_ids()
    order = s["order"]
    if not isinstance(order, list) or not order:
        raise ValueError("Choose at least one position source.")
    for sid in order:
        if sid not in known:
            raise ValueError(f"Unknown position source '{sid}'.")
    if len(set(order)) != len(order):
        raise ValueError("Each source can appear only once in the order.")
    if s["mode"] not in MODES:
        raise ValueError("mode must be 'share', 'fallback' or 'always'.")
    return {
        "order": list(order),
        "mode": s["mode"],
        "poll_minutes": _int_in_range("poll_minutes", s["poll_minutes"], 1, 90),
        "stale_minutes": _int_in_range("stale_minutes", s["stale_minutes"], 5, 1440),
        "limits": _validate_limits(s["limits"]),
        "peak": _validate_peak(s["peak"]),
    }


def current_settings() -> dict:
    from ..data_loader import load_config
    try:
        return validate_settings(load_config().get("ship_tracking") or {})
    except ValueError:
        log.warning("Stored ship_tracking settings invalid — using defaults")
        return validate_settings({})


def load_usage() -> dict:
    from ..data_loader import load_config
    usage = load_config().get("ship_tracking_usage")
    return dict(usage) if isinstance(usage, dict) else {}


def save_usage(usage: dict) -> None:
    from ..data_loader import load_config, save_config
    config = dict(load_config())
    config["ship_tracking_usage"] = usage
    save_config(config)


def _iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _fix_time(live: TrackedShipLive) -> float:
    try:
        return datetime.fromisoformat((live.last_seen_utc or "").replace("Z", "+00:00")).timestamp()
    except ValueError:
        return float("-inf")


def _limited(settings: dict, source_id: str) -> bool:
    lim = settings["limits"].get(source_id) or {}
    return lim.get("per_month") is not None or lim.get("per_hour") is not None


class PositionHub:
    """Per-source caches for polled providers, the merge policy, the call
    scheduler, throttled last-known persistence, and the poll loop. One
    instance per process."""

    def __init__(self) -> None:
        # Per polled source, created on first use (adapters can register late).
        self._poll_cache: defaultdict[str, dict[str, TrackedShipLive]] = defaultdict(dict)
        self._poll_state: defaultdict[str, dict] = defaultdict(lambda: {"last_ok": None, "last_error": None, "last_poll": None})
        self._asked: defaultdict[str, dict[str, float]] = defaultdict(dict)    # source → mmsi → last asked
        self._missed: defaultdict[str, dict[str, float]] = defaultdict(dict)   # source → mmsi → last came back empty
        self._last_asked: dict[str, float] = {}                                # mmsi → last asked by any source
        self._usage: Optional[dict] = None   # loaded lazily from config
        self._last_persisted: dict[str, float] = {}
        self._stopped = False
        self._kick = asyncio.Event()
        ais_client.on_fix = self.on_fix   # aisstream fixes flow through the same persistence path

    # ── which sources are in play ────────────────────────────────────────
    def enabled(self, settings: Optional[dict] = None) -> list[str]:
        """Sources in the priority order that have their API key set."""
        s = settings or current_settings()
        return [sid for sid in s["order"] if sid in all_source_ids() and source_configured(sid)]

    def _source_fix(self, source_id: str, mmsi: str) -> Optional[TrackedShipLive]:
        if source_id == "aisstream":
            return ais_client.get(mmsi)
        return self._poll_cache.get(source_id, {}).get(mmsi)

    def _freshest(self, source_ids: list[str], mmsi: str) -> Optional[TrackedShipLive]:
        fixes = [f for f in (self._source_fix(sid, mmsi) for sid in source_ids) if f]
        return max(fixes, key=_fix_time) if fixes else None   # max() keeps the first of equal keys

    def best(self, mmsi: str, settings: Optional[dict] = None) -> Optional[TrackedShipLive]:
        """Freshest fix across enabled sources; ties go to the earlier one."""
        return self._freshest(self.enabled(settings), mmsi)

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

    # ── call limits ──────────────────────────────────────────────────────
    def _usage_for(self, source_id: str, now: float) -> dict:
        """This calendar month's usage for a source (resets on a new month;
        the rolling hour of recent calls carries over)."""
        if self._usage is None:
            try:
                self._usage = load_usage()
            except Exception:  # noqa: BLE001
                log.exception("Could not load ship tracking usage — starting from zero")
                self._usage = {}
        u = self._usage.get(source_id)
        if not isinstance(u, dict):
            u = {}
        if u.get("month") != schedule.month_key(now):
            u = {"month": schedule.month_key(now), "calls": 0, "last_call": None, "recent": schedule.recent_calls(u, now)}
        u.setdefault("recent", [])
        self._usage[source_id] = u
        return u

    def _record_calls(self, source_id: str, n: int, now: float) -> None:
        u = self._usage_for(source_id, now)
        u["calls"] += n
        u["last_call"] = now
        u["recent"] = schedule.recent_calls(u, now) + [now] * n
        try:
            save_usage(self._usage)
        except Exception:  # noqa: BLE001
            log.exception("Could not persist ship tracking usage")

    def _unlimited_interval(self, settings: dict, now: float) -> float:
        """Poll interval for sources without limits: tighter in busy hours."""
        base = settings["poll_minutes"] * 60
        return base if schedule.is_peak(now, settings["peak"]) else base * settings["peak"]["weight"]

    def _next_due(self, source_id: str, settings: dict, now: float) -> Optional[float]:
        if _limited(settings, source_id):
            return schedule.next_call_at(settings["limits"][source_id], self._usage_for(source_id, now), now, settings["peak"])
        last = self._poll_state[source_id]["last_poll"]
        return now if last is None else last + self._unlimited_interval(settings, now)

    def _allowance(self, source_id: str, settings: dict, now: float) -> Optional[int]:
        """Calls `source_id` may make right now; None = no limits, but then
        only once its poll interval is up (returns 0 before that)."""
        if _limited(settings, source_id):
            return schedule.allowance(settings["limits"][source_id], self._usage_for(source_id, now), now, settings["peak"])
        due = self._next_due(source_id, settings, now)
        return None if due is not None and due <= now else 0

    # ── choosing ships ───────────────────────────────────────────────────
    def _stale(self, mmsis: list[str], sources: list[str], settings: dict) -> list[str]:
        """Ships none of `sources` has located within stale_minutes."""
        cutoff = time.time() - settings["stale_minutes"] * 60
        out = []
        for mmsi in mmsis:
            fix = self._freshest(sources, mmsi)
            if fix is None or _fix_time(fix) < cutoff:
                out.append(mmsi)
        return out

    def _last_refreshed(self, mmsi: str, settings: dict) -> float:
        """When this ship was last asked about or heard from, whichever is later."""
        fix = self.best(mmsi, settings)
        return max(self._last_asked.get(mmsi, float("-inf")), _fix_time(fix) if fix else float("-inf"))

    def _share_queue(self, source_id: str, settings: dict, now: float) -> list[str]:
        """Round robin: longest-unrefreshed ship first; ships this source
        recently couldn't find go last, so they're left to other sources."""
        missed = self._missed[source_id]

        def key(mmsi: str) -> tuple:
            recently_missed = now - missed.get(mmsi, float("-inf")) < MISS_COOLDOWN
            return (recently_missed, self._last_refreshed(mmsi, settings), mmsi)
        # A ship another source just asked about in this same pass is theirs.
        fresh_turn = [m for m in self.tracked() if now - self._last_asked.get(m, float("-inf")) >= SAME_PASS_S]
        return sorted(fresh_turn, key=key)

    def _own_queue(self, source_id: str, ships: list[str], settings: dict) -> list[str]:
        """Ships this source was asked about least recently first, then those
        located least recently."""
        asked = self._asked[source_id]

        def key(mmsi: str) -> tuple:
            fix = self.best(mmsi, settings)
            return (asked.get(mmsi, float("-inf")), _fix_time(fix) if fix else float("-inf"), mmsi)
        return sorted(ships, key=key)

    def _mmsis_to_poll(self, source_id: str, settings: dict, enabled: list[str], now: float) -> list[str]:
        mode = settings["mode"]
        if mode == "share":
            if _limited(settings, source_id):
                return self._share_queue(source_id, settings, now)
            return self._own_queue(source_id, self._stale(self.tracked(), enabled, settings), settings)
        ships = self.tracked()
        earlier = enabled[:enabled.index(source_id)]
        if mode == "fallback" and earlier:
            ships = self._stale(ships, earlier, settings)
        return self._own_queue(source_id, ships, settings)

    # ── polling ──────────────────────────────────────────────────────────
    async def _poll_source(self, source_id: str, mmsis: list[str], limited: bool, now: float) -> None:
        adapter = POLL_ADAPTERS[source_id]
        state = self._poll_state[source_id]
        state["last_poll"] = now
        for mmsi in mmsis:
            self._asked[source_id][mmsi] = now
            self._last_asked[mmsi] = now
        if limited:
            self._record_calls(source_id, len(mmsis), now)   # failed calls may still count against a plan
        try:
            fixes = await asyncio.to_thread(adapter.fetch, mmsis)
        except SourceError as exc:
            state["last_error"] = str(exc)[:200]
            log.warning("%s poll failed: %s", source_id, exc)
            return
        except Exception as exc:  # noqa: BLE001 — one bad provider must not stop the loop
            state["last_error"] = f"Unexpected error: {type(exc).__name__}"
            log.exception("%s poll raised", source_id)
            return
        state["last_ok"] = time.monotonic()
        state["last_error"] = None
        for mmsi in mmsis:
            if mmsi in fixes:
                self._missed[source_id].pop(mmsi, None)
            else:
                self._missed[source_id][mmsi] = now
        for mmsi, live in fixes.items():
            self._poll_cache[source_id][mmsi] = live.model_copy(update={"source": source_id})
            await self.on_fix(mmsi)

    async def poll_once(self) -> None:
        """Give every source that's due its turn. Sources go in priority
        order; each marks the ships it asked about, so the next source in
        the same pass picks different ones."""
        settings = current_settings()
        enabled = self.enabled(settings)
        for source_id in enabled:
            if source_id not in POLL_ADAPTERS:
                continue  # streaming source — nothing to poll
            now = time.time()
            allowance = self._allowance(source_id, settings, now)
            if allowance == 0:
                continue
            mmsis = self._mmsis_to_poll(source_id, settings, enabled, now)
            if allowance is not None:
                mmsis = mmsis[:allowance]
            if mmsis:
                await self._poll_source(source_id, mmsis, _limited(settings, source_id), now)
            elif not _limited(settings, source_id):
                self._poll_state[source_id]["last_poll"] = now   # nothing needed this round

    def seconds_until_next_poll(self, settings: Optional[dict] = None) -> float:
        settings = settings or current_settings()
        now = time.time()
        dues = [d for d in (self._next_due(sid, settings, now) for sid in self.enabled(settings) if sid in POLL_ADAPTERS) if d is not None]
        wait = min(dues) - now if dues else MAX_SLEEP
        return min(MAX_SLEEP, max(MIN_SLEEP, wait + 1))

    async def run_forever(self) -> None:
        while not self._stopped:
            try:
                await self.poll_once()
            except Exception:  # noqa: BLE001
                log.exception("ship position poll cycle failed")
            self._kick.clear()
            try:
                wait = self.seconds_until_next_poll()
            except Exception:  # noqa: BLE001
                log.exception("could not schedule next ship poll")
                wait = MAX_SLEEP
            try:
                await asyncio.wait_for(self._kick.wait(), timeout=wait)
            except asyncio.TimeoutError:
                pass

    def kick(self) -> None:
        """Poll now instead of waiting — e.g. right after an admin changes
        sources, so the new choice shows results immediately. Call limits
        still apply."""
        self._kick.set()

    def stop(self) -> None:
        self._stopped = True

    def forget(self, mmsi: str) -> None:
        for per_source in (*self._poll_cache.values(), *self._asked.values(), *self._missed.values()):
            per_source.pop(mmsi, None)
        self._last_asked.pop(mmsi, None)
        self._last_persisted.pop(mmsi, None)

    # ── status ───────────────────────────────────────────────────────────
    def _role(self, source_id: str, settings: dict) -> str:
        order = settings["order"]
        if source_id not in order:
            return "unused"
        if settings["mode"] == "share":
            return "share" if source_id in STREAM_SOURCES or _limited(settings, source_id) else "fallback"
        enabled = self.enabled(settings)
        first = enabled[0] if enabled else order[0]   # a source without its key is skipped
        return "primary" if source_id == first else settings["mode"]

    def _usage_status(self, source_id: str, settings: dict) -> Optional[dict]:
        if source_id not in POLL_ADAPTERS:
            return None
        now = time.time()
        u = self._usage_for(source_id, now)
        lim = settings["limits"][source_id]
        nxt = self._next_due(source_id, settings, now) if source_id in self.enabled(settings) else None
        return {
            "calls_this_month": u["calls"],
            "calls_last_hour": len(schedule.recent_calls(u, now)),
            "per_month": lim["per_month"],
            "per_hour": lim["per_hour"],
            "next_call_utc": _iso(nxt) if nxt else None,
        }

    def _poll_detail(self, source_id: str, base: dict) -> dict:
        state = self._poll_state[source_id]
        usage = base["usage"]
        tail = ""
        if usage and usage["per_month"] is not None and usage["calls_this_month"] >= usage["per_month"]:
            tail = " · monthly allowance used — resumes next month"
        if base["role"] == "unused":
            return {**base, "status": "disabled", "detail": "Configured, not in use" + tail}
        if state["last_error"]:
            return {**base, "status": "error", "detail": state["last_error"] + tail}
        if state["last_ok"] is None:
            return {**base, "status": "checking", "detail": "Waiting for first turn" + tail}
        ago = _duration(time.monotonic() - state["last_ok"])
        return {**base, "status": "ok", "detail": f"Polled {ago} ago · {base['ships_located']}/{base['ships_tracked']} ships located" + tail}

    def _source_status(self, source_id: str, settings: dict) -> dict:
        tracked = self.tracked()
        meta = source_meta(source_id)
        base = {
            "id": source_id, "label": meta["label"], "kind": "stream" if source_id in STREAM_SOURCES else "poll",
            "env_key": meta["env_key"], "coverage": meta["coverage"], "pricing": meta["pricing"],
            "free": bool(meta.get("free")),
            "free_limits": free_limits(source_id) if source_id in POLL_ADAPTERS else None,
            "configured": source_configured(source_id), "role": self._role(source_id, settings),
            "ships_located": sum(1 for m in tracked if self._source_fix(source_id, m)),
            "ships_tracked": len(tracked),
            "usage": self._usage_status(source_id, settings),
        }
        if not base["configured"]:
            return {**base, "status": "disabled", "detail": f"Not configured ({meta['env_key']})"}
        if source_id == "aisstream":
            st = ais_client.status()
            return {**base, "status": st["status"], "detail": st["detail"]}
        return self._poll_detail(source_id, base)

    def refresh_estimate(self, settings: dict) -> Optional[dict]:
        """Share mode: combined free call rate and how often each ship gets
        a turn, in busy and quiet hours. None outside share mode or with no
        limited source enabled."""
        if settings["mode"] != "share":
            return None
        now = time.time()
        rates = [schedule.source_rates(settings["limits"][sid], settings["peak"], now)
                 for sid in self.enabled(settings) if sid in POLL_ADAPTERS and _limited(settings, sid)]
        rates = [r for r in rates if r]
        if not rates:
            return None
        busy, quiet = sum(r[0] for r in rates), sum(r[1] for r in rates)
        n = len(self.tracked())
        return {
            "busy_calls_per_hour": round(busy, 2),
            "quiet_calls_per_hour": round(quiet, 2),
            "busy_hours_per_ship": round(n / busy, 1) if n and busy else None,
            "quiet_hours_per_ship": round(n / quiet, 1) if n and quiet else None,
        }

    def sources_status(self) -> dict:
        settings = current_settings()
        return {
            "settings": settings,
            "sources": [self._source_status(sid, settings) for sid in all_source_ids()],
            "estimate": self.refresh_estimate(settings),
            "busy_now": schedule.is_peak(time.time(), settings["peak"]),
        }

    def summary(self) -> dict:
        """One-line roll-up for the bottom status bar and AisFeedLine."""
        settings = current_settings()
        statuses = {s["id"]: s for s in self.sources_status()["sources"]}
        tracked = self.tracked()
        located = sum(1 for m in tracked if self.best(m, settings))
        in_use = [statuses[sid] for sid in settings["order"] if sid in statuses]
        parts = [f"{s['label']}: {s['detail']}" for s in in_use if s["configured"]]
        if not parts:
            parts = ["no configured source in use"]
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
