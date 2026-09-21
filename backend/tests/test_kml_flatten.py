"""
Re-chopping an import's own flat point set, ignoring its placemark boundaries.

TWO BUGS ARE PINNED HERE, both found by running against AJC (Australia-Japan
Cable)'s real submarinecablemap.com geometry rather than by reasoning about it:

  1. POINT-LEVEL REORDERING DOESN'T WORK ON THIS DATA. The first draft treated
     every raw point as scrambled and re-ordered the whole bag with
     nearest-neighbour. Measured against AJC's own fetched geometry this was
     WRONG: one trusted, correctly-ordered 27-point fragment has consecutive
     real gaps from 6.6 km to 935 km — two orders of magnitude of spread
     within data that is definitely in order. No single distance threshold
     can tell "the next point in this fragment" apart from "an unrelated
     point that happens to be closer" at that resolution — the point-level
     approach shattered a genuine 43-point trunk into seven fragments,
     several of them isolated single points. The fix: trust each fragment's
     OWN internal order completely, and only re-decide which FRAGMENTS join
     to which, by proximity between fragment ENDS — those gaps are close to
     bimodal (near-zero for a real join, hundreds of km for an unrelated
     piece), which a threshold can actually use. See flatten.py's own
     docstring for the full account.

  2. A ONE-DIRECTIONAL WALK LOSES AN EXTENSION ON THE BACK SIDE. AJC's own
     data has a Sydney-area trunk fragment whose Sydney end is ALSO where a
     further short extension fragment attaches. A walk that only grows
     forward from an arbitrarily-picked starting end never comes back to
     check the direction it started FROM, so that extension was silently
     dropped — exactly the shape of bug joiner.py's _chain_from already had
     to solve once (see its own "walk backwards to the chain's beginning
     first" comment). Fixed by growing every chain in BOTH directions from
     its seed, independently.

Run with:  pytest backend/tests/test_kml_flatten.py -v
"""
import json
from pathlib import Path

import pytest

from app.kml.flatten import (
    Chain,
    KINK_ANGLE_DEG,
    MAX_JUMP_KM,
    MIN_JUMP_KM,
    flatten_to_chains,
    join_stretches_for_segment,
    suggest_cuts,
)
from app.kml.parser import KmlPath

DATA = Path(__file__).parent.parent / "data"


def path(*coords: list[float], name: str = "") -> KmlPath:
    return KmlPath(name=name, coords=[list(c) for c in coords])


# ── Basic reassembly ─────────────────────────────────────────────────────────

def test_a_single_fragment_is_returned_as_is():
    p = path([0.0, 0.0], [0.0, 1.0], [0.0, 2.0])
    chains = flatten_to_chains([p])
    assert len(chains) == 1
    assert chains[0].coords == p.coords
    assert chains[0].fragment_count == 1


def test_two_fragments_that_touch_exactly_are_joined_in_order():
    a = path([0.0, 0.0], [0.0, 1.0])
    b = path([0.0, 1.0], [0.0, 2.0])
    chains = flatten_to_chains([a, b])
    assert len(chains) == 1
    assert chains[0].fragment_count == 2
    assert chains[0].coords[0] == [0.0, 0.0]
    assert chains[0].coords[-1] == [0.0, 2.0]


def test_a_reversed_fragment_is_flipped_to_run_with_the_chain():
    a = path([0.0, 0.0], [0.0, 1.0])
    # b is drawn backwards relative to a: its "end" is what actually touches a.
    b = path([0.0, 2.0], [0.0, 1.0])
    chains = flatten_to_chains([a, b])
    assert len(chains) == 1
    assert chains[0].coords[0] == [0.0, 0.0]
    assert chains[0].coords[-1] == [0.0, 2.0]


def test_two_unrelated_fragments_stay_separate():
    near_equator = path([0.0, 0.0], [0.0, 1.0])
    far_away = path([60.0, 60.0], [61.0, 61.0])
    chains = flatten_to_chains([near_equator, far_away])
    assert len(chains) == 2
    assert all(c.fragment_count == 1 for c in chains)


