"""
The hazard layer's pure logic: geometry simplification, proximity, severity
mapping and cross-source dedupe.

No network here. The two feeds are exercised through their normalisation
functions with recorded payload shapes, because a test that needs bushfire.io to
be up is not a test, it is a status page.

Several of these pin bugs that were live during development and would be easy to
reintroduce:

  * `_simplify_coords` had its depth constants off by one, so RDP was handed a
    list of RINGS instead of a ring, found nothing collinear, and returned the
    input untouched while reporting success (279,338 vertices survived).
  * the ring fallback restored the WHOLE original ring when RDP over-collapsed,
    which made a LOOSER tolerance produce a BIGGER payload.
  * `_dedupe` matched on position alone and ate 24 of 41 genuine Californian
    fires, because separate fires in one range round to the same grid cell.
  * `_detail_geometry` looked for GeoJSON at the top level of /event/detail,
    which actually returns {history, latest, ...} — so nothing ever hydrated.

Run with:  pytest backend/tests/test_hazards.py -v
"""
import pytest

from app.hazards.models import Hazard, HazardKind, HazardSeverity, severity_rank
from app.hazards.proximity import (
    NetworkGeometry,
    densify_path,
    geometry_centroid,
    haversine_km,
)
from app.hazards.service import _dedupe
from app.hazards.simplify import count_vertices, rdp, simplify_geometry
from app.hazards.sources import (
    BUSHFIRE_KIND_MAP,
    BUSHFIRE_SEVERITY_MAP,
    UsgsSource,
    _detail_geometry,
    _magnitude_severity,
    _plain_text,
)


# ── geometry simplification ──────────────────────────────────────────────────

def _square_ring(points_per_side: int = 100):
    """A square whose sides are densely collinear — RDP should find 4 corners."""
    n = points_per_side
    return (
        [[i / n, 0.0] for i in range(n + 1)]
        + [[1.0, i / n] for i in range(n + 1)]
        + [[1.0 - i / n, 1.0] for i in range(n + 1)]
        + [[0.0, 1.0 - i / n] for i in range(n + 1)]
        + [[0.0, 0.0]]
    )


def test_rdp_collapses_collinear_points():
    line = [[0.0, 0.0], [0.5, 0.0], [1.0, 0.0]]
    assert rdp(line, 0.003) == [[0.0, 0.0], [1.0, 0.0]]


def test_rdp_keeps_a_real_corner():
    bent = [[0.0, 0.0], [0.5, 0.5], [1.0, 0.0]]
    assert len(rdp(bent, 0.003)) == 3


def test_polygon_rings_are_actually_simplified():
    """The depth bug: a Polygon's coordinates are a list of RINGS, not a ring."""
    poly = {"type": "Polygon", "coordinates": [_square_ring()]}
    assert count_vertices(poly) == 405
    out = simplify_geometry(poly, 0.003)
    assert count_vertices(out) == 5, "RDP never reached the ring"


def test_simplified_rings_stay_closed():
    """GeoJSON/Leaflet polygon rings must start and end on the same point;
    RDP trims interior vertices but must never drop that closing duplicate."""
    out = simplify_geometry({"type": "Polygon", "coordinates": [_square_ring()]}, 0.003)
    ring = out["coordinates"][0]
    assert ring[0] == ring[-1]


def test_multipolygon_is_simplified_at_the_right_depth():
    mp = {"type": "MultiPolygon", "coordinates": [[_square_ring()], [_square_ring()]]}
    assert count_vertices(simplify_geometry(mp, 0.003)) == 10


def test_a_ring_never_collapses_below_a_drawable_polygon():
    """A 2-point 'polygon' renders as nothing, which looks like a cleared hazard."""
    sliver = {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [2, 0], [3, 0], [0, 0]]]}
    ring = simplify_geometry(sliver, 0.5)["coordinates"][0]
    assert len(ring) >= 4
    assert ring[0] == ring[-1]


def test_looser_tolerance_never_makes_the_payload_bigger():
    """The fallback bug made tolerance non-monotonic."""
    poly = {"type": "Polygon", "coordinates": [_square_ring()]}
    sizes = [count_vertices(simplify_geometry(poly, t)) for t in (0.0005, 0.003, 0.05, 0.5)]
    assert sizes == sorted(sizes, reverse=True), sizes


