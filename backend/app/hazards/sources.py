# ─────────────────────────────────────────────────────────────────────────────
# hazards/sources.py — the two upstream feeds, flattened to `Hazard`.
#
# Both are read with `urllib.request` from the standard library rather than
# httpx or requests. The backend has no HTTP client dependency today and this
# feature is not a good enough reason to add one to a deployed service: two GET
# requests with a timeout is the entire requirement.
#
#
# ── bushfire.io ──────────────────────────────────────────────────────────────
# An emergency-services platform. Rich, but its coverage was measured before
# this was written and it is NOT global:
#
#     global (1820) == au (334) + na (1423) + eu (63), exactly.
#     as  -> HTTP 200 with an empty FeatureCollection.
#     af, sa, an, usa, ca -> HTTP 500 "unsupported region and event combination".
#
# So this source speaks for Australia, North America and Europe and nowhere
# else, which leaves most of an Asia-Pacific network unwatched. That gap is why
# USGS is here too, and why every source reports its own `coverage` string to
# the UI — an empty map over Tokyo must not read as "all clear".
#
# WHAT `simple=true` STRIPS, which matters because two things depend on it: the
# cheap response carries no `eHash` and no `bodyPlain`. So geometry caching is
# keyed on (eKey, geometrySize, timestampReported) instead — `geometrySize` is
# the footprint's area and changes exactly when the polygon does, which is the
# only change the geometry cache cares about — and the plain-text detail is
# recovered by stripping tags from `body`.
#
# THE TWO-PASS FETCH is the other thing worth knowing. Asking for the three
# regions with full polygons is 73.6 MB, to extract about fifty events that
# matter. Asking with `simple=true&points=true` is 2.12 MB and keeps every one
# of them, because the filter only reads properties. So: DISCOVER cheaply, filter
# hard, then HYDRATE real geometry one event at a time via /v1/event/detail —
# and cache each hydration under the event's `eHash`, which upstream changes
# whenever the event does, so an unchanged fire is never fetched twice.
#
#
# ── USGS ─────────────────────────────────────────────────────────────────────
# Free, keyless, global, and 62 KB for a week of M4.5+ quakes. It covers exactly
# what bushfire.io misses: measured against this network, it puts hazards near
# 33 Japanese nodes, 10 Taiwanese, and others in Indonesia, Guam, NZ and
# Vanuatu — every one of which bushfire.io reports nothing for. Earthquakes are
# also the single most common cause of subsea cable faults, so for a wet network
# this is arguably the more important of the two feeds.
# ─────────────────────────────────────────────────────────────────────────────
import json
import logging
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Optional

from .models import Hazard, HazardKind, HazardSeverity
from .proximity import geometry_centroid
from .simplify import count_vertices, simplify_geometry

log = logging.getLogger("routebuilder.hazards")

DEFAULT_BUSHFIRE_URL = "https://api.bushfire.io"
DEFAULT_USGS_URL = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson"

#: Regions bushfire.io actually serves. The others 500 or come back empty —
#: measured, not guessed. See the module header.
BUSHFIRE_REGIONS = ("au", "na", "eu")

#: bushfire.io classifications that can plausibly take network infrastructure
#: down, mapped to our own coarse kinds. Everything else the feed carries —
#: shark, medical, schoolClosure, ambulance, alarm and thirty more — is dropped
#: rather than bucketed, so the layer stays about infrastructure.
BUSHFIRE_KIND_MAP: dict[str, HazardKind] = {
    "bushfire": HazardKind.fire,
    "fire": HazardKind.fire,
    "flood": HazardKind.flood,
    "storm": HazardKind.storm,
    "damagingWinds": HazardKind.storm,
    "cycloneTornado": HazardKind.cyclone,
    "tornado": HazardKind.cyclone,
    "earthquake": HazardKind.earthquake,
    "tsunami": HazardKind.tsunami,
    "landslide": HazardKind.landslide,
    "fallenPowerLines": HazardKind.power,
    "utilitySupply": HazardKind.power,
    "damFailure": HazardKind.flood,
    "hazardousMaterial": HazardKind.hazmat,
    "marine": HazardKind.marine,
    "marineAccident": HazardKind.marine,
    "damagingSurf": HazardKind.marine,
    "abnormalHighTide": HazardKind.marine,
}

