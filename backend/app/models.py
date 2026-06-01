from pydantic import BaseModel
from typing import Optional
from enum import Enum


class NodeType(str, Enum):
    landing_station = "landing_station"
    terrestrial_pop = "terrestrial_pop"
    branching_unit = "branching_unit"


class SegmentType(str, Enum):
    wet = "wet"
    terrestrial = "terrestrial"


class Ownership(str, Enum):
    owned = "owned"
    iru = "iru"
    consortium = "consortium"
    integrated_lit_lease = "integrated_lit_lease"
    offnet_resell = "offnet_resell"


class DiversityType(str, Enum):
    none = "none"
    terrestrial_origin = "terrestrial_origin"
    terrestrial_destination = "terrestrial_destination"
    terrestrial_both = "terrestrial_both"
    wet = "wet"
    full = "full"
    full_nodes = "full_nodes"


class VerificationStatus(str, Enum):
    draft = "draft"
    under_verification = "under_verification"
    verified = "verified"


class BackboneCapabilities(BaseModel):
    ipt:  Optional[list[str]] = None
    epl:  Optional[list[str]] = None
    evpl: Optional[list[str]] = None


class UnderlayCapabilities(BaseModel):
    gid:   Optional[list[str]] = None
    ipvpn: Optional[list[str]] = None


class ColocationCapabilities(BaseModel):
    category: int  # 1–5


class NodeCapabilities(BaseModel):
    backbone:   Optional[BackboneCapabilities]   = None
    underlay:   Optional[UnderlayCapabilities]   = None
    colocation: Optional[ColocationCapabilities] = None


class Node(BaseModel):
    id: str
    name: str
    lat: float
    lng: float
    type: NodeType
    country: str
    owner: str = "Telstra"
    trading_name: Optional[str] = None
    description: Optional[str] = None
    capabilities: Optional[NodeCapabilities] = None
    verification_status: VerificationStatus = VerificationStatus.draft
    last_verified_date: Optional[str] = None


class CableSystem(BaseModel):
    id: str
    name: str
    description: str
    margin: Optional[float] = None


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
    waypoints: Optional[list[list[float]]] = None
    verification_status: VerificationStatus = VerificationStatus.draft
    last_verified_date: Optional[str] = None


class DisallowedPair(BaseModel):
    system_a: str
    system_b: str
    reason: str = "Pair is not allowed"


class AllowedPair(BaseModel):
    system_a: str
    system_b: str
    reason: str = "Only this pair is allowed at this node"


class InterconnectRule(BaseModel):
    node_id: str
    # Blacklist: these system pairs are always rejected at this node
    disallowed_pairs: list[DisallowedPair] = []
    # Whitelist: for any system named here, ONLY the listed transitions are
    # permitted. Systems not mentioned in allowed_pairs are unaffected.
    allowed_pairs: list[AllowedPair] = []


class InterconnectRuleUpdate(BaseModel):
    disallowed_pairs: Optional[list[DisallowedPair]] = None
    allowed_pairs: Optional[list[AllowedPair]] = None


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
    must_include_systems: list[str] = []
    must_avoid_systems: list[str] = []
    must_include_countries: list[str] = []
    must_avoid_countries: list[str] = []
    diversity: DiversityType = DiversityType.none
    max_wet_hops: Optional[int] = None
    max_terrestrial_hops: Optional[int] = None
    optimise_for: Optional[str] = None


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
    total_latency: float = 0.0
    end_to_end_reliability: float
    diversity_group: int = 1


class RouteResponse(BaseModel):
    routes: list[Route]
    primary_routes: list[Route]
    diverse_routes: list[Route]
    total_found: int = 0


# ── Partial-update models (PATCH/PUT) ─────────────────────────────────────────

class NodeUpdate(BaseModel):
    name: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    type: Optional[NodeType] = None
    country: Optional[str] = None
    owner: Optional[str] = None
    trading_name: Optional[str] = None
    description: Optional[str] = None
    capabilities: Optional[NodeCapabilities] = None
    verification_status: Optional[VerificationStatus] = None
    last_verified_date: Optional[str] = None

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
    waypoints: Optional[list[list[float]]] = None
    verification_status: Optional[VerificationStatus] = None
    last_verified_date: Optional[str] = None

class CableSystemUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    margin: Optional[float] = None

class SegmentCapacityUpdate(BaseModel):
    total_capacity_t: Optional[float] = None
    available_capacity_t: Optional[float] = None


class SegmentOutage(BaseModel):
    segment_id: str
    fault_id: str
    fault_date: str
    repair_start: Optional[str] = None
    estimated_repair_date: Optional[str] = None
    description: str


class SegmentOutageUpdate(BaseModel):
    fault_id: Optional[str] = None
    fault_date: Optional[str] = None
    repair_start: Optional[str] = None
    estimated_repair_date: Optional[str] = None
    description: Optional[str] = None


# ── Interface Types (reference table) ────────────────────────────────────────

class InterfaceType(BaseModel):
    id: str
    name: str
    description: Optional[str] = None


# ── Technical Enrichment Lookups ──────────────────────────────────────────────

class TechLookupItem(BaseModel):
    id: str
    label: str
    order: int = 0
    description: Optional[str] = None

class TechLookupItemUpdate(BaseModel):
    label: Optional[str] = None
    order: Optional[int] = None
    description: Optional[str] = None


class InterfaceTypeUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None


# ── Customer Solution Projects ────────────────────────────────────────────────

class SldConfig(BaseModel):
    show_latency: bool = True
    show_segment_latency: bool = True
    show_distance: bool = True
    show_ownership: bool = True
    show_reliability: bool = False
    show_rtd: bool = True


class EndpointConfig(BaseModel):
    customer_site_name: Optional[str] = None
    customer_site_address: Optional[str] = None
    access_type: Optional[str] = None          # "X-Connect" | "Local Loop" | "Direct"
    cc_supplier: Optional[str] = None
    cc_arranged_by: Optional[str] = None       # "Customer" | "Telstra"
    ll_supplier: Optional[str] = None
    ll_arranged_by: Optional[str] = None       # "Customer" | "Service Provider"
    interface_id: Optional[str] = None         # FK → InterfaceType
    bandwidth: Optional[str] = None
    protection: Optional[str] = None


class ProjectCircuit(BaseModel):
    circuit_id: str
    label: Optional[str] = None
    order: int = 0
    route_snapshot: dict
    protect_route_snapshot: Optional[dict] = None
    search_label: str = ""
    pin_color: str = "#94e2d5"
    service_type: Optional[str] = None
    bandwidth: Optional[str] = None
    protection: Optional[str] = None
    frame_size: Optional[str] = None
    l1_settings: Optional[str] = None
    a_end: EndpointConfig = EndpointConfig()
    z_end: EndpointConfig = EndpointConfig()
    sld_config_override: Optional[dict] = None


class Project(BaseModel):
    id: str
    name: str
    customer_name: Optional[str] = None
    account_manager: Optional[str] = None
    solution_architect: Optional[str] = None
    opportunity_id: Optional[str] = None
    opportunity_name: Optional[str] = None
    date_prepared: Optional[str] = None
    visibility: str = "confidential"
    sld_config: SldConfig = SldConfig()
    circuits: list[ProjectCircuit] = []
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    customer_name: Optional[str] = None
    account_manager: Optional[str] = None
    solution_architect: Optional[str] = None
    opportunity_id: Optional[str] = None
    opportunity_name: Optional[str] = None
    date_prepared: Optional[str] = None
    visibility: Optional[str] = None
    sld_config: Optional[SldConfig] = None


# ── NLP route parsing ─────────────────────────────────────────────────────────

class NlpParseRequest(BaseModel):
    text: str


class NlpParseResponse(BaseModel):
    start_node_id: Optional[str] = None
    end_node_id: Optional[str] = None
    must_include_nodes: list[str] = []
    must_avoid_nodes: list[str] = []
    must_include_segments: list[str] = []
    must_avoid_segments: list[str] = []
    must_include_systems: list[str] = []
    must_avoid_systems: list[str] = []
    must_include_countries: list[str] = []
    must_avoid_countries: list[str] = []
    diversity: str = "none"
    max_wet_hops: Optional[int] = None
    max_terrestrial_hops: Optional[int] = None
    optimise_for: Optional[str] = None
    sort_mode: Optional[str] = None
    explanation: str = ""
    confidence: str = "low"
    ambiguities: list[str] = []