def test_points_are_dropped_from_a_collection_that_has_area():
    """Upstream mixes a centroid Point in with the perimeter; we already have one."""
    gc = {
        "type": "GeometryCollection",
        "geometries": [
            {"type": "Point", "coordinates": [0, 0]},
            {"type": "Polygon", "coordinates": [_square_ring()]},
        ],
    }
    out = simplify_geometry(gc, 0.003)
    assert out["type"] == "Polygon", "the lone remaining member should unwrap"


def test_a_collection_of_only_points_keeps_them():
    gc = {
        "type": "GeometryCollection",
        "geometries": [
            {"type": "Point", "coordinates": [0, 0]},
            {"type": "Point", "coordinates": [1, 1]},
        ],
    }
    out = simplify_geometry(gc, 0.003)
    assert out["type"] == "GeometryCollection"
    assert len(out["geometries"]) == 2


def test_unknown_geometry_passes_through_untouched():
    weird = {"type": "SomethingNew", "coordinates": [[0, 0]]}
    assert simplify_geometry(weird, 0.003) == weird


def test_simplify_handles_none():
    assert simplify_geometry(None) is None


# ── distance and proximity ───────────────────────────────────────────────────

def test_haversine_against_a_known_distance():
    """Sydney to Auckland is about 2,160 km."""
    d = haversine_km((-33.8688, 151.2093), (-36.8485, 174.7633))
    assert 2100 < d < 2200, d


def test_densify_fills_long_legs():
    """A trans-Pacific leg must not be two points with 8,000 km between them."""
    path = densify_path([(0.0, 0.0), (0.0, 60.0)], step_km=100)
    assert len(path) > 60
    gaps = [haversine_km(path[i], path[i + 1]) for i in range(len(path) - 1)]
    assert max(gaps) <= 105, max(gaps)


def test_densify_leaves_a_short_path_alone():
    assert densify_path([(0.0, 0.0)]) == [(0.0, 0.0)]


def test_geometry_centroid_reverses_lng_lat_correctly():
    """GeoJSON is [lng, lat]; everything else here is (lat, lng)."""
    centre = geometry_centroid({"type": "Point", "coordinates": [151.2, -33.9]})
    assert centre == pytest.approx((-33.9, 151.2))


def test_geometry_centroid_walks_a_collection():
    gc = {
        "type": "GeometryCollection",
        "geometries": [
            {"type": "Point", "coordinates": [0.0, 0.0]},
            {"type": "Point", "coordinates": [2.0, 2.0]},
        ],
    }
    assert geometry_centroid(gc) == pytest.approx((1.0, 1.0))


NODES = [
    {"id": "SYD1", "name": "Sydney", "lat": -33.8688, "lng": 151.2093},
    {"id": "AKL1", "name": "Auckland", "lat": -36.8485, "lng": 174.7633},
]
SEGMENTS = [
    {"id": "WET1", "name": "Sydney-Auckland", "type": "wet",
     "start_node_id": "SYD1", "end_node_id": "AKL1", "waypoints": None},
]


def test_a_hazard_on_a_node_finds_it():
    geo = NetworkGeometry(NODES, SEGMENTS)
    found = geo.assets_near(-33.87, 151.21)
    assert any(a.id == "SYD1" and a.kind == "node" for a in found)


def test_a_hazard_far_from_everything_finds_nothing():
    geo = NetworkGeometry(NODES, SEGMENTS)
    assert geo.assets_near(0.0, 0.0) == []


def test_mid_ocean_hazard_is_matched_to_the_cable_it_sits_on():
    """The whole point of densifying: a quake halfway across the Tasman."""
    geo = NetworkGeometry(NODES, SEGMENTS)
    found = geo.assets_near(-35.4, 163.0)
    assert any(a.id == "WET1" for a in found)
    assert not any(a.kind == "node" for a in found), "nowhere near either end"


def test_wet_segments_get_the_wider_radius():
    """Same hazard, two radii: 60 km off the cable is in range for wet, not terrestrial."""
    wet = NetworkGeometry(NODES, SEGMENTS)
    terr = NetworkGeometry(NODES, [dict(SEGMENTS[0], type="terrestrial")])
    point = (-35.4, 163.0)
    assert any(a.id == "WET1" for a in wet.assets_near(*point))

    # Nudge ~60 km off the path: still inside 100 km (wet), outside 25 km (terrestrial).
    off = (-36.0, 163.0)
    in_wet = any(a.id == "WET1" for a in wet.assets_near(*off))
    in_terr = any(a.id == "WET1" for a in terr.assets_near(*off))
    assert in_wet and not in_terr, (in_wet, in_terr)


