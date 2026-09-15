"""
End-Of-Life (EOL) routing-constraint tests.

The mirror image of tests/test_rfs.py. Where RFS excludes cable that is not
built YET, EOL excludes cable that will be RETIRED by the requested service
date: a future-dated solution must not route over a cable being decommissioned
before then.

Covers the pure date logic in app/rfs.py, the filtering seam in
graph.build_graph, the interaction between the two constraints, and the fact
that a retiring cable genuinely disappears from a pathfinder search (and from a
city-pair search) once a service_date past its EOL is given.

Run with:  pytest backend/tests/test_eol.py -v
"""

import sys
from datetime import date
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.city_pair_finder import find_city_pair_routes
from app.graph import build_graph
from app.models import (
    CableSegment,
    CableSegmentUpdate,
    CableSystem,
    CableSystemUpdate,
    DiversityType,
    EolStatus,
    Node,
    NodeType,
    Ownership,
    RfsStatus,
    SegmentType,
)
from app.pathfinder import find_routes
from app.rfs import (
    ALREADY_RETIRED,
    NEVER_RETIRED,
    effective_eol_date,
    eol_date,
    filter_segments_in_service,
    is_segment_available_on,
    is_segment_retired_on,
    quarter_end_date,
)


# ── fixtures / builders ───────────────────────────────────────────────────────
#
# The same deliberately tiny network test_rfs.py uses, with two ways from A to B:
#
#     A ──── seg-direct (100 km, system SYS-OLD) ──── B        <- the short way
#      \                                             /
#       seg-west (60 km)  ── C ──  seg-east (60 km)          <- the long way
#
# The direct hop is the one we retire in most tests, so "was the filter
# applied?" shows up as a different chosen path, not just a different count.
# The system owning it is SYS-OLD here (the cable being switched off), while
# the detour runs over SYS-LIVE.

def _node(node_id: str) -> Node:
    return Node(
        id=node_id, name=f"City {node_id}", lat=1.0, lng=103.0,
        type=NodeType.landing_station, country="SG",
    )


def _segment(seg_id: str, system_id: str, start: str, end: str, length_km: float,
             eol_status=EolStatus.active, eol_quarter=None,
             rfs_status=RfsStatus.in_service, rfs_quarter=None) -> CableSegment:
    return CableSegment(
        id=seg_id, name=seg_id, system_id=system_id,
        start_node_id=start, end_node_id=end,
        type=SegmentType.wet, length_km=length_km,
        reliability=0.99, cost_weight=1.0, ownership=Ownership.owned,
        latency=length_km / 200.0,
        rfs_status=rfs_status, rfs_quarter=rfs_quarter,
        eol_status=eol_status, eol_quarter=eol_quarter,
    )


def _system(system_id: str, eol_status=EolStatus.active, eol_quarter=None,
            rfs_status=RfsStatus.in_service, rfs_quarter=None) -> CableSystem:
    return CableSystem(
        id=system_id, name=system_id, description=system_id,
        rfs_status=rfs_status, rfs_quarter=rfs_quarter,
        eol_status=eol_status, eol_quarter=eol_quarter,
    )


def _network(direct_status=EolStatus.active, direct_quarter=None,
             old_system_status=EolStatus.active, old_system_quarter=None,
             direct_rfs_status=RfsStatus.in_service, direct_rfs_quarter=None):
    """Return (nodes, segments, systems_by_id) for the diagram above."""
    nodes = [_node("A"), _node("B"), _node("C")]
    segments = [
        _segment("seg-direct", "SYS-OLD", "A", "B", 100.0,
                 eol_status=direct_status, eol_quarter=direct_quarter,
                 rfs_status=direct_rfs_status, rfs_quarter=direct_rfs_quarter),
        _segment("seg-west", "SYS-LIVE", "A", "C", 60.0),
        _segment("seg-east", "SYS-LIVE", "C", "B", 60.0),
    ]
    systems_by_id = {
        "SYS-OLD": _system("SYS-OLD", old_system_status, old_system_quarter),
        "SYS-LIVE": _system("SYS-LIVE"),
    }
    return nodes, segments, systems_by_id


def _search(nodes, segments, systems_by_id, service_date):
    """Run a full A→B pathfinder search over a graph built for service_date."""
    G = build_graph(nodes, segments, service_date=service_date, systems_by_id=systems_by_id)
    return find_routes(
        G=G, start="A", end="B",
        must_include_nodes=[], must_avoid_nodes=[], must_avoid_segments=[],
        must_include_segments=[], must_include_systems=[], must_avoid_systems=[],
        diversity=DiversityType.none,
        segments_by_id={s.id: s for s in segments},
        rules=[],
    )


