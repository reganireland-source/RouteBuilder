# ─────────────────────────────────────────────────────────────────────────────
# hazards.py — the disaster overlay feed.
#
# Route prefix: /api/hazards (this router has prefix="/hazards"; main.py mounts
# it under "/api").
#
# CONDITIONAL MOUNTING: main.py only includes this router — and only runs the
# lifespan hazard-cache warm-up — when the HAZARDS_ENABLED deploy-time feature
# flag is true (the default). When it's false, neither this module's routes
# nor app/hazards/service.py's warm-on-boot ever run; that gating lives in
# main.py, not here, so this module itself is unchanged either way.
#
# A read-only proxy over two third-party feeds — bushfire.io and USGS — flattened
# to one shape, filtered to what can plausibly affect network infrastructure, and
# annotated with which of OUR nodes and segments each event sits near. The work,
# the caching and the API key all live in app/hazards/; this module is only the
# HTTP surface.
#
# WHY A PROXY AT ALL, rather than letting the browser fetch upstream: the
# bushfire.io key would otherwise have to ship in the frontend bundle, which
# would be the end of the key. The cache is the other half — one upstream call
# per TTL window however many tabs are open.
#
# Endpoints:
#   GET /api/hazards          — the current feed (cached; ?force=true to rebuild).
#   GET /api/hazards/sources  — per-source health only, no event payload.
# ─────────────────────────────────────────────────────────────────────────────
from fastapi import APIRouter, Query

from ..hazards.models import HazardFeed
from ..hazards.service import service

router = APIRouter(prefix="/hazards", tags=["hazards"])


@router.get("")
def get_hazards(force: bool = Query(False, description="Bypass the cache and refetch upstream.")) -> HazardFeed:
    """
    GET /api/hazards — every current hazard, with the assets it is near.

    Always 200, even when a source is down: the payload's `sources` and
    `degraded` fields carry that, because a 500 here would make the map look
    broken when in fact one of two feeds is simply unavailable.
    """
    return service.get(force=force)


@router.get("/sources")
def get_hazard_sources() -> dict:
    """
    GET /api/hazards/sources — source health without the events.

    For a status panel that wants to say "Bushfire.io: no API key configured"
    without pulling a megabyte of polygons to find out.
    """
    feed = service.get()
    age = service.cache_age_seconds()
    return {
        "sources": [s.model_dump() for s in feed.sources],
        "fetched_at": feed.fetched_at,
        "degraded": feed.degraded,
        "cache_age_seconds": round(age) if age is not None else None,
    }
