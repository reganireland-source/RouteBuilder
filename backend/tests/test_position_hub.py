"""
PositionHub — selectable AIS sources and dual sourcing (shiptracker/hub.py).

Uses a fake polled provider registered into POLL_ADAPTERS, plus a fresh
AisStreamClient as the streaming source, so no network is touched.

Run with:  pytest backend/tests/test_position_hub.py -v
"""
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest

from app.models import TrackedShipLive
from app.shiptracker import hub as hub_mod
from app.shiptracker.ais_client import AisStreamClient
from app.shiptracker.sources import PollAdapter, SourceError

TENEO, ILE_DAIX = "525300321", "228018600"


class FakeProvider(PollAdapter):
    meta = {"label": "Fake", "env_key": "FAKE_AIS_KEY", "coverage": "test", "pricing": "test"}

    def __init__(self, fixes=None, fail=False):
        self.fixes = fixes or {}
        self.fail = fail
        self.calls: list[list[str]] = []

    def fetch(self, mmsis):
        self.calls.append(list(mmsis))
        if self.fail:
            raise SourceError("HTTP 401: bad key")
        return {m: self.fixes[m] for m in mmsis if m in self.fixes}


def _fix(lat, iso):
    return TrackedShipLive(lat=lat, lon=100.0, last_seen_utc=iso)


def _ais_frame(mmsi, lat, when="2026-10-07 10:00:00"):
    return json.dumps({
        "MessageType": "PositionReport",
        "MetaData": {"MMSI": int(mmsi), "Latitude": lat, "Longitude": 100.0, "time_utc": when},
        "Message": {"PositionReport": {"Sog": 5.0, "Cog": 90.0}},
    })


@pytest.fixture
def setup(monkeypatch):
    """A hub wired to a fresh aisstream client and one fake polled provider."""
    monkeypatch.setenv("MARITIME_AISSTREAM_API_KEY", "k")
    monkeypatch.setenv("FAKE_AIS_KEY", "k")
    fake = FakeProvider()
    monkeypatch.setitem(hub_mod.POLL_ADAPTERS, "fake", fake)
    ais = AisStreamClient()
    ais.seed_tracked([TENEO, ILE_DAIX])
    monkeypatch.setattr(hub_mod, "ais_client", ais)
    monkeypatch.setattr(hub_mod, "persist_last_known", lambda mmsi, live: None)
    settings = dict(hub_mod.DEFAULT_SETTINGS)
    monkeypatch.setattr(hub_mod, "current_settings", lambda: settings)
    return hub_mod.PositionHub(), ais, fake, settings


def test_freshest_fix_wins_across_sources(setup):
    hub, ais, fake, settings = setup
    settings.update(preferred="aisstream", secondary="fake", secondary_mode="always")
    ais._handle_message(_ais_frame(TENEO, 1.0, "2026-10-07 10:00:00"))
    fake.fixes = {TENEO: _fix(2.0, "2026-10-07T11:00:00Z")}
    asyncio.run(hub.poll_once())
    best = hub.best(TENEO)
    assert (best.lat, best.source) == (2.0, "fake")   # newer, even though not preferred


def test_preferred_source_wins_a_tie(setup):
    hub, ais, fake, settings = setup
    settings.update(preferred="fake", secondary="aisstream", secondary_mode="always")
    ais._handle_message(_ais_frame(TENEO, 1.0, "2026-10-07 10:00:00"))
    fake.fixes = {TENEO: _fix(2.0, "2026-10-07T10:00:00Z")}
    asyncio.run(hub.poll_once())
    assert hub.best(TENEO).source == "fake"


def test_fallback_secondary_is_only_asked_about_ships_the_preferred_lost(setup, monkeypatch):
    hub, ais, fake, settings = setup
    settings.update(preferred="aisstream", secondary="fake", secondary_mode="fallback", stale_minutes=30)
    # aisstream located Teneo just now; Ile d'Aix never.
    now_iso = __import__("datetime").datetime.now(__import__("datetime").UTC).strftime("%Y-%m-%d %H:%M:%S")
    ais._handle_message(_ais_frame(TENEO, 1.0, now_iso))
    asyncio.run(hub.poll_once())
    assert fake.calls == [[ILE_DAIX]]


def test_always_mode_polls_every_tracked_ship(setup):
    hub, ais, fake, settings = setup
    settings.update(preferred="aisstream", secondary="fake", secondary_mode="always")
    asyncio.run(hub.poll_once())
    assert fake.calls == [[ILE_DAIX, TENEO]]


def test_unselected_or_unconfigured_sources_are_ignored(setup, monkeypatch):
    hub, ais, fake, settings = setup
    settings.update(preferred="aisstream", secondary=None)
    fake.fixes = {TENEO: _fix(2.0, "2026-10-07T11:00:00Z")}
    asyncio.run(hub.poll_once())
    assert fake.calls == []                      # not selected: never polled
    settings.update(secondary="fake")
    monkeypatch.delenv("FAKE_AIS_KEY")
    asyncio.run(hub.poll_once())
    assert fake.calls == []                      # selected but no key: never polled


def test_a_failing_provider_reports_an_error_without_breaking_the_loop(setup):
    hub, ais, fake, settings = setup
    settings.update(preferred="fake", secondary="aisstream")
    fake.fail = True
    asyncio.run(hub.poll_once())                 # must not raise
    st = {s["id"]: s for s in hub.sources_status()["sources"]}
    assert st["fake"]["status"] == "error"
    assert "401" in st["fake"]["detail"]


def test_validate_settings():
    v = hub_mod.validate_settings
    assert v({})["preferred"] == "aisstream"
    assert v({"secondary": "none"})["secondary"] is None
    with pytest.raises(ValueError):
        v({"preferred": "nope"})
    with pytest.raises(ValueError):
        v({"preferred": "aisstream", "secondary": "aisstream"})
    with pytest.raises(ValueError):
        v({"secondary_mode": "sometimes"})
    with pytest.raises(ValueError):
        v({"poll_minutes": 0})
