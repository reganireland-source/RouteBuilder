"""
ShipTracker's data_loader functions — load_ships/save_ships/upsert_ship/
delete_ship_row round-tripping in file mode, same shape as the existing
outage round-trip behaviour these mirror.

File mode only (DATABASE_URL unset) — the DB-mode path (_db_upsert_one/
_db_delete_one) is already covered generically by the Finding #1 primitives
other entities exercise; this file's job is the ships-specific wiring
(DATA_DIR / "ships.json", the TrackedShip model, the "mmsi" primary key).

Run with:  pytest backend/tests/test_shiptracker_data_loader.py -v
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest

from app import data_loader
from app.models import TrackedShip


@pytest.fixture(autouse=True)
def isolated_data_dir(tmp_path, monkeypatch):
    """Point DATA_DIR at a throwaway directory and clear the in-process cache
    before and after each test, so tests never touch the real
    backend/data/ships.json (the seeded 3-ship file) or leak state between
    tests via data_loader's module-level _cache dict."""
    monkeypatch.setattr(data_loader, "DATA_DIR", tmp_path)
    data_loader._cache.clear()
    yield
    data_loader._cache.clear()


def _ship(mmsi="525300321", name="Teneo") -> TrackedShip:
    return TrackedShip(mmsi=mmsi, name=name, imo="9019602", added_at="2026-10-07T00:00:00Z", sprite="teneo")


def test_load_ships_with_no_file_returns_empty_list():
    assert data_loader.load_ships() == []


def test_upsert_ship_creates_then_updates_in_place():
    data_loader.upsert_ship(_ship())
    ships = data_loader.load_ships()
    assert len(ships) == 1
    assert ships[0].name == "Teneo"

    # Re-upsert with the same mmsi updates the existing row, not a second one.
    data_loader.upsert_ship(_ship(name="Teneo (renamed)"))
    ships = data_loader.load_ships()
    assert len(ships) == 1
    assert ships[0].name == "Teneo (renamed)"


def test_upsert_ship_appends_a_second_distinct_mmsi():
    data_loader.upsert_ship(_ship(mmsi="525300321", name="Teneo"))
    data_loader.upsert_ship(_ship(mmsi="228018600", name="Ile d'Aix"))
    ships = data_loader.load_ships()
    assert {s.mmsi for s in ships} == {"525300321", "228018600"}


def test_delete_ship_row_removes_only_the_matching_mmsi():
    data_loader.upsert_ship(_ship(mmsi="525300321", name="Teneo"))
    data_loader.upsert_ship(_ship(mmsi="228018600", name="Ile d'Aix"))

    assert data_loader.delete_ship_row("525300321") is True
    ships = data_loader.load_ships()
    assert len(ships) == 1
    assert ships[0].mmsi == "228018600"


def test_delete_ship_row_returns_false_for_unknown_mmsi():
    assert data_loader.delete_ship_row("000000000") is False


def test_upsert_ship_busts_cache_so_a_stale_list_is_never_served():
    data_loader.upsert_ship(_ship(mmsi="525300321", name="Teneo"))
    first = data_loader.load_ships()  # warms the cache
    assert len(first) == 1

    data_loader.upsert_ship(_ship(mmsi="228018600", name="Ile d'Aix"))
    second = data_loader.load_ships()
    assert len(second) == 2  # not the stale cached 1-item list


def test_save_ships_writes_valid_json_matching_the_seed_shape():
    data_loader.save_ships([_ship()])
    raw = json.loads((data_loader.DATA_DIR / "ships.json").read_text())
    assert raw == [{
        "mmsi": "525300321", "name": "Teneo", "imo": "9019602",
        "added_at": "2026-10-07T00:00:00Z", "sprite": "teneo",
    }]