def test_every_input_fragment_is_accounted_for_across_all_chains():
    """No point vanishes and none is duplicated, whatever the join topology."""
    pieces = [
        path([0.0, 0.0], [0.0, 1.0]),
        path([0.0, 1.0], [0.0, 2.0]),
        path([40.0, 40.0], [41.0, 41.0]),
    ]
    chains = flatten_to_chains(pieces)
    total_in = sum(len(p.coords) for p in pieces)
    total_out = sum(c.point_count for c in chains)
    # Joined chains may drop a duplicated join vertex (dedupe), so this is
    # an upper bound, not an exact match — but nothing should be LOST beyond
    # genuine duplicates, and nothing invented.
    assert total_out <= total_in
    assert total_out >= total_in - 1  # at most one duplicate vertex, one join


# ── Bug #2: the back-side extension ──────────────────────────────────────────

def test_an_extension_off_the_seeds_starting_end_is_not_lost():
    """The exact shape of AJC's real bug: a trunk fragment (b) that a walk
    would naturally seed on, with ANOTHER fragment (c) extending off the very
    end the walk starts from rather than the one it grows toward first."""
    a = path([10.0, 100.0], [5.0, 105.0])     # far arm
    b = path([5.0, 105.0], [0.0, 110.0])      # "trunk" — likely seed
    c = path([10.0, 100.0], [12.0, 98.0])     # extension off a's far end
    chains = flatten_to_chains([a, b, c])
    assert len(chains) == 1
    assert chains[0].fragment_count == 3
    ends = {tuple(chains[0].coords[0]), tuple(chains[0].coords[-1])}
    assert (0.0, 110.0) in ends
    assert (12.0, 98.0) in ends


# ── Bug #1: point-level noise vs. fragment-level joins ───────────────────────

def test_wildly_uneven_internal_spacing_does_not_break_the_join():
    """One fragment with gaps from ~1km to ~900km — AJC's own real shape —
    must still join cleanly to a second fragment that touches its far end."""
    sparse = path(
        [0.0, 0.0], [0.01, 0.01], [5.0, 5.0], [-10.0, 8.0], [-30.0, 20.0],
    )
    extension = path([-30.0, 20.0], [-31.0, 25.0])
    chains = flatten_to_chains([sparse, extension])
    assert len(chains) == 1
    assert chains[0].fragment_count == 2
    # And the SPARSE fragment's own internal order must be untouched —
    # its points appear in exactly the order it was given, not re-sorted
    # by proximity (which would scramble a genuinely valid but uneven trace).
    idx = [chains[0].coords.index(p) for p in sparse.coords]
    assert idx == sorted(idx)


def test_a_stub_hundreds_of_km_off_stays_its_own_chain():
    """Mirrors AJC's real isolated ~9-point Guam-area stub, confirmed >400km
    from the joined trunk in the live data — must not be force-joined."""
    trunk = path([35.0, 140.0], [0.0, 150.0], [-33.9, 151.2])
    stub = path([13.7, 148.5], [13.3, 148.5])  # ~400km+ from anything above
    chains = flatten_to_chains([trunk, stub])
    assert len(chains) == 2
    assert all(c.fragment_count == 1 for c in chains)


# ── Kink detection ────────────────────────────────────────────────────────────

def test_a_straight_line_has_no_kinks():
    p = path([0.0, 0.0], [0.0, 1.0], [0.0, 2.0], [0.0, 3.0])
    chains = flatten_to_chains([p])
    assert chains[0].kink_indices == []


def test_a_sharp_reversal_is_flagged():
    """A path that runs out and doubles straight back — exactly what a bad
    join or an unrepresentable Y-branch produces (see flatten.py's module
    docstring)."""
    p = path([0.0, 0.0], [0.0, 5.0], [0.0, 0.1])  # out, then back almost to start
    chains = flatten_to_chains([p])
    assert chains[0].kink_indices == [1]


def test_kink_angle_threshold_is_exported_and_positive():
    assert 0 < KINK_ANGLE_DEG < 180


# ── Adaptive jump threshold sanity ───────────────────────────────────────────

def test_jump_threshold_is_clamped_between_its_floor_and_ceiling():
    # A single lonely fragment never triggers the join logic at all, but two
    # fragments whose gap is enormous should refuse to join regardless of
    # what the (degenerate, single-gap) median computes to.
    a = path([0.0, 0.0], [0.0, 1.0])
    far = path([70.0, 0.0], [70.0, 1.0])  # thousands of km away
    chains = flatten_to_chains([a, far])
    assert len(chains) == 2  # never joined, however the threshold computed
    assert MIN_JUMP_KM > 0
    assert MAX_JUMP_KM > MIN_JUMP_KM


