"""
AisStreamClient._handle_message — parsing one aisstream.io PositionReport
frame into the in-memory TrackedShipLive cache. This is the one piece of
real parsing logic ShipTracker's live-tracking path has (everything else is
either Pydantic validation or straight data_loader CRUD), so it's the part
worth a focused unit test: untracked MMSIs must be dropped, malformed JSON
must not crash the connection loop, and AIS's own TrueHeading=511 "not
available" sentinel must normalise to None rather than being stored as a
real heading.

No real network — _handle_message is a plain synchronous method, called
directly with hand-built message strings; run_forever()'s actual WebSocket
connection is exercised only by the live E2E verification pass, not here.

Run with:  pytest backend/tests/test_ais_client.py -v
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.shiptracker.ais_client import AisStreamClient


def _position_report(mmsi: int, lat=1.0, lon=2.0, sog=10.5, cog=90.0, true_heading=88, nav_status=0, ship_name="TENEO"):
    return json.dumps({
        "MessageType": "PositionReport",
        "MetaData": {"MMSI": mmsi, "ShipName": ship_name, "Latitude": lat, "Longitude": lon, "time_utc": "2026-10-07 12:00:00 UTC"},
        "Message": {"PositionReport": {
            "MessageID": 1, "UserID": mmsi, "Sog": sog, "Cog": cog,
            "TrueHeading": true_heading, "NavigationalStatus": nav_status,
        }},
    })


def test_handle_message_caches_a_tracked_ships_position():
    client = AisStreamClient()
    client.seed_tracked(["525300321"])

    client._handle_message(_position_report(525300321, lat=-3.5, lon=140.2, sog=12.3, cog=200.0, true_heading=199, nav_status=0))

    live = client.get("525300321")
    assert live is not None
    assert live.lat == -3.5
    assert live.lon == 140.2
    assert live.sog == 12.3
    assert live.cog == 200.0
    assert live.true_heading == 199
    assert live.nav_status == 0
    assert live.last_seen_utc == "2026-10-07 12:00:00 UTC"


def test_handle_message_ignores_an_untracked_mmsi():
    client = AisStreamClient()
    client.seed_tracked(["525300321"])  # only Teneo tracked

    client._handle_message(_position_report(999999999))  # some other ship

    assert client.get("999999999") is None
    assert client.get_all() == {}


def test_handle_message_normalises_the_true_heading_511_sentinel_to_none():
    client = AisStreamClient()
    client.seed_tracked(["525300321"])

    client._handle_message(_position_report(525300321, true_heading=511))

    assert client.get("525300321").true_heading is None


def test_handle_message_ignores_non_position_report_message_types():
    client = AisStreamClient()
    client.seed_tracked(["525300321"])

    client._handle_message(json.dumps({
        "MessageType": "ShipStaticData",
        "MetaData": {"MMSI": 525300321},
        "Message": {"ShipStaticData": {}},
    }))

    assert client.get("525300321") is None


def test_handle_message_survives_malformed_json():
    client = AisStreamClient()
    client.seed_tracked(["525300321"])

    client._handle_message("not valid json at all {{{")  # must not raise

    assert client.get_all() == {}


def test_get_all_returns_a_copy_not_the_live_cache_dict():
    client = AisStreamClient()
    client.seed_tracked(["525300321"])
    client._handle_message(_position_report(525300321))

    snapshot = client.get_all()
    snapshot.clear()

    assert client.get("525300321") is not None  # untouched by mutating the snapshot


# ── status() — what the bottom status bar's "Ship AIS" dot shows ───────────

def test_status_is_disabled_without_an_api_key(monkeypatch):
    monkeypatch.delenv("MARITIME_AISSTREAM_API_KEY", raising=False)
    assert AisStreamClient().status()["status"] == "disabled"


def test_status_reports_connected_and_how_many_ships_are_reporting(monkeypatch):
    monkeypatch.setenv("MARITIME_AISSTREAM_API_KEY", "k")
    client = AisStreamClient()
    client.seed_tracked(["525300321", "228018600"])
    client._connected = True
    client._handle_message(_position_report(525300321))
    st = client.status()
    assert st["status"] == "ok"
    assert "1/2 ships reporting" in st["detail"]


def test_an_aisstream_error_frame_surfaces_as_an_error_status(monkeypatch):
    """aisstream.io rejects a bad key with {"error": ...} then closes."""
    monkeypatch.setenv("MARITIME_AISSTREAM_API_KEY", "bad")
    client = AisStreamClient()
    client._started = True
    client._handle_message(json.dumps({"error": "Api Key Is Not Valid"}))
    st = client.status()
    assert st["status"] == "error"
    assert "Api Key Is Not Valid" in st["detail"]


def test_status_is_checking_while_still_connecting(monkeypatch):
    monkeypatch.setenv("MARITIME_AISSTREAM_API_KEY", "k")
    client = AisStreamClient()
    client._started = True
    assert client.status() == {"status": "checking", "detail": "Connecting…"}


# ── GET /api/health/sources — hazard feeds read from cache, never rebuilt ──

def test_hazard_source_health_never_triggers_a_feed_rebuild(monkeypatch):
    from app.api import health
    from app.hazards import service as hazard_service
    from app.hazards.models import HazardFeed, HazardSourceStatus

    monkeypatch.delenv("HAZARDS_ENABLED", raising=False)
    monkeypatch.setenv("BUSHFIRE_API_KEY", "k")
    svc = hazard_service.service
    monkeypatch.setattr(svc, "get", lambda **_: (_ for _ in ()).throw(AssertionError("must not rebuild")))

    monkeypatch.setattr(svc, "_cached", None)
    assert health._hazard_source_health("usgs", "USGS")["status"] == "checking"

    monkeypatch.setattr(svc, "_cached", HazardFeed(fetched_at="2026-10-07T00:00:00Z", sources=[
        HazardSourceStatus(source="bushfire", label="Bushfire.io", ok=False, error="HTTP 401"),
        HazardSourceStatus(source="usgs", label="USGS", ok=True, count=4),
    ]))
    monkeypatch.setattr(svc, "_cached_at", __import__("time").monotonic())
    assert health._hazard_source_health("usgs", "USGS")["status"] == "ok"
    bf = health._hazard_source_health("bushfire", "Bushfire.io")
    assert bf["status"] == "error" and "HTTP 401" in bf["detail"]


def test_bushfire_without_a_key_is_disabled_not_an_error(monkeypatch):
    from app.api import health
    monkeypatch.delenv("HAZARDS_ENABLED", raising=False)
    monkeypatch.delenv("BUSHFIRE_API_KEY", raising=False)
    assert health._hazard_source_health("bushfire", "Bushfire.io")["status"] == "disabled"


def test_create_ship_rejects_an_mmsi_that_is_not_nine_digits():
    import pytest
    from pydantic import ValidationError
    from app.api.shiptracker import CreateShipRequest
    CreateShipRequest(mmsi="525300321")
    for bad in ["12345", "5253003210", "52530O321", ""]:
        with pytest.raises(ValidationError):
            CreateShipRequest(mmsi=bad)
