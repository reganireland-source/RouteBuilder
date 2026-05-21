import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { Route, CableNode, SegmentCapacity, PinnedRoute } from '../types'
import { useTheme } from '../theme'

function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(() => window.innerWidth < 768)
  useEffect(() => {
    const handler = () => setMobile(window.innerWidth < 768)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])
  return mobile
}

type NetClass = 'on_net' | 'off_net' | 'mixed'

function classifyRoute(route: Route, onNetOwnership: Set<string>): { type: NetClass; onNetPct: number } {
  const wetSegs = route.segments.filter(s => s.type === 'wet')
  if (wetSegs.length === 0) return { type: 'on_net', onNetPct: 100 }
  const totalKm  = wetSegs.reduce((sum, s) => sum + s.length_km, 0)
  const onNetKm  = wetSegs.filter(s => onNetOwnership.has(s.ownership)).reduce((sum, s) => sum + s.length_km, 0)
  const pct = totalKm > 0 ? Math.round((onNetKm / totalKm) * 100) : 0
  if (pct === 100) return { type: 'on_net',  onNetPct: 100 }
  if (pct === 0)   return { type: 'off_net', onNetPct: 0 }
  return { type: 'mixed', onNetPct: pct }
}

interface Props {
  primaryRoutes: Route[]
  diverseRoutes: Route[]
  selectedRouteIds: string[]
  onSelectRoute: (id: string) => void
  nodes: CableNode[]
  capacity: SegmentCapacity[]
  pinnedRoutes: PinnedRoute[]
  onPin: (route: Route) => void
  onUnpin: (pinId: string) => void
  diversityRequested?: boolean
  onNetOwnership: string[]
}

type SortKey = 'hops' | 'latency' | 'availability' | 'cost' | 'capacity' | 'ownership'

const NET_ORDER = { on_net: 0, mixed: 1, off_net: 2 }

const SORT_OPTIONS: { key: SortKey; icon: string; label: string; dir: 'asc' | 'desc' }[] = [
  { key: 'hops',         icon: '⬡',  label: 'Hops',      dir: 'asc'  },
  { key: 'latency',      icon: '⚡', label: 'Latency',   dir: 'asc'  },
  { key: 'availability', icon: '🛡', label: 'Avail',     dir: 'desc' },
  { key: 'cost',         icon: '◆',  label: 'Cost',      dir: 'asc'  },
  { key: 'capacity',     icon: '◈',  label: 'Capacity',  dir: 'desc' },
  { key: 'ownership',    icon: '◉',  label: 'Ownership', dir: 'asc'  },
]

function routeKey(r: Route) { return r.nodes.join('|') }

function estimatedCapacity(route: Route, capacityById: Record<string, SegmentCapacity>): { cap: number; systemId: string | null } {
  const wetSegs = route.segments.filter(s => s.type === 'wet')
  if (wetSegs.length === 0) return { cap: 0, systemId: null }
  let min = Infinity, bottleneck: string | null = null
  for (const s of wetSegs) {
    const avail = capacityById[s.segment_id]?.available_capacity_t ?? Infinity
    if (avail < min) { min = avail; bottleneck = s.system_id }
  }
  return { cap: min === Infinity ? 0 : min, systemId: bottleneck }
}

function sortRoutes(routes: Route[], key: SortKey, capacityById: Record<string, SegmentCapacity>, onNetSet: Set<string>): Route[] {
  return [...routes].sort((a, b) => {
    switch (key) {
      case 'hops':         return (a.nodes.length - 1) - (b.nodes.length - 1)
      case 'latency':      return a.total_latency - b.total_latency
      case 'availability': return b.end_to_end_reliability - a.end_to_end_reliability
      case 'cost':         return a.total_cost - b.total_cost
      case 'capacity':     return estimatedCapacity(b, capacityById).cap - estimatedCapacity(a, capacityById).cap
      case 'ownership': {
        const ac = classifyRoute(a, onNetSet), bc = classifyRoute(b, onNetSet)
        const order = NET_ORDER[ac.type] - NET_ORDER[bc.type]
        return order !== 0 ? order : bc.onNetPct - ac.onNetPct  // within mixed: higher % on-net first
      }
    }
  })
}