# ── quarter → date ────────────────────────────────────────────────────────────

@pytest.mark.parametrize(("quarter", "expected"), [
    ("2027-Q1", date(2027, 3, 31)),
    ("2027-Q2", date(2027, 6, 30)),
    ("2027-Q3", date(2027, 9, 30)),
    ("2027-Q4", date(2027, 12, 31)),
    # Leap year: Q1 still ends 31 March, not 29 February.
    ("2028-Q1", date(2028, 3, 31)),
])
def test_eol_quarter_resolves_to_last_day_of_quarter(quarter, expected):
    """"EOL 2027-Q2" means the cable is retired during Q2, so it is usable
    THROUGH the last day of that quarter — the same resolution RFS uses, which
    is correct in both directions."""
    assert eol_date(EolStatus.eol, quarter) == expected
    assert quarter_end_date(quarter) == expected


# ── status + quarter → one date ───────────────────────────────────────────────

def test_active_row_contributes_no_constraint():
    assert eol_date(EolStatus.active, None) == NEVER_RETIRED


def test_active_ignores_any_quarter_still_on_the_row():
    """A decommission that was called off wins over the stale quarter left
    behind — the mirror of in_service ignoring a stale RFS quarter."""
    assert eol_date(EolStatus.active, "2027-Q2") == NEVER_RETIRED
    assert eol_date("active", "2027-Q2") == NEVER_RETIRED  # plain string too


def test_eol_row_resolves_to_its_quarter_end():
    assert eol_date(EolStatus.eol, "2027-Q2") == date(2027, 6, 30)
    assert eol_date("eol", "2027-Q2") == date(2027, 6, 30)


@pytest.mark.parametrize("quarter", [
    None, "", "   ", "not-a-quarter", "2027", "2027-2", "2027-Q0", "2027-Q9",
    "Q2-2027", "soon", "27-Q2",
])
def test_eol_row_with_bad_quarter_is_already_retired(quarter):
    """Mirrors "planned with an unparseable quarter is NEVER in service": if we
    cannot tell when a cable stops being usable, we do not offer it."""
    assert eol_date(EolStatus.eol, quarter) == ALREADY_RETIRED


def test_unknown_status_is_treated_like_eol():
    """Only "active" is a free pass; anything unrecognised must prove itself."""
    assert eol_date("decommissioning", None) == ALREADY_RETIRED
    assert eol_date("decommissioning", "2027-Q2") == date(2027, 6, 30)


# ── effective EOL = EARLIER of segment and system ─────────────────────────────

def test_effective_eol_takes_the_earlier_of_segment_and_system():
    seg = _segment("s", "SYS", "A", "B", 1.0, EolStatus.eol, "2027-Q2")
    earlier_system = _system("SYS", EolStatus.eol, "2026-Q1")
    later_system = _system("SYS", EolStatus.eol, "2028-Q1")
    # System is the ceiling: a segment cannot outlive the cable it belongs to.
    assert effective_eol_date(seg, earlier_system) == date(2026, 3, 31)
    # ... and a later system does not extend the segment's own life either.
    assert effective_eol_date(seg, later_system) == date(2027, 6, 30)


def test_active_segment_on_retiring_system_is_cut_off_by_the_system():
    seg = _segment("s", "SYS", "A", "B", 1.0)  # active
    assert effective_eol_date(seg, _system("SYS", EolStatus.eol, "2027-Q2")) == date(2027, 6, 30)


def test_active_segment_and_active_system_never_retire():
    assert effective_eol_date(_segment("s", "SYS", "A", "B", 1.0), _system("SYS")) == NEVER_RETIRED


def test_unknown_system_leaves_the_segment_judged_on_its_own():
    seg = _segment("s", "SYS", "A", "B", 1.0, EolStatus.eol, "2027-Q2")
    assert effective_eol_date(seg, None) == date(2027, 6, 30)


# ── the retired / available predicates ────────────────────────────────────────

def test_nothing_is_retired_without_a_service_date():
    seg = _segment("s", "SYS", "A", "B", 1.0, EolStatus.eol, "2020-Q1")
    assert is_segment_retired_on(seg, None, None) is False
    assert is_segment_available_on(seg, None, None) is True


