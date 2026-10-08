"""
Fetching cable geometry from submarinecablemap.com's public map data.

WHAT THESE TESTS ARE FOR. Real network calls never happen in this suite —
_get_json is monkeypatched everywhere, and CACHE_DIR is redirected to a tmp
path so no test touches backend/data/scm_cache. What is under test:

  * the disk cache — serves cached data inside the TTL, refetches once stale,
    and falls back to a stale cache rather than failing when a refetch errors.
  * cable_to_kml_bytes — turns fetched GeoJSON into KML that this app's OWN
    parser reads back correctly: coordinate order, one Placemark per
    LineString piece (a cable's real API response can hold several disjoint
    pieces across several Features, and every one of them must survive as its
    own path so the existing join/split pipeline can put them back together).
  * fetch_cable_kml's error paths — an unknown cable id, and a cable with no
    usable geometry, both raise ScmError with a message safe to show a user.

Run with:  pytest backend/tests/test_kml_submarinecablemap.py -v
"""
import os
import time

import pytest

from app.kml import submarinecablemap as scm
from app.kml.parser import parse_kml

ALL_CABLES = [
    {"id": "echo", "name": "Echo"},
    {"id": "2africa", "name": "2Africa"},
]

# Two Features for "echo" (mirrors the real API: a cable can be split across
# several Features, feature_id echo-0 / echo-1), the second carrying TWO
# disjoint LineString pieces inside one MultiLineString.
CABLE_GEO = {
    "type": "FeatureCollection",
    "features": [
        {
            "properties": {"id": "echo", "feature_id": "echo-0"},
            "geometry": {"type": "MultiLineString", "coordinates": [
                [[144.7, 13.4], [143.9, 13.9], [103.9, 1.4]],
            ]},
        },
        {
            "properties": {"id": "echo", "feature_id": "echo-1"},
            "geometry": {"type": "MultiLineString", "coordinates": [
                [[109.5, -3.0], [107.1, -5.9]],
                [[133.6, 7.7], [134.5, 7.5]],
            ]},
        },
        {
            "properties": {"id": "2africa", "feature_id": "2africa-0"},
            "geometry": {"type": "MultiLineString", "coordinates": [
                [[10.0, 40.0], [12.0, 41.0]],
            ]},
        },
    ],
}


@pytest.fixture(autouse=True)
def isolated_cache(tmp_path, monkeypatch):
    """Every test gets its own empty cache dir and no real network access."""
    monkeypatch.setattr(scm, "CACHE_DIR", tmp_path / "scm_cache")


@pytest.fixture
def fake_fetch(monkeypatch):
    """Replaces the network call. Returns a call counter so tests can assert
    on how many times the upstream was actually hit."""
    calls = {"all.json": 0, "cable-geo.json": 0}

    def fake(url):
        if url == scm.CABLE_LIST_URL:
            calls["all.json"] += 1
            return list(ALL_CABLES)
        if url == scm.CABLE_GEO_URL:
            calls["cable-geo.json"] += 1
            return dict(CABLE_GEO)
        raise AssertionError(f"unexpected URL {url}")

    monkeypatch.setattr(scm, "_get_json", fake)
    return calls


# ── Cable list / search ──────────────────────────────────────────────────────

def test_list_cables_is_name_sorted(fake_fetch):
    cables = scm.list_cables()
    assert [c["id"] for c in cables] == ["2africa", "echo"]  # "2Africa" < "Echo"


def test_search_matches_case_insensitively(fake_fetch):
    assert [c["id"] for c in scm.search_cables("ECHO")] == ["echo"]


def test_search_ranks_starts_with_above_contains(monkeypatch, isolated_cache):
    def fake(url):
        if url == scm.CABLE_LIST_URL:
            return [
                {"id": "sea-me-we-5", "name": "SEA-ME-WE 5"},          # contains "me" mid-name
                {"id": "medusa", "name": "MEDUSA Submarine Cable"},    # starts with "me"
            ]
        raise AssertionError(url)

    monkeypatch.setattr(scm, "_get_json", fake)
    cables = scm.search_cables("me")
    assert [c["id"] for c in cables] == ["medusa", "sea-me-we-5"]


def test_empty_query_returns_a_page_not_nothing(fake_fetch):
    assert len(scm.search_cables("")) == 2


def test_unknown_cable_raises(fake_fetch):
    with pytest.raises(scm.ScmError):
        scm.fetch_cable_kml("not-a-real-cable")


