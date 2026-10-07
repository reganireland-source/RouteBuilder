"""
PositionHub — prioritised AIS sources, fallback/always modes and monthly
call allowances (shiptracker/hub.py).

Uses fake polled providers registered into POLL_ADAPTERS, plus a fresh
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
    for real in ("MARINESIA_API_KEY", "VESSELAPI_API_KEY", "MYSHIPTRACKING_API_KEY"):
        monkeypatch.delenv(real, raising=False)
    fake = FakeProvider()
    monkeypatch.setitem(hub_mod.POLL_ADAPTERS, "fake", fake)
    ais = AisStreamClient()
    ais.seed_tracked([TENEO, ILE_DAIX])
    monkeypatch.setattr(hub_mod, "ais_client", ais)
    monkeypatch.setattr(hub_mod, "persist_last_known", lambda mmsi, live: None)
    saved_usage = {}
    monkeypatch.setattr(hub_mod, "load_usage", lambda: dict(saved_usage))
    monkeypatch.setattr(hub_mod, "save_usage", lambda usage: saved_usage.update(json.loads(json.dumps(usage))))
    settings = hub_mod.validate_settings({})
    monkeypatch.setattr(hub_mod, "current_settings", lambda: settings)
    return hub_mod.PositionHub(), ais, fake, settings


def test_freshest_fix_wins_across_sources(setup):
    hub, ais, fake, settings = setup
    settings.update(order=["aisstream", "fake"], mode="always")
    ais._handle_message(_ais_frame(TENEO, 1.0, "2026-10-07 10:00:00"))
    fake.fixes = {TENEO: _fix(2.0, "2026-10-07T11:00:00Z")}
    asyncio.run(hub.poll_once())
    best = hub.best(TENEO)
    assert (best.lat, best.source) == (2.0, "fake")   # newer, even though not preferred


def test_earlier_source_wins_a_tie(setup):
    hub, ais, fake, settings = setup
    settings.update(order=["fake", "aisstream"], mode="always")
    ais._handle_message(_ais_frame(TENEO, 1.0, "2026-10-07 10:00:00"))
    fake.fixes = {TENEO: _fix(2.0, "2026-10-07T10:00:00Z")}
    asyncio.run(hub.poll_once())
    assert hub.best(TENEO).source == "fake"


def test_fallback_source_is_only_asked_about_ships_earlier_sources_lost(setup, monkeypatch):
    hub, ais, fake, settings = setup
    settings.update(order=["aisstream", "fake"], mode="fallback", stale_minutes=30)
    # aisstream located Teneo just now; Ile d'Aix never.
    now_iso = __import__("datetime").datetime.now(__import__("datetime").UTC).strftime("%Y-%m-%d %H:%M:%S")
    ais._handle_message(_ais_frame(TENEO, 1.0, now_iso))
    asyncio.run(hub.poll_once())
    assert fake.calls == [[ILE_DAIX]]


def test_always_mode_polls_every_tracked_ship(setup):
    hub, ais, fake, settings = setup
    settings.update(order=["aisstream", "fake"], mode="always")
    asyncio.run(hub.poll_once())
    assert fake.calls == [[ILE_DAIX, TENEO]]


def test_unselected_or_unconfigured_sources_are_ignored(setup, monkeypatch):
    hub, ais, fake, settings = setup
    settings.update(order=["aisstream"])
    fake.fixes = {TENEO: _fix(2.0, "2026-10-07T11:00:00Z")}
    asyncio.run(hub.poll_once())
    assert fake.calls == []                      # not selected: never polled
    settings.update(order=["aisstream", "fake"])
    monkeypatch.delenv("FAKE_AIS_KEY")
    asyncio.run(hub.poll_once())
    assert fake.calls == []                      # selected but no key: never polled


def test_a_failing_provider_reports_an_error_without_breaking_the_loop(setup):
    hub, ais, fake, settings = setup
    settings.update(order=["fake", "aisstream"])
    fake.fail = True
    asyncio.run(hub.poll_once())                 # must not raise
    st = {s["id"]: s for s in hub.sources_status()["sources"]}
    assert st["fake"]["status"] == "error"
    assert "401" in st["fake"]["detail"]


def test_validate_settings():
    v = hub_mod.validate_settings
    d = v({})
    assert d["order"][0] == "aisstream" and d["mode"] == "fallback" and d["poll_minutes"] == 90
    assert d["budgets"]["vesselapi"] == 150 and d["budgets"]["marinesia"] == 700
    assert d["budgets"]["myshiptracking"] is None
    assert v({"poll_minutes": 90})["poll_minutes"] == 90
    assert v({"budgets": {"vesselapi": None}})["budgets"]["vesselapi"] is None   # paid plan: unlimited
    for bad in ({"order": ["nope"]}, {"order": []}, {"order": ["aisstream", "aisstream"]},
                {"mode": "sometimes"}, {"poll_minutes": 0}, {"poll_minutes": 91},
                {"budgets": {"nope": 5}}, {"budgets": {"vesselapi": -1}}):
        with pytest.raises(ValueError):
            v(bad)


def test_legacy_preferred_secondary_settings_still_load():
    s = hub_mod.validate_settings({"preferred": "aisstream", "secondary": "vesselapi", "secondary_mode": "always", "poll_minutes": 5})
    assert (s["order"], s["mode"], s["poll_minutes"]) == (["aisstream", "vesselapi"], "always", 5)
    assert "preferred" not in s


# ── call allowances ──────────────────────────────────────────────────────

def test_free_allowance_is_paced_across_the_month(setup, monkeypatch):
    hub, ais, fake, settings = setup
    settings.update(order=["fake"], mode="always")
    settings["budgets"]["fake"] = 150
    clock = [hub_mod.datetime(2026, 10, 1, tzinfo=hub_mod.UTC).timestamp()]
    monkeypatch.setattr(hub_mod.time, "time", lambda: clock[0])
    asyncio.run(hub.poll_once())
    assert fake.calls == [[ILE_DAIX, TENEO]]           # first poll: both ships
    asyncio.run(hub.poll_once())
    assert len(fake.calls) == 1                        # immediately after: nothing due yet
    # 31 days ÷ 148 remaining calls ≈ 5h between calls; 90-min polls all month.
    for _ in range(31 * 24 * 60 // 90 - 1):
        clock[0] += 90 * 60
        asyncio.run(hub.poll_once())
    total = sum(len(c) for c in fake.calls)
    assert 140 <= total <= 150                         # uses the allowance, never exceeds it
    st = {s["id"]: s for s in hub.sources_status()["sources"]}["fake"]
    assert st["usage"]["calls_this_month"] == total and st["usage"]["budget"] == 150


def test_allowance_rotates_through_ships(setup, monkeypatch):
    hub, ais, fake, settings = setup
    settings.update(order=["fake"], mode="always")
    settings["budgets"]["fake"] = 700
    monkeypatch.setitem(fake.meta, "max_burst", 1)
    monkeypatch.setitem(fake.meta, "min_spacing_s", 3600)
    clock = [hub_mod.datetime(2026, 10, 1, tzinfo=hub_mod.UTC).timestamp()]
    monkeypatch.setattr(hub_mod.time, "time", lambda: clock[0])
    for _ in range(4):
        asyncio.run(hub.poll_once())
        clock[0] += 1800
        asyncio.run(hub.poll_once())                    # half an hour later: rate limit holds
        clock[0] += 2200
    # 700 calls over October's 744 hours ≈ one call every ~64 min, one ship at a time.
    assert fake.calls == [[ILE_DAIX], [TENEO], [ILE_DAIX], [TENEO]]


def test_spent_allowance_stops_calls_until_next_month(setup, monkeypatch):
    hub, ais, fake, settings = setup
    settings.update(order=["fake"], mode="always")
    settings["budgets"]["fake"] = 2
    clock = [hub_mod.datetime(2026, 10, 30, tzinfo=hub_mod.UTC).timestamp()]
    monkeypatch.setattr(hub_mod.time, "time", lambda: clock[0])
    asyncio.run(hub.poll_once())
    clock[0] += 86400 / 2
    asyncio.run(hub.poll_once())
    assert len(fake.calls) == 1                         # budget of 2 spent on the first poll
    assert "allowance used" in {s["id"]: s for s in hub.sources_status()["sources"]}["fake"]["detail"]
    clock[0] = hub_mod.datetime(2026, 11, 1, 1, tzinfo=hub_mod.UTC).timestamp()
    asyncio.run(hub.poll_once())
    assert len(fake.calls) == 2                         # new month, fresh allowance


def test_usage_survives_a_restart(setup, monkeypatch):
    hub, ais, fake, settings = setup
    settings.update(order=["fake"], mode="always")
    settings["budgets"]["fake"] = 150
    clock = [hub_mod.datetime(2026, 10, 1, tzinfo=hub_mod.UTC).timestamp()]
    monkeypatch.setattr(hub_mod.time, "time", lambda: clock[0])
    asyncio.run(hub.poll_once())
    fresh = hub_mod.PositionHub()                       # same persisted usage
    asyncio.run(fresh.poll_once())
    assert len(fake.calls) == 1


def test_fallback_chain_free_first_paid_fills_gaps(setup, monkeypatch):
    hub, ais, fake, settings = setup
    paid = FakeProvider(fixes={ILE_DAIX: _fix(3.0, "2026-10-07T11:00:00Z")})
    paid.meta = {**FakeProvider.meta, "env_key": "PAID_AIS_KEY"}
    monkeypatch.setenv("PAID_AIS_KEY", "k")
    monkeypatch.setitem(hub_mod.POLL_ADAPTERS, "paid", paid)
    settings.update(order=["aisstream", "fake", "paid"], mode="fallback", stale_minutes=30)
    settings["budgets"].update(fake=None, paid=None)
    now_iso = __import__("datetime").datetime.now(__import__("datetime").UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    fake.fixes = {TENEO: _fix(2.0, now_iso)}           # free source finds Teneo only
    asyncio.run(hub.poll_once())
    assert fake.calls == [[ILE_DAIX, TENEO]]
    assert paid.calls == [[ILE_DAIX]]                  # paid only asked about the gap
    assert hub.best(ILE_DAIX).source == "paid"
