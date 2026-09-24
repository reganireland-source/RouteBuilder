"""
Data integrity checks for the reference data JSON files.
Returns structured results so they can be served via the API
and consumed by both the frontend and the pytest suite.

run_all_checks() is the entry point: it loads every reference table via
data_loader, then runs a battery of independent checks against them — no
check depends on the outcome of another, so run_all_checks always completes
and returns one CheckResult per check regardless of how many fail. Checks
fall into two severities: "error" (a data integrity problem that could break
route search or an API call — a dangling foreign key, an out-of-range value)
and "warning" (a data-quality smell that is not actually broken — an isolated
node, a system with no segments). checks_summary() reduces that list to the
pass/fail counts and JSON-serialisable shape the API endpoint and the
frontend's data-quality panel consume.
"""

from __future__ import annotations
import re
from dataclasses import dataclass, asdict
from .data_loader import load_nodes, load_segments, load_systems, load_capacity, load_rules, load_outages

# Accepts 4-char IATA-style codes, branching-unit IDs (e.g. APRICOTBU1),
# and vendor-prefixed IDs with a single hyphen separator (e.g. EQ-SY1).
NODE_ID_RE = re.compile(r'^[A-Z0-9][A-Z0-9\-]{1,11}$')


@dataclass
class CheckResult:
    """The outcome of one named integrity check.

    `message` is empty when the check passed; when it failed it holds either
    an explicit `detail` string the caller supplied, or (the common case, via
    the `check()` helper below) a truncated preview of the offending IDs."""
    name: str
    passed: bool
    severity: str        # "error" | "warning"
    message: str = ""    # empty when passed; details when failed


