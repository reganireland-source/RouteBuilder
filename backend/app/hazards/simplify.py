# ─────────────────────────────────────────────────────────────────────────────
# hazards/simplify.py — make upstream geometry small enough to send to a browser.
#
# Fire agencies publish perimeters at survey resolution. One US fire came back
# as a GeometryCollection whose rings held thousands of vertices, and the forty-
# eight hydrated events together weighed 7.3 MB. On a world map, where a whole
# fire is a few dozen pixels, essentially all of that detail is invisible.
#
# Two reductions, both lossless as far as the map is concerned:
#
#   1. DROP THE POINTS FROM A GeometryCollection that also contains polygons.
#      Upstream mixes a centroid marker in with the perimeter; we already carry
#      a centroid on the Hazard itself, so the Point members are pure duplication.
#
#   2. RAMER-DOUGLAS-PEUCKER on every ring, with a tolerance in DEGREES. The
#      default ~0.003° is roughly 300 m — well under a pixel at the zoom levels
#      this layer is read at, and a large fraction of the vertices.
#
# Rings are never allowed to collapse below four points (three plus the repeated
# closing vertex), because a "polygon" of two points is not a polygon and Leaflet
# draws it as nothing at all — which would look exactly like a hazard that had
# gone away.
#
# Pure functions. No I/O, no models — simplification is geometry, and keeping it
# separate is what lets it be checked against a known shape.
# ─────────────────────────────────────────────────────────────────────────────
from typing import Any, Optional

#: ~300 m at the equator. Chosen against the zoom this layer is actually read
#: at, not against the source data's precision.
DEFAULT_TOLERANCE_DEG = 0.003

#: A closed ring needs three distinct corners plus the repeat of the first.
MIN_RING_POINTS = 4


def _perpendicular_distance(p: list[float], start: list[float], end: list[float]) -> float:
    """Distance from `p` to the segment start→end, in degrees (planar)."""
    x, y = p[0], p[1]
    x1, y1 = start[0], start[1]
    x2, y2 = end[0], end[1]
    dx, dy = x2 - x1, y2 - y1
    if dx == 0 and dy == 0:
        return ((x - x1) ** 2 + (y - y1) ** 2) ** 0.5
    t = ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    cx, cy = x1 + t * dx, y1 + t * dy
    return ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5


def rdp(points: list[list[float]], tolerance: float) -> list[list[float]]:
    """
    Ramer-Douglas-Peucker, iterative rather than recursive.

    Iterative on purpose: a perimeter with thousands of vertices recurses deep
    enough to be a genuine risk to the interpreter's stack, and a hazard feed
    must not be able to crash the backend by publishing a detailed polygon.
    """
    if len(points) <= 2:
        return list(points)
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        first, last = stack.pop()
        if last <= first + 1:
            continue
        worst_dist, worst_idx = 0.0, first
        for i in range(first + 1, last):
            d = _perpendicular_distance(points[i], points[first], points[last])
            if d > worst_dist:
                worst_dist, worst_idx = d, i
        if worst_dist > tolerance:
            keep[worst_idx] = True
            stack.append((first, worst_idx))
            stack.append((worst_idx, last))
    return [p for p, k in zip(points, keep, strict=True) if k]


#: Points kept when RDP flattens a ring past the point of being a polygon.
FALLBACK_RING_POINTS = 8


def _even_sample(ring: list[list[float]], count: int) -> list[list[float]]:
    """`count` points spread evenly around a ring, closed."""
    step = max(1, len(ring) // count)
    out = ring[::step][:count]
    if out[0] != out[-1]:
        out.append(out[0])
    return out


def _simplify_ring(ring: list[list[float]], tolerance: float) -> list[list[float]]:
    """
    Simplify one ring, keeping it closed and keeping it a polygon.

    When RDP flattens a ring below four points the result is not drawable, so
    something has to be put back. An earlier version restored the WHOLE original
    ring, which had a perverse effect: raising the tolerance made the output
    BIGGER, because more rings tripped the fallback and came back at full size.
    Sampling a handful of points around the original instead keeps the shape
    roughly right and the size small, and makes tolerance behave monotonically.
    """
    if len(ring) <= MIN_RING_POINTS:
        return ring
    out = rdp(ring, tolerance)
    if len(out) < MIN_RING_POINTS:
        return _even_sample(ring, FALLBACK_RING_POINTS)
    if out[0] != out[-1]:
        out.append(out[0])
    return out


def _simplify_coords(coords: Any, depth: int, tolerance: float) -> Any:
    """
    Walk down to ring level and simplify there.

    `depth` is how many list levels wrap the [x, y] pairs: a LineString's
    coordinates are a list of points (1), a Polygon's are a list of RINGS of
    points (2), a MultiPolygon's a list of polygons of rings (3). Depth 1 is
    therefore the ring — the level RDP actually operates on.

    Getting this off by one is not a subtle failure: it hands a list of rings to
    the ring simplifier, which treats each whole ring as though it were a single
    coordinate, finds nothing to remove, and returns the input untouched. The
    first version did exactly that, which is why 279,000 vertices survived a
    pass that reported success.
    """
    if depth <= 0:
        return coords
    if depth == 1:
        return _simplify_ring(coords, tolerance)
    return [_simplify_coords(c, depth - 1, tolerance) for c in coords]


_DEPTH = {
    "Point": 0,
    "MultiPoint": 1,
    "LineString": 1,
    "MultiLineString": 2,
    "Polygon": 2,
    "MultiPolygon": 3,
}


def simplify_geometry(geometry: Optional[dict], tolerance: float = DEFAULT_TOLERANCE_DEG) -> Optional[dict]:
    """
    Shrink a GeoJSON geometry for transport. Returns None for None.

    Unknown geometry types are passed through untouched — better to send
    something a little large than to mangle a shape this module does not
    understand.
    """
    if not geometry:
        return None
    gtype = geometry.get("type")

    if gtype == "GeometryCollection":
        subs = geometry.get("geometries") or []
        simplified = [simplify_geometry(g, tolerance) for g in subs]
        simplified = [g for g in simplified if g]
        # Reduction 1: once there is an area to draw, the loose Points are just
        # a centroid we already carry on the Hazard.
        has_area = any(g.get("type") in ("Polygon", "MultiPolygon") for g in simplified)
        if has_area:
            simplified = [g for g in simplified if g.get("type") not in ("Point", "MultiPoint")]
        if not simplified:
            return None
        if len(simplified) == 1:
            return simplified[0]
        return {"type": "GeometryCollection", "geometries": simplified}

    depth = _DEPTH.get(gtype)
    if depth is None or depth == 0:
        return geometry
    coords = geometry.get("coordinates")
    if not coords:
        return geometry
    return {"type": gtype, "coordinates": _simplify_coords(coords, depth, tolerance)}


def count_vertices(geometry: Optional[dict]) -> int:
    """Total coordinate pairs in a geometry — for logging what we saved."""
    if not geometry:
        return 0
    if geometry.get("type") == "GeometryCollection":
        return sum(count_vertices(g) for g in geometry.get("geometries") or [])
    total = 0

    def walk(node: Any) -> None:
        nonlocal total
        if not node:
            return
        if isinstance(node[0], (int, float)):
            total += 1
            return
        for child in node:
            walk(child)

    walk(geometry.get("coordinates"))
    return total
