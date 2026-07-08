/**
 * ============================================================================
 * types/index.ts — Shared TypeScript types for the RouteBuilder frontend
 * ============================================================================
 *
 * This file is the single source of truth for every data shape that moves
 * between the React frontend and the FastAPI backend, plus a handful of
 * purely client-side UI types. Almost every component imports from here.
 *
 * Domain glossary (used throughout the app):
 *   - "system"        = a named submarine cable (e.g. EAC, C2C, SJC).
 *   - "wet segment"   = a section of submarine cable under the sea.
 *   - CLS             = Cable Landing Station, where a submarine cable
 *                       comes ashore (NodeType 'landing_station').
 *   - "diversity"     = a physically separate backup path for a route.
 *   - SLD             = Straight Line Diagram, the exported circuit schematic.
 *   - "pinned route"  = a search result the user keeps visible on the map.
 *   - "project"       = a saved customer solution containing one or more
 *                       circuits (each circuit snapshots a route).
 *
 * Persistence note: the reference data (nodes/segments/systems/etc.) lives in
 * normal backend tables, but Project and ProjectCircuit are persisted as
 * whole JSONB documents by the backend — the frontend sends/receives the
 * entire nested object graph (circuits, route snapshots, endpoint configs)
 * in one payload rather than as separate rows.
 */

// ── Core enumerations ─────────────────────────────────────────────────────────
// String-literal unions used across the whole app. They mirror the values the
// backend stores, so changing one here requires a matching backend change.

/**
 * Classification of a network node, which drives map icon styling and routing:
 *  - 'landing_station': a CLS where a submarine cable comes ashore.
 *  - 'primary_pop' / 'secondary_pop' / 'extension_pop': on-net Points of
 *    Presence of decreasing importance.
 *  - 'branching_unit': an undersea splitter on a cable (no buildings/ports).
 *  - 'off_net': a third-party site we can reach but do not operate.
 */
export type NodeType = 'landing_station' | 'primary_pop' | 'secondary_pop' | 'extension_pop' | 'branching_unit' | 'off_net'
/** Whether a node is on the operator's own network ('on_net') or third-party ('off_net'). */
export type OnNet = 'on_net' | 'off_net'
/** Data-quality workflow state for reference data records (nodes/segments). */
export type VerificationStatus = 'draft' | 'under_verification' | 'verified'
/** Segment medium: 'wet' = submarine cable section, 'terrestrial' = land fibre. */
export type SegmentType = 'wet' | 'terrestrial'
/**
 * Commercial ownership model of a segment. Used to decide whether a route is
 * "on-net" (see AppConfig.on_net_ownership) and shown in SLD exports:
 * owned outright, IRU (long-term lease), consortium share, integrated lit
 * lease, or off-net resell.
 */
export type Ownership = 'owned' | 'iru' | 'consortium' | 'integrated_lit_lease' | 'offnet_resell'
/**
 * Diversity requirement passed to the route search (RouteRequest.diversity).
 * Controls how physically separate the backup path must be from the primary:
 *  - 'none': no diverse path requested.
 *  - 'terrestrial_origin'/'terrestrial_destination'/'terrestrial_both':
 *    land portions at one/both ends must differ.
 *  - 'wet': the submarine (wet) portions must use different cables.
 *  - 'full': no shared segments at all.
 *  - 'full_nodes': no shared segments AND no shared intermediate nodes.
 */
export type DiversityType = 'none' | 'terrestrial_origin' | 'terrestrial_destination' | 'terrestrial_both' | 'wet' | 'full' | 'full_nodes'
/**
 * Top-level UI mode selected in App.tsx's mode switcher (and mirrored in
 * MobileLayout). Each mode swaps the left-hand panel and changes what the
 * map displays:
 *  - 'routebuilder': constraint-based A→Z route search (SearchForm/RouteList).
 *  - 'routemanual':  hand-build a route hop by hop (RouteManual).
 *  - 'systemviewer': highlight whole cable systems on the map (SystemViewer).
 *  - 'nodefinder':   filter/locate nodes by capability (NodeFinder).
 *  - 'citypair':     city-to-city path summary view (CityPairPanel).
 *  - 'countryviewer': show all systems/nodes touching a country (CountryViewer).
 *  - 'outageviewer': show active cable faults/outages (OutagePanel).
 */
export type AppMode = 'routebuilder' | 'routemanual' | 'systemviewer' | 'nodefinder' | 'citypair' | 'countryviewer' | 'outageviewer'

