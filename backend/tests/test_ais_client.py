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
    assert live.last_seen_utc == "2026-10-07T12:00:00Z"   # normalised from aisstream's format


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


def test_handle_message_ignores_a_frame_with_no_position():
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
    assert "1/2 ships heard since restart" in st["detail"]


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
    st = client.status()
    assert (st["status"], st["detail"]) == ("checking", "Connecting…")


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


# ── Wider coverage: every message type, persisted last-known fixes ─────────

def _frame(msg_type, mmsi, lat=10.0, lon=20.0, body=None):
    return json.dumps({
        "MessageType": msg_type,
        "MetaData": {"MMSI": mmsi, "Latitude": lat, "Longitude": lon, "time_utc": "2026-10-07 13:00:00 UTC"},
        "Message": {msg_type: body or {}},
    })


def test_class_b_position_reports_count_as_full_fixes():
    client = AisStreamClient()
    client.seed_tracked(["525300321"])
    assert client._handle_message(_frame("StandardClassBPositionReport", 525300321,
                                         body={"Sog": 4.2, "Cog": 90.0, "TrueHeading": 91})) == "525300321"
    live = client.get("525300321")
    assert (live.sog, live.cog, live.true_heading, live.nav_status) == (4.2, 90.0, 91, None)


def test_a_static_data_frame_updates_position_but_keeps_last_motion():
    client = AisStreamClient()
    client.seed_tracked(["525300321"])
    client._handle_message(_position_report(525300321, lat=1.0, lon=2.0, sog=11.0, cog=45.0))
    client._handle_message(_frame("ShipStaticData", 525300321, lat=1.5, lon=2.5))
    live = client.get("525300321")
    assert (live.lat, live.lon) == (1.5, 2.5)
    assert (live.sog, live.cog) == (11.0, 45.0)


def test_unavailable_or_null_island_positions_are_ignored():
    client = AisStreamClient()
    client.seed_tracked(["525300321"])
    assert client._handle_message(_frame("PositionReport", 525300321, lat=91, lon=181)) is None
    assert client._handle_message(_frame("PositionReport", 525300321, lat=0, lon=0)) is None
    assert client.get("525300321") is None


def test_persistence_is_throttled_per_ship(monkeypatch):
    """The hub persists a ship's merged best fix at most once per window."""
    import asyncio
    from app.shiptracker import hub as hub_mod
    writes = []
    monkeypatch.setattr(hub_mod, "persist_last_known", lambda mmsi, live: writes.append((mmsi, live.lat)))
    monkeypatch.setenv("MARITIME_AISSTREAM_API_KEY", "k")
    fresh = AisStreamClient()
    monkeypatch.setattr(hub_mod, "ais_client", fresh)
    monkeypatch.setattr(hub_mod, "current_settings", lambda: dict(hub_mod.DEFAULT_SETTINGS))
    h = hub_mod.PositionHub()
    fresh.seed_tracked(["525300321"])

    async def two_fixes():
        fresh._handle_message(_position_report(525300321, lat=1.0))
        await h.on_fix("525300321")
        fresh._handle_message(_position_report(525300321, lat=1.1))
        await h.on_fix("525300321")   # inside the window: skipped

    asyncio.run(two_fixes())
    assert writes == [("525300321", 1.0)]


def test_persist_last_known_writes_to_the_stored_ship_and_skips_removed_ones(tmp_path, monkeypatch):
    from app import data_loader
    from app.models import TrackedShip, TrackedShipLive
    from app.shiptracker.ais_client import persist_last_known
    monkeypatch.setattr(data_loader, "DATA_DIR", tmp_path)
    data_loader._cache.clear()
    data_loader.upsert_ship(TrackedShip(mmsi="525300321", name="Teneo", added_at="t"))

    persist_last_known("525300321", TrackedShipLive(lat=1.2, lon=103.9, last_seen_utc="x"))
    persist_last_known("999999999", TrackedShipLive(lat=5, lon=5))   # not tracked: no-op

    ships = data_loader.load_ships()
    assert [s.mmsi for s in ships] == ["525300321"]
    assert ships[0].last_known.lat == 1.2
    data_loader._cache.clear()


def test_api_falls_back_to_last_known_when_nothing_heard_since_restart(monkeypatch):
    from app.api import shiptracker as api
    from app.shiptracker import hub as hub_mod
    from app.models import TrackedShip, TrackedShipLive
    monkeypatch.setenv("MARITIME_AISSTREAM_API_KEY", "k")
    fresh = AisStreamClient()
    monkeypatch.setattr(hub_mod, "ais_client", fresh)
    monkeypatch.setattr(hub_mod, "current_settings", lambda: dict(hub_mod.DEFAULT_SETTINGS))
    stored = TrackedShip(mmsi="525300321", name="Teneo", added_at="t",
                         last_known=TrackedShipLive(lat=1.2, lon=103.9, last_seen_utc="old"))
    assert api._to_view(stored).live.last_seen_utc == "old"

    fresh.seed_tracked(["525300321"])
    fresh._handle_message(_position_report(525300321, lat=1.3))
    view = api._to_view(stored)
    assert view.live.lat == 1.3            # live fix wins over stored
    assert view.live.source == "aisstream"


def test_aisstream_timestamps_are_normalised_to_iso():
    from app.shiptracker.ais_client import _iso_from_aisstream
    assert _iso_from_aisstream("2026-10-07 13:00:00.318353 +0000 UTC") == "2026-10-07T13:00:00Z"
    assert _iso_from_aisstream(None).endswith("Z")


def test_status_carries_the_facts_that_separate_broken_from_silent(monkeypatch):
    """Connected-but-nothing-heard must read differently from not-connected:
    the UI shows how long we've listened and when anything was last heard."""
    monkeypatch.setenv("MARITIME_AISSTREAM_API_KEY", "k")
    client = AisStreamClient()
    client.seed_tracked(["525300321", "228018600", "352986181"])
    client._connected = True
    client._connected_since = "2026-10-07T08:00:00Z"
    client._listening_since_monotonic = __import__("time").monotonic() - 2 * 3600 - 14 * 60
    st = client.status()
    assert st["status"] == "ok"
    assert (st["ships_heard"], st["ships_tracked"], st["last_ping_utc"]) == (0, 3, None)
    assert st["connected_since"] == "2026-10-07T08:00:00Z"
    assert "listening 2h 14m" in st["detail"]

    client._handle_message(_position_report(525300321))
    st = client.status()
    assert st["ships_heard"] == 1
    assert st["last_ping_utc"] == "2026-10-07T12:00:00Z"
    assert "last ping" in st["detail"]


def test_duration_formatting():
    from app.shiptracker.ais_client import _duration
    assert [_duration(x) for x in (45, 720, 8040, 3 * 86400 + 4 * 3600)] == ["45s", "12m", "2h 14m", "3d 4h"]
