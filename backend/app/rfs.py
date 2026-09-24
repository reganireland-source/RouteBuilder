"""
Cable lifecycle date resolution — the pure logic behind the "only show me what
is actually usable on <date>" route-search constraint.

A segment is usable on a date when it passes BOTH halves of that question:

    Ready For Service (RFS)  — is it built YET?          (start of life)
    End Of Life       (EOL)  — is it RETIRED by then?    (end of life)

The two are deliberate mirror images of each other and live side by side in
this one module so they can be read as one feature: every rule below has an
RFS form and an EOL form that differ only in direction.

WHY THIS IS ITS OWN MODULE
Both CableSystem and CableSegment carry an `rfs_status` ("in_service" |
"planned") with an optional `rfs_quarter` ("YYYY-QN"), and an `eol_status`
("active" | "eol") with an optional `eol_quarter`. Turning such a pair into a
single comparable date, and combining a segment's answer with its owning
system's, is fiddly enough to deserve its own home: it is pure (no I/O, no
graph, no request context), it is used from more than one seam (the route
graph build in graph.py and the wet-only city-pair graph in
city_pair_finder.py), and it is the part that most needs direct unit tests.
It lives here rather than in models.py because models.py is the shared
request/response contract file and is already 500+ lines.

THE RULES (agreed with the product owner — see tests/test_rfs.py and
tests/test_eol.py)

  * A segment is UNAVAILABLE when its effective RFS date is AFTER the
    requested service_date (not built yet), or when its effective EOL date is
    BEFORE it (already retired). It must pass both to be routable.

  * Effective RFS date = the LATER of the segment's own RFS date and its
    owning system's RFS date. A segment cannot be in service before the cable
    system it belongs to, so the system acts as a FLOOR.

  * Effective EOL date = the EARLIER of the segment's own EOL date and its
    owning system's EOL date. A segment cannot outlive the cable system it
    belongs to, so the system acts as a CEILING — the exact mirror of the
    above.

  * rfs_status == "in_service" contributes NO constraint, whatever the row's
    rfs_quarter happens to say — it is already live, i.e. negative infinity.
    Likewise eol_status == "active" contributes NO constraint whatever its
    eol_quarter says — it is never retired, i.e. positive infinity.

  * "YYYY-QN" resolves to the LAST day of that quarter, for both dates. See
    quarter_end_date() for the rationale, which holds in both directions.

  * A row that is not "in_service" and whose rfs_quarter is missing or
    malformed is treated as NEVER in service — it is excluded whenever a
    service_date is supplied. We do not silently let unknown build dates
    through: an unparseable RFS is a data problem, and quoting a route over a
    cable whose in-service date nobody knows is worse than quoting one route
    fewer. The EOL mirror of that is the same judgement pointing the other
    way: a row marked "eol" whose eol_quarter is missing or malformed is
    treated as ALREADY retired. In both directions, if we cannot tell when a
    cable is usable, we do not offer it.

  * A service_date of None means "no filtering at all", so existing API
    clients that never send one behave exactly as before.
"""
from __future__ import annotations

import re
from datetime import date
from typing import Optional

from .models import CableSegment, CableSystem, EolStatus, RfsStatus

# Sentinel dates, so the "later of the two" / "earlier of the two" rules are a
# plain max() / min() with no None-juggling. For RFS, date.min stands for
# "already live" (negative infinity) and date.max for "never" (positive
# infinity); the EOL sentinels are the same two dates read the other way round.
# Neither is a date any real planning record could hold.
ALREADY_IN_SERVICE = date.min
NEVER_IN_SERVICE = date.max
NEVER_RETIRED = date.max
ALREADY_RETIRED = date.min

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

    The same last-day reading is correct for EOL, and for the same reason read
    forwards: "EOL 2027-Q2" means the cable is being retired during Q2, so it
    is usable through 30 June 2027 and gone from 1 July. One quarter resolution
    serves both ends of the lifecycle.

    Returns None for None, "", or anything not matching the exact "YYYY-QN"
    shape (e.g. "2027-Q5", "2027-2", "Q2-2027", "soon"). Callers decide what a
    None means; rfs_date() turns it into NEVER_IN_SERVICE and eol_date() into
    ALREADY_RETIRED.
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


