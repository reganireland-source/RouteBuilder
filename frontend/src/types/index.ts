export type NodeType = 'cls' | 'pop'
export type SegmentType = 'wet' | 'terrestrial'
export type Ownership = 'owned' | 'iru' | 'consortium'
export type DiversityType = 'none' | 'wet' | 'terrestrial' | 'full'

export interface CableNode {
  id: string
  name: string
  lat: number
  lng: number
  type: NodeType
  country: string
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
}

export interface Route {
  id: string
  nodes: string[]
  segments: RouteSegmentDetail[]
  total_cost: number
  total_length_km: number
  end_to_end_reliability: number
  diversity_group: number
}

export interface RouteRequest {
  start_node_id: string
  end_node_id: string
  must_include_nodes: string[]
  must_avoid_nodes: string[]
  must_avoid_segments: string[]
  diversity: DiversityType
}

export interface RouteResponse {
  routes: Route[]
  primary_routes: Route[]
  diverse_routes: Route[]
}
