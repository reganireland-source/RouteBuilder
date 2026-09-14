"""
Ready-For-Service (RFS) date resolution — the pure logic behind the
"only show me what is actually in service on <date>" route-search constraint.

WHY THIS IS ITS OWN MODULE
Both CableSystem and CableSegment carry an `rfs_status` ("in_service" |
"planned") and an optional `rfs_quarter` ("YYYY-QN"). Turning that pair into a
single comparable date, and combining a segment's answer with its owning
system's, is fiddly enough to deserve its own home: it is pure (no I/O, no
graph, no request context), it is used from more than one seam (the route
graph build in graph.py and the wet-only city-pair graph in
city_pair_finder.py), and it is the part that most needs direct unit tests.
It lives here rather than in models.py because models.py is the shared
request/response contract file and is already 500+ lines.

THE RULES (agreed with the product owner — see tests/test_rfs.py)

  * A segment is UNAVAILABLE when its effective RFS date is AFTER the
    requested service_date.

  * Effective RFS date = the LATER of the segment's own RFS date and its
    owning system's RFS date. A segment cannot be in service before the cable
    system it belongs to, so the system acts as a floor.

  * rfs_status == "in_service" contributes NO constraint, whatever the row's
    rfs_quarter happens to say — it is already live, i.e. negative infinity.

  * "YYYY-QN" resolves to the LAST day of that quarter. See
    quarter_end_date() for the rationale.

  * A row that is not "in_service" and whose rfs_quarter is missing or
    malformed is treated as NEVER in service — it is excluded whenever a
    service_date is supplied. We do not silently let unknown build dates
    through: an unparseable RFS is a data problem, and quoting a route over a
    cable whose in-service date nobody knows is worse than quoting one route
    fewer.

  * A service_date of None means "no filtering at all", so existing API
    clients that never send one behave exactly as before.
"""
from __future__ import annotations

import re
from datetime import date
from typing import Optional

from .models import CableSegment, CableSystem, RfsStatus

# Sentinel dates, so the "later of the two" rule is a plain max() with no
# None-juggling. date.min stands for "already live" (negative infinity) and
# date.max for "never" (positive infinity); neither is a date any real
# planning record could hold.
ALREADY_IN_SERVICE = date.min
NEVER_IN_SERVICE = date.max

# Mirrors _RFS_QUARTER_PATTERN in models.py, but with capture groups so we can
# read the year and quarter number back out.
_QUARTER_RE = re.compile(r"^(\d{4})-Q([1-4])$")

# The exact shape RouteRequest.service_date accepts (see parse_service_date).
_ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

# Last calendar day of each quarter. Q1 is Mar 31 in leap years too, so no
# year-dependent arithmetic is needed here.
_QUARTER_LAST_DAY = {
    1: (3, 31),
    2: (6, 30),
    3: (9, 30),
    4: (12, 31),
}


def quarter_end_date(quarter: Optional[str]) -> Optional[date]:
    """Resolve "YYYY-QN" to the LAST day of that quarter, or None if unparseable.

    Rationale for choosing the last day rather than the first: "RFS 2027-Q2" is
    a promise that the cable will be in service BY THE END OF that quarter, not
    from its start. Resolving it to 2027-04-01 would let us quote the cable to a
    customer up to three months before the build is contractually due — i.e. it
    would over-promise. Taking the quarter end is the conservative reading: the
    cable becomes routable on the last day we are certain it is owed.

    Returns None for None, "", or anything not matching the exact "YYYY-QN"
    shape (e.g. "2027-Q5", "2027-2", "Q2-2027", "soon"). Callers decide what a
    None means; rfs_date() turns it into NEVER_IN_SERVICE.
    """
    if not quarter:
        return None
    match = _QUARTER_RE.match(quarter.strip())
    if not match:
        return None
    year = int(match.group(1))
    month, day = _QUARTER_LAST_DAY[int(match.group(2))]
    try:
        return date(year, month, day)
    except ValueError:  # pragma: no cover — year out of date's range (0001-9999)
        return None


