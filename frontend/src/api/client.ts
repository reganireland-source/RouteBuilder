import type { AppConfig, CableNode, CableSegment, CableSystem, CityInfo, CityPairResponse, InterconnectRule, RouteRequest, RouteResponse, SegmentCapacity, SegmentOutage } from '../types'

const BASE_URL = import.meta.env.VITE_API_URL ?? ''

if (import.meta.env.PROD && !import.meta.env.VITE_API_URL) {
  console.error(
    '[RouteBuilder] VITE_API_URL is not set. ' +
    'Add it as a build-time environment variable in the Vercel dashboard ' +
    'pointing to your Railway backend URL (e.g. https://your-app.up.railway.app). ' +
    'All API calls will fail until this is configured.'
  )
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`)
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`)
  return res.json()
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`POST ${path} failed: ${res.status}`)
  return res.json()
}

async function put<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`PUT ${path} failed: ${res.status}`)
  return res.json()
}

async function del(path: string): Promise<void> {
  const res = await fetch(`${BASE_URL}${path}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`DELETE ${path} failed: ${res.status}`)
}

export const api = {
  // Reads
  getNodes:     () => get<CableNode[]>('/api/nodes'),
  getSegments:  () => get<CableSegment[]>('/api/segments'),
  getSystems:   () => get<CableSystem[]>('/api/systems'),
  getCapacity:  () => get<SegmentCapacity[]>('/api/capacity'),
  searchRoutes: (req: RouteRequest) => post<RouteResponse>('/api/routes', req),

  // Nodes
  createNode:   (data: CableNode)                          => post<CableNode>('/api/nodes', data),
  updateNode:   (id: string, data: Partial<CableNode>)     => put<CableNode>(`/api/nodes/${id}`, data),
  deleteNode:   (id: string)                               => del(`/api/nodes/${id}`),

  // Segments
  createSegment:  (data: CableSegment)                       => post<CableSegment>('/api/segments', data),
  updateSegment:  (id: string, data: Partial<CableSegment>)  => put<CableSegment>(`/api/segments/${id}`, data),
  deleteSegment:  (id: string)                               => del(`/api/segments/${id}`),

  // Systems
  createSystem:   (data: CableSystem)                        => post<CableSystem>('/api/systems', data),
  updateSystem:   (id: string, data: Partial<CableSystem>)   => put<CableSystem>(`/api/systems/${id}`, data),
  deleteSystem:   (id: string)                               => del(`/api/systems/${id}`),

  // Capacity
  createCapacity: (data: SegmentCapacity)                           => post<SegmentCapacity>('/api/capacity', data),
  updateCapacity: (segId: string, data: Partial<SegmentCapacity>)   => put<SegmentCapacity>(`/api/capacity/${segId}`, data),
  deleteCapacity: (segId: string)                                   => del(`/api/capacity/${segId}`),

  // Outages
  getOutages:     ()                                                   => get<SegmentOutage[]>('/api/outages'),
  createOutage:   (data: SegmentOutage)                                => post<SegmentOutage>('/api/outages', data),
  updateOutage:   (segId: string, data: Partial<SegmentOutage>)        => put<SegmentOutage>(`/api/outages/${segId}`, data),
  deleteOutage:   (segId: string)                                      => del(`/api/outages/${segId}`),

  // Config
  getConfig:    ()                    => get<AppConfig>('/api/config'),
  updateConfig: (data: AppConfig)     => put<AppConfig>('/api/config', data),

  // Health
  getHealth:  () => get<{ status: string; nodes: number; segments: number; systems: number }>('/api/health'),
  getChecks:  () => get<{ all_passed: boolean; error_count: number; warning_count: number; checks: { name: string; passed: boolean; severity: string; message: string }[] }>('/api/health/checks'),

  // City Pair
  getCities:        ()                                                   => get<CityInfo[]>('/api/city-pairs/cities'),
  searchCityPairs:  (origin: string, dest: string, max?: number)         => post<CityPairResponse>('/api/city-pairs/search', { origin_city: origin, destination_city: dest, max_results: max ?? 15 }),

  // Rules
  getRules:     ()                                                  => get<InterconnectRule[]>('/api/rules'),
  createRule:   (data: InterconnectRule)                            => post<InterconnectRule>('/api/rules', data),
  updateRule:   (nodeId: string, data: Partial<InterconnectRule>)   => put<InterconnectRule>(`/api/rules/${nodeId}`, data),
  deleteRule:   (nodeId: string)                                    => del(`/api/rules/${nodeId}`),
}
