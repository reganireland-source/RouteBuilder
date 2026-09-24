import { lazy, Suspense, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAuth } from './context/AuthContext'
import { NetworkMap } from './components/Map'
import type { MapStyle } from './components/Map'
import { SearchForm } from './components/SearchForm'
import { RouteList } from './components/RouteList'
import type { SortKey } from './components/RouteList'
import { SystemViewer } from './components/SystemViewer'
import { CountryViewer } from './components/CountryViewer'
import { NetworkEditor } from './components/NetworkEditor'
import { EditorPendingPanel } from './components/EditorPendingPanel'
import { editorReducer, initialEditorState, applyPendingChanges, pendingAffectedIds } from './state/editorState'
import type { EditorState } from './state/editorState'
import { saveAll } from './state/networkEditorSave'
import { NodeInfoPanel } from './components/NodeInfoPanel'
import { SegmentInfoPanel } from './components/SegmentInfoPanel'
// Lazy: the chop tool and its matcher types are only ever opened by an
// admin importing files, so it has no business in the initial bundle.
const KmlChopSourcePanel = lazy(() => import('./components/KmlChopImport').then(m => ({ default: m.KmlChopSourcePanel })))
const KmlChopTablePanel = lazy(() => import('./components/KmlChopImport').then(m => ({ default: m.KmlChopTablePanel })))
const KmlLibrary = lazy(() => import('./components/KmlLibrary').then(m => ({ default: m.KmlLibrary })))
// Same reasoning: only an admin modeling a cable we don't own ever opens this.
const CableImportWizard = lazy(() => import('./components/CableImportWizard').then(m => ({ default: m.CableImportWizard })))
import { NodeFinder } from './components/NodeFinder'
import { CityPairPanel } from './components/CityPairPanel'
import { HealthBar } from './components/HealthBar'
import { MobileLayout } from './components/MobileLayout'
import { AssetSearch } from './components/AssetSearch'
import { AssetFilterBar } from './components/AssetFilterBar'
import { Tooltip } from './components/Tooltip'
import { parseCityId, type AssetHit } from './utils/assetSearch'
import { ServiceDateSelector } from './components/ServiceDateSelector'
import { FutureNetworkBanner } from './components/FutureNetworkBanner'
import {
  CURRENT_CHOICE, resolveServiceDate, filterSegmentsInService, isFutureView, todayIso,
  type ServiceDateChoice,
} from './utils/serviceDate'
import { normalizeLngPath } from './mapGeometry'
import { useSegmentHover } from './context/SegmentHoverContext'
import { useTooltipSettings } from './context/TooltipSettingsContext'
import { api } from './api/client'
import { ThemeContext, darkTheme, duskTheme, lightTheme, useTheme, type Theme, type ThemeMode } from './theme'
import { useHazards } from './hooks/useHazards'
import { useKmlChopState } from './hooks/useKmlChopState'
import { HazardProvider } from './context/HazardContext'
import type { AppConfig, AppMode, AssetFilterMatch, CableNode, CableSegment, CableSystem, CountryHighlight, InterconnectRule, NlpSortMode, PinnedRoute, Project, Route, RouteRequest, RouteResponse, SegmentCapacity, SegmentOutage, SelectedSystem, Hazard, HazardAssetView, HazardOwnerView, KmlPathInfo, KmlPreviewLine} from './types'
import type { KmlChopMapLayerProps } from './components/KmlChopMapLayer'
import { ProjectsModal } from './components/ProjectsModal'
import { RouteManualLeft, RouteManualMiddle, computeCandidates, assembleRoute } from './components/RouteManual'
import type { NextHopCandidate, ManualState } from './components/RouteManual'
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

/**
 * The four heaviest screens, loaded on demand.
 *
 * All of them live behind a click and most sessions never open any: the guide
 * is 272 KB of source, Reference Data 153 KB, the algorithm evaluator 110 KB.
 * Shipping them in the initial bundle made every visitor download an admin
 * editor and a documentation site to look at a map. Each becomes its own chunk,
 * fetched the first time it is opened — by which point the user has clicked a
 * button and a few hundred milliseconds is invisible.
 *
 * `Suspense fallback={null}` is deliberate: these are modals over an app that
 * is already drawn, so a spinner would be a flash of chrome announcing
 * something the click already implied.
 */
const UserGuide = lazy(() => import('./components/UserGuide').then(m => ({ default: m.UserGuide })))
const RefDataModal = lazy(() => import('./components/RefDataModal').then(m => ({ default: m.RefDataModal })))
const AlgoEval = lazy(() => import('./components/AlgoEval').then(m => ({ default: m.AlgoEval })))
const CapacityDashboard = lazy(() => import('./components/CapacityDashboard').then(m => ({ default: m.CapacityDashboard })))

// Palette cycled through when assigning a distinct colour to each pinned route.
const PIN_COLORS    = ['#f9e2af', '#94e2d5', '#cba6f7', '#f2cdcd', '#eba0ac', '#89dceb', '#a6e3a1', '#fab387', '#cdd6f4', '#b4befe']
// Hard cap on how many routes can be pinned/compared on the map at once.
const MAX_PINS = 10
// Palette for the up-to-5 cable systems highlighted in systemviewer mode.
const SYSTEM_COLORS = ['#89b4fa', '#a6e3a1', '#f9e2af', '#94e2d5', '#cba6f7']

/** Stable identity for a route: its ordered node list joined into a string.
 *  Used to detect "is this exact path already pinned?" regardless of object id. */
function routeKey(r: Route) { return r.nodes.join('|') }

/** localStorage key for the Living World toggle. */
const LIVING_WORLD_KEY = 'rb.livingWorld'
/**
 * Load the SLD exporters on demand.
 *
 * `utils/generateDiagram.ts` pulls in jsPDF and JSZip, which together are a
 * large fraction of the bundle — and exporting a diagram is a rare, deliberate
 * action, not something every visitor does. Importing it lazily keeps that
 * weight out of the initial download for everyone who never presses Export.
 * Vite splits it into its own chunk automatically.
 */
const loadExporters = () => import('./utils/generateDiagram')

/** Shared empty list, so "no hazards" is one stable reference. */
const EMPTY_HAZARDS: Hazard[] = []

/** localStorage key for the Network Hazards overlay. */
const HAZARDS_KEY = 'rb.hazards'

/** SESSION storage key for how much of the network the hazard layer draws.
 *  Session, not local, on purpose — see loadHazardAssetView. */
const HAZARD_ASSET_VIEW_KEY = 'rb.hazardAssetView'

/**
 * Always starts at "in range" in a new session, then remembers within it.
 *
 * This deliberately does NOT persist across sessions, unlike every other view
 * toggle in the app. "All" and "Hidden" are things you switch to in order to
 * answer one question — what does the whole picture look like, what do the
 * hazards look like on their own — not states you want to come back to days
 * later. A browser that kept "All" would open the layer with nothing
 * highlighted, which reads as the feature being broken rather than as a setting
 * being remembered; that is exactly what happened in practice.
 *
 * Session storage keeps the choice while you are actually working (it survives
 * reloads in the tab, so it does not fight you) and drops it when the tab goes.
 * The On-Net/All filter below is the opposite: a standing preference about
 * whose assets you care about, so that one does persist in localStorage.
 */
function loadHazardAssetView(): HazardAssetView {
  try {
    // Clear the value written by the older localStorage-backed version, so a
    // browser carrying a stale "all" is not stuck with it forever.
    localStorage.removeItem(HAZARD_ASSET_VIEW_KEY)
    const raw = sessionStorage.getItem(HAZARD_ASSET_VIEW_KEY)
    return raw === 'all' || raw === 'none' ? raw : 'inRange'
  } catch { return 'inRange' }
}

/** localStorage key for which in-range assets the hazard lens highlights. */
const HAZARD_OWNER_VIEW_KEY = 'rb.hazardOwnerView'

/** Defaults to on-net: the layer answers "what of MINE is at risk", so a
 *  third-party site near a fire is someone else's incident until asked for. */
function loadHazardOwnerView(): HazardOwnerView {
  try {
    return localStorage.getItem(HAZARD_OWNER_VIEW_KEY) === 'all' ? 'all' : 'onNet'
  } catch { return 'onNet' }
}

/** localStorage key for KML Mode — draw surveyed routes where we have them. */
const KML_MODE_KEY = 'rb.kmlMode'

/** ON by default. Where a surveyed route exists it is simply better data than
 *  the waypoint spline standing in for it, so the useful default is to draw it;
 *  the toggle exists to get back the clean schematic view, not to opt in to
 *  accuracy. Costs nothing when no KML has been uploaded — every segment falls
 *  through to its waypoints exactly as before. */
function loadKmlMode(): boolean {
  try { return localStorage.getItem(KML_MODE_KEY) !== '0' }
  catch { return true }
}

/** Network Hazards is OFF unless this browser has explicitly turned it on —
 *  the opposite default to Living World, because this one calls two third-party
 *  feeds and nobody should pay for that without asking. */
function loadHazardsOn(): boolean {
  try { return localStorage.getItem(HAZARDS_KEY) === '1' }
  catch { return false }
}

/** Living World is ON unless this browser has explicitly turned it off. Reads
 *  defensively: storage throws in a private window, and the failure mode there
 *  should be "you get whales", not "the app does not start". */
function loadLivingWorld(): boolean {
  try { return localStorage.getItem(LIVING_WORLD_KEY) !== '0' }
  catch { return true }
}

/** The palette object for a theme mode. */
function themeFor(mode: ThemeMode): Theme {
  if (mode === 'dark') return darkTheme
  if (mode === 'dusk') return duskTheme
  return lightTheme
}

/** The next mode in the dark → dusk → light → dark cycle. */
function nextThemeMode(mode: ThemeMode): ThemeMode {
  if (mode === 'dark') return 'dusk'
  if (mode === 'dusk') return 'light'
  return 'dark'
}

