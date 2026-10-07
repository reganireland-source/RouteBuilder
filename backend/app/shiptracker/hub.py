# ─────────────────────────────────────────────────────────────────────────────
# shiptracker/hub.py — one place that knows every position source, merges
# their fixes, and decides which sources run.
#
# WHY MORE THAN ONE SOURCE
# aisstream.io (free) only hears ships near volunteer shore receivers; in
# measured tests it heard almost nothing in East Asian waters. Other
# providers cover more, some free (within a call allowance), some paid. So
# sources are listed in PRIORITY ORDER (`order`, free ones first by default)
# and run in one of two modes:
#
#   fallback — the first source is asked about every ship; each later source
#              is only asked about ships no earlier source has located within
#              `stale_minutes`. Free sources do what they can, paid ones only
#              fill the gaps.
#   always   — every source in the order is asked about every ship; the
#              freshest fix wins.
#
# CALL ALLOWANCES: a polled source can have a monthly call budget
# (`budgets`, defaulting to the provider's free tier, None = unlimited). The
# hub paces calls evenly over what's left of the calendar month (remaining
# calls ÷ remaining time, never closer together than the provider's rate
# limit), so a free tier is never exceeded. Within an allowance, ships the
# source was asked about least recently go first, so every ship gets a turn.
# Usage is persisted (config["ship_tracking_usage"]) so restarts don't reset it.
#
# MERGING: per ship, the freshest fix across the enabled sources wins; on a
# tie (or when timestamps are missing) the earlier source in the order wins.
# Every fix carries `source` so the UI can say where a position came from.
#
# Source KINDS: "stream" (aisstream.io — pushes fixes as they arrive, see
# ais_client.py) and "poll" (REST providers, see sources.py — checked every
# `poll_minutes`). API keys live only in environment variables, never in the
# database or the UI; a source without its key is listed but skipped.
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

DEFAULT_SETTINGS = {
    # Free sources first; paid ones are added by an admin when wanted.
    "order": ["aisstream", "marinesia", "vesselapi"],
    "mode": "fallback",
    "poll_minutes": 90,
    "stale_minutes": 180,
    # Calls per calendar month per polled source; None = unlimited. Missing
    # entries take the provider's free-tier allowance (meta "free_calls_per_month").
    "budgets": {},
}

MODES = ("fallback", "always")
MAX_BUDGET = 1_000_000


def all_source_ids() -> list[str]:
    return list(STREAM_SOURCES) + list(POLL_ADAPTERS)


def source_meta(source_id: str) -> dict:
    return STREAM_SOURCES.get(source_id) or POLL_ADAPTERS[source_id].meta


def source_configured(source_id: str) -> bool:
    if source_id == "aisstream":
        return bool(aisstream_api_key())
    adapter = POLL_ADAPTERS.get(source_id)
    return bool(adapter and adapter.configured())


def _from_legacy(raw: dict) -> dict:
    """Settings saved before priority ordering used preferred/secondary."""
    if "order" in raw or "preferred" not in raw:
        return raw
    order = [raw["preferred"]] + ([raw["secondary"]] if raw.get("secondary") not in (None, "", "none") else [])
    out = {k: v for k, v in raw.items() if k not in ("preferred", "secondary", "secondary_mode")}
    return {**out, "order": order, "mode": raw.get("secondary_mode", "fallback")}


def _int_in_range(key: str, value, lo: int, hi: int) -> int:
    try:
        n = int(value)
    except (TypeError, ValueError):
        raise ValueError(f"{key} must be a whole number.") from None
    if not lo <= n <= hi:
        raise ValueError(f"{key} must be between {lo} and {hi}.")
    return n


