import { lazy, Suspense, useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Map } from './Map'
import { SearchForm } from './SearchForm'
import { RouteList } from './RouteList'
import type { SortKey } from './RouteList'
import { SystemViewer } from './SystemViewer'
import { NodeFinder } from './NodeFinder'
import { CityPairPanel } from './CityPairPanel'
import { RouteManual } from './RouteManual'
import type { ManualState, NextHopCandidate } from './RouteManual'
import { NodeInfoPanel } from './NodeInfoPanel'
import { RefDataModal } from './RefDataModal'
import { HealthBar } from './HealthBar'
import { CapacityDashboard } from './CapacityDashboard'
import { generateStraightLineDiagram } from '../utils/generateDiagram'
import { useTheme } from '../theme'
import type { ThemeMode } from '../theme'
import type {
  AppConfig, AppMode, CableNode, CableSegment, CableSystem, InterconnectRule,
  NlpSortMode, PinnedRoute, Project, Route, RouteRequest, RouteResponse, SegmentCapacity, SegmentOutage,
  SelectedSystem, DiversityType,
} from '../types'

const NLP_ENABLED = import.meta.env.VITE_ENABLE_NLP !== 'false'
const NlpChat = NLP_ENABLED
  ? lazy(() => import('./NlpChat'))
  : null

// ── Sheet snap positions ────────────────────────────────────────────────────
type SheetSnap = 'peek' | 'mid' | 'full'

const PEEK_H = 76   // handle (28px) + tab bar (~48px)
const MID_F  = 0.46
const FULL_F = 0.91

function snapPx(snap: SheetSnap): number {
  const vh = window.innerHeight
  if (snap === 'peek') return PEEK_H
  if (snap === 'mid')  return Math.round(vh * MID_F)
  return Math.round(vh * FULL_F)
}

function nearestSnap(h: number, velocity: number): SheetSnap {
  const vh = window.innerHeight
  const opts: [SheetSnap, number][] = [
    ['peek', PEEK_H],
    ['mid',  vh * MID_F],
    ['full', vh * FULL_F],
  ]
  // Fast flick up → go to full; fast flick down → go to peek
  if (velocity < -0.6) return 'full'
  if (velocity >  0.6) return 'peek'
  return opts.reduce((best, cur) =>
    Math.abs(cur[1] - h) < Math.abs(best[1] - h) ? cur : best
  )[0]
}

// ── Props ───────────────────────────────────────────────────────────────────
export interface MobileLayoutProps {
  nodes: CableNode[]
  segments: CableSegment[]
  systems: CableSystem[]
  capacity: SegmentCapacity[]
  outages: SegmentOutage[]
  rules: InterconnectRule[]
  response: RouteResponse | null
  selectedRoutes: Route[]
  selectedRouteIds: string[]
  pinnedRoutes: PinnedRoute[]
  selectedSystems: SelectedSystem[]
  mode: AppMode
  loading: boolean
  error: string | null
  selectedNode: { node: CableNode; x: number; y: number } | null
  searchPin: { lat: number; lng: number; label: string } | null
  nearestNodeIds: string[]
  prefilledOrigin: string
  prefilledDest: string
  lastSearchDiversity: DiversityType
  refDataOpen: boolean
  themeMode: ThemeMode
  config: AppConfig
  onSearch:          (req: RouteRequest) => void
  onToggleRoute:     (id: string) => void
  onPin:             (route: Route) => void
  onUnpin:           (pinId: string) => void
  onPinPair?:        (worker: Route, protect: Route) => void
  onToggleSystem:    (systemId: string) => void
  onSetOrigin:       (nodeId: string) => void
  onSetDest:         (nodeId: string) => void
  onSetPair:         (originId: string, destId: string) => void
  onNodeClick:       (node: CableNode, x: number, y: number) => void
  onPinChange:       (pin: { lat: number; lng: number; label: string } | null, ids: string[]) => void
  onCloseNode:       () => void
  onOpenRefData:     () => void
  onCloseRefData:    () => void
  onDataChange:      () => Promise<void>
  switchMode:        (m: AppMode) => void
  clearSearch:       () => void
  clearAll:          () => void
  cycleTheme:                    () => void
  onToggleHideNonActive:         () => void
  onToggleShowSegmentLabels:     () => void
  onToggleShowAllOutages:        () => void
  onApplySort?:                  (mode: NlpSortMode) => void
  nlpSortKey?:                   SortKey
  nlpPushOutages?:               boolean
  optimiseFor?:                  string
  flippedPairIds?:               Set<string>
  onFlipPair?:                   (pairId: string) => void
  onAddToProject?:               (route: Route, protectRoute?: Route) => void
  onEnrichCircuit?:              (pin: PinnedRoute) => void
  onOpenProjects?:               () => void
  activeProject?:                Project | null
  onExitProjectMode?:            () => void
  onSwitchProject?:              () => void
  onOpenGuide:                   () => void
  // RouteManual
  manualState?:                  ManualState | null
  manualCandidates?:             NextHopCandidate[]
  manualResults?:                Route[]
  onManualNodeClick?:            (node: CableNode) => void
  onManualPickHop?:              (c: NextHopCandidate) => void
  onManualUndo?:                 () => void
  onManualFinish?:               () => void
  onManualDiscard?:              () => void
}

