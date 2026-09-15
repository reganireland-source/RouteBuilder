"""
Ready-For-Service (RFS) routing-constraint tests.

Covers the pure date logic in app/rfs.py, the filtering seam in
graph.build_graph, and the fact that a planned cable genuinely disappears from
a pathfinder search (and from a city-pair search) once a service_date is given.

Run with:  pytest backend/tests/test_rfs.py -v
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
    CableSystem,
    DiversityType,
    Node,
    NodeType,
    Ownership,
    RfsStatus,
    RouteRequest,
    SegmentType,
)
from app.pathfinder import find_routes
from app.rfs import (
    ALREADY_IN_SERVICE,
    NEVER_IN_SERVICE,
    effective_rfs_date,
    filter_segments_in_service,
    parse_service_date,
    quarter_end_date,
    rfs_date,
)


# ── fixtures / builders ───────────────────────────────────────────────────────
#
# A deliberately tiny network with two ways to get from A to B:
#
#     A ──── seg-direct (100 km, system SYS-NEW) ──── B        <- the short way
#      \                                             /
#       seg-west (60 km)  ── C ──  seg-east (60 km)          <- the long way
#
# The direct hop is the one we mark planned in most tests, so "was the filter
# applied?" shows up as a different chosen path, not just a different count.

def _node(node_id: str) -> Node:
    return Node(
        id=node_id, name=f"City {node_id}", lat=1.0, lng=103.0,
        type=NodeType.landing_station, country="SG",
    )


def _segment(seg_id: str, system_id: str, start: str, end: str, length_km: float,
             rfs_status=RfsStatus.in_service, rfs_quarter=None) -> CableSegment:
    return CableSegment(
        id=seg_id, name=seg_id, system_id=system_id,
        start_node_id=start, end_node_id=end,
        type=SegmentType.wet, length_km=length_km,
        reliability=0.99, cost_weight=1.0, ownership=Ownership.owned,
        latency=length_km / 200.0,
        rfs_status=rfs_status, rfs_quarter=rfs_quarter,
    )


def _system(system_id: str, rfs_status=RfsStatus.in_service, rfs_quarter=None) -> CableSystem:
    return CableSystem(
        id=system_id, name=system_id, description=system_id,
        rfs_status=rfs_status, rfs_quarter=rfs_quarter,
    )


def _network(direct_status=RfsStatus.in_service, direct_quarter=None,
             new_system_status=RfsStatus.in_service, new_system_quarter=None):
    """Return (nodes, segments, systems_by_id) for the diagram above."""
    nodes = [_node("A"), _node("B"), _node("C")]
    segments = [
        _segment("seg-direct", "SYS-NEW", "A", "B", 100.0,
                 rfs_status=direct_status, rfs_quarter=direct_quarter),
        _segment("seg-west", "SYS-OLD", "A", "C", 60.0),
        _segment("seg-east", "SYS-OLD", "C", "B", 60.0),
    ]
    systems_by_id = {
        "SYS-NEW": _system("SYS-NEW", new_system_status, new_system_quarter),
        "SYS-OLD": _system("SYS-OLD"),
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
    # Leap year: Q1 is still 31 March, not 29 February.
    ("2028-Q1", date(2028, 3, 31)),
])
def test_quarter_resolves_to_last_day_of_quarter(quarter, expected):
    """"RFS 2027-Q2" promises service BY THE END of Q2, so it resolves to the
    last day — resolving it to 1 April would let us quote the cable early."""
    assert quarter_end_date(quarter) == expected


@pytest.mark.parametrize("quarter", [
    None, "", "   ", "2027", "2027-2", "2027-Q0", "2027-Q5", "Q2-2027",
    "2027-q2 ish", "next year", "27-Q2", "2027-QQ",
])
def test_malformed_quarter_does_not_resolve(quarter):
    assert quarter_end_date(quarter) is None


# ── status + quarter → one date ───────────────────────────────────────────────

def test_in_service_row_contributes_no_constraint():
    assert rfs_date(RfsStatus.in_service, None) == ALREADY_IN_SERVICE


def test_in_service_ignores_any_quarter_still_on_the_row():
    """A row that has gone live wins over a stale future quarter left behind."""
    assert rfs_date(RfsStatus.in_service, "2099-Q4") == ALREADY_IN_SERVICE
    assert rfs_date("in_service", "2099-Q4") == ALREADY_IN_SERVICE  # plain string too


def test_planned_row_resolves_to_its_quarter_end():
    assert rfs_date(RfsStatus.planned, "2027-Q2") == date(2027, 6, 30)


@pytest.mark.parametrize("quarter", [None, "", "not-a-quarter", "2027-Q9"])
def test_planned_row_with_bad_quarter_is_never_in_service(quarter):
    """Missing/malformed build date must not be silently let through."""
    assert rfs_date(RfsStatus.planned, quarter) == NEVER_IN_SERVICE


def test_unknown_status_is_treated_like_planned():
    """Only "in_service" is a free pass; anything unrecognised must prove itself."""
    assert rfs_date("mothballed", None) == NEVER_IN_SERVICE
    assert rfs_date("mothballed", "2027-Q2") == date(2027, 6, 30)


# ── effective RFS = later of segment and system ───────────────────────────────

def test_effective_rfs_takes_the_later_of_segment_and_system():
    seg = _segment("s", "SYS", "A", "B", 1.0, RfsStatus.planned, "2027-Q2")
    later_system = _system("SYS", RfsStatus.planned, "2028-Q1")
    earlier_system = _system("SYS", RfsStatus.planned, "2026-Q1")
    # System is the floor: a segment cannot beat the cable it belongs to.
    assert effective_rfs_date(seg, later_system) == date(2028, 3, 31)
    # ... and an earlier system does not pull the segment forward either.
    assert effective_rfs_date(seg, earlier_system) == date(2027, 6, 30)


def test_live_segment_on_planned_system_is_held_back_by_the_system():
    seg = _segment("s", "SYS", "A", "B", 1.0)  # in_service
    assert effective_rfs_date(seg, _system("SYS", RfsStatus.planned, "2028-Q1")) == date(2028, 3, 31)


def test_unknown_system_leaves_the_segment_judged_on_its_own():
    seg = _segment("s", "SYS", "A", "B", 1.0, RfsStatus.planned, "2027-Q2")
    assert effective_rfs_date(seg, None) == date(2027, 6, 30)


# ── the graph-build filter ────────────────────────────────────────────────────

def test_no_service_date_means_no_filtering_at_all():
    """The whole point of the default: existing clients are untouched, even
    when the data contains segments that are not in service for years."""
    nodes, segments, systems = _network(RfsStatus.planned, "2099-Q4")
    G = build_graph(nodes, segments)
    assert G.number_of_edges() == 3
    assert G.has_edge("A", "B")
    # And explicitly passing None behaves identically.
    assert build_graph(nodes, segments, service_date=None,
                       systems_by_id=systems).number_of_edges() == 3


def test_segment_planned_for_a_future_quarter_is_excluded():
    nodes, segments, systems = _network(RfsStatus.planned, "2027-Q2")
    G = build_graph(nodes, segments, service_date=date(2026, 1, 1), systems_by_id=systems)
    assert not G.has_edge("A", "B")
    assert G.number_of_edges() == 2


def test_same_segment_is_included_once_the_service_date_passes_its_quarter():
    nodes, segments, systems = _network(RfsStatus.planned, "2027-Q2")
    G = build_graph(nodes, segments, service_date=date(2027, 12, 1), systems_by_id=systems)
    assert G.has_edge("A", "B")
    assert G.number_of_edges() == 3


def test_segment_excluded_when_its_system_is_planned_later_than_the_segment():
    """The "later of the two" rule end to end: the segment alone would be live
    on this date, but the cable system it belongs to is not."""
    nodes, segments, systems = _network(
        direct_status=RfsStatus.planned, direct_quarter="2027-Q2",
        new_system_status=RfsStatus.planned, new_system_quarter="2028-Q1",
    )
    on_date = date(2027, 7, 1)  # after the SEGMENT's Q2 end, before the SYSTEM's
    assert build_graph(nodes, segments, service_date=on_date,
                       systems_by_id=systems).has_edge("A", "B") is False
    # After the system's RFS too, it comes back.
    assert build_graph(nodes, segments, service_date=date(2028, 4, 1),
                       systems_by_id=systems).has_edge("A", "B") is True


def test_planned_segment_with_malformed_quarter_is_excluded():
    """Built with model_construct because the Pydantic field pattern blocks a
    malformed quarter at the API boundary — this stands in for a legacy row
    that predates that validation (or one written straight to the DB)."""
    nodes, segments, systems = _network()
    segments[0] = CableSegment.model_construct(
        **{**segments[0].model_dump(), "rfs_status": RfsStatus.planned, "rfs_quarter": "soon"}
    )
    G = build_graph(nodes, segments, service_date=date(2099, 12, 31), systems_by_id=systems)
    assert not G.has_edge("A", "B"), "unparseable RFS must never route, not even in 2099"


def test_planned_segment_with_missing_quarter_is_excluded():
    nodes, segments, systems = _network()
    segments[0] = CableSegment.model_construct(
        **{**segments[0].model_dump(), "rfs_status": RfsStatus.planned, "rfs_quarter": None}
    )
    G = build_graph(nodes, segments, service_date=date(2099, 12, 31), systems_by_id=systems)
    assert not G.has_edge("A", "B")


@pytest.mark.parametrize(("service_date", "available"), [
    (date(2027, 6, 29), False),   # one day before the quarter ends
    (date(2027, 6, 30), True),    # the quarter end itself — inclusive
    (date(2027, 7, 1), True),
])
def test_quarter_boundary_is_inclusive_of_the_last_day(service_date, available):
    nodes, segments, systems = _network(RfsStatus.planned, "2027-Q2")
    G = build_graph(nodes, segments, service_date=service_date, systems_by_id=systems)
    assert G.has_edge("A", "B") is available


def test_filter_without_systems_falls_back_to_segment_dates():
    nodes, segments, _ = _network(RfsStatus.planned, "2027-Q2")
    G = build_graph(nodes, segments, service_date=date(2026, 1, 1))
    assert not G.has_edge("A", "B")


def test_filter_segments_in_service_returns_the_same_list_when_unfiltered():
    _, segments, systems = _network(RfsStatus.planned, "2099-Q4")
    assert filter_segments_in_service(segments, systems, None) is segments


# ── the constraint actually changes search results ────────────────────────────

def test_planned_segment_changes_the_route_a_search_returns():
    """The real payoff: the short direct hop is a cable that is not built yet,
    so a service_date search must return the longer detour instead."""
    nodes, segments, systems = _network(RfsStatus.planned, "2027-Q2")

    unfiltered = _search(nodes, segments, systems, None)
    filtered = _search(nodes, segments, systems, date(2026, 1, 1))

    assert unfiltered.total_found > filtered.total_found
    assert ["A", "B"] in [r.nodes for r in unfiltered.routes]
    # The planned cable is not merely ranked lower — no returned route touches it.
    assert ["A", "B"] not in [r.nodes for r in filtered.routes]
    assert all("seg-direct" not in [s.segment_id for s in r.segments] for r in filtered.routes)
    assert [r.nodes for r in filtered.routes] == [["A", "C", "B"]]


def test_search_is_unchanged_when_everything_is_already_in_service():
    nodes, segments, systems = _network()
    before = _search(nodes, segments, systems, None)
    after = _search(nodes, segments, systems, date(2026, 1, 1))
    assert [r.nodes for r in before.routes] == [r.nodes for r in after.routes]
    assert before.total_found == after.total_found


def test_city_pair_search_honours_service_date():
    """City Pairs shares the same helper, so a planned cable drops out of the
    itinerary list too."""
    nodes, segments, systems = _network(RfsStatus.planned, "2027-Q2")
    kwargs = {"origin_city": "City A", "destination_city": "City B",
              "nodes": nodes, "segments": segments, "systems_by_id": systems}

    unfiltered = find_city_pair_routes(**kwargs)
    filtered = find_city_pair_routes(**kwargs, service_date="2026-01-01")
    later = find_city_pair_routes(**kwargs, service_date="2027-06-30")

    assert ["SYS-NEW"] in [r["systems"] for r in unfiltered]
    assert ["SYS-NEW"] not in [r["systems"] for r in filtered]
    assert [r["systems"] for r in filtered] == [["SYS-OLD"]]
    # ... and is back on the quarter-end boundary date.
    assert ["SYS-NEW"] in [r["systems"] for r in later]


# ── the request contract ──────────────────────────────────────────────────────

def test_route_request_service_date_defaults_to_none():
    assert RouteRequest(start_node_id="A", end_node_id="B").service_date is None


def test_route_request_accepts_an_iso_service_date():
    req = RouteRequest(start_node_id="A", end_node_id="B", service_date="2027-06-30")
    assert req.service_date == "2027-06-30"
    assert parse_service_date(req.service_date) == date(2027, 6, 30)


@pytest.mark.parametrize("bad", [
    "30/06/2027", "2027-6-30", "20270630", "2027-06-30T00:00:00", "tomorrow", "",
])
def test_route_request_rejects_a_non_iso_service_date(bad):
    """A typo must be a 422, not a silently ignored constraint that quotes
    planned cable as if it were live."""
    with pytest.raises(ValueError):
        RouteRequest(start_node_id="A", end_node_id="B", service_date=bad)


def test_parse_service_date_passes_through_none_and_dates():
    assert parse_service_date(None) is None
    assert parse_service_date(date(2027, 6, 30)) == date(2027, 6, 30)
