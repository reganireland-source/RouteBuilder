import { useEffect, useState } from 'react'
import { Map } from './components/Map'
import { SearchForm } from './components/SearchForm'
import { RouteList } from './components/RouteList'
import { api } from './api/client'
import type { CableNode, CableSegment, Route, RouteRequest, RouteResponse, SegmentCapacity } from './types'

export default function App() {
  const [nodes, setNodes] = useState<CableNode[]>([])
  const [segments, setSegments] = useState<CableSegment[]>([])
  const [capacity, setCapacity] = useState<SegmentCapacity[]>([])
  const [response, setResponse] = useState<RouteResponse | null>(null)
  const [selectedRouteIds, setSelectedRouteIds] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([api.getNodes(), api.getSegments(), api.getCapacity()])
      .then(([n, s, c]) => { setNodes(n); setSegments(s); setCapacity(c) })
      .catch(() => setError('Failed to load network data'))
  }, [])

  async function handleSearch(req: RouteRequest) {
    setLoading(true)
    setError(null)
    setResponse(null)
    setSelectedRouteIds([])
    try {
      const res = await api.searchRoutes(req)
      setResponse(res)
      // Auto-select the top primary and diverse route
      const autoSelect = [
        res.primary_routes[0]?.id,
        res.diverse_routes[0]?.id,
      ].filter(Boolean) as string[]
      setSelectedRouteIds(autoSelect)
    } catch {
      setError('Route search failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  function toggleRoute(id: string) {
    setSelectedRouteIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }

  const selectedRoutes: Route[] = response
    ? [...response.primary_routes, ...response.diverse_routes].filter(r =>
        selectedRouteIds.includes(r.id)
      )
    : []

  return (
    <div style={{ display: 'flex', height: '100vh', background: '#1e1e2e', color: '#cdd6f4', fontFamily: 'system-ui, sans-serif' }}>
      {/* Sidebar */}
      <div style={{
        width: 320, flexShrink: 0, display: 'flex', flexDirection: 'column',
        background: '#181825', borderRight: '1px solid #313244', overflowY: 'auto',
      }}>
        <div style={{ padding: '16px 16px 12px', borderBottom: '1px solid #313244' }}>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: '#cdd6f4', marginBottom: 2 }}>
            RouteBuilder
          </h1>
          <p style={{ fontSize: 11, color: '#6c7086' }}>Telstra International · Subsea Circuit Design</p>
        </div>

        <div style={{ padding: '16px', borderBottom: '1px solid #313244' }}>
          <SearchForm
            nodes={nodes}
            segments={segments}
            onSearch={handleSearch}
            loading={loading}
          />
        </div>

        {error && (
          <div style={{ padding: '12px 16px', color: '#f38ba8', fontSize: 13 }}>
            {error}
          </div>
        )}

        {response && (
          <div style={{ padding: '16px' }}>
            <RouteList
              primaryRoutes={response.primary_routes}
              diverseRoutes={response.diverse_routes}
              selectedRouteIds={selectedRouteIds}
              onSelectRoute={toggleRoute}
              nodes={nodes}
              capacity={capacity}
            />
          </div>
        )}
      </div>

      {/* Map */}
      <div style={{ flex: 1, position: 'relative' }}>
        {nodes.length > 0 ? (
          <Map
            nodes={nodes}
            segments={segments}
            selectedRoutes={selectedRoutes}
            capacity={capacity}
          />
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#6c7086' }}>
            Loading network...
          </div>
        )}
      </div>
    </div>
  )
}
