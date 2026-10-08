"""
flatten.py — stop trusting a file's own PLACEMARK-to-segment claim; re-chop it.

WHY THIS EXISTS. The join → split pipeline in joiner.py/splitter.py works from
the file's own LineString boundaries outward: it stitches fragments that share
an exact endpoint, then looks for places an already-stitched path passes near
an EXISTING segment's node. That is a good default, and it is also exactly
what failed on a real branching cable (AJC, Australia-Japan Cable, Y-shaped at
Guam): the joined "main trunk" fragment never passes within 30km of the Guam
node, so no split point is ever found, and the whole thing landed as one
30%-confidence guess against the wrong segment. Traced by hand before writing
this module — see the KmlChopImport feature's design conversation.

WHAT IS ACTUALLY WRONG, MEASURED AGAINST THE REAL DATA — and this took an
aborted first draft to find out. The instinct was "treat every point as
scrambled and re-order the whole bag from scratch." Measured against AJC's own
fetched geometry, that instinct was WRONG: fragment 0's 27 points are a
genuinely coherent, monotonically-ordered trace (distance from its Tokyo end
increases point by point, all the way to Sydney) — real exporters draw real
ordered lines, even sparse and unevenly sampled ones. What is NOT reliable is
which PLACEMARK a point landed in and what that placemark claims to be (a
filename, a `<name>`) — that grouping is unrelated to where our segments
split, which is the user's whole complaint. So: **a fragment's own internal
point order is trusted and never touched; only which fragments belong next to
which, and in which orientation, is re-decided here**, by geometric proximity
between fragment ENDS rather than by name.

This also fixes a measured problem with re-ordering at the raw-point level:
consecutive real points within one trusted AJC fragment are 6.6km apart in one
place and 935km apart in another — two orders of magnitude of spread within
data that is definitely correctly ordered. A single distance threshold cannot
tell "the next point in this fragment" apart from "an unrelated point that
happens to be closer" at that resolution. Fragment-END-to-fragment-END gaps do
not have this problem: two ends that genuinely belong together land at ~0km
(often exactly, see AJC's Tokyo and Osaka joins) and everything else is
hundreds of km off — a clean, close-to-bimodal split a threshold can actually
use, and the same shape of test joiner.py's fixed JOIN_TOLERANCE_KM already
relies on, just adaptive here instead of fixed at 1km.

THREE PIECES:

    flatten_to_chains()        reassemble fragments into one or more chains by
                                END proximity, never reordering a fragment's
                                own points
    suggest_cuts()              for a chain, guess where a DECLARED segment's
                                own two endpoints sit along it — a hint, never
                                a gate
    join_stretches_for_segment() the mirror image: given several stretches a
                                reviewer already assigned to the SAME segment
                                (a real but unmodelled gap or branch), order
                                and orient them into one path

NEITHER FUNCTION TOUCHES THE NETWORK GRAPH THE WAY splitter.py's
_build_chain() DOES. That function's whole safety argument is "only cut where
a hop is a segment that already exists, chained end to end across the whole
path" — which is precisely the assumption a first import of a branching cable
cannot satisfy, because the graph doesn't have the branch's segments' geometry
yet; that's the point of importing it. suggest_cuts() reuses splitter.py's
find_anchors() (a graph-free "where does this node sit along this line"
primitive) but never its chain-search.
"""
from __future__ import annotations

import math
import statistics
from dataclasses import dataclass, field
from typing import Optional

from ..hazards.proximity import haversine_km
from .parser import KmlPath
from .splitter import find_anchors

#: How much farther than the TYPICAL genuine join gap a candidate must be
#: before it's refused rather than joined — see the module docstring on why
#: fragment-END gaps are close to bimodal (near-zero for a real join, large
#: for an unrelated fragment) and an adaptive multiple of the median handles
#: both a near-exact-touching KMZ and a looser one without separate tuning.
JUMP_MULTIPLIER = 12.0
MIN_JUMP_KM = 5.0
MAX_JUMP_KM = 500.0

#: Turning angle (degrees, 0 = dead straight, 180 = doubling straight back) at
#: which a vertex is flagged as a possible bad join or reversal — a fragment
#: joined onto the wrong end, or a genuine Y-branch this linear chain cannot
#: represent, tends to introduce a sharp bend either way. Not a fix, only a
#: flag: the reviewer should see it before placing a cut nearby.
KINK_ANGLE_DEG = 120.0

#: How far suggest_cuts() will accept a declared segment's node sitting from
#: this chain — generous relative to splitter.py's SNAP_KM=30, deliberately,
#: because this is a SUGGESTION a human reviews, not an auto-accept gate; a
#: miss just means the row starts unassigned instead of pre-filled.
DEFAULT_SUGGEST_SNAP_KM = 100.0

