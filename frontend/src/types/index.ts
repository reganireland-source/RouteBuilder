export type NodeType = 'landing_station' | 'terrestrial_pop' | 'branching_unit'
export type SegmentType = 'wet' | 'terrestrial'
export type Ownership = 'owned' | 'iru' | 'consortium' | 'integrated_lit_lease' | 'offnet_resell'
export type DiversityType = 'none' | 'terrestrial_origin' | 'terrestrial_destination' | 'terrestrial_both' | 'wet' | 'full' | 'full_nodes'
export type AppMode = 'routebuilder' | 'systemviewer' | 'nodefinder' | 'citypair'

export interface AppConfig {
  on_net_ownership: string[]
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
}

export interface CableSystem {
  id: string
  name: string
  description: string
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
  diversity: DiversityType
}

export interface RouteResponse {
  routes: Route[]
  primary_routes: Route[]
  diverse_routes: Route[]
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
