# ─────────────────────────────────────────────────────────────────────────────
# hazards/models.py — the normalised shape every hazard source is flattened into.
#
# Two feeds with nothing in common sit behind this layer: bushfire.io, an
# emergency-services platform with 46 event classifications and a four-step
# alert ladder, and USGS, which publishes earthquakes with a magnitude and not
# much else. The map should not have to care which one an event came from, so
# both are normalised to `Hazard` before they leave the backend.
#
# WHAT IS DELIBERATELY SMALL HERE. `HazardKind` has 11 values, not 46. A network
# planner needs to know "is this fire, flood, quake or storm" — the difference
# between `alarm`, `assistOtherAgency` and `rescue` is operationally meaningless
# to a cable and would only make the legend unreadable. Anything the sources
# report that does not map to one of these is dropped, not bucketed into
# `other`, so the layer stays about things that can take infrastructure down.
#
# SEVERITY IS FOUR STEPS, and both sources are forced onto them (see sources.py
# for each mapping). Keeping the ladder short is what lets one legend and one
# colour scale serve both feeds.
# ─────────────────────────────────────────────────────────────────────────────
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


class HazardKind(str, Enum):
    """What physically happened. Deliberately coarse — see the module header."""
    fire = "fire"
    flood = "flood"
    storm = "storm"
    cyclone = "cyclone"
    earthquake = "earthquake"
    tsunami = "tsunami"
    landslide = "landslide"
    marine = "marine"
    power = "power"
    hazmat = "hazmat"
    other = "other"


class HazardSeverity(str, Enum):
    """
    Four steps, ascending. Both feeds are mapped onto this ladder rather than
    onto each other: bushfire.io has its own alert levels and USGS has none at
    all (magnitude is the only signal it gives), so a shared scale is the only
    way one legend can describe both.
    """
    advisory = "advisory"
    watch = "watch"
    warning = "warning"
    emergency = "emergency"


#: Ascending, for "is this at least as serious as X" comparisons.
SEVERITY_ORDER: list[HazardSeverity] = [
    HazardSeverity.advisory,
    HazardSeverity.watch,
    HazardSeverity.warning,
    HazardSeverity.emergency,
]


def severity_rank(sev: HazardSeverity) -> int:
    """Position on the ladder; higher is worse."""
    return SEVERITY_ORDER.index(sev)


class HazardAsset(BaseModel):
    """One of our own assets that falls within range of a hazard."""
    id: str
    #: 'node' | 'segment'
    kind: str
    label: str
    #: Great-circle distance from the hazard centroid, km, rounded.
    distance_km: float


class Hazard(BaseModel):
    """
    One normalised event, ready for the map.

    `id` is prefixed with the source ("bushfire:<eKey>", "usgs:<code>") so ids
    from two feeds can never collide, and so the origin of anything odd on the
    map can be read straight off the id.
    """
    id: str
    source: str
    source_label: str
    kind: HazardKind
    severity: HazardSeverity
    title: str
    #: Plain text only — never HTML. The upstream `body` field carries markup
    #: and is deliberately not passed through; it would have to be sanitised,
    #: and nothing in this UI needs a hyperlink inside a map popup.
    detail: str = ""
    #: Link back to the issuing agency, when the source provides one.
    url: Optional[str] = None
    #: Who actually issued it — "Geoscience Australia", "USGS", a state fire
    #: service. Shown in the popup because provenance is the first thing anyone
    #: asks about an alarming red polygon.
    attribution: str = ""

    #: Centroid. Always present, even when `geometry` is a polygon, so the map
    #: can place a marker without walking the geometry.
    lat: float
    lng: float
    #: GeoJSON geometry (Point, Polygon, MultiPolygon or GeometryCollection).
    #: None when the source gave only a point — the centroid above is then the
    #: whole story.
    geometry: Optional[dict] = None

    #: ISO-8601. `reported_at` is when the agency raised it, `updated_at` when
    #: they last touched it. Both optional: not every source provides either.
    reported_at: Optional[str] = None
    updated_at: Optional[str] = None

    #: Our own assets within range. Computed server-side (see proximity.py) so
    #: every client gets the same answer and no browser has to walk 322 segment
    #: paths to find out whether a fire matters.
    affected: list[HazardAsset] = Field(default_factory=list)


class HazardSourceStatus(BaseModel):
    """
    Per-source health, surfaced to the UI.

    This exists because of the single worst failure mode this feature has: a
    layer that renders nothing looks exactly like a world with no disasters in
    it. If a feed is misconfigured or down, the UI has to be able to say so.
    """
    source: str
    label: str
    ok: bool
    #: How many hazards this source contributed after filtering.
    count: int = 0
    #: Why it failed, when it did. Safe to show a user — never contains the key.
    error: Optional[str] = None
    #: Which parts of the world this source can actually speak for. Shown in the
    #: UI so an empty map over Tokyo is not misread as "all clear".
    coverage: str = ""


class HazardFeed(BaseModel):
    """The whole payload of GET /api/hazards."""
    hazards: list[Hazard] = Field(default_factory=list)
    sources: list[HazardSourceStatus] = Field(default_factory=list)
    #: When this payload was assembled (ISO-8601), so the UI can show its age
    #: rather than implying it is live.
    fetched_at: str
    #: True when at least one source failed. The UI leans on this to show a
    #: degraded banner instead of a confident empty map.
    degraded: bool = False