#: Points closer than this (km) at a join are treated as the same physical
#: point and the duplicate is dropped, mirroring joiner.py's own reasoning.
_DEDUPE_TOLERANCE_KM = 0.05


@dataclass
class Chain:
    """One walked ordering of a run of fragments. `kink_indices` are interior
    vertices where the walk may have joined onto the wrong fragment, or onto
    the near side of a real branch it cannot linearly represent — see the
    module docstring. Not corrected, only flagged. `fragment_count` says how
    many of the file's original LineStrings contributed, for the same reason
    KmlBulkImport showed it before: a reviewer should know when 50 placemarks
    became one line versus when this is already exactly one fragment."""
    coords: list[list[float]]
    kink_indices: list[int] = field(default_factory=list)
    fragment_count: int = 1

    @property
    def point_count(self) -> int:
        return len(self.coords)


@dataclass
class SuggestedCut:
    """One place suggest_cuts() thinks a declared segment's own two endpoints
    sit along a chain. `start_idx`/`end_idx` index into that Chain's `coords`.
    The gaps are shown to the reviewer for the same reason KmlCandidate shows
    endpoint gaps today — a suggestion with its working, not just an answer."""
    segment_id: str
    start_idx: int
    end_idx: int
    a_gap_km: float
    z_gap_km: float


def _bearing_deg(a: list[float], b: list[float]) -> float:
    """Initial great-circle bearing from a to b, 0-360 degrees."""
    lat1, lat2 = math.radians(a[0]), math.radians(b[0])
    dlng = math.radians(b[1] - a[1])
    x = math.sin(dlng) * math.cos(lat2)
    y = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(dlng)
    return (math.degrees(math.atan2(x, y)) + 360) % 360


def _find_kinks(coords: list[list[float]], angle_deg: float = KINK_ANGLE_DEG) -> list[int]:
    """Interior vertices where the path turns sharply enough to be worth a
    reviewer's second look — a bad fragment join, or a real branch this
    linear chain cannot represent (see the module docstring)."""
    kinks: list[int] = []
    for i in range(1, len(coords) - 1):
        b_in = _bearing_deg(coords[i - 1], coords[i])
        b_out = _bearing_deg(coords[i], coords[i + 1])
        turn = abs(b_out - b_in)
        if turn > 180:
            turn = 360 - turn
        if turn > angle_deg:
            kinks.append(i)
    return kinks


def _dedupe_consecutive(coords: list[list[float]], tol_km: float = _DEDUPE_TOLERANCE_KM) -> list[list[float]]:
    """Drop a point that lands within `tol_km` of the point right before it —
    called after stitching fragments together, where a join vertex from one
    fragment can sit almost exactly on top of the next fragment's own end."""
    out: list[list[float]] = []
    for c in coords:
        if out and haversine_km((out[-1][0], out[-1][1]), (c[0], c[1])) < tol_km:
            continue
        out.append(c)
    return out


@dataclass
class _End:
    """One end of one fragment, and how far this end sits from the nearest
    end of any OTHER fragment — used once, to compute the adaptive threshold,
    the same idea as joiner.py's own `_End` but for a looser, adaptive join."""
    piece: int
    which: int  # 0 = the fragment's own start, 1 = its own end
    lat: float
    lng: float


def _gather_ends(pieces: list[list[list[float]]]) -> list[_End]:
    """Every fragment's two ends (own start and own end) as flat _End
    records, ready to feed the adaptive-threshold and nearest-end lookups."""
    ends: list[_End] = []
    for i, coords in enumerate(pieces):
        ends.append(_End(i, 0, coords[0][0], coords[0][1]))
        ends.append(_End(i, 1, coords[-1][0], coords[-1][1]))
    return ends


def _nearest_other_end(target: _End, ends: list[_End]) -> Optional[tuple[int, float]]:
    """(index into `ends`, distance_km) of the closest end belonging to a
    DIFFERENT fragment. O(number of ends) — fine at the scale this operates
    on: a handful to a few hundred fragments per import, never the raw point
    count, which is what made the point-level approach this replaced too slow
    and too noisy to threshold sensibly (see module docstring)."""
    best_i, best_d = None, float("inf")
    for i, e in enumerate(ends):
        if e.piece == target.piece:
            continue
        d = haversine_km((target.lat, target.lng), (e.lat, e.lng))
        if d < best_d:
            best_d, best_i = d, i
    return (best_i, best_d) if best_i is not None else None


