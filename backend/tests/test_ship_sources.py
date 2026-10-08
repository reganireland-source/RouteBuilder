"""
Polled AIS providers (shiptracker/sources.py) — response parsing against the
sample payloads in each provider's own documentation. No network: get_json
is monkeypatched.

Run with:  pytest backend/tests/test_ship_sources.py -v
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest

from app.shiptracker import sources
from app.shiptracker.sources import MarinesiaAdapter, MyShipTrackingAdapter, SourceError, VesselApiAdapter, iso_utc


def _stub(monkeypatch, response=None, error=None):
    calls = []

    def fake_get_json(url, headers=None, redact=""):
        calls.append((url, headers))
        if error:
            raise SourceError(error)
        return response
    monkeypatch.setattr(sources, "get_json", fake_get_json)
    return calls


# ── VesselAPI ──────────────────────────────────────────────────────────────

VESSELAPI_SAMPLE = {"vesselPosition": {
    "cog": 231.5, "heading": 230, "imo": 9811000, "latitude": 1.2644, "longitude": 103.8215,
    "mmsi": 353136000, "nav_status": 0, "sog": 14.1, "suspected_glitch": False,
    "timestamp": "2026-10-07T10:15:00Z", "vessel_name": "EVER GIVEN",
}}


def test_vesselapi_parses_its_documented_response(monkeypatch):
    monkeypatch.setenv("VESSELAPI_API_KEY", "secret")
    calls = _stub(monkeypatch, VESSELAPI_SAMPLE)
    out = VesselApiAdapter().fetch(["353136000"])
    live = out["353136000"]
    assert (live.lat, live.lon, live.sog, live.cog, live.true_heading, live.nav_status) == (1.2644, 103.8215, 14.1, 231.5, 230, 0)
    assert live.last_seen_utc == "2026-10-07T10:15:00Z"
    url, headers = calls[0]
    assert url.startswith("https://api.vesselapi.com/v1/vessel/353136000/position?")
    assert "filter.idType=mmsi" in url and "filter.sat" not in url   # satellite is opt-in (costs extra)
    assert headers == {"Authorization": "Bearer secret"}


def test_vesselapi_satellite_is_only_requested_when_opted_in(monkeypatch):
    monkeypatch.setenv("VESSELAPI_API_KEY", "k")
    monkeypatch.setenv("VESSELAPI_USE_SATELLITE", "true")
    calls = _stub(monkeypatch, VESSELAPI_SAMPLE)
    VesselApiAdapter().fetch(["353136000"])
    assert "filter.sat=true" in calls[0][0]


def test_vesselapi_404_means_no_position_not_an_error(monkeypatch):
    monkeypatch.setenv("VESSELAPI_API_KEY", "k")
    _stub(monkeypatch, error="HTTP 404: not found")
    assert VesselApiAdapter().fetch(["228018600"]) == {}


def test_vesselapi_auth_failure_is_reported(monkeypatch):
    monkeypatch.setenv("VESSELAPI_API_KEY", "k")
    _stub(monkeypatch, error="HTTP 401: unauthorized")
    with pytest.raises(SourceError, match="401"):
        VesselApiAdapter().fetch(["228018600", "352986181"])


# ── MyShipTracking ─────────────────────────────────────────────────────────

MST_SAMPLE = {"status": "success", "data": {
    "vessel_name": "BLUE STAR DELOS", "mmsi": 241087000, "imo": 9565039,
    "lat": 37.94, "lng": 23.64, "course": 182, "speed": 0, "nav_status": 5,
    "received": "2026-10-07T22:47:28Z",
}}


def test_myshiptracking_parses_its_documented_response(monkeypatch):
    monkeypatch.setenv("MYSHIPTRACKING_API_KEY", "k")
    calls = _stub(monkeypatch, MST_SAMPLE)
    live = MyShipTrackingAdapter().fetch(["241087000"])["241087000"]
    assert (live.lat, live.lon, live.sog, live.cog, live.nav_status) == (37.94, 23.64, 0, 182, 5)
    assert live.true_heading is None   # the simple response has no heading
    assert live.last_seen_utc == "2026-10-07T22:47:28Z"
    assert calls[0][0] == "https://api.myshiptracking.com/api/v2/vessel?mmsi=241087000"


def test_myshiptracking_not_found_and_null_island_are_skipped(monkeypatch):
    monkeypatch.setenv("MYSHIPTRACKING_API_KEY", "k")
    _stub(monkeypatch, {"status": "error", "code": "ERR_NOT_FOUND"})
    assert MyShipTrackingAdapter().fetch(["228018600"]) == {}
    _stub(monkeypatch, {"status": "success", "data": {**MST_SAMPLE["data"], "lat": 0, "lng": 0}})
    assert MyShipTrackingAdapter().fetch(["241087000"]) == {}


# ── Marinesia ──────────────────────────────────────────────────────────────

MARINESIA_FIX = {"mmsi": 228018600, "lat": 24.25, "lng": 120.51, "sog": 0.1, "cog": 87.0,
                 "hdt": 511, "status": 5, "ts": "2026-10-07T09:58:00Z"}


@pytest.mark.parametrize("response", [
    {"error": False, "message": "ok", "data": MARINESIA_FIX},   # enveloped
    {"error": False, "data": [MARINESIA_FIX]},                  # list envelope
    MARINESIA_FIX,                                              # bare
])
def test_marinesia_parses_its_documented_fields(monkeypatch, response):
    monkeypatch.setenv("MARINESIA_API_KEY", "sekrit")
    calls = _stub(monkeypatch, response)
    live = MarinesiaAdapter().fetch(["228018600"])["228018600"]
    assert (live.lat, live.lon, live.sog, live.cog, live.nav_status) == (24.25, 120.51, 0.1, 87.0, 5)
    assert live.true_heading is None                            # 511 = heading not available
    assert live.last_seen_utc == "2026-10-07T09:58:00Z"
    assert calls[0][0] == "https://api.marinesia.com/api/v1/vessel/228018600/location/latest?key=sekrit"


def test_marinesia_error_envelope_and_bad_key(monkeypatch):
    monkeypatch.setenv("MARINESIA_API_KEY", "k")
    _stub(monkeypatch, {"error": True, "message": "Vessel not found"})
    assert MarinesiaAdapter().fetch(["228018600"]) == {}
    _stub(monkeypatch, error="HTTP 403: Invalid API Key")      # what the live API returns for a bad key
    with pytest.raises(SourceError, match="Invalid API Key"):
        MarinesiaAdapter().fetch(["228018600"])


def test_adapters_are_unconfigured_without_their_key(monkeypatch):
    monkeypatch.delenv("VESSELAPI_API_KEY", raising=False)
    monkeypatch.delenv("MYSHIPTRACKING_API_KEY", raising=False)
    monkeypatch.delenv("MARINESIA_API_KEY", raising=False)
    assert not MarinesiaAdapter().configured()
    assert not VesselApiAdapter().configured()
    assert not MyShipTrackingAdapter().configured()


def test_get_json_never_leaks_the_key_in_errors(monkeypatch):
    import io
    import urllib.error

    def boom(req, timeout):
        raise urllib.error.HTTPError(req.full_url, 401, "x", {}, io.BytesIO(b"bad key sekrit123"))
    monkeypatch.setattr(sources.urllib.request, "urlopen", boom)
    with pytest.raises(SourceError) as exc:
        sources.get_json("https://example.com/?key=sekrit123", redact="sekrit123")
    assert "sekrit123" not in str(exc.value)


def test_iso_utc_normalises_provider_timestamps():
    assert iso_utc("2026-10-07T10:15:00Z") == "2026-10-07T10:15:00Z"
    assert iso_utc("2026-10-07 10:15:00 UTC") == "2026-10-07T10:15:00Z"
    assert iso_utc("2026-10-07T18:15:00+08:00") == "2026-10-07T10:15:00Z"
    assert iso_utc(1620484020) == "2021-05-08T14:27:00Z"
    assert iso_utc("garbage") is None
    assert iso_utc(None) is None


def test_provider_error_bodies_are_reduced_to_their_message():
    from app.shiptracker.sources import _error_message
    assert _error_message('{"error":{"type":"authentication_error","message":"api key is invalid or not found"}}') == "api key is invalid or not found"
    assert _error_message('{"status":"error","code":"ERR_INVALID_KEY","message":"Invalid API key provided."}') == "Invalid API key provided."
    assert _error_message("404 page not found\n") == "404 page not found"
