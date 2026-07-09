import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAuth } from './context/AuthContext'
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
import { AlgoEval } from './components/AlgoEval'
import { generateStraightLineDiagram, generateSldFromProject, generateDrawioXml, generateVisioVsdx } from './utils/generateDiagram'
import { api } from './api/client'
import { ThemeContext, darkTheme, duskTheme, lightTheme, useTheme, type Theme, type ThemeMode } from './theme'
import type { AppConfig, AppMode, CableNode, CableSegment, CableSystem, CountryHighlight, InterconnectRule, NlpSortMode, PinnedRoute, Project, Route, RouteRequest, RouteResponse, SegmentCapacity, SegmentOutage, SelectedSystem } from './types'
import { ProjectsModal } from './components/ProjectsModal'
import { RouteManualLeft, RouteManualMiddle, computeCandidates, assembleRoute } from './components/RouteManual'
import type { NextHopCandidate } from './components/RouteManual'
import { OutagePanel } from './components/OutagePanel'
import { CountryNodeDiagram } from './components/CountryNodeDiagram'

/**
 * ============================================================================
 *  App.tsx — the root component of the RouteBuilder frontend.
 * ============================================================================
 *
 * RouteBuilder is an internal tool for an international telco to design subsea
 * (submarine cable) circuits. It presents a large network of nodes and cable
 * segments on a map and lets a user search for, compare, and document routes
 * between two endpoints.
 *
 * DOMAIN GLOSSARY (used throughout the codebase):
 *   • CLS  — Cable Landing Station: where a submarine cable meets land.
 *   • wet segment — a submarine cable hop (vs. a terrestrial/backhaul hop).
 *   • system — a named submarine cable (e.g. EAC, C2C). One system is made of
 *     many segments.
 *   • diversity — a physically separate backup path (so a single cut can't take
 *     down both the "worker" and its "protect" route).
 *   • SLD  — Straight Line Diagram: the schematic export handed to customers.
 *   • pinned route — a search result the user keeps on the map for comparison.
 *   • project — a saved solution; it contains "circuits", each of which
 *     snapshots one (or a worker+protect pair of) route(s).
 *
 * -------------------------------------------------------------------------
 *  TOP-LEVEL STATE MODEL
 * -------------------------------------------------------------------------
 * The whole app is driven by one big `App` component holding React state. The
 * most important piece is `mode` (type AppMode), which selects what the LEFT
 * panel shows and how the Map behaves. The modes are:
 *   • 'routebuilder' — the search form (SearchForm) + NLP chat. Main flow.
 *   • 'routemanual'  — hand-build a route hop-by-hop by clicking the map.
 *   • 'systemviewer' — highlight named cable systems on the map.
 *   • 'nodefinder'   — drop a pin, find nearest nodes.
 *   • 'citypair'     — pick two cities, list subsea system itineraries.
 *   • 'countryviewer'— highlight a country and its nodes/segments.
 *   • 'outageviewer' — show current cable faults/outages.
 * `switchMode()` centralises the side effects of changing mode;
 * `safeSwitchMode()` first warns if the user is mid-build in RouteManual.
 *
 * -------------------------------------------------------------------------
 *  THE SEARCH FLOW (routebuilder mode)
 * -------------------------------------------------------------------------
 *   SearchForm builds a `RouteRequest`  →  handleSearch() calls
 *   api.searchRoutes()  →  the result lands in `response` (a RouteResponse
 *   with primary_routes + diverse_routes)  →  RouteList renders the cards  →
 *   the user selects routes (selectedRouteIds) and/or pins them  →  the Map
 *   draws the selected + pinned routes.
 *
 * -------------------------------------------------------------------------
 *  pinnedRoutes vs. selectedRoutes vs. projects
 * -------------------------------------------------------------------------
 *   • selectedRouteIds → which result cards are ticked; these are drawn on the
 *     map "live" for the current search only, and are cleared on a new search.
 *   • pinnedRoutes     → routes the user explicitly kept (up to MAX_PINS) so
 *     they persist on the map across searches for side-by-side comparison.
 *     Each pin has a stable colour and label.
 *   • activeProject    → a saved solution. When a project is "active", pinning
 *     a route also saves it as a circuit (route_snapshot) on that project via
 *     the API. restorePinsFromProject() rebuilds the pin bar from a project's
 *     saved circuits.
 *
 * -------------------------------------------------------------------------
 *  DATA LOADING
 * -------------------------------------------------------------------------
 *   On mount, a Promise.all fetches the whole reference dataset: nodes,
 *   segments, capacity, systems, rules, config, outages (plus projects). Any
 *   admin edit in RefDataModal calls handleDataChange(), which re-runs the same
 *   Promise.all to refresh every slice of that dataset.
 *
 * -------------------------------------------------------------------------
 *  ADMIN & RESPONSIVE
 * -------------------------------------------------------------------------
 *   • Admin editing is gated by AuthContext (see AdminBar at the bottom of this
 *     file); read-only until unlocked with the passphrase.
 *   • Below 768px wide (useIsMobile) the app renders a completely separate
 *     <MobileLayout> instead of the three-panel desktop layout.
 * ============================================================================
 */

// Feature flag: the natural-language search assistant (NlpChat / "TSABuddy").
// Disabled when VITE_ENABLE_NLP === 'false'. Lazy-loaded only when enabled so
// its bundle isn't shipped to users who have it turned off.
const NLP_ENABLED = import.meta.env.VITE_ENABLE_NLP !== 'false'
const NlpChat = NLP_ENABLED
  ? lazy(() => import('./components/NlpChat'))
  : null

// Palette cycled through when assigning a distinct colour to each pinned route.
const PIN_COLORS    = ['#f9e2af', '#94e2d5', '#cba6f7', '#f2cdcd', '#eba0ac', '#89dceb', '#a6e3a1', '#fab387', '#cdd6f4', '#b4befe']
// Hard cap on how many routes can be pinned/compared on the map at once.
const MAX_PINS = 10
// Palette for the up-to-5 cable systems highlighted in systemviewer mode.
const SYSTEM_COLORS = ['#89b4fa', '#a6e3a1', '#f9e2af', '#94e2d5', '#cba6f7']

/** Stable identity for a route: its ordered node list joined into a string.
 *  Used to detect "is this exact path already pinned?" regardless of object id. */
function routeKey(r: Route) { return r.nodes.join('|') }

/** Hook: true when the viewport is narrower than 768px. Drives the switch to
 *  the separate mobile layout. Re-evaluates on window resize. */
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768)
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])
  return isMobile
}

/** Banner at the top of the middle (routes) panel showing whether we're in
 *  plain "Circuit Designer" mode or inside an active Project. Provides a dropdown
 *  to switch/exit the project. Purely presentational — all state lives in App. */