def _validate_budgets(raw) -> dict:
    """Every polled source gets an explicit budget (int calls/month or None)."""
    if raw is None:
        raw = {}
    if not isinstance(raw, dict):
        raise ValueError("budgets must be an object of source → calls per month.")
    unknown = set(raw) - set(POLL_ADAPTERS)
    if unknown:
        raise ValueError(f"Unknown polled source in budgets: {', '.join(sorted(unknown))}.")
    out = {}
    for sid, adapter in POLL_ADAPTERS.items():
        if sid not in raw:
            out[sid] = adapter.meta.get("free_calls_per_month")
        elif raw[sid] in (None, "", 0):
            out[sid] = None
        else:
            out[sid] = _int_in_range(f"Monthly calls for {adapter.meta['label']}", raw[sid], 1, MAX_BUDGET)
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
        raise ValueError("mode must be 'fallback' or 'always'.")
    return {
        "order": list(order),
        "mode": s["mode"],
        "poll_minutes": _int_in_range("poll_minutes", s["poll_minutes"], 1, 90),
        "stale_minutes": _int_in_range("stale_minutes", s["stale_minutes"], 5, 1440),
        "budgets": _validate_budgets(s["budgets"]),
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


def _month_key(now: float) -> str:
    return datetime.fromtimestamp(now, UTC).strftime("%Y-%m")


def _seconds_left_in_month(now: float) -> float:
    d = datetime.fromtimestamp(now, UTC)
    nxt = datetime(d.year + (d.month == 12), d.month % 12 + 1, 1, tzinfo=UTC)
    return max(nxt.timestamp() - now, 1.0)


def _iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _fix_time(live: TrackedShipLive) -> float:
    try:
        return datetime.fromisoformat((live.last_seen_utc or "").replace("Z", "+00:00")).timestamp()
    except ValueError:
        return float("-inf")


class PositionHub:
    """Per-source caches for polled providers, the merge policy, call
    allowances, throttled last-known persistence, and the poll loop. One
    instance per process."""

    def __init__(self) -> None:
        # Per polled source, created on first use (adapters can register late).
        self._poll_cache: defaultdict[str, dict[str, TrackedShipLive]] = defaultdict(dict)
        self._poll_state: defaultdict[str, dict] = defaultdict(lambda: {"last_ok": None, "last_error": None})
        self._asked: defaultdict[str, dict[str, float]] = defaultdict(dict)   # source → mmsi → last asked
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

    # ── call allowances ──────────────────────────────────────────────────
    def _usage_for(self, source_id: str, now: float) -> dict:
        """This calendar month's usage for a source (resets on a new month)."""
        if self._usage is None:
            try:
                self._usage = load_usage()
            except Exception:  # noqa: BLE001
                log.exception("Could not load ship tracking usage — starting from zero")
                self._usage = {}
        u = self._usage.get(source_id)
        if not isinstance(u, dict) or u.get("month") != _month_key(now):
            u = {"month": _month_key(now), "calls": 0, "last_call": None}
            self._usage[source_id] = u
        return u

    def _spacing(self, source_id: str, budget: int, u: dict, now: float) -> Optional[float]:
        """Seconds between calls that spreads the remaining budget over the
        rest of the month, respecting the provider's rate limit. None when
        the budget is spent."""
        remaining = budget - u["calls"]
        if remaining <= 0:
            return None
        return max(_seconds_left_in_month(now) / remaining, POLL_ADAPTERS[source_id].meta.get("min_spacing_s", 0))

    def _allowance(self, source_id: str, settings: dict, now: float) -> Optional[int]:
        """How many calls `source_id` may make right now; None = unlimited."""
        budget = settings["budgets"].get(source_id)
        if budget is None:
            return None
        u = self._usage_for(source_id, now)
        spacing = self._spacing(source_id, budget, u, now)
        if spacing is None:
            return 0
        burst = POLL_ADAPTERS[source_id].meta.get("max_burst") or budget
        due = budget if u["last_call"] is None else int((now - u["last_call"]) // spacing)
        return max(0, min(budget - u["calls"], due, burst))

    def _next_call_at(self, source_id: str, settings: dict, now: float) -> Optional[float]:
        budget = settings["budgets"].get(source_id)
        if budget is None:
            return None
        u = self._usage_for(source_id, now)
        spacing = self._spacing(source_id, budget, u, now)
        if spacing is None:
            return None
        return now if u["last_call"] is None else max(now, u["last_call"] + spacing)

    def _record_calls(self, source_id: str, n: int, now: float) -> None:
        u = self._usage_for(source_id, now)
        u["calls"] += n
        u["last_call"] = now
        try:
            save_usage(self._usage)
        except Exception:  # noqa: BLE001
            log.exception("Could not persist ship tracking usage")

    # ── polling ──────────────────────────────────────────────────────────
    def _mmsis_to_poll(self, source_id: str, settings: dict, enabled: list[str]) -> list[str]:
        """Ships to ask `source_id` about, most deserving first: ships it was
        asked about least recently, then those located least recently."""
        tracked = self.tracked()
        earlier = enabled[:enabled.index(source_id)]
        if settings["mode"] == "fallback" and earlier:
            cutoff = time.time() - settings["stale_minutes"] * 60
            need = []
            for mmsi in tracked:
                prior = self._freshest(earlier, mmsi)
                if prior is None or _fix_time(prior) < cutoff:
                    need.append(mmsi)
            tracked = need
        asked = self._asked.get(source_id, {})

        def priority(mmsi: str) -> tuple:
            fix = self.best(mmsi, settings)
            return (asked.get(mmsi, float("-inf")), _fix_time(fix) if fix else float("-inf"), mmsi)
        return sorted(tracked, key=priority)

    async def poll_once(self) -> None:
        settings = current_settings()
        enabled = self.enabled(settings)
        for source_id in enabled:
            adapter = POLL_ADAPTERS.get(source_id)
            if adapter is None:
                continue  # streaming source — nothing to poll
            mmsis = self._mmsis_to_poll(source_id, settings, enabled)
            now = time.time()
            allowance = self._allowance(source_id, settings, now)
            if allowance is not None:
                mmsis = mmsis[:allowance]
            if not mmsis:
                continue
            state = self._poll_state[source_id]
            for mmsi in mmsis:
                self._asked[source_id][mmsi] = now
            if allowance is not None:
                self._record_calls(source_id, len(mmsis), now)   # failed calls may still count against a plan
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
            self._kick.clear()
            try:
                await asyncio.wait_for(self._kick.wait(), timeout=current_settings()["poll_minutes"] * 60)
            except asyncio.TimeoutError:
                pass

    def kick(self) -> None:
        """Poll now instead of waiting out the interval — e.g. right after an
        admin changes sources, so the new choice shows results immediately.
        Call allowances still apply."""
        self._kick.set()

    def stop(self) -> None:
        self._stopped = True

    def forget(self, mmsi: str) -> None:
        for cache in self._poll_cache.values():
            cache.pop(mmsi, None)
        for asked in self._asked.values():
            asked.pop(mmsi, None)
        self._last_persisted.pop(mmsi, None)

    # ── status ───────────────────────────────────────────────────────────
    def _role(self, source_id: str, settings: dict) -> str:
        order = settings["order"]
        if source_id not in order:
            return "unused"
        enabled = self.enabled(settings)
        first = enabled[0] if enabled else order[0]   # a source without its key is skipped
        return "primary" if source_id == first else settings["mode"]

    def _usage_status(self, source_id: str, settings: dict) -> Optional[dict]:
        if source_id not in POLL_ADAPTERS:
            return None
        now = time.time()
        u = self._usage_for(source_id, now)
        nxt = self._next_call_at(source_id, settings, now)
        return {
            "calls_this_month": u["calls"],
            "budget": settings["budgets"].get(source_id),
            "next_call_utc": _iso(nxt) if nxt else None,
        }

    def _poll_detail(self, source_id: str, base: dict, settings: dict) -> dict:
        state = self._poll_state[source_id]
        usage = base["usage"]
        tail = ""
        if usage and usage["budget"] is not None and usage["calls_this_month"] >= usage["budget"]:
            tail = " · monthly allowance used — resumes next month"
        if base["role"] == "unused":
            return {**base, "status": "disabled", "detail": "Configured, not in use" + tail}
        if state["last_error"]:
            return {**base, "status": "error", "detail": state["last_error"] + tail}
        if state["last_ok"] is None:
            return {**base, "status": "checking", "detail": "Waiting for first poll" + tail}
        ago = _duration(time.monotonic() - state["last_ok"])
        return {**base, "status": "ok", "detail": f"Polled {ago} ago · {base['ships_located']}/{base['ships_tracked']} ships located" + tail}

    def _source_status(self, source_id: str, settings: dict) -> dict:
        tracked = self.tracked()
        meta = source_meta(source_id)
        base = {
            "id": source_id, "label": meta["label"], "kind": "stream" if source_id in STREAM_SOURCES else "poll",
            "env_key": meta["env_key"], "coverage": meta["coverage"], "pricing": meta["pricing"],
            "free": bool(meta.get("free")), "default_budget": meta.get("free_calls_per_month"),
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
        return self._poll_detail(source_id, base, settings)

    def sources_status(self) -> dict:
        settings = current_settings()
        return {"settings": settings, "sources": [self._source_status(sid, settings) for sid in all_source_ids()]}

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