export function RouteList({ primaryRoutes, diverseRoutes, selectedRouteIds, onSelectRoute, nodes, capacity, pinnedRoutes, onPin, onUnpin, diversityRequested, onNetOwnership }: Props) {
  const t = useTheme()
  const onNetSet = new Set(onNetOwnership)
  const [sortKey, setSortKey] = useState<SortKey>('hops')
  const nodesById = Object.fromEntries(nodes.map(n => [n.id, n]))
  const capacityById = Object.fromEntries(capacity.map(c => [c.segment_id, c]))
  const pinnedKeys = new Set(pinnedRoutes.map(p => routeKey(p.route)))
  const canPin = pinnedRoutes.length < 5

  const hasResults = primaryRoutes.length > 0 || diverseRoutes.length > 0
  const hasPins = pinnedRoutes.length > 0

  if (!hasResults && !hasPins) {
    return null
  }

  const sorted = {
    primary: sortRoutes(primaryRoutes, sortKey, capacityById, onNetSet),
    diverse:  sortRoutes(diverseRoutes,  sortKey, capacityById, onNetSet),
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

      {/* Pinned routes section */}
      {hasPins && (
        <div style={{ marginBottom: hasResults ? 8 : 0 }}>
          <div style={sectionLabelStyle(t)}>
            📌 Pinned Routes
          </div>
          {pinnedRoutes.map(p => (
            <PinnedRouteCard
              key={p.pinId}
              pinned={p}
              onUnpin={() => onUnpin(p.pinId)}
              nodesById={nodesById}
              capacityById={capacityById}
              onNetSet={onNetSet}
            />
          ))}
        </div>
      )}

      {/* Sort bar — only shown when there are search results */}
      {hasResults && (
        <>
          <div style={{ display: 'flex', gap: 5, marginBottom: 4, overflowX: 'auto', paddingBottom: 2 }}>
            {SORT_OPTIONS.map(opt => {
              const active = sortKey === opt.key
              return (
                <button
                  key={opt.key}
                  onClick={() => setSortKey(opt.key)}
                  title={`Sort by ${opt.label} (${opt.dir === 'asc' ? 'lowest first' : 'highest first'})`}
                  style={{
                    flex: '1 0 52px', display: 'flex', flexDirection: 'column', alignItems: 'center',
                    gap: 3, padding: '6px 4px', borderRadius: 6,
                    border: `1px solid ${active ? t.blue : t.border}`,
                    background: active ? t.bgActiveSort : t.bgCard,
                    color: active ? t.blue : t.textFaint,
                    cursor: 'pointer', fontSize: 10, fontWeight: active ? 700 : 400,
                    letterSpacing: '0.04em', textTransform: 'uppercase', transition: 'all 0.15s',
                  }}
                >
                  <span style={{ fontSize: 15, lineHeight: 1 }}>{opt.icon}</span>
                  <span>{opt.label}</span>
                  <span style={{ fontSize: 9, opacity: 0.7 }}>{opt.dir === 'asc' ? '↑ least' : '↓ most'}</span>
                </button>
              )
            })}
          </div>

          {sorted.primary.length > 0 && (
            <div>
              <div style={sectionLabelStyle(t)}>Primary Routes</div>
              {sorted.primary.map(r => (
                <RouteCard
                  key={r.id} route={r}
                  selected={selectedRouteIds.includes(r.id)}
                  onSelect={onSelectRoute}
                  nodesById={nodesById}
                  capacityById={capacityById}
                  color={t.blue}
                  isPinned={pinnedKeys.has(routeKey(r))}
                  canPin={canPin}
                  onPin={onPin}
                  onNetSet={onNetSet}
                />
              ))}
            </div>
          )}
          {sorted.diverse.length > 0 && (
            <div>
              <div style={sectionLabelStyle(t)}>Diverse Routes</div>
              {sorted.diverse.map(r => (
                <RouteCard
                  key={r.id} route={r}
                  selected={selectedRouteIds.includes(r.id)}
                  onSelect={onSelectRoute}
                  nodesById={nodesById}
                  capacityById={capacityById}
                  color={t.green}
                  isPinned={pinnedKeys.has(routeKey(r))}
                  canPin={canPin}
                  onPin={onPin}
                  onNetSet={onNetSet}
                />
              ))}
            </div>
          )}
          {sorted.diverse.length === 0 && diversityRequested && (
            <div style={{
              marginTop: 6, padding: '10px 14px', borderRadius: 6,
              border: `1px solid ${t.orange}`,
              background: t.bgCard,
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <span style={{ fontSize: 16, lineHeight: 1 }}>⚠</span>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: t.orange, marginBottom: 2 }}>
                  Diversity Requirement not able to be Met
                </div>
                <div style={{ fontSize: 11, color: t.textMuted }}>
                  No segment-disjoint diverse path exists between these endpoints.
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function PinnedRouteCard({ pinned, onUnpin, nodesById, capacityById, onNetSet }: {
  pinned: PinnedRoute
  onUnpin: () => void
  nodesById: Record<string, { name: string; type?: string }>
  capacityById: Record<string, SegmentCapacity>
  onNetSet: Set<string>
}) {
  const t = useTheme()
  const isMobile = useIsMobile()
  const { route, color, searchLabel } = pinned
  const [hovered, setHovered] = useState(false)
  const [tooltipPos, setTooltipPos] = useState({ top: 0, left: 0 })
  const [segmentsOpen, setSegmentsOpen] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isMobile && hovered && cardRef.current) {
      const rect = cardRef.current.getBoundingClientRect()
      setTooltipPos({ top: rect.top, left: rect.right + 8 })
    }
  }, [hovered, isMobile])

  const wetSystems = [...new Set(route.segments.filter(s => s.type === 'wet').map(s => s.system_id))]
  const reliabilityPct = (route.end_to_end_reliability * 100).toFixed(3)
  const { cap: estCap, systemId: bottleneckId } = estimatedCapacity(route, capacityById)
  const estCapColor = estCap < 0.5 ? t.red : estCap < 1.0 ? t.orange : t.green

  return (
    <div
      ref={cardRef}
      onMouseEnter={() => !isMobile && setHovered(true)}
      onMouseLeave={() => !isMobile && setHovered(false)}
      style={{
        padding: '10px 12px', borderRadius: 6, marginBottom: 4,
        border: `1px solid ${color}`,
        background: t.bgCard,
        position: 'relative',
      }}
    >
      {/* Pin colour strip */}
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, borderRadius: '6px 0 0 6px', background: color }} />

      <div style={{ paddingLeft: 6 }}>
        {/* Search context label */}
        <div style={{ fontSize: 10, color: t.textFaint, marginBottom: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>📌 {searchLabel}</span>
          <button
            onClick={onUnpin}
            title="Unpin route"
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: t.textFaint, fontSize: 14, lineHeight: 1, padding: '0 2px',
            }}
          >×</button>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', flex: 1 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color }}>{route.id}</span>
            <span style={{ fontSize: 11, fontWeight: 400, color: t.textMuted }}>{wetSystems.join(' · ')}</span>
            <NetBadge route={route} onNetSet={onNetSet} />
          </div>
          <span style={{ fontSize: 11, color: t.textFaint, flexShrink: 0 }}>{route.nodes.length - 1} hops</span>
        </div>

        <div style={{ fontSize: 11, color: t.text, marginBottom: 6 }}>
          {route.nodes.filter(id => nodesById[id]?.type !== 'branching_unit').map(id => nodesById[id]?.name ?? id).join(' → ')}
        </div>

        <div style={{ display: 'flex', gap: 12, fontSize: 11, color: t.textMuted, marginBottom: 5 }}>
          <span>Cost: <strong style={{ color: t.text }}>{route.total_cost}</strong></span>
          <span>{route.total_length_km.toLocaleString()} km</span>
          <span>Latency: <strong style={{ color: t.text }}>{route.total_latency} ms</strong></span>
          <span>Avail: <strong style={{ color: t.text }}>{reliabilityPct}%</strong></span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{
            flex: 1, display: 'flex', alignItems: 'center', gap: 6,
            padding: '4px 8px', borderRadius: 4, background: t.bgDeep,
            border: `1px solid ${t.border}`, fontSize: 11,
          }}>
            <span style={{ color: t.textFaint }}>◈ Est. Capacity</span>
            <strong style={{ color: estCapColor }}>{estCap.toFixed(1)}T</strong>
            <span style={{ color: t.textFaintest, fontSize: 10 }}>bottleneck:</span>
            <span style={{ color: t.textFaint, fontSize: 10 }}>{bottleneckId ?? '—'}</span>
          </div>
          {isMobile && (
            <button
              onClick={() => setSegmentsOpen(o => !o)}
              title="Toggle segment breakdown"
              style={{
                flexShrink: 0, display: 'flex', alignItems: 'center', gap: 3,
                padding: '4px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600,
                border: `1px solid ${segmentsOpen ? color : t.border}`,
                background: segmentsOpen ? (color + '22') : t.bgDeep,
                color: segmentsOpen ? color : t.textFaint,
                cursor: 'pointer', letterSpacing: '0.04em',
              }}
            >
              ≡ {segmentsOpen ? '▴' : '▾'}
            </button>
          )}
        </div>

        {isMobile && segmentsOpen && (
          <div style={{ marginTop: 8 }}>
            <SegmentBreakdownRows route={route} capacityById={capacityById} onNetSet={onNetSet} />
          </div>
        )}
      </div>

      {!isMobile && hovered && createPortal(
        <SegmentTooltip route={route} capacityById={capacityById} pos={tooltipPos} onNetSet={onNetSet} />,
        document.body
      )}
    </div>
  )
}