/** Icon on the theme button — it previews the mode being switched TO. */
function themeToggleIcon(mode: ThemeMode): string {
  if (mode === 'dark') return '🌅'
  if (mode === 'dusk') return '☀️'
  return '🌙'
}

/** Caption on the theme button — names the mode being switched TO. */
function themeToggleLabel(mode: ThemeMode): string {
  if (mode === 'dark') return 'Switch to Dusk'
  if (mode === 'dusk') return 'Switch to Light'
  return 'Switch to Dark'
}

/** The circuit label stamped on a WORKER pin. Unprotected circuits keep the
 *  circuit's own label as-is; a protected pair suffixes "(Worker)" so the two
 *  halves are told apart — and an unlabelled circuit gets no worker label at
 *  all, so the pin falls back to its search label instead of showing "(Worker)"
 *  on its own. */
function workerCircuitLabel(label: string | undefined, hasProtect: boolean): string | undefined {
  if (!hasProtect) return label
  return label ? `${label} (Worker)` : undefined
}

/** The display label for a worker pin: the circuit label when there is one,
 *  otherwise the search label, suffixed "(Worker)" for a protected pair. */
function workerPinLabel(circuitLabel: string | undefined, searchLabel: string, hasProtect: boolean): string {
  const base = circuitLabel || searchLabel
  return hasProtect ? `${base} (Worker)` : base
}

/** Body of the "discard pending changes?" warning shown when leaving Network
 *  Editor with staged edits. Singular/plural agreement on the count. */
function unsavedEditorChangesWarning(pendingCount: number): string {
  const plural  = pendingCount === 1 ? '' : 's'
  const pronoun = pendingCount === 1 ? 'it' : 'them'
  return `You have ${pendingCount} unsaved change${plural} in Network Editor. Switching tabs will discard ${pronoun} — nothing has been saved yet.`
}

/** Every node position in one city (Asset Search's "city" hit). */
function cityPoints(nodes: CableNode[], cityId: string): [number, number][] {
  const { city, country } = parseCityId(cityId)
  return nodes.filter(n => n.city === city && n.country === country)
    .map((n): [number, number] => [n.lat, n.lng])
}

/** One segment's full path, for fitting the map to it: the surveyed KML
 *  route when one is passed in (KML Mode on and a survey exists for this
 *  segment), otherwise its start node, waypoints, then end node. A cable
 *  with a real detour can run well outside its own straight-line/waypoint
 *  bounds, so fitting to the wrong geometry can crop the very route about
 *  to be spotlighted (see handleAssetSelect's 'segment' case) out of view. */
function segmentPoints(seg: CableSegment, nodes: CableNode[], kmlDisplayPath?: [number, number][]): [number, number][] {
  if (kmlDisplayPath && kmlDisplayPath.length > 0) return kmlDisplayPath
  const start = nodes.find(n => n.id === seg.start_node_id)
  const end = nodes.find(n => n.id === seg.end_node_id)
  return [
    ...(start ? [[start.lat, start.lng] as [number, number]] : []),
    ...(seg.waypoints ?? []),
    ...(end ? [[end.lat, end.lng] as [number, number]] : []),
  ]
}

/** Asset Search's 'segment' hit fits to (and, via setHoveredSegmentId,
 *  spotlights) the surveyed KML route when KML Mode is on and one exists
 *  for this segment, the straight/waypoint path otherwise — matching what
 *  the main map already draws for that segment's own line. Kept separate
 *  from handleAssetSelect's switch so this lookup doesn't push that
 *  function over its own cognitive-complexity budget. */
function segmentSpotlightPoints(
  seg: CableSegment, nodes: CableNode[], kmlMode: boolean, kmlPaths: Record<string, KmlPathInfo>,
): [number, number][] {
  const kml = kmlMode ? kmlPaths[seg.id] : undefined
  return segmentPoints(seg, nodes, kml?.display_path)
}

/** Every endpoint of every segment belonging to one cable system — the extent
 *  the map fits to when Asset Search picks a system. */
function systemPoints(segments: CableSegment[], nodes: CableNode[], systemId: string): [number, number][] {
  const pts: [number, number][] = []
  for (const seg of segments.filter(s => s.system_id === systemId)) {
    const a = nodes.find(n => n.id === seg.start_node_id)
    const z = nodes.find(n => n.id === seg.end_node_id)
    if (a) pts.push([a.lat, a.lng])
    if (z) pts.push([z.lat, z.lng])
    for (const w of seg.waypoints ?? []) pts.push(w)
  }
  return pts
}

/** Style for one of the left panel's mode sub-tabs (RouteFinder, Country, …). */
function subTabStyle(theme: Theme, active: boolean): React.CSSProperties {
  return {
    flex: 1, padding: '7px 3px 6px', border: 'none', cursor: 'pointer',
    background: active ? theme.bgBase : theme.bgPanel,
    color: active ? theme.text : theme.textFaint,
    fontSize: 9, fontWeight: active ? 700 : 400,
    textTransform: 'uppercase', letterSpacing: '0.04em',
    lineHeight: 1.2,
    borderBottom: active ? `2px solid ${theme.blue}` : `2px solid transparent`,
    transition: 'all 0.15s',
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
  }
}

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

/**
 * Pushes `desired` into `setValue` whenever `signature` changes, then leaves
 * `value` alone until the next signature change — so a later manual call to
 * `setValue` sticks instead of being fought on every render. Adjusts state
 * directly during render (React's documented pattern for resetting state on
 * a computed change) rather than in a useEffect, which would cost an extra
 * cascading render for the same result.
 */
