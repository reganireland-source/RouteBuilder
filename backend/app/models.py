"""
Pydantic domain models — the single source of truth for the shape of every
entity RouteBuilder deals with: network topology (Node, CableSystem,
CableSegment, capacity, interconnect rules), route search (RouteRequest,
Route, RouteResponse), solution/project data (Project, ProjectCircuit) and a
few smaller lookups (interface types, tech enrichment lookups, outages/notes).

These classes are the API contract in both directions: FastAPI uses them to
validate incoming request bodies (a bad field is rejected as an HTTP 422
before any endpoint code runs) and to shape outgoing JSON responses, and
data_loader.py uses the same classes to parse the on-disk/DB JSON documents
back into typed objects. Because one model serves both the "full record" POST
shape and the persisted-row shape, most entities also get a companion
`*Update` model here (e.g. NodeUpdate, CableSegmentUpdate) — an all-Optional
sibling used for PATCH/PUT partial updates, so a client can send only the
fields it wants to change.

Other modules that lean heavily on these models: app/rfs.py (reads
rfs_status/rfs_quarter/eol_status/eol_quarter off CableSystem/CableSegment),
app/graph.py (builds the routing graph from Node/CableSegment/SegmentCapacity),
app/api/bulk.py (CSV import derives its allow-lists from these enums so they
can never drift from the API's own validation), and app/data_checks.py
(cross-references raw JSON against the ID/type vocabularies defined here).

Validation conventions used throughout this file (see individual models for
specifics): geographic coordinates are constrained to valid WGS-84 ranges,
physical/derived quantities (length, capacity, cost) are constrained
non-negative, probabilities (reliability) are constrained to (0, 1], and
paired lifecycle status/quarter fields (rfs_status/rfs_quarter,
eol_status/eol_quarter) are cross-validated so a quarter is required exactly
when the status says "not yet" / "retired" and forbidden otherwise.
"""
from pydantic import BaseModel, Field, field_validator, model_validator
from typing import Optional
from enum import Enum


class NodeType(str, Enum):
    """The role a Node plays in the network topology.

    landing_station: where a submarine cable comes ashore.
    primary_pop / secondary_pop / extension_pop: terrestrial points of
      presence, in decreasing order of network significance.
    branching_unit: an undersea junction where a cable system splits, not a
      physical building — carries no address/verification fields in practice.
    off_net: a node outside Telstra's own network, present for reference/
      routing-boundary purposes only (see Node.on_net and the coverage checks
      in data_checks.py, which exclude off_net nodes from "isolated node"
      warnings since they are never expected to be wired in).
    """
    landing_station = "landing_station"
    primary_pop     = "primary_pop"
    secondary_pop   = "secondary_pop"
    extension_pop   = "extension_pop"
    branching_unit  = "branching_unit"
    off_net         = "off_net"


class SegmentType(str, Enum):
    """Physical medium of a CableSegment: undersea fibre, or a terrestrial
    (land-based) link. Used to gate wet-hop/terrestrial-hop limits in route
    search (RouteRequest.max_wet_hops / max_terrestrial_hops) and to pick
    which speed-of-light plausibility check applies in data_checks.py."""
    wet = "wet"
    terrestrial = "terrestrial"


class Ownership(str, Enum):
    """How a CableSegment is held, from a commercial/capacity perspective —
    owned outright, an IRU (indefeasible right of use), a consortium share,
    a lit (managed) lease, or an off-net resale arrangement. Feeds the
    on-net/off-net route styling (see app/api/config.py's on_net_ownership
    setting) and the interconnect rules in InterconnectRule."""
    owned = "owned"
    iru = "iru"
    consortium = "consortium"
    integrated_lit_lease = "integrated_lit_lease"
    offnet_resell = "offnet_resell"


class DiversityType(str, Enum):
    """A route-search constraint requesting that primary/protect route pairs
    not share risk in the specified way — e.g. 'wet' asks for no shared
    undersea segments, 'full' asks for no shared segments or nodes at all
    (see 'full_nodes' for the node-only variant). Consumed by the route
    search/diversity logic in app/pathfinder.py and app/graph.py."""
    none = "none"
    terrestrial_origin = "terrestrial_origin"
    terrestrial_destination = "terrestrial_destination"
    terrestrial_both = "terrestrial_both"
    wet = "wet"
    full = "full"
    full_nodes = "full_nodes"