function RouteCard({ route, selected, onSelect, nodesById, capacityById, color, isPinned, canPin, onPin, onNetSet }: {
  route: Route
  selected: boolean
  onSelect: (id: string) => void
  nodesById: Record<string, { name: string; type?: string }>
  capacityById: Record<string, SegmentCapacity>
  color: string
  isPinned: boolean
  canPin: boolean
  onPin: (route: Route) => void
  onNetSet: Set<string>
}) {
  const t = useTheme()
  const isMobile = useIsMobile()
  const [hovered, setHovered] = useState(false)
  const [tooltipPos, setTooltipPos] = useState({ top: 0, left: 0 })
  const [segmentsOpen, setSegmentsOpen] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isMobile && hovered && cardRef.current) {
      const rect = cardRef.current.getBoundingClientRect()
      setTooltipPos({ top: rect.top, left: rect.right + 8 })
    }
  }, [hovered, isMobile])

  const wetSystems = [...new Set(route.segments.filter(s => s.type === 'wet').map(s => s.system_id))]
  const reliabilityPct = (route.end_to_end_reliability * 100).toFixed(3)
  const { cap: estCap, systemId: bottleneckId } = estimatedCapacity(route, capacityById)
  const estCapColor = estCap < 0.5 ? t.red : estCap < 1.0 ? t.orange : t.green
  const pinDisabled = !isPinned && !canPin

  return (
    <div
      ref={cardRef}
      onClick={() => onSelect(route.id)}
      onMouseEnter={() => !isMobile && setHovered(true)}
      onMouseLeave={() => !isMobile && setHovered(false)}
      style={{
        padding: '10px 12px', borderRadius: 6, marginBottom: 4, cursor: 'pointer',
        border: `1px solid ${selected ? color : t.border}`,
        background: selected ? t.bgCardSelected : t.bgCard,
        transition: 'border-color 0.15s',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', flex: 1 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color }}>{route.id}</span>
          <span style={{ fontSize: 11, fontWeight: 400, color: t.textMuted }}>{wetSystems.join(' · ')}</span>
          <NetBadge route={route} onNetSet={onNetSet} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <span style={{ fontSize: 11, color: t.textFaint }}>{route.nodes.length - 1} hops</span>
          <button
            onClick={e => { e.stopPropagation(); onPin(route) }}
            title={isPinned ? 'Unpin route' : pinDisabled ? 'Max 5 routes pinned' : 'Pin route'}
            style={{
              background: 'none', border: 'none', cursor: pinDisabled ? 'not-allowed' : 'pointer',
              fontSize: 13, lineHeight: 1, padding: '1px 3px', borderRadius: 3,
              opacity: pinDisabled ? 0.3 : 1,
              color: isPinned ? '#f9e2af' : t.textFaint,
              transition: 'color 0.15s',
            }}
          >
            {isPinned ? '📌' : '📍'}
          </button>
        </div>
      </div>

      <div style={{ fontSize: 11, color: t.text, marginBottom: 6 }}>
        {route.nodes.filter(id => nodesById[id]?.type !== 'branching_unit').map(id => nodesById[id]?.name ?? id).join(' → ')}
      </div>

      <div style={{ display: 'flex', gap: 12, fontSize: 11, color: t.textMuted, marginBottom: 5 }}>
        <span>Cost: <strong style={{ color: t.text }}>{route.total_cost}</strong></span>
        <span>{route.total_length_km.toLocaleString()} km</span>
        <span>Latency: <strong style={{ color: t.text }}>{route.total_latency} ms</strong></span>
        <span>Avail: <strong style={{ color: t.text }}>{reliabilityPct}%</strong></span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{
          flex: 1, display: 'flex', alignItems: 'center', gap: 6,
          padding: '4px 8px', borderRadius: 4, background: t.bgDeep,
          border: `1px solid ${t.border}`, fontSize: 11,
        }}>
          <span style={{ color: t.textFaint }}>◈ Est. Capacity</span>
          <strong style={{ color: estCapColor }}>{estCap.toFixed(1)}T</strong>
          <span style={{ color: t.textFaintest, fontSize: 10 }}>bottleneck:</span>
          <span style={{ color: t.textFaint, fontSize: 10 }}>{bottleneckId ?? '—'}</span>
        </div>
        {isMobile && (
          <button
            onClick={e => { e.stopPropagation(); setSegmentsOpen(o => !o) }}
            title="Toggle segment breakdown"
            style={{
              flexShrink: 0, display: 'flex', alignItems: 'center', gap: 3,
              padding: '4px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600,
              border: `1px solid ${segmentsOpen ? color : t.border}`,
              background: segmentsOpen ? (color + '22') : t.bgDeep,
              color: segmentsOpen ? color : t.textFaint,
              cursor: 'pointer', letterSpacing: '0.04em',
            }}
          >
            ≡ {segmentsOpen ? '▴' : '▾'}
          </button>
        )}
      </div>

      {isMobile && segmentsOpen && (
        <div style={{ marginTop: 8 }} onClick={e => e.stopPropagation()}>
          <SegmentBreakdownRows route={route} capacityById={capacityById} onNetSet={onNetSet} />
        </div>
      )}

      {!isMobile && hovered && createPortal(
        <SegmentTooltip route={route} capacityById={capacityById} pos={tooltipPos} onNetSet={onNetSet} />,
        document.body
      )}
    </div>
  )
}

