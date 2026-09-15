# ─────────────────────────────────────────────────────────────────────────────
# hazards/service.py — assemble the hazard feed, and cache it.
#
# Fetching happens HERE, once per TTL window, not per browser. Two reasons, and
# the second is the one that matters:
#
#   1. The API key never leaves the server. If the browser called bushfire.io
#      directly the key would be in the bundle, which would be the end of it.
#   2. Rate and courtesy. A hundred open tabs is one upstream call, not a
#      hundred — and upstream here is a small emergency-services outfit and a
#      public USGS feed, neither of which should be hammered because a telco
#      left a dashboard open.
#
# ONE SOURCE FAILING MUST NOT TAKE THE FEED DOWN. USGS is keyless and reliable;
# bushfire.io needs a key that may be missing, expired, or unentitled. So each
# source is fetched inside its own try, reports its own status, and the payload
# carries `degraded` so the UI can say "one feed is down" instead of drawing an
# empty map that reads as "no disasters anywhere".
# ─────────────────────────────────────────────────────────────────────────────
import logging
import os
import threading
import time
from datetime import UTC, datetime

from ..data_loader import load_nodes, load_segments
from .models import (
    Hazard,
    HazardFeed,
    HazardSeverity,
    HazardSourceStatus,
    severity_rank,
)
from .proximity import (
    DEFAULT_NODE_RADIUS_KM,
    DEFAULT_TERRESTRIAL_RADIUS_KM,
    DEFAULT_WET_RADIUS_KM,
    NetworkGeometry,
)
from .sources import (
    BushfireSource,
    SourceError,
    UsgsSource,
    bushfire_api_key,
    bushfire_base_url,
    usgs_feed_url,
)

log = logging.getLogger("routebuilder.hazards")

#: How long an assembled feed is served before it is rebuilt. Ten minutes is a
#: deliberate middle: emergency agencies do not revise a warning every minute,
#: and the upstream discovery pass is ~2 MB, which is not something to spend
#: every thirty seconds.
DEFAULT_TTL_SECONDS = 600

#: Default severity floor. `watch` is bushfire.io's "Watch and Act" and USGS
#: M4.5+ — the level agreed as worth a planner's attention. Advisories are
#: fetched and then dropped here rather than never requested, because neither
#: upstream offers a severity filter.
DEFAULT_MIN_SEVERITY = HazardSeverity.watch


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, "").strip() or default)
    except ValueError:
        log.warning("%s is not a number; using %s", name, default)
        return default


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, "").strip() or default)
    except ValueError:
        log.warning("%s is not a number; using %s", name, default)
        return default


def min_severity() -> HazardSeverity:
    raw = os.getenv("HAZARDS_MIN_SEVERITY", "").strip()
    try:
        return HazardSeverity(raw) if raw else DEFAULT_MIN_SEVERITY
    except ValueError:
        log.warning("HAZARDS_MIN_SEVERITY=%r is not a known severity; using %s", raw, DEFAULT_MIN_SEVERITY.value)
        return DEFAULT_MIN_SEVERITY


