import { useEffect, useRef, useState } from 'react'
import { Map } from './components/Map'
import { SearchForm } from './components/SearchForm'
import { RouteList } from './components/RouteList'
import { SystemViewer } from './components/SystemViewer'
import { RefDataModal } from './components/RefDataModal'
import { NodeInfoPanel } from './components/NodeInfoPanel'
import { NodeFinder } from './components/NodeFinder'
import { CityPairPanel } from './components/CityPairPanel'
import { HealthBar } from './components/HealthBar'
import { MobileLayout } from './components/MobileLayout'
import { generateStraightLineDiagram } from './utils/generateDiagram'
import { api } from './api/client'
import { ThemeContext, darkTheme, duskTheme, lightTheme, type Theme, type ThemeMode } from './theme'
import type { AppConfig, AppMode, CableNode, CableSegment, CableSystem, InterconnectRule, PinnedRoute, Route, RouteRequest, RouteResponse, SegmentCapacity, SelectedSystem } from './types'

const PIN_COLORS    = ['#f9e2af', '#94e2d5', '#cba6f7', '#f2cdcd', '#eba0ac']
const SYSTEM_COLORS = ['#89b4fa', '#a6e3a1', '#f9e2af', '#94e2d5', '#cba6f7']

function routeKey(r: Route) { return r.nodes.join('|') }

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768)
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])
  return isMobile
}