# ── join_stretches_for_segment — the mirror of a Y-branch ────────────────────
# One stretch assigned to several segments (task #27, tested via KmlChopImport's
# assignment state, not here) is a real branch with no shared segment geometry.
# This is the OTHER direction: several stretches assigned to the SAME segment,
# because a genuine gap in the survey — or a branch that likewise has no
# branching-unit node on this side — left one segment's real route split
# across pieces with nothing joining them automatically.

def test_a_single_stretch_is_returned_untouched():
    s = [[0.0, 0.0], [0.0, 1.0], [0.0, 2.0]]
    assert join_stretches_for_segment([s], a_node=(0.0, 0.0)) == s


def test_two_stretches_are_ordered_by_proximity_to_the_a_node():
    # far_piece is listed FIRST in the input but sits farther from a_node, so
    # it must land LAST in the result — order is decided by geometry, not by
    # input position.
    far_piece = [[0.0, 2.0], [0.0, 3.0]]
    near_piece = [[0.0, 0.0], [0.0, 1.0]]
    joined = join_stretches_for_segment([far_piece, near_piece], a_node=(0.0, 0.0))
    assert joined[0] == [0.0, 0.0]
    assert joined[-1] == [0.0, 3.0]


def test_a_stretch_drawn_backwards_is_flipped_to_run_toward_a():
    # Its OWN end (not start) is what actually sits nearest the A node, so it
    # must be reversed — same reasoning as flatten_to_chains' own fragments.
    backwards = [[0.0, 1.0], [0.0, 0.0]]
    onward = [[0.0, 1.0], [0.0, 2.0]]
    joined = join_stretches_for_segment([backwards, onward], a_node=(0.0, 0.0))
    assert joined[0] == [0.0, 0.0]
    assert joined[-1] == [0.0, 2.0]


def test_stretches_that_exactly_touch_are_deduped_at_the_join():
    a = [[0.0, 0.0], [0.0, 1.0]]
    b = [[0.0, 1.0], [0.0, 2.0]]
    joined = join_stretches_for_segment([a, b], a_node=(0.0, 0.0))
    assert joined == [[0.0, 0.0], [0.0, 1.0], [0.0, 2.0]]


def test_a_real_gap_between_stretches_is_left_alone_not_bridged():
    # No point is invented to close the gap — only order and orientation are
    # decided here; how far apart the join really is remains build_geometry's
    # (and the reviewer's) concern.
    a = [[0.0, 0.0], [0.0, 1.0]]
    b = [[0.0, 5.0], [0.0, 6.0]]
    joined = join_stretches_for_segment([a, b], a_node=(0.0, 0.0))
    assert joined == [[0.0, 0.0], [0.0, 1.0], [0.0, 5.0], [0.0, 6.0]]


def test_no_point_is_lost_or_duplicated_across_three_stretches():
    a = [[0.0, 0.0], [0.0, 1.0]]
    b = [[0.0, 2.0], [0.0, 3.0]]
    c = [[0.0, 4.0], [0.0, 5.0]]
    joined = join_stretches_for_segment([b, c, a], a_node=(0.0, 0.0))
    assert joined[0] == [0.0, 0.0]
    assert joined[-1] == [0.0, 5.0]
    assert len(joined) == 6  # none of the 6 source points vanished or repeated


def test_missing_a_node_still_produces_a_valid_join():
    # No node lookup succeeded (e.g. a data problem elsewhere) — falls back to
    # an arbitrary seed rather than raising, since ordering is still possible.
    a = [[0.0, 0.0], [0.0, 1.0]]
    b = [[0.0, 1.0], [0.0, 2.0]]
    joined = join_stretches_for_segment([a, b], a_node=None)
    assert len(joined) == 3
    assert {tuple(p) for p in joined} == {(0.0, 0.0), (0.0, 1.0), (0.0, 2.0)}


# ── suggest_cuts ──────────────────────────────────────────────────────────────

NODES_BY_ID = {
    "A": {"id": "A", "lat": 0.0, "lng": 0.0},
    "B": {"id": "B", "lat": 0.0, "lng": 5.0},
    "C": {"id": "C", "lat": 0.0, "lng": 10.0},
}
DECLARED = [
    {"id": "SYS-A-B", "start_node_id": "A", "end_node_id": "B"},
    {"id": "SYS-B-C", "start_node_id": "B", "end_node_id": "C"},
]