class VerificationStatus(str, Enum):
    """Data-quality/review state of a Node or CableSegment record: 'draft'
    (unreviewed, the default), 'under_verification' (review in progress), or
    'verified' (checked against a source of truth). Purely informational —
    does not gate route search — surfaced in the UI so operators know how
    much to trust a given record."""
    draft = "draft"
    under_verification = "under_verification"
    verified = "verified"


class RfsStatus(str, Enum):
    """Ready for Service — whether a CableSystem/CableSegment is already live
    (in_service, the default — everything in the dataset today is) or a
    future build that hasn't been commissioned yet (planned, paired with an
    rfs_quarter). Used as a route-search constraint via RouteRequest's
    service_date: see app/rfs.py for how the pair resolves to a date and
    graph.build_graph for where not-yet-live segments are dropped."""
    in_service = "in_service"
    planned = "planned"


class EolStatus(str, Enum):
    """End of Life — whether a CableSystem/CableSegment is staying in the
    network (active, the default — everything in the dataset today is) or is
    scheduled for decommissioning (eol, paired with an eol_quarter). The exact
    mirror of RfsStatus: RFS excludes cable that is not built YET, EOL excludes
    cable that will be RETIRED by the requested service date. See app/rfs.py for
    how the pair resolves to a date and graph.build_graph for where both
    not-yet-live and already-retired segments are dropped."""
    active = "active"
    eol = "eol"


class BackboneCapabilities(BaseModel):
    """Backbone product speed grades a Node can offer, one list per product:
    IPT, EPL and EVPL. Each list holds speed-grade strings (e.g. "10G",
    "100G") from the bulk-import vocabularies VALID_BB_SPEEDS in
    app/api/bulk.py; None means "not offered / not recorded" rather than
    "offered at no speed"."""
    ipt:  Optional[list[str]] = None
    epl:  Optional[list[str]] = None
    evpl: Optional[list[str]] = None


class UnderlayCapabilities(BaseModel):
    """Underlay product speed grades a Node can offer: GID and IP-VPN. See
    BackboneCapabilities for the list/None convention and where the allowed
    speed-grade vocabulary (VALID_UL_SPEEDS) lives."""
    gid:   Optional[list[str]] = None
    ipvpn: Optional[list[str]] = None


class ColocationCapabilities(BaseModel):
    # Constrained, not a bare int: the five categories are a closed set with
    # named meanings (see COLO_LABELS in the frontend's ProductCoverageMatrix),
    # and an unbounded int let the API accept "Cat 99", which then rendered
    # against an undefined label. The frontend type has always said 1-5; this
    # makes the backend agree rather than trusting the client to.
    category: int = Field(ge=1, le=5)


class NodeCapabilities(BaseModel):
    """Aggregates the three product-coverage facets a Node may advertise —
    backbone, underlay and colocation — each independently optional since a
    given node may offer none, some, or all of them. Nested one level under
    Node.capabilities; round-tripped through the coverage CSV importer/
    exporter in app/api/bulk.py (export_coverage / validate_coverage /
    import_coverage)."""
    backbone:   Optional[BackboneCapabilities]   = None
    underlay:   Optional[UnderlayCapabilities]   = None
    colocation: Optional[ColocationCapabilities] = None


class Node(BaseModel):
    """A physical or logical point in the network topology — a cable landing
    station, a terrestrial PoP, a branching unit, or a reference off-net
    location (see NodeType). This is the full POST/stored shape; NodeUpdate
    below is the partial-update (PATCH/PUT) sibling with every field
    Optional."""
    id: str
    name: str
    # Review finding #11: constrain fields whose domain is fixed, so bad input is
    # rejected at the API boundary (422) instead of silently poisoning the map /
    # the routing graph. lat/lng are WGS-84 degrees, so the valid range is fixed.
    lat: float = Field(ge=-90,  le=90)
    lng: float = Field(ge=-180, le=180)
    type: NodeType
    country: str
    owner: str = "Telstra"
    trading_name: Optional[str] = None
    city: Optional[str] = None
    street_address: Optional[str] = None
    description: Optional[str] = None
    capabilities: Optional[NodeCapabilities] = None
    verification_status: VerificationStatus = VerificationStatus.draft
    last_verified_date: Optional[str] = None
    on_net: Optional[str] = None  # 'on_net' | 'off_net'