/**
 * Global app configuration served by GET /api/config and editable by admins.
 * - on_net_ownership: which Ownership values count as "on-net" when the UI
 *   labels a route/segment as on-net vs off-net.
 * - maps_provider: which base map Map.tsx renders — 'google' uses the
 *   GoogleMutant layer, 'osm' (default) uses CARTO tiles.
 */
export interface AppConfig {
  on_net_ownership: string[]
  maps_provider?: 'osm' | 'google'
}

/** Ethernet port speeds available at a node (used inside NodeCapabilities). */
export type PortSpeed = '1G' | '10G' | '100G' | '400G'

/**
 * Optional service capabilities of a node, shown in NodeInfoPanel and used by
 * NodeFinder's capability filters:
 * - backbone: port speeds available per backbone product (IPT = IP Transit,
 *   EPL = Ethernet Private Line, EVPL = Ethernet Virtual Private Line).
 * - underlay: port speeds per underlay product (GID, IPVPN).
 * - colocation: data-centre colocation tier (1 = best) if colo is offered.
 * All sections are optional — an absent section means "not offered here".
 */
export interface NodeCapabilities {
  backbone?: {
    ipt?:  PortSpeed[]
    epl?:  PortSpeed[]
    evpl?: PortSpeed[]
  }
  underlay?: {
    gid?:   PortSpeed[]
    ipvpn?: PortSpeed[]
  }
  colocation?: {
    category: 1 | 2 | 3 | 4 | 5
  }
}

/**
 * A physical network location — CLS, PoP, branching unit or off-net site.
 * This is the vertex type of the routing graph. Fetched via GET /api/nodes,
 * rendered as markers by Map.tsx (styling keyed off `type` and `on_net`),
 * edited in RefDataModal, and referenced everywhere by its `id`.
 * lat/lng are WGS84 degrees; Map.tsx normalises lng for the Pacific-centred
 * view. `verification_status` tracks data quality; `capabilities` powers
 * NodeFinder filtering.
 */
export interface CableNode {
  id: string
  name: string
  lat: number
  lng: number
  type: NodeType
  country: string
  owner?: string
  trading_name?: string
  city?: string
  street_address?: string
  description?: string
  capabilities?: NodeCapabilities
  verification_status?: VerificationStatus
  last_verified_date?: string
  on_net?: OnNet
}

/**
 * A named submarine cable system (e.g. "EAC", "C2C") that groups segments
 * via CableSegment.system_id. Fetched via GET /api/systems; SystemViewer
 * lets users highlight one on the map; `margin` is an optional commercial
 * margin figure used for margin/cost-based route sorting.
 */
export interface CableSystem {
  id: string
  name: string
  description: string
  margin?: number
}

/**
 * An edge of the routing graph: one section of cable between two nodes.
 * `type` says whether it is a wet (submarine) or terrestrial section, and
 * `system_id` links wet segments to their parent CableSystem. The metric
 * fields (length_km, latency, reliability, cost_weight) feed the backend
 * path-finding algorithm and the totals shown per route. `waypoints` is an
 * optional polyline of [lat, lng] pairs Map.tsx uses to draw the real cable
 * path (smoothed with a Catmull-Rom spline) instead of a straight line.
 * Fetched via GET /api/segments, edited in RefDataModal.
 */
export interface CableSegment {
  id: string
  name: string
  system_id: string
  start_node_id: string
  end_node_id: string
  type: SegmentType
  length_km: number
  reliability: number
  cost_weight: number
  ownership: Ownership
  latency: number
  waypoints?: [number, number][]
  verification_status?: VerificationStatus
  last_verified_date?: string
}

/**
 * Per-hop detail embedded in a Route result — a denormalised snapshot of the
 * CableSegment fields that mattered at search time (so a saved/pinned route
 * still renders correctly even if reference data changes later).
 */
export interface RouteSegmentDetail {
  segment_id: string
  system_id: string
  start_node_id: string
  end_node_id: string
  type: SegmentType
  length_km: number
  reliability: number
  cost_weight: number
  ownership: Ownership
  latency: number
}

/**
 * One candidate path returned by the route search (POST /api/routes).
 * `nodes` is the ordered list of node ids from A-end to Z-end and `segments`
 * the hops between them. The totals are pre-computed by the backend.
 * `diversity_group` pairs a primary route with its diverse partner: routes
 * sharing a group number form a primary+backup pair in the results list.
 * Routes get pinned to the map (PinnedRoute) and snapshotted into project
 * circuits (ProjectCircuit.route_snapshot).
 */
export interface Route {
  id: string
  nodes: string[]
  segments: RouteSegmentDetail[]
  total_cost: number
  total_length_km: number
  total_latency: number
  end_to_end_reliability: number
  diversity_group: number
}