def test_suggests_a_cut_where_a_declared_segments_nodes_sit_along_the_chain():
    chain = Chain(coords=[[0.0, 0.0], [0.0, 2.5], [0.0, 5.0], [0.0, 7.5], [0.0, 10.0]])
    cuts = suggest_cuts(chain, DECLARED, NODES_BY_ID)
    seg_ids = {c.segment_id for c in cuts}
    assert seg_ids == {"SYS-A-B", "SYS-B-C"}


def test_no_suggestion_when_a_declared_node_never_comes_near_the_chain():
    """The AJC case in miniature: a chain that passes nowhere near one of a
    declared segment's nodes must not fabricate a cut for it."""
    chain = Chain(coords=[[40.0, 40.0], [41.0, 41.0]])  # nowhere near A/B/C
    cuts = suggest_cuts(chain, DECLARED, NODES_BY_ID)
    assert cuts == []


def test_a_lone_declared_segment_with_only_one_anchor_found_suggests_nothing():
    """Only one of a segment's two endpoints anchoring on the chain is not
    enough to propose a cut — both ends must be found."""
    chain = Chain(coords=[[0.0, 0.0], [0.0, 1.0]])  # near A only, nowhere near B
    cuts = suggest_cuts(chain, DECLARED, NODES_BY_ID)
    assert cuts == []


def test_fewer_than_two_relevant_nodes_returns_nothing():
    chain = Chain(coords=[[0.0, 0.0], [0.0, 5.0]])
    lone = [{"id": "X", "start_node_id": "A", "end_node_id": "ZZZ-NOT-A-NODE"}]
    assert suggest_cuts(chain, lone, NODES_BY_ID) == []


# ── Real data regression: AJC ─────────────────────────────────────────────────

@pytest.fixture(scope="module")
def ajc_paths():
    """The real submarinecablemap.com AJC fetch, cached to disk so this test
    doesn't hit the network — captured once from a live fetch during this
    feature's development, in the same shape parser.py produces."""
    fixture = DATA.parent / "tests" / "fixtures" / "ajc_scm_paths.json"
    if not fixture.exists():
        pytest.skip("AJC fixture not present — see backend/tests/fixtures/README")
    raw = json.loads(fixture.read_text())
    return [KmlPath(name=p.get("name", ""), coords=p["coords"]) for p in raw]


def test_ajc_trunk_and_guam_stub_separate_correctly(ajc_paths):
    """The real regression: the four fragments that genuinely touch (a 43-
    point Sydney-Tokyo-Osaka trunk) must join into one chain, and the
    isolated ~9-point Guam-area stub must stay separate — not the 7-way
    shattering the point-level draft produced, and not a false merge either."""
    chains = flatten_to_chains(ajc_paths)
    assert len(chains) == 2
    by_size = sorted(chains, key=lambda c: c.point_count)
    assert by_size[0].point_count == 9
    assert by_size[0].fragment_count == 1
    assert by_size[1].point_count == 43
    assert by_size[1].fragment_count == 4


def test_ajc_suggests_nothing_at_guam_on_the_main_trunk(ajc_paths):
    """The actual finding that started this feature: the auto-suggest
    correctly finds NOTHING for AJC-SYD-GUM/AJC-GUM-TYO/AJC-GUM-OSA on the
    main trunk, because it genuinely never comes near the Guam node in this
    low-fidelity public trace — confirming the tool must hand this case to a
    human rather than silently guessing wrong."""
    nodes = {
        "SYD1": {"id": "SYD1", "lat": -33.8688, "lng": 151.2093},
        "GUM1": {"id": "GUM1", "lat": 13.4443, "lng": 144.7937},
        "OSA1": {"id": "OSA1", "lat": 34.6937, "lng": 135.5023},
        "MJLS": {"id": "MJLS", "lat": 34.945, "lng": 139.955},
    }
    declared = [
        {"id": "AJC-SYD-GUM", "start_node_id": "SYD1", "end_node_id": "GUM1"},
        {"id": "AJC-GUM-TYO", "start_node_id": "GUM1", "end_node_id": "MJLS"},
        {"id": "AJC-GUM-OSA", "start_node_id": "GUM1", "end_node_id": "OSA1"},
    ]
    chains = flatten_to_chains(ajc_paths)
    trunk = max(chains, key=lambda c: c.point_count)
    assert suggest_cuts(trunk, declared, nodes) == []