def run_all_checks() -> list[CheckResult]:
    """Load every reference table and run the full battery of integrity
    checks against them, returning one CheckResult per check (both passing
    and failing) in the order the checks are defined below. Loading happens
    once up front so every check below runs against a single consistent
    snapshot of the data, rather than each check re-reading the files."""
    nodes    = load_nodes()
    segments = load_segments()
    systems  = load_systems()
    capacity = load_capacity()
    rules    = load_rules()
    outages  = load_outages()

    node_ids    = {n.id for n in nodes}
    segment_ids = {s.id for s in segments}
    system_ids  = {s.id for s in systems}
    cap_ids     = {c.segment_id for c in capacity}

    results: list[CheckResult] = []

    def check(name: str, severity: str, bad: list, detail: str = "") -> None:
        """Record one CheckResult: passes iff `bad` (the list of offending
        IDs/rows found by the caller) is empty. When it fails and no explicit
        `detail` is given, the message previews at most the first 5 bad
        entries followed by an ellipsis, so a check against thousands of rows
        still produces a short, readable message."""
        if bad:
            msg = detail or f"{bad[:5]}{'…' if len(bad) > 5 else ''}"
            results.append(CheckResult(name=name, passed=False, severity=severity, message=msg))
        else:
            results.append(CheckResult(name=name, passed=True, severity=severity))

    # ── Duplicates ─────────────────────────────────────────────────────────────
    def dupes(lst: list[str]) -> list[str]:
        """Return every element of `lst` that has already been seen earlier
        in the list — i.e. the second-and-later occurrence of each duplicate,
        not the first. Order of `lst` matters only for which occurrence is
        flagged; the result is otherwise just "which values repeat"."""
        seen: set[str] = set(); d = []
        for x in lst:
            if x in seen: d.append(x)
            seen.add(x)
        return d

    check("No duplicate node IDs",     "error",   dupes([n.id for n in nodes]))
    check("No duplicate segment IDs",  "error",   dupes([s.id for s in segments]))
    check("No duplicate system IDs",   "error",   dupes([s.id for s in systems]))
    check("No duplicate capacity entries", "error", dupes([c.segment_id for c in capacity]))

    # ── Segment cross-references ───────────────────────────────────────────────
    check("Segment system_ids exist",      "error", [s.id for s in segments if s.system_id not in system_ids])
    check("Segment start_node_ids exist",  "error", [s.id for s in segments if s.start_node_id not in node_ids])
    check("Segment end_node_ids exist",    "error", [s.id for s in segments if s.end_node_id not in node_ids])
    check("No self-loop segments",         "error", [s.id for s in segments if s.start_node_id == s.end_node_id])

    # ── Capacity cross-references ──────────────────────────────────────────────
    check("Capacity segment_ids exist",    "error", [c.segment_id for c in capacity if c.segment_id not in segment_ids])
    # Set difference (not a per-segment loop): every segment_id present in the
    # segments table but absent from the capacity table's ids is missing a
    # capacity row entirely — a segment with no SegmentCapacity would make
    # capacity-aware route search treat it as having none, so this is an
    # error rather than a warning.
    check("All segments have capacity",    "error", sorted(segment_ids - cap_ids))

    # ── Rules cross-references ─────────────────────────────────────────────────
    check("Rule node_ids exist",           "error", [r.node_id for r in rules if r.node_id not in node_ids])
    # For each disallowed_pairs entry, report whichever of system_a/system_b
    # is the dangling one (report system_a if it's the culprit, else
    # system_b — only one side is checked per entry since the `or` short-
    # circuits, so a row with BOTH sides bad is reported once, against
    # system_a).
    bad_rule_sys = [
        f"{r.node_id}: {p.system_a if p.system_a not in system_ids else p.system_b}"
        for r in rules for p in r.disallowed_pairs
        if p.system_a not in system_ids or p.system_b not in system_ids
    ]
    check("Rule system_ids exist",         "error", bad_rule_sys)

    # ── Segment numeric sanity ─────────────────────────────────────────────────
    check("Segment length_km > 0",         "error", [s.id for s in segments if (s.length_km or 0) <= 0])
    check("Segment latency > 0",           "error", [s.id for s in segments if s.latency is not None and s.latency <= 0])
    check("Segment reliability in (0, 1]", "error", [s.id for s in segments if not (0 < (s.reliability or -1) <= 1)])
    check("Segment cost_weight > 0",       "error", [s.id for s in segments if (s.cost_weight or 0) <= 0])
    valid_types = {"wet", "terrestrial"}
    check("Segment type valid",            "error", [s.id for s in segments if s.type not in valid_types])
    valid_own = {"owned", "iru", "consortium", "integrated_lit_lease", "offnet_resell"}
    check("Segment ownership valid",       "error", [s.id for s in segments if s.ownership not in valid_own])

    # ── Capacity numeric sanity ────────────────────────────────────────────────
    check("Capacity total > 0",            "error", [c.segment_id for c in capacity if (c.total_capacity_t or 0) <= 0])
    check("Capacity available ≤ total",    "error", [c.segment_id for c in capacity if c.available_capacity_t > c.total_capacity_t])
    check("Capacity available ≥ 0",        "error", [c.segment_id for c in capacity if c.available_capacity_t < 0])

    # ── Node ID format ────────────────────────────────────────────────────────
    bad_ids = [n.id for n in nodes if not NODE_ID_RE.match(n.id)]
    check("Node IDs are valid format", "error", bad_ids)

    # ── Node coordinate sanity ─────────────────────────────────────────────────
    check("Node latitudes in [-90, 90]",   "error", [n.id for n in nodes if not (-90 <= n.lat <= 90)])
    check("Node longitudes in [-180, 180]","error", [n.id for n in nodes if not (-180 <= n.lng <= 180)])
    valid_node_types = {"landing_station", "primary_pop", "secondary_pop", "extension_pop", "branching_unit", "off_net"}
    check("Node types valid",              "error", [n.id for n in nodes if n.type not in valid_node_types])

    # ── Outage cross-references ────────────────────────────────────────────────
    check("Outage segment_ids exist",      "error", [o.segment_id for o in outages if o.segment_id not in segment_ids])

    # ── Latency/length plausibility (wet segments only) ────────────────────────
    # Light in fibre propagates at ~5 µs/km (0.005 ms/km). Flag wet segments
    # whose recorded latency implies a speed outside ±40% of that baseline,
    # which would indicate a data-entry error rather than legitimate variation.
    _LO, _HI = 0.003, 0.007  # ms/km bounds
    bad_latency = [
        s.id for s in segments
        if s.type == "wet" and s.latency is not None and s.length_km
        and not (_LO <= s.latency / s.length_km <= _HI)
    ]
    check("Wet segment latency consistent with length", "error", bad_latency)

    # ── Coverage warnings ──────────────────────────────────────────────────────
    # Off-net nodes are intentionally not wired into the network; exclude them.
    on_net_node_ids = {n.id for n in nodes if n.type != "off_net" and n.on_net != "off_net"}
    referenced_nodes = {s.start_node_id for s in segments} | {s.end_node_id for s in segments}
    isolated = sorted(on_net_node_ids - referenced_nodes)
    check("No isolated nodes",             "warning", isolated)

    used_systems = {s.system_id for s in segments}
    unused_systems = sorted(system_ids - used_systems)
    check("All systems have segments",     "warning", unused_systems)

    return results


def checks_summary(results: list[CheckResult]) -> dict:
    """Reduce a list of CheckResult into the JSON-serialisable summary shape
    served by the data-checks API endpoint: an overall pass/fail flag, error/
    warning counts (each counted only among FAILED checks — a passing check
    contributes to neither count regardless of its severity), and the full
    per-check detail list (as plain dicts, via dataclasses.asdict) for the
    frontend to render."""
    return {
        "all_passed": all(r.passed for r in results),
        "error_count":   sum(1 for r in results if not r.passed and r.severity == "error"),
        "warning_count": sum(1 for r in results if not r.passed and r.severity == "warning"),
        "checks": [asdict(r) for r in results],
    }