/**
 * The search constraints sent to POST /api/routes. Built interactively by
 * SearchForm (or auto-filled from natural language via NlpChat/NlpParseResponse).
 * All the must_include_/must_avoid_ arrays hold ids (nodes/segments/systems)
 * or ISO country codes; `diversity` requests a physically separate backup
 * path (see DiversityType); the hop caps bound path length; `optimise_for`
 * picks the backend cost function (e.g. latency vs distance).
 */
export interface RouteRequest {
  start_node_id: string
  end_node_id: string
  must_include_nodes: string[]
  must_avoid_nodes: string[]
  must_avoid_segments: string[]
  must_include_segments: string[]
  must_include_systems: string[]
  must_avoid_systems: string[]
  must_include_countries?: string[]
  must_avoid_countries?: string[]
  diversity: DiversityType
  max_wet_hops?: number
  max_terrestrial_hops?: number
  optimise_for?: string
}

/**
 * Result envelope of POST /api/routes. `routes` is the flat list;
 * `primary_routes`/`diverse_routes` split them when a diversity option was
 * requested (matched up via Route.diversity_group). App.tsx stores this as
 * `response` and RouteList renders it.
 */
export interface RouteResponse {
  routes: Route[]
  primary_routes: Route[]
  diverse_routes: Route[]
  total_found: number
}

/**
 * Capacity record for one segment (GET /api/capacity), in terabits.
 * Shown in CapacityDashboard and used by capacity-based route sorting.
 */
export interface SegmentCapacity {
  segment_id: string
  total_capacity_t: number
  available_capacity_t: number
}

/**
 * An active or historical cable fault on a segment (GET /api/outages).
 * Drives the 'outageviewer' mode (OutagePanel) and outage warnings/sorting
 * in route results. Dates are ISO strings; repair fields are null while
 * unknown.
 */
export interface SegmentOutage {
  segment_id: string
  fault_id: string
  fault_date: string
  repair_start?: string | null
  estimated_repair_date?: string | null
  description: string
}

/** A pair of cable systems that must NOT interconnect at a node (see InterconnectRule). */
export interface DisallowedPair {
  system_a: string
  system_b: string
  reason: string
}

/** A pair of cable systems explicitly allowed to interconnect at a node (see InterconnectRule). */
export interface AllowedPair {
  system_a: string
  system_b: string
  reason: string
}

/** A specific segment allowed as a hand-off at a node that otherwise has no_handoff set. */
export interface AllowedHandoffSegment {
  segment_id: string
  reason: string
}

/**
 * Per-node interconnect policy consumed by the backend route search
 * (GET/POST /api/rules, managed in RefDataModal). Encodes physical/commercial
 * reality at a site: which cable systems can(not) hand traffic to each other
 * there, or `no_handoff` to forbid all transit through the node except via
 * `allowed_handoff_segments`.
 */
export interface InterconnectRule {
  node_id: string
  disallowed_pairs: DisallowedPair[]
  allowed_pairs: AllowedPair[]
  no_handoff?: boolean
  allowed_handoff_segments?: AllowedHandoffSegment[]
}

/**
 * Client-side only: a cable system the user highlighted in SystemViewer mode,
 * plus the display colour assigned to it. Held in App.tsx state and passed to
 * Map.tsx for rendering.
 */
export interface SelectedSystem {
  systemId: string
  color: string
}

/**
 * Client-side only: a route the user has "pinned" so it stays drawn on the
 * map after new searches. `pinId` is a locally generated unique id, `color`
 * the assigned display colour and `searchLabel` a human summary of the search
 * that produced it (e.g. "HKG → SIN"). When the pin came from opening a saved
 * project, projectId/circuitId/circuitLabel link it back to that circuit.
 * Held in App.tsx state (`pinnedRoutes`) and rendered by Map.tsx/RouteList.
 */
export interface PinnedRoute {
  pinId: string
  route: Route
  color: string
  searchLabel: string
  projectId?: string
  circuitId?: string
  circuitLabel?: string
}

/**
 * A city and the node ids located in it, from GET /api/city-pairs/cities.
 * Populates the origin/destination pickers in CityPairPanel.
 */
export interface CityInfo {
  name: string
  node_ids: string[]
  country: string
}

/** An intermediate CLS a city-pair route passes through (id + display name). */
export interface CityPairIntermediateNode {
  node_id: string
  name: string
}

/**
 * One high-level city-to-city path from POST /api/city-pairs/search.
 * Unlike Route, this is summarised at cable-system level: which systems the
 * path rides, which CLS nodes it lands at, and headline latency/length/
 * reliability figures. Rendered by CityPairPanel in 'citypair' mode.
 */
