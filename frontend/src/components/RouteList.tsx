import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { Route, CableNode, SegmentCapacity } from '../types'

interface Props {
  primaryRoutes: Route[]
  diverseRoutes: Route[]
  selectedRouteIds: string[]
  onSelectRoute: (id: string) => void
  nodes: CableNode[]
  capacity: SegmentCapacity[]
}

type SortKey = 'hops' | 'latency' | 'availability' | 'cost' | 'capacity'

const SORT_OPTIONS: { key: SortKey; icon: string; label: string; dir: 'asc' | 'desc' }[] = [
  { key: 'hops',         icon: '⬡',  label: 'Hops',         dir: 'asc'  },
  { key: 'latency',      icon: '⚡', label: 'Latency',      dir: 'asc'  },
  { key: 'availability', icon: '🛡', label: 'Avail',        dir: 'desc' },
  { key: 'cost',         icon: '◆',  label: 'Cost',         dir: 'asc'  },
  { key: 'capacity',     icon: '◈',  label: 'Capacity',     dir: 'desc' },
]

function estimatedCapacity(route: Route, capacityById: Record<string, SegmentCapacity>): number {
  const wetCaps = route.segments
    .filter(s => s.type === 'wet')
    .map(s => capacityById[s.segment_id]?.available_capacity_t ?? Infinity)
  return wetCaps.length > 0 ? Math.min(...wetCaps) : 0
}

function sortRoutes(routes: Route[], key: SortKey, capacityById: Record<string, SegmentCapacity>): Route[] {
  return [...routes].sort((a, b) => {
    switch (key) {
      case 'hops':         return (a.nodes.length - 1) - (b.nodes.length - 1)
      case 'latency':      return a.total_latency - b.total_latency
      case 'availability': return b.end_to_end_reliability - a.end_to_end_reliability
      case 'cost':         return a.total_cost - b.total_cost
      case 'capacity':     return estimatedCapacity(b, capacityById) - estimatedCapacity(a, capacityById)
    }
  })
}

export function RouteList({ primaryRoutes, diverseRoutes, selectedRouteIds, onSelectRoute, nodes, capacity }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('cost')
  const nodesById = Object.fromEntries(nodes.map(n => [n.id, n]))
  const capacityById = Object.fromEntries(capacity.map(c => [c.segment_id, c]))

  if (primaryRoutes.length === 0 && diverseRoutes.length === 0) {
    return <p style={{ color: '#6c7086', fontSize: 13, padding: '8px 0' }}>No routes found.</p>
  }

  const sorted = {
    primary: sortRoutes(primaryRoutes, sortKey, capacityById),
    diverse:  sortRoutes(diverseRoutes,  sortKey, capacityById),
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Sort bar */}
      <div style={{ display: 'flex', gap: 5, marginBottom: 4 }}>
        {SORT_OPTIONS.map(opt => {
          const active = sortKey === opt.key
          return (
            <button
              key={opt.key}
              onClick={() => setSortKey(opt.key)}
              title={`Sort by ${opt.label} (${opt.dir === 'asc' ? 'lowest first' : 'highest first'})`}
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 3,
                padding: '6px 4px',
                borderRadius: 6,
                border: `1px solid ${active ? '#89b4fa' : '#313244'}`,
                background: active ? '#1e3a5f' : '#181825',
                color: active ? '#89b4fa' : '#6c7086',
                cursor: 'pointer',
                fontSize: 10,
                fontWeight: active ? 700 : 400,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                transition: 'all 0.15s',
              }}
            >
              <span style={{ fontSize: 15, lineHeight: 1 }}>{opt.icon}</span>
              <span>{opt.label}</span>
              <span style={{ fontSize: 9, opacity: 0.7 }}>
                {opt.dir === 'asc' ? '↑ least' : '↓ most'}
              </span>
            </button>
          )
        })}
      </div>

      {sorted.primary.length > 0 && (
        <div>
          <div style={sectionLabelStyle}>Primary Routes</div>
          {sorted.primary.map(r => (
            <RouteCard key={r.id} route={r} selected={selectedRouteIds.includes(r.id)} onSelect={onSelectRoute} nodesById={nodesById} capacityById={capacityById} color="#89b4fa" />
          ))}
        </div>
      )}
      {sorted.diverse.length > 0 && (
        <div>
          <div style={sectionLabelStyle}>Diverse Routes</div>
          {sorted.diverse.map(r => (
            <RouteCard key={r.id} route={r} selected={selectedRouteIds.includes(r.id)} onSelect={onSelectRoute} nodesById={nodesById} capacityById={capacityById} color="#a6e3a1" />
          ))}
        </div>
      )}
    </div>
  )
}

