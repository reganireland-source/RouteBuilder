"""
Cutting one KML path into the several segments it covers.

A real file may hold ONE LineString running the whole length of a cable —
Singapore to Mumbai to Dubai to London as a single unbroken trace — while the
network models that as three segments. Matching the whole thing to one segment
attributes most of the route to a cable that does not run there.

THREE BUGS ARE PINNED HERE, all found by running the splitter against the real
network rather than by reasoning about it:

  1. A GREEDY WALK PICKS THE WRONG NODE AND DEAD-ENDS. Leaving Singapore the
     path passes SSG3 at 3.3 km and TUAS at 8.7 km, and TUAS is the node the
     segment actually terminates at. Taking the nearest at each step chose SSG3,
     found nothing connected to it, and refused to split at all. Which node is
     right is a question about the network graph, not about distance.

  2. "LONGEST CHAIN" REWARDS WORTHLESS HOPS. Once the search could try
     alternatives it padded the start with four hops between Singapore city
     nodes — IST1, SGCL, SGCN, SGGS — all sitting at the same point of the
     path, connected by real terrestrial segments, explaining none of the route.
     Every hop must now advance MIN_PIECE_KM along the path.

  3. DISTANCE ALONE DOES NOT CATCH END ARTEFACTS. A spurious leading piece
     IST1->TUAS measured 16 km, clearing the distance floor, but was built from
     exactly TWO of the path's vertices. A surveyed span is not two points.

The safety property is that a split is only ever offered when every hop is a
segment THAT ALREADY EXISTS in the network, so the decomposition cannot invent
a cable; when no such chain runs the length of the path, it is left whole.

Run with:  pytest backend/tests/test_kml_splitter.py -v
"""
import json
import math
from pathlib import Path

import pytest

from app.kml.splitter import (
    MIN_PIECE_POINTS,
    find_anchors,
    split_path,
)

DATA = Path(__file__).parent.parent / "data"
CHAIN_IDS = ["SMW4-SIN-BOM", "SMW4-BOM-DXB", "SMW4-DXB-LON"]
EXPECTED_CUTS = ["TUAS", "BOM1", "DXB1", "LON1"]


@pytest.fixture(scope="module")
def network():
    """The real reference network (nodes.json/segments.json), loaded once per
    module rather than per test since it's read-only and tests only query it."""
    nodes = json.loads((DATA / "nodes.json").read_text())
    segments = json.loads((DATA / "segments.json").read_text())
    return nodes, segments, {n["id"]: n for n in nodes}


@pytest.fixture(scope="module")
def chain(network):
    _, segments, _ = network
    found = [s for s in segments if s["id"] in CHAIN_IDS]
    if len(found) != len(CHAIN_IDS):
        pytest.skip("dataset no longer contains the SMW4 SIN-BOM-DXB-LON chain")
    return sorted(found, key=lambda s: CHAIN_IDS.index(s["id"]))


def geom(seg, by_id, n: int = 250):
    """A believable trace for one segment, offset slightly from its nodes the
    way a real route leaves a station rather than starting inside it."""
    a, z = by_id[seg["start_node_id"]], by_id[seg["end_node_id"]]
    return [
        [
            a["lat"] + (z["lat"] - a["lat"]) * i / (n - 1) + math.sin(i / (n - 1) * 4) * 0.15,
            a["lng"] + (z["lng"] - a["lng"]) * i / (n - 1) + math.cos(i / (n - 1) * 3) * 0.15,
        ]
        for i in range(n)
    ]


def concatenate(segs, by_id):
    """Join a chain of segments into ONE unbroken path, as a single-LineString
    KML of the whole cable would be."""
    whole: list[list[float]] = []
    cur = segs[0]["start_node_id"]
    for s in segs:
        g = geom(s, by_id)
        if s["start_node_id"] != cur:
            g = list(reversed(g))
        cur = s["end_node_id"] if s["start_node_id"] == cur else s["start_node_id"]
        whole.extend(g if not whole else g[1:])
    return whole


# ── The case this exists for ─────────────────────────────────────────────────

def test_a_three_segment_trace_is_cut_at_the_right_nodes(network, chain):
    nodes, segments, by_id = network
    pieces = split_path(concatenate(chain, by_id), nodes, segments)
    assert pieces is not None, "a genuine three-segment trace was not split"
    cuts = [p.start_node_id for p in pieces] + [pieces[-1].end_node_id]
    assert cuts == EXPECTED_CUTS


def test_a_two_segment_trace_is_cut_once(network, chain):
    nodes, segments, by_id = network
    pieces = split_path(concatenate(chain[:2], by_id), nodes, segments)
    assert pieces is not None and len(pieces) == 2