#: Their four-step alert ladder onto ours. `advice` and `communityUpdate` map to
#: advisory; the default filter floor sits above them (see service.py).
BUSHFIRE_SEVERITY_MAP: dict[str, HazardSeverity] = {
    "communityUpdate": HazardSeverity.advisory,
    "advice": HazardSeverity.advisory,
    "watchAndAct": HazardSeverity.watch,
    "emergencyWarning": HazardSeverity.warning,
    "evacuateImmediately": HazardSeverity.emergency,
}

#: An event in one of these states is over; drawing it as a live hazard would
#: be actively misleading.
BUSHFIRE_DEAD_STATUSES = {"closed"}


class SourceError(RuntimeError):
    """Upstream could not be read. Message is safe to show a user."""


#: Both feeds sit behind a CDN, and bushfire.io's Cloudflare in particular
#: returns 403 to urllib's default `Python-urllib/3.x` User-Agent while serving
#: the identical request from curl. Identifying ourselves properly is both the
#: fix and the polite thing to do when calling someone else's API.
#: Concurrent /event/detail requests. Small on purpose — see _hydrate.
HYDRATION_WORKERS = 4

USER_AGENT = "RouteBuilder/1.0 (subsea network planning; +https://github.com/reganireland-source/RouteBuilder)"


#: Both feed URLs are configurable through environment variables, and
#: urllib.request.urlopen honours `file:` and `ftp:` as happily as `https:`.
#: A mistyped or hostile BUSHFIRE_API_URL must not be able to turn this into a
#: local file read, so the scheme is checked before the request is made.
ALLOWED_SCHEMES = ("http", "https")


def _get_json(url: str, *, timeout: float, headers: Optional[dict[str, str]] = None) -> Any:
    scheme = urllib.parse.urlparse(url).scheme.lower()
    if scheme not in ALLOWED_SCHEMES:
        raise SourceError(f"refusing to fetch a {scheme or 'schemeless'} URL")
    merged = {"User-Agent": USER_AGENT, "Accept": "application/json"}
    merged.update(headers or {})
    req = urllib.request.Request(url, headers=merged)  # noqa: S310 — scheme checked above
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310 — scheme checked above
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        # Deliberately does NOT include the response body or the request
        # headers: the Authorization header carries the API key and this string
        # ends up in a log and on a user's screen.
        raise SourceError(f"HTTP {exc.code} from upstream") from exc
    except urllib.error.URLError as exc:
        raise SourceError(f"could not reach upstream: {exc.reason}") from exc
    except (TimeoutError, json.JSONDecodeError) as exc:
        raise SourceError(f"bad response from upstream: {type(exc).__name__}") from exc


# ── bushfire.io ──────────────────────────────────────────────────────────────

