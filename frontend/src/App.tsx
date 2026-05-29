import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Map } from './components/Map'
import { SearchForm } from './components/SearchForm'
import { RouteList } from './components/RouteList'
import type { SortKey } from './components/RouteList'
import { SystemViewer } from './components/SystemViewer'
import { CountryViewer } from './components/CountryViewer'
import { RefDataModal } from './components/RefDataModal'
import { NodeInfoPanel } from './components/NodeInfoPanel'
import { NodeFinder } from './components/NodeFinder'
import { CityPairPanel } from './components/CityPairPanel'
import { HealthBar } from './components/HealthBar'
import { MobileLayout } from './components/MobileLayout'
import { CapacityDashboard } from './components/CapacityDashboard'
import { UserGuide } from './components/UserGuide'
import { generateStraightLineDiagram } from './utils/generateDiagram'
import { api } from './api/client'
import { ThemeContext, darkTheme, duskTheme, lightTheme, type Theme, type ThemeMode } from './theme'
import type { AppConfig, AppMode, CableNode, CableSegment, CableSystem, CountryHighlight, InterconnectRule, NlpSortMode, PinnedRoute, Route, RouteRequest, RouteResponse, SegmentCapacity, SegmentOutage, SelectedSystem } from './types'
import { ProjectsModal } from './components/ProjectsModal'

const NLP_ENABLED = import.meta.env.VITE_ENABLE_NLP !== 'false'
const NlpChat = NLP_ENABLED
  ? lazy(() => import('./components/NlpChat'))
  : null

