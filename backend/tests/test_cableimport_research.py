"""
Cable Import Phase 3 — research_cable()'s sanitisation of whatever an LLM
provider hands back, and the module's Wikipedia-miss-is-fine fallback path.

No real network or LLM calls: gather_wikipedia_context is monkeypatched (a
live Wikipedia fetch has no business in a unit test — see
app/cableimport/research.py's own docstring for why a miss there is a normal,
expected outcome, not a test-worthy failure mode) and the LLM provider is a
tiny stub matching LLMProvider's complete_json(system_prompt, user_prompt)
-> dict contract.

Run with:  pytest backend/tests/test_cableimport_research.py -v
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.cableimport import research
from app.models import CableResearchResult, ResearchedLandingStation


class StubProvider:
    """Matches LLMProvider's complete_json(system_prompt, user_prompt) -> dict
    contract without touching a real SDK — the caller only ever sees the
    dict this returns."""

    def __init__(self, response: dict):
        self.response = response
        self.last_system_prompt = None
        self.last_user_prompt = None

    def complete_json(self, system_prompt: str, user_prompt: str) -> dict:
        self.last_system_prompt = system_prompt
        self.last_user_prompt = user_prompt
        return self.response


def test_research_cable_with_no_wikipedia_hit_falls_back_to_model_knowledge(monkeypatch):
    monkeypatch.setattr(research, "gather_wikipedia_context", lambda name: None)
    provider = StubProvider({
        "description": "A fictional trans-Pacific cable.",
        "consortium_owners": ["Acme Networks", "Globex"],
        "fiber_pair_count": 6,
        "rfs_status": "planned",
        "rfs_quarter": "2028-Q1",
        "landing_stations": [
            {"name": "Sydney", "city": "Sydney", "country": "au", "lat": -33.87, "lng": 151.21},
        ],
        "confidence": "medium",
        "notes": "Based on general knowledge only.",
    })

    result = research.research_cable(provider, "Totally Fictional Cable")

    assert isinstance(result, CableResearchResult)
    assert result.sources_used == ["model_knowledge"]
    assert result.cable_name == "Totally Fictional Cable"
    assert result.consortium_owners == ["Acme Networks", "Globex"]
    assert result.fiber_pair_count == 6
    assert result.rfs_status == "planned"
    assert result.rfs_quarter == "2028-Q1"
    assert result.confidence == "medium"
    assert len(result.landing_stations) == 1
    station = result.landing_stations[0]
    assert isinstance(station, ResearchedLandingStation)
    assert station.country == "AU"  # uppercased
    assert station.lat == -33.87
    # "No source article" framing reached the model.
    assert "No source article was found" in provider.last_system_prompt


def test_research_cable_with_wikipedia_hit_includes_source_text_in_prompt(monkeypatch):
    monkeypatch.setattr(research, "gather_wikipedia_context", lambda name: {
        "title": "Example Cable System",
        "extract": "Example Cable System is a submarine telecommunications cable.",
        "url": "https://en.wikipedia.org/wiki/Example_Cable_System",
    })
    provider = StubProvider({
        "description": "Example Cable System.", "consortium_owners": [], "fiber_pair_count": None,
        "rfs_status": "in_service", "rfs_quarter": None, "landing_stations": [],
        "confidence": "high", "notes": "",
    })

    result = research.research_cable(provider, "Example Cable System")

    assert result.sources_used == ["wikipedia"]
    assert result.rfs_status == "in_service"
    assert result.rfs_quarter is None
    assert "Example Cable System is a submarine telecommunications cable." in provider.last_system_prompt


def test_research_cable_sanitises_malformed_llm_output(monkeypatch):
    monkeypatch.setattr(research, "gather_wikipedia_context", lambda name: None)
    provider = StubProvider({
        "description": "x" * 5000,  # oversized — must be capped
        "consortium_owners": ["Real Co", "", "  ", 123, "Another Co"],  # blanks/non-strings dropped or coerced
        "fiber_pair_count": -4,  # negative — invalid, must become None
        "rfs_status": "not_a_real_status",  # invalid — must fall back to 'planned'
        "rfs_quarter": "2030-Q2",  # only kept if rfs_status ends up 'planned'
        "landing_stations": [
            {"name": "Valid Landing", "lat": 200, "lng": 50},  # lat out of range -> dropped
            {"city": "No Name Here"},  # missing name -> dropped entirely
            "not-a-dict",  # garbage entry -> dropped
        ],
        "confidence": "extremely-confident",  # invalid — must fall back to 'low'
        "notes": None,
    })

    result = research.research_cable(provider, "Messy Cable")

    assert len(result.description) <= 2000
    assert result.consortium_owners == ["Real Co", "123", "Another Co"]
    assert result.fiber_pair_count is None
    assert result.rfs_status == "planned"
    assert result.rfs_quarter == "2030-Q2"
    assert result.confidence == "low"
    assert len(result.landing_stations) == 1
    assert result.landing_stations[0].name == "Valid Landing"
    assert result.landing_stations[0].lat is None  # out-of-range dropped, not clamped
    assert result.notes == "None"  # str(None) — never crashes on a null notes field


def test_clean_fiber_pair_count_rejects_non_numeric():
    assert research._clean_fiber_pair_count("six") is None
    assert research._clean_fiber_pair_count(None) is None
    assert research._clean_fiber_pair_count(0) == 0
    assert research._clean_fiber_pair_count(12.0) == 12
