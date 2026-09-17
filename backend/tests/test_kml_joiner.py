"""
Reassembling a cable an exporter chopped into fragments.

THE MIRROR IMAGE OF THE SPLITTER. Some tools write a route as one LineString per
survey run, per chart sheet, per repeater span — whatever the export happened to
break on. A single segment can arrive as fifty placemarks, in no order, half of
them drawn backwards. Matched individually they produce fifty rows all claiming
the same segment, each fragment too short to score, and a review screen nobody
can use.

The two steps compose in one direction only — JOIN, THEN SPLIT — because a
fragment cannot be split sensibly and a split cannot be undone. The test at the
bottom is the one that matters most: thirty shuffled, half-reversed fragments
covering three segments become one path and then the right three pieces.

THE SAFETY PROPERTY IS THAT JUNCTIONS ARE NEVER SPLICED. Where three or more
fragment ends meet — a landing station with several cables converging, a
branching unit — choosing a pair would join one cable onto another and produce a
route that never existed. Nothing is joined there at all; the ambiguity is left
for the splitter and the reviewer.

Run with:  pytest backend/tests/test_kml_joiner.py -v
"""
import json
import math
import random
from pathlib import Path

import pytest

from app.kml.joiner import MAX_FRAGMENTS, merge_fragments
from app.kml.splitter import split_path

DATA = Path(__file__).parent.parent / "data"


@pytest.fixture(scope="module")
def network():
    nodes = json.loads((DATA / "nodes.json").read_text())
    segments = json.loads((DATA / "segments.json").read_text())
    return nodes, segments, {n["id"]: n for n in nodes}


def straight(a, z, n=600):
    """A believable single cable path between two points."""
    return [
        [
            a[0] + (z[0] - a[0]) * i / (n - 1) + math.sin(i / (n - 1) * 5) * 0.3,
            a[1] + (z[1] - a[1]) * i / (n - 1) + math.cos(i / (n - 1) * 4) * 0.3,
        ]
        for i in range(n)
    ]


def chop(path, k):
    """Cut into k contiguous fragments SHARING their join vertices, which is how
    an exporter that breaks a line into pieces actually writes it."""
    bounds = [round(i * (len(path) - 1) / k) for i in range(k + 1)]
    return [path[bounds[i]:bounds[i + 1] + 1] for i in range(k)]


def scramble(fragments, seed=7):
    """Shuffled and half reversed — an export has no reason to be tidy."""
    rng = random.Random(seed)
    out = [list(reversed(f)) if rng.random() < 0.5 else f for f in fragments]
    rng.shuffle(out)
    return out


CABLE = straight((13.44, 144.79), (35.62, 139.98))


# ── Joining ──────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("k", [2, 5, 50])
def test_fragments_in_order_rebuild_the_original_exactly(k):
    merged = merge_fragments(chop(CABLE, k))
    assert len(merged) == 1
    assert merged[0].fragment_count == k
    assert merged[0].coords == CABLE


def test_fifty_shuffled_and_reversed_fragments_still_rebuild_one_cable():
    """The realistic case, and the one the feature exists for."""
    merged = merge_fragments(scramble(chop(CABLE, 50)))
    assert len(merged) == 1
    assert merged[0].fragment_count == 50
    # Orientation of the whole run carries no meaning — a KML records a path,
    # not a direction — so either way round is correct here. Which end is A is
    # settled later, against the segment's own nodes.
    assert merged[0].coords in (CABLE, list(reversed(CABLE)))


def test_the_join_vertex_is_not_duplicated():
    """Two fragments share the vertex they meet at; keeping both would leave a
    repeated point at every seam — fifty of them in a fifty-piece file."""
    merged = merge_fragments(chop(CABLE, 10))
    assert len(merged[0].coords) == len(CABLE)


def test_a_single_unfragmented_path_passes_straight_through():
    merged = merge_fragments([CABLE])
    assert len(merged) == 1
    assert merged[0].fragment_count == 1
    assert merged[0].was_merged is False
    assert merged[0].coords == CABLE


def test_two_separate_cables_are_not_spliced_together():
    other = straight((5.41, 100.48), (1.29, 103.85))
    merged = merge_fragments(chop(CABLE, 10) + chop(other, 10))
    assert len(merged) == 2
    assert sorted(m.fragment_count for m in merged) == [10, 10]


def test_every_input_appears_in_exactly_one_output():
    """Callers get one shape to handle, and nothing is silently dropped."""
    frags = scramble(chop(CABLE, 20)) + [straight((0.0, 0.0), (1.0, 1.0), 50)]
    merged = merge_fragments(frags)
    seen = [i for m in merged for i in m.source_indices]
    assert sorted(seen) == list(range(len(frags)))