def test_results_are_sorted_nearest_first():
    geo = NetworkGeometry(NODES, SEGMENTS)
    found = geo.assets_near(-33.87, 151.21)
    assert [a.distance_km for a in found] == sorted(a.distance_km for a in found)


def test_a_segment_with_an_unknown_endpoint_is_skipped():
    """Defensive against a dangling reference (e.g. a stale/deleted node id
    left on a segment): it must be dropped from proximity matching, not raise."""
    geo = NetworkGeometry(NODES, [dict(SEGMENTS[0], end_node_id="NOPE")])
    assert geo.segments == []


# ── severity mapping ─────────────────────────────────────────────────────────

@pytest.mark.parametrize("mag,expected", [
    (4.5, HazardSeverity.watch),
    (5.4, HazardSeverity.watch),
    (5.5, HazardSeverity.warning),
    (6.4, HazardSeverity.warning),
    (6.5, HazardSeverity.emergency),
    (8.0, HazardSeverity.emergency),
])
def test_magnitude_maps_to_severity(mag, expected):
    assert _magnitude_severity(mag, tsunami=False) is expected


def test_a_tsunami_flag_promotes_one_step():
    assert _magnitude_severity(4.5, tsunami=True) is HazardSeverity.warning
    assert _magnitude_severity(5.5, tsunami=True) is HazardSeverity.emergency


def test_a_tsunami_flag_cannot_promote_past_the_top():
    assert _magnitude_severity(9.0, tsunami=True) is HazardSeverity.emergency


def test_severity_ladder_is_ordered():
    ranks = [severity_rank(s) for s in (
        HazardSeverity.advisory, HazardSeverity.watch,
        HazardSeverity.warning, HazardSeverity.emergency,
    )]
    assert ranks == sorted(ranks)


def test_every_bushfire_alert_level_maps_somewhere():
    for level in ("communityUpdate", "advice", "watchAndAct", "emergencyWarning", "evacuateImmediately"):
        assert level in BUSHFIRE_SEVERITY_MAP


def test_noise_classifications_are_not_carried():
    """A shark sighting is not a network hazard."""
    for noise in ("shark", "medical", "schoolClosure", "ambulance", "alarm", "rescue"):
        assert noise not in BUSHFIRE_KIND_MAP


def test_the_infrastructure_classifications_are_carried():
    for wanted in ("bushfire", "flood", "earthquake", "tsunami", "landslide",
                   "fallenPowerLines", "utilitySupply", "cycloneTornado"):
        assert wanted in BUSHFIRE_KIND_MAP


# ── USGS normalisation ───────────────────────────────────────────────────────

USGS_FEATURE = {
    "type": "Feature",
    "properties": {
        "mag": 6.5, "place": "126 km NNE of Teluknaga, Indonesia",
        "time": 1789472098788, "updated": 1789476837040,
        "url": "https://earthquake.usgs.gov/earthquakes/eventpage/us7000thl5",
        "tsunami": 0, "magType": "mww", "type": "earthquake",
        "title": "M 6.5 - 126 km NNE of Teluknaga, Indonesia", "code": "7000thl5",
    },
    "geometry": {"type": "Point", "coordinates": [106.6, -5.1, 10.0]},
}


def test_usgs_feature_normalises():
    h = UsgsSource()._to_hazard(USGS_FEATURE)
    assert h is not None
    assert h.id == "usgs:7000thl5"
    assert h.kind is HazardKind.earthquake
    assert h.severity is HazardSeverity.emergency
    assert h.lat == pytest.approx(-5.1) and h.lng == pytest.approx(106.6)
    assert "Depth 10 km" in h.detail
    assert h.reported_at and h.reported_at.startswith("2026-")


def test_usgs_tsunami_flag_changes_the_kind():
    feature = {**USGS_FEATURE, "properties": {**USGS_FEATURE["properties"], "tsunami": 1}}
    assert UsgsSource()._to_hazard(feature).kind is HazardKind.tsunami


def test_usgs_feature_without_a_magnitude_is_dropped():
    feature = {**USGS_FEATURE, "properties": {**USGS_FEATURE["properties"], "mag": None}}
    assert UsgsSource()._to_hazard(feature) is None


def test_usgs_feature_without_coordinates_is_dropped():
    feature = {**USGS_FEATURE, "geometry": {"type": "Point", "coordinates": []}}
    assert UsgsSource()._to_hazard(feature) is None


