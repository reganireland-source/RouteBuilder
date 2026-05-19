import { useEffect, useRef, useState } from 'react'
import { Map } from './components/Map'
import { SearchForm } from './components/SearchForm'
import { RouteList } from './components/RouteList'
import { SystemViewer } from './components/SystemViewer'
import { RefDataModal } from './components/RefDataModal'
import { api } from './api/client'
import { ThemeContext, darkTheme, lightTheme, type Theme } from './theme'
import type { CableNode, CableSegment, CableSystem, PinnedRoute, Route, RouteRequest, RouteResponse, SegmentCapacity, SelectedSystem } from './types'

type AppMode = 'routebuilder' | 'systemviewer'

const PIN_COLORS     = ['#f9e2af', '#94e2d5', '#cba6f7', '#f2cdcd', '#eba0ac']
const SYSTEM_COLORS  = ['#89b4fa', '#a6e3a1', '#f9e2af', '#94e2d5', '#cba6f7']

function routeKey(r: Route) { return r.nodes.join('|') }

export default function App() {
  const [isDark, setIsDark] = useState(true)
  const theme = isDark ? darkTheme : lightTheme
  const [refDataOpen, setRefDataOpen] = useState(false)

  const [mode, setMode] = useState<AppMode>('routebuilder')
  const [nodes, setNodes] = useState<CableNode[]>([])
  const [segments, setSegments] = useState<CableSegment[]>([])
  const [systems, setSystems] = useState<CableSystem[]>([])
  const [capacity, setCapacity] = useState<SegmentCapacity[]>([])
  const [response, setResponse] = useState<RouteResponse | null>(null)
  const [selectedRouteIds, setSelectedRouteIds] = useState<string[]>([])
  const [pinnedRoutes, setPinnedRoutes] = useState<PinnedRoute[]>([])
  const [selectedSystems, setSelectedSystems] = useState<SelectedSystem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pinCounter = useRef(0)

  useEffect(() => {
    Promise.all([api.getNodes(), api.getSegments(), api.getCapacity(), api.getSystems()])
      .then(([n, s, c, sys]) => { setNodes(n); setSegments(s); setCapacity(c); setSystems(sys) })
      .catch(() => setError('Failed to load network data'))
  }, [])

  function switchMode(next: AppMode) {
    if (next === 'systemviewer') {
      setResponse(null)
      setSelectedRouteIds([])
      setError(null)
    }
    setMode(next)
  }

  async function handleSearch(req: RouteRequest) {
    setLoading(true)
    setError(null)
    setResponse(null)
    setSelectedRouteIds([])
    try {
      const res = await api.searchRoutes(req)
      setResponse(res)
      const autoSelect = [res.primary_routes[0]?.id, res.diverse_routes[0]?.id].filter(Boolean) as string[]
      setSelectedRouteIds(autoSelect)
    } catch {
      setError('Route search failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  function toggleRoute(id: string) {
    setSelectedRouteIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  function handlePin(route: Route) {
    const key = routeKey(route)
    if (pinnedRoutes.some(p => routeKey(p.route) === key)) {
      setPinnedRoutes(prev => prev.filter(p => routeKey(p.route) !== key))
      return
    }
    if (pinnedRoutes.length >= 5) return
    const usedColors = pinnedRoutes.map(p => p.color)
    const color = PIN_COLORS.find(c => !usedColors.includes(c)) ?? PIN_COLORS[0]
    const nodesById = Object.fromEntries(nodes.map(n => [n.id, n]))
    const searchLabel = `${nodesById[route.nodes[0]]?.name ?? route.nodes[0]} → ${nodesById[route.nodes[route.nodes.length - 1]]?.name ?? route.nodes[route.nodes.length - 1]}`
    pinCounter.current += 1
    setPinnedRoutes(prev => [...prev, { pinId: `pin-${pinCounter.current}`, route, color, searchLabel }])
  }

  function handleUnpin(pinId: string) {
    setPinnedRoutes(prev => prev.filter(p => p.pinId !== pinId))
  }

  function handleToggleSystem(systemId: string) {
    const existing = selectedSystems.find(s => s.systemId === systemId)
    if (existing) {
      setSelectedSystems(prev => prev.filter(s => s.systemId !== systemId))
    } else {
      if (selectedSystems.length >= 5) return
      const usedColors = selectedSystems.map(s => s.color)
      const color = SYSTEM_COLORS.find(c => !usedColors.includes(c)) ?? SYSTEM_COLORS[0]
      setSelectedSystems(prev => [...prev, { systemId, color }])
    }
  }

  function clearSearch() { setResponse(null); setSelectedRouteIds([]); setError(null) }
  function clearAll() { setResponse(null); setSelectedRouteIds([]); setPinnedRoutes([]); setError(null) }

  const selectedRoutes: Route[] = response
    ? [...response.primary_routes, ...response.diverse_routes].filter(r => selectedRouteIds.includes(r.id))
    : []

  const hasPins = pinnedRoutes.length > 0
  const hasResults = response !== null

  const tabStyle = (active: boolean): React.CSSProperties => ({
    flex: 1, padding: '10px 6px', border: 'none', cursor: 'pointer',
    background: active ? theme.bgBase : theme.bgPanel,
    color: active ? theme.text : theme.textFaint,
    fontSize: 11, fontWeight: active ? 700 : 400,
    textTransform: 'uppercase', letterSpacing: '0.05em',
    borderBottom: active ? `2px solid ${theme.blue}` : `2px solid transparent`,
    transition: 'all 0.15s',
  })

  return (
    <ThemeContext.Provider value={theme}>
      <div style={{ display: 'flex', height: '100vh', background: theme.bgBase, color: theme.text, fontFamily: 'system-ui, sans-serif' }}>

        {/* Gear / ref-data button */}
        <button
          onClick={() => setRefDataOpen(true)}
          title="Reference Data Editor"
          style={{
            position: 'fixed', top: 12, right: 130, zIndex: 1000,
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 12px', borderRadius: 20,
            border: `1px solid ${theme.border}`, background: theme.bgPanel, color: theme.textMuted,
            cursor: 'pointer', fontSize: 12, fontWeight: 600,
            boxShadow: isDark ? '0 2px 8px rgba(0,0,0,0.4)' : '0 2px 8px rgba(0,0,0,0.12)',
            transition: 'all 0.2s',
          }}
        >
          <span style={{ fontSize: 14 }}>⚙</span>
          Ref Data
        </button>

        {/* Theme toggle */}
        <button
          onClick={() => setIsDark(d => !d)}
          title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          style={{
            position: 'fixed', top: 12, right: 12, zIndex: 1000,
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 12px', borderRadius: 20,
            border: `1px solid ${theme.border}`, background: theme.bgPanel, color: theme.textMuted,
            cursor: 'pointer', fontSize: 12, fontWeight: 600,
            boxShadow: isDark ? '0 2px 8px rgba(0,0,0,0.4)' : '0 2px 8px rgba(0,0,0,0.12)',
            transition: 'all 0.2s',
          }}
        >
          <span style={{ fontSize: 14 }}>{isDark ? '☀️' : '🌙'}</span>
          {isDark ? 'Light' : 'Dark'}
        </button>

        {/* Left panel */}
        <div style={{
          width: 280, flexShrink: 0, display: 'flex', flexDirection: 'column',
          background: theme.bgPanel, borderRight: `1px solid ${theme.border}`,
        }}>
          {/* App header */}
          <div style={{ padding: '14px 16px 10px', borderBottom: `1px solid ${theme.border}` }}>
            <h1 style={{ fontSize: 18, fontWeight: 700, color: theme.text, marginBottom: 2 }}>RouteBuilder</h1>
            <p style={{ fontSize: 11, color: theme.textFaint }}>Telstra International · Subsea Circuit Design</p>
          </div>

          {/* Mode tabs */}
          <div style={{ display: 'flex', borderBottom: `1px solid ${theme.border}`, flexShrink: 0 }}>
            <button style={tabStyle(mode === 'routebuilder')} onClick={() => switchMode('routebuilder')}>
              ⬡ RouteBuilder
            </button>
            <button style={tabStyle(mode === 'systemviewer')} onClick={() => switchMode('systemviewer')}>
              ◉ System Viewer
            </button>
          </div>

          {/* Panel content */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
            {mode === 'routebuilder' ? (
              <>
                <SearchForm nodes={nodes} segments={segments} onSearch={handleSearch} loading={loading} />
                {error && <div style={{ marginTop: 12, color: theme.red, fontSize: 13 }}>{error}</div>}
              </>
            ) : (
              <SystemViewer
                systems={systems}
                selected={selectedSystems}
                onToggle={handleToggleSystem}
              />
            )}
          </div>
        </div>

        {/* Middle panel — routes */}
        <div style={{
          width: 420, flexShrink: 0, display: 'flex', flexDirection: 'column',
          background: theme.bgDeep, borderRight: `1px solid ${theme.border}`,
        }}>
          <div style={{
            padding: '10px 16px', borderBottom: `1px solid ${theme.border}`,
            display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
          }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: theme.textFaint, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Routes
            </span>
            {hasResults && <span style={{ fontSize: 11, color: theme.textFaintest }}>{response!.primary_routes.length + response!.diverse_routes.length} found</span>}
            {hasPins && <span style={{ fontSize: 11, color: theme.textFaintest }}>· {pinnedRoutes.length} pinned</span>}
            {loading && <span style={{ fontSize: 11, color: theme.blue }}>Searching…</span>}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              {hasResults && <button onClick={clearSearch} style={clearBtnStyle(theme)}>Clear Search</button>}
              {(hasResults || hasPins) && <button onClick={clearAll} style={clearBtnStyle(theme, true)}>Clear All</button>}
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
            {mode === 'systemviewer' && !hasPins && (
              <p style={{ color: theme.textFaintest, fontSize: 13, marginTop: 8 }}>
                Select a cable system on the left to highlight it on the map.
              </p>
            )}
            {mode === 'routebuilder' && !hasResults && !loading && !hasPins && (
              <p style={{ color: theme.textFaintest, fontSize: 13, marginTop: 8 }}>
                Configure a route request on the left and press Search.
              </p>
            )}
            <RouteList
              primaryRoutes={response?.primary_routes ?? []}
              diverseRoutes={response?.diverse_routes ?? []}
              selectedRouteIds={selectedRouteIds}
              onSelectRoute={toggleRoute}
              nodes={nodes}
              capacity={capacity}
              pinnedRoutes={pinnedRoutes}
              onPin={handlePin}
              onUnpin={handleUnpin}
            />
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
              pinnedRoutes={pinnedRoutes}
              selectedSystems={selectedSystems}
            />
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: theme.textFaint }}>
              Loading network…
            </div>
          )}
        </div>

      </div>

      {refDataOpen && (
        <RefDataModal
          nodes={nodes}
          segments={segments}
          systems={systems}
          capacity={capacity}
          onDataChange={() =>
            Promise.all([api.getNodes(), api.getSegments(), api.getCapacity(), api.getSystems()])
              .then(([n, s, c, sys]) => { setNodes(n); setSegments(s); setCapacity(c); setSystems(sys) })
          }
          onClose={() => setRefDataOpen(false)}
        />
      )}
    </ThemeContext.Provider>
  )
}

function clearBtnStyle(theme: Theme, destructive = false): React.CSSProperties {
  return {
    padding: '4px 10px', borderRadius: 4, border: `1px solid ${theme.border}`,
    background: 'transparent', color: destructive ? theme.red : theme.textMuted,
    cursor: 'pointer', fontSize: 11, fontWeight: 600,
  }
}
