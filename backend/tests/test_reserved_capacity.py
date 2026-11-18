"""
Reserved capacity: Total = Free + Reserved + Used.

A segment's capacity now has three stored figures — total, available (Free)
and reserved — with Used derived. These tests pin down:

  * the model rule (Free + Reserved <= Total) and that rows saved before
    Reserved existed load with 0 reserved;
  * PUT /api/capacity re-validates the MERGED record, so raising one figure on
    its own can't break the rule (it used to skip validation entirely);
  * bulk CSV round-trips reserved, rejects impossible rows, and an old CSV with
    no reserved column keeps the stored figure instead of zeroing it;
  * the data-integrity check flags an over-total split;
  * route search ranks by Free only — reserved capacity is not sellable.

Run with:  pytest backend/tests/test_reserved_capacity.py -v
"""
import io
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest                                                        # noqa: E402
from fastapi import HTTPException                                    # noqa: E402
from pydantic import ValidationError                                 # noqa: E402
from starlette.datastructures import UploadFile                      # noqa: E402

from app.api import bulk, capacity as capacity_api                  # noqa: E402
from app.models import SegmentCapacity, SegmentCapacityUpdate       # noqa: E402


def _cap(seg="SEG1", total=10.0, free=4.0, reserved=0.0):
    return SegmentCapacity(segment_id=seg, total_capacity_t=total,
                           available_capacity_t=free, reserved_capacity_t=reserved)


# ── model ───────────────────────────────────────────────────────────────────

def test_used_is_total_minus_free_minus_reserved():
    c = _cap(total=10, free=4, reserved=3)
    assert c.used_capacity_t == 3


def test_free_plus_reserved_cannot_exceed_total():
    with pytest.raises(ValidationError, match="cannot exceed Total"):
        _cap(total=10, free=8, reserved=3)
    _cap(total=10, free=7, reserved=3)                       # exactly full is fine
    _cap(total=0.3, free=0.1, reserved=0.2)                  # float rounding is not an error


def test_rows_saved_before_reserved_existed_load_as_zero_reserved():
    c = SegmentCapacity(segment_id="OLD", total_capacity_t=5, available_capacity_t=2)
    assert c.reserved_capacity_t == 0 and c.used_capacity_t == 3


def test_reserved_cannot_be_negative():
    with pytest.raises(ValidationError):
        _cap(reserved=-1)
    with pytest.raises(ValidationError):
        SegmentCapacityUpdate(reserved_capacity_t=-1)


# ── PUT merge ───────────────────────────────────────────────────────────────

@pytest.fixture
def store(monkeypatch):
    rows = [_cap("SEG1", total=10, free=4, reserved=2)]
    saved = {}
    monkeypatch.setattr(capacity_api, "load_capacity", lambda: list(rows))
    monkeypatch.setattr(capacity_api, "save_capacity", lambda caps: saved.update(rows=caps))
    return saved


def test_put_updates_reserved_alone(store):
    out = capacity_api.update_capacity("SEG1", SegmentCapacityUpdate(reserved_capacity_t=5))
    assert (out.total_capacity_t, out.available_capacity_t, out.reserved_capacity_t) == (10, 4, 5)
    assert store["rows"][0].reserved_capacity_t == 5


def test_put_rejects_a_one_field_change_that_breaks_the_split(store):
    with pytest.raises(HTTPException) as exc:
        capacity_api.update_capacity("SEG1", SegmentCapacityUpdate(reserved_capacity_t=7))   # 4 free + 7 > 10
    assert exc.value.status_code == 422
    assert "cannot exceed Total" in exc.value.detail
    assert "rows" not in store                                                          # nothing saved
    with pytest.raises(HTTPException):
        capacity_api.update_capacity("SEG1", SegmentCapacityUpdate(total_capacity_t=5))   # 4 + 2 > 5


# ── bulk CSV ────────────────────────────────────────────────────────────────

def _csv(text: str) -> UploadFile:
    return UploadFile(file=io.BytesIO(text.encode()), filename="capacity.csv")


@pytest.fixture
def bulk_store(monkeypatch):
    rows = {"SEG1": _cap("SEG1", total=10, free=4, reserved=3)}
    saved = {}
    monkeypatch.setattr(bulk, "load_capacity", lambda: list(rows.values()))
    monkeypatch.setattr(bulk, "load_segments", lambda: [type("S", (), {"id": s})() for s in ("SEG1", "SEG2")])
    monkeypatch.setattr(bulk, "save_capacity", lambda caps: saved.update({c.segment_id: c for c in caps}))
    return saved


def test_bulk_validate_reads_reserved_and_rejects_over_total(bulk_store):
    res = bulk.validate_capacity(_csv(
        "segment_id,total_capacity_t,available_capacity_t,reserved_capacity_t\n"
        "SEG1,10,4,5\n"
        "SEG2,8,5,4\n"), mode="upsert")
    assert any(e["id"] == "SEG2" and "cannot exceed Total" in e["message"] for e in res["validation_errors"])
    seg1 = next(c for c in res["changes"] if c["id"] == "SEG1")
    assert seg1["changed_fields"] == ["reserved_capacity_t"]


def test_old_csv_without_reserved_column_keeps_the_stored_figure(bulk_store):
    old_csv = "segment_id,total_capacity_t,available_capacity_t\nSEG1,10,5\nSEG2,6,6\n"
    res = bulk.validate_capacity(_csv(old_csv), mode="upsert")
    assert not res["validation_errors"]
    seg1 = next(c for c in res["changes"] if c["id"] == "SEG1")
    assert seg1["data"]["reserved_capacity_t"] == 3 and seg1["changed_fields"] == ["available_capacity_t"]
    bulk.import_capacity(_csv(old_csv), mode="upsert")
    assert bulk_store["SEG1"].reserved_capacity_t == 3                  # kept, not zeroed
    assert bulk_store["SEG2"].reserved_capacity_t == 0                  # new row: 0


def test_bulk_export_includes_reserved(bulk_store, monkeypatch):
    captured = {}
    monkeypatch.setattr(bulk, "_csv_stream", lambda rows, cols, name: captured.update(rows=rows, cols=cols))
    bulk.export_capacity()
    assert captured["cols"] == ["segment_id", "total_capacity_t", "available_capacity_t", "reserved_capacity_t"]
    assert captured["rows"] == [{"segment_id": "SEG1", "total_capacity_t": 10.0,
                                 "available_capacity_t": 4.0, "reserved_capacity_t": 3.0}]


# ── integrity check & routing ───────────────────────────────────────────────

def test_data_check_flags_an_over_total_split(monkeypatch):
    from app import data_checks
    bad = SegmentCapacity.model_construct(segment_id="BAD", total_capacity_t=5,
                                          available_capacity_t=4, reserved_capacity_t=2)
    for name in ("load_nodes", "load_segments", "load_systems", "load_rules", "load_outages"):
        monkeypatch.setattr(data_checks, name, lambda: [])
    monkeypatch.setattr(data_checks, "load_capacity", lambda: [bad, _cap("OK")])
    results = {r.name: r for r in data_checks.run_all_checks()}
    split = results["Capacity free + reserved ≤ total"]
    assert not split.passed and "BAD" in split.message and "OK" not in split.message


def test_route_ranking_uses_free_not_reserved():
    from app import pathfinder
    src = Path(pathfinder.__file__).read_text()
    assert "available_capacity_t" in src and "reserved_capacity_t" not in src
