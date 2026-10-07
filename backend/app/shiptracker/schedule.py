# ─────────────────────────────────────────────────────────────────────────────
# shiptracker/schedule.py — call pacing for polled AIS sources.
#
# Pure functions (no I/O, `now` always passed in) so the maths is testable.
#
# LIMITS: each polled source has `per_hour` and/or `per_month` call limits
# (its free tier by default; None = no limit of that kind).
#   per_hour  — a rolling window: at most N calls in any hour. Free tiers
#               like Marinesia's (1/hour) run at exactly this rate, day and
#               night, because there is nothing to save it for.
#   per_month — spread over what's left of the calendar month (UTC):
#               remaining calls ÷ remaining time, so it can never run out
#               early or be exceeded.
#
# BUSY HOURS: `peak` = {start_hour, end_hour, utc_offset, weight}. Time inside
# the window counts `weight` times as much when spreading a monthly allowance,
# so more of those calls land in busy hours (default 04:00–20:00 SGT, ×1.5 —
# when cable ships in Asia are most likely under way). The offset is a whole
# number of hours, so windows always align with UTC hour boundaries.
# ─────────────────────────────────────────────────────────────────────────────
import calendar
from datetime import UTC, datetime
from typing import Optional

HOUR = 3600
# Rolling-window slack: providers time their hour from their own clock.
HOUR_WINDOW = HOUR + 30


def is_peak(ts: float, peak: dict) -> bool:
    h = int((ts // HOUR + peak["utc_offset"]) % 24)
    s, e = peak["start_hour"], peak["end_hour"] % 24
    if s == e:
        return False
    return s <= h < e if s < e else (h >= s or h < e)   # window may wrap midnight


def weight(ts: float, peak: dict) -> float:
    return float(peak["weight"]) if is_peak(ts, peak) else 1.0


def month_end(now: float) -> float:
    d = datetime.fromtimestamp(now, UTC)
    return datetime(d.year + (d.month == 12), d.month % 12 + 1, 1, tzinfo=UTC).timestamp()


def month_key(now: float) -> str:
    return datetime.fromtimestamp(now, UTC).strftime("%Y-%m")


def weighted_seconds(start: float, end: float, peak: dict) -> float:
    """Seconds from start to end, busy-hour seconds counted `weight` times."""
    total, t = 0.0, start
    while t < end:
        nxt = min(end, (t // HOUR + 1) * HOUR)
        total += (nxt - t) * weight(t, peak)
        t = nxt
    return total


def month_spacing(now: float, remaining: int, peak: dict) -> float:
    """Seconds until the next call that spreads `remaining` calls over the
    rest of the month, shorter in busy hours. The +0.5 leaves half a gap
    before month end so the last call isn't lost to the monthly reset."""
    w = weighted_seconds(now, month_end(now), peak)
    return max(w, 1.0) / (remaining + 0.5) / weight(now, peak)


def recent_calls(usage: dict, now: float) -> list[float]:
    return [t for t in usage.get("recent") or [] if now - t < HOUR_WINDOW]


def allowance(limits: dict, usage: dict, now: float, peak: dict) -> Optional[int]:
    """Calls a source may make right now; None = no limits at all."""
    per_month, per_hour = limits.get("per_month"), limits.get("per_hour")
    if per_month is None and per_hour is None:
        return None
    n = 10**9
    if per_hour is not None:
        n = min(n, per_hour - len(recent_calls(usage, now)))
    if per_month is not None:
        remaining = per_month - usage["calls"]
        if remaining <= 0:
            return 0
        n = min(n, remaining)
        if usage.get("last_call") is None:
            n = min(n, 1)   # even pacing from the very first call, no opening burst
        else:
            n = min(n, int((now - usage["last_call"]) // month_spacing(now, remaining, peak)))
    return max(0, n)


def next_call_at(limits: dict, usage: dict, now: float, peak: dict) -> Optional[float]:
    """When the source may next make a call; None = never this month (or no
    limits, i.e. it runs on the plain poll interval)."""
    per_month, per_hour = limits.get("per_month"), limits.get("per_hour")
    if per_month is None and per_hour is None:
        return None
    at = now
    if per_hour is not None:
        recent = sorted(recent_calls(usage, now))
        if len(recent) >= per_hour:
            at = max(at, recent[len(recent) - per_hour] + HOUR_WINDOW)
    if per_month is not None:
        remaining = per_month - usage["calls"]
        if remaining <= 0:
            return None
        if usage.get("last_call") is not None:
            at = max(at, usage["last_call"] + month_spacing(now, remaining, peak))
    return at


def peak_hours_per_day(peak: dict) -> int:
    s, e = peak["start_hour"], peak["end_hour"] % 24
    return (e - s) % 24


def source_rates(limits: dict, peak: dict, now: float) -> Optional[tuple[float, float]]:
    """Typical (busy, quiet) calls per hour for a limited source; None if it
    has no limits."""
    per_month, per_hour = limits.get("per_month"), limits.get("per_hour")
    if per_month is None and per_hour is None:
        return None
    busy = quiet = float("inf")
    if per_month is not None:
        d = datetime.fromtimestamp(now, UTC)
        days = calendar.monthrange(d.year, d.month)[1]
        ph = peak_hours_per_day(peak)
        w = float(peak["weight"]) if ph else 1.0
        quiet = per_month / days / (ph * w + (24 - ph))
        busy = quiet * w
    if per_hour is not None:
        busy, quiet = min(busy, per_hour), min(quiet, per_hour)
    return busy, quiet
