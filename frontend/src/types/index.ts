export type NodeType = 'landing_station' | 'terrestrial_pop' | 'branching_unit'
export type SegmentType = 'wet' | 'terrestrial'
export type Ownership = 'owned' | 'iru' | 'consortium' | 'integrated_lit_lease' | 'offnet_resell'
export type DiversityType = 'none' | 'terrestrial_origin' | 'terrestrial_destination' | 'terrestrial_both' | 'wet' | 'full' | 'full_nodes'
export type AppMode = 'routebuilder' | 'systemviewer' | 'nodefinder' | 'citypair' | 'countryviewer'

export interface AppConfig {
  on_net_ownership: string[]
}

export type PortSpeed = '1G' | '10G' | '100G' | '400G'

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

export interface CableNode {
  id: string
  name: string
  lat: number
  lng: number
  type: NodeType
  country: string
  owner?: string
  trading_name?: string
  description?: string
  capabilities?: NodeCapabilities
}

export interface CableSystem {
  id: string
  name: string
  description: string
  margin?: number
}

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
}

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

export interface RouteResponse {
  routes: Route[]
  primary_routes: Route[]
  diverse_routes: Route[]
  total_found: number
}

export interface SegmentCapacity {
  segment_id: string
  total_capacity_t: number
  available_capacity_t: number
}

export interface SegmentOutage {
  segment_id: string
  fault_id: string
  fault_date: string
  repair_start?: string | null
  estimated_repair_date?: string | null
  description: string
}

export interface DisallowedPair {
  system_a: string
  system_b: string
  reason: string
}

export interface AllowedPair {
  system_a: string
  system_b: string
  reason: string
}

export interface InterconnectRule {
  node_id: string
  disallowed_pairs: DisallowedPair[]
  allowed_pairs: AllowedPair[]
}

export interface SelectedSystem {
  systemId: string
  color: string
}

export interface PinnedRoute {
  pinId: string
  route: Route
  color: string
  searchLabel: string
  projectId?: string
  circuitId?: string
  circuitLabel?: string
}

export interface CityInfo {
  name: string
  node_ids: string[]
  country: string
}

export interface CityPairIntermediateNode {
  node_id: string
  name: string
}

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

export interface CityPairResponse {
  origin_city: string
  destination_city: string
  routes: CityPairRoute[]
}

export type NlpSortMode =
  | 'hops'                             // hop count
  | 'distance' | 'length'             // total km (length is alias)
  | 'latency'                          // round-trip delay
  | 'availability' | 'reliability'     // end-to-end availability
  | 'margin' | 'cost'                  // route margin
  | 'capacity'                         // available capacity
  | 'ownership'                        // on-net ownership
  | 'outages'                          // push outage routes down

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

export interface InterfaceType {
  id: string
  name: string
  description?: string
}

// ── Customer Solution Projects ────────────────────────────────────────────────

export interface SldConfig {
  show_latency: boolean
  show_segment_latency: boolean
  show_distance: boolean
  show_ownership: boolean
  show_reliability: boolean
  show_rtd: boolean
}

export const DEFAULT_SLD_CONFIG: SldConfig = {
  show_latency: true,
  show_segment_latency: true,
  show_distance: true,
  show_ownership: true,
  show_reliability: false,
  show_rtd: true,
}

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
  service_type?: string
  bandwidth?: string
  protection?: string
  frame_size?: string
  l1_settings?: string
  a_end: EndpointConfig
  z_end: EndpointConfig
  sld_config_override?: Partial<SldConfig>
}

export interface Project {
  id: string
  name: string
  customer_name?: string
  account_manager?: string
  solution_architect?: string
  opportunity_id?: string
  opportunity_name?: string
  date_prepared?: string
  visibility: 'public' | 'confidential'
  sld_config: SldConfig
  circuits: ProjectCircuit[]
  created_at?: string
  updated_at?: string
}

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
