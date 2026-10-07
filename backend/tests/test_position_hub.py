"""
PositionHub — prioritised AIS sources, share (round robin) / fallback /
always modes, call limits and busy hours (shiptracker/hub.py, schedule.py).

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
        self.sees_everything = False
        self.calls: list[list[str]] = []
        self.times: list[float] = []

    def fetch(self, mmsis):
        self.calls.append(list(mmsis))
        self.times.append(hub_mod.time.time())
        if self.fail:
            raise SourceError("HTTP 401: bad key")
        if self.sees_everything:   # a fresh fix for every ship asked about
            from datetime import UTC, datetime
            now_iso = datetime.fromtimestamp(hub_mod.time.time(), UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
            return {m: _fix(1.0, now_iso) for m in mmsis}
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


def _lim(per_month=None, per_hour=None):
    return {"per_month": per_month, "per_hour": per_hour}


def _clock(monkeypatch, *args):
    clock = [hub_mod.datetime(*args, tzinfo=hub_mod.UTC).timestamp()]
    monkeypatch.setattr(hub_mod.time, "time", lambda: clock[0])
    return clock


def test_validate_settings():
    v = hub_mod.validate_settings
    d = v({})
    assert d["order"][0] == "aisstream" and d["mode"] == "share" and d["poll_minutes"] == 90
    assert d["limits"]["vesselapi"] == _lim(per_month=150)
    assert d["limits"]["marinesia"] == _lim(per_hour=1)
    assert d["limits"]["myshiptracking"] == _lim()
    assert d["peak"] == {"start_hour": 4, "end_hour": 20, "utc_offset": 8, "weight": 1.5}
    assert v({"limits": {"vesselapi": {"per_month": None}}})["limits"]["vesselapi"] == _lim()   # paid plan: no limit
    assert v({"limits": {"marinesia": {"per_hour": 5}}})["limits"]["marinesia"] == _lim(per_hour=5)
    for bad in ({"order": ["nope"]}, {"order": []}, {"order": ["aisstream", "aisstream"]},
                {"mode": "sometimes"}, {"poll_minutes": 0}, {"poll_minutes": 91},
                {"limits": {"nope": {}}}, {"limits": {"vesselapi": {"per_month": -1}}},
                {"peak": {"weight": 5}}, {"peak": {"start_hour": 24}}, {"peak": {"utc_offset": 15}}):
        with pytest.raises(ValueError):
            v(bad)


def test_legacy_settings_still_load():
    s = hub_mod.validate_settings({"preferred": "aisstream", "secondary": "vesselapi", "secondary_mode": "always", "poll_minutes": 5})
    assert (s["order"], s["mode"], s["poll_minutes"]) == (["aisstream", "vesselapi"], "always", 5)
    assert "preferred" not in s
    s = hub_mod.validate_settings({"order": ["marinesia"], "mode": "fallback", "budgets": {"marinesia": 700, "vesselapi": 100}})
    assert s["limits"]["marinesia"] == _lim(per_hour=1)            # old built-in default → new free tier
    assert s["limits"]["vesselapi"] == _lim(per_month=100)         # an admin's own choice is kept
    assert s["mode"] == "share"                                    # old default "fallback" → new default


# ── share mode: round robin across sources ───────────────────────────────

FU_TAI = "352986181"


@pytest.fixture
def two_free(setup, monkeypatch):
    """Two free, 1-call-per-hour sources sharing three ships."""
    hub, ais, fake, settings = setup
    ais.seed_tracked([TENEO, ILE_DAIX, FU_TAI])
    other = FakeProvider()
    other.meta = {**FakeProvider.meta, "env_key": "OTHER_AIS_KEY"}
    monkeypatch.setenv("OTHER_AIS_KEY", "k")
    monkeypatch.setitem(hub_mod.POLL_ADAPTERS, "other", other)
    settings.update(order=["aisstream", "fake", "other"], mode="share")
    settings["limits"].update(fake=_lim(per_hour=1), other=_lim(per_hour=1))
    return hub, fake, other


def test_share_mode_splits_ships_between_sources(two_free, monkeypatch):
    hub, fake, other = two_free
    clock = _clock(monkeypatch, 2026, 10, 7, 2)
    for _ in range(3):
        asyncio.run(hub.poll_once())
        clock[0] += 3631
    asked = [c[0] for c in fake.calls + other.calls]
    assert all(len(c) == 1 for c in fake.calls + other.calls)
    assert len(fake.calls) == 3 and len(other.calls) == 3                 # both at their full free rate
    assert set(asked[:3]) == {TENEO, ILE_DAIX, FU_TAI}                   # first 3 turns cover every ship
    for f, o in zip(fake.calls, other.calls):
        assert f != o                                                     # never the same ship in one pass


def test_share_mode_leaves_a_ship_a_source_cannot_see_to_the_others(two_free, monkeypatch):
    hub, fake, other = two_free
    clock = _clock(monkeypatch, 2026, 10, 7, 2)
    fake.fixes = {TENEO: _fix(1.0, "2026-10-07T02:00:00Z"), ILE_DAIX: _fix(2.0, "2026-10-07T02:00:00Z")}
    other.fixes = {m: _fix(3.0, "2026-10-07T02:00:00Z") for m in (TENEO, ILE_DAIX, FU_TAI)}
    for _ in range(6):
        asyncio.run(hub.poll_once())
        clock[0] += 3631
    fake_asked = [c[0] for c in fake.calls]
    assert fake_asked.count(FU_TAI) == 1                                  # tried once, came back empty, then left alone
    assert [c[0] for c in other.calls].count(FU_TAI) >= 2                 # the source that can see it keeps it fresh


def test_share_mode_skips_ships_the_stream_already_hears(two_free, monkeypatch):
    hub, fake, other = two_free
    from datetime import UTC, datetime
    clock = _clock(monkeypatch, 2026, 10, 7, 2)
    ais = hub_mod.ais_client
    ais._handle_message(_ais_frame(TENEO, 1.0, datetime.fromtimestamp(clock[0], UTC).strftime("%Y-%m-%d %H:%M:%S")))
    asyncio.run(hub.poll_once())
    assert TENEO not in {c[0] for c in fake.calls + other.calls}


def test_paid_unlimited_source_only_fills_gaps_in_share_mode(two_free, monkeypatch):
    hub, fake, other = two_free
    from datetime import UTC, datetime
    clock = _clock(monkeypatch, 2026, 10, 7, 2)
    hub_mod.current_settings()["limits"]["other"] = _lim()               # "other" is now a paid source, no limit
    ais = hub_mod.ais_client
    ais._handle_message(_ais_frame(TENEO, 1.0, datetime.fromtimestamp(clock[0], UTC).strftime("%Y-%m-%d %H:%M:%S")))
    asyncio.run(hub.poll_once())
    assert len(fake.calls) == 1 and TENEO not in fake.calls[0]            # free source takes one turn
    assert sorted(other.calls[0]) == sorted([ILE_DAIX, FU_TAI])           # paid: only ships with nothing fresh
    assert hub.seconds_until_next_poll() <= 90 * 60


# ── limits & busy hours ──────────────────────────────────────────────────

def test_monthly_allowance_is_used_but_never_exceeded(setup, monkeypatch):
    hub, ais, fake, settings = setup
    settings.update(order=["fake"], mode="always")
    settings["limits"]["fake"] = _lim(per_month=150)
    clock = _clock(monkeypatch, 2026, 10, 1)
    end = hub_mod.datetime(2026, 11, 1, tzinfo=hub_mod.UTC).timestamp()
    while clock[0] < end:                     # the real loop: sleep until the next call is due
        asyncio.run(hub.poll_once())
        clock[0] += hub.seconds_until_next_poll()
    total = sum(len(c) for c in fake.calls if c)
    assert 145 <= total <= 150
    st = {s["id"]: s for s in hub.sources_status()["sources"]}["fake"]
    assert st["usage"]["per_month"] == 150


def test_monthly_allowance_leans_towards_busy_hours(setup, monkeypatch):
    hub, ais, fake, settings = setup
    settings.update(order=["fake"], mode="always")
    settings["limits"]["fake"] = _lim(per_month=150)
    clock = _clock(monkeypatch, 2026, 10, 1)
    times = []
    end = hub_mod.datetime(2026, 11, 1, tzinfo=hub_mod.UTC).timestamp()
    while clock[0] < end:
        before = len(fake.calls)
        asyncio.run(hub.poll_once())
        times += [clock[0]] * sum(len(c) for c in fake.calls[before:])
        clock[0] += hub.seconds_until_next_poll()
    busy = sum(1 for t in times if hub_mod.schedule.is_peak(t, settings["peak"]))
    # 16 busy hours a day at ×1.5 vs 8 quiet → 24/32 = 75% of calls in busy hours.
    assert 0.70 <= busy / len(times) <= 0.80


def test_hourly_limit_is_a_rolling_window_and_the_loop_wakes_when_due(setup, monkeypatch):
    hub, ais, fake, settings = setup
    settings.update(order=["fake"], mode="always")
    settings["limits"]["fake"] = _lim(per_hour=1)
    clock = _clock(monkeypatch, 2026, 10, 7, 2)
    asyncio.run(hub.poll_once())
    assert fake.calls == [[ILE_DAIX]]
    wait = hub.seconds_until_next_poll()
    assert 3600 < wait < 3700                                             # wakes right when the hour is up
    clock[0] += 1800
    asyncio.run(hub.poll_once())
    assert len(fake.calls) == 1                                           # still inside the hour
    clock[0] += wait - 1800
    asyncio.run(hub.poll_once())
    assert fake.calls == [[ILE_DAIX], [TENEO]]


def test_spent_allowance_stops_calls_until_next_month(setup, monkeypatch):
    hub, ais, fake, settings = setup
    settings.update(order=["fake"], mode="always")
    settings["limits"]["fake"] = _lim(per_month=2)
    clock = _clock(monkeypatch, 2026, 10, 30)
    for _ in range(4):                                  # 30 Oct 00:00 → 31 Oct 12:00, every 12 h
        asyncio.run(hub.poll_once())
        if _ < 3:
            clock[0] += 86400 / 2
    assert sum(len(c) for c in fake.calls) == 2        # allowance of 2, never more
    assert "allowance used" in {s["id"]: s for s in hub.sources_status()["sources"]}["fake"]["detail"]
    clock[0] = hub_mod.datetime(2026, 11, 1, 1, tzinfo=hub_mod.UTC).timestamp()
    asyncio.run(hub.poll_once())
    assert sum(len(c) for c in fake.calls) == 3        # new month, fresh allowance


def test_first_call_of_the_month_is_not_a_burst(setup, monkeypatch):
    hub, ais, fake, settings = setup
    settings.update(order=["fake"], mode="always")
    settings["limits"]["fake"] = _lim(per_month=150)
    _clock(monkeypatch, 2026, 10, 1)
    asyncio.run(hub.poll_once())
    assert fake.calls == [[ILE_DAIX]]


def test_share_mode_never_asks_two_sources_about_one_ship_in_a_pass(two_free, monkeypatch):
    hub, fake, other = two_free
    hub_mod.current_settings()["limits"]["other"] = _lim(per_hour=5)    # e.g. a premium tier
    _clock(monkeypatch, 2026, 10, 7, 2)
    asyncio.run(hub.poll_once())
    assert len(fake.calls[0]) == 1
    assert fake.calls[0][0] not in other.calls[0] and len(other.calls[0]) == 2


def test_usage_survives_a_restart(setup, monkeypatch):
    hub, ais, fake, settings = setup
    settings.update(order=["fake"], mode="always")
    settings["limits"]["fake"] = _lim(per_hour=1)
    _clock(monkeypatch, 2026, 10, 1)
    asyncio.run(hub.poll_once())
    fresh = hub_mod.PositionHub()                       # same persisted usage
    asyncio.run(fresh.poll_once())
    assert len(fake.calls) == 1


def test_unlimited_sources_are_checked_more_often_in_busy_hours(setup, monkeypatch):
    hub, ais, fake, settings = setup
    settings.update(order=["fake"], mode="always", poll_minutes=60)
    clock = _clock(monkeypatch, 2026, 10, 7, 2)        # 10:00 SGT — busy
    asyncio.run(hub.poll_once())
    assert 3600 <= hub.seconds_until_next_poll() <= 3601 + 1
    clock[0] = hub_mod.datetime(2026, 10, 7, 14, tzinfo=hub_mod.UTC).timestamp()   # 22:00 SGT — quiet
    asyncio.run(hub.poll_once())
    assert 5400 <= hub.seconds_until_next_poll() <= 5402   # 60 min × 1.5


def test_fallback_chain_free_first_paid_fills_gaps(setup, monkeypatch):
    hub, ais, fake, settings = setup
    paid = FakeProvider(fixes={ILE_DAIX: _fix(3.0, "2026-10-07T11:00:00Z")})
    paid.meta = {**FakeProvider.meta, "env_key": "PAID_AIS_KEY"}
    monkeypatch.setenv("PAID_AIS_KEY", "k")
    monkeypatch.setitem(hub_mod.POLL_ADAPTERS, "paid", paid)
    settings.update(order=["aisstream", "fake", "paid"], mode="fallback", stale_minutes=30)
    settings["limits"].update(fake=_lim(), paid=_lim())
    now_iso = __import__("datetime").datetime.now(__import__("datetime").UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    fake.fixes = {TENEO: _fix(2.0, now_iso)}           # free source finds Teneo only
    asyncio.run(hub.poll_once())
    assert fake.calls == [[ILE_DAIX, TENEO]]
    assert paid.calls == [[ILE_DAIX]]                  # paid only asked about the gap
    assert hub.best(ILE_DAIX).source == "paid"


# ── share-mode plan: steady rotation + midpoint top-ups, for any N ───────

EXTRA = ["412000001", "412000002", "412000003"]


@pytest.fixture
def rotation(setup, monkeypatch):
    """A Marinesia-like steady source (1/hour) and a VesselAPI-like top-up
    source (150/month); seed N ships with `ships(n)`."""
    hub, ais, fake, settings = setup
    topup = FakeProvider()
    topup.meta = {**FakeProvider.meta, "env_key": "TOPUP_AIS_KEY"}
    monkeypatch.setenv("TOPUP_AIS_KEY", "k")
    monkeypatch.setitem(hub_mod.POLL_ADAPTERS, "topup", topup)
    settings.update(order=["aisstream", "fake", "topup"], mode="share")
    settings["limits"].update(fake=_lim(per_hour=1), topup=_lim(per_month=150))
    fake.sees_everything = topup.sees_everything = True

    def ships(n):
        ais._tracked.clear()
        ais.seed_tracked(([TENEO, ILE_DAIX, FU_TAI] + EXTRA)[:n])
        return sorted(ais._tracked)
    return hub, fake, topup, ships


def _run(hub, clock, until):
    while clock[0] < until:
        asyncio.run(hub.poll_once())
        clock[0] += hub.seconds_until_next_poll()


def _checks(*providers):
    """Every (time, ship, provider) check, in time order."""
    return sorted((t, m, p) for p in providers for t, ms in zip(p.times, p.calls) for m in ms)


@pytest.mark.parametrize("n", [1, 2, 3, 4])
def test_rotation_checks_each_ship_every_n_hours(rotation, monkeypatch, n):
    hub, steady, topup, ships = rotation
    tracked = ships(n)
    clock = _clock(monkeypatch, 2026, 10, 7, 0)
    _run(hub, clock, clock[0] + 2 * 86400)
    for m in tracked:
        times = [t for t, ms in zip(steady.times, steady.calls) if m in ms]
        gaps = [b - a for a, b in zip(times, times[1:])]
        assert gaps and all(abs(g - n * 3630) < 120 for g in gaps), (m, gaps)    # every N slots of ~1 h


@pytest.mark.parametrize("n", [1, 2, 3, 4])
def test_topups_land_at_the_midpoint_of_a_ships_rotation_gap(rotation, monkeypatch, n):
    hub, steady, topup, ships = rotation
    ships(n)
    clock = _clock(monkeypatch, 2026, 10, 7, 0)
    _run(hub, clock, clock[0] + 3 * 86400)
    assert len(topup.calls) >= 10
    checks = _checks(steady, topup)
    for i, (t, m, p) in enumerate(checks):
        if p is not topup:
            continue
        before = max(tt for tt, mm, pp in checks[:i] if mm == m and pp is steady) if any(mm == m and pp is steady for _, mm, pp in checks[:i]) else None
        after = next((tt for tt, mm, pp in checks[i + 1:] if mm == m and pp is steady), None)
        if before is None or after is None:
            continue
        mid = (before + after) / 2
        assert abs(t - mid) <= 5 * 60, (m, (t - before) / 3600, (after - t) / 3600)   # within 5 min of halfway


def test_plan_reflects_ship_count_and_replans_when_ships_are_added(rotation, monkeypatch):
    hub, steady, topup, ships = rotation
    ships(3)
    _clock(monkeypatch, 2026, 10, 7, 2)
    plan = hub.sources_status()["plan"]
    assert plan["ships"] == 3 and plan["rotation"]["hours_per_ship"] == 3.0
    assert plan["topups"][0]["busy_hours_per_ship"] == 13.2   # 3 ships ÷ (150 calls over 31 days, busy ×1.5 ≈ 0.227/h)
    kinds = [e["kind"] for e in plan["upcoming"]]
    assert kinds.count("rotation") == 3 and kinds.count("midpoint") == 1
    ships(4)
    plan = hub.sources_status()["plan"]
    assert plan["ships"] == 4 and plan["rotation"]["hours_per_ship"] == 4.0


def test_topup_alone_checks_the_longest_unchecked_ship(rotation, monkeypatch):
    hub, steady, topup, ships = rotation
    ships(3)
    hub_mod.current_settings().update(order=["topup"])
    clock = _clock(monkeypatch, 2026, 10, 1)
    _run(hub, clock, clock[0] + 4 * 86400)
    asked = [c[0] for c in topup.calls]
    assert len(asked) >= 12 and all(len(c) == 1 for c in topup.calls)
    assert all(asked.count(m) >= len(asked) // 3 - 1 for m in set(asked))   # even turns


@pytest.mark.parametrize("n", [2, 3, 4])
def test_waiting_for_midpoints_still_uses_the_monthly_allowance(rotation, monkeypatch, n):
    hub, steady, topup, ships = rotation
    ships(n)
    clock = _clock(monkeypatch, 2026, 10, 1)
    _run(hub, clock, hub_mod.datetime(2026, 11, 1, tzinfo=hub_mod.UTC).timestamp())
    assert 140 <= len(topup.calls) <= 150