export default function App() {
  const isMobile = useIsMobile()

  const [themeMode, setThemeMode] = useState<ThemeMode>('dusk')
  const theme = themeMode === 'dark' ? darkTheme : themeMode === 'dusk' ? duskTheme : lightTheme
  function cycleTheme() { setThemeMode(m => m === 'dark' ? 'dusk' : m === 'dusk' ? 'light' : 'dark') }

  const [refDataOpen, setRefDataOpen] = useState(false)
  const [mode, setMode]               = useState<AppMode>('routebuilder')
  const [nodes, setNodes]             = useState<CableNode[]>([])
  const [segments, setSegments]       = useState<CableSegment[]>([])
  const [systems, setSystems]         = useState<CableSystem[]>([])
  const [capacity, setCapacity]       = useState<SegmentCapacity[]>([])
  const [rules, setRules]             = useState<InterconnectRule[]>([])
  const [config, setConfig]           = useState<AppConfig>({ on_net_ownership: ['owned', 'consortium', 'iru'] })
  const [response, setResponse]       = useState<RouteResponse | null>(null)
  const [selectedRouteIds, setSelectedRouteIds] = useState<string[]>([])
  const [pinnedRoutes, setPinnedRoutes]         = useState<PinnedRoute[]>([])
  const [selectedSystems, setSelectedSystems]   = useState<SelectedSystem[]>([])
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [lastSearchDiversity, setLastSearchDiversity] = useState<import('./types').DiversityType>('none')
  const [selectedNode, setSelectedNode] = useState<{ node: CableNode; x: number; y: number } | null>(null)
  const [searchPin, setSearchPin]       = useState<{ lat: number; lng: number; label: string } | null>(null)
  const [nearestNodeIds, setNearestNodeIds] = useState<string[]>([])
  const [prefilledOrigin, setPrefilledOrigin] = useState('')
  const [prefilledDest, setPrefilledDest]     = useState('')
  const pinCounter = useRef(0)

  useEffect(() => {
    Promise.all([api.getNodes(), api.getSegments(), api.getCapacity(), api.getSystems(), api.getRules(), api.getConfig()])
      .then(([n, s, c, sys, r, cfg]) => { setNodes(n); setSegments(s); setCapacity(c); setSystems(sys); setRules(r); setConfig(cfg) })
      .catch(() => setError('Failed to load network data'))
  }, [])

  function switchMode(next: AppMode) {
    if (next === 'systemviewer') { setResponse(null); setSelectedRouteIds([]); setError(null) }
    setMode(next)
  }

  async function handleSearch(req: RouteRequest) {
    setLoading(true)
    setError(null)
    setResponse(null)
    setSelectedRouteIds([])
    setLastSearchDiversity(req.diversity)
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

  function handleSetOrigin(nodeId: string) { setPrefilledOrigin(nodeId); switchMode('routebuilder') }
  function handleSetDest(nodeId: string)   { setPrefilledDest(nodeId);   switchMode('routebuilder') }
  function handleSetPair(originId: string, destId: string) {
    setPrefilledOrigin(originId); setPrefilledDest(destId); switchMode('routebuilder')
  }
  function handlePinChange(pin: { lat: number; lng: number; label: string } | null, ids: string[]) {
    setSearchPin(pin); setNearestNodeIds(ids)
  }

  function clearSearch() { setResponse(null); setSelectedRouteIds([]); setError(null); setLastSearchDiversity('none') }
  function clearAll()    { setResponse(null); setSelectedRouteIds([]); setPinnedRoutes([]); setError(null); setLastSearchDiversity('none') }

  async function handleDataChange() {
    const [n, s, c, sys, r, cfg] = await Promise.all([api.getNodes(), api.getSegments(), api.getCapacity(), api.getSystems(), api.getRules(), api.getConfig()])
    setNodes(n); setSegments(s); setCapacity(c); setSystems(sys); setRules(r); setConfig(cfg)
  }

  const selectedRoutes: Route[] = response
    ? [...response.primary_routes, ...response.diverse_routes].filter(r => selectedRouteIds.includes(r.id))
    : []

  const hasPins    = pinnedRoutes.length > 0
  const hasResults = response !== null

  // ── Mobile layout ────────────────────────────────────────────────────────
  if (isMobile) {
    return (
      <ThemeContext.Provider value={theme}>
        <MobileLayout
          nodes={nodes} segments={segments} systems={systems}
          capacity={capacity} rules={rules}
          response={response} selectedRoutes={selectedRoutes}
          selectedRouteIds={selectedRouteIds} pinnedRoutes={pinnedRoutes}
          selectedSystems={selectedSystems}
          mode={mode} loading={loading} error={error}
          selectedNode={selectedNode} searchPin={searchPin}
          nearestNodeIds={nearestNodeIds}
          prefilledOrigin={prefilledOrigin} prefilledDest={prefilledDest}
          lastSearchDiversity={lastSearchDiversity}
          refDataOpen={refDataOpen} themeMode={themeMode}
          onSearch={handleSearch}
          onToggleRoute={toggleRoute}
          onPin={handlePin}
          onUnpin={handleUnpin}
          onToggleSystem={handleToggleSystem}
          onSetOrigin={handleSetOrigin}
          onSetDest={handleSetDest}
          onNodeClick={(node, x, y) => setSelectedNode({ node, x, y })}
          onPinChange={handlePinChange}
          onCloseNode={() => setSelectedNode(null)}
          onOpenRefData={() => setRefDataOpen(true)}
          onCloseRefData={() => setRefDataOpen(false)}
          onDataChange={handleDataChange}
          config={config}
          switchMode={switchMode}
          clearSearch={clearSearch}
          clearAll={clearAll}
          cycleTheme={cycleTheme}
        />
      </ThemeContext.Provider>
    )
  }

  // ── Desktop layout ───────────────────────────────────────────────────────
  const tabStyle = (active: boolean): React.CSSProperties => ({
    flex: 1, padding: '8px 4px', border: 'none', cursor: 'pointer',
    background: active ? theme.bgBase : theme.bgPanel,
    color: active ? theme.text : theme.textFaint,
    fontSize: 10, fontWeight: active ? 700 : 400,
    textTransform: 'uppercase', letterSpacing: '0.05em',
    borderBottom: active ? `2px solid ${theme.blue}` : `2px solid transparent`,
    transition: 'all 0.15s',
  })

  return (
    <ThemeContext.Provider value={theme}>
      <div style={{ display: 'flex', height: '100vh', background: theme.bgBase, color: theme.text, fontFamily: 'system-ui, sans-serif' }}>

        {/* Ref data button */}
        <button
          onClick={() => setRefDataOpen(true)}
          title="Reference Data Editor"
          style={{
            position: 'fixed', top: 12, right: 130, zIndex: 1000,
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 12px', borderRadius: 20,
            border: `1px solid ${theme.border}`, background: theme.bgPanel, color: theme.textMuted,
            cursor: 'pointer', fontSize: 12, fontWeight: 600,
            boxShadow: themeMode === 'light' ? '0 2px 8px rgba(0,0,0,0.12)' : '0 2px 8px rgba(0,0,0,0.4)',
            transition: 'all 0.2s',
          }}
        >
          <span style={{ fontSize: 14 }}>⚙</span>
          Ref Data
        </button>

        {/* Theme toggle */}
        <button
          onClick={cycleTheme}
          title="Cycle theme"
          style={{
            position: 'fixed', top: 12, right: 12, zIndex: 1000,
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 12px', borderRadius: 20,
            border: `1px solid ${theme.border}`, background: theme.bgPanel, color: theme.textMuted,
            cursor: 'pointer', fontSize: 12, fontWeight: 600,
            boxShadow: themeMode === 'light' ? '0 2px 8px rgba(0,0,0,0.12)' : '0 2px 8px rgba(0,0,0,0.4)',
            transition: 'all 0.2s',
          }}
        >
          <span style={{ fontSize: 14 }}>
            {themeMode === 'dark' ? '🌅' : themeMode === 'dusk' ? '☀️' : '🌙'}
          </span>
          {themeMode === 'dark' ? 'Dusk' : themeMode === 'dusk' ? 'Light' : 'Dark'}
        </button>

        {/* Left panel */}
        <div style={{
          width: 280, flexShrink: 0, display: 'flex', flexDirection: 'column',
          background: theme.bgPanel, borderRight: `1px solid ${theme.border}`,
        }}>
          <div style={{ padding: '14px 16px 10px', borderBottom: `1px solid ${theme.border}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 2 }}>
              <img src="/favicon.svg" alt="" style={{ width: 28, height: 28, flexShrink: 0 }} />
              <h1 style={{ fontSize: 18, fontWeight: 700, color: theme.text }}>RouteBuilder</h1>
            </div>
            <p style={{ fontSize: 11, color: theme.textFaint }}>Telstra International · Subsea Circuit Design</p>
          </div>

          <div style={{ display: 'flex', borderBottom: `1px solid ${theme.border}`, flexShrink: 0 }}>
            <button style={tabStyle(mode === 'routebuilder')} onClick={() => switchMode('routebuilder')}>⬡ Routes</button>
            <button style={tabStyle(mode === 'citypair')}     onClick={() => switchMode('citypair')}>⚓ City Pair</button>
            <button style={tabStyle(mode === 'systemviewer')} onClick={() => switchMode('systemviewer')}>◉ Systems</button>
            <button style={tabStyle(mode === 'nodefinder')}   onClick={() => switchMode('nodefinder')}>◎ Node Finder</button>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
            {mode === 'routebuilder' && (
              <>
                <SearchForm nodes={nodes} segments={segments} onSearch={handleSearch} loading={loading} prefilledOrigin={prefilledOrigin} prefilledDest={prefilledDest} />
                {error && <div style={{ marginTop: 12, color: theme.red, fontSize: 13 }}>{error}</div>}
              </>
            )}
            {mode === 'citypair' && (
              <CityPairPanel nodes={nodes} systems={systems} onPlanRoute={handleSetPair} />
            )}
            {mode === 'systemviewer' && (
              <SystemViewer systems={systems} selected={selectedSystems} onToggle={handleToggleSystem} />
            )}
            {mode === 'nodefinder' && (
              <NodeFinder
                nodes={nodes}
                onPinChange={handlePinChange}
                onSetOrigin={handleSetOrigin}
                onSetDest={handleSetDest}
              />
            )}
          </div>
          <HealthBar dataLoaded={nodes.length > 0} />
        </div>

        {/* Middle panel */}
        <div style={{
          width: 420, flexShrink: 0, display: 'flex', flexDirection: 'column',
          background: theme.bgDeep, borderRight: `1px solid ${theme.border}`,
        }}>
          <div style={{
            padding: '10px 16px', borderBottom: `1px solid ${theme.border}`,
            display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
          }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: theme.textFaint, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Routes</span>
            {hasResults && <span style={{ fontSize: 11, color: theme.textFaintest }}>{response!.primary_routes.length + response!.diverse_routes.length} found</span>}
            {hasPins    && <span style={{ fontSize: 11, color: theme.textFaintest }}>· {pinnedRoutes.length} pinned</span>}
            {loading    && <span style={{ fontSize: 11, color: theme.blue }}>Searching…</span>}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              {hasPins    && <button onClick={() => generateStraightLineDiagram(pinnedRoutes, nodes)} title="Export SLD" style={clearBtnStyle(theme)}>⬡ SLD</button>}
              {hasResults && <button onClick={clearSearch} style={clearBtnStyle(theme)}>Clear Search</button>}
              {(hasResults || hasPins) && <button onClick={clearAll} style={clearBtnStyle(theme, true)}>Clear All</button>}
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
            {mode === 'systemviewer' && !hasPins && (
              <p style={{ color: theme.textFaintest, fontSize: 13, marginTop: 8 }}>Select a cable system on the left to highlight it on the map.</p>
            )}
            {(mode === 'routebuilder' || mode === 'citypair') && !hasResults && !loading && !hasPins && (
              <p style={{ color: theme.textFaintest, fontSize: 13, marginTop: 8 }}>
                {mode === 'citypair'
                  ? 'Select a city pair on the left to find subsea system itineraries. Use Plan Route to open a full route search.'
                  : 'Configure a route request on the left and press Search.'}
              </p>
            )}
            <RouteList
              primaryRoutes={response?.primary_routes ?? []}
              diverseRoutes={response?.diverse_routes ?? []}
              selectedRouteIds={selectedRouteIds}
              onSelectRoute={toggleRoute}
              nodes={nodes} capacity={capacity}
              pinnedRoutes={pinnedRoutes}
              onPin={handlePin} onUnpin={handleUnpin}
              diversityRequested={lastSearchDiversity !== 'none'}
              onNetOwnership={config.on_net_ownership}
            />
          </div>
        </div>

        {/* Map */}
        <div style={{ flex: 1, position: 'relative' }}>
          {nodes.length > 0 ? (
            <Map
              nodes={nodes} segments={segments} selectedRoutes={selectedRoutes}
              capacity={capacity} pinnedRoutes={pinnedRoutes} selectedSystems={selectedSystems}
              onNodeClick={(node, x, y) => setSelectedNode({ node, x, y })}
              searchPin={searchPin ?? undefined}
              nearestNodeIds={nearestNodeIds}
            />
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: theme.textFaint }}>
              Loading network…
            </div>
          )}
        </div>

      </div>

      {selectedNode && (
        <NodeInfoPanel
          node={selectedNode.node} segments={segments} systems={systems}
          initialX={selectedNode.x} initialY={selectedNode.y}
          onClose={() => setSelectedNode(null)}
        />
      )}

      {refDataOpen && (
        <RefDataModal
          nodes={nodes} segments={segments} systems={systems}
          capacity={capacity} rules={rules} config={config}
          onDataChange={handleDataChange}
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
