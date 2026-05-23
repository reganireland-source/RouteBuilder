import { lazy, Suspense, useState, useRef, useEffect } from 'react'
import { Map } from './Map'
import { SearchForm } from './SearchForm'
import { RouteList } from './RouteList'
import type { SortKey } from './RouteList'
import { SystemViewer } from './SystemViewer'
import { NodeFinder } from './NodeFinder'
import { CityPairPanel } from './CityPairPanel'
import { NodeInfoPanel } from './NodeInfoPanel'
import { RefDataModal } from './RefDataModal'
import { HealthBar } from './HealthBar'
import { CapacityDashboard } from './CapacityDashboard'
import { generateStraightLineDiagram } from '../utils/generateDiagram'
import { useTheme } from '../theme'
import type { ThemeMode } from '../theme'
import type {
  AppConfig, AppMode, CableNode, CableSegment, CableSystem, InterconnectRule,
  NlpSortMode, PinnedRoute, Route, RouteRequest, RouteResponse, SegmentCapacity, SegmentOutage,
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
}

export function MobileLayout({
  nodes, segments, systems, capacity, outages, rules,
  response, selectedRoutes, selectedRouteIds, pinnedRoutes, selectedSystems,
  mode, loading, error, selectedNode, searchPin, nearestNodeIds,
  prefilledOrigin, prefilledDest, lastSearchDiversity,
  refDataOpen, themeMode, config,
  onSearch, onToggleRoute, onPin, onUnpin, onToggleSystem,
  onSetOrigin, onSetDest, onSetPair, onNodeClick, onPinChange,
  onCloseNode, onOpenRefData, onCloseRefData, onDataChange,
  switchMode, clearSearch, clearAll, cycleTheme, onToggleHideNonActive, onToggleShowSegmentLabels, onToggleShowAllOutages,
  onApplySort, nlpSortKey, nlpPushOutages,
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

  const [capDashOpen, setCapDashOpen] = useState(false)
  const [drawerOpen, setDrawerOpen]   = useState(false)
  const hasPins    = pinnedRoutes.length > 0
  const hasResults = response !== null

  // Auto-expand when results arrive or search starts
  useEffect(() => {
    if ((hasResults || loading) && snap === 'peek') doSnap('mid')
  }, [hasResults, loading]) // eslint-disable-line react-hooks/exhaustive-deps

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

  const floatBtn: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: 38, height: 38, borderRadius: 19,
    border: `1px solid ${t.border}`,
    background: t.bgPanel + 'f0',
    color: t.textMuted, cursor: 'pointer', fontSize: 15,
    boxShadow: themeMode === 'light' ? '0 2px 8px rgba(0,0,0,0.15)' : '0 2px 10px rgba(0,0,0,0.5)',
  }

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
            onNodeClick={onNodeClick}
            searchPin={searchPin ?? undefined}
            nearestNodeIds={nearestNodeIds}
            hideNonActive={hideNonActive}
            showSegmentLabels={showSegmentLabels}
            showAllOutages={showAllOutages}
            outages={outages}
          />
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: t.textFaint, background: t.bgMap }}>
            Loading network…
          </div>
        )}
      </div>

      {/* ── Top-left branding ───────────────────────────────────────────── */}
      <div style={{
        position: 'fixed', top: 14, left: 14, zIndex: 100,
        background: t.bgPanel + 'f0',
        borderRadius: 10, padding: '5px 10px',
        border: `1px solid ${t.border}`,
        boxShadow: themeMode === 'light' ? '0 2px 8px rgba(0,0,0,0.15)' : '0 2px 10px rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <img src="/favicon.svg" alt="" style={{ width: 22, height: 22, flexShrink: 0 }} />
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: t.text, lineHeight: 1.25 }}>RouteBuilder</div>
          <div style={{ fontSize: 9, color: t.textFaint, letterSpacing: '0.04em', marginTop: 1 }}>Telstra International</div>
        </div>
      </div>

      {/* ── Top-right drawer toggle + panel ────────────────────────────── */}
      <div style={{ position: 'fixed', top: 14, right: 14, zIndex: 200 }}>

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

        {/* Mode tabs */}
        <div style={{ flexShrink: 0, display: 'flex', borderBottom: `1px solid ${t.border}` }}>
          <button style={tabBtn(mode === 'routebuilder')} onClick={() => tapTab('routebuilder')}>PoP Routes</button>
          <button style={tabBtn(mode === 'citypair')}     onClick={() => tapTab('citypair')}>City Pairs</button>
          <button style={tabBtn(mode === 'systemviewer')} onClick={() => tapTab('systemviewer')}>Cable System</button>
          <button style={tabBtn(mode === 'nodefinder')}   onClick={() => tapTab('nodefinder')}>Node Search</button>
        </div>

        {/* Scrollable content — clipped to sheet height automatically */}
        <div style={{ flex: 1, overflowY: 'auto', overscrollBehavior: 'contain' } as React.CSSProperties}>

          {/* ── Routes mode ───────────────────────────────────────────── */}
          {mode === 'routebuilder' && (
            <div style={{ padding: '14px 16px 32px' }}>

              {/* Mini status / action bar */}
              {(hasResults || hasPins || loading) && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  marginBottom: 14, paddingBottom: 12, borderBottom: `1px solid ${t.border}`,
                }}>
                  {loading   && <span style={{ fontSize: 11, color: t.blue }}>Searching…</span>}
                  {hasResults && !loading && <span style={{ fontSize: 11, color: t.textFaintest }}>{response!.primary_routes.length + response!.diverse_routes.length} routes found</span>}
                  {hasPins    && <span style={{ fontSize: 11, color: t.textFaintest }}>· {pinnedRoutes.length} pinned</span>}
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                    {hasPins    && <button onClick={() => generateStraightLineDiagram(pinnedRoutes, nodes)} style={smallBtn()}>⬡ SLD</button>}
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
                  />
                </Suspense>
              )}

              <SearchForm
                nodes={nodes} segments={segments} systems={systems}
                onSearch={onSearch} loading={loading}
                prefilledOrigin={prefilledOrigin} prefilledDest={prefilledDest}
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
                    selectedRouteIds={selectedRouteIds}
                    onSelectRoute={onToggleRoute}
                    nodes={nodes}
                    capacity={capacity}
                    outages={outages}
                    pinnedRoutes={pinnedRoutes}
                    onPin={onPin}
                    onUnpin={onUnpin}
                    diversityRequested={lastSearchDiversity !== 'none'}
                    onNetOwnership={config.on_net_ownership}
                    externalSortKey={nlpSortKey}
                    externalPushOutagesDown={nlpPushOutages}
                  />
                </div>
              )}
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
    </div>
  )
}