class BushfireSource:
    """
    Reads bushfire.io. Needs `BUSHFIRE_API_KEY`; without it the source reports
    itself unconfigured rather than failing the whole feed.
    """

    name = "bushfire"
    label = "Bushfire.io"
    coverage = "Australia, North America and Europe only — no Asian, African or South American coverage."

    def __init__(self, api_key: str, base_url: str = DEFAULT_BUSHFIRE_URL, timeout: float = 45.0) -> None:
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        #: (eKey, geometrySize, timestampReported) -> geometry. Survives between
        #: polls, so a fire whose footprint has not moved is never re-fetched.
        self._geometry_cache: dict[tuple, dict] = {}

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.api_key}", "Accept": "application/json"}

    def fetch(self, min_severity_rank: int, severity_rank) -> list[Hazard]:
        """Discover cheaply across every served region, filter, then hydrate."""
        candidates: list[dict] = []
        for region in BUSHFIRE_REGIONS:
            url = f"{self.base_url}/v1/data/{region}/warnings?simple=true&points=true"
            payload = _get_json(url, timeout=self.timeout, headers=self._headers())
            candidates.extend(payload.get("features") or [])

        hazards: list[Hazard] = []
        for feature in candidates:
            hazard = self._to_hazard(feature)
            if hazard is None:
                continue
            if severity_rank(hazard.severity) < min_severity_rank:
                continue
            hazards.append(hazard)

        self._hydrate(hazards, candidates)
        return hazards

    def _to_hazard(self, feature: dict) -> Optional[Hazard]:
        props = feature.get("properties") or {}
        if props.get("visible") is False:
            return None
        if props.get("eventStatus") in BUSHFIRE_DEAD_STATUSES:
            return None

        kind = BUSHFIRE_KIND_MAP.get(props.get("eventClassification") or "")
        if kind is None:
            return None
        severity = BUSHFIRE_SEVERITY_MAP.get(props.get("alertLevel") or "")
        if severity is None:
            return None

        geometry = feature.get("geometry") or props.get("geometry")
        centre = geometry_centroid(geometry) if geometry else None
        if centre is None:
            return None

        e_key = props.get("eKey") or ""
        if not e_key:
            return None

        detail = (props.get("bodyPlain") or "").strip() or _plain_text(props.get("body") or "")
        return Hazard(
            id=f"bushfire:{e_key}",
            source=self.name,
            source_label=self.label,
            kind=kind,
            severity=severity,
            title=props.get("title") or "Untitled event",
            detail=detail,
            url=props.get("attributionUrl") or _first_authority_url(props),
            attribution=props.get("attribution") or _first_authority_name(props) or self.label,
            lat=centre[0],
            lng=centre[1],
            geometry=None,  # filled by _hydrate
            reported_at=props.get("timestampReported"),
            updated_at=props.get("timestampUpdatedByAgency") or props.get("timestampRetrieved"),
        )

    def _hydrate(self, hazards: list[Hazard], candidates: list[dict]) -> None:
        """
        Swap each surviving hazard's point for its real geometry.

        Keyed on (eKey, geometrySize, timestampReported). `eHash` would be the
        natural key and was the first attempt, but `simple=true` does not return
        it — the lookup silently missed every time and nothing was ever
        hydrated. `geometrySize` is the footprint's area in sq km, so it moves
        precisely when the polygon moves, which is the only change this cache
        needs to notice.

        A hydration failure is deliberately non-fatal: the hazard keeps its
        centroid and draws as a point, which is worse than a polygon and far
        better than vanishing off the map.
        """
        keys: dict[str, tuple] = {}
        for feature in candidates:
            props = feature.get("properties") or {}
            e_key = props.get("eKey")
            if e_key:
                keys[f"bushfire:{e_key}"] = (
                    e_key, props.get("geometrySize"), props.get("timestampReported"),
                )

        wanted: list[tuple[Hazard, tuple]] = []
        for hazard in hazards:
            key = keys.get(hazard.id)
            if key is not None:
                wanted.append((hazard, key))

        misses = [(h, k) for h, k in wanted if k not in self._geometry_cache]

        def pull(item: tuple[Hazard, tuple]) -> tuple[tuple, Optional[dict]]:
            hazard, key = item
            try:
                detail = _get_json(
                    f"{self.base_url}/v1/event/detail/{key[0]}",
                    timeout=self.timeout,
                    headers=self._headers(),
                )
            except SourceError as exc:
                log.warning("hazard geometry hydration failed for %s: %s", hazard.id, exc)
                return key, None
            return key, _detail_geometry(detail)

        # Concurrently, because these are ~50 independent round trips and doing
        # them in series took 63 seconds — long enough that the first request
        # after a restart looked like a hang. Four at a time is polite to a
        # small upstream while still turning a minute into a few seconds.
        if misses:
            with ThreadPoolExecutor(max_workers=HYDRATION_WORKERS) as pool:
                for key, raw_geometry in pool.map(pull, misses):
                    if raw_geometry is None:
                        continue
                    before = count_vertices(raw_geometry)
                    slim = simplify_geometry(raw_geometry)
                    if slim is None:
                        continue
                    if before > count_vertices(slim):
                        log.debug("simplified %s: %d -> %d vertices", key[0], before, count_vertices(slim))
                    self._geometry_cache[key] = slim

        fresh: dict[tuple, dict] = {}
        for hazard, key in wanted:
            geometry = self._geometry_cache.get(key)
            if geometry is None:
                continue
            hazard.geometry = geometry
            fresh[key] = geometry
            centre = geometry_centroid(geometry)
            if centre:
                hazard.lat, hazard.lng = centre
        # Drop anything no longer live so the cache cannot grow without bound.
        self._geometry_cache = fresh


