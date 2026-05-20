"""
Reference data integrity tests.

Checks that all cross-references in the JSON data files are valid and
that numeric values are within sensible bounds.  Run with:

    pytest backend/tests/test_data_integrity.py -v
"""

import json
from pathlib import Path

DATA = Path(__file__).parent.parent / "data"


def load(name: str):
    return json.loads((DATA / name).read_text())


# ── Fixtures (loaded once per test run) ───────────────────────────────────────

def _data():
    nodes    = load("nodes.json")
    segments = load("segments.json")
    systems  = load("systems.json")
    capacity = load("capacity.json")
    rules    = load("rules.json")
    return nodes, segments, systems, capacity, rules


nodes, segments, systems, capacity, rules = _data()

node_ids    = {n["id"]           for n in nodes}
segment_ids = {s["id"]           for s in segments}
system_ids  = {s["id"]           for s in systems}
cap_ids     = {c["segment_id"]   for c in capacity}


# ── 1. Duplicate IDs ──────────────────────────────────────────────────────────

def test_no_duplicate_node_ids():
    ids = [n["id"] for n in nodes]
    dupes = [i for i in ids if ids.count(i) > 1]
    assert not dupes, f"Duplicate node IDs: {set(dupes)}"


def test_no_duplicate_segment_ids():
    ids = [s["id"] for s in segments]
    dupes = [i for i in ids if ids.count(i) > 1]
    assert not dupes, f"Duplicate segment IDs: {set(dupes)}"


def test_no_duplicate_system_ids():
    ids = [s["id"] for s in systems]
    dupes = [i for i in ids if ids.count(i) > 1]
    assert not dupes, f"Duplicate system IDs: {set(dupes)}"


def test_no_duplicate_capacity_entries():
    ids = [c["segment_id"] for c in capacity]
    dupes = [i for i in ids if ids.count(i) > 1]
    assert not dupes, f"Duplicate capacity entries: {set(dupes)}"


# ── 2. Segment cross-references ───────────────────────────────────────────────

def test_segment_system_ids_exist():
    bad = [s["id"] for s in segments if s["system_id"] not in system_ids]
    assert not bad, f"Segments with unknown system_id: {bad}"


def test_segment_start_nodes_exist():
    bad = [s["id"] for s in segments if s["start_node_id"] not in node_ids]
    assert not bad, f"Segments with unknown start_node_id: {bad}"


def test_segment_end_nodes_exist():
    bad = [s["id"] for s in segments if s["end_node_id"] not in node_ids]
    assert not bad, f"Segments with unknown end_node_id: {bad}"


def test_no_self_loop_segments():
    bad = [s["id"] for s in segments if s["start_node_id"] == s["end_node_id"]]
    assert not bad, f"Self-loop segments (start == end): {bad}"


# ── 3. Capacity cross-references ─────────────────────────────────────────────

def test_capacity_segment_ids_exist():
    bad = [c["segment_id"] for c in capacity if c["segment_id"] not in segment_ids]
    assert not bad, f"Capacity records with unknown segment_id: {bad}"


def test_all_segments_have_capacity():
    missing = segment_ids - cap_ids
    assert not missing, f"Segments missing a capacity record: {sorted(missing)}"


# ── 4. Rules cross-references ─────────────────────────────────────────────────

def test_rule_node_ids_exist():
    bad = [r["node_id"] for r in rules if r["node_id"] not in node_ids]
    assert not bad, f"Rules referencing unknown node_id: {bad}"


def test_rule_system_ids_exist():
    bad = []
    for r in rules:
        for pair in r.get("disallowed_pairs", []):
            for key in ("system_a", "system_b"):
                if pair[key] not in system_ids:
                    bad.append(f"{r['node_id']}: {pair[key]}")
    assert not bad, f"Rules referencing unknown system_id: {bad}"


# ── 5. Segment numeric sanity ─────────────────────────────────────────────────

def test_segment_length_positive():
    bad = [s["id"] for s in segments if s.get("length_km", 0) <= 0]
    assert not bad, f"Segments with length_km ≤ 0: {bad}"


def test_segment_latency_positive():
    bad = [s["id"] for s in segments if s.get("latency") is not None and s["latency"] <= 0]
    assert not bad, f"Segments with latency ≤ 0: {bad}"


def test_segment_reliability_in_range():
    bad = [s["id"] for s in segments if not (0 < s.get("reliability", -1) <= 1)]
    assert not bad, f"Segments with reliability outside (0, 1]: {bad}"


def test_segment_cost_weight_positive():
    bad = [s["id"] for s in segments if s.get("cost_weight", 0) <= 0]
    assert not bad, f"Segments with cost_weight ≤ 0: {bad}"


def test_segment_type_valid():
    valid = {"wet", "terrestrial"}
    bad = [s["id"] for s in segments if s.get("type") not in valid]
    assert not bad, f"Segments with invalid type: {bad}"


def test_segment_ownership_valid():
    valid = {"owned", "iru", "consortium"}
    bad = [s["id"] for s in segments if s.get("ownership") not in valid]
    assert not bad, f"Segments with invalid ownership: {bad}"


# ── 6. Capacity numeric sanity ────────────────────────────────────────────────

def test_capacity_total_positive():
    bad = [c["segment_id"] for c in capacity if c.get("total_capacity_t", 0) <= 0]
    assert not bad, f"Capacity records with total_capacity_t ≤ 0: {bad}"


def test_capacity_available_not_exceeds_total():
    bad = [
        c["segment_id"] for c in capacity
        if c.get("available_capacity_t", 0) > c.get("total_capacity_t", 0)
    ]
    assert not bad, f"Capacity where available > total: {bad}"


def test_capacity_available_non_negative():
    bad = [c["segment_id"] for c in capacity if c.get("available_capacity_t", 0) < 0]
    assert not bad, f"Capacity records with available_capacity_t < 0: {bad}"


# ── 7. Node coordinate sanity ─────────────────────────────────────────────────

def test_node_latitudes_in_range():
    bad = [n["id"] for n in nodes if not (-90 <= n.get("lat", 999) <= 90)]
    assert not bad, f"Nodes with lat outside [-90, 90]: {bad}"


def test_node_longitudes_in_range():
    bad = [n["id"] for n in nodes if not (-180 <= n.get("lng", 999) <= 180)]
    assert not bad, f"Nodes with lng outside [-180, 180]: {bad}"


def test_node_type_valid():
    valid = {"landing_station", "terrestrial_pop", "branching_unit"}
    bad = [n["id"] for n in nodes if n.get("type") not in valid]
    assert not bad, f"Nodes with invalid type: {bad}"


# ── 8. Coverage warnings (printed, not failed) ───────────────────────────────

def test_no_isolated_nodes(capsys):
    referenced = {s["start_node_id"] for s in segments} | {s["end_node_id"] for s in segments}
    isolated = node_ids - referenced
    if isolated:
        print(f"\nWARNING: Nodes not referenced by any segment: {sorted(isolated)}")
    # Not a hard failure — BU nodes or future nodes may be legitimately unused
    assert True


def test_no_unused_systems(capsys):
    used = {s["system_id"] for s in segments}
    unused = system_ids - used
    if unused:
        print(f"\nWARNING: Systems with no segments: {sorted(unused)}")
    assert True