function ModeBanner({ activeProject, onSwitch, onExit, theme }: {
  activeProject: import('./types').Project | null
  onSwitch: () => void
  onExit: () => void
  theme: import('./theme').Theme
}) {
  const [open, setOpen] = useState(false)
  const isProject = !!activeProject

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 8,
          padding: '9px 16px', border: 'none', cursor: 'pointer',
          background: isProject ? `${theme.blue}22` : theme.bgDeep,
          borderBottom: `1px solid ${isProject ? theme.blue + '55' : theme.border}`,
          color: isProject ? theme.blue : theme.textMuted,
          textAlign: 'left',
        }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
          {isProject
            ? <><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></>
            : <><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M2 12h3M19 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12"/></>
          }
        </svg>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', opacity: 0.75, lineHeight: 1 }}>
            {isProject ? 'Project Mode' : 'Mode'}
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, color: isProject ? theme.blue : theme.text, lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {isProject ? (activeProject.name || 'Untitled Project') : 'Circuit Designer'}
          </div>
        </div>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, opacity: 0.5, transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 0.15s' }}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 499 }} />
          <div style={{
            position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 500,
            background: theme.bgPanel, border: `1px solid ${theme.border}`,
            borderTop: 'none', borderRadius: '0 0 8px 8px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            padding: 12, display: 'flex', flexDirection: 'column', gap: 8,
          }}>
            {isProject && (activeProject.opportunity_id || activeProject.circuits.length > 0) && (
              <div style={{ fontSize: 11, color: theme.textMuted, paddingBottom: 4, borderBottom: `1px solid ${theme.border}` }}>
                {activeProject.opportunity_id && <span>🔑 {activeProject.opportunity_id} · </span>}
                {activeProject.circuits.length} circuit{activeProject.circuits.length !== 1 ? 's' : ''}
              </div>
            )}
            {isProject ? (
              <>
                <button
                  onClick={() => { setOpen(false); onSwitch() }}
                  style={{
                    padding: '8px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                    border: `1px solid ${theme.blue}66`, background: `${theme.blue}18`,
                    color: theme.blue, cursor: 'pointer', textAlign: 'left',
                  }}
                >
                  ⇄ Switch Project
                </button>
                <button
                  onClick={() => { setOpen(false); onExit() }}
                  style={{
                    padding: '8px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                    border: `1px solid ${theme.border}`, background: 'transparent',
                    color: theme.textMuted, cursor: 'pointer', textAlign: 'left',
                  }}
                >
                  ✕ Exit to Circuit Designer
                </button>
              </>
            ) : (
              <button
                onClick={() => { setOpen(false); onSwitch() }}
                style={{
                  padding: '8px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                  border: `1px solid ${theme.blue}66`, background: `${theme.blue}18`,
                  color: theme.blue, cursor: 'pointer', textAlign: 'left',
                }}
              >
                📁 Open a Project
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}

export default function App() {
  const isMobile = useIsMobile()

  // ── Theme ── Three-way theme cycle: dark → dusk → light → dark.
  const [themeMode, setThemeMode] = useState<ThemeMode>('dusk')
  const theme = themeMode === 'dark' ? darkTheme : themeMode === 'dusk' ? duskTheme : lightTheme
  function cycleTheme() { setThemeMode(m => m === 'dark' ? 'dusk' : m === 'dusk' ? 'light' : 'dark') }

  // ── Modal / overlay open-state flags ──────────────────────────────────────
  // Each boolean toggles a full-screen modal (ref-data editor, guide, projects,
  // capacity dashboard, algo-eval, SLD export prompt, etc.).
  const [refDataOpen,     setRefDataOpen]     = useState(false)
  const [refDataNoteFocus, setRefDataNoteFocus] = useState<{ kind: 'node' | 'segment', id: string } | null>(null)
  const [guideOpen,       setGuideOpen]       = useState(false)
  const [projectsOpen,    setProjectsOpen]    = useState(false)
  const [addToProjectRoute, setAddToProjectRoute] = useState<{ route: Route; protectRoute?: Route; searchLabel: string } | null>(null)
  const [enrichTarget, setEnrichTarget] = useState<{ projectId: string; circuitId: string } | null>(null)
  const [activeProject,   setActiveProject]   = useState<Project | null>(null)
  const [pendingPin, setPendingPin] = useState<{ worker: Route; protect?: Route; searchLabel: string } | null>(null)
  const [pendingPinLabel, setPendingPinLabel] = useState('')
  const [pendingPinSaving, setPendingPinSaving] = useState(false)
  const [sldVersionPrompt, setSldVersionPrompt] = useState(false)
  const [sldVersion, setSldVersion] = useState('')

  // ── Active mode — selects the left panel + map behaviour (see header). ─────
  const [mode, setMode]               = useState<AppMode>('routebuilder')

  // ── Reference dataset (loaded from the API on mount, refreshed on edits). ──
  // This is the whole network model the UI renders and searches over.
  const [nodes, setNodes]             = useState<CableNode[]>([])
  const [segments, setSegments]       = useState<CableSegment[]>([])
  const [systems, setSystems]         = useState<CableSystem[]>([])
  const [capacity, setCapacity]       = useState<SegmentCapacity[]>([])
  const [rules, setRules]             = useState<InterconnectRule[]>([])
  const [config, setConfig]           = useState<AppConfig>({ on_net_ownership: ['owned', 'consortium', 'iru'] })

  // ── Search results & selection ────────────────────────────────────────────
  const [response, setResponse]       = useState<RouteResponse | null>(null)   // last search result (primary + diverse routes)
  const [selectedRouteIds, setSelectedRouteIds] = useState<string[]>([])        // which result cards are ticked (drawn live on map)
  const [pinnedRoutes, setPinnedRoutes]         = useState<PinnedRoute[]>([])    // routes kept on the map across searches (see header)
  const [cachedProjects, setCachedProjects]     = useState<import('./types').Project[] | null>(null) // projects list cache for the ProjectsModal
  const [selectedSystems, setSelectedSystems]   = useState<SelectedSystem[]>([]) // cable systems highlighted in systemviewer mode
  const [loading, setLoading]   = useState(false)   // a search is in flight
  const [error, setError]       = useState<string | null>(null)
  const [lastSearchDiversity, setLastSearchDiversity] = useState<import('./types').DiversityType>('none') // remembers the diversity of the last search (affects how RouteList pairs cards)
  const [lastOptimiseFor, setLastOptimiseFor] = useState<string | undefined>(undefined)                   // remembers the "optimise for" objective of the last search
  const [selectedNode, setSelectedNode] = useState<{ node: CableNode; x: number; y: number } | null>(null) // node whose info popup is open (with click coords)
  const [searchPin, setSearchPin]       = useState<{ lat: number; lng: number; label: string } | null>(null) // dropped pin in nodefinder mode
  const [nearestNodeIds, setNearestNodeIds] = useState<string[]>([])   // nodes nearest to the dropped search pin
  const [prefilledOrigin, setPrefilledOrigin] = useState('')           // origin to pre-fill SearchForm (from map click / other panels)
  const [prefilledDest, setPrefilledDest]     = useState('')           // destination to pre-fill SearchForm
  const [searchPrefill, setSearchPrefill]     = useState<Partial<RouteRequest> | undefined>(undefined) // full request prefill from the NLP assistant
  const [outages, setOutages]                       = useState<SegmentOutage[]>([]) // current cable faults/outages

  // ── Overlay flags + map display toggles (driven by the top-right "Controls"
  //    menu). Each toggle changes what the Map draws or filters. ─────────────
  const [capDashOpen, setCapDashOpen]               = useState(false)
  const [algoEvalOpen, setAlgoEvalOpen]             = useState(false)
  const [ctrlMenuOpen, setCtrlMenuOpen]             = useState(false)
  const [hideNonActive, setHideNonActive]           = useState(false)  // dim nodes/segments not on a shown route
  const [showSegmentLabels, setShowSegmentLabels]   = useState(false)
  const [showNodeLabels,    setShowNodeLabels]       = useState(false)
  const [showAllOutages, setShowAllOutages]         = useState(false)  // show every outage, not just those on shown routes
  const [subseaOnly, setSubseaOnly]                 = useState(false)  // draw only wet (submarine) segments
  const [backhaulOnly, setBackhaulOnly]             = useState(false)  // draw only terrestrial (backhaul) segments
  const [nlpSortKey, setNlpSortKey]                 = useState<SortKey | undefined>(undefined)   // sort key requested by the NLP assistant
  const [nlpPushOutages, setNlpPushOutages]         = useState<boolean | undefined>(undefined)   // push outage-affected routes down, requested by NLP
  const [countryHighlight, setCountryHighlight]     = useState<CountryHighlight | null>(null)     // country selected in countryviewer mode
  const [showNodeDiagram, setShowNodeDiagram]       = useState(false)  // opens the CountryNodeDiagram overlay

  // ── RouteManual state ──────────────────────────────────────────────────────
  const [manualState,   setManualState]   = useState<import('./components/RouteManual').ManualState | null>(null)
  const [manualResults, setManualResults] = useState<Route[]>([])
  const [manualFinishConfirm, setManualFinishConfirm] = useState<Route | null>(null)
  const [warnSwitchMode, setWarnSwitchMode]           = useState<AppMode | null>(null)
  const [leftOpen, setLeftOpen]                     = useState(true)
  const [middleOpen, setMiddleOpen]                 = useState(true)
  const [flippedPairIds, setFlippedPairIds]         = useState<Set<string>>(new Set())
  const pinCounter = useRef(0)

  // Translate the free-form sort intents the NLP assistant emits into the
  // concrete SortKey values RouteList understands (with a few legacy aliases).
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
  /** Apply a sort intent coming from the NLP assistant to the route list. */
  function handleApplySort(mode: NlpSortMode) {
    if (mode === 'outages') {
      setNlpPushOutages(true)
    } else {
      const key = NLP_SORT_MAP[mode]
      if (key) setNlpSortKey(key)
    }
  }

  // Initial data load: fetch the entire reference dataset in parallel, plus the
  // saved projects list. Runs once on mount.
  useEffect(() => {
    Promise.all([api.getNodes(), api.getSegments(), api.getCapacity(), api.getSystems(), api.getRules(), api.getConfig(), api.getOutages()])
      .then(([n, s, c, sys, r, cfg, o]) => { setNodes(n); setSegments(s); setCapacity(c); setSystems(sys); setRules(r); setConfig(cfg); setOutages(o) })
      .catch(() => setError('Failed to load network data'))
    api.getProjects().then(setCachedProjects).catch(() => {})
  }, [])

  // True while the user is actively assembling a route by hand in RouteManual.
  const manualBuilding = mode === 'routemanual' && !!manualState

  /** Change the active mode and run the side effects each mode needs (clearing
   *  results, resetting highlights, auto-enabling certain toggles, etc.). */
  function switchMode(next: AppMode) {
    if (next === 'systemviewer') { setResponse(null); setSelectedRouteIds([]); setError(null) }
    if (next !== 'countryviewer') { setCountryHighlight(null); setShowNodeDiagram(false) }
    if (next === 'countryviewer') setShowSegmentLabels(true)
    if (next !== 'routemanual') { setManualState(null); setManualFinishConfirm(null) }
    if (next === 'outageviewer') setShowAllOutages(true)
    setMode(next)
  }

  /** Like switchMode, but if the user is mid-build in RouteManual it first pops
   *  a "discard route?" confirmation instead of silently losing their work. */
  function safeSwitchMode(next: AppMode) {
    if (manualBuilding && next !== 'routemanual') { setWarnSwitchMode(next); return }
    switchMode(next)
  }

  // ── RouteManual handlers ─────────────────────────────────────────────────
  // Lookup maps rebuilt each render so the manual builder can resolve ids fast.
  const nodesById_      = Object.fromEntries(nodes.map(n => [n.id, n]))
  const segmentsById_   = Object.fromEntries(segments.map(s => [s.id, s]))
  const capacityBySegId_ = Object.fromEntries(capacity.map(c => [c.segment_id, c]))

  // The set of next hops the user may click from wherever they currently are in
  // the manual build (excludes already-visited nodes to prevent loops).
  const manualCandidates: NextHopCandidate[] = (() => {
    if (!manualState) return []
    const currentId = manualState.steps.length
      ? manualState.steps[manualState.steps.length - 1].nodeId
      : manualState.originId
    const visited = new Set([manualState.originId, ...manualState.steps.map(s => s.nodeId)])
    return computeCandidates(currentId, visited, segments, nodesById_, systems, capacityBySegId_)
  })()

  /** Map-click handler while in RouteManual: first click sets the origin, later
   *  clicks either extend the path to a valid candidate or (clicking the current
   *  node again) finish the route. */
  function handleManualNodeClick(node: CableNode) {
    if (!manualState) {
      // No state yet — this click sets the origin
      setManualState({ originId: node.id, steps: [] })
      return
    }

    const currentId = manualState.steps.length
      ? manualState.steps[manualState.steps.length - 1].nodeId
      : manualState.originId

    // Double-click on current node → finish
    if (node.id === currentId && manualState.steps.length > 0) {
      const route = assembleRoute(manualState, nodesById_, segmentsById_)
      setManualFinishConfirm(route)
      return
    }

    // Find a matching candidate (may be multiple segments; pick first matching node)
    const candidate = manualCandidates.find(c => c.nodeId === node.id)
    if (!candidate) return
    setManualState(prev => prev ? {
      ...prev,
      steps: [...prev.steps, { nodeId: candidate.nodeId, segmentId: candidate.segmentId }],
    } : prev)
  }

  /** Append a chosen next hop to the manual build (picked from the list panel). */
  function handleManualPickHop(candidate: NextHopCandidate) {
    setManualState(prev => prev ? {
      ...prev,
      steps: [...prev.steps, { nodeId: candidate.nodeId, segmentId: candidate.segmentId }],
    } : prev)
  }

  /** Remove the last hop added to the manual build. */
  function handleManualUndo() {
    setManualState(prev => {
      if (!prev || prev.steps.length === 0) return prev
      return { ...prev, steps: prev.steps.slice(0, -1) }
    })
  }

  /** Finish the manual build: assemble the accumulated steps into a full Route
   *  and open the confirmation dialog to review its stats. */
  function handleManualFinish() {
    if (!manualState || manualState.steps.length === 0) return
    const route = assembleRoute(manualState, nodesById_, segmentsById_)
    setManualFinishConfirm(route)
  }

  /** Accept a manually built route: prepend it to the results list and reset the
   *  builder so the user can start another. */
  function confirmManualRoute(route: Route) {
    setManualResults(prev => [route, ...prev])
    setManualFinishConfirm(null)
    setManualState(null)
  }

  // Wall-clock duration of the last search, in seconds (for the "found in Xms" UI).
  const [searchDuration, setSearchDuration] = useState<number | null>(null)

  /** Run a route search: clear old state, call the API, store the response, and
   *  auto-select the top primary + top diverse route so the map shows something. */
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

  /** Tick / untick a result card (adds or removes it from the map). */
  function toggleRoute(id: string) {
    setSelectedRouteIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  /** Pin (or unpin) a single route. If a project is active, defer to a label
   *  prompt so the pin can be saved as a project circuit; otherwise assign the
   *  next free colour and add it to the pin bar (respecting MAX_PINS). */
  function handlePin(route: Route) {
    const key = routeKey(route)
    // Unpin if already pinned (same in both modes)
    if (pinnedRoutes.some(p => routeKey(p.route) === key)) {
      setPinnedRoutes(prev => prev.filter(p => routeKey(p.route) !== key))
      return
    }
    if (pinnedRoutes.length >= MAX_PINS) return
    const nodesById = Object.fromEntries(nodes.map(n => [n.id, n]))
    const searchLabel = `${nodesById[route.nodes[0]]?.name ?? route.nodes[0]} → ${nodesById[route.nodes[route.nodes.length - 1]]?.name ?? route.nodes[route.nodes.length - 1]}`
    if (activeProject) {
      setPendingPin({ worker: route, searchLabel })
      setPendingPinLabel('')
      return
    }
    const usedColors = pinnedRoutes.map(p => p.color)
    const color = PIN_COLORS.find(c => !usedColors.includes(c)) ?? PIN_COLORS[0]
    pinCounter.current += 1
    setPinnedRoutes(prev => [...prev, { pinId: `pin-${pinCounter.current}`, route, color, searchLabel }])
  }

  /** Remove a pin from the map by its unique pinId. */
  function handleUnpin(pinId: string) {
    setPinnedRoutes(prev => prev.filter(p => p.pinId !== pinId))
  }

  /** Rebuild the pin bar from a project's saved circuits — restoring each
   *  circuit's worker (and optional protect) route snapshot, colour and label.
   *  Called when a project is activated or its pins are explicitly restored. */
  function restorePinsFromProject(project: Project) {
    const nodesById = Object.fromEntries(nodes.map(n => [n.id, n]))
    const newPins: PinnedRoute[] = []
    project.circuits.slice(0, MAX_PINS).forEach(c => {
      if (!c.route_snapshot) return
      const route   = c.route_snapshot   as unknown as Route
      const protect = c.protect_route_snapshot as unknown as Route | undefined
      const color   = c.pin_color || PIN_COLORS[newPins.length % PIN_COLORS.length]
      const startName = nodesById[route.nodes?.[0]]?.name ?? route.nodes?.[0] ?? '?'
      const endName   = nodesById[route.nodes?.[route.nodes.length - 1]]?.name ?? route.nodes?.[route.nodes.length - 1] ?? '?'
      const baseLabel = c.label || c.search_label || `${startName} → ${endName}`
      const wCircuitLabel = protect ? (c.label ? `${c.label} (Worker)` : undefined) : c.label
      const pCircuitLabel = c.label ? `${c.label} (Protect)` : undefined
      pinCounter.current += 1
      newPins.push({ pinId: `pin-${pinCounter.current}`, route, color, searchLabel: protect ? `${baseLabel} (Worker)` : baseLabel, projectId: project.id, circuitId: c.circuit_id, circuitLabel: wCircuitLabel })
      if (protect && newPins.length < MAX_PINS) {
        pinCounter.current += 1
        newPins.push({ pinId: `pin-${pinCounter.current}`, route: protect, color, searchLabel: `${baseLabel} (Protect)`, projectId: project.id, circuitId: c.circuit_id, circuitLabel: pCircuitLabel })
      }
    })
    setPinnedRoutes(newPins)
  }

  /** Pin (or unpin) a worker+protect diversity pair together — both share one
   *  colour so the eye reads them as a single protected circuit on the map. */
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
    const nodesById = Object.fromEntries(nodes.map(n => [n.id, n]))
    const wLabel = `${nodesById[worker.nodes[0]]?.name ?? worker.nodes[0]} → ${nodesById[worker.nodes[worker.nodes.length - 1]]?.name ?? worker.nodes[worker.nodes.length - 1]}`
    if (activeProject) {
      setPendingPin({ worker, protect, searchLabel: wLabel })
      setPendingPinLabel('')
      return
    }
    const usedColors = remaining.map(p => p.color)
    const color = PIN_COLORS.find(c => !usedColors.includes(c)) ?? PIN_COLORS[0]
    const pLabel = `${nodesById[protect.nodes[0]]?.name ?? protect.nodes[0]} → ${nodesById[protect.nodes[protect.nodes.length - 1]]?.name ?? protect.nodes[protect.nodes.length - 1]} (Protect)`
    pinCounter.current += 1
    const wId = pinCounter.current
    pinCounter.current += 1
    setPinnedRoutes([...remaining,
      { pinId: `pin-${wId}`,            route: worker,  color, searchLabel: wLabel },
      { pinId: `pin-${pinCounter.current}`, route: protect, color, searchLabel: pLabel },
    ])
  }

  /** Confirm the "add to project" label prompt: persist the pending pin as a new
   *  circuit on the active project (via api.addCircuit), then add the resulting
   *  worker/protect pins to the map stamped with the new project + circuit ids. */
  async function confirmPinToProject() {
    if (!pendingPin || !activeProject) return
    setPendingPinSaving(true)
    try {
      const { worker, protect, searchLabel } = pendingPin
      const id = `${worker.nodes[0]}-${worker.nodes[worker.nodes.length - 1]}-${Date.now().toString(36)}`
      const label = pendingPinLabel.trim() || undefined
      const usedColors = pinnedRoutes.map(p => p.color)
      const color = PIN_COLORS.find(c => !usedColors.includes(c)) ?? PIN_COLORS[activeProject.circuits.length % PIN_COLORS.length]
      const circuit = {
        circuit_id: id, label, search_label: searchLabel, pin_color: color,
        order: activeProject.circuits.length,
        route_snapshot: worker as unknown as import('./types').Route,
        protect_route_snapshot: protect as unknown as import('./types').Route | undefined,
        a_end: {} as import('./types').EndpointConfig,
        z_end: {} as import('./types').EndpointConfig,
      }
      const updated = await api.addCircuit(activeProject.id, circuit)
      setActiveProject(updated)
      const baseLabel = label || searchLabel
      const wCircuitLabel = protect ? (label ? `${label} (Worker)` : label) : label
      const pCircuitLabel = label ? `${label} (Protect)` : undefined
      pinCounter.current += 1
      const wId = pinCounter.current
      const newPins: PinnedRoute[] = [
        { pinId: `pin-${wId}`, route: worker, color, searchLabel: protect ? `${baseLabel} (Worker)` : baseLabel, projectId: activeProject.id, circuitId: id, circuitLabel: wCircuitLabel }
      ]
      if (protect) {
        pinCounter.current += 1
        newPins.push({ pinId: `pin-${pinCounter.current}`, route: protect, color, searchLabel: `${baseLabel} (Protect)`, projectId: activeProject.id, circuitId: id, circuitLabel: pCircuitLabel })
      }
      setPinnedRoutes(prev => [...prev, ...newPins])
      setPendingPin(null); setPendingPinLabel('')
    } finally {
      setPendingPinSaving(false)
    }
  }

  /** Callback fired by ProjectsModal once a route has been added to a project as
   *  a circuit. Either stamps the already-pinned route(s) with the new project /
   *  circuit metadata, or auto-pins them if they weren't on the map yet. */
  function handleCircuitAdded(projectId: string, circuitId: string, circuitLabel?: string) {
    const pending = addToProjectRoute
    if (!pending) return
    setPinnedRoutes(prev => {
      const wKey = routeKey(pending.route)
      const alreadyPinned = prev.some(p => routeKey(p.route) === wKey)
      if (alreadyPinned) {
        // Route was already in the pin bar — just stamp it with project metadata
        return prev.map(p => {
          if (routeKey(p.route) === wKey) return { ...p, projectId, circuitId, circuitLabel }
          if (pending.protectRoute && routeKey(p.route) === routeKey(pending.protectRoute))
            return { ...p, projectId, circuitId, circuitLabel: circuitLabel ? `${circuitLabel} (Protect)` : undefined }
          return p
        })
      }
      // Not yet pinned — auto-pin since we're in project mode
      if (prev.length >= MAX_PINS) return prev
      const usedColors = prev.map(p => p.color)
      const color = PIN_COLORS.find(c => !usedColors.includes(c)) ?? PIN_COLORS[prev.length % PIN_COLORS.length]
      const { route, protectRoute, searchLabel } = pending
      const wLabel = protectRoute ? (circuitLabel ? `${circuitLabel} (Worker)` : `${searchLabel} (Worker)`) : (circuitLabel || searchLabel)
      pinCounter.current += 1
      const newPins: PinnedRoute[] = [
        { pinId: `pin-${pinCounter.current}`, route, color, searchLabel: wLabel, projectId, circuitId, circuitLabel: protectRoute ? (circuitLabel ? `${circuitLabel} (Worker)` : undefined) : circuitLabel }
      ]
      if (protectRoute && prev.length + 1 < MAX_PINS) {
        pinCounter.current += 1
        const pLabel = circuitLabel ? `${circuitLabel} (Protect)` : `${searchLabel} (Protect)`
        newPins.push({ pinId: `pin-${pinCounter.current}`, route: protectRoute, color, searchLabel: pLabel, projectId, circuitId, circuitLabel: circuitLabel ? `${circuitLabel} (Protect)` : undefined })
      }
      return [...prev, ...newPins]
    })
  }

  /** Toggle a cable system's highlight in systemviewer mode (max 5 at once,
   *  each gets a distinct colour from SYSTEM_COLORS). */
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

  // These let other panels (NodeFinder, CityPair, etc.) push an origin/dest into
  // the SearchForm and jump the user to routebuilder mode.
  function handleSetOrigin(nodeId: string) { setPrefilledOrigin(nodeId); switchMode('routebuilder') }
  function handleSetDest(nodeId: string)   { setPrefilledDest(nodeId);   switchMode('routebuilder') }
  function handleSetPair(originId: string, destId: string) {
    setPrefilledOrigin(originId); setPrefilledDest(destId); switchMode('routebuilder')
  }
  /** NodeFinder reports its dropped pin + the nearest nodes it found. */
  function handlePinChange(pin: { lat: number; lng: number; label: string } | null, ids: string[]) {
    setSearchPin(pin); setNearestNodeIds(ids)
  }

  // clearSearch: wipe the current search/manual results but KEEP pins.
  function clearSearch() { setResponse(null); setSelectedRouteIds([]); setError(null); setLastSearchDiversity('none'); setSearchDuration(null); setLastOptimiseFor(undefined); setManualResults([]); setManualState(null); setManualFinishConfirm(null) }
  // clearAll: wipe search results AND all pins (a full reset of the map).
  function clearAll()    { setResponse(null); setSelectedRouteIds([]); setPinnedRoutes([]); setError(null); setLastSearchDiversity('none'); setSearchDuration(null); setLastOptimiseFor(undefined); setManualResults([]); setManualState(null); setManualFinishConfirm(null) }

  /** Re-fetch the whole reference dataset. Called after any admin edit in the
   *  RefDataModal so the map/search immediately reflect the change. */
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

  // The actual Route objects for the ticked cards, resolved through the flip map.
  const selectedRoutes: Route[] = selectedRouteIds
    .map(id => effectiveRouteById[id])
    .filter((r): r is Route => r !== undefined)

  /** Toggle whether a diversity pair is "flipped" — i.e. swap which route is the
   *  worker and which is the protect (path data + colours trade places). */
  function handleFlipPair(pairId: string) {
    setFlippedPairIds(prev => {
      const next = new Set(prev)
      if (next.has(pairId)) next.delete(pairId)
      else next.add(pairId)
      return next
    })
  }

  // Derived flags that drive which panels / empty-states / export buttons show.
  const hasPins    = pinnedRoutes.length > 0
  const hasResults = response !== null || manualResults.length > 0
  // Count visible circuits (deduplicate worker+protect pairs sharing a circuitId)
  const pinnedCircuitCount = (() => {
    const seen = new Set<string>()
    let count = 0
    for (const p of pinnedRoutes) {
      const key = p.circuitId ?? p.pinId
      if (!seen.has(key)) { seen.add(key); count++ }
    }
    return count
  })()

  // ── Mobile layout ────────────────────────────────────────────────────────
  // On narrow screens the entire three-panel desktop UI is replaced by a single
  // MobileLayout component. All the same state + handlers are passed down to it,
  // followed by the shared modals (projects, guide, pin-label, manual finish).
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
          showNodeLabels={showNodeLabels}
          onToggleShowNodeLabels={() => setShowNodeLabels(v => !v)}
          showAllOutages={showAllOutages}
          onToggleShowAllOutages={() => setShowAllOutages(v => !v)}
          subseaOnly={subseaOnly}
          onToggleSubseaOnly={() => { setSubseaOnly(v => !v); if (!subseaOnly) setBackhaulOnly(false) }}
          backhaulOnly={backhaulOnly}
          onToggleBackhaulOnly={() => { setBackhaulOnly(v => !v); if (!backhaulOnly) setSubseaOnly(false) }}
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
          activeProject={activeProject}
          onExitProjectMode={() => { setActiveProject(null); setPinnedRoutes([]) }}
          onSwitchProject={() => { setAddToProjectRoute(null); setEnrichTarget(null); setProjectsOpen(true) }}
          manualState={manualState}
          manualCandidates={manualCandidates}
          manualResults={manualResults}
          onManualNodeClick={handleManualNodeClick}
          onManualPickHop={handleManualPickHop}
          onManualUndo={handleManualUndo}
          onManualFinish={handleManualFinish}
          onManualDiscard={() => { setManualState(null); setManualResults([]) }}
          countryHighlight={countryHighlight}
          onCountrySelect={setCountryHighlight}
        />
        {projectsOpen && (
          <ProjectsModal
            nodes={nodes}
            pendingCircuit={addToProjectRoute ?? undefined}
            initialProject={enrichTarget?.projectId ?? null}
            initialCircuitId={enrichTarget?.circuitId ?? null}
            initialProjects={cachedProjects}
            onProjectsChange={setCachedProjects}
            onClose={() => { setProjectsOpen(false); setAddToProjectRoute(null); setEnrichTarget(null) }}
            onActivateProject={(project) => {
              setActiveProject(project)
              setProjectsOpen(false)
              restorePinsFromProject(project)
            }}
            onRestorePins={(circuits, projectId) => restorePinsFromProject({ id: projectId, circuits } as import('./types').Project)}
            onCircuitAdded={handleCircuitAdded}
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
        {pendingPin && activeProject && createPortal(
          <div style={{
            position: 'fixed', inset: 0, zIndex: 9500,
            background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '0 16px',
          }}>
            <div style={{
              background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 12,
              padding: '24px 20px', width: '100%', maxWidth: 420, boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
            }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: theme.text, marginBottom: 4 }}>
                Add to {activeProject.name || 'Project'}
              </div>
              <div style={{ fontSize: 12, color: theme.textMuted, marginBottom: 16 }}>
                {pendingPin.searchLabel}
                {pendingPin.protect && <span style={{ color: '#f9e2af', marginLeft: 8 }}>+ Protect</span>}
              </div>
              <input
                autoFocus
                style={{
                  width: '100%', background: theme.bgBase, border: `1px solid ${theme.border}`,
                  borderRadius: 6, padding: '10px 12px', color: theme.text, fontSize: 14,
                  outline: 'none', boxSizing: 'border-box', marginBottom: 16, fontFamily: 'inherit',
                }}
                placeholder="Circuit label (optional)"
                value={pendingPinLabel}
                onChange={e => setPendingPinLabel(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') confirmPinToProject() }}
              />
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  onClick={confirmPinToProject} disabled={pendingPinSaving}
                  style={{ flex: 1, padding: '10px', borderRadius: 6, fontSize: 14, fontWeight: 600, cursor: 'pointer', border: 'none', background: theme.blue, color: theme.bgCard, fontFamily: 'inherit' }}
                >{pendingPinSaving ? 'Saving…' : 'Add Circuit'}</button>
                <button
                  onClick={() => { setPendingPin(null); setPendingPinLabel('') }}
                  style={{ flex: 1, padding: '10px', borderRadius: 6, fontSize: 14, fontWeight: 600, cursor: 'pointer', border: `1px solid ${theme.border}`, background: 'transparent', color: theme.textMuted, fontFamily: 'inherit' }}
                >Cancel</button>
              </div>
            </div>
          </div>,
          document.body
        )}
        {manualFinishConfirm && createPortal(
          <div style={{ position: 'fixed', inset: 0, zIndex: 9500, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 16px' }}>
            <div style={{ background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 14, padding: '24px 20px', width: '100%', maxWidth: 420, boxShadow: '0 24px 64px rgba(0,0,0,0.5)' }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: theme.text, marginBottom: 4 }}>Route Complete</div>
              <div style={{ fontSize: 12, color: theme.textMuted, marginBottom: 16 }}>Review stats then save or keep building.</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 16 }}>
                {[
                  { label: 'Hops', value: `${manualFinishConfirm.nodes.length - 1}` },
                  { label: 'km',   value: manualFinishConfirm.total_length_km.toLocaleString() },
                  { label: 'ms',   value: (manualFinishConfirm.total_latency ?? 0).toFixed(1) },
                  { label: 'Avail', value: `${(manualFinishConfirm.end_to_end_reliability * 100).toFixed(2)}%` },
                ].map(({ label, value }) => (
                  <div key={label} style={{ background: theme.bgBase, borderRadius: 8, padding: '10px 8px', textAlign: 'center' }}>
                    <div style={{ fontSize: 14, fontWeight: 800, color: theme.text }}>{value}</div>
                    <div style={{ fontSize: 9, color: theme.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 10, color: theme.textMuted, marginBottom: 16 }}>
                Systems: {[...new Set(manualFinishConfirm.segments.map(s => s.system_id))].join(' · ')}
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button onClick={() => { confirmManualRoute(manualFinishConfirm) }}
                  style={{ flex: 1, padding: '10px 16px', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: 'pointer', border: 'none', background: theme.blue, color: theme.bgCard, fontFamily: 'inherit' }}>
                  ✓ Save Route
                </button>
                <button onClick={() => { setManualFinishConfirm(null) }}
                  style={{ padding: '10px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: `1px solid ${theme.border}`, background: 'transparent', color: theme.textMuted, fontFamily: 'inherit' }}>
                  ← Keep Building
                </button>
                <button onClick={() => { setManualFinishConfirm(null); setManualState(null) }}
                  style={{ padding: '10px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: `1px solid ${theme.red}44`, background: 'transparent', color: theme.red, fontFamily: 'inherit' }}>
                  ✕ Discard
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
      </ThemeContext.Provider>
    )
  }

  // ── Desktop layout ───────────────────────────────────────────────────────
  // Three vertical columns: LEFT = mode-specific controls (search/manual/etc.),
  // MIDDLE = the RouteList of results/pins, RIGHT = the interactive Map. Above
  // them sit the top-right Controls menu and, below, a stack of portalled modals.
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
      <div style={{ display: 'flex', height: '100vh', background: theme.bgBase, color: theme.text, fontFamily: "'Inter', system-ui, sans-serif", overflow: 'hidden' }}>

        {/* Top-right control menu */}
        {(() => {
          const activeToggles = [showAllOutages, hideNonActive, showSegmentLabels, showNodeLabels, subseaOnly, backhaulOnly].filter(Boolean).length
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
                      { label: 'Node Labels',      icon: showNodeLabels     ? '◉' : '◎', active: showNodeLabels,     color: theme.blue, onClick: () => setShowNodeLabels(v => !v) },
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
                      { label: 'Algo Eval', icon: '🧪', onClick: () => { setAlgoEvalOpen(true);  setCtrlMenuOpen(false) } },
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

        {/* Left panel */}
        <div style={{
          width: leftOpen ? 440 : 0, flexShrink: 0, display: 'flex', flexDirection: 'column',
          background: theme.bgPanel, borderRight: leftOpen ? `1px solid ${theme.border}` : 'none',
          overflow: 'hidden', transition: 'width 0.3s ease',
        }}>
          <div style={{ padding: '14px 16px 10px', borderBottom: `1px solid ${theme.border}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 2 }}>
              <div
                onClick={() => setGuideOpen(true)}
                style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer', flex: 1, minWidth: 0 }}
                title="Open platform guide"
              >
                <img src="/favicon.svg" alt="" style={{ width: 28, height: 28, flexShrink: 0 }} />
                <h1 style={{ fontSize: 18, fontWeight: 700, color: theme.text }}>RouteBuilder</h1>
              </div>
              <a
                href="/suite.html"
                title="Back to the RouteSuite portal"
                style={{
                  fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textDecoration: 'none',
                  padding: '3px 8px', borderRadius: 4, whiteSpace: 'nowrap', flexShrink: 0,
                  border: `1px solid ${theme.border}`, color: theme.textMuted, background: 'transparent',
                }}
              >
                RouteSuite ↗
              </a>
            </div>
            <p style={{ fontSize: 11, color: theme.textFaint }}>International Telco · Subsea Circuit Design</p>
          </div>

          {/* ── Two top-level tabs ── */}
          {(() => {
            const isBuilder  = mode === 'routebuilder' || mode === 'routemanual'
            const isExplorer = mode === 'citypair' || mode === 'systemviewer' || mode === 'countryviewer' || mode === 'nodefinder' || mode === 'outageviewer'
            const topTabStyle = (active: boolean): React.CSSProperties => ({
              flex: 1, padding: '9px 4px', border: 'none', cursor: 'pointer',
              fontFamily: 'inherit', fontSize: 11, fontWeight: 700,
              background: active ? theme.bgBase : 'transparent',
              color: active ? theme.blue : theme.textMuted,
              borderBottom: active ? `2px solid ${theme.blue}` : '2px solid transparent',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
            })
            return (
              <div style={{ flexShrink: 0 }}>
                {/* Top-level tabs */}
                <div style={{ display: 'flex', borderBottom: `1px solid ${theme.border}` }}>
                  <button style={topTabStyle(isBuilder)} onClick={() => { if (!isBuilder) safeSwitchMode('routebuilder') }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12h18M3 6l9-3 9 3M3 18l9 3 9-3"/></svg>
                    RouteBuilder
                  </button>
                  <button style={topTabStyle(isExplorer)} onClick={() => { if (!isExplorer) safeSwitchMode('countryviewer') }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                    NetworkExplorer
                  </button>
                  <button style={{ ...topTabStyle(false), flex: 'none', padding: '9px 10px' }} onClick={() => setGuideOpen(true)} title="Open guide">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                  </button>
                </div>
                {/* Sub-tabs */}
                <div style={{ display: 'flex', borderBottom: `1px solid ${theme.border}`, background: theme.bgDeep }}>
                  {isBuilder ? (
                    <>
                      <button style={tabStyle(mode === 'routebuilder')} onClick={() => safeSwitchMode('routebuilder')}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                        RouteFinder
                      </button>
                      <button style={tabStyle(mode === 'routemanual')} onClick={() => switchMode('routemanual')}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
                        RouteManual
                      </button>
                    </>
                  ) : (
                    <>
                      <button style={tabStyle(mode === 'countryviewer')}  onClick={() => switchMode('countryviewer')}>🌍 Country</button>
                      <button style={tabStyle(mode === 'citypair')}       onClick={() => switchMode('citypair')}>🏙 City Pairs</button>
                      <button style={tabStyle(mode === 'systemviewer')}   onClick={() => switchMode('systemviewer')}>🌊 Systems</button>
                      <button style={tabStyle(mode === 'nodefinder')}     onClick={() => switchMode('nodefinder')}>🔍 Nodes</button>
                      <button style={tabStyle(mode === 'outageviewer')}   onClick={() => switchMode('outageviewer')}>⚠️ Outages</button>
                    </>
                  )}
                </div>
              </div>
            )
          })()}

          {/* Left-panel body: swaps its contents based on the active mode.
              Each `mode === '...'` block below mounts that mode's control panel. */}
          <div style={{ flex: 1, overflowY: mode === 'routemanual' ? 'hidden' : 'auto', display: 'flex', flexDirection: 'column', padding: mode === 'routemanual' ? 0 : '16px' }}>
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
            {mode === 'routemanual' && (
              <RouteManualLeft
                nodes={nodes}
                segments={segments}
                systems={systems}
                capacity={capacity}
                state={manualState}
                candidates={manualCandidates}
                onStart={(nodeId) => setManualState({ originId: nodeId, steps: [] })}
                onPickHop={handleManualPickHop}
                onUndo={handleManualUndo}
                onFinish={handleManualFinish}
                onDiscard={() => { setManualState(null); setManualResults([]) }}
                onNetOwnership={config.on_net_ownership}
              />
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
            {mode === 'outageviewer' && (
              <OutagePanel outages={outages} segments={segments} systems={systems} />
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
          <AdminBar />
          <HealthBar dataLoaded={nodes.length > 0} mapsProvider={config.maps_provider} />
        </div>

        {/* Left panel collapse toggle */}
        <button
          onClick={() => setLeftOpen(v => !v)}
          title={leftOpen ? 'Hide search panel' : 'Show search panel'}
          style={{
            flexShrink: 0, alignSelf: 'center',
            zIndex: 500, background: theme.bgPanel,
            border: `1px solid ${theme.border}`, borderLeft: 'none',
            borderRadius: '0 6px 6px 0',
            color: theme.textFaint, cursor: 'pointer',
            padding: '10px 5px', fontSize: 13, fontWeight: 700, lineHeight: 1,
            display: 'flex', alignItems: 'center',
            boxShadow: '2px 0 6px rgba(0,0,0,0.2)',
          }}
        >{leftOpen ? '‹' : '›'}</button>

        {/* Middle panel */}
        <div style={{
          width: middleOpen ? 520 : 0, flexShrink: 0, display: 'flex', flexDirection: 'column',
          background: theme.bgDeep, borderRight: middleOpen ? `1px solid ${theme.border}` : 'none',
          overflow: 'hidden', transition: 'width 0.3s ease',
        }}>
          <ModeBanner
            activeProject={activeProject}
            onSwitch={() => { setAddToProjectRoute(null); setEnrichTarget(null); setProjectsOpen(true) }}
            onExit={() => { setActiveProject(null); setPinnedRoutes([]) }}
            theme={theme}
          />
          <div style={{
            padding: '7px 16px', borderBottom: `1px solid ${theme.border}`,
            display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
          }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: theme.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Routes</span>
            {hasResults && response && (
              <span style={{ fontSize: 11, color: theme.textFaint }}>
                <span style={{ color: theme.text, fontWeight: 600 }}>
                  {response.total_found || (response.primary_routes.length + response.diverse_routes.length)}
                </span> found
                {searchDuration !== null && <span> · {searchDuration < 1 ? `${(searchDuration * 1000).toFixed(0)}ms` : `${searchDuration.toFixed(2)}s`}</span>}
              </span>
            )}
            {hasPins    && <span style={{ fontSize: 11, color: theme.textFaintest }}>· {pinnedCircuitCount} pinned</span>}
            {loading    && <span style={{ fontSize: 11, color: theme.blue }}>Searching…</span>}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              {hasPins    && <button onClick={() => { setSldVersion(''); setSldVersionPrompt(true) }} title="Export SLD" style={clearBtnStyle(theme)}>⬡ SLD</button>}
              {hasResults && <button onClick={clearSearch} style={clearBtnStyle(theme)}>Clear Search</button>}
              {(hasResults || hasPins) && <button onClick={clearAll} style={clearBtnStyle(theme, true)}>Clear All</button>}
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
            {mode === 'systemviewer' && !hasPins && (
              <p style={{ color: theme.textFaintest, fontSize: 13, marginTop: 8 }}>Select a cable system on the left to highlight it on the map.</p>
            )}
            {(mode === 'routebuilder' || mode === 'citypair') && !hasResults && !loading && !hasPins && manualResults.length === 0 && (
              <p style={{ color: theme.textFaintest, fontSize: 13, marginTop: 8 }}>
                {mode === 'citypair'
                  ? 'Select a city pair on the left to find subsea system itineraries. Use Plan Route to open a full route search.'
                  : 'Configure a route request on the left and press Search.'}
              </p>
            )}
            {mode === 'routemanual' && manualResults.length === 0 && !hasPins && (
              <RouteManualMiddle
                state={manualState}
                segments={segments}
                nodes={nodes}
                onNetOwnership={config.on_net_ownership}
              />
            )}
            <RouteList
              primaryRoutes={mode === 'routemanual' ? manualResults : (response?.primary_routes ?? [])}
              diverseRoutes={mode === 'routemanual' ? [] : (response?.diverse_routes ?? [])}
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
              activeProject={activeProject}
              onExitProjectMode={() => { setActiveProject(null); setPinnedRoutes([]) }}
              onSwitchProject={() => { setAddToProjectRoute(null); setEnrichTarget(null); setProjectsOpen(true) }}
              onOpenRefDataForNote={(kind, id) => { setRefDataNoteFocus({ kind, id }); setRefDataOpen(true) }}
            />
          </div>
        </div>

        {/* Middle panel collapse toggle */}
        <button
          onClick={() => setMiddleOpen(v => !v)}
          title={middleOpen ? 'Hide routes panel' : 'Show routes panel'}
          style={{
            flexShrink: 0, alignSelf: 'center',
            zIndex: 500, background: theme.bgDeep,
            border: `1px solid ${theme.border}`, borderLeft: 'none',
            borderRadius: '0 6px 6px 0',
            color: theme.textFaint, cursor: 'pointer',
            padding: '10px 5px', fontSize: 13, fontWeight: 700, lineHeight: 1,
            display: 'flex', alignItems: 'center',
            boxShadow: '2px 0 6px rgba(0,0,0,0.2)',
          }}
        >{middleOpen ? '‹' : '›'}</button>

        {/* Map */}
        <div style={{ flex: 1, position: 'relative' }}>

          {/* Country Node Diagram button */}
          {mode === 'countryviewer' && countryHighlight && (
            <div style={{ position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 800, pointerEvents: 'auto' }}>
              <button
                onClick={() => setShowNodeDiagram(true)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '8px 18px', borderRadius: 20,
                  background: 'rgba(15,23,42,0.88)',
                  border: '1.5px solid rgba(6,182,212,0.7)',
                  color: '#67e8f9', cursor: 'pointer', fontSize: 13,
                  fontFamily: 'inherit', fontWeight: 700,
                  backdropFilter: 'blur(8px)',
                  boxShadow: '0 4px 16px rgba(0,0,0,0.45)',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(15,23,42,0.97)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'rgba(15,23,42,0.88)')}
              >
                <svg width={16} height={16} viewBox="0 0 16 16" fill="none">
                  <circle cx={4} cy={8} r={2.5} stroke="#67e8f9" strokeWidth={1.5} />
                  <circle cx={12} cy={4} r={2.5} stroke="#67e8f9" strokeWidth={1.5} />
                  <circle cx={12} cy={12} r={2.5} stroke="#67e8f9" strokeWidth={1.5} />
                  <line x1={6.5} y1={7} x2={9.5} y2={5} stroke="#67e8f9" strokeWidth={1} />
                  <line x1={6.5} y1={9} x2={9.5} y2={11} stroke="#67e8f9" strokeWidth={1} />
                </svg>
                View {countryHighlight.countryName} as Node Diagram
              </button>
            </div>
          )}

          {nodes.length > 0 ? (
            <Map
              nodes={nodes} segments={segments} selectedRoutes={selectedRoutes}
              capacity={capacity} pinnedRoutes={pinnedRoutes} selectedSystems={selectedSystems}
              outages={outages}
              onNodeClick={mode === 'routemanual' ? undefined : (node, x, y) => setSelectedNode({ node, x, y })}
              searchPin={searchPin ?? undefined}
              nearestNodeIds={nearestNodeIds}
              hideNonActive={hideNonActive}
              showSegmentLabels={showSegmentLabels}
              showNodeLabels={showNodeLabels}
              showAllOutages={showAllOutages}
              subseaOnly={subseaOnly}
              backhaulOnly={backhaulOnly}
              countryHighlight={countryHighlight}
              panelWidth={(leftOpen ? 440 : 0) + (middleOpen ? 520 : 0)}
              manualState={mode === 'routemanual' ? manualState : null}
              manualCandidates={mode === 'routemanual' ? manualCandidates : []}
              onManualNodeClick={mode === 'routemanual' ? handleManualNodeClick : undefined}
              mapsProvider={config.maps_provider}
            />
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: theme.textFaint }}>
              Loading network…
            </div>
          )}
        </div>

      </div>

      {/* ── Modal / overlay stack ──────────────────────────────────────────────
          Everything below is conditionally-mounted overlays: node info popup,
          country node diagram, capacity dashboard, algo-eval, ref-data editor,
          projects modal, SLD export prompt, manual-finish + discard-warning
          dialogs, project pin-label prompt, and the full-screen user guide. */}
      {selectedNode && (
        <NodeInfoPanel
          node={selectedNode.node} segments={segments} systems={systems}
          initialX={selectedNode.x} initialY={selectedNode.y}
          onClose={() => setSelectedNode(null)}
        />
      )}

      {showNodeDiagram && countryHighlight && (
        <CountryNodeDiagram
          nodes={nodes} segments={segments} systems={systems} capacity={capacity}
          countryHighlight={countryHighlight}
          onClose={() => setShowNodeDiagram(false)}
        />
      )}

      {capDashOpen && (
        <CapacityDashboard
          segments={segments} capacity={capacity}
          onClose={() => setCapDashOpen(false)}
        />
      )}

      {algoEvalOpen && (
        <AlgoEval
          nodes={nodes} segments={segments} systems={systems}
          onClose={() => setAlgoEvalOpen(false)}
        />
      )}

      {refDataOpen && (
        <RefDataModal
          nodes={nodes} segments={segments} systems={systems}
          capacity={capacity} outages={outages} rules={rules} config={config}
          onDataChange={handleDataChange}
          initialNoteFocus={refDataNoteFocus ?? undefined}
          onClose={() => { setRefDataOpen(false); setRefDataNoteFocus(null) }}
        />
      )}

      {projectsOpen && (
        <ProjectsModal
          nodes={nodes}
          pendingCircuit={addToProjectRoute ?? undefined}
          initialProject={enrichTarget?.projectId ?? null}
          initialCircuitId={enrichTarget?.circuitId ?? null}
          initialProjects={cachedProjects}
          onProjectsChange={setCachedProjects}
          onClose={() => { setProjectsOpen(false); setAddToProjectRoute(null); setEnrichTarget(null) }}
          onActivateProject={(project) => {
            setActiveProject(project)
            setProjectsOpen(false)
            restorePinsFromProject(project)
          }}
          onRestorePins={(circuits, projectId) => restorePinsFromProject({ id: projectId, circuits } as import('./types').Project)}
          onCircuitAdded={handleCircuitAdded}
        />
      )}

      {/* ── SLD version prompt ────────────────────────────────────────────── */}
      {/* ── RouteManual finish confirmation ─────────────────────────────── */}
      {manualFinishConfirm && createPortal(
        <div style={{ position: 'fixed', inset: 0, zIndex: 9500, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 14, padding: '24px 28px', width: 'min(95vw, 420px)', boxShadow: '0 24px 64px rgba(0,0,0,0.5)' }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: theme.text, marginBottom: 4 }}>Route Complete</div>
            <div style={{ fontSize: 12, color: theme.textMuted, marginBottom: 16 }}>
              Manually assembled via RouteManual. Review stats then pin or add to project.
            </div>
            {/* Stats */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 18 }}>
              {[
                { label: 'Hops',    value: `${manualFinishConfirm.nodes.length - 1}` },
                { label: 'km',      value: `${manualFinishConfirm.total_length_km.toLocaleString()}` },
                { label: 'ms',      value: `${manualFinishConfirm.total_latency.toFixed(1)}` },
                { label: 'Avail',   value: `${(manualFinishConfirm.end_to_end_reliability * 100).toFixed(2)}%` },
              ].map(({ label, value }) => (
                <div key={label} style={{ background: theme.bgBase, borderRadius: 8, padding: '10px 8px', textAlign: 'center' }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: theme.text }}>{value}</div>
                  <div style={{ fontSize: 9, color: theme.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
                </div>
              ))}
            </div>
            {/* Systems used */}
            <div style={{ fontSize: 10, color: theme.textMuted, marginBottom: 16 }}>
              Systems: {[...new Set(manualFinishConfirm.segments.map(s => s.system_id))].join(' · ')}
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button
                onClick={() => { confirmManualRoute(manualFinishConfirm) }}
                style={{ padding: '8px 16px', borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: 'pointer', border: 'none', background: theme.blue, color: theme.bgCard, fontFamily: 'inherit' }}
              >✓ Use Route</button>
              <button
                onClick={() => { setManualFinishConfirm(null) }}
                style={{ padding: '8px 16px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: `1px solid ${theme.border}`, background: 'transparent', color: theme.textMuted, fontFamily: 'inherit' }}
              >← Keep Building</button>
              <button
                onClick={() => { setManualFinishConfirm(null); setManualState(null) }}
                style={{ padding: '8px 16px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: `1px solid ${theme.red}44`, background: 'transparent', color: theme.red, fontFamily: 'inherit' }}
              >✕ Discard</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {warnSwitchMode !== null && createPortal(
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9600,
          background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '0 24px',
        }}>
          <div style={{
            background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 12,
            padding: '28px 24px', width: '100%', maxWidth: 400, boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
          }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: theme.text, marginBottom: 10 }}>Discard route?</div>
            <div style={{ fontSize: 13, color: theme.textMuted, marginBottom: 24, lineHeight: 1.6 }}>
              You're mid-build in RouteManual. Switching tabs will discard the route in progress.
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => { const m = warnSwitchMode; setWarnSwitchMode(null); switchMode(m) }}
                style={{ flex: 1, padding: '10px', borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: 'pointer', border: 'none', background: theme.red, color: '#fff', fontFamily: 'inherit' }}
              >Yes, discard route</button>
              <button
                onClick={() => setWarnSwitchMode(null)}
                style={{ flex: 1, padding: '10px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: `1px solid ${theme.border}`, background: 'transparent', color: theme.textMuted, fontFamily: 'inherit' }}
              >Keep building</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {sldVersionPrompt && createPortal(
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9500,
          background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 12,
            padding: '24px 28px', width: 'min(95vw, 380px)', boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
          }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: theme.text, marginBottom: 4 }}>Export SLD</div>
            <div style={{ fontSize: 12, color: theme.textMuted, marginBottom: 16 }}>
              Add an optional version label to the PDF.
            </div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
              {['Proposal', 'Draft', 'Final'].map(v => (
                <button key={v} onClick={() => setSldVersion(v)}
                  style={{
                    padding: '5px 12px', borderRadius: 5, fontSize: 12, fontWeight: 600,
                    cursor: 'pointer', fontFamily: 'inherit',
                    border: `1px solid ${sldVersion === v ? theme.blue : theme.border}`,
                    background: sldVersion === v ? `${theme.blue}22` : 'transparent',
                    color: sldVersion === v ? theme.blue : theme.textMuted,
                  }}
                >{v}</button>
              ))}
            </div>
            <input
              style={{
                width: '100%', background: theme.bgBase, border: `1px solid ${theme.border}`,
                borderRadius: 6, padding: '8px 11px', color: theme.text, fontSize: 13,
                outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit', marginBottom: 16,
              }}
              placeholder="Or type a custom version…"
              value={sldVersion}
              onChange={e => setSldVersion(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  if (activeProject) generateSldFromProject(activeProject, pinnedRoutes, nodes, sldVersion || undefined)
                  else generateStraightLineDiagram(pinnedRoutes, nodes, sldVersion || undefined)
                  setSldVersionPrompt(false)
                }
                if (e.key === 'Escape') setSldVersionPrompt(false)
              }}
            />
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button
                onClick={() => {
                  if (activeProject) generateSldFromProject(activeProject, pinnedRoutes, nodes, sldVersion || undefined)
                  else generateStraightLineDiagram(pinnedRoutes, nodes, sldVersion || undefined)
                  setSldVersionPrompt(false)
                }}
                style={{ padding: '8px 18px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: 'none', background: theme.blue, color: theme.bgCard, fontFamily: 'inherit' }}
              >Export PDF</button>
              <button
                onClick={() => {
                  const xml  = generateDrawioXml(pinnedRoutes, nodes, activeProject ?? undefined)
                  const blob = new Blob([xml], { type: 'application/xml' })
                  const url  = URL.createObjectURL(blob)
                  const a    = document.createElement('a')
                  a.href     = url
                  a.download = `SLD-${new Date().toISOString().slice(0,10)}.drawio`
                  a.click()
                  URL.revokeObjectURL(url)
                  setSldVersionPrompt(false)
                }}
                style={{ padding: '8px 18px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: `1px solid ${theme.blue}`, background: 'transparent', color: theme.blue, fontFamily: 'inherit' }}
              >Export DrawIO</button>
              <button
                onClick={() => {
                  generateVisioVsdx(pinnedRoutes, nodes, activeProject ?? undefined)
                  setSldVersionPrompt(false)
                }}
                style={{ padding: '8px 18px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: `1px solid ${theme.blue}`, background: 'transparent', color: theme.blue, fontFamily: 'inherit' }}
              >Export Visio</button>
              <button
                onClick={() => setSldVersionPrompt(false)}
                style={{ padding: '8px 18px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: `1px solid ${theme.border}`, background: 'transparent', color: theme.textMuted, fontFamily: 'inherit' }}
              >Cancel</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ── Project pin label prompt ───────────────────────────────────────── */}
      {pendingPin && activeProject && createPortal(
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9500,
          background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 12,
            padding: '24px 28px', width: 'min(95vw, 420px)', boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
          }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: theme.text, marginBottom: 4 }}>
              Add to {activeProject.name || 'Project'}
            </div>
            <div style={{ fontSize: 12, color: theme.textMuted, marginBottom: 16 }}>
              {pendingPin.searchLabel}
              {pendingPin.protect && <span style={{ color: '#f9e2af', marginLeft: 8 }}>+ Protect</span>}
            </div>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: theme.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
                Circuit Label <span style={{ fontWeight: 400, textTransform: 'none' }}>(optional)</span>
              </div>
              <input
                autoFocus
                style={{
                  width: '100%', background: theme.bgBase, border: `1px solid ${theme.border}`,
                  borderRadius: 6, padding: '8px 11px', color: theme.text, fontSize: 13,
                  outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
                }}
                placeholder="e.g. TOK-HKG-EPL-01 or RFP-2025-003"
                value={pendingPinLabel}
                onChange={e => setPendingPinLabel(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') confirmPinToProject(); if (e.key === 'Escape') { setPendingPin(null); setPendingPinLabel('') } }}
              />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={confirmPinToProject}
                disabled={pendingPinSaving}
                style={{
                  padding: '8px 18px', borderRadius: 6, fontSize: 13, fontWeight: 600,
                  cursor: 'pointer', border: 'none', background: theme.blue, color: theme.bgCard,
                  fontFamily: 'inherit',
                }}
              >{pendingPinSaving ? 'Saving…' : 'Add Circuit'}</button>
              <button
                onClick={() => { setPendingPin(null); setPendingPinLabel('') }}
                style={{
                  padding: '8px 18px', borderRadius: 6, fontSize: 13, fontWeight: 600,
                  cursor: 'pointer', border: `1px solid ${theme.border}`, background: 'transparent',
                  color: theme.textMuted, fontFamily: 'inherit',
                }}
              >Cancel</button>
            </div>
          </div>
        </div>,
        document.body
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

/**
 * Footer of the left panel: the admin lock/unlock control. Reads AuthContext.
 * If no passphrase is configured (authRequired === false) it renders nothing.
 * Otherwise it shows "Read-only" until the user enters the admin passphrase,
 * after which editing (in RefDataModal etc.) is enabled and it shows "Admin mode".
 */
function AdminBar() {
  const { isAdmin, authRequired, unlock, lock } = useAuth()
  const t = useTheme()
  const [showUnlock, setShowUnlock] = useState(false)
  const [key, setKey] = useState('')
  const [err, setErr] = useState(false)
  const [busy, setBusy] = useState(false)

  if (!authRequired) return null

  async function attempt() {
    setBusy(true); setErr(false)
    const ok = await unlock(key)
    setBusy(false)
    if (ok) { setShowUnlock(false); setKey('') } else setErr(true)
  }

  return (
    <div style={{ padding: '6px 12px', borderTop: `1px solid ${t.border}`, background: isAdmin ? `${t.green}11` : `${t.orange}11`, flexShrink: 0 }}>
      {showUnlock ? (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            type="password" autoFocus value={key}
            onChange={e => { setKey(e.target.value); setErr(false) }}
            onKeyDown={e => { if (e.key === 'Enter') attempt(); if (e.key === 'Escape') { setShowUnlock(false); setKey('') } }}
            placeholder="Admin passphrase"
            style={{ flex: 1, padding: '5px 8px', borderRadius: 5, border: `1px solid ${err ? t.red : t.border}`, background: t.bgDeep, color: t.text, fontSize: 11, outline: 'none', fontFamily: 'inherit' }}
          />
          <button onClick={attempt} disabled={busy || !key} style={{ padding: '5px 10px', borderRadius: 5, border: 'none', background: t.blue, color: '#fff', fontSize: 11, fontWeight: 700, cursor: busy ? 'wait' : 'pointer', opacity: !key ? 0.5 : 1 }}>{busy ? '…' : 'Unlock'}</button>
          <button onClick={() => { setShowUnlock(false); setKey('') }} style={{ padding: '5px 8px', borderRadius: 5, border: `1px solid ${t.border}`, background: 'transparent', color: t.textFaint, fontSize: 11, cursor: 'pointer' }}>✕</button>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13 }}>{isAdmin ? '🔓' : '🔒'}</span>
          <span style={{ fontSize: 10, fontWeight: 700, color: isAdmin ? t.green : t.orange, textTransform: 'uppercase', letterSpacing: '0.08em', flex: 1 }}>
            {isAdmin ? 'Admin mode' : 'Read-only'}
          </span>
          {isAdmin
            ? <button onClick={lock} style={{ fontSize: 10, padding: '3px 8px', borderRadius: 4, border: `1px solid ${t.border}`, background: 'transparent', color: t.textFaint, cursor: 'pointer' }}>Lock</button>
            : <button onClick={() => setShowUnlock(true)} style={{ fontSize: 10, padding: '3px 8px', borderRadius: 4, border: `1px solid ${t.orange}`, background: `${t.orange}15`, color: t.orange, cursor: 'pointer', fontWeight: 700 }}>Unlock</button>
          }
        </div>
      )}
      {err && <div style={{ fontSize: 10, color: t.red, marginTop: 3 }}>Incorrect passphrase</div>}
    </div>
  )
}

/** Shared style for the small "Clear Search / Clear All / SLD" text buttons in
 *  the routes-panel header. `destructive` tints it red (used for Clear All). */
function clearBtnStyle(theme: Theme, destructive = false): React.CSSProperties {
  return {
    padding: '4px 10px', borderRadius: 4, border: `1px solid ${theme.border}`,
    background: 'transparent', color: destructive ? theme.red : theme.textMuted,
    cursor: 'pointer', fontSize: 11, fontWeight: 600,
  }
}