def eol_date(status: Optional[str], quarter: Optional[str]) -> date:
    """Collapse one row's (eol_status, eol_quarter) pair into a single date.

    The mirror image of rfs_date():

    * "active"                        -> NEVER_RETIRED (date.max). The row's
                                         eol_quarter is ignored entirely, even
                                         if it still holds a stale retirement
                                         date from a decommission that was
                                         called off.
    * anything else + valid quarter   -> that quarter's last day, i.e. the last
                                         day the cable still carries traffic.
    * anything else + missing/bad one -> ALREADY_RETIRED (date.min).

    That last line is the deliberate mirror of rfs_date()'s "planned with an
    unparseable quarter is NEVER in service". In both directions the rule is
    the same: if we cannot tell when a cable is usable, we do not offer it. A
    row someone has flagged for decommissioning without recording a readable
    quarter is a data problem, and quoting a route over a cable that may
    already be switched off is worse than quoting one route fewer.

    Note the same asymmetry rfs_date() has, pointing the other way: only
    "active" is a free pass. A status we do not recognise is treated like
    "eol" — unknown means "prove it", not "assume it survives".

    `status` accepts an EolStatus or a plain string (EolStatus is a str enum,
    so both compare equal), which keeps this usable against rows that were
    built with model_construct or came straight out of JSON.
    """
    if status == EolStatus.active:
        return NEVER_RETIRED
    resolved = quarter_end_date(quarter)
    return resolved if resolved is not None else ALREADY_RETIRED


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


def effective_eol_date(
    segment: CableSegment,
    system: Optional[CableSystem] = None,
) -> date:
    """Return the last date on which `segment` may still carry traffic.

    This is the EARLIER of the segment's own EOL date and its owning system's:
    a segment cannot outlive the cable system it is part of, so a system being
    decommissioned in 2027-Q2 takes every one of its segments with it even if
    an individual segment claims 2028-Q1. Where the RFS system date is a floor,
    the EOL system date is a CEILING — same relationship, opposite end.

    `system` may be None (segment whose system_id is not in the lookup); the
    system then contributes no constraint and the segment's own date stands.
    """
    seg_date = eol_date(segment.eol_status, segment.eol_quarter)
    if system is None:
        return seg_date
    sys_date = eol_date(system.eol_status, system.eol_quarter)
    return min(seg_date, sys_date)


def is_segment_in_service_on(
    segment: CableSegment,
    system: Optional[CableSystem],
    service_date: Optional[date],
) -> bool:
    """True if `segment` is BUILT by `service_date` — the RFS half of the test.

    A None service_date means "do not filter" and always returns True. A
    segment is unavailable only when its effective RFS date falls strictly
    AFTER the service date, so a service_date landing exactly on the quarter
    end includes the segment.

    This is one half of the question; is_segment_available_on() is the whole
    of it, and is what the filter below applies.
    """
    if service_date is None:
        return True
    return effective_rfs_date(segment, system) <= service_date


def is_segment_retired_on(
    segment: CableSegment,
    system: Optional[CableSystem],
    service_date: Optional[date],
) -> bool:
    """True if `segment` is already RETIRED by `service_date` — the EOL half.

    Note this one is the negative: it answers "is it gone?", so True means
    unusable. A None service_date means "do not filter" and always returns
    False (nothing is retired when we are not asking about a date).

    A segment is retired only when its effective EOL date falls strictly
    BEFORE the service date, so a service_date landing exactly on the quarter
    end still includes the segment — its last day of service, mirroring the
    RFS boundary exactly.
    """
    if service_date is None:
        return False
    return effective_eol_date(segment, system) < service_date


def is_segment_available_on(
    segment: CableSegment,
    system: Optional[CableSystem],
    service_date: Optional[date],
) -> bool:
    """True if `segment` is usable on `service_date` — the single predicate.

    A segment must pass BOTH lifecycle tests to be routable: in service by the
    date AND not retired by it. A None service_date means "do not filter" and
    always returns True.
    """
    return (
        is_segment_in_service_on(segment, system, service_date)
        and not is_segment_retired_on(segment, system, service_date)
    )


def filter_segments_in_service(
    segments: list[CableSegment],
    systems_by_id: Optional[dict[str, CableSystem]],
    service_date: Optional[date],
) -> list[CableSegment]:
    """Drop every segment that is not usable on `service_date`.

    "In service" here is the whole lifecycle question, not just RFS: a segment
    survives this filter only if it is built by that date and not retired by it
    (see is_segment_available_on). The name predates EOL and is kept because it
    is the single seam every search already passes through — graph.build_graph
    and city_pair_finder — and widening what it enforces there is exactly the
    point.

    Returns the input list unchanged when service_date is None, so the
    no-service_date path stays allocation-free and provably behaviour-identical
    to the pre-RFS code.

    `systems_by_id` may be None or incomplete — a segment whose system is not
    found is judged on its own RFS/EOL dates alone (see effective_rfs_date and
    effective_eol_date).
    """
    if service_date is None:
        return segments
    lookup = systems_by_id or {}
    return [
        seg for seg in segments
        if is_segment_available_on(seg, lookup.get(seg.system_id), service_date)
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