# ── Disk cache ───────────────────────────────────────────────────────────────

def test_second_call_is_served_from_cache_not_refetched(fake_fetch):
    scm.list_cables()
    scm.list_cables()
    assert fake_fetch["all.json"] == 1


def test_stale_cache_triggers_a_refetch(fake_fetch):
    scm.list_cables()
    path = scm.CACHE_DIR / "all.json"
    old = time.time() - scm.CACHE_TTL_SECONDS - 10
    os.utime(path, (old, old))
    scm.list_cables()
    assert fake_fetch["all.json"] == 2


def test_a_failed_refetch_falls_back_to_the_stale_cache(fake_fetch, monkeypatch):
    scm.list_cables()   # populate the cache
    path = scm.CACHE_DIR / "all.json"
    old = time.time() - scm.CACHE_TTL_SECONDS - 10
    os.utime(path, (old, old))

    def broken(url):
        raise scm.ScmError("simulated network failure")

    monkeypatch.setattr(scm, "_get_json", broken)
    cables = scm.list_cables()   # must not raise
    assert [c["id"] for c in cables] == ["2africa", "echo"]


def test_no_cache_and_a_failed_fetch_raises(monkeypatch):
    def broken(url):
        raise scm.ScmError("simulated network failure")

    monkeypatch.setattr(scm, "_get_json", broken)
    with pytest.raises(scm.ScmError):
        scm.list_cables()


def test_force_refresh_bypasses_a_fresh_cache(fake_fetch):
    scm.list_cables()
    scm.list_cables(force_refresh=True)
    assert fake_fetch["all.json"] == 2


# ── KML synthesis ────────────────────────────────────────────────────────────

def test_every_disjoint_piece_becomes_its_own_path(fake_fetch):
    """Echo's fetched geometry is 1 + 2 = 3 LineStrings across two Features.
    Every one of them must survive as a separate Placemark so the existing
    join/split pipeline (not this module) is what puts them back together."""
    kml_bytes, filename, name = scm.fetch_cable_kml("echo")
    assert name == "Echo"
    assert filename == "submarinecablemap-echo.kml"
    parsed = parse_kml(kml_bytes, source_name=filename)
    assert len(parsed.paths) == 3


def test_coordinates_round_trip_lat_lng_correctly(fake_fetch):
    """GeoJSON is [lng, lat]; this app's own parser expects KML's lng,lat and
    swaps it to [lat, lng] internally. Get the swap wrong here and every synced
    cable lands in the wrong hemisphere."""
    kml_bytes, _, _ = scm.fetch_cable_kml("2africa")
    parsed = parse_kml(kml_bytes, source_name="x")
    assert len(parsed.paths) == 1
    first_point = parsed.paths[0].coords[0]
    # Fixture coordinate was [10.0, 40.0] in GeoJSON (lng, lat) order.
    assert first_point == pytest.approx([40.0, 10.0])


def test_document_name_and_fidelity_note_are_present(fake_fetch):
    kml_bytes, _, _ = scm.fetch_cable_kml("echo")
    parsed = parse_kml(kml_bytes, source_name="x")
    assert parsed.document_name == "Echo"


def test_a_cable_with_no_matching_features_raises(fake_fetch):
    with pytest.raises(scm.ScmError):
        scm.cable_to_kml_bytes("nonexistent-in-geo-file", "Nonexistent")


def test_cable_names_with_xml_special_characters_are_escaped(monkeypatch, isolated_cache):
    def fake(url):
        if url == scm.CABLE_LIST_URL:
            return [{"id": "at-t", "name": 'AT&T <Test> "Cable"'}]
        if url == scm.CABLE_GEO_URL:
            return {
                "type": "FeatureCollection",
                "features": [{
                    "properties": {"id": "at-t"},
                    "geometry": {"type": "MultiLineString", "coordinates": [[[1.0, 2.0], [3.0, 4.0]]]},
                }],
            }
        raise AssertionError(url)

    monkeypatch.setattr(scm, "_get_json", fake)
    kml_bytes, _, cable_name = scm.fetch_cable_kml("at-t")
    assert cable_name == 'AT&T <Test> "Cable"'
    # Must be valid XML despite the raw name containing &, <, >, and " — a
    # parse failure here means the escaping is broken.
    parsed = parse_kml(kml_bytes, source_name="x")
    assert len(parsed.paths) == 1