class HazardService:
    """Owns the sources, the cache and the lock. One instance per process."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._cached: HazardFeed | None = None
        self._cached_at: float = 0.0
        # Held across polls so its per-eHash geometry cache survives; rebuilt
        # when the key or URL changes underneath us.
        self._bushfire: BushfireSource | None = None
        self._bushfire_signature: tuple[str, str] | None = None

    # ── cache ────────────────────────────────────────────────────────────
    def get(self, *, force: bool = False) -> HazardFeed:
        ttl = _env_int("HAZARDS_TTL_SECONDS", DEFAULT_TTL_SECONDS)
        with self._lock:
            fresh_enough = (
                self._cached is not None
                and not force
                and (time.monotonic() - self._cached_at) < ttl
            )
            if fresh_enough:
                return self._cached  # type: ignore[return-value]
            feed = self._build()
            self._cached = feed
            self._cached_at = time.monotonic()
            return feed

    def cache_age_seconds(self) -> float | None:
        if self._cached is None:
            return None
        return time.monotonic() - self._cached_at

    # ── assembly ─────────────────────────────────────────────────────────
    def _bushfire_source(self) -> BushfireSource | None:
        key, url = bushfire_api_key(), bushfire_base_url()
        if not key:
            return None
        if self._bushfire is None or self._bushfire_signature != (key, url):
            self._bushfire = BushfireSource(key, url)
            self._bushfire_signature = (key, url)
        return self._bushfire

    def _build(self) -> HazardFeed:
        floor = severity_rank(min_severity())
        hazards: list[Hazard] = []
        statuses: list[HazardSourceStatus] = []

        bushfire = self._bushfire_source()
        if bushfire is None:
            statuses.append(HazardSourceStatus(
                source="bushfire", label="Bushfire.io", ok=False, count=0,
                error="No API key configured (set BUSHFIRE_API_KEY).",
                coverage=BushfireSource.coverage,
            ))
        else:
            statuses.append(self._run(bushfire, floor, hazards))

        statuses.append(self._run(UsgsSource(usgs_feed_url()), floor, hazards))

        # Both feeds can carry the same earthquake — USGS publishes globally and
        # bushfire.io relays Geoscience Australia. Prefer the more severe copy,
        # then the one with real geometry, so the dedupe never loses detail.
        hazards = _dedupe(hazards)
        self._attach_assets(hazards)
        hazards.sort(key=lambda h: (-severity_rank(h.severity), h.title))

        return HazardFeed(
            hazards=hazards,
            sources=statuses,
            fetched_at=datetime.now(UTC).isoformat(),
            degraded=any(not s.ok for s in statuses),
        )

    def _run(self, source, floor: int, sink: list[Hazard]) -> HazardSourceStatus:
        try:
            found = source.fetch(floor, severity_rank)
        except SourceError as exc:
            log.warning("hazard source %s failed: %s", source.name, exc)
            return HazardSourceStatus(
                source=source.name, label=source.label, ok=False,
                error=str(exc), coverage=source.coverage,
            )
        except Exception as exc:  # noqa: BLE001 — a bad feed must not 500 the app
            log.exception("hazard source %s raised", source.name)
            return HazardSourceStatus(
                source=source.name, label=source.label, ok=False,
                error=f"Unexpected error: {type(exc).__name__}", coverage=source.coverage,
            )
        sink.extend(found)
        return HazardSourceStatus(
            source=source.name, label=source.label, ok=True,
            count=len(found), coverage=source.coverage,
        )

    def _attach_assets(self, hazards: list[Hazard]) -> None:
        """Work out which of our nodes and segments each hazard sits near."""
        try:
            # load_nodes()/load_segments() hand back Pydantic models; the
            # geometry helper works in plain dicts so it stays testable without
            # importing the app's model layer.
            nodes = [n.model_dump() for n in load_nodes()]
            segments = [s.model_dump() for s in load_segments()]
        except Exception:  # noqa: BLE001
            log.exception("could not load network for hazard proximity")
            return
        geometry = NetworkGeometry(
            nodes, segments,
            node_radius_km=_env_float("HAZARDS_NODE_RADIUS_KM", DEFAULT_NODE_RADIUS_KM),
            terrestrial_radius_km=_env_float("HAZARDS_TERRESTRIAL_RADIUS_KM", DEFAULT_TERRESTRIAL_RADIUS_KM),
            wet_radius_km=_env_float("HAZARDS_WET_RADIUS_KM", DEFAULT_WET_RADIUS_KM),
        )
        for hazard in hazards:
            hazard.affected = geometry.assets_near(hazard.lat, hazard.lng)


def _dedupe(hazards: list[Hazard]) -> list[Hazard]:
    """
    Collapse the same real-world event reported by BOTH feeds.

    Only ever merges across sources, never within one. That restriction is the
    whole correctness of this function: an earlier version matched on position
    alone and quietly ate 24 of 41 genuine Californian fires, because a cluster
    of separate fires in the same range rounds to the same grid cell. One source
    reporting two events a few km apart means two events; it is only when two
    DIFFERENT feeds describe something at the same place that a duplicate is
    plausible.

    Matched on kind plus a ~0.1° grid (roughly 11 km) because the feeds share no
    identifier. The winner is the more severe report, and between equals the one
    that brought real geometry.
    """
    best: dict[tuple, Hazard] = {}
    out: list[Hazard] = []
    for h in hazards:
        key = (h.kind, round(h.lat, 1), round(h.lng, 1))
        current = best.get(key)
        if current is None:
            best[key] = h
            out.append(h)
            continue
        if current.source == h.source:
            # Same feed: two real events that happen to be near each other.
            out.append(h)
            continue
        better_severity = severity_rank(h.severity) > severity_rank(current.severity)
        same_severity_more_detail = (
            severity_rank(h.severity) == severity_rank(current.severity)
            and h.geometry is not None and current.geometry is None
        )
        if better_severity or same_severity_more_detail:
            out[out.index(current)] = h
            best[key] = h
    return out


#: Process-wide instance. The cache is only useful if it is shared.
service = HazardService()


def warm_in_background() -> None:
    """
    Build the hazard cache once at startup, off the main thread.

    Without this, the first request after a deploy pays the full cold build —
    about nineteen seconds, most of it hydrating fire perimeters. That is bad
    enough for one caller, but the cache is behind a lock, so a handful of
    browsers prefetching at once would queue on it and hold a FastAPI worker
    thread each for the duration. Doing the work before anyone asks means the
    first real request is a cache hit.

    Daemon thread, and every failure is swallowed: a third-party feed being down
    must never stop this service from starting. The endpoint will simply build
    on demand and report whatever went wrong through the usual source status.
    """
    if os.getenv("HAZARDS_WARM_ON_BOOT", "").strip().lower() == "false":
        log.info("hazard cache warm-up disabled (HAZARDS_WARM_ON_BOOT=false)")
        return

    def run() -> None:
        started = time.monotonic()
        try:
            feed = service.get()
        except Exception:  # noqa: BLE001 — never let a feed take down boot
            log.exception("hazard cache warm-up failed; will build on demand")
            return
        log.info(
            "hazard cache warmed in %.1fs — %d hazards, %d near the network%s",
            time.monotonic() - started,
            len(feed.hazards),
            sum(1 for h in feed.hazards if h.affected),
            " (degraded)" if feed.degraded else "",
        )

    threading.Thread(target=run, name="hazard-warmup", daemon=True).start()