# "YYYY-QN" — e.g. "2027-Q3". Quarter-precision, not a specific day, since RFS
# and EOL dates are planning-level estimates that shift; matches the shape used
# whenever the frontend renders/edits it (see frontend/src/types/index.ts).
# One constant for both lifecycle dates on purpose — they are the same shape and
# must stay the same shape, so there is nothing for them to drift apart on.
_QUARTER_PATTERN = r"^\d{4}-Q[1-4]$"


def _check_rfs_quarter(status: "RfsStatus", quarter: Optional[str]) -> None:
    """Shared cross-field rule for rfs_status/rfs_quarter on CableSystem and
    CableSegment: a quarter is required once something is 'planned' (that's
    the whole point of recording it), and cleared once it's 'in_service' so
    a system/segment can't carry a stale future date after it goes live."""
    if status == RfsStatus.planned and not quarter:
        raise ValueError("rfs_quarter is required when rfs_status is 'planned'")
    if status == RfsStatus.in_service and quarter:
        raise ValueError("rfs_quarter must be empty when rfs_status is 'in_service'")


def _check_eol_quarter(status: "EolStatus", quarter: Optional[str]) -> None:
    """The exact mirror of _check_rfs_quarter, for eol_status/eol_quarter: a
    quarter is required once something is 'eol' (that's the whole point of
    recording it), and cleared once it is back to 'active' so a system/segment
    can't carry a stale retirement date after a decommission is called off."""
    if status == EolStatus.eol and not quarter:
        raise ValueError("eol_quarter is required when eol_status is 'eol'")
    if status == EolStatus.active and quarter:
        raise ValueError("eol_quarter must be empty when eol_status is 'active'")


class CableSystem(BaseModel):
    """A named cable system (e.g. a submarine cable consortium build or a
    terrestrial fibre network) that one or more CableSegments belong to via
    CableSegment.system_id. Carries the RFS/EOL lifecycle dates that act as a
    floor/ceiling on every segment underneath it (see app/rfs.py's
    effective_rfs_date / effective_eol_date) plus system-level facts
    (fiber_pair_count, consortium_owners) that don't belong on individual
    nodes or segments."""
    id: str
    name: str
    description: str
    margin: Optional[float] = None
    # Ready for Service — see RfsStatus. Constrains route search whenever the
    # request carries a service_date (app/rfs.py).
    rfs_status: RfsStatus = RfsStatus.in_service
    rfs_quarter: Optional[str] = Field(default=None, pattern=_QUARTER_PATTERN)
    # End of Life — see EolStatus. The other end of the same constraint: RFS
    # says when this system starts carrying traffic, EOL when it stops.
    eol_status: EolStatus = EolStatus.active
    eol_quarter: Optional[str] = Field(default=None, pattern=_QUARTER_PATTERN)
    # Fibre pair count and consortium ownership are system-level facts (a
    # single cable's total pair count, its list of member operators) rather
    # than per-node/per-segment ones — a landing station's own `owner` stays
    # a single string even when the system it belongs to is a multi-party
    # consortium. Both optional: most systems predate this field.
    fiber_pair_count: Optional[int] = Field(default=None, ge=0)
    consortium_owners: Optional[list[str]] = None

    @model_validator(mode="after")
    def _rfs_consistent(self):
        _check_rfs_quarter(self.rfs_status, self.rfs_quarter)
        return self

    @model_validator(mode="after")
    def _eol_consistent(self):
        _check_eol_quarter(self.eol_status, self.eol_quarter)
        return self