export interface CityPairRoute {
  id: string
  systems: string[]
  system_names: string[]
  nodes: string[]
  cls_nodes: string[]
  intermediate_cls: CityPairIntermediateNode[]
  total_latency_ms: number
  total_length_km: number
  end_to_end_reliability: number
  hop_count: number
}

/** Result envelope of POST /api/city-pairs/search: the echoed city names plus candidate routes. */
export interface CityPairResponse {
  origin_city: string
  destination_city: string
  routes: CityPairRoute[]
}

/**
 * Sort orders the NLP assistant can request for route results
 * (NlpParseResponse.sort_mode), applied by RouteList. Several values are
 * aliases so the language model can use natural wording.
 */
export type NlpSortMode =
  | 'hops'                             // hop count
  | 'distance' | 'length'             // total km (length is alias)
  | 'latency'                          // round-trip delay
  | 'availability' | 'reliability'     // end-to-end availability
  | 'margin' | 'cost'                  // route margin
  | 'capacity'                         // available capacity
  | 'ownership'                        // on-net ownership
  | 'outages'                          // push outage routes down

/**
 * Client-side only: everything Map.tsx needs to spotlight one country in
 * 'countryviewer' mode — which systems touch it (with per-system colours),
 * which terrestrial segments and nodes belong to it, plus a centroid and
 * lat/lng bounding box for zooming. Built by CountryViewer, held in App.tsx.
 * Note it uses Set/Map so it is not JSON-serialisable (never persisted).
 */
export interface CountryHighlight {
  countryCode: string
  countryName: string
  systemIds: Set<string>
  systemColors: Map<string, string>
  terrestrialSegIds: Set<string>
  nodeIds: Set<string>
  centroid: [number, number]
  boundsLL: [[number, number], [number, number]]
}

// ── Interface Types ───────────────────────────────────────────────────────────

/**
 * A physical hand-off interface type (e.g. "10GBASE-LR") from
 * GET /api/interfaces. Referenced by EndpointConfig.interface_id and managed
 * in RefDataModal; shown on SLD exports.
 */
export interface InterfaceType {
  id: string
  name: string
  description?: string
}

// ── Customer Solution Projects ────────────────────────────────────────────────

/**
 * Toggles controlling which figures appear on a project's exported SLD
 * (Straight Line Diagram) — per-route latency, per-segment latency, distance,
 * ownership labels, reliability and RTD (round-trip delay). Stored on the
 * Project (and optionally overridden per circuit via sld_config_override);
 * consumed by utils/generateDiagram.ts.
 */
export interface SldConfig {
  show_latency: boolean
  show_segment_latency: boolean
  show_distance: boolean
  show_ownership: boolean
  show_reliability: boolean
  show_rtd: boolean
}

/** Default SLD toggles applied to newly created projects (reliability off, everything else on). */
export const DEFAULT_SLD_CONFIG: SldConfig = {
  show_latency: true,
  show_segment_latency: true,
  show_distance: true,
  show_ownership: true,
  show_reliability: false,
  show_rtd: true,
}

/**
 * Customer-facing details for one end (A-end or Z-end) of a circuit: the
 * customer site, local access arrangements (CC = cross connect, LL = local
 * loop, each with supplier and who arranges it), hand-off interface,
 * bandwidth and protection. Filled in via TechEnrichmentPanel and printed on
 * SLD exports. Persisted as part of the ProjectCircuit JSONB document.
 */
export interface EndpointConfig {
  customer_site_name?: string
  customer_site_address?: string
  access_type?: string
  cc_supplier?: string
  cc_arranged_by?: string
  ll_supplier?: string
  ll_arranged_by?: string
  interface_id?: string
  bandwidth?: string
  protection?: string
}

/**
 * One circuit inside a saved Project. It freezes the chosen route as
 * `route_snapshot` (plus `protect_route_snapshot` when a diverse/protected
 * pair was selected) so the design survives later reference-data edits, and
 * carries the technical enrichment (service type, bandwidth, protection,
 * frame size, L1 settings) and per-end customer details (a_end/z_end).
 * `pin_color`/`search_label` restore the map pin when the project is opened.
 * Persisted inside the Project JSONB document via the /api/projects endpoints.
 */
export interface ProjectCircuit {
  circuit_id: string
  label?: string
  order: number
  route_snapshot: Route
  search_label: string
  pin_color: string
  // optional second route for diverse/protected circuits
  protect_route_snapshot?: Route
  protect_search_label?: string
  circuit_description?: string
  service_type?: string
  bandwidth?: string
  protection?: string
  frame_size?: string
  l1_settings?: string
  a_end: EndpointConfig
  z_end: EndpointConfig
  sld_config_override?: Partial<SldConfig>
}

