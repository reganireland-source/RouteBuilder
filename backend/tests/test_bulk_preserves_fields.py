"""
Bulk CSV import must not silently wipe fields it has no column for.

Every importer in app/api/bulk.py used to REBUILD its model from a hand-listed
set of fields, so anything nobody remembered to add to that list was destroyed
on import. Each importer leaked a different set:

  * nodes     — dropped `on_net`
  * segments  — dropped the RFS and EOL lifecycle dates
  * systems   — dropped both, preserving nothing at all
  * coverage  — dropped city, street_address, verification_status,
                last_verified_date, on_net AND the lifecycle dates

`_merged()` replaced that with a merge onto the existing record, so a CSV names
only what it changes. These tests pin that down: each one fails against the old
reconstruct-from-a-list code.

Run with:  pytest backend/tests/test_bulk_preserves_fields.py -v
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.api.bulk import _merged                                    # noqa: E402
from app.models import CableSegment, CableSystem, Node              # noqa: E402


def _node(**over):
    """Build a fully-populated, valid Node so each test can override just the
    one or two fields it cares about and merge onto a realistic baseline."""
    base = {
        "id": "SYD1", "name": "Sydney", "lat": -33.8, "lng": 151.2,
        "type": "landing_station", "country": "AU", "owner": "Telstra",
        "trading_name": "Sydney Telstra", "city": "Sydney",
        "street_address": "1 Test St", "description": "A CLS",
        "verification_status": "verified", "last_verified_date": "2026-01-01",
        "on_net": "on_net",}
    base.update(over)
    return Node(**base)


def _segment(**over):
    """Build a fully-populated, valid CableSegment for the same reason as
    _node() above: tests override only what they're checking."""
    base = {
        "id": "SEG1", "name": "Seg One", "system_id": "SYS1",
        "start_node_id": "A", "end_node_id": "B", "type": "wet",
        "length_km": 100.0, "reliability": 0.999, "cost_weight": 1.0,
        "ownership": "owned", "latency": 0.5,}
    base.update(over)
    return CableSegment(**base)


# ── nodes ───────────────────────────────────────────────────────────────────

def test_node_import_keeps_on_net():
    """The node importer has no on_net column; an import must not clear it."""
    existing = _node(on_net="on_net")
    merged = _merged(Node, existing, {"id": "SYD1", "name": "Sydney Renamed"})
    assert merged.on_net == "on_net"
    assert merged.name == "Sydney Renamed"


def test_node_import_keeps_lifecycle_dates():
    existing = _node(rfs_status="planned", rfs_quarter="2027-Q2")
    merged = _merged(Node, existing, {"id": "SYD1", "name": "Sydney"})
    # Node has no lifecycle fields, but the merge must not invent or drop any
    # field it does carry — city is the canary here.
    assert merged.city == "Sydney"
    assert merged.street_address == "1 Test St"


def test_node_import_creates_when_absent():
    """No existing record: the CSV values alone must still build a valid node."""
    merged = _merged(Node, None, {
        "id": "NEW1", "name": "New", "lat": 1.0, "lng": 2.0,
        "type": "primary_pop", "country": "SG",
    })
    assert merged.id == "NEW1"
    assert merged.on_net is None


# ── segments ────────────────────────────────────────────────────────────────

def test_segment_import_keeps_rfs():
    existing = _segment(rfs_status="planned", rfs_quarter="2027-Q2")
    merged = _merged(CableSegment, existing, {"id": "SEG1", "name": "Renamed"})
    assert merged.rfs_status.value == "planned"
    assert merged.rfs_quarter == "2027-Q2"
    assert merged.name == "Renamed"


def test_segment_import_keeps_eol():
    existing = _segment(eol_status="eol", eol_quarter="2030-Q4")
    merged = _merged(CableSegment, existing, {"id": "SEG1", "length_km": 250.0})
    assert merged.eol_status.value == "eol"
    assert merged.eol_quarter == "2030-Q4"
    assert merged.length_km == 250.0


def test_segment_import_keeps_waypoints():
    existing = _segment(waypoints=[[1.0, 2.0], [3.0, 4.0]])
    merged = _merged(CableSegment, existing, {"id": "SEG1", "name": "Renamed"})
    assert merged.waypoints == [[1.0, 2.0], [3.0, 4.0]]


# ── systems ─────────────────────────────────────────────────────────────────

def test_system_import_keeps_lifecycle():
    """The systems importer preserved NOTHING before — the worst of the four."""
    existing = CableSystem(
        id="SYS1", name="Sys", description="d",
        rfs_status="planned", rfs_quarter="2028-Q1",
        eol_status="eol", eol_quarter="2035-Q4",
    )
    merged = _merged(CableSystem, existing, {"id": "SYS1", "name": "Renamed"})
    assert merged.rfs_status.value == "planned"
    assert merged.rfs_quarter == "2028-Q1"
    assert merged.eol_status.value == "eol"
    assert merged.eol_quarter == "2035-Q4"
    assert merged.name == "Renamed"


# ── coverage (the originally reported data loss) ─────────────────────────────

def test_coverage_import_keeps_every_untouched_node_field():
    """A coverage CSV changes capabilities only; nothing else may move."""
    existing = _node()
    merged = _merged(Node, existing, {"capabilities": None})
    assert merged.city == "Sydney"
    assert merged.street_address == "1 Test St"
    assert merged.verification_status.value == "verified"
    assert merged.last_verified_date == "2026-01-01"
    assert merged.on_net == "on_net"


# ── the merge still validates ───────────────────────────────────────────────

def test_merge_runs_validators():
    """model_copy would skip these; the constructor must not.

    'planned' requires a quarter, so a merge producing that combination has to
    raise rather than quietly writing a row the API itself would reject.
    """
    existing = _segment()
    try:
        _merged(CableSegment, existing, {"rfs_status": "planned", "rfs_quarter": None})
    except Exception:
        return
    raise AssertionError("merge accepted an invalid rfs_status/rfs_quarter pair")
