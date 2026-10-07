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