class CableSegment(BaseModel):
    """A single point-to-point link in the network graph — one edge between
    start_node_id and end_node_id, belonging to a CableSystem via system_id.
    This is the full POST/stored shape used by app/graph.py to build the
    routing graph; CableSegmentUpdate below is the partial-update sibling.
    Carries its own RFS/EOL lifecycle pair in addition to (and constrained
    by) its owning CableSystem's — see app/rfs.py for how the two combine."""
    id: str
    name: str
    system_id: str
    start_node_id: str
    end_node_id: str
    type: SegmentType
    # Review finding #11: physical/derived quantities can never be negative, and
    # reliability is a probability. gt=0 (not ge=0) on reliability because a
    # zero-availability segment would make end_to_end_reliability collapse to 0
    # for every route through it — that is a data error, not a valid segment.
    length_km: float   = Field(ge=0)
    reliability: float = Field(gt=0, le=1)   # 0-1, annualised availability
    cost_weight: float = Field(ge=0)         # relative cost units
    ownership: Ownership
    latency: Optional[float] = Field(default=None, ge=0)
    waypoints: Optional[list[list[float]]] = None
    verification_status: VerificationStatus = VerificationStatus.draft
    last_verified_date: Optional[str] = None
    # Ready for Service — see RfsStatus. Constrains route search whenever the
    # request carries a service_date (app/rfs.py).
    rfs_status: RfsStatus = RfsStatus.in_service
    rfs_quarter: Optional[str] = Field(default=None, pattern=_QUARTER_PATTERN)
    # End of Life — see EolStatus. The other end of the same constraint: RFS
    # says when this segment starts carrying traffic, EOL when it stops.
    eol_status: EolStatus = EolStatus.active
    eol_quarter: Optional[str] = Field(default=None, pattern=_QUARTER_PATTERN)

    @model_validator(mode="after")
    def _rfs_consistent(self):
        _check_rfs_quarter(self.rfs_status, self.rfs_quarter)
        return self

    @model_validator(mode="after")
    def _eol_consistent(self):
        _check_eol_quarter(self.eol_status, self.eol_quarter)
        return self


class DisallowedPair(BaseModel):
    """One blacklisted (system_a, system_b) transition at a node — see
    InterconnectRule.disallowed_pairs. Used by the route search to reject a
    path that would hand off between these two specific systems there."""
    system_a: str
    system_b: str
    reason: str = "Pair is not allowed"


class AllowedPair(BaseModel):
    """One whitelisted (system_a, system_b) transition at a node — see
    InterconnectRule.allowed_pairs. Naming a system here restricts it: once
    a system appears in any AllowedPair for a node, ONLY the listed pairings
    for that system are permitted there (other systems not mentioned are
    unaffected — see InterconnectRule's own comment)."""
    system_a: str
    system_b: str
    reason: str = "Only this pair is allowed at this node"


class AllowedHandoffSegment(BaseModel):
    """One segment permitted to terminate (be a circuit endpoint) at a node
    whose InterconnectRule.allowed_handoff_segments is non-empty — see that
    field's comment for the restricted-handoff semantics."""
    segment_id: str
    reason: str = "Segment is allowed to terminate at this node"


class InterconnectRule(BaseModel):
    """Per-node routing constraints layered on top of the raw graph — which
    system-to-system handoffs are blocked or exclusively allowed at this
    node, whether the node can be a circuit endpoint at all, and which
    segments (if restricted) may terminate here. Looked up by node_id during
    route search; a node with no InterconnectRule has no extra constraints."""
    node_id: str
    # Blacklist: these system pairs are always rejected at this node
    disallowed_pairs: list[DisallowedPair] = []
    # Whitelist: for any system named here, ONLY the listed transitions are
    # permitted. Systems not mentioned in allowed_pairs are unaffected.
    allowed_pairs: list[AllowedPair] = []
    # No handoff: this node cannot be the circuit endpoint (destination)
    no_handoff: bool = False
    # Restricted handoff: if non-empty, only these segments may terminate here
    allowed_handoff_segments: list[AllowedHandoffSegment] = []


class InterconnectRuleUpdate(BaseModel):
    """Partial-update sibling of InterconnectRule for PATCH/PUT — every list
    field is replaced wholesale when supplied (there is no per-item merge),
    and an omitted field leaves the stored rule's value for that field
    untouched."""
    disallowed_pairs: Optional[list[DisallowedPair]] = None
    allowed_pairs: Optional[list[AllowedPair]] = None
    no_handoff: Optional[bool] = None
    allowed_handoff_segments: Optional[list[AllowedHandoffSegment]] = None


class SegmentCapacity(BaseModel):
    """Capacity accounting for one CableSegment (1:1 via segment_id) — total
    installed capacity vs. what remains available, both in terabits/sec.
    Kept as a separate model/table from CableSegment itself (rather than
    inline fields) because capacity changes on a different cadence than the
    segment's physical attributes; see SegmentCapacityUpdate for the partial-
    update sibling."""
    segment_id: str
    # Review finding #11: capacity is in Tbps — never negative, and you cannot
    # have more capacity free than the segment physically has.
    total_capacity_t: float     = Field(ge=0)
    available_capacity_t: float = Field(ge=0)

    @model_validator(mode="after")
    def _available_within_total(self):
        """Cross-field check: available capacity cannot exceed total capacity."""
        if self.available_capacity_t > self.total_capacity_t:
            raise ValueError(
                f"available_capacity_t ({self.available_capacity_t}) cannot exceed "
                f"total_capacity_t ({self.total_capacity_t})"
            )
        return self