def _adaptive_jump_km(ends: list[_End]) -> float:
    """The join-acceptance distance for this import: JUMP_MULTIPLIER times the
    median nearest-other-fragment-end gap, clamped to [MIN_JUMP_KM,
    MAX_JUMP_KM]. Adaptive rather than a single fixed threshold because real
    joins cluster near the median gap and unrelated fragments sit far above
    it — see the module docstring on why that split is close to bimodal."""
    gaps = []
    for e in ends:
        got = _nearest_other_end(e, ends)
        if got:
            gaps.append(got[1])
    median_gap = statistics.median(gaps) if gaps else MIN_JUMP_KM
    return min(MAX_JUMP_KM, max(MIN_JUMP_KM, median_gap * JUMP_MULTIPLIER))


def _pick_seed(remaining: set[int]) -> int:
    """Which unused piece starts the next chain. Unlike the join direction
    itself, this choice does not affect CORRECTNESS any more — the walk below
    grows outward from a seed in both directions, so any seed in a connected
    run reaches the same full chain. min() is enough; it only affects the
    (immaterial) order chains come back in across disconnected clusters."""
    return min(remaining)


def _nearest_matching_end(
    pieces: list[list[list[float]]], remaining: set[int], point: list[float],
) -> Optional[tuple[int, int, float]]:
    """(piece_index, which_end matched (0=its own start, 1=its own end),
    distance_km) of the closest still-unused piece to `point`, or None."""
    best_piece, best_which, best_d = None, 0, float("inf")
    for i in remaining:
        c = pieces[i]
        d_start = haversine_km((point[0], point[1]), (c[0][0], c[0][1]))
        d_end = haversine_km((point[0], point[1]), (c[-1][0], c[-1][1]))
        if d_start < best_d:
            best_piece, best_which, best_d = i, 0, d_start
        if d_end < best_d:
            best_piece, best_which, best_d = i, 1, d_end
    return (best_piece, best_which, best_d) if best_piece is not None else None


def join_stretches_for_segment(
    stretches: list[list[list[float]]],
    a_node: Optional[tuple[float, float]],
) -> list[list[float]]:
    """
    Concatenate 2+ already-chopped stretches into ONE path for a single
    segment — the mirror image of the Y-branch case (one stretch, several
    segments): here a genuine gap in the survey data, or a branch that is not
    modelled with a branching-unit node, means a network segment's real
    geometry only exists as several separate stretches (of one chain, or of
    different chains entirely) with nothing joining them automatically.
    /commit-chop groups cuts by segment_id and calls this whenever a segment
    gets more than one; ONE call still returns its single stretch untouched,
    so callers do not need to special-case the common case.

    Orders and ORIENTS each stretch by nearest-endpoint proximity, walking
    outward from whichever stretch has an end closest to the segment's A
    node — the same greedy growth flatten_to_chains() itself uses to join
    raw fragments, reused here one level up, across coarser pieces the
    reviewer already chopped and assigned by hand rather than raw parsed
    fragments. Unlike joiner.py's merge_fragments, there is no tolerance
    check: these stretches were not necessarily touching in the source data
    — if they were, they would already be one chain — so nothing here claims
    they share a vertex. It only orders and orients them; build_geometry's
    own endpoint-gap reporting on the result says how far apart the join
    really is, same as it would for any single uploaded file.
    """
    if len(stretches) == 1:
        return [list(c) for c in stretches[0]]

    remaining = set(range(len(stretches)))
    seed_point = list(a_node) if a_node is not None else list(stretches[0][0])
    piece_i, which, _d = _nearest_matching_end(stretches, remaining, seed_point)
    coords = list(reversed(stretches[piece_i])) if which == 1 else list(stretches[piece_i])
    remaining.discard(piece_i)

    while remaining:
        piece_i, which, _d = _nearest_matching_end(stretches, remaining, coords[-1])
        piece = stretches[piece_i]
        coords.extend(list(reversed(piece)) if which == 1 else list(piece))
        remaining.discard(piece_i)

    return _dedupe_consecutive([list(c) for c in coords])