def test_retired_predicate_is_strictly_before_the_service_date():
    seg = _segment("s", "SYS", "A", "B", 1.0, EolStatus.eol, "2027-Q2")
    assert is_segment_retired_on(seg, None, date(2027, 6, 30)) is False
    assert is_segment_retired_on(seg, None, date(2027, 7, 1)) is True


# ── the graph-build filter ────────────────────────────────────────────────────

def test_no_service_date_means_no_filtering_at_all():
    """The whole point of the default: existing clients are untouched, even
    when the data contains segments retired decades ago."""
    nodes, segments, systems = _network(EolStatus.eol, "2001-Q1")
    G = build_graph(nodes, segments)
    assert G.number_of_edges() == 3
    assert G.has_edge("A", "B")
    # And explicitly passing None behaves identically.
    assert build_graph(nodes, segments, service_date=None,
                       systems_by_id=systems).number_of_edges() == 3


def test_segment_retiring_in_a_past_quarter_is_excluded():
    nodes, segments, systems = _network(EolStatus.eol, "2025-Q4")
    G = build_graph(nodes, segments, service_date=date(2027, 1, 1), systems_by_id=systems)
    assert not G.has_edge("A", "B")
    assert G.number_of_edges() == 2


def test_same_segment_is_included_for_a_service_date_before_its_quarter_end():
    nodes, segments, systems = _network(EolStatus.eol, "2025-Q4")
    G = build_graph(nodes, segments, service_date=date(2025, 6, 1), systems_by_id=systems)
    assert G.has_edge("A", "B")
    assert G.number_of_edges() == 3


@pytest.mark.parametrize(("service_date", "available"), [
    (date(2027, 6, 29), True),    # comfortably inside its life
    (date(2027, 6, 30), True),    # the quarter end itself — its last day of service
    (date(2027, 7, 1), False),    # the day after — gone
])
def test_quarter_boundary_is_inclusive_of_the_last_day(service_date, available):
    """EOL 2027-Q2 is available on 2027-06-30 and unavailable on 2027-07-01."""
    nodes, segments, systems = _network(EolStatus.eol, "2027-Q2")
    G = build_graph(nodes, segments, service_date=service_date, systems_by_id=systems)
    assert G.has_edge("A", "B") is available


def test_segment_excluded_when_its_system_retires_earlier_than_the_segment():
    """The "earlier of the two" ceiling rule end to end: the segment alone
    would still be live on this date, but the cable system it belongs to has
    already been switched off."""
    nodes, segments, systems = _network(
        direct_status=EolStatus.eol, direct_quarter="2028-Q1",
        old_system_status=EolStatus.eol, old_system_quarter="2027-Q2",
    )
    on_date = date(2027, 7, 1)  # after the SYSTEM's Q2 end, before the SEGMENT's
    assert build_graph(nodes, segments, service_date=on_date,
                       systems_by_id=systems).has_edge("A", "B") is False
    # Before the system's EOL, it is there.
    assert build_graph(nodes, segments, service_date=date(2027, 6, 30),
                       systems_by_id=systems).has_edge("A", "B") is True


def test_active_segment_on_a_retiring_system_is_excluded():
    """A segment nobody has marked is still taken down with its cable system."""
    nodes, segments, systems = _network(
        old_system_status=EolStatus.eol, old_system_quarter="2026-Q1",
    )
    G = build_graph(nodes, segments, service_date=date(2027, 1, 1), systems_by_id=systems)
    assert not G.has_edge("A", "B")


def test_eol_segment_with_malformed_quarter_is_excluded():
    """Built with model_construct because the Pydantic field pattern blocks a
    malformed quarter at the API boundary — this stands in for a legacy row
    that predates that validation (or one written straight to the DB)."""
    nodes, segments, systems = _network()
    segments[0] = CableSegment.model_construct(
        **{**segments[0].model_dump(), "eol_status": EolStatus.eol, "eol_quarter": "soon"}
    )
    G = build_graph(nodes, segments, service_date=date(2000, 1, 1), systems_by_id=systems)
    assert not G.has_edge("A", "B"), "unparseable EOL must never route, not even in 2000"


def test_eol_segment_with_missing_quarter_is_excluded():
    nodes, segments, systems = _network()
    segments[0] = CableSegment.model_construct(
        **{**segments[0].model_dump(), "eol_status": EolStatus.eol, "eol_quarter": None}
    )
    G = build_graph(nodes, segments, service_date=date(2000, 1, 1), systems_by_id=systems)
    assert not G.has_edge("A", "B")