class RouteRequest(BaseModel):
    """The full route-search query contract — POSTed to the route-search
    endpoint and consumed by app/pathfinder.py / app/graph.py. Combines a
    start/end pair with a battery of optional constraints: hard node/segment/
    system/country include-avoid lists, hop caps, a diversity requirement for
    primary/protect pairing, an optimisation objective, and an optional
    service_date that filters the graph down to what is actually RFS and not
    yet EOL on that day (see app/rfs.py). Every list defaults to empty and
    every scalar constraint defaults to None/none, so the bare
    start_node_id/end_node_id pair is itself a valid, unconstrained request."""
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
    # Review finding #11: a hop cap below 1 can never match any route, so treat it
    # as a client bug (422) rather than silently returning zero routes. None means
    # "no cap" and stays allowed.
    max_wet_hops: Optional[int]         = Field(default=None, ge=1)
    max_terrestrial_hops: Optional[int] = Field(default=None, ge=1)
    optimise_for: Optional[str] = None
    # Ready-For-Service constraint: an ISO "YYYY-MM-DD" date meaning "only route
    # over what is actually in service on this day". The frontend sends today's
    # date by default, so the common case is "what can I sell right now".
    # None (the default) means NO filtering at all, so API clients that never
    # send the field — and every existing test — behave exactly as before.
    # Resolution rules live in app/rfs.py; the filter is applied in
    # graph.build_graph so unavailable segments never enter the search graph.
    service_date: Optional[str] = None

    @field_validator("service_date")
    @classmethod
    def _service_date_is_iso(cls, v: Optional[str]) -> Optional[str]:
        # Reject a malformed date at the API boundary (422) instead of silently
        # ignoring it and quoting planned cable as if it were live.
        # Imported inside the function: app/rfs.py imports this module, so a
        # module-level import here would be a cycle.
        from .rfs import parse_service_date
        parse_service_date(v)
        return v


class RouteSegmentDetail(BaseModel):
    """A denormalised snapshot of one CableSegment as it appears within a
    found Route — enough of the segment's own fields (copied at search time)
    for the response to be self-contained, without the client needing a
    second lookup per segment."""
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
    """One complete path found by the route search: the ordered node
    sequence, the segments traversed (with detail), and the aggregate
    metrics computed over them (summed cost/length/latency, multiplied
    end-to-end reliability). diversity_group distinguishes primary vs.
    protect routes when a diversity constraint produced a paired set — see
    RouteResponse.primary_routes / diverse_routes."""
    id: str
    nodes: list[str]
    segments: list[RouteSegmentDetail]
    total_cost: float
    total_length_km: float
    total_latency: float = 0.0
    end_to_end_reliability: float
    diversity_group: int = 1


class RouteResponse(BaseModel):
    """The route-search endpoint's response envelope. `routes` is every route
    found; `primary_routes` / `diverse_routes` split that same set by role
    when a diversity search paired each primary with a protect route (both
    are empty for a non-diversity search, where only `routes` is populated)."""
    routes: list[Route]
    primary_routes: list[Route]
    diverse_routes: list[Route]
    total_found: int = 0


# ── Partial-update models (PATCH/PUT) ─────────────────────────────────────────
# Every field below is Optional and defaults to None; the router merges only
# the fields a caller actually supplied onto the stored record (see e.g.
# app/api/bulk.py's _merged for the equivalent merge used by bulk import).
# Field-level constraints mirror the full model's — see the review-finding
# comments on each — so a PATCH cannot be used to sneak in a value the
# corresponding POST would have rejected.

class NodeUpdate(BaseModel):
    """Partial update for Node — see the module comment above this section."""
    name: Optional[str] = None
    # Review finding #11: mirror the Node constraints here — a PUT must not be a
    # back door around the validation the POST enforces.
    lat: Optional[float] = Field(default=None, ge=-90,  le=90)
    lng: Optional[float] = Field(default=None, ge=-180, le=180)
    type: Optional[NodeType] = None
    country: Optional[str] = None
    owner: Optional[str] = None
    trading_name: Optional[str] = None
    city: Optional[str] = None
    street_address: Optional[str] = None
    description: Optional[str] = None
    capabilities: Optional[NodeCapabilities] = None
    verification_status: Optional[VerificationStatus] = None
    last_verified_date: Optional[str] = None
    on_net: Optional[str] = None  # 'on_net' | 'off_net'

