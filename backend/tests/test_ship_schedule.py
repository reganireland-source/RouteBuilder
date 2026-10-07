"""
Call pacing maths for polled AIS sources (shiptracker/schedule.py).

Run with:  pytest backend/tests/test_ship_schedule.py -v
"""
import sys
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest

from app.shiptracker import schedule

SGT = {"start_hour": 4, "end_hour": 20, "utc_offset": 8, "weight": 1.5}


def ts(*args):
    return datetime(*args, tzinfo=UTC).timestamp()


@pytest.mark.parametrize("utc_hour, busy", [
    (19, False),   # 03:00 SGT
    (20, True),    # 04:00 SGT — window opens
    (2, True),     # 10:00 SGT
    (11, True),    # 19:00 SGT
    (12, False),   # 20:00 SGT — window closes
])
def test_busy_hours_are_04_to_20_singapore_time(utc_hour, busy):
    assert schedule.is_peak(ts(2026, 10, 7, utc_hour, 30), SGT) is busy


def test_window_can_wrap_midnight_and_be_switched_off():
    night = {"start_hour": 22, "end_hour": 2, "utc_offset": 0, "weight": 2}
    assert schedule.is_peak(ts(2026, 10, 7, 23), night) and schedule.is_peak(ts(2026, 10, 7, 1), night)
    assert not schedule.is_peak(ts(2026, 10, 7, 12), night)
    assert not schedule.is_peak(ts(2026, 10, 7, 12), {**night, "end_hour": 22})   # start == end: no busy hours


def test_weighted_day_counts_busy_hours_more():
    day = schedule.weighted_seconds(ts(2026, 10, 7), ts(2026, 10, 8), SGT)
    assert day == pytest.approx((16 * 1.5 + 8) * 3600)


def test_monthly_spacing_is_shorter_in_busy_hours():
    busy = schedule.month_spacing(ts(2026, 10, 7, 2), 100, SGT)
    quiet = schedule.month_spacing(ts(2026, 10, 7, 14), 100, SGT)
    assert busy == pytest.approx(quiet / 1.5, rel=0.03)   # 12 h apart, so slightly less month left


def test_rolling_hour_allowance():
    lim = {"per_month": None, "per_hour": 1}
    now = ts(2026, 10, 7, 2)
    assert schedule.allowance(lim, {"calls": 0, "recent": []}, now, SGT) == 1
    used = {"calls": 1, "last_call": now, "recent": [now]}
    assert schedule.allowance(lim, used, now + 3599, SGT) == 0
    assert schedule.next_call_at(lim, used, now + 10, SGT) == now + schedule.HOUR_WINDOW
    assert schedule.allowance(lim, used, now + schedule.HOUR_WINDOW, SGT) == 1


def test_no_limits_means_no_pacing():
    lim = {"per_month": None, "per_hour": None}
    assert schedule.allowance(lim, {"calls": 5}, ts(2026, 10, 7), SGT) is None
    assert schedule.source_rates(lim, SGT, ts(2026, 10, 7)) is None


def test_best_midpoint_picks_the_widest_gap_at_its_middle():
    # Three ships on a 3 h rotation, last checked 0, 1 and 2 h ago.
    h = 3600
    timeline = schedule.rotation_timeline(["a", "b", "c"], 0, 1 * h, h, {"a": -2 * h, "b": -1 * h, "c": 0})
    assert timeline == {"a": (-2 * h, h), "b": (-h, 2 * h), "c": (0, 3 * h)}
    assert schedule.best_midpoint(timeline, 0) == ("b", 0.5 * h)          # next midpoint, all gaps equal
    assert schedule.best_midpoint(timeline, 0.6 * h, cycle=3 * h) == ("c", 1.5 * h)


def test_best_midpoint_tolerates_jitter_but_waits_rather_than_land_lopsided():
    h = 3600
    one = {"a": (0, h)}
    assert schedule.best_midpoint(one, 0.5 * h + 10, cycle=h) == ("a", 0.5 * h + 10)   # seconds late: still now
    assert schedule.best_midpoint(one, 0.75 * h, cycle=h) == ("a", 1.5 * h)            # well past: next gap's middle
    assert schedule.best_midpoint(one, 0.99 * h) is None                               # no room before the next check