def test_eol_system_with_malformed_quarter_takes_its_segments_with_it():
    nodes, segments, systems = _network()
    systems["SYS-OLD"] = CableSystem.model_construct(
        **{**systems["SYS-OLD"].model_dump(), "eol_status": EolStatus.eol, "eol_quarter": ""}
    )
    G = build_graph(nodes, segments, service_date=date(2000, 1, 1), systems_by_id=systems)
    assert not G.has_edge("A", "B")


def test_filter_without_systems_falls_back_to_segment_dates():
    nodes, segments, _ = _network(EolStatus.eol, "2025-Q4")
    G = build_graph(nodes, segments, service_date=date(2027, 1, 1))
    assert not G.has_edge("A", "B")


def test_filter_segments_in_service_returns_the_same_list_when_unfiltered():
    _, segments, systems = _network(EolStatus.eol, "2001-Q1")
    assert filter_segments_in_service(segments, systems, None) is segments


# ── RFS and EOL together ──────────────────────────────────────────────────────

@pytest.mark.parametrize(("service_date", "available"), [
    (date(2026, 1, 1),  False),   # before RFS — not built yet
    (date(2026, 12, 31), True),   # RFS quarter end — first day in service
    (date(2028, 1, 1),  True),    # mid-life
    (date(2028, 6, 30), True),    # EOL quarter end — last day in service
    (date(2028, 7, 1),  False),   # after EOL — retired
])
def test_segment_is_routable_only_inside_its_rfs_to_eol_window(service_date, available):
    """A segment must pass BOTH tests: built by the date AND not retired by it.
    Failing either one excludes it."""
    nodes, segments, systems = _network(
        direct_status=EolStatus.eol, direct_quarter="2028-Q2",
        direct_rfs_status=RfsStatus.planned, direct_rfs_quarter="2026-Q4",
    )
    G = build_graph(nodes, segments, service_date=service_date, systems_by_id=systems)
    assert G.has_edge("A", "B") is available


def test_available_predicate_needs_both_halves():
    seg = _segment("s", "SYS", "A", "B", 1.0,
                   eol_status=EolStatus.eol, eol_quarter="2028-Q2",
                   rfs_status=RfsStatus.planned, rfs_quarter="2026-Q4")
    inside = date(2027, 1, 1)
    assert is_segment_available_on(seg, None, inside) is True
    # Fails the RFS half only.
    assert is_segment_available_on(seg, None, date(2026, 1, 1)) is False
    # Fails the EOL half only.
    assert is_segment_available_on(seg, None, date(2029, 1, 1)) is False


def test_a_segment_retired_before_it_is_built_is_never_routable():
    """Nonsense data (EOL before RFS) must fail closed, not open."""
    seg = _segment("s", "SYS", "A", "B", 1.0,
                   eol_status=EolStatus.eol, eol_quarter="2026-Q1",
                   rfs_status=RfsStatus.planned, rfs_quarter="2028-Q1")
    for day in (date(2025, 1, 1), date(2027, 1, 1), date(2029, 1, 1)):
        assert is_segment_available_on(seg, None, day) is False


# ── the constraint actually changes search results ────────────────────────────

def test_retiring_segment_changes_the_route_a_search_returns():
    """The real payoff: the short direct hop is a cable being switched off, so
    a service_date past its EOL must return the longer detour instead."""
    nodes, segments, systems = _network(EolStatus.eol, "2027-Q2")

    unfiltered = _search(nodes, segments, systems, None)
    filtered = _search(nodes, segments, systems, date(2027, 7, 1))

    assert unfiltered.total_found > filtered.total_found
    assert ["A", "B"] in [r.nodes for r in unfiltered.routes]
    # The retired cable is not merely ranked lower — no returned route touches it.
    assert ["A", "B"] not in [r.nodes for r in filtered.routes]
    assert all("seg-direct" not in [s.segment_id for s in r.segments] for r in filtered.routes)
    assert [r.nodes for r in filtered.routes] == [["A", "C", "B"]]


def test_the_same_search_still_finds_the_direct_hop_before_the_eol_date():
    nodes, segments, systems = _network(EolStatus.eol, "2027-Q2")
    before = _search(nodes, segments, systems, date(2027, 6, 30))
    assert ["A", "B"] in [r.nodes for r in before.routes]


def test_search_is_unchanged_when_nothing_is_retiring():
    nodes, segments, systems = _network()
    before = _search(nodes, segments, systems, None)
    after = _search(nodes, segments, systems, date(2030, 1, 1))
    assert [r.nodes for r in before.routes] == [r.nodes for r in after.routes]
    assert before.total_found == after.total_found