function NetBadge({ route, onNetSet }: { route: Route; onNetSet: Set<string> }) {
  const t = useTheme()
  const { type, onNetPct } = classifyRoute(route, onNetSet)
  const badgeColor = type === 'on_net' ? t.green : type === 'off_net' ? t.red : t.orange
  const label = type === 'on_net' ? 'ON-NET' : type === 'off_net' ? 'OFF-NET' : `MIXED ${onNetPct}%`
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 3,
      letterSpacing: '0.04em', whiteSpace: 'nowrap',
      background: badgeColor + '22',
      color: badgeColor,
      border: `1px solid ${badgeColor + '55'}`,
    }}>
      {label}
    </span>
  )
}

function SegmentBreakdownRows({ route, capacityById, onNetSet }: {
  route: Route
  capacityById: Record<string, SegmentCapacity>
  onNetSet: Set<string>
}) {
  const t = useTheme()
  return (
    <div style={{ borderTop: `1px solid ${t.border}`, paddingTop: 8 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: t.textFaint, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
        Segment Breakdown
      </div>
      {route.segments.map(seg => {
        const cap = capacityById[seg.segment_id]
        const capPct = cap ? Math.round((cap.available_capacity_t / cap.total_capacity_t) * 100) : null
        const onNet = seg.type === 'wet' ? onNetSet.has(seg.ownership) : null
        const netColor = onNet === true ? t.green : onNet === false ? t.red : null
        const netLabel = onNet === true ? 'ON-NET' : onNet === false ? 'OFF-NET' : null
        return (
          <div key={seg.segment_id} style={{ marginBottom: 6, paddingBottom: 6, borderBottom: `1px solid ${t.border}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: seg.type === 'wet' ? t.blue : t.green }}>
                  {seg.system_id}
                </span>
                {netLabel && netColor && (
                  <span style={{
                    fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
                    letterSpacing: '0.04em',
                    background: netColor + '22', color: netColor, border: `1px solid ${netColor + '55'}`,
                  }}>
                    {netLabel}
                  </span>
                )}
              </div>
              <span style={{ fontSize: 10, color: t.textFaint, textTransform: 'uppercase' }}>{seg.type}</span>
            </div>
            <div style={{ fontSize: 10, color: t.textMuted, marginTop: 2, fontFamily: 'monospace' }}>
              {seg.start_node_id} → {seg.end_node_id}
            </div>
            <div style={{ display: 'flex', gap: 10, fontSize: 10, color: t.textMuted, marginTop: 2 }}>
              <span>{seg.length_km.toLocaleString()} km</span>
              <span>{seg.latency} ms</span>
              <span>Cost: {seg.cost_weight}</span>
              <span>Avail: {(seg.reliability * 100).toFixed(2)}%</span>
            </div>
            {cap && (
              <div style={{ fontSize: 10, color: t.textMuted, marginTop: 2 }}>
                Capacity: <span style={{ color: capPct! < 20 ? t.red : capPct! < 50 ? t.orange : t.green }}>
                  {cap.available_capacity_t}T
                </span> / {cap.total_capacity_t}T ({capPct}% free)
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function SegmentTooltip({ route, capacityById, pos, onNetSet }: {
  route: Route
  capacityById: Record<string, SegmentCapacity>
  pos: { top: number; left: number }
  onNetSet: Set<string>
}) {
  const t = useTheme()
  return (
    <div
      onClick={e => e.stopPropagation()}
      style={{
        position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999,
        width: 300, background: t.bgCard, border: `1px solid ${t.borderSubtle}`,
        borderRadius: 6, padding: '10px 12px', boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
        fontFamily: 'system-ui, sans-serif', pointerEvents: 'none',
      }}
    >
      <SegmentBreakdownRows route={route} capacityById={capacityById} onNetSet={onNetSet} />
    </div>
  )
}

function sectionLabelStyle(t: ReturnType<typeof useTheme>): React.CSSProperties {
  return {
    fontSize: 10, fontWeight: 700, color: t.textFaint,
    textTransform: 'uppercase', letterSpacing: '0.08em',
    marginBottom: 6, marginTop: 4,
  }
}