class CableSegmentUpdate(BaseModel):
    """Partial update for CableSegment — see the module comment above this section."""
    name: Optional[str] = None
    system_id: Optional[str] = None
    start_node_id: Optional[str] = None
    end_node_id: Optional[str] = None
    type: Optional[SegmentType] = None
    # Review finding #11: same constraints as CableSegment (see above).
    length_km: Optional[float]   = Field(default=None, ge=0)
    reliability: Optional[float] = Field(default=None, gt=0, le=1)
    cost_weight: Optional[float] = Field(default=None, ge=0)
    ownership: Optional[Ownership] = None
    latency: Optional[float] = Field(default=None, ge=0)
    waypoints: Optional[list[list[float]]] = None
    verification_status: Optional[VerificationStatus] = None
    last_verified_date: Optional[str] = None
    rfs_status: Optional[RfsStatus] = None
    rfs_quarter: Optional[str] = Field(default=None, pattern=_QUARTER_PATTERN)
    eol_status: Optional[EolStatus] = None
    eol_quarter: Optional[str] = Field(default=None, pattern=_QUARTER_PATTERN)

class CableSystemUpdate(BaseModel):
    """Partial update for CableSystem — see the module comment above this section."""
    name: Optional[str] = None
    description: Optional[str] = None
    margin: Optional[float] = None
    rfs_status: Optional[RfsStatus] = None
    rfs_quarter: Optional[str] = Field(default=None, pattern=_QUARTER_PATTERN)
    eol_status: Optional[EolStatus] = None
    eol_quarter: Optional[str] = Field(default=None, pattern=_QUARTER_PATTERN)
    fiber_pair_count: Optional[int] = Field(default=None, ge=0)
    consortium_owners: Optional[list[str]] = None

class SegmentCapacityUpdate(BaseModel):
    # Review finding #11: same non-negativity constraints as SegmentCapacity.
    total_capacity_t: Optional[float]     = Field(default=None, ge=0)
    available_capacity_t: Optional[float] = Field(default=None, ge=0)

    @model_validator(mode="after")
    def _available_within_total(self):
        """Cross-field check, only enforceable when BOTH fields are supplied.

        This is a PARTIAL update model, so when only one field is sent we cannot
        compare against the other without loading the stored row. The router
        merges via model_copy(), which does not re-validate in Pydantic v2, so a
        single-field update that inverts the invariant is not caught here — see
        review finding #11; tightening that needs a re-validate in capacity.py.
        """
        if (
            self.total_capacity_t is not None
            and self.available_capacity_t is not None
            and self.available_capacity_t > self.total_capacity_t
        ):
            raise ValueError(
                f"available_capacity_t ({self.available_capacity_t}) cannot exceed "
                f"total_capacity_t ({self.total_capacity_t})"
            )
        return self


class SegmentOutage(BaseModel):
    """A time-bound event on a cable segment — either a live fault ("outage")
    or a future scheduled work window ("planned_event"). Both share this one
    model/table (see data_loader.py's module docstring: JSONB documents, so
    adding fields needs no migration and old rows without them parse fine via
    the Optional/default values below), distinguished purely by `event_type`.

    Field usage differs by event_type:
      - fault_date: doubles as "date this record was raised/logged" for BOTH
        types (the fault report date for an outage, the notification/raised
        date for a planned event).
      - repair_start / estimated_repair_date: the OUTAGE repair window. Only
        populated when event_type == "outage".
      - planned_start / planned_end: the PLANNED EVENT maintenance window.
        Only populated when event_type == "planned_event".
    A given row only populates the pair matching its own event_type — the
    other pair stays null.
    """
    segment_id: str
    fault_id: str
    fault_date: str
    repair_start: Optional[str] = None
    estimated_repair_date: Optional[str] = None
    description: str
    event_type: str = "outage"   # "outage" (a current live fault) | "planned_event" (a future scheduled work window)
    planned_start: Optional[str] = None   # Planned Events only: window start date (YYYY-MM-DD)
    planned_end: Optional[str] = None     # Planned Events only: window end date (YYYY-MM-DD)


