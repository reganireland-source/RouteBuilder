import json
from pathlib import Path
from .models import Node, CableSystem, CableSegment, InterconnectRule, SegmentCapacity

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


def load_capacity() -> list[SegmentCapacity]:
    with open(DATA_DIR / "capacity.json") as f:
        return [SegmentCapacity(**item) for item in json.load(f)]
