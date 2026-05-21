import { useState, useRef, useEffect } from 'react'
import { Map } from './Map'
import { SearchForm } from './SearchForm'
import { RouteList } from './RouteList'
import { SystemViewer } from './SystemViewer'
import { NodeFinder } from './NodeFinder'
import { NodeInfoPanel } from './NodeInfoPanel'
import { RefDataModal } from './RefDataModal'
import { generateStraightLineDiagram } from '../utils/generateDiagram'
import { useTheme } from '../theme'
import type { ThemeMode } from '../theme'
import type {
  AppConfig, AppMode, CableNode, CableSegment, CableSystem, InterconnectRule,
  PinnedRoute, Route, RouteRequest, RouteResponse, SegmentCapacity,
  SelectedSystem, DiversityType,
} from '../types'

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
  onNodeClick:       (node: CableNode, x: number, y: number) => void
  onPinChange:       (pin: { lat: number; lng: number; label: string } | null, ids: string[]) => void
  onCloseNode:       () => void
  onOpenRefData:     () => void
  onCloseRefData:    () => void
  onDataChange:      () => Promise<void>
  switchMode:        (m: AppMode) => void
  clearSearch:       () => void
  clearAll:          () => void
  cycleTheme:        () => void
}

export function MobileLayout({
  nodes, segments, systems, capacity, rules,
  response, selectedRoutes, selectedRouteIds, pinnedRoutes, selectedSystems,
  mode, loading, error, selectedNode, searchPin, nearestNodeIds,
  prefilledOrigin, prefilledDest, lastSearchDiversity,
  refDataOpen, themeMode, config,
  onSearch, onToggleRoute, onPin, onUnpin, onToggleSystem,
  onSetOrigin, onSetDest, onNodeClick, onPinChange,
  onCloseNode, onOpenRefData, onCloseRefData, onDataChange,
  switchMode, clearSearch, clearAll, cycleTheme,
}: MobileLayoutProps) {
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
    flex: 1, padding: '12px 4px', border: 'none', cursor: 'pointer',
    background: 'transparent',
    color: active ? t.blue : t.textFaint,
    fontSize: 11, fontWeight: active ? 700 : 400,
    textTransform: 'uppercase', letterSpacing: '0.05em',
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

      {/* ── Top-right icon buttons ──────────────────────────────────────── */}
      <div style={{ position: 'fixed', top: 14, right: 14, zIndex: 100, display: 'flex', gap: 8 }}>
        <button onClick={onOpenRefData} title="Reference Data" style={floatBtn}>⚙</button>
        <button onClick={cycleTheme}    title="Cycle theme"    style={floatBtn}>
          {themeMode === 'dark' ? '🌅' : themeMode === 'dusk' ? '☀️' : '🌙'}
        </button>
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
          <button style={tabBtn(mode === 'routebuilder')} onClick={() => tapTab('routebuilder')}>⬡ Routes</button>
          <button style={tabBtn(mode === 'systemviewer')} onClick={() => tapTab('systemviewer')}>◉ Systems</button>
          <button style={tabBtn(mode === 'nodefinder')}   onClick={() => tapTab('nodefinder')}>◎ Nodes</button>
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

              <SearchForm
                nodes={nodes} segments={segments}
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
                    pinnedRoutes={pinnedRoutes}
                    onPin={onPin}
                    onUnpin={onUnpin}
                    diversityRequested={lastSearchDiversity !== 'none'}
                    onNetOwnership={config.on_net_ownership}
                  />
                </div>
              )}
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

      {/* ── Ref data modal ──────────────────────────────────────────────── */}
      {refDataOpen && (
        <RefDataModal
          nodes={nodes} segments={segments} systems={systems}
          capacity={capacity} rules={rules} config={config}
          onDataChange={onDataChange}
          onClose={onCloseRefData}
        />
      )}
    </div>
  )
}
