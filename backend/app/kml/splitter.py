"""
Cutting one KML path into the several segments it actually covers.

THE CASE THIS EXISTS FOR. A file may hold one LineString that runs the whole
length of a cable — Singapore to Hong Kong to Tokyo as a single unbroken trace —
while the network models that as two segments meeting at Hong Kong. Matching the
whole thing to one segment is wrong twice over: there is usually no SIN-TYO
segment to match it to, and even if the endpoints happened to fit something, the
middle of the route would be attributed to a cable that does not run there.

This is a DIFFERENT case from a file containing several placemarks, which the
parser already separates. Here the file is not structured at all — one path,
many segments — and the only way to find the joins is to look at where the path
passes our own nodes.

HOW THE SPLIT IS DECIDED, and why it refuses more often than it accepts:

  1. Find every node the path passes close to, and where along the path it
     passes them.
  2. Walk from the node nearest the path's start to the node nearest its end,
     hopping only between nodes that a REAL SEGMENT connects.
  3. Cut at each node in that chain.

Step 2 is the whole safety argument. A path from Singapore to Tokyo passes
within a few km of landing stations belonging to cables it has nothing to do
with; splitting at those would invent segments. Requiring every hop to be a
segment that already exists means the decomposition can only ever produce pieces
the network says are real, and when no such chain exists the path is left whole
for a human to look at.

PROXIMITY IS MEASURED TO THE NEAREST VERTEX, not to the perpendicular foot of
the path. A surveyed KML carries a point every few hundred metres, so the two
differ by less than the spacing and far less than SNAP_KM. A sparse hand-drawn
path is measured less precisely, but a four-point sketch is not the kind of file
that spans three segments in the first place.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Optional

from ..hazards.proximity import haversine_km

#: How close the path must come to a node to be considered as passing through
#: it. Generous, because a trunk route rounds a headland rather than entering
#: the station, and because the alternative to splitting is not splitting.
SNAP_KM = 30.0

#: How far from the path's own ends the chain must begin and finish. The chain
#: has to account for the WHOLE path: a decomposition that explains the middle
#: and leaves 400 km at one end unattributed is not a decomposition.
END_TOLERANCE_KM = 60.0

#: Above this many nearby nodes the picture is too crowded to be confident
#: about, and the path is left whole rather than guessed at. Also bounds the
#: chain search, which is otherwise exponential in the worst case.
MAX_ANCHORS = 40

#: A piece shorter than this is not a segment, it is a rounding artefact at a
#: junction. Guards against cutting a 2,600 km route into a 2,599 km piece and
#: a 1 km stub.
MIN_PIECE_KM = 10.0

#: And it must be made of more than a couple of the path's own vertices. This
#: is the check that catches leading and trailing artefacts: a Singapore-London
#: trace produced a spurious first piece IST1->TUAS of 16 km built from exactly
#: TWO vertices, because those two nodes happen to sit near consecutive points
#: at the very start of the path. 16 km clears the distance floor; two vertices
#: does not look anything like a surveyed span, and saying so is what
#: distinguishes the artefact from a genuinely short segment.
MIN_PIECE_POINTS = 4

#: Cells for the coarse spatial index, in degrees. One degree is ~111 km, so a
#: node's own cell plus its eight neighbours always covers SNAP_KM.
_CELL_DEG = 1.0


@dataclass
class PathPiece:
    """One segment's worth of a longer path.

    `segment_id` is the segment that JUSTIFIED THE CUT, not a final answer.
    Where several cables run between the same two stations — Singapore to Mumbai
    carries both SMW4 and INDIGO_W — any of them makes the hop valid and the
    splitter has no way to tell which this file is. Each piece therefore goes
    back through the normal candidate ranking, which will score those parallel
    cables within a hair of each other and flag the row as ambiguous. The
    splitter's job is finding WHERE to cut; WHICH cable is a separate question
    with a separate answer.
    """
    coords: list[list[float]]
    start_node_id: str
    end_node_id: str
    segment_id: str
    length_km: float


def _cell(lat: float, lng: float) -> tuple[int, int]:
    """The (row, col) spatial-index cell a lat/lng falls in, at _CELL_DEG
    resolution — the coarse grid _index_path()/_nearest_vertex() use so a
    node only has to check its own cell and its eight neighbours."""
    return (int(math.floor(lat / _CELL_DEG)), int(math.floor(lng / _CELL_DEG)))


def _index_path(coords: list[list[float]]) -> dict[tuple[int, int], list[int]]:
    """Bucket vertex indices by degree cell.

    Without this, finding the nearest vertex for each of 230 nodes on a
    4,000-point path is 920,000 great-circle calculations per path, which at a
    batch of 25 files is the difference between a responsive import and a
    minute of silence. With it, each node only looks at the handful of vertices
    in its own neighbourhood.
    """
    index: dict[tuple[int, int], list[int]] = {}
    for i, (lat, lng) in enumerate(coords):
        index.setdefault(_cell(lat, lng), []).append(i)
    return index


def _nearest_vertex(
    node: tuple[float, float],
    coords: list[list[float]],
    index: dict[tuple[int, int], list[int]],
) -> tuple[float, int]:
    """(distance_km, vertex_index) of the closest path vertex to `node`."""
    lat, lng = node
    ci, cj = _cell(lat, lng)
    best_d, best_i = float("inf"), -1
    for di in (-1, 0, 1):
        for dj in (-1, 0, 1):
            for i in index.get((ci + di, cj + dj), ()):
                d = haversine_km((lat, lng), (coords[i][0], coords[i][1]))
                if d < best_d:
                    best_d, best_i = d, i
    return best_d, best_i


def _cumulative_km(coords: list[list[float]]) -> list[float]:
    """Distance along the path to each vertex."""
    out = [0.0]
    for i in range(len(coords) - 1):
        out.append(out[-1] + haversine_km(
            (coords[i][0], coords[i][1]), (coords[i + 1][0], coords[i + 1][1]),
        ))
    return out


@dataclass
class _Anchor:
    """One network node found near the path, produced by find_anchors().

    `vertex` is the index of the path's own nearest vertex to this node;
    `distance_km` is how far that vertex sits from the node (must be within
    the snap tolerance to exist at all); `along_km` is the cumulative
    distance from the path's own start to that vertex, which is what lets
    callers order anchors along the route and measure hop lengths."""
    node_id: str
    vertex: int
    distance_km: float
    along_km: float


def find_anchors(
    coords: list[list[float]],
    nodes: list[dict],
    snap_km: float = SNAP_KM,
) -> list[_Anchor]:
    """Every node the path passes close to, ordered along the path."""
    if len(coords) < 2:
        return []
    index = _index_path(coords)
    along = _cumulative_km(coords)

    found: list[_Anchor] = []
    for n in nodes:
        lat, lng = n.get("lat"), n.get("lng")
        if lat is None or lng is None:
            continue
        d, i = _nearest_vertex((float(lat), float(lng)), coords, index)
        if i >= 0 and d <= snap_km:
            found.append(_Anchor(n["id"], i, d, along[i]))

    found.sort(key=lambda a: a.along_km)

    # EVERY nearby node is kept, including several at the same place. An earlier
    # version collapsed co-located anchors and kept whichever was physically
    # closest to the path, which silently threw away the right answer: a route
    # leaving Singapore passes SSG3 at 3.3 km and TUAS at 6.1 km, and TUAS is
    # the node the segment actually terminates at. Which node is correct is a
    # question about the network graph, not about distance, so the chain search
    # below decides it and this function only gathers the possibilities.
    return found


def _segment_lookup(segments: list[dict]) -> dict[frozenset[str], dict]:
    """Segments keyed by their unordered node pair."""
    out: dict[frozenset[str], dict] = {}
    for s in segments:
        a, z = s.get("start_node_id"), s.get("end_node_id")
        if a and z:
            out.setdefault(frozenset((a, z)), s)
    return out


def _build_chain(
    anchors: list[_Anchor],
    by_pair: dict[frozenset[str], dict],
    total_km: float,
) -> list[tuple[_Anchor, _Anchor, dict]]:
    """
    Find a chain of real segments running the length of the path.

    A SEARCH, NOT A GREEDY WALK. Several of our nodes sit near the same point of
    a route — a landing station, its branching unit, another operator's station
    in the same port — and only one of them is the node the segment terminates
    at. Taking the nearest at each step commits to a choice the geometry cannot
    make and dead-ends: the first version did exactly that and failed to split a
    Singapore–Mumbai–Dubai–London trace, because it picked SSG3 over TUAS at the
    very first hop and then found nothing connected to it.

    So every anchor near the path's start is tried as a beginning, and the
    search explores forward only along pairs that a real segment connects. The
    LONGEST chain wins, because more hops means the decomposition is following
    the network's own structure more closely rather than leaping over it.

    Returns [] when no chain accounts for the whole path.
    """
    n = len(anchors)
    best: list[tuple[_Anchor, _Anchor, dict]] = []

    def reaches_end(a: _Anchor) -> bool:
        return a.along_km >= total_km - END_TOLERANCE_KM

    def dfs(i: int, acc: list[tuple[_Anchor, _Anchor, dict]]) -> None:
        nonlocal best
        if len(acc) >= 2 and reaches_end(anchors[i]) and len(acc) > len(best):
            best = list(acc)
        for j in range(i + 1, n):
            # EVERY HOP MUST COVER REAL GROUND. Without this the search happily
            # padded the start of a Singapore-London trace with four hops
            # between city nodes that all sit at the same point of the path —
            # IST1, SGCL, SGCN, SGGS — because they are connected by real
            # terrestrial segments and "longest chain" rewarded them. They
            # explain none of the route. Requiring each hop to advance at least
            # MIN_PIECE_KM makes the objective mean what it was meant to: the
            # finest decomposition that actually accounts for the path.
            if anchors[j].along_km - anchors[i].along_km < MIN_PIECE_KM:
                continue
            if abs(anchors[j].vertex - anchors[i].vertex) < MIN_PIECE_POINTS - 1:
                continue
            seg = by_pair.get(frozenset((anchors[i].node_id, anchors[j].node_id)))
            if seg is None:
                continue
            # A segment may only be used once in a chain; a path that doubles
            # back onto itself is not something to decompose automatically.
            if any(s["id"] == seg["id"] for _, _, s in acc):
                continue
            acc.append((anchors[i], anchors[j], seg))
            dfs(j, acc)
            acc.pop()

    for i, a in enumerate(anchors):
        if a.along_km <= END_TOLERANCE_KM:
            dfs(i, [])
    return best


def split_path(
    coords: list[list[float]],
    nodes: list[dict],
    segments: list[dict],
    snap_km: float = SNAP_KM,
) -> Optional[list[PathPiece]]:
    """
    Cut `coords` into the segments it covers, or return None.

    None means "this is one segment's worth, or nothing I can decompose
    honestly" — in both cases the caller should match the path whole. A list is
    only returned when the path genuinely spans TWO OR MORE existing segments
    end to end, which is the only situation where cutting it is better than
    leaving it alone.
    """
    anchors = find_anchors(coords, nodes, snap_km)
    if len(anchors) < 3 or len(anchors) > MAX_ANCHORS:
        # Two anchors is a single segment; fewer is not a decomposition at all,
        # and a crowded picture is one to hand to a person rather than guess at.
        return None

    total_km = _cumulative_km(coords)[-1]
    hops = _build_chain(anchors, _segment_lookup(segments), total_km)
    if len(hops) < 2:
        return None

    pieces: list[PathPiece] = []
    for k, (a, z, seg) in enumerate(hops):
        lo, hi = min(a.vertex, z.vertex), max(a.vertex, z.vertex)
        # THE ENDS OF THE PATH BELONG TO THE END PIECES. An anchor sits at the
        # nearest vertex to its node, which for the first and last nodes is
        # usually a little way in from the path's own ends — a route leaves the
        # station before it passes closest to it. Cutting strictly between
        # anchors silently dropped the leading 16 km of a Singapore-London
        # trace, which is surveyed data we were handed and have no reason to
        # discard. Extending the outermost pieces to the path's true ends also
        # means the pieces together account for every point in the file.
        if k == 0:
            lo = 0
        if k == len(hops) - 1:
            hi = len(coords) - 1
        piece = [list(c) for c in coords[lo:hi + 1]]
        if len(piece) < MIN_PIECE_POINTS:
            return None
        length = sum(
            haversine_km((piece[i][0], piece[i][1]), (piece[i + 1][0], piece[i + 1][1]))
            for i in range(len(piece) - 1)
        )
        if length < MIN_PIECE_KM:
            # A stub at a junction rather than a real span. Refusing the whole
            # split is deliberate: a decomposition that is right about three
            # pieces and wrong about a fourth still attaches a wrong piece.
            return None
        pieces.append(PathPiece(
            coords=piece,
            start_node_id=a.node_id,
            end_node_id=z.node_id,
            segment_id=seg["id"],
            length_km=round(length, 3),
        ))

    # Every piece must be a different segment. A path that doubles back and hits
    # the same segment twice is not something to guess at.
    if len({p.segment_id for p in pieces}) != len(pieces):
        return None

    return pieces
