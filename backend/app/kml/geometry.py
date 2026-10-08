"""
Turning a parsed KML path into the two things the app actually stores: a
simplified path for the overview map, and the measurements that let a human
judge whether the file belongs to the segment it was matched to.

WHY TWO RESOLUTIONS. The frontend fetches every segment in one call at boot.
Today that payload is 180 KB, because waypoints are hand-placed hints — 267 of
them across the entire network, a median of 2 per segment. A survey-grade KML
carries thousands of points for ONE segment, so shipping full resolution for all
322 would be an estimated 10-15 MB on every page load, to draw detail that is
invisible at world zoom. So each upload produces:

  display_path — simplified to a point budget, rides along in /api/segments and
                 is what the overview map draws.
  full_path    — every point as supplied, served per segment on demand when you
                 open or zoom one.

The simplifier is the RDP implementation already used to cut hazard perimeters
down (hazards/simplify.py) rather than a second one, with the tolerance searched
rather than fixed: KML density varies by orders of magnitude between a hand-drawn
route and an RPL export, so one hard-coded tolerance would either mangle the
sparse files or fail to shrink the dense ones.

ORIENTATION IS NOT GIVEN. A KML records a path, not a direction of travel: a file
for the same cable may run A→Z or Z→A depending on who drew it. Measuring the
endpoint gaps in only the stored order would report a perfectly good file as
being thousands of km out of place. So both orientations are measured and the
better one wins, and the caller is told when the path was reversed.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from ..hazards.proximity import haversine_km
from ..hazards.simplify import rdp

#: Most points a display path may carry. A 2,600 km cable is drawn across a few
#: hundred pixels at world zoom, so 150 points is already finer than the screen
#: can show; it keeps the whole-network payload in the low hundreds of KB.
DISPLAY_POINT_BUDGET = 150

#: Bounds for the tolerance search, in degrees. 1e-7 is ~1 cm (finer than any
#: survey) and 5° is coarse enough to flatten any path to a straight line, so
#: the answer is always inside the bracket.
_TOLERANCE_MIN_DEG = 1e-7
_TOLERANCE_MAX_DEG = 5.0
#: Binary-search steps. ~30 halvings of that bracket resolve the tolerance far
#: more finely than the point count can distinguish.
_TOLERANCE_PASSES = 30
#: Stop early once the result is at least this fraction of the budget — the
#: point is to USE the budget, not to hit it exactly.
_BUDGET_FILL = 0.9

#: Beyond this, an endpoint is called out for review rather than quietly accepted.
#: A KML legitimately stops at the beach manhole rather than the station, which is
#: typically a few km; tens of km means it is probably the wrong segment.
ENDPOINT_WARN_KM = 10.0


@dataclass
class PathGeometry:
    """Everything derived from one KML path, ready to store."""
    full_path: list[list[float]]
    display_path: list[list[float]]
    length_km: float
    #: Distance from the path's ends to the segment's A/Z nodes, after
    #: orientation has been resolved.
    a_end_gap_km: Optional[float] = None
    z_end_gap_km: Optional[float] = None
    #: True when the file's points had to be reversed to line up A→Z.
    reversed_to_match: bool = False

    @property
    def needs_review(self) -> bool:
        """Either end further from its node than a beach manhole would explain."""
        return any(
            gap is not None and gap > ENDPOINT_WARN_KM
            for gap in (self.a_end_gap_km, self.z_end_gap_km)
        )


def path_length_km(coords: list[list[float]]) -> float:
    """Great-circle length along the path, in km."""
    if len(coords) < 2:
        return 0.0
    return sum(
        haversine_km((coords[i][0], coords[i][1]), (coords[i + 1][0], coords[i + 1][1]))
        for i in range(len(coords) - 1)
    )


def simplify_path(coords: list[list[float]], budget: int = DISPLAY_POINT_BUDGET) -> list[list[float]]:
    """
    Reduce `coords` to at most `budget` points, keeping the route's shape.

    Searches for a tolerance instead of using a fixed one, because "how many
    degrees of error is invisible" depends on how dense the source is. Already
    short paths are returned untouched — a hand-drawn 6-point route must not be
    cut to 4 just because a dense one needed cutting.

    THE SEARCH IS A BINARY SEARCH, and it has to be. An earlier version stepped
    the tolerance up by 1.8x and took the first result that fitted, which on a
    2,600 km test route returned TEN points with 333 km of deviation — the step
    that crossed under the budget overshot it by a factor of fifteen, flattening
    every curve in the cable. Halving a bracket instead lands just under the
    budget, which is the whole point of having one.

    The endpoints survive every pass: RDP always keeps the first and last point,
    which is what lets the endpoint gaps below stay meaningful after simplifying.
    """
    if len(coords) <= budget:
        return [list(c) for c in coords]

    lo, hi = _TOLERANCE_MIN_DEG, _TOLERANCE_MAX_DEG
    best: list[list[float]] = []
    for _ in range(_TOLERANCE_PASSES):
        mid = (lo + hi) / 2
        candidate = rdp(coords, mid)
        if len(candidate) <= budget:
            best = candidate            # fits — remember it, then try finer
            hi = mid
            if len(candidate) >= budget * _BUDGET_FILL:
                break
        else:
            lo = mid                    # too many points — coarsen
    if best:
        return [list(c) for c in best]

    # RDP never reached the budget — a pathological path where almost every
    # point is a genuine corner. Even sampling always hits it, and keeps
    # both ends so the endpoint gaps stay valid.
    step = max(1, len(coords) // (budget - 1))
    sampled = [list(coords[i]) for i in range(0, len(coords), step)][: budget - 1]
    sampled.append(list(coords[-1]))
    return sampled


def endpoint_gaps(
    coords: list[list[float]],
    a_node: Optional[tuple[float, float]],
    z_node: Optional[tuple[float, float]],
) -> tuple[Optional[float], Optional[float], bool]:
    """
    How far the path's two ends sit from the segment's A and Z nodes, in km.

    Returns (a_gap, z_gap, reversed). Both orientations are tried and the one
    with the smaller total error wins — see the module docstring on why a KML's
    direction carries no meaning.
    """
    if not coords or a_node is None or z_node is None:
        return None, None, False

    head = (coords[0][0], coords[0][1])
    tail = (coords[-1][0], coords[-1][1])

    forward = (haversine_km(head, a_node), haversine_km(tail, z_node))
    backward = (haversine_km(tail, a_node), haversine_km(head, z_node))

    if sum(backward) < sum(forward):
        return backward[0], backward[1], True
    return forward[0], forward[1], False


def build_geometry(
    coords: list[list[float]],
    a_node: Optional[tuple[float, float]] = None,
    z_node: Optional[tuple[float, float]] = None,
    budget: int = DISPLAY_POINT_BUDGET,
) -> PathGeometry:
    """
    Derive everything storable from one parsed KML path.

    When the path runs Z→A it is REVERSED IN PLACE here, so that everything
    downstream — the stored full_path, the display path, the map — sees A→Z like
    every other segment. Storing it as supplied would mean every consumer had to
    know about orientation; resolving it once at the boundary means none of them do.
    """
    a_gap, z_gap, was_reversed = endpoint_gaps(coords, a_node, z_node)
    ordered = list(reversed(coords)) if was_reversed else coords

    return PathGeometry(
        full_path=[list(c) for c in ordered],
        display_path=simplify_path(ordered, budget),
        length_km=round(path_length_km(ordered), 3),
        a_end_gap_km=None if a_gap is None else round(a_gap, 3),
        z_end_gap_km=None if z_gap is None else round(z_gap, 3),
        reversed_to_match=was_reversed,
    )