function MobileModeBanner({ activeProject, onSwitch, onExit, t }: {
  activeProject: Project | null
  onSwitch: () => void
  onExit: () => void
  t: import('../theme').Theme
}) {
  const [open, setOpen] = useState(false)
  const isProject = !!activeProject

  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 16px', border: 'none', cursor: 'pointer',
          background: isProject ? `${t.blue}22` : t.bgPanel,
          borderBottom: `1px solid ${isProject ? t.blue + '55' : t.border}`,
          color: isProject ? t.blue : t.textMuted,
          textAlign: 'left',
        }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
          {isProject
            ? <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            : <><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M2 12h3M19 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12"/></>
          }
        </svg>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', opacity: 0.75, lineHeight: 1 }}>
            {isProject ? 'Project Mode' : 'Mode'}
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, color: isProject ? t.blue : t.text, lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
            background: t.bgPanel, border: `1px solid ${t.border}`,
            borderTop: 'none', borderRadius: '0 0 8px 8px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            padding: 12, display: 'flex', flexDirection: 'column', gap: 8,
          }}>
            {isProject && activeProject.customer_name && (
              <div style={{ fontSize: 11, color: t.textMuted, paddingBottom: 4, borderBottom: `1px solid ${t.border}` }}>
                👤 {activeProject.customer_name} · {activeProject.circuits.length} circuit{activeProject.circuits.length !== 1 ? 's' : ''}
              </div>
            )}
            {isProject ? (
              <>
                <button onClick={() => { setOpen(false); onSwitch() }} style={{ padding: '8px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, border: `1px solid ${t.blue}66`, background: `${t.blue}18`, color: t.blue, cursor: 'pointer', textAlign: 'left' }}>
                  ⇄ Switch Project
                </button>
                <button onClick={() => { setOpen(false); onExit() }} style={{ padding: '8px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, border: `1px solid ${t.border}`, background: 'transparent', color: t.textMuted, cursor: 'pointer', textAlign: 'left' }}>
                  ✕ Exit to Circuit Designer
                </button>
              </>
            ) : (
              <button onClick={() => { setOpen(false); onSwitch() }} style={{ padding: '8px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, border: `1px solid ${t.blue}66`, background: `${t.blue}18`, color: t.blue, cursor: 'pointer', textAlign: 'left' }}>
                📁 Open a Project
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}

export function MobileLayout({
  nodes, segments, systems, capacity, outages, rules,
  response, selectedRoutes, selectedRouteIds, pinnedRoutes, selectedSystems,
  mode, loading, error, selectedNode, searchPin, nearestNodeIds,
  prefilledOrigin, prefilledDest, lastSearchDiversity,
  refDataOpen, themeMode, config,
  onSearch, onToggleRoute, onPin, onUnpin, onPinPair, onToggleSystem,
  onSetOrigin, onSetDest, onSetPair, onNodeClick, onPinChange,
  onCloseNode, onOpenRefData, onCloseRefData, onDataChange,
  switchMode, clearSearch, clearAll, cycleTheme, onToggleHideNonActive, onToggleShowSegmentLabels, onToggleShowAllOutages,
  onApplySort, nlpSortKey, nlpPushOutages, optimiseFor, flippedPairIds, onFlipPair,
  onAddToProject, onEnrichCircuit, onOpenProjects, activeProject, onExitProjectMode, onSwitchProject, onOpenGuide,
  manualState, manualCandidates = [], manualResults = [], onManualNodeClick,
  onManualPickHop, onManualUndo, onManualFinish, onManualDiscard,
  hideNonActive = false, showSegmentLabels = false, showAllOutages = false,
}: MobileLayoutProps & { hideNonActive?: boolean; showSegmentLabels?: boolean; showAllOutages?: boolean }) {
  const t = useTheme()

  const [sheetHeight, setSheetHeight] = useState(() => snapPx('mid'))
  const [snap, setSnap]               = useState<SheetSnap>('mid')
  const [animating, setAnimating]     = useState(false)

  const dragging    = useRef(false)
  const startY      = useRef(0)
  const startH      = useRef(0)
  const lastY       = useRef(0)
  const lastTime    = useRef(0)
  const velocity    = useRef(0)  // px/ms, positive = downward

  const [capDashOpen, setCapDashOpen]     = useState(false)
  const [drawerOpen, setDrawerOpen]       = useState(false)
  const [sldVersionPrompt, setSldVersionPrompt] = useState(false)
  const [sldVersion, setSldVersion]       = useState('')
  const [searchPrefill, setSearchPrefill] = useState<import('../types').RouteRequest | undefined>(undefined)
  const hasPins      = pinnedRoutes.length > 0
  const hasResults   = response !== null || manualResults.length > 0
  const manualBuilding = mode === 'routemanual' && !!manualState

  // Auto-expand when results arrive or search starts
  useEffect(() => {
    if ((hasResults || loading) && snap === 'peek') doSnap('mid')
  }, [hasResults, loading]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-peek sheet when RouteManual is actively building so map is mostly visible
  useEffect(() => {
    if (manualBuilding && snap !== 'peek') doSnap('peek')
  }, [manualBuilding]) // eslint-disable-line react-hooks/exhaustive-deps

  function doSnap(s: SheetSnap) {
    setAnimating(true)
    setSnap(s)
    setSheetHeight(snapPx(s))
    setTimeout(() => setAnimating(false), 320)
  }

  function onPointerDown(e: React.PointerEvent) {
    dragging.current  = true
    startY.current    = e.clientY
    startH.current    = sheetHeight
    lastY.current     = e.clientY
    lastTime.current  = e.timeStamp
    velocity.current  = 0
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!dragging.current) return
    // Track velocity (positive = moving down)
    const dt = e.timeStamp - lastTime.current
    if (dt > 0) velocity.current = (e.clientY - lastY.current) / dt
    lastY.current  = e.clientY
    lastTime.current = e.timeStamp
    // Resize sheet
    const delta = startY.current - e.clientY   // positive = dragging up
    const maxH  = window.innerHeight * FULL_F
    setSheetHeight(Math.max(PEEK_H, Math.min(startH.current + delta, maxH)))
    if (animating) setAnimating(false)
  }

  function onPointerUp() {
    if (!dragging.current) return
    dragging.current = false
    doSnap(nearestSnap(sheetHeight, velocity.current))
  }

  function tapTab(next: AppMode) {
    switchMode(next)
    if (snap === 'peek') doSnap('mid')
  }

  // ── Styles ────────────────────────────────────────────────────────────────
  const tabBtn = (active: boolean): React.CSSProperties => ({
    flex: 1, padding: '10px 4px', border: 'none', cursor: 'pointer',
    background: 'transparent',
    color: active ? t.blue : t.textFaint,
    fontSize: 11, fontWeight: active ? 700 : 400,
    textTransform: 'uppercase', letterSpacing: '0.04em',
    lineHeight: 1.25,
    borderBottom: active ? `2px solid ${t.blue}` : '2px solid transparent',
    transition: 'color 0.15s, border-color 0.15s',
  })

  const smallBtn = (destructive = false): React.CSSProperties => ({
    padding: '4px 10px', borderRadius: 4, border: `1px solid ${t.border}`,
    background: 'transparent', color: destructive ? t.red : t.textMuted,
    cursor: 'pointer', fontSize: 11, fontWeight: 600,
  })

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'hidden', fontFamily: 'system-ui, sans-serif', color: t.text }}>

      {/* ── Full-screen map ─────────────────────────────────────────────── */}
      <div style={{ position: 'absolute', inset: 0, zIndex: 1 }}>
        {nodes.length > 0 ? (
          <Map
            nodes={nodes}
            segments={segments}
            selectedRoutes={selectedRoutes}
            capacity={capacity}
            pinnedRoutes={pinnedRoutes}
            selectedSystems={selectedSystems}
            onNodeClick={mode === 'routemanual' && onManualNodeClick ? onManualNodeClick : onNodeClick}
            searchPin={searchPin ?? undefined}
            nearestNodeIds={nearestNodeIds}
            hideNonActive={hideNonActive}
            showSegmentLabels={showSegmentLabels}
            showAllOutages={showAllOutages}
            outages={outages}
            manualState={manualState}
            manualCandidates={manualCandidates}
            onManualNodeClick={onManualNodeClick}
            manualMobileMode={manualBuilding}
          />
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: t.textFaint, background: t.bgMap }}>
            Loading network…
          </div>
        )}
      </div>

      {/* ── Top-left branding ───────────────────────────────────────────── */}
      <div
        onClick={onOpenGuide}
        title="Open platform guide"
        style={{
          position: 'absolute', top: 14, left: 14, zIndex: 100,
          background: t.bgPanel + 'f0',
          borderRadius: 10, padding: '5px 10px',
          border: `1px solid ${t.border}`,
          boxShadow: themeMode === 'light' ? '0 2px 8px rgba(0,0,0,0.15)' : '0 2px 10px rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
        }}
      >
        <img src="/favicon.svg" alt="" style={{ width: 22, height: 22, flexShrink: 0 }} />
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: t.text, lineHeight: 1.25 }}>RouteBuilder</div>
          <div style={{ fontSize: 9, color: t.textFaint, letterSpacing: '0.04em', marginTop: 1 }}>International Telco</div>
        </div>
      </div>

      {/* ── Top-right drawer toggle + panel ────────────────────────────── */}
      <div style={{ position: 'absolute', top: 14, right: 14, zIndex: 200 }}>

        {/* Toggle button */}
        <button
          onClick={() => setDrawerOpen(o => !o)}
          style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
            padding: '6px 10px', borderRadius: 10,
            border: `1px solid ${drawerOpen ? t.blue : t.border}`,
            background: drawerOpen ? t.blue + '22' : t.bgPanel + 'f0',
            color: drawerOpen ? t.blue : t.textMuted,
            cursor: 'pointer',
            boxShadow: themeMode === 'light' ? '0 2px 8px rgba(0,0,0,0.15)' : '0 2px 10px rgba(0,0,0,0.5)',
          }}
        >
          <span style={{ fontSize: 18, lineHeight: 1 }}>{drawerOpen ? '✕' : '≡'}</span>
          <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', lineHeight: 1 }}>
            {drawerOpen ? 'Close' : 'Controls'}
          </span>
        </button>

        {/* Drawer panel */}
        {drawerOpen && (
          <>
            {/* Backdrop to close on outside tap */}
            <div
              onClick={() => setDrawerOpen(false)}
              style={{ position: 'fixed', inset: 0, zIndex: -1 }}
            />
            <div style={{
              position: 'absolute', top: 50, right: 0,
              width: 220,
              background: t.bgPanel,
              border: `1px solid ${t.border}`,
              borderRadius: 12,
              boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
              overflow: 'hidden',
            }}>
              {/* Toggles */}
              {[
                {
                  label: 'Show All Outages',
                  icon: '🚢',
                  active: showAllOutages,
                  color: t.red,
                  onClick: () => { onToggleShowAllOutages(); setDrawerOpen(false) },
                },
                {
                  label: 'Segment Labels',
                  icon: showSegmentLabels ? 'A⃝' : 'A',
                  active: showSegmentLabels,
                  color: t.blue,
                  onClick: () => { onToggleShowSegmentLabels(); setDrawerOpen(false) },
                },
                {
                  label: 'Hide Non-Active',
                  icon: hideNonActive ? '◉' : '◎',
                  active: hideNonActive,
                  color: t.blue,
                  onClick: () => { onToggleHideNonActive(); setDrawerOpen(false) },
                },
              ].map(item => (
                <button
                  key={item.label}
                  onClick={item.onClick}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    width: '100%', padding: '13px 16px',
                    background: item.active ? item.color + '18' : 'transparent',
                    border: 'none', borderBottom: `1px solid ${t.border}`,
                    cursor: 'pointer', textAlign: 'left',
                  }}
                >
                  <span style={{ fontSize: 17, width: 22, textAlign: 'center' }}>{item.icon}</span>
                  <span style={{ fontSize: 13, color: item.active ? item.color : t.text, fontWeight: item.active ? 600 : 400 }}>
                    {item.label}
                  </span>
                  {item.active && (
                    <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 700, color: item.color, textTransform: 'uppercase', letterSpacing: '0.05em' }}>On</span>
                  )}
                </button>
              ))}

              {/* Actions */}
              {[
                {
                  label: 'Projects',
                  icon: '📁',
                  onClick: () => { onOpenProjects?.(); setDrawerOpen(false) },
                },
                {
                  label: 'Network Capacity',
                  icon: '📊',
                  onClick: () => { setCapDashOpen(true); setDrawerOpen(false) },
                },
                {
                  label: 'Reference Data',
                  icon: '⚙',
                  onClick: () => { onOpenRefData(); setDrawerOpen(false) },
                },
              ].map(item => (
                <button
                  key={item.label}
                  onClick={item.onClick}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    width: '100%', padding: '13px 16px',
                    background: 'transparent',
                    border: 'none', borderBottom: `1px solid ${t.border}`,
                    cursor: 'pointer', textAlign: 'left',
                  }}
                >
                  <span style={{ fontSize: 17, width: 22, textAlign: 'center' }}>{item.icon}</span>
                  <span style={{ fontSize: 13, color: t.text }}>{item.label}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 14, color: t.textFaintest }}>›</span>
                </button>
              ))}

              {/* Theme cycle */}
              <button
                onClick={() => { cycleTheme(); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  width: '100%', padding: '13px 16px',
                  background: 'transparent', border: 'none',
                  cursor: 'pointer', textAlign: 'left',
                }}
              >
                <span style={{ fontSize: 17, width: 22, textAlign: 'center' }}>
                  {themeMode === 'dark' ? '🌅' : themeMode === 'dusk' ? '☀️' : '🌙'}
                </span>
                <span style={{ fontSize: 13, color: t.text }}>
                  {themeMode === 'dark' ? 'Switch to Dusk' : themeMode === 'dusk' ? 'Switch to Light' : 'Switch to Dark'}
                </span>
              </button>
            </div>
          </>
        )}
      </div>

      {/* ── RouteManual floating build strip (shown only when building at peek) ── */}
      {manualBuilding && snap === 'peek' && (() => {
        const steps  = manualState!.steps
        const hopCount = steps.length
        const km     = steps.reduce((a, s) => {
          const seg = segments.find(x => x.id === s.segmentId)
          return a + (seg?.length_km ?? 0)
        }, 0)
        const ms     = steps.reduce((a, s) => {
          const seg = segments.find(x => x.id === s.segmentId)
          return a + (seg?.latency ?? 0)
        }, 0)
        return (
          <div style={{
            position: 'fixed', bottom: PEEK_H, left: 0, right: 0, zIndex: 49,
            background: t.bgPanel + 'f8',
            borderTop: `1px solid ${t.border}`,
            padding: '8px 14px',
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            {/* Stats */}
            <div style={{ display: 'flex', gap: 12, flex: 1 }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: t.text }}>{hopCount}</div>
                <div style={{ fontSize: 9, color: t.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Hops</div>
              </div>
              {hopCount > 0 && <>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: t.text }}>{km.toLocaleString()}</div>
                  <div style={{ fontSize: 9, color: t.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>km</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: t.text }}>{ms.toFixed(0)}</div>
                  <div style={{ fontSize: 9, color: t.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>ms</div>
                </div>
              </>}
            </div>
            {/* Action buttons */}
            <div style={{ display: 'flex', gap: 6 }}>
              {hopCount > 0 && (
                <button onClick={onManualUndo} style={{
                  padding: '7px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                  border: `1px solid ${t.border}`, background: 'transparent', color: t.textMuted,
                  cursor: 'pointer', fontFamily: 'inherit',
                }}>↩</button>
              )}
              {hopCount > 0 && (
                <button onClick={onManualFinish} style={{
                  padding: '7px 12px', borderRadius: 8, fontSize: 12, fontWeight: 700,
                  border: 'none', background: t.green, color: '#fff',
                  cursor: 'pointer', fontFamily: 'inherit',
                }}>✓ Done</button>
              )}
              <button onClick={() => doSnap('mid')} style={{
                padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700,
                border: `1px solid ${t.blue}66`, background: `${t.blue}18`, color: t.blue,
                cursor: 'pointer', fontFamily: 'inherit',
              }}>{manualCandidates.length} options ›</button>
            </div>
          </div>
        )
      })()}

      {/* ── Bottom sheet ────────────────────────────────────────────────── */}
      <div
        style={{
          position: 'fixed', bottom: 0, left: 0, right: 0,
          height: sheetHeight,
          background: t.bgPanel,
          borderRadius: '16px 16px 0 0',
          boxShadow: '0 -4px 32px rgba(0,0,0,0.35)',
          zIndex: 50,
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
          transition: animating ? 'height 0.3s cubic-bezier(0.4,0,0.2,1)' : 'none',
        }}
      >
        {/* Drag handle */}
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          style={{
            flexShrink: 0, height: 28,
            display: 'flex', justifyContent: 'center', alignItems: 'center',
            cursor: 'ns-resize', touchAction: 'none',
            userSelect: 'none',
          }}
        >
          <div style={{ width: 40, height: 4, borderRadius: 2, background: t.borderSubtle }} />
        </div>

        {/* Mode banner */}
        <MobileModeBanner
          activeProject={activeProject ?? null}
          onSwitch={() => onSwitchProject?.()}
          onExit={() => onExitProjectMode?.()}
          t={t}
        />

        {/* ── Top-level tabs: RouteBuilder | NetworkExplorer | Guide ── */}
        {(() => {
          const isRouteBuilder   = mode === 'routebuilder' || mode === 'routemanual'
          const isNetworkExplorer = mode === 'citypair' || mode === 'systemviewer' || mode === 'nodefinder' || mode === 'countryviewer'
          return (
            <div style={{ flexShrink: 0, display: 'flex', borderBottom: `1px solid ${t.border}` }}>
              <button style={tabBtn(isRouteBuilder)}    onClick={() => tapTab(mode === 'routemanual' ? 'routemanual' : 'routebuilder')}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 2 }}>
                  <path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z"/>
                </svg>
                <br/>RouteBuilder
              </button>
              <button style={tabBtn(isNetworkExplorer)} onClick={() => tapTab('citypair')}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 2 }}>
                  <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
                </svg>
                <br/>NetworkExp.
              </button>
              <button style={tabBtn(false)} onClick={onOpenGuide}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 2 }}>
                  <circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
                <br/>Guide
              </button>
            </div>
          )
        })()}

        {/* ── Sub-tabs for RouteBuilder ── */}
        {(mode === 'routebuilder' || mode === 'routemanual') && (
          <div style={{ flexShrink: 0, display: 'flex', borderBottom: `1px solid ${t.border}`, background: t.bgDeep }}>
            <button style={tabBtn(mode === 'routebuilder')} onClick={() => tapTab('routebuilder')}>RouteFinder</button>
            <button style={tabBtn(mode === 'routemanual')}  onClick={() => tapTab('routemanual')}>RouteManual</button>
          </div>
        )}

        {/* ── Sub-tabs for NetworkExplorer ── */}
        {(mode === 'citypair' || mode === 'systemviewer' || mode === 'nodefinder' || mode === 'countryviewer') && (
          <div style={{ flexShrink: 0, display: 'flex', borderBottom: `1px solid ${t.border}`, background: t.bgDeep }}>
            <button style={tabBtn(mode === 'citypair')}     onClick={() => tapTab('citypair')}>City Pairs</button>
            <button style={tabBtn(mode === 'systemviewer')} onClick={() => tapTab('systemviewer')}>Cables</button>
            <button style={tabBtn(mode === 'nodefinder')}   onClick={() => tapTab('nodefinder')}>Nodes</button>
          </div>
        )}

        {/* Scrollable content */}
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', overscrollBehavior: 'contain' } as React.CSSProperties}>

          {/* ── RouteFinder mode ──────────────────────────────────────── */}
          {mode === 'routebuilder' && (
            <div style={{ padding: '14px 16px 32px' }}>

              {/* Mini status / action bar */}
              {(hasResults || hasPins || loading) && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  marginBottom: 14, paddingBottom: 12, borderBottom: `1px solid ${t.border}`,
                }}>
                  {loading    && <span style={{ fontSize: 11, color: t.blue }}>Searching…</span>}
                  {hasResults && !loading && <span style={{ fontSize: 11, color: t.textFaintest }}>{(response?.primary_routes.length ?? 0) + (response?.diverse_routes.length ?? 0)} routes found</span>}
                  {hasPins    && <span style={{ fontSize: 11, color: t.textFaintest }}>· {pinnedRoutes.length} pinned</span>}
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                    {hasPins    && <button onClick={() => { setSldVersion(''); setSldVersionPrompt(true) }} style={smallBtn()}>⬡ SLD</button>}
                    {hasResults && <button onClick={clearSearch} style={smallBtn()}>Clear</button>}
                    {(hasResults || hasPins) && <button onClick={clearAll} style={smallBtn(true)}>Clear All</button>}
                  </div>
                </div>
              )}

              {NlpChat && (
                <Suspense fallback={null}>
                  <NlpChat
                    nodes={nodes}
                    onSearch={onSearch}
                    onSwitchMode={switchMode}
                    onApplySort={onApplySort}
                    onPrefill={req => setSearchPrefill({...req} as import('../types').RouteRequest)}
                  />
                </Suspense>
              )}

              <SearchForm
                nodes={nodes} segments={segments} systems={systems}
                onSearch={onSearch} loading={loading}
                prefilledOrigin={prefilledOrigin} prefilledDest={prefilledDest}
                prefill={searchPrefill}
              />

              {error && (
                <div style={{ marginTop: 12, padding: '8px 12px', borderRadius: 6, background: t.bgDeep, color: t.red, fontSize: 13 }}>
                  {error}
                </div>
              )}

              {!hasResults && !loading && !hasPins && (
                <p style={{ color: t.textFaintest, fontSize: 13, marginTop: 14, lineHeight: 1.5 }}>
                  Configure a route request above and press Search.
                </p>
              )}

              {(hasResults || hasPins) && (
                <div style={{ marginTop: 18 }}>
                  <RouteList
                    primaryRoutes={response?.primary_routes ?? []}
                    diverseRoutes={response?.diverse_routes ?? []}
                    totalFound={response?.total_found}
                    selectedRouteIds={selectedRouteIds}
                    onSelectRoute={onToggleRoute}
                    nodes={nodes}
                    systems={systems}
                    capacity={capacity}
                    outages={outages}
                    pinnedRoutes={pinnedRoutes}
                    onPin={onPin}
                    onUnpin={onUnpin}
                    onPinPair={onPinPair}
                    diversityRequested={lastSearchDiversity !== 'none'}
                    onNetOwnership={config.on_net_ownership}
                    externalSortKey={nlpSortKey}
                    externalPushOutagesDown={nlpPushOutages}
                    optimiseFor={optimiseFor}
                    flippedPairIds={flippedPairIds}
                    onFlipPair={onFlipPair}
                    onAddToProject={onAddToProject}
                    onEnrichCircuit={onEnrichCircuit}
                    activeProject={activeProject}
                    onExitProjectMode={onExitProjectMode}
                    onSwitchProject={onSwitchProject}
                  />
                </div>
              )}
            </div>
          )}

          {/* ── RouteManual mode ──────────────────────────────────────── */}
          {mode === 'routemanual' && (
            <RouteManual
              nodes={nodes}
              segments={segments}
              systems={systems}
              capacity={capacity}
              state={manualState ?? null}
              onStart={(nodeId) => {
                const node = nodes.find(n => n.id === nodeId)
                if (node) onManualNodeClick?.(node)
              }}
              onPickHop={(c) => { onManualPickHop?.(c); doSnap('peek') }}
              onUndo={onManualUndo ?? (() => {})}
              onFinish={onManualFinish ?? (() => {})}
              onDiscard={onManualDiscard ?? (() => {})}
              onNetOwnership={config.on_net_ownership}
            />
          )}

          {/* ── RouteManual results ───────────────────────────────────── */}
          {mode === 'routemanual' && manualResults.length > 0 && (
            <div style={{ padding: '0 16px 32px' }}>
              <RouteList
                primaryRoutes={manualResults}
                diverseRoutes={[]}
                selectedRouteIds={selectedRouteIds}
                onSelectRoute={onToggleRoute}
                nodes={nodes}
                systems={systems}
                capacity={capacity}
                outages={outages}
                pinnedRoutes={pinnedRoutes}
                onPin={onPin}
                onUnpin={onUnpin}
                diversityRequested={false}
                onNetOwnership={config.on_net_ownership}
                onAddToProject={onAddToProject}
                activeProject={activeProject}
              />
            </div>
          )}

          {/* ── City Pair mode ────────────────────────────────────────── */}
          {mode === 'citypair' && (
            <div style={{ padding: '14px 16px 32px' }}>
              <CityPairPanel nodes={nodes} segments={segments} systems={systems} onNetOwnership={config.on_net_ownership} onPlanRoute={onSetPair} />
            </div>
          )}

          {/* ── Systems mode ──────────────────────────────────────────── */}
          {mode === 'systemviewer' && (
            <div style={{ padding: '14px 16px 32px' }}>
              <SystemViewer systems={systems} selected={selectedSystems} onToggle={onToggleSystem} />
            </div>
          )}

          {/* ── Node Finder mode ──────────────────────────────────────── */}
          {mode === 'nodefinder' && (
            <div style={{ padding: '14px 16px 32px' }}>
              <NodeFinder
                nodes={nodes}
                onPinChange={onPinChange}
                onSetOrigin={onSetOrigin}
                onSetDest={onSetDest}
              />
            </div>
          )}

        </div>
        <HealthBar dataLoaded={nodes.length > 0} />
      </div>

      {/* ── Node info panel ─────────────────────────────────────────────── */}
      {selectedNode && (
        <NodeInfoPanel
          node={selectedNode.node}
          segments={segments}
          systems={systems}
          initialX={Math.min(selectedNode.x, window.innerWidth - 310)}
          initialY={Math.max(selectedNode.y - 80, 60)}
          onClose={onCloseNode}
        />
      )}

      {/* ── Capacity dashboard ──────────────────────────────────────────── */}
      {capDashOpen && (
        <CapacityDashboard
          segments={segments} capacity={capacity}
          onClose={() => setCapDashOpen(false)}
        />
      )}

      {/* ── Ref data modal ──────────────────────────────────────────────── */}
      {refDataOpen && (
        <RefDataModal
          nodes={nodes} segments={segments} systems={systems}
          capacity={capacity} outages={outages} rules={rules} config={config}
          onDataChange={onDataChange}
          onClose={onCloseRefData}
        />
      )}

      {/* ── SLD version prompt ──────────────────────────────────────────────── */}
      {sldVersionPrompt && createPortal(
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9500,
          background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '0 16px',
        }}>
          <div style={{
            background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 12,
            padding: '24px 20px', width: '100%', maxWidth: 380, boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
          }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: t.text, marginBottom: 4 }}>Export SLD</div>
            <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 14 }}>Add an optional version label to the PDF.</div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
              {['Proposal', 'Draft', 'Final'].map(v => (
                <button key={v} onClick={() => setSldVersion(v)}
                  style={{
                    flex: 1, padding: '8px 4px', borderRadius: 5, fontSize: 12, fontWeight: 600,
                    cursor: 'pointer', fontFamily: 'inherit',
                    border: `1px solid ${sldVersion === v ? t.blue : t.border}`,
                    background: sldVersion === v ? `${t.blue}22` : 'transparent',
                    color: sldVersion === v ? t.blue : t.textMuted,
                  }}
                >{v}</button>
              ))}
            </div>
            <input
              style={{
                width: '100%', background: t.bgBase, border: `1px solid ${t.border}`,
                borderRadius: 6, padding: '10px 12px', color: t.text, fontSize: 14,
                outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit', marginBottom: 16,
              }}
              placeholder="Or type a custom version…"
              value={sldVersion}
              onChange={e => setSldVersion(e.target.value)}
            />
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => { generateStraightLineDiagram(pinnedRoutes, nodes, sldVersion || undefined); setSldVersionPrompt(false) }}
                style={{ flex: 1, padding: '10px', borderRadius: 6, fontSize: 14, fontWeight: 600, cursor: 'pointer', border: 'none', background: t.blue, color: t.bgCard, fontFamily: 'inherit' }}
              >Generate PDF</button>
              <button
                onClick={() => setSldVersionPrompt(false)}
                style={{ flex: 1, padding: '10px', borderRadius: 6, fontSize: 14, fontWeight: 600, cursor: 'pointer', border: `1px solid ${t.border}`, background: 'transparent', color: t.textMuted, fontFamily: 'inherit' }}
              >Cancel</button>
            </div>
          </div>
        </div>,
        document.body
      )}

    </div>
  )
}
