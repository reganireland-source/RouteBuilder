"""
fiber_pair_count / consortium_owners on CableSystem — added for the Cable
Import feature (modeling cable systems this org does not own). Both are
optional system-level facts; see app/models.py's CableSystem docstring.

Run with:  pytest backend/tests/test_cable_system_fields.py -v
"""

import sys
from pathlib import Path

import pytest
from pydantic import ValidationError

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.models import CableSystem, CableSystemUpdate


def test_cable_system_defaults_both_fields_to_none():
    system = CableSystem(id="TEST-SYS", name="Test System", description="")
    assert system.fiber_pair_count is None
    assert system.consortium_owners is None


def test_cable_system_accepts_fiber_pair_count_and_consortium_owners():
    system = CableSystem(
        id="TEST-SYS",
        name="Test System",
        description="",
        fiber_pair_count=6,
        consortium_owners=["Telstra", "NTT", "Meta"],
    )
    assert system.fiber_pair_count == 6
    assert system.consortium_owners == ["Telstra", "NTT", "Meta"]


def test_cable_system_rejects_negative_fiber_pair_count():
    with pytest.raises(ValidationError):
        CableSystem(id="TEST-SYS", name="Test System", description="", fiber_pair_count=-1)


def test_cable_system_update_can_set_both_fields():
    updates = CableSystemUpdate(fiber_pair_count=12, consortium_owners=["Amazon", "Google"])
    assert updates.fiber_pair_count == 12
    assert updates.consortium_owners == ["Amazon", "Google"]


def test_cable_system_update_leaves_both_unset_by_default():
    updates = CableSystemUpdate(name="Renamed")
    dumped = updates.model_dump(exclude_unset=True)
    assert "fiber_pair_count" not in dumped
    assert "consortium_owners" not in dumped