/**
 * A saved customer solution: opportunity metadata (account manager, solution
 * architect, opportunity id/name), visibility, SLD display settings and the
 * list of circuits. The whole object — circuits and route snapshots included —
 * is persisted by the backend as a single JSONB document via the
 * /api/projects endpoints; there are no separate circuit rows. Managed in
 * ProjectsModal; SLD/DrawIO/Visio exports are generated from it by
 * utils/generateDiagram.ts.
 */
export interface Project {
  id: string
  name: string
  account_manager?: string
  solution_architect?: string
  opportunity_id?: string
  opportunity_name?: string
  description?: string
  date_prepared?: string
  visibility: 'public' | 'confidential'
  sld_config: SldConfig
  circuits: ProjectCircuit[]
  created_at?: string
  updated_at?: string
}

/**
 * Structured route-search intent extracted from a natural-language sentence
 * by POST /api/nlp/parse (used by NlpChat). Mirrors RouteRequest field-for-
 * field (nullable where the sentence didn't specify), plus the model's
 * `explanation`, a `confidence` grade, any `ambiguities` it wants the user to
 * resolve, and an optional result `sort_mode`. App.tsx converts this into a
 * RouteRequest and runs the search.
 */
export interface NlpParseResponse {
  start_node_id: string | null
  end_node_id: string | null
  must_include_nodes: string[]
  must_avoid_nodes: string[]
  must_include_segments: string[]
  must_avoid_segments: string[]
  must_include_systems: string[]
  must_avoid_systems: string[]
  must_include_countries: string[]
  must_avoid_countries: string[]
  diversity: DiversityType
  max_wet_hops?: number | null
  max_terrestrial_hops?: number | null
  optimise_for?: string | null
  sort_mode: NlpSortMode | null
  explanation: string
  confidence: 'high' | 'medium' | 'low'
  ambiguities: string[]
}

// ── Technical Enrichment Lookups ─────────────────────────────────────────────

/**
 * One entry of an admin-editable dropdown list (service types, bandwidths,
 * protection modes, ...) served by /api/tech-lookups/{table}. `order`
 * controls dropdown ordering. Managed in RefDataModal, consumed by
 * TechEnrichmentPanel when enriching project circuits.
 */
export interface TechLookupItem {
  id: string
  label: string
  order: number
  description?: string
}

/** The set of lookup table names accepted by the /api/tech-lookups/{table} endpoints. */
export type TechLookupTable =
  | 'tech_service_types'
  | 'tech_bandwidths'
  | 'tech_protections'
  | 'tech_frame_sizes'
  | 'tech_access_types'
  | 'tech_arranged_by'
  | 'tech_l1_settings'

/** Human-readable titles for each tech lookup table, used in admin UI headings. */
export const TECH_LOOKUP_LABELS: Record<TechLookupTable, string> = {
  tech_service_types: 'Service Types',
  tech_bandwidths:    'Bandwidths',
  tech_protections:   'Protection Modes',
  tech_frame_sizes:   'Frame Sizes (MTU)',
  tech_access_types:  'Access Types',
  tech_arranged_by:   'Arranged By',
  tech_l1_settings:   'L1 / Optical Settings',
}

// ── Solution Notes ────────────────────────────────────────────────────────────

/** Severity of a SolutionNote, used for badge colouring (info/warning/critical). */
export type NoteSeverity = 'info' | 'warning' | 'critical'
/** Whether a NoteCategory attaches its notes to nodes or to segments. */
export type NoteAppliesTo = 'node' | 'segment'

/**
 * An engineering/commercial annotation pinned to a node OR a segment
 * (exactly one of node_id/segment_id is set), e.g. "permit required at this
 * CLS". CRUD via /api/solution-notes; surfaced by SolutionNotesOverlay when
 * a route touches the annotated asset.
 */
export interface SolutionNote {
  id: string
  node_id?: string
  segment_id?: string
  category_id: string
  title: string
  text: string
  severity: NoteSeverity
  created_at?: string
}

/**
 * Grouping bucket for solution notes (from /api/note-categories); applies_to
 * says whether its notes attach to nodes or segments, `order` sorts display.
 */
export interface NoteCategory {
  id: string
  label: string
  applies_to: NoteAppliesTo
  order: number
}

/**
 * A user-submitted feature request with a simple kanban status, created from
 * the UserGuide screen via POST /api/feature-requests.
 */
export interface FeatureRequest {
  id: string
  title: string
  description: string
  category: string
  status: 'backlog' | 'in_development' | 'completed'
  created_at: string
}