def test_each_piece_carries_its_own_share_of_the_points(network, chain):
    """A cut that produced one fat piece and two stubs would pass a count check
    while being useless."""
    nodes, segments, by_id = network
    pieces = split_path(concatenate(chain, by_id), nodes, segments)
    assert all(len(p.coords) > 100 for p in pieces), [len(p.coords) for p in pieces]
    assert all(p.length_km > 500 for p in pieces), [p.length_km for p in pieces]


def test_pieces_are_contiguous_and_cover_the_path(network, chain):
    """Adjacent pieces must meet, or the middle of the cable goes unattributed."""
    nodes, segments, by_id = network
    whole = concatenate(chain, by_id)
    pieces = split_path(whole, nodes, segments)
    for a, b in zip(pieces, pieces[1:]):
        assert a.coords[-1] == b.coords[0], "a gap opened between two pieces"
    assert pieces[0].coords[0] == whole[0]
    assert pieces[-1].coords[-1] == whole[-1]


# ── When it must refuse ──────────────────────────────────────────────────────

def test_a_single_segment_path_is_left_whole(network, chain):
    """The common case by far. Splitting here would be pure damage."""
    nodes, segments, by_id = network
    assert split_path(geom(chain[0], by_id), nodes, segments) is None


def test_a_path_nowhere_near_the_network_is_left_whole(network):
    nodes, segments, _ = network
    mid_atlantic = [[-30.0 + i * 0.1, -25.0 + i * 0.1] for i in range(200)]
    assert split_path(mid_atlantic, nodes, segments) is None


def test_a_two_point_path_is_left_whole(network):
    nodes, segments, _ = network
    assert split_path([[1.29, 103.85], [22.3, 114.2]], nodes, segments) is None


def test_an_empty_path_is_handled(network):
    nodes, segments, _ = network
    assert split_path([], nodes, segments) is None
    assert find_anchors([], nodes) == []


# ── The three pinned bugs ────────────────────────────────────────────────────

def test_the_right_terminal_node_is_chosen_over_a_closer_one(network, chain):
    """Bug 1. TUAS is further from the path than SSG3 and is still the answer,
    because it is the node the segment terminates at."""
    nodes, segments, by_id = network
    anchors = find_anchors(concatenate(chain, by_id), nodes)
    ids = {a.node_id for a in anchors}
    assert "TUAS" in ids and "SSG3" in ids, "both candidates should be offered to the search"
    ssg3 = next(a for a in anchors if a.node_id == "SSG3")
    tuas = next(a for a in anchors if a.node_id == "TUAS")
    assert ssg3.distance_km < tuas.distance_km, "the wrong node is genuinely closer"

    pieces = split_path(concatenate(chain, by_id), nodes, segments)
    assert pieces[0].start_node_id == "TUAS"


def test_no_hop_sits_still(network, chain):
    """Bug 2. Every piece must advance along the path, or the chain is padded
    with hops between co-located city nodes that explain nothing."""
    nodes, segments, by_id = network
    pieces = split_path(concatenate(chain, by_id), nodes, segments)
    assert all(p.length_km >= 10.0 for p in pieces)
    assert len(pieces) == 3, f"expected exactly 3 real hops, got {[p.segment_id for p in pieces]}"


def test_no_piece_is_built_from_a_couple_of_vertices(network, chain):
    """Bug 3. The 16 km IST1->TUAS artefact cleared the distance floor."""
    nodes, segments, by_id = network
    pieces = split_path(concatenate(chain, by_id), nodes, segments)
    assert all(len(p.coords) >= MIN_PIECE_POINTS for p in pieces)


# ── Safety ───────────────────────────────────────────────────────────────────

def test_every_cut_corresponds_to_a_segment_that_already_exists(network, chain):
    """The whole safety argument: the splitter cannot invent a cable."""
    nodes, segments, by_id = network
    pieces = split_path(concatenate(chain, by_id), nodes, segments)
    pairs = {frozenset((s["start_node_id"], s["end_node_id"])) for s in segments}
    for p in pieces:
        assert frozenset((p.start_node_id, p.end_node_id)) in pairs


def test_no_segment_is_used_twice_in_one_chain(network, chain):
    nodes, segments, by_id = network
    pieces = split_path(concatenate(chain, by_id), nodes, segments)
    ids = [p.segment_id for p in pieces]
    assert len(set(ids)) == len(ids)


def test_splitting_is_fast_enough_for_a_batch(network, chain):
    """A batch of 25 files must not stall the import."""
    import time
    nodes, segments, by_id = network
    whole = concatenate(chain, by_id)
    t0 = time.time()
    for _ in range(10):
        split_path(whole, nodes, segments)
    per_call_ms = (time.time() - t0) * 100
    assert per_call_ms < 250, f"{per_call_ms:.0f} ms per split is too slow for a batch"