class SolutionNote(BaseModel):
    """A free-text annotation attached to either a node or a segment (exactly
    one of node_id/segment_id is expected to be set by convention — not
    enforced here), categorised via category_id (see NoteCategory) and
    carrying a UI severity for styling."""
    id: str
    node_id: Optional[str] = None
    segment_id: Optional[str] = None
    category_id: str
    title: str
    text: str
    severity: str = "info"  # 'info' | 'warning' | 'critical'
    created_at: Optional[str] = None


class SolutionNoteUpdate(BaseModel):
    """Partial update for SolutionNote."""
    node_id: Optional[str] = None
    segment_id: Optional[str] = None
    category_id: Optional[str] = None
    title: Optional[str] = None
    text: Optional[str] = None
    severity: Optional[str] = None


class NoteCategory(BaseModel):
    """A lookup row defining one category SolutionNote.category_id can
    reference — its display label, whether it applies to nodes or segments,
    and a manual sort order for the UI's category list."""
    id: str
    label: str
    applies_to: str  # 'node' | 'segment'
    order: int = 0


class NoteCategoryUpdate(BaseModel):
    """Partial update for NoteCategory."""
    label: Optional[str] = None
    applies_to: Optional[str] = None
    order: Optional[int] = None


class SegmentOutageUpdate(BaseModel):
    """Partial update for SegmentOutage — see that model's docstring for which
    field pair (repair_* vs planned_*) applies to which event_type."""
    fault_id: Optional[str] = None
    fault_date: Optional[str] = None
    repair_start: Optional[str] = None
    estimated_repair_date: Optional[str] = None
    description: Optional[str] = None
    event_type: Optional[str] = None
    planned_start: Optional[str] = None
    planned_end: Optional[str] = None


# ── Interface Types (reference table) ────────────────────────────────────────

class InterfaceType(BaseModel):
    """A lookup row for the physical/logical interface types offered at a
    customer handoff (e.g. "10GE LAN", "100GE"); referenced by
    EndpointConfig.interface_id."""
    id: str
    name: str
    description: Optional[str] = None


# ── Technical Enrichment Lookups ──────────────────────────────────────────────

class TechLookupItem(BaseModel):
    """A generic labelled, ordered lookup row used by several small
    technical-enrichment vocabularies (the specific table is determined by
    which endpoint/collection loads it, not by a field on this model)."""
    id: str
    label: str
    order: int = 0
    description: Optional[str] = None

class TechLookupItemUpdate(BaseModel):
    """Partial update for TechLookupItem."""
    label: Optional[str] = None
    order: Optional[int] = None
    description: Optional[str] = None


class InterfaceTypeUpdate(BaseModel):
    """Partial update for InterfaceType."""
    name: Optional[str] = None
    description: Optional[str] = None


# ── Customer Solution Projects ────────────────────────────────────────────────

class SldConfig(BaseModel):
    """Which optional fields render on a Solution/Level Diagram (SLD) export
    for a Project — a display toggle set, not domain data. Project.sld_config
    is the project-wide default; ProjectCircuit.sld_config_override can
    override it per circuit."""
    show_latency: bool = True
    show_segment_latency: bool = True
    show_distance: bool = True
    show_ownership: bool = True
    show_reliability: bool = False
    show_rtd: bool = True


class EndpointConfig(BaseModel):
    """The customer-side (A-end or Z-end) access arrangement for one
    ProjectCircuit — site details plus how the circuit is handed off there
    (cross-connect vs. local loop, who supplies/arranges each, and the
    interface/bandwidth/protection it terminates on)."""
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
    """One customer circuit within a Project — a saved route (route_snapshot,
    a frozen copy of a Route search result, not a live reference) plus its
    optional protect route, commercial/technical metadata, and its A-end/
    Z-end access configuration. route_snapshot/protect_route_snapshot are
    stored as plain dicts (not typed as Route) because they are a point-in-
    time snapshot that must keep rendering correctly even if the Route shape
    evolves later."""
    circuit_id: str
    label: Optional[str] = None
    order: int = 0
    route_snapshot: dict
    protect_route_snapshot: Optional[dict] = None
    search_label: str = ""
    pin_color: str = "#94e2d5"
    circuit_description: Optional[str] = None
    service_type: Optional[str] = None
    bandwidth: Optional[str] = None
    protection: Optional[str] = None
    frame_size: Optional[str] = None
    l1_settings: Optional[str] = None
    a_end: EndpointConfig = EndpointConfig()
    z_end: EndpointConfig = EndpointConfig()
    sld_config_override: Optional[dict] = None


