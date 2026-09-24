"""
Putting back together a cable that an exporter chopped into fragments.

THE CASE THIS EXISTS FOR, and it is the mirror image of splitter.py. Some tools
write a route as one LineString per survey run, per chart sheet, per repeater
span — whatever the export happened to break on. A single segment can arrive as
fifty separate placemarks, in no particular order, some drawn backwards. Matched
individually they produce fifty rows all claiming the same segment, each one a
fragment too short to score well, and a review screen that is useless.

So the pipeline is JOIN, THEN SPLIT:

    parse  →  join fragments  →  split at nodes  →  match

Join first because a fragment cannot be split sensibly and a split cannot be
undone; and the two compose exactly as you would hope. Fifty fragments covering
Singapore→Mumbai→Dubai become one path, which the splitter then cuts into the
two segments the network actually models. Neither step has to know about the
other.

WHAT COUNTS AS CONTIGUOUS. Two fragments join when an end of one sits within
JOIN_TOLERANCE_KM of an end of the other. The tolerance is deliberately tight:
fragments from one export share a vertex exactly, so a loose tolerance buys
nothing and risks joining two genuinely different cables whose ends happen to be
near each other.

WHERE THREE OR MORE ENDS MEET, NOTHING IS JOINED. That is a junction, not a
join — a landing station with several cables converging, or a branching unit —
and picking a pair there would splice one cable onto another and produce a route
that never existed. Ambiguity is left intact for the splitter and the reviewer
rather than resolved by guessing.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Optional

from ..hazards.proximity import haversine_km

#: How close two fragment ends must be to count as the same point. Tight on
#: purpose — see the module docstring.
JOIN_TOLERANCE_KM = 1.0

#: Grid cell for the endpoint index, in degrees. Must comfortably exceed the
#: tolerance so a cell plus its neighbours always contains any candidate.
_CELL_DEG = 0.05

#: Beyond this many fragments in one file, joining is abandoned and the paths
#: are passed through untouched. Not a performance limit — the algorithm is
#: near-linear — but a statement that a file with thousands of loose pieces is
#: not something to reassemble unsupervised.
MAX_FRAGMENTS = 2000


@dataclass
class MergedPath:
    """One run of fragments joined end to end, or a single path left alone."""
    coords: list[list[float]]
    #: Indices of the ORIGINAL parsed paths that went into this, in the order
    #: they were joined. Commit re-derives the merge and uses these to check it
    #: got the same answer; the UI uses the count to say what happened.
    source_indices: list[int] = field(default_factory=list)
    #: Name/folder taken from the longest contributing fragment — the one most
    #: likely to carry a meaningful label rather than "Path 37".
    name: str = ""
    folder: Optional[str] = None

    @property
    def fragment_count(self) -> int:
        return len(self.source_indices)

    @property
    def was_merged(self) -> bool:
        return len(self.source_indices) > 1


def _cell(lat: float, lng: float) -> tuple[int, int]:
    """The (row, col) spatial-index cell a lat/lng falls in, at _CELL_DEG
    resolution — used by _pair_ends() so an endpoint only has to compare
    against the handful of other endpoints in its own cell and its eight
    neighbours, rather than every endpoint in the file."""
    return (int(math.floor(lat / _CELL_DEG)), int(math.floor(lng / _CELL_DEG)))


@dataclass
class _End:
    """One end of one fragment."""
    path_index: int
    #: 0 for the fragment's start, 1 for its end.
    which: int
    lat: float
    lng: float


def _gather_ends(paths: list[list[list[float]]]) -> list[_End]:
    """Every fragment's two ends as flat _End records (fragments shorter than
    2 points are skipped — they have no meaningful start/end to join on)."""
    ends: list[_End] = []
    for i, coords in enumerate(paths):
        if len(coords) < 2:
            continue
        ends.append(_End(i, 0, coords[0][0], coords[0][1]))
        ends.append(_End(i, 1, coords[-1][0], coords[-1][1]))
    return ends


def _pair_ends(ends: list[_End], tolerance_km: float) -> dict[tuple[int, int], tuple[int, int]]:
    """
    Which fragment ends are the same point, as a mapping each way.

    Returns {(path, which): (other_path, other_which)} containing ONLY
    unambiguous pairs. An end that touches two or more other ends is a junction
    and appears nowhere in the result — see the module docstring on why that is
    left alone rather than resolved.
    """
    index: dict[tuple[int, int], list[int]] = {}
    for k, e in enumerate(ends):
        index.setdefault(_cell(e.lat, e.lng), []).append(k)

    # For each end, every other end within tolerance.
    touching: dict[int, list[int]] = {k: [] for k in range(len(ends))}
    for k, e in enumerate(ends):
        ci, cj = _cell(e.lat, e.lng)
        for di in (-1, 0, 1):
            for dj in (-1, 0, 1):
                for m in index.get((ci + di, cj + dj), ()):
                    if m <= k:
                        continue
                    o = ends[m]
                    if o.path_index == e.path_index:
                        continue          # a fragment's own two ends
                    if haversine_km((e.lat, e.lng), (o.lat, o.lng)) <= tolerance_km:
                        touching[k].append(m)
                        touching[m].append(k)

    pairs: dict[tuple[int, int], tuple[int, int]] = {}
    for k, others in touching.items():
        if len(others) != 1:
            continue                      # loose end, or a junction
        m = others[0]
        if len(touching[m]) != 1:
            continue                      # the other side sees a junction
        a, b = ends[k], ends[m]
        pairs[(a.path_index, a.which)] = (b.path_index, b.which)
    return pairs


def _chain_from(
    start: int,
    pairs: dict[tuple[int, int], tuple[int, int]],
    used: set[int],
) -> list[tuple[int, bool]]:
    """
    Walk the chain containing fragment `start`.

    Returns [(path_index, reversed), ...] in order. `reversed` says the
    fragment's own points must be flipped to run with the chain — an exporter
    has no reason to write every piece the same way round, and a fragment drawn
    backwards is still part of the same cable.
    """
    # Walk backwards to the chain's beginning first, so the result is the whole
    # run rather than the half of it after `start`.
    head, head_end = start, 0
    seen = {start}
    while (head, head_end) in pairs:
        nxt, nxt_which = pairs[(head, head_end)]
        if nxt in seen:
            break                          # closed loop; stop where we began
        seen.add(nxt)
        head, head_end = nxt, 1 - nxt_which

    chain: list[tuple[int, bool]] = []
    cur, entry = head, 1 - head_end        # the end we leave `head` by
    visited: set[int] = set()
    while True:
        if cur in visited:
            break
        visited.add(cur)
        used.add(cur)
        # Entered at `1 - entry`, leaving at `entry`. Running forwards means
        # leaving by the fragment's own end (which == 1).
        chain.append((cur, entry == 0))
        if (cur, entry) not in pairs:
            break
        nxt, nxt_which = pairs[(cur, entry)]
        cur, entry = nxt, 1 - nxt_which
    return chain


def merge_fragments(
    paths: list[list[list[float]]],
    names: Optional[list[str]] = None,
    folders: Optional[list[Optional[str]]] = None,
    tolerance_km: float = JOIN_TOLERANCE_KM,
) -> list[MergedPath]:
    """
    Join contiguous fragments into maximal runs.

    Every input path appears in exactly one output, whether or not it joined
    anything — a file of fifty fragments and a file of one both come back as a
    list of MergedPath, so callers have one shape to handle. Order within a run
    follows the geometry, not the file.
    """
    names = names or [""] * len(paths)
    folders = folders or [None] * len(paths)

    if not paths or len(paths) > MAX_FRAGMENTS:
        return [
            MergedPath(coords=[list(c) for c in p], source_indices=[i],
                       name=names[i], folder=folders[i])
            for i, p in enumerate(paths)
        ]

    pairs = _pair_ends(_gather_ends(paths), tolerance_km)

    merged: list[MergedPath] = []
    used: set[int] = set()
    for i in range(len(paths)):
        if i in used or len(paths[i]) < 2:
            if i not in used and len(paths[i]) < 2:
                # Too short to have ends worth joining; pass it through so it is
                # still reviewable rather than silently dropped.
                used.add(i)
                merged.append(MergedPath(coords=[list(c) for c in paths[i]],
                                         source_indices=[i], name=names[i], folder=folders[i]))
            continue

        chain = _chain_from(i, pairs, used)

        coords: list[list[float]] = []
        for path_index, flipped in chain:
            piece = paths[path_index]
            seq = list(reversed(piece)) if flipped else piece
            # Drop the duplicated join vertex so the merged line has no repeats.
            coords.extend([list(c) for c in (seq if not coords else seq[1:])])

        order = [pi for pi, _ in chain]
        longest = max(order, key=lambda k: len(paths[k]))
        merged.append(MergedPath(
            coords=coords,
            source_indices=order,
            name=names[longest],
            folder=folders[longest],
        ))

    return merged