def rfs_date(status: Optional[str], quarter: Optional[str]) -> date:
    """Collapse one row's (rfs_status, rfs_quarter) pair into a single date.

    * "in_service"                    -> ALREADY_IN_SERVICE (date.min). The
                                         row's rfs_quarter is ignored entirely,
                                         even if it still holds a stale future
                                         value.
    * anything else + valid quarter   -> that quarter's last day.
    * anything else + missing/bad one -> NEVER_IN_SERVICE (date.max).

    Note the asymmetry: only "in_service" is a free pass. A status we do not
    recognise is treated like "planned" — unknown means "prove it", not
    "assume it is live".

    `status` accepts an RfsStatus or a plain string (RfsStatus is a str enum,
    so both compare equal), which keeps this usable against rows that were
    built with model_construct or came straight out of JSON.
    """
    if status == RfsStatus.in_service:
        return ALREADY_IN_SERVICE
    resolved = quarter_end_date(quarter)
    return resolved if resolved is not None else NEVER_IN_SERVICE


def effective_rfs_date(
    segment: CableSegment,
    system: Optional[CableSystem] = None,
) -> date:
    """Return the date from which `segment` may actually carry traffic.

    This is the LATER of the segment's own RFS date and its owning system's:
    a segment cannot go live before the cable system it is part of, so a
    system planned for 2028-Q1 holds back every one of its segments even if
    an individual segment claims 2027-Q2.

    `system` may be None (segment whose system_id is not in the lookup); the
    system then contributes no constraint and the segment's own date stands.
    """
    seg_date = rfs_date(segment.rfs_status, segment.rfs_quarter)
    if system is None:
        return seg_date
    sys_date = rfs_date(system.rfs_status, system.rfs_quarter)
    return max(seg_date, sys_date)


def is_segment_in_service_on(
    segment: CableSegment,
    system: Optional[CableSystem],
    service_date: Optional[date],
) -> bool:
    """True if `segment` is usable on `service_date`.

    A None service_date means "do not filter" and always returns True. A
    segment is unavailable only when its effective RFS date falls strictly
    AFTER the service date, so a service_date landing exactly on the quarter
    end includes the segment.
    """
    if service_date is None:
        return True
    return effective_rfs_date(segment, system) <= service_date


def filter_segments_in_service(
    segments: list[CableSegment],
    systems_by_id: Optional[dict[str, CableSystem]],
    service_date: Optional[date],
) -> list[CableSegment]:
    """Drop every segment that is not in service on `service_date`.

    Returns the input list unchanged when service_date is None, so the
    no-service_date path stays allocation-free and provably behaviour-identical
    to the pre-RFS code.

    `systems_by_id` may be None or incomplete — a segment whose system is not
    found is judged on its own RFS date alone (see effective_rfs_date).
    """
    if service_date is None:
        return segments
    lookup = systems_by_id or {}
    return [
        seg for seg in segments
        if is_segment_in_service_on(seg, lookup.get(seg.system_id), service_date)
    ]


def parse_service_date(value: Optional[str]) -> Optional[date]:
    """Parse an ISO "YYYY-MM-DD" request value into a date; None passes through.

    Raises ValueError on anything else, which is what RouteRequest's field
    validator turns into a 422 rather than letting a typo silently disable the
    filter.
    """
    if value is None:
        return None
    if isinstance(value, date):
        return value
    text = value.strip()
    # date.fromisoformat() is lenient on 3.11+ ("20270630", "2027-06-30T00:00")
    # — pin the contract to the exact YYYY-MM-DD shape the frontend sends.
    if not _ISO_DATE_RE.match(text):
        raise ValueError(f"service_date must be an ISO date 'YYYY-MM-DD', got {value!r}")
    return date.fromisoformat(text)