class Project(BaseModel):
    """A customer solution project — the top-level container for a set of
    saved circuits (ProjectCircuit) plus the commercial/administrative
    metadata (account manager, opportunity link, visibility) used when
    producing a customer-facing solution document."""
    id: str
    name: str
    account_manager: Optional[str] = None
    solution_architect: Optional[str] = None
    opportunity_id: Optional[str] = None
    opportunity_name: Optional[str] = None
    description: Optional[str] = None
    date_prepared: Optional[str] = None
    visibility: str = "confidential"
    sld_config: SldConfig = SldConfig()
    circuits: list[ProjectCircuit] = []
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class ProjectUpdate(BaseModel):
    """Partial update for Project. Notably excludes `circuits` — circuits are
    managed through their own dedicated endpoints/sub-resource, not via a
    bulk overwrite here."""
    name: Optional[str] = None
    account_manager: Optional[str] = None
    solution_architect: Optional[str] = None
    opportunity_id: Optional[str] = None
    opportunity_name: Optional[str] = None
    description: Optional[str] = None
    date_prepared: Optional[str] = None
    visibility: Optional[str] = None
    sld_config: Optional[SldConfig] = None


# ── NLP route parsing ─────────────────────────────────────────────────────────

class NlpParseRequest(BaseModel):
    # Review findings #11 / #19: /api/nlp/parse is an unauthenticated POST that
    # spends real LLM API budget, so the free-text field must be capped. 2000
    # chars is far more than any genuine route query needs, and stops the
    # endpoint being used to push arbitrarily large prompts upstream.
    text: str = Field(max_length=2000)


class NlpParseResponse(BaseModel):
    """The LLM-assisted /api/nlp/parse endpoint's output: a best-effort
    translation of NlpParseRequest.text into RouteRequest-shaped fields, plus
    metadata about how much to trust it. `confidence` and `ambiguities` let
    the frontend prompt the user to confirm/clarify rather than silently
    running a possibly-wrong search; `explanation` is a human-readable
    summary of how the text was interpreted."""
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


# ── Cable Import research (Phase 3) ────────────────────────────────────────
# See app/cableimport/research.py's own header for why this fans out to
# whatever public sources are actually reachable (Wikipedia today) plus the
# LLM's own general knowledge, rather than scraping submarinenetworks.com
# directly — that site returns a JS bot-challenge to any non-browser client.

class CableResearchRequest(BaseModel):
    """Request body for the admin-gated cable-research endpoint — a cable
    system name to look up via app/cableimport/research.py's public-source +
    LLM-knowledge pipeline (see the module comment above)."""
    # Same reasoning as NlpParseRequest's cap: this endpoint spends real LLM
    # budget per call, so the input is bounded even though it's admin-gated.
    cable_name: str = Field(max_length=200, min_length=1)


class ResearchedLandingStation(BaseModel):
    """One landing station found while researching a cable system — a
    candidate for turning into a Node, with only approximate coordinates
    (see the lat/lng comment below)."""
    name: str
    city: Optional[str] = None
    country: Optional[str] = None
    # Rough city-centre approximations at best — never presented as surveyed.
    # See CableResearchResult.notes for how untrustworthy a given result is.
    lat: Optional[float] = Field(default=None, ge=-90, le=90)
    lng: Optional[float] = Field(default=None, ge=-180, le=180)


class CableResearchResult(BaseModel):
    """The cable-research endpoint's response — a best-effort, LLM-assisted
    draft of a CableSystem plus its landing stations, meant to pre-fill an
    import form for an operator to review, not to be trusted or imported
    unmodified. See sources_used/notes for how to judge a given result, and
    the module comment above for where the underlying data comes from."""
    cable_name: str
    description: str = ""
    consortium_owners: list[str] = []
    fiber_pair_count: Optional[int] = Field(default=None, ge=0)
    rfs_status: RfsStatus = RfsStatus.planned
    rfs_quarter: Optional[str] = None
    landing_stations: list[ResearchedLandingStation] = []
    # Where this came from — ["wikipedia", "model_knowledge"], either or both.
    # Never empty: model_knowledge is always the fallback of last resort.
    sources_used: list[str] = []
    confidence: str = "low"
    # Caveats a reviewer should read before trusting any of the above, e.g.
    # "no source article found" or "fibre pair count not publicly disclosed".
    notes: str = ""
