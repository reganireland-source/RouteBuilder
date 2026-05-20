"""
Reference data integrity tests — delegates to app.data_checks so the
same logic runs both here (pytest) and via the API (/api/health/checks).

Run with:  pytest backend/tests/test_data_integrity.py -v
"""

import pytest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.data_checks import run_all_checks

_results = run_all_checks()


def pytest_generate_tests(metafunc):
    if "check" in metafunc.fixturenames:
        metafunc.parametrize("check", _results, ids=[r.name for r in _results])


def test_check(check):
    if not check.passed and check.severity == "warning":
        pytest.warns(UserWarning, match="")   # soft — don't fail
    assert check.passed or check.severity == "warning", (
        f"[{check.severity.upper()}] {check.name}: {check.message}"
    )
