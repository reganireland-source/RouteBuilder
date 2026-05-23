import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Map } from './components/Map'
import { SearchForm } from './components/SearchForm'
import { RouteList } from './components/RouteList'
import type { SortKey } from './components/RouteList'
import { SystemViewer } from './components/SystemViewer'
import { RefDataModal } from './components/RefDataModal'
import { NodeInfoPanel } from './components/NodeInfoPanel'
import { NodeFinder } from './components/NodeFinder'
import { CityPairPanel } from './components/CityPairPanel'
import { HealthBar } from './components/HealthBar'
import { MobileLayout } from './components/MobileLayout'
import { CapacityDashboard } from './components/CapacityDashboard'
import { generateStraightLineDiagram } from './utils/generateDiagram'
import { api } from './api/client'
import { ThemeContext, darkTheme, duskTheme, lightTheme, type Theme, type ThemeMode } from './theme'
import type { AppConfig, AppMode, CableNode, CableSegment, CableSystem, InterconnectRule, NlpSortMode, PinnedRoute, Route, RouteRequest, RouteResponse, SegmentCapacity, SegmentOutage, SelectedSystem } from './types'

const NLP_ENABLED = import.meta.env.VITE_ENABLE_NLP !== 'false'
const NlpChat = NLP_ENABLED
  ? lazy(() => import('./components/NlpChat'))
  : null

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
  const [outages, setOutages]                       = useState<SegmentOutage[]>([])
  const [capDashOpen, setCapDashOpen]               = useState(false)
  const [hideNonActive, setHideNonActive]           = useState(false)
  const [showSegmentLabels, setShowSegmentLabels]   = useState(false)
  const [showAllOutages, setShowAllOutages]         = useState(false)
  const [nlpSortKey, setNlpSortKey]                 = useState<SortKey | undefined>(undefined)
  const [nlpPushOutages, setNlpPushOutages]         = useState<boolean | undefined>(undefined)
  const pinCounter = useRef(0)

  const NLP_SORT_MAP: Record<NlpSortMode, SortKey | null> = {
    cost:        'cost',
    length:      'hops',
    latency:     'latency',
    reliability: 'availability',
    outages:     null,
  }
  function handleApplySort(mode: NlpSortMode) {
    if (mode === 'outages') {
      setNlpPushOutages(true)
    } else {
      const key = NLP_SORT_MAP[mode]
      if (key) setNlpSortKey(key)
    }
  }

  useEffect(() => {
    Promise.all([api.getNodes(), api.getSegments(), api.getCapacity(), api.getSystems(), api.getRules(), api.getConfig(), api.getOutages()])
      .then(([n, s, c, sys, r, cfg, o]) => { setNodes(n); setSegments(s); setCapacity(c); setSystems(sys); setRules(r); setConfig(cfg); setOutages(o) })
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
    const [n, s, c, sys, r, cfg, o] = await Promise.all([api.getNodes(), api.getSegments(), api.getCapacity(), api.getSystems(), api.getRules(), api.getConfig(), api.getOutages()])
    setNodes(n); setSegments(s); setCapacity(c); setSystems(sys); setRules(r); setConfig(cfg); setOutages(o)
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
          capacity={capacity} outages={outages} rules={rules}
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
          onSetPair={handleSetPair}
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
          hideNonActive={hideNonActive}
          onToggleHideNonActive={() => setHideNonActive(v => !v)}
          showSegmentLabels={showSegmentLabels}
          onToggleShowSegmentLabels={() => setShowSegmentLabels(v => !v)}
          showAllOutages={showAllOutages}
          onToggleShowAllOutages={() => setShowAllOutages(v => !v)}
          onApplySort={handleApplySort}
          nlpSortKey={nlpSortKey}
          nlpPushOutages={nlpPushOutages}
        />
      </ThemeContext.Provider>
    )
  }

  // ── Desktop layout ───────────────────────────────────────────────────────
  const tabStyle = (active: boolean): React.CSSProperties => ({
    flex: 1, padding: '6px 4px', border: 'none', cursor: 'pointer',
    background: active ? theme.bgBase : theme.bgPanel,
    color: active ? theme.text : theme.textFaint,
    fontSize: 10, fontWeight: active ? 700 : 400,
    textTransform: 'uppercase', letterSpacing: '0.04em',
    lineHeight: 1.25,
    borderBottom: active ? `2px solid ${theme.blue}` : `2px solid transparent`,
    transition: 'all 0.15s',
  })

  return (
    <ThemeContext.Provider value={theme}>
      <div style={{ display: 'flex', height: '100vh', background: theme.bgBase, color: theme.text, fontFamily: 'system-ui, sans-serif' }}>

        {/* Top-right control bar */}
        <div style={{
          position: 'fixed', top: 12, right: 12, zIndex: 1000,
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          {/* Capacity dashboard */}
          <button
            onClick={() => setCapDashOpen(true)}
            title="Network Capacity Dashboard"
            style={topBtn(theme, themeMode)}
          >
            <span style={{ fontSize: 13 }}>📊</span>
            Capacity
          </button>

          {/* Show all outages toggle */}
          <button
            onClick={() => setShowAllOutages(v => !v)}
            title="Show All Outages"
            style={topBtn(theme, themeMode, showAllOutages ? theme.red : undefined)}
          >
            <span style={{ fontSize: 13 }}>🚢</span>
            {showAllOutages ? 'Outage Map' : 'Outages'}
          </button>

          {/* Hide non-active cables toggle */}
          <button
            onClick={() => setHideNonActive(v => !v)}
            title="Hide Non-Active Cables"
            style={topBtn(theme, themeMode, hideNonActive ? theme.blue : undefined)}
          >
            <span style={{ fontSize: 13 }}>{hideNonActive ? '◉' : '◎'}</span>
            Hide Inactive
          </button>

          {/* Segment labels toggle */}
          <button
            onClick={() => setShowSegmentLabels(v => !v)}
            title="Toggle Segment Labels"
            style={topBtn(theme, themeMode, showSegmentLabels ? theme.blue : undefined)}
          >
            <span style={{ fontSize: 13 }}>{showSegmentLabels ? '◉' : '◎'}</span>
            Seg Labels
          </button>

          {/* Ref data button */}
          <button
            onClick={() => setRefDataOpen(true)}
            title="Reference Data Editor"
            style={topBtn(theme, themeMode)}
          >
            <span style={{ fontSize: 14 }}>⚙</span>
            Ref Data
          </button>

          {/* Theme toggle */}
          <button
            onClick={cycleTheme}
            title="Cycle theme"
            style={topBtn(theme, themeMode)}
          >
            <span style={{ fontSize: 14 }}>
              {themeMode === 'dark' ? '🌅' : themeMode === 'dusk' ? '☀️' : '🌙'}
            </span>
            {themeMode === 'dark' ? 'Dusk' : themeMode === 'dusk' ? 'Light' : 'Dark'}
          </button>
        </div>

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
            <button style={tabStyle(mode === 'routebuilder')} onClick={() => switchMode('routebuilder')}>PoP Routes</button>
            <button style={tabStyle(mode === 'citypair')}     onClick={() => switchMode('citypair')}>City Pairs</button>
            <button style={tabStyle(mode === 'systemviewer')} onClick={() => switchMode('systemviewer')}>Cable System</button>
            <button style={tabStyle(mode === 'nodefinder')}   onClick={() => switchMode('nodefinder')}>Node Search</button>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
            {mode === 'routebuilder' && (
              <>
                <SearchForm nodes={nodes} segments={segments} systems={systems} onSearch={handleSearch} loading={loading} prefilledOrigin={prefilledOrigin} prefilledDest={prefilledDest} />
                {error && <div style={{ marginTop: 12, color: theme.red, fontSize: 13 }}>{error}</div>}
              </>
            )}
            {mode === 'citypair' && (
              <CityPairPanel nodes={nodes} segments={segments} systems={systems} onNetOwnership={config.on_net_ownership} onPlanRoute={handleSetPair} />
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
          {NlpChat && (
            <Suspense fallback={null}>
              <NlpChat
                nodes={nodes}
                onSearch={handleSearch}
                onSwitchMode={switchMode}
                onApplySort={handleApplySort}
              />
            </Suspense>
          )}
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
              nodes={nodes} capacity={capacity} outages={outages}
              pinnedRoutes={pinnedRoutes}
              onPin={handlePin} onUnpin={handleUnpin}
              diversityRequested={lastSearchDiversity !== 'none'}
              onNetOwnership={config.on_net_ownership}
              externalSortKey={nlpSortKey}
              externalPushOutagesDown={nlpPushOutages}
            />
          </div>
        </div>

        {/* Map */}
        <div style={{ flex: 1, position: 'relative' }}>
          {nodes.length > 0 ? (
            <Map
              nodes={nodes} segments={segments} selectedRoutes={selectedRoutes}
              capacity={capacity} pinnedRoutes={pinnedRoutes} selectedSystems={selectedSystems}
              outages={outages}
              onNodeClick={(node, x, y) => setSelectedNode({ node, x, y })}
              searchPin={searchPin ?? undefined}
              nearestNodeIds={nearestNodeIds}
              hideNonActive={hideNonActive}
              showSegmentLabels={showSegmentLabels}
              showAllOutages={showAllOutages}
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

      {capDashOpen && (
        <CapacityDashboard
          segments={segments} capacity={capacity}
          onClose={() => setCapDashOpen(false)}
        />
      )}

      {refDataOpen && (
        <RefDataModal
          nodes={nodes} segments={segments} systems={systems}
          capacity={capacity} outages={outages} rules={rules} config={config}
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

function topBtn(theme: Theme, themeMode: ThemeMode, accent?: string): React.CSSProperties {
  return {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '6px 12px', borderRadius: 20,
    border: `1px solid ${accent ? accent + '88' : theme.border}`,
    background: accent ? accent + '22' : theme.bgPanel,
    color: accent ?? theme.textMuted,
    cursor: 'pointer', fontSize: 12, fontWeight: 600,
    boxShadow: themeMode === 'light' ? '0 2px 8px rgba(0,0,0,0.12)' : '0 2px 8px rgba(0,0,0,0.4)',
    transition: 'all 0.2s',
  }
}