def flatten_to_chains(paths: list[KmlPath]) -> list[Chain]:
    """
    Reassemble every LineString in an import into one or more coherent
    chains, joined by geometric proximity between FRAGMENT ENDS rather than
    by the file's own placemark identity or naming — the evidence is that
    grouping is unrelated to where our segments actually split (see module
    docstring). Each fragment's own internal point order is never touched.

    A genuinely disconnected piece of data (like AJC's isolated ~9-point stub
    near Guam, confirmed >400km from anything else) comes back as its own
    short chain instead of being force-joined or silently dropped — the
    reviewer sees it and decides what it is.

    Pure function of the points alone — no system, no declared segments, no
    network graph — which is what lets a later commit re-derive the identical
    chains from the stored file bytes without needing anything else replayed.
    """
    pieces = [p.coords for p in paths if len(p.coords) >= 1]
    if not pieces:
        return []
    if len(pieces) == 1:
        coords = _dedupe_consecutive(pieces[0])
        return [Chain(coords=coords, kink_indices=_find_kinks(coords), fragment_count=1)]

    ends = _gather_ends(pieces)
    max_jump_km = _adaptive_jump_km(ends)

    remaining = set(range(len(pieces)))
    chains: list[Chain] = []

    while remaining:
        seed = _pick_seed(remaining)
        remaining.discard(seed)
        # order is the chain's pieces in FINAL left-to-right sequence, each
        # tagged with whether it needs reversing. Starts as just the seed;
        # grown independently off BOTH its ends below. Growing one direction
        # only (from an arbitrary seed) is exactly the bug this replaced: a
        # seed that sits in the MIDDLE of the true run — as AJC's Tokyo-Sydney
        # trunk piece does, with a further Sydney-side extension fragment
        # attaching to the very end the seed started FROM — silently loses
        # that extension, because the walk had already moved off in the other
        # direction and never came back to check. joiner.py's _chain_from hit
        # the same shape of bug once already (see its own "walk backwards to
        # the chain's beginning first" comment) — same fix, applied here to a
        # looser, adaptive-threshold join instead of an exact one.
        order: list[tuple[int, bool]] = [(seed, False)]

        # Grow forward off the seed's own END.
        tail = pieces[seed][-1]
        while True:
            got = _nearest_matching_end(pieces, remaining, tail)
            if got is None or got[2] > max_jump_km:
                break
            piece_i, which, _d = got
            # The matched end becomes the new join point: enter there, exit
            # the other end. Its own start matching means walk it forward
            # (flip=False); its own end matching means walk it reversed.
            flip = which == 1
            order.append((piece_i, flip))
            remaining.discard(piece_i)
            c = pieces[piece_i]
            tail = c[0] if flip else c[-1]

        # Grow backward off the seed's own START, prepending as we go.
        head = pieces[seed][0]
        while True:
            got = _nearest_matching_end(pieces, remaining, head)
            if got is None or got[2] > max_jump_km:
                break
            piece_i, which, _d = got
            # Prepending: the matched end must land LAST in this piece's own
            # rendered sequence, right before the old head. Its own end
            # matching means walk it forward as-is (flip=False); its own
            # start matching means walk it reversed — the OPPOSITE mapping
            # from the forward-growth case above, because here the matched
            # end is the piece's EXIT, not its entry.
            flip = which == 0
            order.insert(0, (piece_i, flip))
            remaining.discard(piece_i)
            c = pieces[piece_i]
            head = c[-1] if flip else c[0]

        coords: list[list[float]] = []
        for piece_idx, flip in order:
            seq = list(reversed(pieces[piece_idx])) if flip else pieces[piece_idx]
            coords.extend(seq)
        coords = _dedupe_consecutive(coords)
        chains.append(Chain(coords=coords, kink_indices=_find_kinks(coords), fragment_count=len(order)))

    return chains


def suggest_cuts(
    chain: Chain,
    declared_segments: list[dict],
    nodes_by_id: dict[str, dict],
    snap_km: float = DEFAULT_SUGGEST_SNAP_KM,
) -> list[SuggestedCut]:
    """
    Where the DECLARED segments' own endpoints sit along this chain, as a
    reviewable suggestion — never a gate.

    Reuses find_anchors() (graph-free: "which vertex is nearest to this one
    node") for exactly the nodes the reviewer already told us matter, then
    proposes a cut between any two CONSECUTIVE anchors whose node ids are one
    declared segment's own (start, end) pair, in either order. Deliberately
    does NOT use splitter.py's _build_chain() — that function's job is
    proving a whole path decomposes into segments the network ALREADY has an
    edge for, which is precisely the assumption a first import of a branching
    cable cannot meet. Anchors that don't chain into a declared pair are left
    alone; nothing here requires accounting for the whole chain.
    """
    node_ids = {nid for seg in declared_segments for nid in (seg.get("start_node_id"), seg.get("end_node_id")) if nid}
    relevant_nodes = [nodes_by_id[nid] for nid in node_ids if nid in nodes_by_id]
    if len(relevant_nodes) < 2:
        return []

    anchors = find_anchors(chain.coords, relevant_nodes, snap_km=snap_km)
    seg_by_pair = {
        frozenset((s["start_node_id"], s["end_node_id"])): s
        for s in declared_segments if s.get("start_node_id") and s.get("end_node_id")
    }

    cuts: list[SuggestedCut] = []
    for i in range(len(anchors) - 1):
        a, z = anchors[i], anchors[i + 1]
        seg = seg_by_pair.get(frozenset((a.node_id, z.node_id)))
        if seg is None:
            continue
        cuts.append(SuggestedCut(
            segment_id=seg["id"],
            start_idx=min(a.vertex, z.vertex),
            end_idx=max(a.vertex, z.vertex),
            a_gap_km=round(a.distance_km, 2),
            z_gap_km=round(z.distance_km, 2),
        ))
    return cuts
