import { useEffect, useState } from 'react'
import { Map } from './components/Map'
import { SearchForm } from './components/SearchForm'
import { RouteList } from './components/RouteList'
import { api } from './api/client'
import { ThemeContext, darkTheme, lightTheme } from './theme'
import type { CableNode, CableSegment, Route, RouteRequest, RouteResponse, SegmentCapacity } from './types'

export default function App() {
  const [isDark, setIsDark] = useState(true)
  const theme = isDark ? darkTheme : lightTheme

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
    <ThemeContext.Provider value={theme}>
      <div style={{ display: 'flex', height: '100vh', background: theme.bgBase, color: theme.text, fontFamily: 'system-ui, sans-serif' }}>

        {/* Theme toggle — fixed top-right */}
        <button
          onClick={() => setIsDark(d => !d)}
          title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          style={{
            position: 'fixed', top: 12, right: 12, zIndex: 1000,
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 12px', borderRadius: 20,
            border: `1px solid ${theme.border}`,
            background: theme.bgPanel,
            color: theme.textMuted,
            cursor: 'pointer', fontSize: 12, fontWeight: 600,
            boxShadow: isDark ? '0 2px 8px rgba(0,0,0,0.4)' : '0 2px 8px rgba(0,0,0,0.12)',
            transition: 'all 0.2s',
          }}
        >
          <span style={{ fontSize: 14 }}>{isDark ? '☀️' : '🌙'}</span>
          {isDark ? 'Light' : 'Dark'}
        </button>

        {/* Left panel — inputs */}
        <div style={{
          width: 280, flexShrink: 0, display: 'flex', flexDirection: 'column',
          background: theme.bgPanel, borderRight: `1px solid ${theme.border}`, overflowY: 'auto',
        }}>
          <div style={{ padding: '16px 16px 12px', borderBottom: `1px solid ${theme.border}` }}>
            <h1 style={{ fontSize: 18, fontWeight: 700, color: theme.text, marginBottom: 2 }}>
              RouteBuilder
            </h1>
            <p style={{ fontSize: 11, color: theme.textFaint }}>Telstra International · Subsea Circuit Design</p>
          </div>

          <div style={{ padding: '16px' }}>
            <SearchForm
              nodes={nodes}
              segments={segments}
              onSearch={handleSearch}
              loading={loading}
            />
          </div>

          {error && (
            <div style={{ padding: '0 16px 12px', color: theme.red, fontSize: 13 }}>
              {error}
            </div>
          )}
        </div>

        {/* Middle panel — routes */}
        <div style={{
          width: 420, flexShrink: 0, display: 'flex', flexDirection: 'column',
          background: theme.bgDeep, borderRight: `1px solid ${theme.border}`,
        }}>
          <div style={{
            padding: '12px 16px', borderBottom: `1px solid ${theme.border}`,
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: theme.textFaint, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Routes
            </span>
            {response && (
              <span style={{ fontSize: 11, color: theme.textFaintest }}>
                {response.primary_routes.length + response.diverse_routes.length} found
              </span>
            )}
            {loading && (
              <span style={{ fontSize: 11, color: theme.blue, marginLeft: 'auto' }}>Searching…</span>
            )}
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
            {!response && !loading && (
              <p style={{ color: theme.textFaintest, fontSize: 13, marginTop: 8 }}>
                Configure a route request on the left and press Search.
              </p>
            )}
            {response && (
              <RouteList
                primaryRoutes={response.primary_routes}
                diverseRoutes={response.diverse_routes}
                selectedRouteIds={selectedRouteIds}
                onSelectRoute={toggleRoute}
                nodes={nodes}
                capacity={capacity}
              />
            )}
          </div>
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
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: theme.textFaint }}>
              Loading network…
            </div>
          )}
        </div>

      </div>
    </ThemeContext.Provider>
  )
}
