# ─────────────────────────────────────────────────────────────────────────────
# hazards/proximity.py — "which of our assets is this hazard near?"
#
# Pure functions: no HTTP, no FastAPI, no state. Everything here is arithmetic
# on coordinates, which is what makes it testable without a network.
#
# TWO RADII, NOT ONE, because the two asset types fail differently. A landing
# station or a terrestrial duct is a place you can point at: a fire 25 km away
# is a real threat, one 100 km away is weather. A wet segment is a line across a
# seabed, and the things that cut it — earthquakes, submarine landslides, the
# turbidity currents they set off — disturb a corridor far wider than their
# epicentre. So wet gets 100 km and everything else gets 25 km. Both are
# configurable (see service.py) because these are judgement calls, not physics.
#
# SEGMENTS ARE DENSIFIED BEFORE TESTING. A segment is stored as its two end
# nodes plus optional waypoints; testing only those points would miss a quake
# in the middle of an 8,000 km Pacific crossing, which is precisely the case
# this feature exists for. `densify_path` walks each leg in ~100 km steps so the
# whole run is covered. That is an approximation of a great-circle path by
# straight lat/lng interpolation, which drifts from the real route at high
# latitudes — acceptable here, where the answer feeds a "worth a look" badge
# rather than anything anyone navigates by.
# ─────────────────────────────────────────────────────────────────────────────
import math
from collections.abc import Iterable
from typing import Optional

from .models import HazardAsset

EARTH_RADIUS_KM = 6371.0

#: Default radii. See the module header for why they differ.
DEFAULT_NODE_RADIUS_KM = 25.0
DEFAULT_TERRESTRIAL_RADIUS_KM = 25.0
DEFAULT_WET_RADIUS_KM = 100.0

#: Spacing when walking a segment's legs. Half the tightest radius, so a hazard
#: can never slip between two sample points and be missed.
DENSIFY_STEP_KM = 12.0


