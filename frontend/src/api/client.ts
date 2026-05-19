import type { CableNode, CableSegment, CableSystem, RouteRequest, RouteResponse } from '../types'

const BASE_URL = import.meta.env.VITE_API_URL ?? ''

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`)
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`)
  return res.json()
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`POST ${path} failed: ${res.status}`)
  return res.json()
}

export const api = {
  getNodes: () => get<CableNode[]>('/api/nodes'),
  getSegments: () => get<CableSegment[]>('/api/segments'),
  getSystems: () => get<CableSystem[]>('/api/systems'),
  searchRoutes: (req: RouteRequest) => post<RouteResponse>('/api/routes', req),
}