function RouteCard({
  route, selected, onSelect, nodesById, capacityById, color,
}: {
  route: Route
  selected: boolean
  onSelect: (id: string) => void
  nodesById: Record<string, { name: string }>
  capacityById: Record<string, SegmentCapacity>
  color: string
}) {
  const [hovered, setHovered] = useState(false)
  const [tooltipPos, setTooltipPos] = useState({ top: 0, left: 0 })
  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (hovered && cardRef.current) {
      const rect = cardRef.current.getBoundingClientRect()
      setTooltipPos({ top: rect.top, left: rect.right + 8 })
    }
  }, [hovered])

  const wetSystems = [...new Set(route.segments.filter(s => s.type === 'wet').map(s => s.system_id))]
  const reliabilityPct = (route.end_to_end_reliability * 100).toFixed(3)
  const estCap = estimatedCapacity(route, capacityById)
  const estCapColor = estCap < 0.5 ? '#f38ba8' : estCap < 1.0 ? '#fab387' : '#a6e3a1'

  return (
    <div
      ref={cardRef}
      onClick={() => onSelect(route.id)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: '10px 12px', borderRadius: 6, marginBottom: 4, cursor: 'pointer',
        border: `1px solid ${selected ? color : '#313244'}`,
        background: selected ? '#1e1e2e' : '#181825',
        transition: 'border-color 0.15s',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color }}>
          {route.id}
          <span style={{ fontWeight: 400, color: '#a6adc8', marginLeft: 6 }}>
            {wetSystems.join(' · ')}
          </span>
        </span>
        <span style={{ fontSize: 11, color: '#6c7086' }}>
          {route.nodes.length - 1} hops
        </span>
      </div>

      <div style={{ fontSize: 11, color: '#cdd6f4', marginBottom: 6 }}>
        {route.nodes.map(id => nodesById[id]?.name ?? id).join(' → ')}
      </div>

      <div style={{ display: 'flex', gap: 12, fontSize: 11, color: '#a6adc8', marginBottom: 5 }}>
        <span>Cost: <strong style={{ color: '#cdd6f4' }}>{route.total_cost}</strong></span>
        <span>{route.total_length_km.toLocaleString()} km</span>
        <span>Latency: <strong style={{ color: '#cdd6f4' }}>{route.total_latency} ms</strong></span>
        <span>Avail: <strong style={{ color: '#cdd6f4' }}>{reliabilityPct}%</strong></span>
      </div>

      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '4px 8px', borderRadius: 4, background: '#11111b',
        border: '1px solid #313244', fontSize: 11,
      }}>
        <span style={{ color: '#6c7086' }}>◈ Est. Capacity</span>
        <strong style={{ color: estCapColor }}>{estCap.toFixed(1)}T</strong>
        <span style={{ color: '#45475a', fontSize: 10 }}>available (bottleneck wet segment)</span>
      </div>

      {hovered && createPortal(
        <div
          onClick={e => e.stopPropagation()}
          style={{
            position: 'fixed', top: tooltipPos.top, left: tooltipPos.left, zIndex: 9999,
            width: 300, background: '#1e1e2e', border: '1px solid #45475a',
            borderRadius: 6, padding: '10px 12px', boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
            fontFamily: 'system-ui, sans-serif', pointerEvents: 'none',
          }}
        >
          <div style={{ fontSize: 10, fontWeight: 700, color: '#6c7086', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
            Segment Breakdown
          </div>
          {route.segments.map(seg => {
            const cap = capacityById[seg.segment_id]
            const capPct = cap ? Math.round((cap.available_capacity_t / cap.total_capacity_t) * 100) : null
            return (
              <div key={seg.segment_id} style={{ marginBottom: 6, paddingBottom: 6, borderBottom: '1px solid #313244' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: seg.type === 'wet' ? '#89b4fa' : '#a6e3a1' }}>
                    {seg.system_id}
                  </span>
                  <span style={{ fontSize: 10, color: '#6c7086', textTransform: 'uppercase' }}>
                    {seg.type}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 10, fontSize: 10, color: '#a6adc8', marginTop: 2 }}>
                  <span>{seg.length_km.toLocaleString()} km</span>
                  <span>{seg.latency} ms</span>
                  <span>Cost: {seg.cost_weight}</span>
                  <span>Avail: {(seg.reliability * 100).toFixed(2)}%</span>
                </div>
                {cap && (
                  <div style={{ fontSize: 10, color: '#a6adc8', marginTop: 2 }}>
                    Capacity: <span style={{ color: capPct! < 20 ? '#f38ba8' : capPct! < 50 ? '#fab387' : '#a6e3a1' }}>
                      {cap.available_capacity_t}T
                    </span> / {cap.total_capacity_t}T ({capPct}% free)
                  </div>
                )}
              </div>
            )
          })}
        </div>,
        document.body
      )}
    </div>
  )
}

const sectionLabelStyle: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, color: '#6c7086',
  textTransform: 'uppercase', letterSpacing: '0.08em',
  marginBottom: 6, marginTop: 4,
}