const PIN_COLORS    = ['#f9e2af', '#94e2d5', '#cba6f7', '#f2cdcd', '#eba0ac', '#89dceb', '#a6e3a1', '#fab387', '#cdd6f4', '#b4befe']
const MAX_PINS = 10
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

  const [refDataOpen,     setRefDataOpen]     = useState(false)
  const [guideOpen,       setGuideOpen]       = useState(false)
  const [projectsOpen,    setProjectsOpen]    = useState(false)
  const [addToProjectRoute, setAddToProjectRoute] = useState<{ route: Route; protectRoute?: Route; searchLabel: string } | null>(null)
  const [enrichTarget, setEnrichTarget] = useState<{ projectId: string; circuitId: string } | null>(null)
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
  const [lastOptimiseFor, setLastOptimiseFor] = useState<string | undefined>(undefined)
  const [selectedNode, setSelectedNode] = useState<{ node: CableNode; x: number; y: number } | null>(null)
  const [searchPin, setSearchPin]       = useState<{ lat: number; lng: number; label: string } | null>(null)
  const [nearestNodeIds, setNearestNodeIds] = useState<string[]>([])
  const [prefilledOrigin, setPrefilledOrigin] = useState('')
  const [prefilledDest, setPrefilledDest]     = useState('')
  const [searchPrefill, setSearchPrefill]     = useState<Partial<RouteRequest> | undefined>(undefined)
  const [outages, setOutages]                       = useState<SegmentOutage[]>([])
  const [capDashOpen, setCapDashOpen]               = useState(false)
  const [ctrlMenuOpen, setCtrlMenuOpen]             = useState(false)
  const [hideNonActive, setHideNonActive]           = useState(false)
  const [showSegmentLabels, setShowSegmentLabels]   = useState(false)
  const [showAllOutages, setShowAllOutages]         = useState(false)
  const [subseaOnly, setSubseaOnly]                 = useState(false)
  const [backhaulOnly, setBackhaulOnly]             = useState(false)
  const [nlpSortKey, setNlpSortKey]                 = useState<SortKey | undefined>(undefined)
  const [nlpPushOutages, setNlpPushOutages]         = useState<boolean | undefined>(undefined)
  const [countryHighlight, setCountryHighlight]     = useState<CountryHighlight | null>(null)
  const [panelsOpen, setPanelsOpen]                 = useState(true)
  const [flippedPairIds, setFlippedPairIds]         = useState<Set<string>>(new Set())
  const pinCounter = useRef(0)

  const NLP_SORT_MAP: Record<NlpSortMode, SortKey | null> = {
    hops:         'hops',
    distance:     'distance',
    length:       'distance',     // alias: "length" = total km, not hops
    latency:      'latency',
    availability: 'availability',
    reliability:  'availability', // legacy alias
    margin:       'margin',
    cost:         'margin',       // legacy alias
    capacity:     'capacity',
    ownership:    'ownership',
    outages:      null,           // handled separately via pushOutagesDown
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
    if (next !== 'countryviewer') setCountryHighlight(null)
    if (next === 'countryviewer') setShowSegmentLabels(true)
    setMode(next)
  }

  const [searchDuration, setSearchDuration] = useState<number | null>(null)

  async function handleSearch(req: RouteRequest) {
    setLoading(true)
    setError(null)
    setResponse(null)
    setSelectedRouteIds([])
    setFlippedPairIds(new Set())
    setSearchDuration(null)
    setLastSearchDiversity(req.diversity)
    setLastOptimiseFor(req.optimise_for)
    const t0 = performance.now()
    try {
      const res = await api.searchRoutes(req)
      setSearchDuration((performance.now() - t0) / 1000)
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
    if (pinnedRoutes.length >= MAX_PINS) return
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

  function handlePinPair(worker: Route, protect: Route) {
    const wKey = routeKey(worker)
    const pKey = routeKey(protect)
    const wPinned = pinnedRoutes.some(p => routeKey(p.route) === wKey)
    const pPinned = pinnedRoutes.some(p => routeKey(p.route) === pKey)
    if (wPinned && pPinned) {
      setPinnedRoutes(prev => prev.filter(p => routeKey(p.route) !== wKey && routeKey(p.route) !== pKey))
      return
    }
    const remaining = pinnedRoutes.filter(p => routeKey(p.route) !== wKey && routeKey(p.route) !== pKey)
    if (remaining.length + 2 > MAX_PINS) return
    const usedColors = remaining.map(p => p.color)
    const color = PIN_COLORS.find(c => !usedColors.includes(c)) ?? PIN_COLORS[0]
    const nodesById = Object.fromEntries(nodes.map(n => [n.id, n]))
    const wLabel = `${nodesById[worker.nodes[0]]?.name ?? worker.nodes[0]} → ${nodesById[worker.nodes[worker.nodes.length - 1]]?.name ?? worker.nodes[worker.nodes.length - 1]}`
    const pLabel = `${nodesById[protect.nodes[0]]?.name ?? protect.nodes[0]} → ${nodesById[protect.nodes[protect.nodes.length - 1]]?.name ?? protect.nodes[protect.nodes.length - 1]} (Protect)`
    pinCounter.current += 1
    const wId = pinCounter.current
    pinCounter.current += 1
    setPinnedRoutes([...remaining,
      { pinId: `pin-${wId}`,            route: worker,  color, searchLabel: wLabel },
      { pinId: `pin-${pinCounter.current}`, route: protect, color, searchLabel: pLabel },
    ])
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

  function clearSearch() { setResponse(null); setSelectedRouteIds([]); setError(null); setLastSearchDiversity('none'); setSearchDuration(null); setLastOptimiseFor(undefined) }
  function clearAll()    { setResponse(null); setSelectedRouteIds([]); setPinnedRoutes([]); setError(null); setLastSearchDiversity('none'); setSearchDuration(null); setLastOptimiseFor(undefined) }

  async function handleDataChange() {
    const [n, s, c, sys, r, cfg, o] = await Promise.all([api.getNodes(), api.getSegments(), api.getCapacity(), api.getSystems(), api.getRules(), api.getConfig(), api.getOutages()])
    setNodes(n); setSegments(s); setCapacity(c); setSystems(sys); setRules(r); setConfig(cfg); setOutages(o)
  }

  // Build effective route lookup — swaps path data for flipped pairs while keeping original IDs
  const effectiveRouteById = useMemo<Record<string, Route>>(() => {
    if (!response) return {}
    const { primary_routes, diverse_routes } = response
    const isPaired = diverse_routes.length > 0 && diverse_routes.length === primary_routes.length
    const out: Record<string, Route> = {}
    if (isPaired) {
      primary_routes.forEach((primary, i) => {
        const diverse = diverse_routes[i]
        if (flippedPairIds.has(primary.id) && diverse) {
          out[primary.id] = { ...diverse, id: primary.id }
          out[diverse.id]  = { ...primary, id: diverse.id  }
        } else {
          out[primary.id] = primary
          if (diverse) out[diverse.id] = diverse
        }
      })
    } else {
      primary_routes.forEach(r => { out[r.id] = r })
      diverse_routes.forEach(r => { out[r.id] = r })
    }
    return out
  }, [response, flippedPairIds])

  const selectedRoutes: Route[] = selectedRouteIds
    .map(id => effectiveRouteById[id])
    .filter((r): r is Route => r !== undefined)

  function handleFlipPair(pairId: string) {
    setFlippedPairIds(prev => {
      const next = new Set(prev)
      if (next.has(pairId)) next.delete(pairId)
      else next.add(pairId)
      return next
    })
  }

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
          onOpenGuide={() => setGuideOpen(true)}
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
          optimiseFor={lastOptimiseFor}
          flippedPairIds={flippedPairIds}
          onFlipPair={handleFlipPair}
          onPinPair={handlePinPair}
          onAddToProject={(route, protectRoute) => {
            const nodesById = Object.fromEntries(nodes.map(n => [n.id, n]))
            const label = `${nodesById[route.nodes[0]]?.name ?? route.nodes[0]} → ${nodesById[route.nodes[route.nodes.length - 1]]?.name ?? route.nodes[route.nodes.length - 1]}`
            setAddToProjectRoute({ route, protectRoute, searchLabel: label })
            setEnrichTarget(null)
            setProjectsOpen(true)
          }}
          onEnrichCircuit={(pin) => {
            if (!pin.projectId || !pin.circuitId) return
            setAddToProjectRoute(null)
            setEnrichTarget({ projectId: pin.projectId, circuitId: pin.circuitId })
            setProjectsOpen(true)
          }}
          onOpenProjects={() => { setAddToProjectRoute(null); setEnrichTarget(null); setProjectsOpen(true) }}
        />
        {projectsOpen && (
          <ProjectsModal
            nodes={nodes}
            pendingCircuit={addToProjectRoute ?? undefined}
            initialProject={enrichTarget?.projectId ?? null}
            initialCircuitId={enrichTarget?.circuitId ?? null}
            onClose={() => { setProjectsOpen(false); setAddToProjectRoute(null); setEnrichTarget(null) }}
            onRestorePins={(circuits, projectId) => {
              const nodesById = Object.fromEntries(nodes.map(n => [n.id, n]))
              const usedColors = new Set<string>()
              const newPins = circuits.slice(0, MAX_PINS).map((c, i) => {
                const route = c.route_snapshot as unknown as Route
                const color = PIN_COLORS.find(col => !usedColors.has(col)) ?? PIN_COLORS[i % PIN_COLORS.length]
                usedColors.add(color)
                pinCounter.current += 1
                const label = c.label || c.search_label || `${nodesById[route.nodes[0]]?.name ?? route.nodes[0]} → ${nodesById[route.nodes[route.nodes.length - 1]]?.name ?? route.nodes[route.nodes.length - 1]}`
                return { pinId: `pin-${pinCounter.current}`, route, color, searchLabel: label, projectId, circuitId: c.circuit_id, circuitLabel: c.label }
              })
              setPinnedRoutes(newPins)
            }}
            onCircuitAdded={(projectId, circuitId, circuitLabel) => {
              setPinnedRoutes(prev => {
                const route = addToProjectRoute?.route
                if (!route) return prev
                return prev.map(p => routeKey(p.route) === routeKey(route)
                  ? { ...p, projectId, circuitId, circuitLabel }
                  : p
                )
              })
            }}
          />
        )}
        {guideOpen && createPortal(
          <div style={{
            position: 'fixed', inset: 0, zIndex: 2000,
            background: theme.bgBase,
            overflowY: 'auto',
          }}>
            <button
              onClick={() => setGuideOpen(false)}
              style={{
                position: 'fixed', top: 16, right: 20, zIndex: 2001,
                background: theme.bgCard, border: `1px solid ${theme.border}`,
                borderRadius: '50%', width: 36, height: 36,
                fontSize: 18, lineHeight: 1, cursor: 'pointer',
                color: theme.textMuted, display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
              }}
              title="Close guide"
            >×</button>
            <UserGuide nodes={nodes} segments={segments} systems={systems} />
          </div>,
          document.body
        )}
      </ThemeContext.Provider>
    )
  }

  // ── Desktop layout ───────────────────────────────────────────────────────
  const tabStyle = (active: boolean): React.CSSProperties => ({
    flex: 1, padding: '7px 3px 6px', border: 'none', cursor: 'pointer',
    background: active ? theme.bgBase : theme.bgPanel,
    color: active ? theme.text : theme.textFaint,
    fontSize: 9, fontWeight: active ? 700 : 400,
    textTransform: 'uppercase', letterSpacing: '0.04em',
    lineHeight: 1.2,
    borderBottom: active ? `2px solid ${theme.blue}` : `2px solid transparent`,
    transition: 'all 0.15s',
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
  })

  return (
    <ThemeContext.Provider value={theme}>
      <div style={{ display: 'flex', height: '100vh', background: theme.bgBase, color: theme.text, fontFamily: 'system-ui, sans-serif', overflow: 'hidden' }}>

        {/* Top-right control menu */}
        {(() => {
          const activeToggles = [showAllOutages, hideNonActive, showSegmentLabels, subseaOnly, backhaulOnly].filter(Boolean).length
          return (
            <div style={{ position: 'fixed', top: 12, right: 12, zIndex: 1000 }}>
              <button
                onClick={() => setCtrlMenuOpen(o => !o)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 7,
                  padding: '7px 14px', borderRadius: 10,
                  border: `1px solid ${ctrlMenuOpen ? theme.blue : theme.border}`,
                  background: ctrlMenuOpen ? theme.blue + '22' : theme.bgPanel,
                  color: ctrlMenuOpen ? theme.blue : theme.textMuted,
                  cursor: 'pointer', fontSize: 12, fontWeight: 700,
                  boxShadow: themeMode === 'light' ? '0 2px 8px rgba(0,0,0,0.12)' : '0 2px 10px rgba(0,0,0,0.5)',
                }}
              >
                <span style={{ fontSize: 16, lineHeight: 1 }}>{ctrlMenuOpen ? '✕' : '≡'}</span>
                Controls
                {activeToggles > 0 && !ctrlMenuOpen && (
                  <span style={{
                    fontSize: 10, fontWeight: 700, lineHeight: 1,
                    background: theme.blue + '33', color: theme.blue,
                    borderRadius: 10, padding: '2px 6px',
                  }}>{activeToggles}</span>
                )}
              </button>

              {ctrlMenuOpen && (
                <>
                  <div onClick={() => setCtrlMenuOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: -1 }} />
                  <div style={{
                    position: 'absolute', top: 42, right: 0,
                    width: 240,
                    background: theme.bgPanel,
                    border: `1px solid ${theme.border}`,
                    borderRadius: 12,
                    boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
                    overflow: 'hidden',
                  }}>
                    {/* Toggles */}
                    {[
                      { label: 'Show All Outages', icon: '🚢', active: showAllOutages, color: theme.red,  onClick: () => setShowAllOutages(v => !v) },
                      { label: 'Hide Inactive',    icon: hideNonActive      ? '◉' : '◎', active: hideNonActive,      color: theme.blue, onClick: () => setHideNonActive(v => !v) },
                      { label: 'Seg Labels',       icon: showSegmentLabels  ? '◉' : '◎', active: showSegmentLabels,  color: theme.blue, onClick: () => setShowSegmentLabels(v => !v) },
                      { label: 'Subsea Only',      icon: '🌊', active: subseaOnly,   color: theme.blue, onClick: () => { setSubseaOnly(v => !v);   if (!subseaOnly)   setBackhaulOnly(false) } },
                      { label: 'Backhaul Only',    icon: '🗺',  active: backhaulOnly, color: theme.blue, onClick: () => { setBackhaulOnly(v => !v); if (!backhaulOnly) setSubseaOnly(false)  } },
                    ].map(item => (
                      <button
                        key={item.label}
                        onClick={item.onClick}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 12,
                          width: '100%', padding: '12px 16px',
                          background: item.active ? item.color + '18' : 'transparent',
                          border: 'none', borderBottom: `1px solid ${theme.border}`,
                          cursor: 'pointer', textAlign: 'left',
                        }}
                      >
                        <span style={{ fontSize: 16, width: 22, textAlign: 'center' }}>{item.icon}</span>
                        <span style={{ fontSize: 13, color: item.active ? item.color : theme.text, fontWeight: item.active ? 600 : 400, flex: 1 }}>
                          {item.label}
                        </span>
                        {item.active && (
                          <span style={{ fontSize: 10, fontWeight: 700, color: item.color, textTransform: 'uppercase', letterSpacing: '0.05em' }}>On</span>
                        )}
                      </button>
                    ))}

                    {/* Actions */}
                    {[
                      { label: 'Capacity',  icon: '📊', onClick: () => { setCapDashOpen(true);   setCtrlMenuOpen(false) } },
                      { label: 'Projects',  icon: '📁', onClick: () => { setProjectsOpen(true);  setCtrlMenuOpen(false) } },
                      { label: 'Ref Data',  icon: '⚙',  onClick: () => { setRefDataOpen(true);   setCtrlMenuOpen(false) } },
                    ].map(item => (
                      <button
                        key={item.label}
                        onClick={item.onClick}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 12,
                          width: '100%', padding: '12px 16px',
                          background: 'transparent',
                          border: 'none', borderBottom: `1px solid ${theme.border}`,
                          cursor: 'pointer', textAlign: 'left',
                        }}
                      >
                        <span style={{ fontSize: 16, width: 22, textAlign: 'center' }}>{item.icon}</span>
                        <span style={{ fontSize: 13, color: theme.text, flex: 1 }}>{item.label}</span>
                        <span style={{ fontSize: 14, color: theme.textFaintest }}>›</span>
                      </button>
                    ))}

                    {/* Theme */}
                    <button
                      onClick={cycleTheme}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 12,
                        width: '100%', padding: '12px 16px',
                        background: 'transparent', border: 'none',
                        cursor: 'pointer', textAlign: 'left',
                      }}
                    >
                      <span style={{ fontSize: 16, width: 22, textAlign: 'center' }}>
                        {themeMode === 'dark' ? '🌅' : themeMode === 'dusk' ? '☀️' : '🌙'}
                      </span>
                      <span style={{ fontSize: 13, color: theme.text, flex: 1 }}>
                        {themeMode === 'dark' ? 'Switch to Dusk' : themeMode === 'dusk' ? 'Switch to Light' : 'Switch to Dark'}
                      </span>
                    </button>
                  </div>
                </>
              )}
            </div>
          )
        })()}

        {/* Collapsible panels wrapper */}
        <div style={{
          display: 'flex', overflow: 'hidden', flexShrink: 0,
          width: panelsOpen ? 960 : 0,
          transition: 'width 0.3s ease',
        }}>

        {/* Left panel */}
        <div style={{
          width: 440, flexShrink: 0, display: 'flex', flexDirection: 'column',
          background: theme.bgPanel, borderRight: `1px solid ${theme.border}`,
        }}>
          <div style={{ padding: '14px 16px 10px', borderBottom: `1px solid ${theme.border}` }}>
            <div
              onClick={() => setGuideOpen(true)}
              style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 2, cursor: 'pointer' }}
              title="Open platform guide"
            >
              <img src="/favicon.svg" alt="" style={{ width: 28, height: 28, flexShrink: 0 }} />
              <h1 style={{ fontSize: 18, fontWeight: 700, color: theme.text }}>RouteBuilder</h1>
            </div>
            <p style={{ fontSize: 11, color: theme.textFaint }}>International Telco · Subsea Circuit Design</p>
          </div>

          <div style={{ display: 'flex', borderBottom: `1px solid ${theme.border}`, flexShrink: 0 }}>
            <button style={tabStyle(mode === 'routebuilder')}  onClick={() => switchMode('routebuilder')}><span style={{ fontSize: 14 }}>↔</span>Pop Routes</button>
            <button style={tabStyle(mode === 'citypair')}      onClick={() => switchMode('citypair')}><span style={{ fontSize: 14 }}>🏙</span>City Pairs</button>
            <button style={tabStyle(mode === 'systemviewer')}  onClick={() => switchMode('systemviewer')}><span style={{ fontSize: 14 }}>🌊</span>Subsea Systems</button>
            <button style={tabStyle(mode === 'countryviewer')} onClick={() => switchMode('countryviewer')}><span style={{ fontSize: 14 }}>🌍</span>Country Viewer</button>
            <button style={tabStyle(mode === 'nodefinder')}    onClick={() => switchMode('nodefinder')}><span style={{ fontSize: 14 }}>🔍</span>Node Search</button>
            <button style={tabStyle(false)}                    onClick={() => setGuideOpen(true)}><span style={{ fontSize: 14 }}>📖</span>Guide</button>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
            {mode === 'routebuilder' && (
              <>
                {NlpChat && (
                  <Suspense fallback={null}>
                    <NlpChat
                      nodes={nodes}
                      onSearch={handleSearch}
                      onSwitchMode={switchMode}
                      onApplySort={handleApplySort}
                      onPrefill={req => setSearchPrefill({...req})}
                    />
                  </Suspense>
                )}
                <SearchForm nodes={nodes} segments={segments} systems={systems} onSearch={handleSearch} loading={loading} prefilledOrigin={prefilledOrigin} prefilledDest={prefilledDest} prefill={searchPrefill} />
                {error && <div style={{ marginTop: 12, color: theme.red, fontSize: 13 }}>{error}</div>}
              </>
            )}
            {mode === 'citypair' && (
              <CityPairPanel nodes={nodes} segments={segments} systems={systems} onNetOwnership={config.on_net_ownership} onPlanRoute={handleSetPair} />
            )}
            {mode === 'systemviewer' && (
              <SystemViewer systems={systems} selected={selectedSystems} onToggle={handleToggleSystem} />
            )}
            {mode === 'countryviewer' && (
              <CountryViewer
                nodes={nodes} segments={segments} systems={systems}
                onSelect={setCountryHighlight}
              />
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
          width: 520, flexShrink: 0, display: 'flex', flexDirection: 'column',
          background: theme.bgDeep, borderRight: `1px solid ${theme.border}`,
        }}>
          <div style={{
            padding: '10px 16px', borderBottom: `1px solid ${theme.border}`,
            display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
          }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: theme.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Routes</span>
            {hasResults && (
              <span style={{ fontSize: 11, color: theme.textFaint }}>
                <span style={{ color: theme.text, fontWeight: 600 }}>
                  {response!.total_found || (response!.primary_routes.length + response!.diverse_routes.length)}
                </span> found
                {searchDuration !== null && <span> · {searchDuration < 1 ? `${(searchDuration * 1000).toFixed(0)}ms` : `${searchDuration.toFixed(2)}s`}</span>}
              </span>
            )}
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
              totalFound={response?.total_found}
              selectedRouteIds={selectedRouteIds}
              onSelectRoute={toggleRoute}
              nodes={nodes} systems={systems} capacity={capacity} outages={outages}
              pinnedRoutes={pinnedRoutes}
              onPin={handlePin} onUnpin={handleUnpin} onPinPair={handlePinPair}
              diversityRequested={lastSearchDiversity !== 'none'}
              onNetOwnership={config.on_net_ownership}
              externalSortKey={nlpSortKey}
              externalPushOutagesDown={nlpPushOutages}
              optimiseFor={lastOptimiseFor}
              flippedPairIds={flippedPairIds}
              onFlipPair={handleFlipPair}
              onAddToProject={(route, protectRoute) => {
                const nodesById = Object.fromEntries(nodes.map(n => [n.id, n]))
                const label = `${nodesById[route.nodes[0]]?.name ?? route.nodes[0]} → ${nodesById[route.nodes[route.nodes.length - 1]]?.name ?? route.nodes[route.nodes.length - 1]}`
                setAddToProjectRoute({ route, protectRoute, searchLabel: label })
                setEnrichTarget(null)
                setProjectsOpen(true)
              }}
              onEnrichCircuit={(pin) => {
                if (!pin.projectId || !pin.circuitId) return
                setAddToProjectRoute(null)
                setEnrichTarget({ projectId: pin.projectId, circuitId: pin.circuitId })
                setProjectsOpen(true)
              }}
            />
          </div>
        </div>

        {/* End collapsible panels wrapper */}
        </div>

        {/* Map */}
        <div style={{ flex: 1, position: 'relative' }}>
          {/* Drawer toggle */}
          <button
            onClick={() => setPanelsOpen(v => !v)}
            title={panelsOpen ? 'Hide panels' : 'Show panels'}
            style={{
              position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)',
              zIndex: 500, background: theme.bgPanel,
              border: `1px solid ${theme.border}`, borderLeft: 'none',
              borderRadius: '0 6px 6px 0',
              color: theme.textFaint, cursor: 'pointer',
              padding: '10px 5px', fontSize: 13, fontWeight: 700, lineHeight: 1,
              display: 'flex', alignItems: 'center',
              boxShadow: '2px 0 6px rgba(0,0,0,0.2)',
            }}
          >
            {panelsOpen ? '‹' : '›'}
          </button>

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
              subseaOnly={subseaOnly}
              backhaulOnly={backhaulOnly}
              countryHighlight={countryHighlight}
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

      {projectsOpen && (
        <ProjectsModal
          nodes={nodes}
          pendingCircuit={addToProjectRoute ?? undefined}
          initialProject={enrichTarget?.projectId ?? null}
          initialCircuitId={enrichTarget?.circuitId ?? null}
          onClose={() => { setProjectsOpen(false); setAddToProjectRoute(null); setEnrichTarget(null) }}
          onRestorePins={(circuits, projectId) => {
            const nodesById = Object.fromEntries(nodes.map(n => [n.id, n]))
            const usedColors = new Set<string>()
            const newPins = circuits.slice(0, MAX_PINS).map((c, i) => {
              const route = c.route_snapshot as unknown as Route
              const color = PIN_COLORS.find(col => !usedColors.has(col)) ?? PIN_COLORS[i % PIN_COLORS.length]
              usedColors.add(color)
              pinCounter.current += 1
              const label = c.label || c.search_label || `${nodesById[route.nodes[0]]?.name ?? route.nodes[0]} → ${nodesById[route.nodes[route.nodes.length - 1]]?.name ?? route.nodes[route.nodes.length - 1]}`
              return { pinId: `pin-${pinCounter.current}`, route, color, searchLabel: label, projectId, circuitId: c.circuit_id, circuitLabel: c.label }
            })
            setPinnedRoutes(newPins)
          }}
          onCircuitAdded={(projectId, circuitId, circuitLabel) => {
            setPinnedRoutes(prev => {
              const route = addToProjectRoute?.route
              if (!route) return prev
              return prev.map(p => routeKey(p.route) === routeKey(route)
                ? { ...p, projectId, circuitId, circuitLabel }
                : p
              )
            })
          }}
        />
      )}

      {guideOpen && createPortal(
        <div style={{
          position: 'fixed', inset: 0, zIndex: 2000,
          background: theme.bgBase,
          overflowY: 'auto',
        }}>
          <button
            onClick={() => setGuideOpen(false)}
            style={{
              position: 'fixed', top: 16, right: 20, zIndex: 2001,
              background: theme.bgCard, border: `1px solid ${theme.border}`,
              borderRadius: '50%', width: 36, height: 36,
              fontSize: 18, lineHeight: 1, cursor: 'pointer',
              color: theme.textMuted, display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
            }}
            title="Close guide"
          >×</button>
          <UserGuide nodes={nodes} segments={segments} systems={systems} />
        </div>,
        document.body
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