function useAutoSync<T>(signature: string, desired: T, value: T, setValue: (v: T) => void) {
  const [lastSignature, setLastSignature] = useState<string | null>(null)
  if (signature !== lastSignature) {
    setLastSignature(signature)
    if (value !== desired) setValue(desired)
  }
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
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 499, border: 'none', background: 'transparent', padding: 0, cursor: 'default' }}
          />
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
  const theme = themeFor(themeMode)
  function cycleTheme() { setThemeMode(m => nextThemeMode(m)) }
  const { tooltipsEnabled, setTooltipsEnabled } = useTooltipSettings()

  // Map base rendering (Standard / Satellite / Contrast) — persisted the same
  // try/catch-wrapped way as every other sticky map preference in this app.
  const [mapStyle, setMapStyle] = useState<MapStyle>(() => {
    try {
      const raw = localStorage.getItem('rb.mapStyle')
      return raw === 'satellite' || raw === 'contrast' ? raw : 'standard'
    } catch { return 'standard' }
  })
  useEffect(() => {
    try { localStorage.setItem('rb.mapStyle', mapStyle) } catch { /* private mode */ }
  }, [mapStyle])

  // Bridges the active theme to plain CSS custom properties on <html>, for the
  // handful of browser-native surfaces React inline styles can't reach —
  // :focus-visible, ::selection, and the scrollbar pseudo-elements in
  // index.html's global stylesheet. `color-scheme` lets the browser's own
  // remaining chrome (native form controls, the scrollbar fallback on
  // browsers without ::-webkit-scrollbar/scrollbar-color support) pick a
  // matching light/dark rendering instead of always assuming light.
  useEffect(() => {
    const root = document.documentElement.style
    root.setProperty('--rb-accent', theme.blue)
    root.setProperty('--rb-bg-deep', theme.bgDeep)
    root.setProperty('--rb-border-subtle', theme.borderSubtle)
    root.setProperty('--rb-text-faintest', theme.textFaintest)
    document.documentElement.style.colorScheme = themeMode === 'light' ? 'light' : 'dark'
  }, [theme, themeMode])

  // Persist the Living World choice. Wrapped because storage throws in a
  // private window and a decorative toggle must never take the app down.
  function changeHazardAssetView(next: HazardAssetView) {
    setHazardAssetView(next)
    // sessionStorage: survives reloads in this tab, gone next session. See
    // loadHazardAssetView for why this one does not persist like the others.
    try { sessionStorage.setItem(HAZARD_ASSET_VIEW_KEY, next) } catch { /* private mode */ }
  }

  function changeHazardOwnerView(next: HazardOwnerView) {
    setHazardOwnerView(next)
    try { localStorage.setItem(HAZARD_OWNER_VIEW_KEY, next) } catch { /* private mode */ }
  }

  function toggleKmlMode() {
    setKmlMode(on => {
      const next = !on
      try { localStorage.setItem(KML_MODE_KEY, next ? '1' : '0') } catch { /* private mode */ }
      return next
    })
  }

  function toggleHazards() {
    setHazardsOn(on => {
      const next = !on
      try { localStorage.setItem(HAZARDS_KEY, next ? '1' : '0') } catch { /* private mode */ }
      return next
    })
  }

  function toggleLivingWorld() {
    setLivingWorld(on => {
      const next = !on
      try { localStorage.setItem(LIVING_WORLD_KEY, next ? '1' : '0') } catch { /* private mode */ }
      return next
    })
  }

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
  const { isAdmin }                   = useAuth()   // gates the admin-only Network Editor tab
  const [editorState, dispatchEditor] = useReducer(editorReducer, initialEditorState)   // staged Network Editor changes

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
  const [kmlImportOpen, setKmlImportOpen] = useState(false)
  const [kmlLibraryOpen, setKmlLibraryOpen] = useState(false)
  const [cableImportOpen, setCableImportOpen] = useState(false)
  // Geometry being examined during an import — drawn over the network so the
  // cuts can be checked against it, and never stored. `key` is bumped per
  // request so re-previewing the same path still re-fits the map.
  const [kmlPreview, setKmlPreview] = useState<{ lines: KmlPreviewLine[]; key: number }>({ lines: [], key: 0 })
  // Whatever the Chop Import session currently wants drawn on the map — see
  // KmlChopMapLayer.tsx. null whenever nothing has been flattened yet.
  const [kmlChopMapProps, setKmlChopMapProps] = useState<KmlChopMapLayerProps | null>(null)
  // All of Chop Import's state, called unconditionally here (React's rules of
  // hooks) since its two panels are mounted in different columns below — see
  // useKmlChopState.ts's own docstring for why. Cheap to call even when the
  // panel is closed: it does no work until a source is actually chosen.
  const kmlChop = useKmlChopState({ segments, systems, nodes, onDataChange: handleDataChange, onMapPropsChange: setKmlChopMapProps })
  const [selectedSegment, setSelectedSegment] = useState<{ segment: CableSegment; x: number; y: number } | null>(null) // segment whose info card is open
  // Fly-to request from a node-code lookup. `key` increments every time so
  // asking for the same node twice still flies.
  const [flyToNode, setFlyToNode] = useState<{ lat: number; lng: number; key: number } | undefined>(undefined)

  const [fitBounds, setFitBounds] = useState<{ bounds: [[number, number], [number, number]]; key: number } | undefined>(undefined)
  // Country the Asset Search asked Country Viewer to open. Cleared once
  // CountryViewer has consumed it so re-picking the same country works.
  const [prefilledCountry, setPrefilledCountry] = useState<string | null>(null)
  // Node called out by a mobile Asset Search hit: flown to and tooltip-pinned,
  // WITHOUT opening the full node panel (which would cover the map and hide the
  // fly-to the user just asked for).
  const [spotlightNodeId, setSpotlightNodeId] = useState<string | null>(null)

  // Current vs Planned network. Deliberately NOT persisted: every reload starts
  // on today's network, so nobody inherits a future view and quotes from it.
  const [serviceChoice, setServiceChoice] = useState<ServiceDateChoice>(CURRENT_CHOICE)
  const serviceDate = resolveServiceDate(serviceChoice)

  // The segment list every read-only surface draws from — map, City Pairs,
  // Network Explorer. Route search does NOT use this: the backend filters its
  // own graph from the same rules (backend/app/rfs.py), so sending it the date
  // is enough and sending a pre-filtered list would be redundant.
  const systemsById = useMemo(() => Object.fromEntries(systems.map(sy => [sy.id, sy])), [systems])
  const visibleSegments = useMemo(
    () => filterSegmentsInService(segments, systemsById, serviceDate),
    [segments, systemsById, serviceDate],
  )
  const { setHoveredSegmentId } = useSegmentHover()

  /** Fit the map to a box, bumping the key so the same box twice still moves. */
  function fitTo(bounds: [[number, number], [number, number]]) {
    setFitBounds(f => ({ bounds, key: (f?.key ?? 0) + 1 }))
  }

  /** Bounding box of a set of points, in the map's normalised longitude space
   *  so a Pacific-spanning cable doesn't fit to the whole world the wrong way.
   *  Returns null when there is nothing to fit. */
  function boundsOf(points: [number, number][]): [[number, number], [number, number]] | null {
    if (points.length === 0) return null
    const normalized = normalizeLngPath(points)
    const lats = normalized.map(p => p[0])
    const lngs = normalized.map(p => p[1])
    // A single point has zero extent, which fitBounds renders as maximum zoom;
    // pad it into a small box so a one-node city lands at a sane scale.
    const pad = points.length === 1 ? 0.35 : 0
    return [
      [Math.min(...lats) - pad, Math.min(...lngs) - pad],
      [Math.max(...lats) + pad, Math.max(...lngs) + pad],
    ]
  }

  /**
   * Asset Search: go to whatever the user picked. Every kind stays in the
   * current mode — searching for a node mid-way through building a route must
   * not throw that work away — with ONE deliberate exception: a country has
   * nothing useful to show in place, so it opens Country Viewer, which owns the
   * logic for building a country highlight.
   */
  function handleAssetSelect(hit: AssetHit, opts: { openNodePanel?: boolean } = {}) {
    const openNodePanel = opts.openNodePanel ?? true
    // Any new destination clears a previous spotlight, so stale tooltips don't
    // linger on a node the user has navigated away from.
    setSpotlightNodeId(null)
    switch (hit.kind) {
      case 'node': {
        if (openNodePanel) { handleGoToNode(hit.id); break }
        const node = nodes.find(n => n.id === hit.id)
        if (!node) break
        setFlyToNode(f => ({ lat: node.lat, lng: node.lng, key: (f?.key ?? 0) + 1 }))
        setSpotlightNodeId(node.id)
        break
      }
      case 'city': {
        const b = boundsOf(cityPoints(nodes, hit.id))
        if (b) fitTo(b)
        break
      }
      case 'segment': {
        const seg = segments.find(s => s.id === hit.id)
        if (!seg) break
        const b = boundsOf(segmentSpotlightPoints(seg, nodes, kmlMode, kmlPaths))
        if (b) fitTo(b)
        // Reuse the Segment Breakdown's spotlight so the found cable is
        // unmistakable on a map full of other cables.
        setHoveredSegmentId(seg.id)
        break
      }
      case 'system': {
        const b = boundsOf(systemPoints(segments, nodes, hit.id))
        if (b) fitTo(b)
        // Add to the highlight set rather than replacing it, so searching two
        // cables in a row lets you compare them. handleToggleSystem caps at 5.
        if (!selectedSystems.some(s => s.systemId === hit.id)) handleToggleSystem(hit.id)
        break
      }
      case 'country':
        setPrefilledCountry(hit.id)
        switchMode('countryviewer')
        break
    }
  }

  /** Look a node up by id, fly the map to it and open its info panel — the
   *  Network Explorer "type a 4-alpha code" path. */
  function handleGoToNode(nodeId: string) {
    const node = nodes.find(n => n.id === nodeId)
    if (!node) return
    setFlyToNode(f => ({ lat: node.lat, lng: node.lng, key: (f?.key ?? 0) + 1 }))
    // The popup positions itself from these coords, so put it near the middle
    // of the map area rather than at a stale mouse position.
    setSelectedNode({ node, x: Math.round(window.innerWidth / 2), y: Math.round(window.innerHeight / 2) })
  }
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
  const [showPlannedEvents, setShowPlannedEvents]   = useState(false)  // show future planned network events (maintenance windows); separate, manually-controlled toggle — NOT auto-enabled by outageviewer mode
  const [subseaOnly, setSubseaOnly]                 = useState(false)  // draw only wet (submarine) segments
  const [backhaulOnly, setBackhaulOnly]             = useState(false)  // draw only terrestrial (backhaul) segments
  // "Living World" — the 16-bit ocean easter eggs (see LivingWorldLayer.tsx).
  // ON by default: it is meant to be found rather than opted into. The choice
  // is remembered per browser, because someone who turns whales off wants them
  // to stay off, and someone who never touches it never sees a prompt.
  const [livingWorld, setLivingWorld]               = useState(loadLivingWorld)
  // "Network Hazards" — live disasters from bushfire.io + USGS. Off by default;
  // useHazards does nothing at all until this flips on.
  const [hazardsOn, setHazardsOn]                   = useState(loadHazardsOn)
  const [hazardAssetView, setHazardAssetView]       = useState<HazardAssetView>(loadHazardAssetView)
  const [hazardOwnerView, setHazardOwnerView]       = useState<HazardOwnerView>(loadHazardOwnerView)
  const [kmlMode, setKmlMode]                       = useState<boolean>(loadKmlMode)
  // Surveyed routes, keyed by segment id. Fetched once alongside the reference
  // data: this is the SIMPLIFIED path for every segment (~1MB network-wide),
  // never the full resolution, which is fetched per segment on demand.
  const [kmlPaths, setKmlPaths]                     = useState<Record<string, KmlPathInfo>>({})
  // Top-of-map Asset Filter bar's current match, computed in AssetFilterBar
  // itself (it already has nodes/segments/capacity) and reported up here so
  // both the desktop map and MobileLayout's can dim by it. null/inactive
  // means "don't dim anything for this" — same contract as countryHighlight.
  const [assetFilterMatch, setAssetFilterMatch]     = useState<AssetFilterMatch | null>(null)
  const hazards = useHazards(hazardsOn)
  // Stable identity while the layer is off, so HazardProvider's memo never churns.
  const hazardList = hazards.feed?.hazards ?? EMPTY_HAZARDS
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
    // Deliberately NOT part of the Promise.all above. If the KML store is
    // unavailable — a bad deploy, a missing table — the map must still draw,
    // and joining it to the reference-data fetch would make one failure take
    // the whole network down with it. An empty map here just means every
    // segment falls back to its waypoints, which is exactly what it did before.
    api.getKmlPaths().then(r => setKmlPaths(r.paths)).catch(() => {})
  }, [])

  // True while the user is actively assembling a route by hand in RouteManual.
  const manualBuilding = mode === 'routemanual' && !!manualState

  // Network Editor: the map/panel always render "base data + staged edits" from
  // one source of truth (see applyPendingChanges) rather than two parallel
  // mutable arrays — outside this mode it's just a pass-through of the real data.
  const editorDisplay = useMemo(
    // Network Editor deliberately IGNORES the Current/Planned filter: an admin
    // editing topology has to be able to see and edit a planned cable, and
    // hiding it would make it uneditable. Every other mode draws the network as
    // at the chosen service date.
    () => (mode === 'networkeditor'
      ? applyPendingChanges(nodes, segments, capacity, editorState.pending)
      : { nodes, segments: visibleSegments, capacity }),
    [mode, nodes, segments, visibleSegments, capacity, editorState.pending],
  )
  const editorPendingIds = useMemo(() => pendingAffectedIds(editorState.pending), [editorState.pending])

  /** Change the active mode and run the side effects each mode needs (clearing
   *  results, resetting highlights, auto-enabling certain toggles, etc.). */
  function switchMode(next: AppMode) {
    if (next === 'networkeditor' && !isAdmin) return   // defense in depth — the tab is already hidden for non-admins
    if (next === 'systemviewer') { setResponse(null); setSelectedRouteIds([]); setError(null) }
    // Network Editor reuses the same Country/System filter state as Country/System Viewer
    // (see NetworkEditor.tsx), so entering/leaving it must not wipe that highlight either.
    if (next !== 'countryviewer' && next !== 'networkeditor') { setCountryHighlight(null); setShowNodeDiagram(false) }
    if (next === 'countryviewer') setShowSegmentLabels(true)
    if (next !== 'routemanual') { setManualState(null); setManualFinishConfirm(null) }
    if (next === 'outageviewer') setShowAllOutages(true)
    setMode(next)
  }

  /** Like switchMode, but if the user is mid-build in RouteManual, or leaving
   *  Network Editor with unsaved staged changes, it first pops a confirmation
   *  instead of silently losing their work. */
  function safeSwitchMode(next: AppMode) {
    if (manualBuilding && next !== 'routemanual') { setWarnSwitchMode(next); return }
    if (mode === 'networkeditor' && editorState.pending.length > 0 && next !== 'networkeditor') { setWarnSwitchMode(next); return }
    switchMode(next)
  }

  /** The map's own panic button: back out of whatever admin-tool overlay is
   *  open, whatever mode is active, and whatever is selected/highlighted on
   *  the map, in one action. Routed through safeSwitchMode (not switchMode
   *  directly) so unsaved Network Editor changes or a route mid-build in
   *  RouteManual still get their confirmation dialog rather than being
   *  silently discarded — everything else here only touches what's
   *  currently shown/selected, never data. Deliberately leaves pinnedRoutes
   *  and the Asset Filter's own match state alone: those are things the
   *  user deliberately curated, not a "selection" to back out of. */
  function resetMapView() {
    setCtrlMenuOpen(false)
    setKmlImportOpen(false)
    setKmlLibraryOpen(false)
    setCableImportOpen(false)
    setRefDataOpen(false)
    setProjectsOpen(false)
    setCapDashOpen(false)
    setAlgoEvalOpen(false)
    setSelectedNode(null)
    setSelectedSegment(null)
    setSpotlightNodeId(null)
    setSelectedSystems([])
    setSelectedRouteIds([])
    setSearchPin(null)
    setNearestNodeIds([])
    setHoveredSegmentId(null)
    safeSwitchMode('routebuilder')
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
  async function handleSearch(reqIn: RouteRequest) {
    // Stamp the current Current/Planned choice onto every search. The backend
    // applies the same RFS rules to its graph (backend/app/rfs.py), so this one
    // field keeps the routes it returns consistent with the map on screen.
    // `null` means "all planned" — omit the field entirely so nothing filters.
    const req: RouteRequest = serviceDate ? { ...reqIn, service_date: serviceDate } : reqIn
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
      const wCircuitLabel = workerCircuitLabel(c.label, !!protect)
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
      const wCircuitLabel = workerCircuitLabel(label, !!protect)
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
      const wLabel = workerPinLabel(circuitLabel, searchLabel, !!protectRoute)
      pinCounter.current += 1
      const newPins: PinnedRoute[] = [
        { pinId: `pin-${pinCounter.current}`, route, color, searchLabel: wLabel, projectId, circuitId, circuitLabel: workerCircuitLabel(circuitLabel, !!protectRoute) }
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
    api.getKmlPaths().then(kr => setKmlPaths(kr.paths)).catch(() => {})
  }

  /** Stage a waypoint edit (insert / move / delete are all just "here is the
   *  segment's new full waypoint array") as one PendingChange — one discrete
   *  user action = one undo step, and the full-array snapshot is what makes
   *  discarding any single staged change safe. Reads the CURRENT effective
   *  waypoints (base + already-staged edits), not the persisted ones. */
  function stageWaypointEdit(segmentId: string, mutate: (wps: [number, number][]) => [number, number][]) {
    const seg = editorDisplay.segments.find(s => s.id === segmentId)
    if (!seg) return
    const from = seg.waypoints ?? null
    dispatchEditor({ type: 'ADD_CHANGE', change: { kind: 'edit-waypoints', segmentId, from, to: mutate(from ?? []) } })
  }

  /** Create sub-mode: clicking a node fills the start slot, then the end slot.
   *  Clicking the already-chosen start clears it (easy undo of a mis-click). */
  function handleEditorPickEndpoint(nodeId: string) {
    const d = editorState.segmentDraft
    if (d.startNodeId === nodeId) { dispatchEditor({ type: 'SET_SEGMENT_DRAFT', draft: { ...d, startNodeId: null } }); return }
    if (d.endNodeId === nodeId)   { dispatchEditor({ type: 'SET_SEGMENT_DRAFT', draft: { ...d, endNodeId: null } }); return }
    if (!d.startNodeId) { dispatchEditor({ type: 'SET_SEGMENT_DRAFT', draft: { ...d, startNodeId: nodeId, newNodeAt: null } }); return }
    dispatchEditor({ type: 'SET_SEGMENT_DRAFT', draft: { ...d, endNodeId: nodeId, newNodeAt: null } })
  }

  /** Create sub-mode: clicking empty map space opens the drop-a-new-node form
   *  in the side panel, pre-filled with the clicked coordinates. */
  function handleEditorPickEmptySpace(lat: number, lng: number) {
    dispatchEditor({ type: 'SET_SEGMENT_DRAFT', draft: { ...editorState.segmentDraft, newNodeAt: { lat, lng } } })
  }

  /** Network Editor's Save All: applies every staged change sequentially against
   *  the real endpoints (see state/networkEditorSave.ts for ordering/partial-
   *  failure handling), then refetches base data so persisted changes fold into
   *  it — only genuinely-failed changes are left in the pending list afterward. */
  async function handleEditorSaveAll() {
    dispatchEditor({ type: 'SAVE_START' })
    const result = await saveAll(editorState.pending, (changeId, status, message) =>
      dispatchEditor({ type: 'SAVE_PROGRESS', changeId, status, message }))
    if (result.succeededChangeIds.length > 0) await handleDataChange()
    dispatchEditor({ type: 'SAVE_RESULT', succeededChangeIds: result.succeededChangeIds, errors: result.errors })
  }

  // Ctrl+Z / Ctrl+Shift+Z (Cmd on Mac) undo/redo for Network Editor — ignored
  // while typing in a form field so it doesn't fight the browser's own
  // text-input undo.
  useEffect(() => {
    if (mode !== 'networkeditor') return
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      e.preventDefault()
      dispatchEditor({ type: e.shiftKey ? 'REDO' : 'UNDO' })
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [mode])

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

  const middleHasContent = middlePanelHasContent({
    mode, kmlImportOpen, editorState, manualState, manualResults, hasResults, hasPins, loading,
  })
  // Auto-open the middle panel when that content appears, auto-collapse when
  // it's gone — but only on that transition (content flips, or the mode
  // itself changes), so a manual ‹/› toggle in between isn't fought on every
  // render; it sticks until the next real state change.
  useAutoSync(`${mode}:${middleHasContent}`, middleHasContent, middleOpen, setMiddleOpen)

  // ── Mobile layout ────────────────────────────────────────────────────────
  // On narrow screens the entire three-panel desktop UI is replaced by a single
  // MobileLayout component. All the same state + handlers are passed down to it,
  // followed by the shared modals (projects, guide, pin-label, manual finish).
  if (isMobile) {
    return (
      <ThemeContext.Provider value={theme}>
       <HazardProvider hazards={hazardList}>
        <MobileLayout
          nodes={nodes} segments={segments} systems={systems}
          capacity={capacity} outages={outages} rules={rules}
          response={response} selectedRoutes={selectedRoutes}
          selectedRouteIds={selectedRouteIds} pinnedRoutes={pinnedRoutes}
          selectedSystems={selectedSystems}
          mode={mode} loading={loading} error={error}
          selectedNode={selectedNode} searchPin={searchPin}
          selectedSegment={selectedSegment}
          onCloseSegment={() => setSelectedSegment(null)}
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
          onSegmentClick={(segment, x, y) => setSelectedSegment({ segment, x, y })}
          kmlPaths={kmlPaths}
          kmlMode={kmlMode}
          onToggleKmlMode={toggleKmlMode}
          onGoToNode={handleGoToNode}
          flyToNode={flyToNode}
          onAssetSelect={hit => handleAssetSelect(hit, { openNodePanel: false })}
          serviceChoice={serviceChoice}
          onServiceChoiceChange={setServiceChoice}
          visibleSegments={visibleSegments}
          fitBounds={fitBounds}
          spotlightNodeId={spotlightNodeId}
          serviceDate={todayIso()}
          onPinChange={handlePinChange}
          onCloseNode={() => setSelectedNode(null)}
          onOpenRefData={() => setRefDataOpen(true)}
          onCloseRefData={() => setRefDataOpen(false)}
          onDataChange={handleDataChange}
          config={config}
          assetFilterMatch={assetFilterMatch}
          onAssetFilterChange={setAssetFilterMatch}
          switchMode={switchMode}
          onOpenGuide={() => setGuideOpen(true)}
          clearSearch={clearSearch}
          clearAll={clearAll}
          cycleTheme={cycleTheme}
          mapStyle={mapStyle}
          onMapStyleChange={setMapStyle}
          hideNonActive={hideNonActive}
          onToggleHideNonActive={() => setHideNonActive(v => !v)}
          showSegmentLabels={showSegmentLabels}
          onToggleShowSegmentLabels={() => setShowSegmentLabels(v => !v)}
          showNodeLabels={showNodeLabels}
          onToggleShowNodeLabels={() => setShowNodeLabels(v => !v)}
          showAllOutages={showAllOutages}
          onToggleShowAllOutages={() => setShowAllOutages(v => !v)}
          showPlannedEvents={showPlannedEvents}
          onToggleShowPlannedEvents={() => setShowPlannedEvents(v => !v)}
          subseaOnly={subseaOnly}
          onToggleSubseaOnly={() => { setSubseaOnly(v => !v); if (!subseaOnly) setBackhaulOnly(false) }}
          backhaulOnly={backhaulOnly}
          onToggleBackhaulOnly={() => { setBackhaulOnly(v => !v); if (!backhaulOnly) setSubseaOnly(false) }}
          livingWorld={livingWorld}
          onToggleLivingWorld={toggleLivingWorld}
          hazardsOn={hazardsOn}
          onToggleHazards={toggleHazards}
          hazardAssetView={hazardAssetView}
          onHazardAssetViewChange={changeHazardAssetView}
          hazardOwnerView={hazardOwnerView}
          onHazardOwnerViewChange={changeHazardOwnerView}
          hazardFeed={hazards.feed}
          hazardsLoading={hazards.loading}
          hazardsError={hazards.error}
          onRefreshHazards={hazards.refresh}
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
            <Suspense fallback={null}><UserGuide nodes={nodes} segments={segments} systems={systems} /></Suspense>
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
       </HazardProvider>
      </ThemeContext.Provider>
    )
  }

  // ── Desktop layout ───────────────────────────────────────────────────────
  // Three vertical columns: LEFT = mode-specific controls (search/manual/etc.),
  // MIDDLE = the RouteList of results/pins, RIGHT = the interactive Map. Above
  // them sit the top-right Controls menu and, below, a stack of portalled modals.
  const tabStyle = (active: boolean) => subTabStyle(theme, active)

  return (
    <ThemeContext.Provider value={theme}>
     <HazardProvider hazards={hazardList}>
      <div style={{ display: 'flex', height: '100vh', background: theme.bgBase, color: theme.text, fontFamily: "'Inter', system-ui, sans-serif", overflow: 'hidden' }}>

        {/* Top-right control menu */}
        {(() => {
          // Living World is deliberately absent: it is ON by default, so counting it
          // would pin a permanent "1" on the Controls button and make the badge
          // stop meaning "you have changed something".
          const activeToggles = [showAllOutages, showPlannedEvents, hideNonActive, showSegmentLabels, showNodeLabels, subseaOnly, backhaulOnly, hazardsOn].filter(Boolean).length
          return (
            <div style={{ position: 'fixed', top: 12, right: 12, zIndex: 1000 }}>
              <button
                onClick={() => setCtrlMenuOpen(o => !o)}
                className="rb-btn-motion"
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
                  <button
                    type="button"
                    aria-label="Close menu"
                    onClick={() => setCtrlMenuOpen(false)}
                    style={{ position: 'fixed', inset: 0, zIndex: -1, border: 'none', background: 'transparent', padding: 0, cursor: 'default' }}
                  />
                  <div className="rb-anim-dropdown" style={{
                    position: 'absolute', top: 42, right: 0,
                    width: 240,
                    background: theme.bgPanel,
                    border: `1px solid ${theme.border}`,
                    borderRadius: 12,
                    boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
                    // Scrolls internally instead of running off the bottom of
                    // a short viewport — this menu's row count (5 sections'
                    // worth) got close enough to a typical 900px-tall window
                    // that one more row (Tooltips) tipped it over the edge.
                    // 60px clears the trigger button's own top offset (12)
                    // plus a margin so the panel never touches the viewport edge.
                    maxHeight: 'calc(100vh - 60px)', overflowY: 'auto',
                  }}>
                    {/* Display — how the existing network is drawn/filtered */}
                    <ControlsSectionLabel theme={theme}>Display</ControlsSectionLabel>
                    {[
                      { label: 'Hide Inactive',    icon: hideNonActive      ? '◉' : '◎', active: hideNonActive,      color: theme.blue, onClick: () => setHideNonActive(v => !v), hint: 'Dim segments and nodes not on a shown route or highlighted system' },
                      { label: 'Seg Labels',       icon: showSegmentLabels  ? '◉' : '◎', active: showSegmentLabels,  color: theme.blue, onClick: () => setShowSegmentLabels(v => !v) },
                      { label: 'Node Labels',      icon: showNodeLabels     ? '◉' : '◎', active: showNodeLabels,     color: theme.blue, onClick: () => setShowNodeLabels(v => !v) },
                      { label: 'Subsea Only',      icon: '🌊', active: subseaOnly,   color: theme.blue, onClick: () => { setSubseaOnly(v => !v);   if (!subseaOnly)   setBackhaulOnly(false) }, hint: 'Show only submarine cable segments' },
                      { label: 'Backhaul Only',    icon: '🗺',  active: backhaulOnly, color: theme.blue, onClick: () => { setBackhaulOnly(v => !v); if (!backhaulOnly) setSubseaOnly(false)  }, hint: 'Show only terrestrial backhaul segments' },
                    ].map((item, i) => <ControlsRow key={item.label} theme={theme} index={i} item={item} />)}

                    {/* Overlays — additional data layers drawn on top */}
                    <ControlsSectionLabel theme={theme}>Overlays</ControlsSectionLabel>
                    {[
                      { label: 'Show All Outages', icon: '🚢', active: showAllOutages, color: theme.red,  onClick: () => setShowAllOutages(v => !v) },
                      { label: 'Show Planned Events', icon: '🗓️', active: showPlannedEvents, color: theme.orange, onClick: () => setShowPlannedEvents(v => !v) },
                      { label: 'Living World',     icon: '🐋', active: livingWorld,  color: theme.green, onClick: toggleLivingWorld, hint: 'Decorative ocean wildlife — purely visual, no effect on the data' },
                      { label: 'Network Hazards',  icon: '⚠️', active: hazardsOn,    color: theme.orange, onClick: toggleHazards, hint: 'Live disaster feed (bushfire, earthquake) matched against the network' },
                      // Coverage in the label: "KML Mode ON" alone would not
                      // say whether that means 3 cables or 300, and the whole
                      // point of the mode is knowing which lines are real.
                      { label: `KML Mode  ${Object.keys(kmlPaths).length}/${segments.length}`, icon: '🛰', active: kmlMode, color: theme.blue, onClick: toggleKmlMode, hint: 'Draw the real surveyed cable path where one is on file, instead of the straight-line guess' },
                    ].map((item, i) => <ControlsRow key={item.label} theme={theme} index={i + 5} item={item} />)}

                    {/* Tools — opens a separate panel or modal */}
                    <ControlsSectionLabel theme={theme}>Tools</ControlsSectionLabel>
                    {[
                      { label: 'Capacity',  icon: '📊', onClick: () => { setCapDashOpen(true);   setCtrlMenuOpen(false) } },
                      { label: 'Projects',  icon: '📁', onClick: () => { setProjectsOpen(true);  setCtrlMenuOpen(false) } },
                      { label: 'Ref Data',  icon: '⚙',  onClick: () => { setRefDataOpen(true);   setCtrlMenuOpen(false) } },
                      { label: 'Algo Eval', icon: '🧪', onClick: () => { setAlgoEvalOpen(true);  setCtrlMenuOpen(false) } },
                      // Admin-only: it writes. Hidden rather than disabled, the
                      // same call as the Network Editor tab — a review table a
                      // viewer can never act on has no read-only value.
                      // The library is READ-ONLY for a viewer — coverage is
                      // worth knowing whether or not you can change it — so
                      // unlike Import it is not hidden. Rollback and delete
                      // inside it are still admin-only.
                      { label: 'KML Library', icon: '📚', onClick: () => { setKmlLibraryOpen(true); setCtrlMenuOpen(false) } },
                      ...(isAdmin ? [{ label: 'KML Import', icon: '🛰', onClick: () => { setKmlImportOpen(true); setCtrlMenuOpen(false) } }] : []),
                      // Admin-only for the same reason: it writes (new system/
                      // nodes/segments). Models a cable this org does not own —
                      // see CableImportWizard.tsx's own header comment.
                      ...(isAdmin ? [{ label: 'Cable Import', icon: '🌊', onClick: () => { setCableImportOpen(true); setCtrlMenuOpen(false) } }] : []),
                    ].map((item, i) => <ControlsRow key={item.label} theme={theme} index={i + 10} item={item} />)}

                    {/* Appearance */}
                    <ControlsSectionLabel theme={theme}>Appearance</ControlsSectionLabel>
                    <ControlsRow
                      theme={theme}
                      index={16}
                      item={{ label: themeToggleLabel(themeMode), icon: themeToggleIcon(themeMode), onClick: cycleTheme }}
                    />
                    <ControlsRow
                      theme={theme}
                      index={17}
                      item={{
                        label: 'Tooltips', icon: tooltipsEnabled ? '◉' : '◎', active: tooltipsEnabled, color: theme.blue,
                        onClick: () => setTooltipsEnabled(!tooltipsEnabled),
                        hint: 'Hover hints on icon-only controls. On by default.',
                      }}
                    />
                  </div>
                </>
              )}
            </div>
          )
        })()}

        {/* Left panel */}
        <div role="complementary" aria-label="Search and navigation" style={{
          width: leftOpen ? 440 : 0, flexShrink: 0, display: 'flex', flexDirection: 'column',
          background: theme.bgPanel, borderRight: leftOpen ? `1px solid ${theme.border}` : 'none',
          overflow: 'hidden', transition: 'width 0.3s ease',
        }}>
          <div style={{ padding: '14px 16px 10px', borderBottom: `1px solid ${theme.border}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 2 }}>
              <Tooltip label="Open platform guide">
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setGuideOpen(true)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setGuideOpen(true) } }}
                  style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer', flex: 1, minWidth: 0 }}
                >
                  <img src="/favicon.svg" alt="" style={{ width: 28, height: 28, flexShrink: 0 }} />
                  <h1 style={{ fontSize: 18, fontWeight: 700, color: theme.text }}>RouteBuilder</h1>
                </div>
              </Tooltip>
              <Tooltip label="Back to the RouteSuite portal">
                <a
                  href="/suite.html"
                  style={{
                    fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textDecoration: 'none',
                    padding: '3px 8px', borderRadius: 4, whiteSpace: 'nowrap', flexShrink: 0,
                    border: `1px solid ${theme.border}`, color: theme.textMuted, background: 'transparent',
                  }}
                >
                  RouteSuite ↗
                </a>
              </Tooltip>
            </div>
            <p style={{ fontSize: 11, color: theme.textFaint }}>International Telco · Subsea Circuit Design</p>
          </div>

          {/* ── Asset Search — one box over nodes, cities, systems, segments
                 and countries. Sits above the mode tabs because it works in
                 every mode: picking a result navigates without changing what
                 you were doing (see handleAssetSelect). ── */}
          <div style={{ padding: '0 14px 10px' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <AssetSearch
                  nodes={nodes}
                  segments={visibleSegments}
                  systems={systems}
                  onSelect={handleAssetSelect}
                />
              </div>
              <ServiceDateSelector value={serviceChoice} onChange={setServiceChoice} />
            </div>
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
                  <button className="rb-btn-motion" style={topTabStyle(isBuilder)} onClick={() => { if (!isBuilder) safeSwitchMode('routebuilder') }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12h18M3 6l9-3 9 3M3 18l9 3 9-3"/></svg>
                    RouteBuilder
                  </button>
                  <button className="rb-btn-motion" style={topTabStyle(isExplorer)} onClick={() => { if (!isExplorer) safeSwitchMode('countryviewer') }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                    NetworkExplorer
                  </button>
                  {isAdmin && (
                    <Tooltip label="Admin-only: move nodes, edit segment paths, create segments directly on the map">
                      <button className="rb-btn-motion" style={topTabStyle(mode === 'networkeditor')} onClick={() => safeSwitchMode('networkeditor')}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                        Network Editor
                      </button>
                    </Tooltip>
                  )}
                  <Tooltip label="Open guide">
                    <button style={{ ...topTabStyle(false), flex: 'none', padding: '9px 10px' }} onClick={() => setGuideOpen(true)}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                    </button>
                  </Tooltip>
                </div>
                {/* Sub-tabs — Network Editor has no sub-tabs here; it owns its own
                    interaction-mode strip (Move/Waypoints/Create/Delete) inside its
                    own panel body instead, since it isn't part of the Builder/Explorer
                    grouping. */}
                {mode !== 'networkeditor' && (
                  <div style={{ display: 'flex', borderBottom: `1px solid ${theme.border}`, background: theme.bgDeep }}>
                    {isBuilder ? (
                      <>
                        <button className="rb-btn-motion" style={tabStyle(mode === 'routebuilder')} onClick={() => safeSwitchMode('routebuilder')}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                          RouteFinder
                        </button>
                        <button className="rb-btn-motion" style={tabStyle(mode === 'routemanual')} onClick={() => switchMode('routemanual')}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
                          RouteManual
                        </button>
                      </>
                    ) : (
                      <>
                        <button className="rb-btn-motion" style={tabStyle(mode === 'countryviewer')}  onClick={() => switchMode('countryviewer')}>🌍 Country</button>
                        <button className="rb-btn-motion" style={tabStyle(mode === 'citypair')}       onClick={() => switchMode('citypair')}>🏙 City Pairs</button>
                        <button className="rb-btn-motion" style={tabStyle(mode === 'systemviewer')}   onClick={() => switchMode('systemviewer')}>🌊 Systems</button>
                        <button className="rb-btn-motion" style={tabStyle(mode === 'nodefinder')}     onClick={() => switchMode('nodefinder')}>🔍 Nodes</button>
                        <button className="rb-btn-motion" style={tabStyle(mode === 'outageviewer')}   onClick={() => switchMode('outageviewer')}>⚠️ Outages</button>
                      </>
                    )}
                  </div>
                )}
              </div>
            )
          })()}

          {/* Left-panel body: swaps its contents based on the active mode.
              Each `mode === '...'` block below mounts that mode's control panel. */}
          <div style={{ flex: 1, overflowY: mode === 'routemanual' ? 'hidden' : 'auto', display: 'flex', flexDirection: 'column', padding: mode === 'routemanual' ? 0 : '16px' }}>
            {/* Chop Import overlays whichever mode is underneath, the same
                way it did as a bottom-docked panel before — it does not
                change `mode` itself, just what these two columns show while
                it is open, so returning to it later is exactly "reopen the
                menu item", not "switch modes". */}
            {kmlImportOpen ? (
              <Suspense fallback={null}>
                <KmlChopSourcePanel state={kmlChop} onClose={() => setKmlImportOpen(false)} />
              </Suspense>
            ) : (
            <>
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
                <SearchForm nodes={nodes} segments={segments} systems={systems} onSearch={handleSearch} loading={loading} prefilledOrigin={prefilledOrigin} prefilledDest={prefilledDest} prefill={searchPrefill} kmlMode={kmlMode} onToggleKmlMode={toggleKmlMode} />
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
              <CityPairPanel nodes={nodes} segments={visibleSegments} systems={systems} onNetOwnership={config.on_net_ownership} onPlanRoute={handleSetPair} />
            )}
            {mode === 'systemviewer' && (
              <SystemViewer systems={systems} selected={selectedSystems} onToggle={handleToggleSystem}
                segments={segments} nodes={nodes} hasKml={id => !!kmlPaths[id]} />
            )}
            {mode === 'countryviewer' && (
              <CountryViewer
                nodes={nodes} segments={visibleSegments} systems={systems}
                onSelect={setCountryHighlight}
                prefilledCountryCode={prefilledCountry}
                onPrefillConsumed={() => setPrefilledCountry(null)}
              />
            )}
            {mode === 'networkeditor' && isAdmin && (
              <NetworkEditor
                nodes={editorDisplay.nodes} segments={editorDisplay.segments} systems={systems}
                capacity={editorDisplay.capacity}
                countryHighlight={countryHighlight} onCountrySelect={setCountryHighlight}
                selectedSystems={selectedSystems} onToggleSystem={handleToggleSystem}
                editorState={editorState} dispatchEditor={dispatchEditor}
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
                onGoToNode={handleGoToNode}
              />
            )}
            </>
            )}
          </div>
          <AdminBar />
          <HealthBar dataLoaded={nodes.length > 0} mapsProvider={config.maps_provider} />
        </div>

        {/* Left panel collapse toggle */}
        <Tooltip label={leftOpen ? 'Hide search panel' : 'Show search panel'}>
          <button
            onClick={() => setLeftOpen(v => !v)}
            className="rb-btn-motion"
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
        </Tooltip>

        {/* Middle panel */}
        <div role="complementary" aria-label="Results" style={{
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
            <span style={{ fontSize: 11, fontWeight: 700, color: theme.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              {middlePanelLabel(kmlImportOpen, mode)}
            </span>
            {!kmlImportOpen && mode !== 'networkeditor' && hasResults && response && (
              <span style={{ fontSize: 11, color: theme.textFaint }}>
                <span style={{ color: theme.text, fontWeight: 600 }}>
                  {response.total_found || (response.primary_routes.length + response.diverse_routes.length)}
                </span> found
                {searchDuration !== null && <span> · {searchDuration < 1 ? `${(searchDuration * 1000).toFixed(0)}ms` : `${searchDuration.toFixed(2)}s`}</span>}
              </span>
            )}
            {!kmlImportOpen && mode !== 'networkeditor' && hasPins    && <span style={{ fontSize: 11, color: theme.textFaintest }}>· {pinnedCircuitCount} pinned</span>}
            {!kmlImportOpen && mode !== 'networkeditor' && loading    && <span style={{ fontSize: 11, color: theme.blue }}>Searching…</span>}
            {!kmlImportOpen && mode !== 'networkeditor' && (
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                {hasPins    && <button onClick={() => { setSldVersion(''); setSldVersionPrompt(true) }} title="Export SLD" style={clearBtnStyle(theme)}>⬡ SLD</button>}
                {hasResults && <button onClick={clearSearch} style={clearBtnStyle(theme)}>Clear Search</button>}
                {(hasResults || hasPins) && <button onClick={clearAll} style={clearBtnStyle(theme, true)}>Clear All</button>}
              </div>
            )}
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
            {kmlImportOpen && (
              <Suspense fallback={null}>
                <KmlChopTablePanel state={kmlChop} />
              </Suspense>
            )}
            {!kmlImportOpen && (mode === 'networkeditor' ? (
              <EditorPendingPanel
                state={editorState} dispatch={dispatchEditor}
                nodes={editorDisplay.nodes} segments={editorDisplay.segments}
                onSaveAll={handleEditorSaveAll}
              />
            ) : (
              <>
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
              // TODAY's date, not the selected one. The backend already filters
              // the graph by the chosen service date, so a fresh search returns
              // only hops usable AT it — passing that date back would leave the
              // badges permanently silent. What the badge answers is "is this
              // segment live NOW?", so viewing Q2 2027 marks every hop that is
              // not yet built today, which is the question being asked.
              serviceDate={todayIso()}
              allSegments={segments}
              onDataChange={handleDataChange}
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
              </>
            ))}
          </div>
        </div>

        {/* Middle panel collapse toggle */}
        <Tooltip label={middleOpen ? 'Hide routes panel' : 'Show routes panel'}>
          <button
            onClick={() => setMiddleOpen(v => !v)}
            className="rb-btn-motion"
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
        </Tooltip>

        {/* Map */}
        <div role="main" aria-label="Network map" style={{ flex: 1, position: 'relative' }}>

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

          {/* Full width, ABOVE the map rather than floating over it: an overlay
              at top:0 covered Leaflet's zoom "+" button. In normal flow the map
              simply starts lower while a future view is active. Renders nothing
              on Current, so the map is full height in the usual case. */}
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 1100, pointerEvents: 'none' }}>
            <div style={{ pointerEvents: 'auto' }}>
              <FutureNetworkBanner value={serviceChoice} onReset={() => setServiceChoice(CURRENT_CHOICE)} />
            </div>
          </div>

          {/* Asset Filter — every mode, always available, so it sits directly
              on the map rather than behind a mode-specific panel. AssetFilterBar
              itself is unpositioned; the host always supplies the one wrapping
              div that places it, so desktop and mobile can never stack two
              absolute offsets on top of each other (see MobileLayout.tsx). */}
          <div style={{ position: 'absolute', top: 12, left: 64, zIndex: 1090 }}>
            <AssetFilterBar
              nodes={nodes}
              segments={visibleSegments}
              systems={systems}
              capacity={capacity}
              onNetOwnership={config.on_net_ownership}
              onAssetSelect={handleAssetSelect}
              onFilterChange={setAssetFilterMatch}
            />
          </div>

          {/* Bottom-right: the only corner of the map not already claimed by
              the zoom control (top-left), Asset Filter (top), Controls
              (top-right, viewport-fixed), or the style picker/legend stack
              (bottom-left) — see resetMapView's own doc comment for what it
              backs out of. */}
          <div style={{ position: 'absolute', bottom: 28, right: 8, zIndex: 1000 }}>
            <button
              type="button" onClick={resetMapView}
              title="Back out of the current mode and clear everything selected on the map"
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '6px 12px', borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit',
                background: 'rgba(0,0,0,0.62)', backdropFilter: 'blur(4px)',
                border: '1px solid rgba(255,255,255,0.14)', color: 'rgba(255,255,255,0.82)',
                fontSize: 12, fontWeight: 600,
              }}
            >
              <span aria-hidden="true">⟲</span> Reset
            </button>
          </div>

          {nodes.length > 0 ? (
            <NetworkMap
              nodes={editorDisplay.nodes} segments={editorDisplay.segments} selectedRoutes={selectedRoutes}
              capacity={editorDisplay.capacity} pinnedRoutes={pinnedRoutes} selectedSystems={selectedSystems}
              outages={outages}
              flyToNode={flyToNode}
              fitBounds={fitBounds}
              spotlightNodeId={spotlightNodeId}
              livingWorld={livingWorld}
              hazardsOn={hazardsOn}
              hazardAssetView={hazardAssetView}
              onHazardAssetViewChange={changeHazardAssetView}
              hazardOwnerView={hazardOwnerView}
              onHazardOwnerViewChange={changeHazardOwnerView}
              onNetOwnership={config.on_net_ownership}
              hazardFeed={hazards.feed}
              hazardsLoading={hazards.loading}
              hazardsError={hazards.error}
              onRefreshHazards={hazards.refresh}
              bannerOffset={isFutureView(serviceChoice)}
              onNodeClick={mode === 'routemanual' ? undefined : (node, x, y) => setSelectedNode({ node, x, y })}
              onSegmentClick={mode === 'routemanual' ? undefined : (segment, x, y) => setSelectedSegment({ segment, x, y })}
              selectedSegmentId={selectedSegment?.segment.id ?? null}
              selectedNodeId={selectedNode?.node.id ?? null}
              controlsOpen={ctrlMenuOpen}
              kmlPaths={kmlPaths}
              kmlMode={kmlMode}
              kmlPreview={kmlPreview.lines}
              kmlPreviewKey={kmlPreview.key}
              // Gated on kmlImportOpen, not just passed straight through: the
              // state hook itself stays mounted for the app's whole lifetime
              // (see its own comment on why) and only clears its map props
              // when `flat` itself is reset, so simply closing the panel
              // without starting over left the last flattened import's
              // colour-coded chains highlighted on the map indefinitely —
              // reported as "the map still looks like it's in KML Import
              // mode" even though the panel had genuinely closed.
              kmlChop={kmlImportOpen ? kmlChopMapProps : null}
              searchPin={searchPin ?? undefined}
              nearestNodeIds={nearestNodeIds}
              hideNonActive={hideNonActive}
              showSegmentLabels={showSegmentLabels}
              showNodeLabels={showNodeLabels}
              showAllOutages={showAllOutages}
              showPlannedEvents={showPlannedEvents}
              subseaOnly={subseaOnly}
              backhaulOnly={backhaulOnly}
              countryHighlight={countryHighlight}
              assetFilter={assetFilterMatch}
              panelWidth={(leftOpen ? 440 : 0) + (middleOpen ? 520 : 0)}
              manualState={mode === 'routemanual' ? manualState : null}
              manualCandidates={mode === 'routemanual' ? manualCandidates : []}
              onManualNodeClick={mode === 'routemanual' ? handleManualNodeClick : undefined}
              mapsProvider={config.maps_provider}
              mapStyle={mapStyle}
              onMapStyleChange={setMapStyle}
              editorMode={mode === 'networkeditor'}
              editorSubMode={editorState.subMode}
              editorSelection={editorState.selection}
              pendingNodeIds={editorPendingIds.nodeIds}
              pendingSegmentIds={editorPendingIds.segmentIds}
              onEditorNodeDragEnd={(nodeId, lat, lng, fromLat, fromLng) => dispatchEditor({ type: 'MOVE_NODE', nodeId, lat, lng, fromLat, fromLng })}
              onEditorNodeSelect={(nodeId) => dispatchEditor({ type: 'SELECT', selection: { kind: 'node', id: nodeId } })}
              onEditorSegmentSelect={(segmentId) => dispatchEditor({ type: 'SELECT', selection: { kind: 'segment', id: segmentId } })}
              onEditorWaypointInsert={(segmentId, insertIndex, lat, lng) => stageWaypointEdit(segmentId, wps => { const next = [...wps]; next.splice(insertIndex, 0, [lat, lng]); return next })}
              onEditorWaypointDragEnd={(segmentId, index, lat, lng) => stageWaypointEdit(segmentId, wps => wps.map((w, i) => (i === index ? [lat, lng] as [number, number] : w)))}
              onEditorWaypointDelete={(segmentId, index) => stageWaypointEdit(segmentId, wps => wps.filter((_, i) => i !== index))}
              editorSegmentDraft={editorState.segmentDraft}
              onEditorPickEndpoint={handleEditorPickEndpoint}
              onEditorPickEmptySpace={handleEditorPickEmptySpace}
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
          nodes={nodes} capacity={capacity}
          initialX={selectedNode.x} initialY={selectedNode.y}
          onClose={() => setSelectedNode(null)}
          onDataChange={handleDataChange}
        />
      )}

      {kmlLibraryOpen && (
        <Suspense fallback={null}>
          <KmlLibrary
            onClose={() => { setKmlLibraryOpen(false); setKmlPreview({ lines: [], key: 0 }) }}
            onDataChange={handleDataChange}
            onPreview={lines => setKmlPreview(p => ({ lines, key: p.key + 1 }))}
          />
        </Suspense>
      )}

      {selectedSegment && (
        <SegmentInfoPanel
          segment={selectedSegment.segment}
          nodes={nodes} segments={segments} systems={systems} capacity={capacity}
          outages={outages}
          kmlPaths={kmlPaths}
          initialX={selectedSegment.x} initialY={selectedSegment.y}
          onClose={() => setSelectedSegment(null)}
          onDataChange={handleDataChange}
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
        <Suspense fallback={null}>
          <CapacityDashboard
            segments={segments} capacity={capacity}
            onClose={() => setCapDashOpen(false)}
          />
        </Suspense>
      )}

      {algoEvalOpen && (
        <Suspense fallback={null}>
          <AlgoEval
            nodes={nodes} segments={segments} systems={systems}
            onClose={() => setAlgoEvalOpen(false)}
          />
        </Suspense>
      )}

      {refDataOpen && (
        <Suspense fallback={null}>
          <RefDataModal
            kmlPaths={kmlPaths}
            nodes={nodes} segments={segments} systems={systems}
            capacity={capacity} outages={outages} rules={rules} config={config}
            onDataChange={handleDataChange}
            initialNoteFocus={refDataNoteFocus ?? undefined}
            onClose={() => { setRefDataOpen(false); setRefDataNoteFocus(null) }}
          />
        </Suspense>
      )}

      {cableImportOpen && (
        <Suspense fallback={null}>
          <CableImportWizard
            nodes={nodes} segments={segments} systems={systems}
            onDataChange={handleDataChange}
            onClose={() => setCableImportOpen(false)}
            // Phase 2 handoff: jump straight into Chop Import with the SCM
            // cable already flattened and the new segments already declared.
            // runFlattenForScmCable takes systemId/segmentIds as explicit
            // arguments rather than re-reading kmlChop's own `segments` prop,
            // because that prop cannot have re-rendered with these very rows
            // yet — see that function's own comment in useKmlChopState.ts.
            onLinkGeometry={(systemId, segmentIds, scmCableId) => {
              setCableImportOpen(false)
              setKmlImportOpen(true)
              void kmlChop.runFlattenForScmCable(scmCableId, systemId, segmentIds)
            }}
          />
        </Suspense>
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
            <div style={{ fontSize: 16, fontWeight: 700, color: theme.text, marginBottom: 10 }}>
              {mode === 'networkeditor' ? 'Discard pending changes?' : 'Discard route?'}
            </div>
            <div style={{ fontSize: 13, color: theme.textMuted, marginBottom: 24, lineHeight: 1.6 }}>
              {mode === 'networkeditor'
                ? unsavedEditorChangesWarning(editorState.pending.length)
                : "You're mid-build in RouteManual. Switching tabs will discard the route in progress."}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => {
                  const m = warnSwitchMode; setWarnSwitchMode(null)
                  if (mode === 'networkeditor') dispatchEditor({ type: 'DISCARD_ALL' })
                  switchMode(m)
                }}
                style={{ flex: 1, padding: '10px', borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: 'pointer', border: 'none', background: theme.red, color: '#fff', fontFamily: 'inherit' }}
              >{mode === 'networkeditor' ? 'Yes, discard changes' : 'Yes, discard route'}</button>
              <button
                onClick={() => setWarnSwitchMode(null)}
                style={{ flex: 1, padding: '10px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: `1px solid ${theme.border}`, background: 'transparent', color: theme.textMuted, fontFamily: 'inherit' }}
              >{mode === 'networkeditor' ? 'Keep editing' : 'Keep building'}</button>
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
                  void (async () => {
                    const { generateSldFromProject, generateStraightLineDiagram } = await loadExporters()
                    if (activeProject) generateSldFromProject(activeProject, pinnedRoutes, nodes, sldVersion || undefined)
                    else generateStraightLineDiagram(pinnedRoutes, nodes, sldVersion || undefined)
                    setSldVersionPrompt(false)
                  })()
                }
                if (e.key === 'Escape') setSldVersionPrompt(false)
              }}
            />
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button
                onClick={async () => {
                  const { generateSldFromProject, generateStraightLineDiagram } = await loadExporters()
                  if (activeProject) generateSldFromProject(activeProject, pinnedRoutes, nodes, sldVersion || undefined)
                  else generateStraightLineDiagram(pinnedRoutes, nodes, sldVersion || undefined)
                  setSldVersionPrompt(false)
                }}
                style={{ padding: '8px 18px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: 'none', background: theme.blue, color: theme.bgCard, fontFamily: 'inherit' }}
              >Export PDF</button>
              <button
                onClick={async () => {
                  const { generateDrawioXml } = await loadExporters()
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
                onClick={async () => {
                  // Every segment of every pinned route, in order, deduplicated
                  // — a worker/protect pair shares terrestrial tails and the
                  // recipient does not want the same cable twice.
                  const { exportSegmentsAsKml } = await import('./utils/exportKml')
                  const seen = new Set<string>()
                  const segs = pinnedRoutes
                    .flatMap(p => p.route.segments)
                    .map(rs => segments.find(s => s.id === rs.segment_id))
                    .filter((s): s is CableSegment => !!s && !seen.has(s.id) && !!seen.add(s.id))
                  const label = pinnedRoutes[0]?.circuitLabel ?? pinnedRoutes[0]?.searchLabel ?? 'Route'
                  await exportSegmentsAsKml(segs, nodes, id => !!kmlPaths[id], {
                    title: label,
                    subtitle: `${pinnedRoutes.length} pinned route${pinnedRoutes.length === 1 ? '' : 's'}.`,
                    filename: `${label}-${new Date().toISOString().slice(0, 10)}`,
                  })
                  setSldVersionPrompt(false)
                }}
                style={{ padding: '8px 18px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: `1px solid ${theme.blue}`, background: 'transparent', color: theme.blue, fontFamily: 'inherit' }}
              >Export KML</button>
              <button
                onClick={async () => {
                  const { generateVisioVsdx } = await loadExporters()
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
                onKeyDown={e => {
                  if (e.key === 'Enter') { confirmPinToProject() }
                  if (e.key === 'Escape') { setPendingPin(null); setPendingPinLabel('') }
                }}
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
          <Suspense fallback={null}><UserGuide nodes={nodes} segments={segments} systems={systems} /></Suspense>
        </div>,
        document.body
      )}
     </HazardProvider>
    </ThemeContext.Provider>
  )
}

/** A small uppercase divider label above one group of Controls-menu rows —
 *  "Display" / "Overlays" / "Tools" — so a flat list of otherwise
 *  identically-styled rows (toggles sitting right next to "open a panel"
 *  actions) reads as the three genuinely different kinds of thing they are,
 *  rather than one undifferentiated stack. */
function ControlsSectionLabel({ theme, children }: { theme: Theme; children: string }) {
  return (
    <div style={{
      padding: '10px 16px 4px', fontSize: 10, fontWeight: 700, color: theme.textFaintest,
      textTransform: 'uppercase', letterSpacing: '0.08em',
    }}>{children}</div>
  )
}

/** One row in the Controls menu — a toggle (has `active`/`color`) or a
 *  plain action (opens a panel, just `onClick`). `index` drives a small
 *  stagger on the entrance animation so the menu's rows settle in one after
 *  another rather than all snapping in at once — cheap to add here since
 *  every row already goes through this one function, and it's what turns
 *  "the menu appeared" into "the menu is unfolding", which is the kind of
 *  small motion the whole point of this pass was to add. `hint`, when
 *  given, upgrades the row from just a label to a Tooltip explaining what
 *  it actually does — added only where the label alone leaves a real
 *  question (what does "Backhaul Only" hide, exactly?), not on every row. */
function ControlsRow({ theme, index, item }: {
  theme: Theme
  index: number
  item: { label: string; icon: string; onClick: () => void; active?: boolean; color?: string; hint?: string }
}) {
  const row = (
    <button
      onClick={item.onClick}
      aria-pressed={item.active}
      className="rb-anim-rise rb-btn-motion"
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        width: '100%', padding: '12px 16px',
        background: item.active ? item.color + '18' : 'transparent',
        border: 'none', borderBottom: `1px solid ${theme.border}`,
        cursor: 'pointer', textAlign: 'left',
        animationDelay: `${Math.min(index, 12) * 12}ms`,
      }}
    >
      <span style={{ fontSize: 16, width: 22, textAlign: 'center' }}>{item.icon}</span>
      <span style={{ fontSize: 13, color: item.active ? item.color : theme.text, fontWeight: item.active ? 600 : 400, flex: 1 }}>
        {item.label}
      </span>
      {item.active !== undefined && item.active && (
        <span style={{ fontSize: 10, fontWeight: 700, color: item.color, textTransform: 'uppercase', letterSpacing: '0.05em' }}>On</span>
      )}
      {item.active === undefined && (
        <span style={{ fontSize: 14, color: theme.textFaintest }}>›</span>
      )}
    </button>
  )
  return item.hint ? <Tooltip label={item.hint}>{row}</Tooltip> : row
}

/**
 * Footer of the left panel: the admin lock/unlock control. Reads AuthContext.
 * If no passphrase is configured (authRequired === false) it renders nothing.
 * Otherwise it shows "Read-only" until the user enters the admin passphrase,
 * after which editing (in RefDataModal etc.) is enabled and it shows "Admin mode".
 */
function AdminBar() {
  const { authRequired, mode } = useAuth()
  if (!authRequired) return null
  // Split into separate components rather than one branching on `mode`
  // internally: each mode's UI is only ever relevant on its own, and
  // keeping them apart means none adds to the others' own cognitive-
  // complexity budget. okta/entra share ONE component (SsoAdminBar) rather
  // than each getting their own near-identical copy — the two only ever
  // differ in the provider name and the admin noun (group vs role) shown
  // in the read-only hint text.
  if (mode === 'okta') return <SsoAdminBar provider="Okta" adminNoun="group" />
  if (mode === 'entra') return <SsoAdminBar provider="Entra ID" adminNoun="role" />
  return <AdminKeyBar />
}

/** okta/entra modes' shared AdminBar: authRequired is always true (the
 *  gate already required a session before App ever mounted), so this
 *  always shows — who is signed in and whether their SSO group/role grants
 *  admin, with a Sign out button. There is no "Unlock" flow: isAdmin is
 *  decided entirely by the SSO provider, not by anything typed into this
 *  app. */
function SsoAdminBar({ provider, adminNoun }: { provider: string; adminNoun: string }) {
  const { isAdmin, userLabel, lock } = useAuth()
  const t = useTheme()
  return (
    <div style={{ padding: '6px 12px', borderTop: `1px solid ${t.border}`, background: isAdmin ? `${t.green}11` : `${t.orange}11`, flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 13 }}>{isAdmin ? '🔓' : '🔒'}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: isAdmin ? t.green : t.orange, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            {isAdmin ? 'Admin mode' : 'Read-only'}
          </div>
          {userLabel && (
            <div style={{ fontSize: 10, color: t.textFaint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{userLabel}</div>
          )}
        </div>
        <button onClick={lock} style={{ fontSize: 10, padding: '3px 8px', borderRadius: 4, border: `1px solid ${t.border}`, background: 'transparent', color: t.textFaint, cursor: 'pointer' }}>Sign out</button>
      </div>
      {!isAdmin && (
        <div style={{ fontSize: 10, color: t.textFaint, marginTop: 3 }}>Ask your {provider} administrator to add you to the admin {adminNoun} for editing access.</div>
      )}
    </div>
  )
}

/** admin_key mode's AdminBar — unchanged behaviour from before AUTH_MODE
 *  existed: shows "Read-only" until the user enters the admin passphrase. */
function AdminKeyBar() {
  const { isAdmin, unlock, lock } = useAuth()
  const t = useTheme()
  const [showUnlock, setShowUnlock] = useState(false)
  const [key, setKey] = useState('')
  const [err, setErr] = useState(false)
  const [busy, setBusy] = useState(false)

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
            onKeyDown={e => {
              if (e.key === 'Enter') { attempt() }
              if (e.key === 'Escape') { setShowUnlock(false); setKey('') }
            }}
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

/** The middle column's header label — Chop Import overlays whichever mode is
 *  underneath (see the left-panel body's own comment), so it takes priority
 *  over Network Editor's own label the same way. An if-chain rather than a
 *  nested ternary, which this file's lint config refuses. */
function middlePanelLabel(kmlImportOpen: boolean, mode: AppMode): string {
  if (kmlImportOpen) return 'Chop Import'
  if (mode === 'networkeditor') return 'Network Editor'
  return 'Routes'
}

/** What the middle panel actually has to show for the given mode right now —
 *  mirrors the render branches it drives (KmlChopTablePanel / EditorPendingPanel
 *  / RouteManualMiddle+RouteList / RouteList). A mode's own empty-state message
 *  ("Configure a route request…", "Pending changes will appear here…") doesn't
 *  count — that message IS the wasted-space case this flag exists to catch. */
function middlePanelHasContent(args: {
  mode: AppMode
  kmlImportOpen: boolean
  editorState: EditorState
  manualState: ManualState | null
  manualResults: Route[]
  hasResults: boolean
  hasPins: boolean
  loading: boolean
}): boolean {
  const { mode, kmlImportOpen, editorState, manualState, manualResults, hasResults, hasPins, loading } = args
  if (kmlImportOpen) return true
  if (mode === 'networkeditor') return editorState.pending.length > 0 || Object.keys(editorState.saveProgress).length > 0
  if (mode === 'routemanual') return manualState !== null || manualResults.length > 0 || hasPins
  return hasResults || hasPins || loading
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