def haversine_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Great-circle distance between two (lat, lng) pairs, in km."""
    lat1, lng1 = a
    lat2, lng2 = b
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    h = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng / 2) ** 2
    )
    return 2 * EARTH_RADIUS_KM * math.asin(min(1.0, math.sqrt(h)))


def densify_path(points: list[tuple[float, float]], step_km: float = DENSIFY_STEP_KM) -> list[tuple[float, float]]:
    """
    Fill in intermediate points so no gap along the path exceeds `step_km`.

    Without this, a segment from Sydney to Los Angeles is three points and a
    hazard halfway across the Pacific is thousands of km from all of them.
    """
    if len(points) < 2:
        return list(points)
    out: list[tuple[float, float]] = []
    for i in range(len(points) - 1):
        start, end = points[i], points[i + 1]
        out.append(start)
        leg = haversine_km(start, end)
        steps = int(leg // step_km)
        for s in range(1, steps + 1):
            f = s / (steps + 1)
            out.append((
                start[0] + (end[0] - start[0]) * f,
                start[1] + (end[1] - start[1]) * f,
            ))
    out.append(points[-1])
    return out


def geometry_centroid(geometry: dict) -> Optional[tuple[float, float]]:
    """
    Mean of every coordinate in a GeoJSON geometry, as (lat, lng).

    A mean rather than a true centroid: these are used to place a marker and to
    measure a rough distance, and computing real polygon centroids (let alone
    for a GeometryCollection of fire perimeters) would buy precision nothing
    downstream uses. Returns None for geometry with no usable coordinates.
    """
    coords: list[list[float]] = []

    def walk(node) -> None:
        if isinstance(node, (int, float)):
            return
        if node and isinstance(node[0], (int, float)):
            coords.append(node)  # type: ignore[arg-type]
            return
        for child in node:
            walk(child)

    if not geometry:
        return None
    if geometry.get("type") == "GeometryCollection":
        for sub in geometry.get("geometries", []):
            walk(sub.get("coordinates", []))
    else:
        walk(geometry.get("coordinates", []))

    if not coords:
        return None
    # GeoJSON is [lng, lat] — the reversal here is the single easiest thing in
    # this file to get backwards, which is why it happens in exactly one place.
    return (
        sum(c[1] for c in coords) / len(coords),
        sum(c[0] for c in coords) / len(coords),
    )


def _normalise_lng(lng: float) -> float:
    """
    Wrap a longitude difference sanely around the antimeridian.

    Distances are computed with haversine, which handles the wrap on its own, so
    this exists only for the cheap bounding-box reject below.
    """
    while lng > 180:
        lng -= 360
    while lng < -180:
        lng += 360
    return lng


def _too_far_to_bother(point: tuple[float, float], other: tuple[float, float], radius_km: float) -> bool:
    """
    Cheap rejection before paying for a haversine.

    One degree of latitude is ~111 km everywhere, so a latitude gap wider than
    the radius can be discarded outright. Longitude is not checked: it shrinks
    towards the poles and the correction is more arithmetic than the haversine
    it would save.
    """
    return abs(point[0] - other[0]) * 111.0 > radius_km


class NetworkGeometry:
    """
    Our own network, pre-chewed into the form the proximity test wants.

    Built once per request and reused across every hazard: densifying 322
    segments is far too expensive to redo for each of fifty events.
    """

    def __init__(
        self,
        nodes: Iterable[dict],
        segments: Iterable[dict],
        *,
        node_radius_km: float = DEFAULT_NODE_RADIUS_KM,
        terrestrial_radius_km: float = DEFAULT_TERRESTRIAL_RADIUS_KM,
        wet_radius_km: float = DEFAULT_WET_RADIUS_KM,
        kml_paths: Optional[dict[str, list[list[float]]]] = None,
    ) -> None:
        self.node_radius_km = node_radius_km
        self.terrestrial_radius_km = terrestrial_radius_km
        self.wet_radius_km = wet_radius_km

        self.nodes: list[tuple[str, str, float, float]] = []
        by_id: dict[str, dict] = {}
        for n in nodes:
            nid = n.get("id")
            lat, lng = n.get("lat"), n.get("lng")
            if not nid or lat is None or lng is None:
                continue
            by_id[nid] = n
            label = f"{nid} - {n['name']}" if n.get("name") else str(nid)
            self.nodes.append((nid, label, float(lat), float(_normalise_lng(float(lng)))))

        # (segment id, label, radius, densified path)
        self.segments: list[tuple[str, str, float, list[tuple[float, float]]]] = []
        #: Segment ids whose path came from a surveyed KML rather than waypoints.
        self.kml_backed: set[str] = set()
        kml_paths = kml_paths or {}

        for s in segments:
            start, end = by_id.get(s.get("start_node_id")), by_id.get(s.get("end_node_id"))
            if not start or not end:
                continue

            # PREFER A SURVEYED PATH WHEN WE HAVE ONE. "Within 100 km of a
            # cable" is only as true as the line it is measured from, and a
            # waypoint spline is an approximation drawn to avoid landmasses on
            # a map — a median of two points between two landing stations. A
            # cable that bends hundreds of km around a trench is nowhere near
            # that straight line, so a hazard sitting on the real route could be
            # reported as clear, and one far from it reported as a threat. When
            # a KML has been uploaded its path replaces the waypoints outright.
            #
            # No densify_path() on a KML path: densify exists to turn a handful
            # of waypoints into something measurable, and a surveyed route is
            # already denser than the step it would insert.
            kml_path = kml_paths.get(s.get("id"))
            if kml_path and len(kml_path) >= 2:
                path = [(float(p[0]), float(p[1])) for p in kml_path]
                self.kml_backed.add(s["id"])
            else:
                raw = [(float(start["lat"]), float(start["lng"]))]
                raw += [(float(w[0]), float(w[1])) for w in (s.get("waypoints") or [])]
                raw.append((float(end["lat"]), float(end["lng"])))
                path = densify_path(raw)

            radius = wet_radius_km if s.get("type") == "wet" else terrestrial_radius_km
            label = s.get("name") or s.get("id") or "?"
            self.segments.append((s["id"], label, radius, path))

    def assets_near(self, lat: float, lng: float) -> list[HazardAsset]:
        """
        Every node and segment within its own radius of (lat, lng), nearest
        first. Distance for a segment is to the closest point on its path.
        """
        here = (lat, _normalise_lng(lng))
        found: list[HazardAsset] = []

        for nid, label, nlat, nlng in self.nodes:
            if _too_far_to_bother(here, (nlat, nlng), self.node_radius_km):
                continue
            d = haversine_km(here, (nlat, nlng))
            if d <= self.node_radius_km:
                found.append(HazardAsset(id=nid, kind="node", label=label, distance_km=round(d, 1)))

        for sid, label, radius, path in self.segments:
            best = None
            for p in path:
                if _too_far_to_bother(here, p, radius):
                    continue
                d = haversine_km(here, p)
                if best is None or d < best:
                    best = d
                    if best <= 1.0:  # close enough that refining is pointless
                        break
            if best is not None and best <= radius:
                found.append(HazardAsset(id=sid, kind="segment", label=label, distance_km=round(best, 1)))

        found.sort(key=lambda a: a.distance_km)
        return found