# ── /event/detail shape ──────────────────────────────────────────────────────

def test_detail_geometry_reads_the_latest_feature():
    """The endpoint returns {history, latest, ...}, NOT a GeoJSON document."""
    detail = {
        "active": True,
        "latestEHash": "abc",
        "latest": {"type": "Feature", "properties": {},
                   "geometry": {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 0]]]}},
        "history": [{"event": {"geometry": {"type": "Point", "coordinates": [9, 9]}}}],
    }
    assert _detail_geometry(detail)["type"] == "Polygon", "should prefer `latest`"


def test_detail_geometry_falls_back_to_history():
    detail = {"history": [{"event": {"geometry": {"type": "Point", "coordinates": [1, 2]}}}]}
    assert _detail_geometry(detail) == {"type": "Point", "coordinates": [1, 2]}


def test_detail_geometry_still_handles_plain_geojson():
    feature = {"type": "Feature", "geometry": {"type": "Point", "coordinates": [3, 4]}}
    assert _detail_geometry(feature) == {"type": "Point", "coordinates": [3, 4]}


def test_detail_geometry_of_nonsense_is_none():
    assert _detail_geometry("not a dict") is None
    assert _detail_geometry({}) is None


# ── HTML stripping ───────────────────────────────────────────────────────────

def test_body_html_is_reduced_to_text():
    html = "<strong>Location:</strong> Banda Sea<br><strong>Type:</strong> Earthquake"
    assert _plain_text(html) == "Location: Banda Sea Type: Earthquake"


def test_entities_are_decoded():
    assert _plain_text("Smith &amp; Sons &quot;quoted&quot;") == 'Smith & Sons "quoted"'


def test_plain_text_of_empty_is_empty():
    assert _plain_text("") == ""


# ── cross-source dedupe ──────────────────────────────────────────────────────

def _hazard(hid, source, kind, severity, lat, lng, geometry=None):
    return Hazard(
        id=hid, source=source, source_label=source, kind=kind, severity=severity,
        title=hid, lat=lat, lng=lng, geometry=geometry,
    )


def test_two_feeds_reporting_one_quake_collapse_to_one():
    a = _hazard("usgs:1", "usgs", HazardKind.earthquake, HazardSeverity.watch, -6.7, 130.3)
    b = _hazard("bushfire:1", "bushfire", HazardKind.earthquake, HazardSeverity.warning, -6.71, 130.31)
    out = _dedupe([a, b])
    assert len(out) == 1
    assert out[0].severity is HazardSeverity.warning, "the more severe report should win"


def test_nearby_fires_from_ONE_feed_are_never_merged():
    """The bug that ate 24 of 41 Californian fires."""
    fires = [
        _hazard(f"bushfire:{i}", "bushfire", HazardKind.fire, HazardSeverity.watch, 34.0, -118.0)
        for i in range(5)
    ]
    assert len(_dedupe(fires)) == 5


def test_different_kinds_at_one_place_are_not_merged():
    a = _hazard("usgs:1", "usgs", HazardKind.earthquake, HazardSeverity.watch, 1.0, 1.0)
    b = _hazard("bushfire:1", "bushfire", HazardKind.fire, HazardSeverity.watch, 1.0, 1.0)
    assert len(_dedupe([a, b])) == 2


def test_at_equal_severity_the_copy_with_geometry_wins():
    plain = _hazard("usgs:1", "usgs", HazardKind.earthquake, HazardSeverity.watch, 1.0, 1.0)
    shaped = _hazard("bushfire:1", "bushfire", HazardKind.earthquake, HazardSeverity.watch, 1.0, 1.0,
                     geometry={"type": "Point", "coordinates": [1.0, 1.0]})
    out = _dedupe([plain, shaped])
    assert len(out) == 1 and out[0].geometry is not None


def test_dedupe_preserves_order_of_survivors():
    hazards = [
        _hazard("usgs:1", "usgs", HazardKind.earthquake, HazardSeverity.watch, 10.0, 10.0),
        _hazard("usgs:2", "usgs", HazardKind.fire, HazardSeverity.watch, 20.0, 20.0),
        _hazard("usgs:3", "usgs", HazardKind.flood, HazardSeverity.watch, 30.0, 30.0),
    ]
    assert [h.id for h in _dedupe(hazards)] == ["usgs:1", "usgs:2", "usgs:3"]
