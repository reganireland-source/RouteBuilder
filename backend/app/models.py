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
    wet = "wet"
    terrestrial = "terrestrial"
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
    latency: float            # one-way propagation delay in ms (length / 200,000 km/s)


class InterconnectRule(BaseModel):
    node_id: str
    disallowed_pairs: list[list[str]]  # pairs of system_ids that cannot interconnect


class RouteRequest(BaseModel):
    start_node_id: str
    end_node_id: str
    must_include_nodes: list[str] = []
    must_avoid_nodes: list[str] = []
    must_avoid_segments: list[str] = []
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
    latency: float


class Route(BaseModel):
    id: str
    nodes: list[str]
    segments: list[RouteSegmentDetail]
    total_cost: float
    total_length_km: float
    total_latency: float
    end_to_end_reliability: float
    diversity_group: int = 1


class RouteResponse(BaseModel):
    routes: list[Route]
    primary_routes: list[Route]
    diverse_routes: list[Route]