def test_city_pair_search_honours_eol():
    """City Pairs shares the same helper, so a retiring cable drops out of the
    itinerary list too."""
    nodes, segments, systems = _network(EolStatus.eol, "2027-Q2")
    kwargs = {"origin_city": "City A", "destination_city": "City B",
              "nodes": nodes, "segments": segments, "systems_by_id": systems}

    unfiltered = find_city_pair_routes(**kwargs)
    filtered = find_city_pair_routes(**kwargs, service_date="2027-07-01")
    earlier = find_city_pair_routes(**kwargs, service_date="2027-06-30")

    assert ["SYS-OLD"] in [r["systems"] for r in unfiltered]
    assert ["SYS-OLD"] not in [r["systems"] for r in filtered]
    assert [r["systems"] for r in filtered] == [["SYS-LIVE"]]
    # ... and is still there on the quarter-end boundary date.
    assert ["SYS-OLD"] in [r["systems"] for r in earlier]


# ── the model contract ────────────────────────────────────────────────────────

def test_segment_and_system_default_to_active_with_no_quarter():
    seg = _segment("s", "SYS", "A", "B", 1.0)
    sys_ = _system("SYS")
    assert seg.eol_status == EolStatus.active and seg.eol_quarter is None
    assert sys_.eol_status == EolStatus.active and sys_.eol_quarter is None


def test_eol_status_values_are_active_and_eol():
    assert [s.value for s in EolStatus] == ["active", "eol"]


@pytest.mark.parametrize("build", [
    lambda **kw: _segment("s", "SYS", "A", "B", 1.0, **kw),
    lambda **kw: _system("SYS", **kw),
])
def test_quarter_is_required_when_status_is_eol(build):
    with pytest.raises(ValueError, match="eol_quarter is required"):
        build(eol_status=EolStatus.eol, eol_quarter=None)


@pytest.mark.parametrize("build", [
    lambda **kw: _segment("s", "SYS", "A", "B", 1.0, **kw),
    lambda **kw: _system("SYS", **kw),
])
def test_quarter_must_be_empty_when_status_is_active(build):
    with pytest.raises(ValueError, match="eol_quarter must be empty"):
        build(eol_status=EolStatus.active, eol_quarter="2027-Q2")


@pytest.mark.parametrize("bad", ["2027", "2027-2", "2027-Q0", "2027-Q5", "Q2-2027", "soon"])
def test_malformed_eol_quarter_is_rejected_at_the_api_boundary(bad):
    with pytest.raises(ValueError):
        _segment("s", "SYS", "A", "B", 1.0, EolStatus.eol, bad)
    with pytest.raises(ValueError):
        _system("SYS", EolStatus.eol, bad)


def test_update_models_carry_the_eol_fields():
    """PUT /api/segments/{id} and /api/systems/{id} must be able to set them."""
    seg_update = CableSegmentUpdate(eol_status=EolStatus.eol, eol_quarter="2027-Q2")
    sys_update = CableSystemUpdate(eol_status=EolStatus.eol, eol_quarter="2027-Q2")
    assert seg_update.model_dump(exclude_unset=True) == {
        "eol_status": EolStatus.eol, "eol_quarter": "2027-Q2",
    }
    assert sys_update.model_dump(exclude_unset=True) == {
        "eol_status": EolStatus.eol, "eol_quarter": "2027-Q2",
    }


def test_update_models_leave_eol_unset_when_not_supplied():
    """exclude_unset is what the PUT handlers merge with, so an update that
    does not mention EOL must not silently reset it to active."""
    assert "eol_status" not in CableSegmentUpdate(name="x").model_dump(exclude_unset=True)
    assert "eol_status" not in CableSystemUpdate(name="x").model_dump(exclude_unset=True)


def test_a_put_style_merge_sets_eol_on_an_existing_segment():
    """The exact shape app/api/segments.py uses to apply an update."""
    seg = _segment("s", "SYS", "A", "B", 1.0)
    update = CableSegmentUpdate(eol_status=EolStatus.eol, eol_quarter="2027-Q2")
    merged = seg.model_copy(update=update.model_dump(exclude_unset=True))
    assert merged.eol_status == EolStatus.eol
    assert merged.eol_quarter == "2027-Q2"
    assert effective_eol_date(merged, None) == date(2027, 6, 30)
