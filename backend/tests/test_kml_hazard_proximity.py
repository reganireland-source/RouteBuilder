"""
Hazard proximity measured against a surveyed KML path instead of the waypoint
approximation.

WHY THIS MATTERS ENOUGH TO TEST. "Within 100 km of a cable" is only as true as
the line it is measured from. A waypoint spline is a drawing aid — a median of
TWO points between two landing stations, placed to keep the line off land — so
a cable that bows hundreds of km around a trench is nowhere near it. Both
failure directions are real and neither announces itself:

  * a hazard sitting on the actual route is reported as clear, because the
    approximation runs far away from where the cable really is;
  * a hazard far from the cable is reported as a threat, because the
    approximation happens to pass close by.

The two tests below are those two cases. They construct a cable whose real path
bows well away from the straight line between its endpoints, then put a hazard
on each, and assert the answer changes when the KML is supplied.

Run with:  pytest backend/tests/test_kml_hazard_proximity.py -v
"""
from app.hazards.proximity import NetworkGeometry

NODES = [
    {"id": "A1", "name": "A End", "lat": 0.0, "lng": 100.0},
    {"id": "Z1", "name": "Z End", "lat": 0.0, "lng": 110.0},
]
# No waypoints: the approximation is the straight line along the equator.
SEGMENTS = [{
    "id": "SEG1", "name": "Test Cable", "type": "wet",
    "start_node_id": "A1", "end_node_id": "Z1", "waypoints": None,
}]

#: The real route bows ~330 km north of the straight line at its midpoint.
BOWED_PATH = [[0.0, 100.0], [1.5, 102.5], [3.0, 105.0], [1.5, 107.5], [0.0, 110.0]]

#: On the real cable at its northernmost point, ~330 km from the straight line.
ON_REAL_ROUTE = (3.0, 105.0)
#: On the straight-line approximation, but ~330 km from the real cable.
ON_APPROXIMATION = (0.0, 105.0)


def _near(geometry: NetworkGeometry, lat: float, lng: float) -> set[str]:
    return {a.id for a in geometry.assets_near(lat, lng)}


def test_without_kml_the_cable_is_the_straight_line():
    """Baseline: today's behaviour, so the contrast below is about the KML."""
    geo = NetworkGeometry(NODES, SEGMENTS, wet_radius_km=100.0)
    assert "SEG1" in _near(geo, *ON_APPROXIMATION)
    assert "SEG1" not in _near(geo, *ON_REAL_ROUTE)
    assert geo.kml_backed == set()


def test_a_hazard_on_the_real_route_is_found_once_the_kml_is_known():
    """The dangerous miss: sitting on the cable and reported as clear."""
    geo = NetworkGeometry(NODES, SEGMENTS, wet_radius_km=100.0, kml_paths={"SEG1": BOWED_PATH})
    assert "SEG1" in _near(geo, *ON_REAL_ROUTE)
    assert geo.kml_backed == {"SEG1"}


def test_a_hazard_only_near_the_approximation_stops_being_reported():
    """The false alarm, which is what erodes trust in the layer."""
    geo = NetworkGeometry(NODES, SEGMENTS, wet_radius_km=100.0, kml_paths={"SEG1": BOWED_PATH})
    assert "SEG1" not in _near(geo, *ON_APPROXIMATION)


def test_segments_without_a_kml_still_use_their_waypoints():
    """Mixed coverage is the normal state — 218 linked, 104 not — so the two
    must coexist rather than one mode replacing the other."""
    segments = SEGMENTS + [{
        "id": "SEG2", "name": "Other Cable", "type": "wet",
        "start_node_id": "A1", "end_node_id": "Z1", "waypoints": [[0.0, 105.0]],
    }]
    geo = NetworkGeometry(NODES, segments, wet_radius_km=100.0, kml_paths={"SEG1": BOWED_PATH})
    assert geo.kml_backed == {"SEG1"}
    near = _near(geo, *ON_APPROXIMATION)
    assert "SEG2" in near and "SEG1" not in near


def test_a_kml_path_too_short_to_be_a_path_falls_back_to_waypoints():
    """A one-point path is not geometry; silently drawing nothing from it would
    make the segment invisible to the hazard test altogether."""
    geo = NetworkGeometry(NODES, SEGMENTS, wet_radius_km=100.0, kml_paths={"SEG1": [[0.0, 100.0]]})
    assert geo.kml_backed == set()
    assert "SEG1" in _near(geo, *ON_APPROXIMATION)


def test_an_empty_kml_map_changes_nothing():
    """The failure mode when the KML store is unavailable: plain fallback."""
    plain = NetworkGeometry(NODES, SEGMENTS, wet_radius_km=100.0)
    empty = NetworkGeometry(NODES, SEGMENTS, wet_radius_km=100.0, kml_paths={})
    assert _near(plain, *ON_APPROXIMATION) == _near(empty, *ON_APPROXIMATION)