# ── Junctions: the safety property ───────────────────────────────────────────

def test_three_arms_meeting_at_a_point_are_never_joined():
    """A landing station with several cables converging. Picking a pair here
    would splice one cable onto another and invent a route."""
    arm_a = [[10.0 - i * 0.05, 110.0 - i * 0.05] for i in range(40)][::-1]
    arm_b = [[10.0 + i * 0.05, 110.0 + i * 0.05] for i in range(40)]
    arm_c = [[10.0 + i * 0.05, 110.0 - i * 0.05] for i in range(40)]
    merged = merge_fragments([arm_a, arm_b, arm_c])
    assert len(merged) == 3
    assert all(m.fragment_count == 1 for m in merged)


def test_a_chain_is_still_joined_when_a_junction_sits_elsewhere_in_the_file():
    """One ambiguous spot must not stop the rest of the file reassembling."""
    junction = [
        [[10.0 - i * 0.05, 110.0] for i in range(20)][::-1],
        [[10.0 + i * 0.05, 110.0] for i in range(20)],
        [[10.0, 110.0 + i * 0.05] for i in range(20)],
    ]
    merged = merge_fragments(chop(CABLE, 8) + junction)
    counts = sorted(m.fragment_count for m in merged)
    assert counts == [1, 1, 1, 8]


def test_fragments_further_apart_than_the_tolerance_are_left_alone():
    a = straight((0.0, 0.0), (1.0, 1.0), 100)
    b = straight((5.0, 5.0), (6.0, 6.0), 100)     # hundreds of km away
    assert len(merge_fragments([a, b])) == 2


def test_a_degenerate_one_point_path_is_kept_not_dropped():
    merged = merge_fragments([CABLE, [[0.0, 0.0]]])
    assert len(merged) == 2
    assert any(len(m.coords) == 1 for m in merged)


def test_an_absurd_number_of_fragments_is_passed_through_untouched():
    """Not a performance limit — a statement that a file of thousands of loose
    pieces is not something to reassemble unsupervised."""
    many = [[[0.0, i * 0.001], [0.0, i * 0.001 + 0.0005]] for i in range(MAX_FRAGMENTS + 1)]
    merged = merge_fragments(many)
    assert len(merged) == len(many)


def test_names_come_from_the_longest_contributing_fragment():
    """"Path 37" tells you nothing; whichever piece carries a real label is the
    one most likely to be the cable's name."""
    frags = chop(CABLE, 3)
    names = ["bit", "AJC Guam-Tokyo main run", "bit"]
    lengths = [len(f) for f in frags]
    merged = merge_fragments(frags, names=names)
    assert merged[0].name == names[lengths.index(max(lengths))]


# ── Composition with the splitter ────────────────────────────────────────────

def test_fragments_spanning_several_segments_join_then_split_correctly(network):
    """The whole point of the ordering: thirty shuffled, half-reversed fragments
    covering three segments become one path, then the right three pieces."""
    nodes, segments, by_id = network
    ids = ["SMW4-SIN-BOM", "SMW4-BOM-DXB", "SMW4-DXB-LON"]
    chain = [s for s in segments if s["id"] in ids]
    if len(chain) != 3:
        pytest.skip("dataset no longer contains the SMW4 chain")
    chain = sorted(chain, key=lambda s: ids.index(s["id"]))

    def geom(seg, n=250):
        a, z = by_id[seg["start_node_id"]], by_id[seg["end_node_id"]]
        return [
            [a["lat"] + (z["lat"] - a["lat"]) * i / (n - 1) + math.sin(i / (n - 1) * 4) * 0.15,
             a["lng"] + (z["lng"] - a["lng"]) * i / (n - 1) + math.cos(i / (n - 1) * 3) * 0.15]
            for i in range(n)
        ]

    whole: list[list[float]] = []
    cur = chain[0]["start_node_id"]
    for s in chain:
        g = geom(s)
        if s["start_node_id"] != cur:
            g = list(reversed(g))
        cur = s["end_node_id"] if s["start_node_id"] == cur else s["start_node_id"]
        whole.extend(g if not whole else g[1:])

    merged = merge_fragments(scramble(chop(whole, 30), seed=3))
    assert len(merged) == 1 and merged[0].fragment_count == 30

    pieces = split_path(merged[0].coords, nodes, segments)
    assert pieces is not None and len(pieces) == 3
    cuts = [p.start_node_id for p in pieces] + [pieces[-1].end_node_id]
    assert cuts in (["TUAS", "BOM1", "DXB1", "LON1"], ["LON1", "DXB1", "BOM1", "TUAS"])
