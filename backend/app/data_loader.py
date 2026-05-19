import json
from pathlib import Path
from .models import Node, CableSystem, CableSegment, InterconnectRule, SegmentCapacity, DisallowedPair

def _write(path: Path, data: list) -> None:
    with open(path, "w") as f:
        json.dump(data, f, indent=2)

DATA_DIR = Path(__file__).parent.parent / "data"


def load_nodes() -> list[Node]:
    with open(DATA_DIR / "nodes.json") as f:
        return [Node(**item) for item in json.load(f)]


def load_systems() -> list[CableSystem]:
    with open(DATA_DIR / "systems.json") as f:
        return [CableSystem(**item) for item in json.load(f)]


def load_segments() -> list[CableSegment]:
    with open(DATA_DIR / "segments.json") as f:
        return [CableSegment(**item) for item in json.load(f)]


def load_rules() -> list[InterconnectRule]:
    with open(DATA_DIR / "rules.json") as f:
        return [InterconnectRule(**item) for item in json.load(f)]

def save_rules(rules: list[InterconnectRule]) -> None:
    _write(DATA_DIR / "rules.json", [r.model_dump() for r in rules])


def load_capacity() -> list[SegmentCapacity]:
    with open(DATA_DIR / "capacity.json") as f:
        return [SegmentCapacity(**item) for item in json.load(f)]

def save_nodes(nodes: list[Node]) -> None:
    _write(DATA_DIR / "nodes.json", [n.model_dump() for n in nodes])

def save_segments(segments: list[CableSegment]) -> None:
    _write(DATA_DIR / "segments.json", [s.model_dump() for s in segments])

def save_systems(systems: list[CableSystem]) -> None:
    _write(DATA_DIR / "systems.json", [s.model_dump() for s in systems])

def save_capacity(capacity: list[SegmentCapacity]) -> None:
    _write(DATA_DIR / "capacity.json", [c.model_dump() for c in capacity])