_TAG_RE = re.compile(r"<[^>]+>")


def _plain_text(html: str) -> str:
    """
    `body` is a restricted-HTML string and `simple=true` omits the plain-text
    twin, so tags are stripped here. This is for DISPLAY ONLY and the result is
    rendered as a text node by the client, never as markup — stripping tags is
    not sanitising, and nothing downstream should treat it as though it were.
    """
    if not html:
        return ""
    text = _TAG_RE.sub(" ", html)
    text = (text.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
                .replace("&quot;", '"').replace("&#39;", "'").replace("&nbsp;", " "))
    return " ".join(text.split())


def _detail_geometry(detail: Any) -> Optional[dict]:
    """
    Pull the current geometry out of an /event/detail response.

    The response is NOT a GeoJSON document, which is the trap here: it is
    `{history: [...], latest: Feature, latestEHash, active, geometrySize}`,
    where `latest` is the Feature carrying the current footprint and `history`
    is every prior revision. Reading `latest` is both correct and far cheaper
    than the whole history — one fire came back with 17 revisions of an 18 KB
    GeometryCollection. The other shapes are still handled in case the endpoint
    ever returns plain GeoJSON.
    """
    if not isinstance(detail, dict):
        return None
    latest = detail.get("latest")
    if isinstance(latest, dict) and latest.get("geometry"):
        return latest["geometry"]
    history = detail.get("history") or []
    if history and isinstance(history[0], dict):
        event = history[0].get("event") or {}
        if event.get("geometry"):
            return event["geometry"]
    if detail.get("type") == "FeatureCollection":
        feats = detail.get("features") or []
        return (feats[0].get("geometry") if feats else None)
    if detail.get("type") == "Feature":
        return detail.get("geometry")
    if "geometry" in detail:
        return detail["geometry"]
    props = detail.get("properties") or {}
    return props.get("geometry")


def _authorities(props: dict) -> list[dict]:
    prov = props.get("provinance") or props.get("provenance") or {}
    return prov.get("authorities") or []


def _first_authority_url(props: dict) -> Optional[str]:
    for a in _authorities(props):
        if a.get("url"):
            return a["url"]
    return None


def _first_authority_name(props: dict) -> Optional[str]:
    for a in _authorities(props):
        if a.get("name"):
            return a["name"]
    return None


# ── USGS ─────────────────────────────────────────────────────────────────────

