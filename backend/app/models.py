from pydantic import BaseModel
from typing import Optional
from enum import Enum


class NodeType(str, Enum):
    landing_station = "landing_station"
    terrestrial_pop = "terrestrial_pop"


class SegmentType(str, Enum):
    wet = "wet"
    terrestrial = "terrestrial"


class Ownership(str, Enum):
    owned = "owned"
    iru = "iru"
    consortium = "consortium"


class DiversityType(str, Enum):
    none = "none"
    terrestrial_origin = "terrestrial_origin"
    terrestrial_destination = "terrestrial_destination"
    terrestrial_both = "terrestrial_both"
    wet = "wet"
    full = "full"


class Node(BaseModel):
    id: str
    name: str
    lat: float
    lng: float
    type: NodeType
    country: str


class CableSystem(BaseModel):
    id: str
    name: str
    description: str


class CableSegment(BaseModel):
    id: str
    name: str
    system_id: str
    start_node_id: str
    end_node_id: str
    type: SegmentType
    length_km: float
    reliability: float        # 0-1, annualised availability
    cost_weight: float        # relative cost units
    ownership: Ownership
    latency: Optional[float] = None


class DisallowedPair(BaseModel):
    system_a: str
    system_b: str
    reason: str = "Pair is not allowed"


class InterconnectRule(BaseModel):
    node_id: str
    disallowed_pairs: list[DisallowedPair]


class InterconnectRuleUpdate(BaseModel):
    disallowed_pairs: Optional[list[DisallowedPair]] = None


class SegmentCapacity(BaseModel):
    segment_id: str
    total_capacity_t: float
    available_capacity_t: float


class RouteRequest(BaseModel):
    start_node_id: str
    end_node_id: str
    must_include_nodes: list[str] = []
    must_avoid_nodes: list[str] = []
    must_avoid_segments: list[str] = []
    must_include_segments: list[str] = []
    diversity: DiversityType = DiversityType.none


class RouteSegmentDetail(BaseModel):
    segment_id: str
    system_id: str
    start_node_id: str
    end_node_id: str
    type: SegmentType
    length_km: float
    reliability: float
    cost_weight: float
    ownership: Ownership
    latency: Optional[float] = None


class Route(BaseModel):
    id: str
    nodes: list[str]
    segments: list[RouteSegmentDetail]
    total_cost: float
    total_length_km: float
    end_to_end_reliability: float
    diversity_group: int = 1


class RouteResponse(BaseModel):
    routes: list[Route]
    primary_routes: list[Route]
    diverse_routes: list[Route]


# ── Partial-update models (PATCH/PUT) ─────────────────────────────────────────

class NodeUpdate(BaseModel):
    name: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    type: Optional[NodeType] = None
    country: Optional[str] = None

class CableSegmentUpdate(BaseModel):
    name: Optional[str] = None
    system_id: Optional[str] = None
    start_node_id: Optional[str] = None
    end_node_id: Optional[str] = None
    type: Optional[SegmentType] = None
    length_km: Optional[float] = None
    reliability: Optional[float] = None
    cost_weight: Optional[float] = None
    ownership: Optional[Ownership] = None
    latency: Optional[float] = None

class CableSystemUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None

class SegmentCapacityUpdate(BaseModel):
    total_capacity_t: Optional[float] = None
    available_capacity_t: Optional[float] = None