class UsgsSource:
    """
    Global earthquakes, free and keyless.

    Severity is derived from magnitude because USGS publishes no alert ladder
    of its own (its `alert` field is the PAGER impact estimate and is null for
    the overwhelming majority of events). The thresholds below are chosen for a
    SUBSEA network: M5.5 is about where seabed disturbance and cable faults
    start being plausible, M6.5 is where they become likely. A tsunami flag
    promotes the event a step regardless, since that is a distinct and
    cable-relevant hazard the magnitude alone does not capture.
    """

    name = "usgs"
    label = "USGS"
    coverage = "Worldwide earthquakes, magnitude 4.5 and above, past 7 days."

    def __init__(self, feed_url: str = DEFAULT_USGS_URL, timeout: float = 30.0) -> None:
        self.feed_url = feed_url
        self.timeout = timeout

    def fetch(self, min_severity_rank: int, severity_rank) -> list[Hazard]:
        payload = _get_json(self.feed_url, timeout=self.timeout)
        hazards: list[Hazard] = []
        for feature in payload.get("features") or []:
            hazard = self._to_hazard(feature)
            if hazard is None:
                continue
            if severity_rank(hazard.severity) < min_severity_rank:
                continue
            hazards.append(hazard)
        return hazards

    def _to_hazard(self, feature: dict) -> Optional[Hazard]:
        props = feature.get("properties") or {}
        geom = feature.get("geometry") or {}
        coords = geom.get("coordinates") or []
        if len(coords) < 2:
            return None
        mag = props.get("mag")
        if mag is None:
            return None

        tsunami = bool(props.get("tsunami"))
        severity = _magnitude_severity(float(mag), tsunami)
        code = props.get("code") or props.get("ids") or str(props.get("time"))
        depth_km = coords[2] if len(coords) > 2 else None

        detail_bits = [f"Magnitude {mag} ({props.get('magType') or 'unknown scale'})"]
        if depth_km is not None:
            detail_bits.append(f"Depth {depth_km:g} km")
        if props.get("place"):
            detail_bits.append(str(props["place"]))
        if tsunami:
            detail_bits.append("Tsunami evaluation issued for this event.")

        return Hazard(
            id=f"usgs:{code}",
            source=self.name,
            source_label=self.label,
            kind=HazardKind.tsunami if tsunami else HazardKind.earthquake,
            severity=severity,
            title=props.get("title") or f"M{mag} earthquake",
            detail=" · ".join(detail_bits),
            url=props.get("url"),
            attribution="United States Geological Survey",
            lat=float(coords[1]),
            lng=float(coords[0]),
            geometry=None,  # USGS publishes epicentres — a point IS the datum
            reported_at=_epoch_ms_to_iso(props.get("time")),
            updated_at=_epoch_ms_to_iso(props.get("updated")),
        )


def _magnitude_severity(mag: float, tsunami: bool) -> HazardSeverity:
    """Magnitude to our ladder, with a tsunami flag worth one step."""
    if mag >= 6.5:
        base = HazardSeverity.emergency
    elif mag >= 5.5:
        base = HazardSeverity.warning
    elif mag >= 4.5:
        base = HazardSeverity.watch
    else:
        base = HazardSeverity.advisory
    if not tsunami:
        return base
    bump = {
        HazardSeverity.advisory: HazardSeverity.watch,
        HazardSeverity.watch: HazardSeverity.warning,
        HazardSeverity.warning: HazardSeverity.emergency,
        HazardSeverity.emergency: HazardSeverity.emergency,
    }
    return bump[base]


def _epoch_ms_to_iso(value: Any) -> Optional[str]:
    """USGS timestamps are epoch milliseconds; everything else here is ISO."""
    if value is None:
        return None
    try:
        from datetime import UTC, datetime
        return datetime.fromtimestamp(float(value) / 1000.0, tz=UTC).isoformat()
    except (TypeError, ValueError, OSError):
        return None


def bushfire_api_key() -> str:
    return os.getenv("BUSHFIRE_API_KEY", "").strip()


def bushfire_base_url() -> str:
    return os.getenv("BUSHFIRE_API_URL", DEFAULT_BUSHFIRE_URL).strip() or DEFAULT_BUSHFIRE_URL


def usgs_feed_url() -> str:
    return os.getenv("USGS_FEED_URL", DEFAULT_USGS_URL).strip() or DEFAULT_USGS_URL
