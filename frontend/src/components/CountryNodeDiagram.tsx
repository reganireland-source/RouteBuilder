import { useState, useMemo, useRef } from 'react'
import type { CableNode, CableSegment, CableSystem, CountryHighlight, SegmentCapacity } from '../types'
import { useTheme } from '../theme'

interface Props {
  nodes: CableNode[]
  segments: CableSegment[]
  systems: CableSystem[]
  capacity: SegmentCapacity[]
  countryHighlight: CountryHighlight
  onClose: () => void
}

const NODE_COLOR: Record<string, string> = {
  landing_station: '#06b6d4',
  primary_pop:     '#22c55e',
  secondary_pop:   '#f59e0b',
  extension_pop:   '#a855f7',
  branching_unit:  '#6b7280',
}
const NODE_RADIUS: Record<string, number> = {
  landing_station: 11,
  primary_pop:      9,
  secondary_pop:    7,
  extension_pop:    6,
  branching_unit:   4,
}
const TYPE_LABEL: Record<string, string> = {
  landing_station: 'CLS',
  primary_pop:     'Primary PoP',
  secondary_pop:   'Secondary PoP',
  extension_pop:   'Extension PoP',
  branching_unit:  'BU',
}

interface Tooltip { title: string; lines: string[]; screenX: number; screenY: number }

const SVG_W = 920
const SVG_H = 560
const PAD   = 95

export function CountryNodeDiagram({ nodes, segments, systems, capacity, countryHighlight, onClose }: Props) {
  const t = useTheme()
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [tooltip, setTooltip] = useState<Tooltip | null>(null)

  const nodesById = useMemo(() =>
    Object.fromEntries(nodes.map(n => [n.id, n])), [nodes])

  const systemsById = useMemo(() =>
    Object.fromEntries(systems.map(s => [s.id, s])), [systems])

  const capacityMap = useMemo(() =>
    Object.fromEntries(capacity.map(c => [c.segment_id, c])), [capacity])

  const countryNodes = useMemo(() =>
    nodes.filter(n => countryHighlight.nodeIds.has(n.id) && n.type !== 'branching_unit'),
    [nodes, countryHighlight])

  const clsIds = useMemo(() =>
    new Set(countryNodes.filter(n => n.type === 'landing_station').map(n => n.id)),
    [countryNodes])

  // Projection: lat/lng → SVG [x, y]
  const project = useMemo(() => {
    const [[minLat, minLng], [maxLat, maxLng]] = countryHighlight.boundsLL
    const latSpan = maxLat - minLat || 0.01
    const lngSpan = maxLng - minLng || 0.01
    const latPad  = latSpan * 0.18
    const lngPad  = lngSpan * 0.18
    const bMinLat = minLat - latPad, bMaxLat = maxLat + latPad
    const bMinLng = minLng - lngPad, bMaxLng = maxLng + lngPad
    const bLatSpan = bMaxLat - bMinLat
    const bLngSpan = bMaxLng - bMinLng
    const drawW = SVG_W - PAD * 2
    const drawH = SVG_H - PAD * 2
    const cosLat = Math.cos(((minLat + maxLat) / 2) * Math.PI / 180)
    const geoW = bLngSpan * cosLat
    const geoH = bLatSpan
    let scaleX: number, scaleY: number, offX: number, offY: number
    if (drawW / geoW < drawH / geoH) {
      scaleX = drawW / geoW; scaleY = scaleX
      offX = PAD; offY = PAD + (drawH - geoH * scaleY) / 2
    } else {
      scaleY = drawH / geoH; scaleX = scaleY
      offX = PAD + (drawW - geoW * scaleX) / 2; offY = PAD
    }
    return (lat: number, lng: number): [number, number] => [
      offX + (lng - bMinLng) * cosLat * scaleX,
      offY + (bMaxLat - lat) * scaleY,
    ]
  }, [countryHighlight])

  const nodePos = useMemo(() => {
    const m = new Map<string, [number, number]>()
    for (const n of countryNodes) m.set(n.id, project(n.lat, n.lng))
    return m
  }, [countryNodes, project])

  // Categorize segments
  const { internalSegs, crossCountrySegs, subseaStubs } = useMemo(() => {
    const internal: CableSegment[] = []
    const cross: CableSegment[] = []
    const stubs: CableSegment[] = []
    const seen = new Set<string>()

    for (const seg of segments) {
      const sIn = countryHighlight.nodeIds.has(seg.start_node_id)
      const eIn = countryHighlight.nodeIds.has(seg.end_node_id)

      if (seg.type === 'terrestrial') {
        if (sIn && eIn) internal.push(seg)
        else if (sIn || eIn) cross.push(seg)
      } else if (seg.type === 'wet') {
        const sIsCls = clsIds.has(seg.start_node_id)
        const eIsCls = clsIds.has(seg.end_node_id)
        if ((sIsCls && !eIn) || (eIsCls && !sIn)) {
          const clsId = sIsCls ? seg.start_node_id : seg.end_node_id
          const key = `${seg.system_id}|${clsId}`
          if (!seen.has(key)) { seen.add(key); stubs.push(seg) }
        }
      }
    }
    return { internalSegs: internal, crossCountrySegs: cross, subseaStubs: stubs }
  }, [segments, countryHighlight, clsIds])

  function stubArrow(seg: CableSegment): { x1: number; y1: number; x2: number; y2: number } | null {
    const clsId = clsIds.has(seg.start_node_id) ? seg.start_node_id : seg.end_node_id
    const foreignId = clsIds.has(seg.start_node_id) ? seg.end_node_id : seg.start_node_id
    const cls = nodePos.get(clsId)
    const foreign = nodesById[foreignId]
    if (!cls || !foreign) return null
    const [fx, fy] = project(foreign.lat, foreign.lng)
    const [cx, cy] = cls
    const dx = fx - cx, dy = fy - cy
    const len = Math.sqrt(dx * dx + dy * dy)
    if (len < 1) return null
    const nx = dx / len, ny = dy / len
    return { x1: cx + nx * (NODE_RADIUS['landing_station'] + 2), y1: cy + ny * (NODE_RADIUS['landing_station'] + 2), x2: cx + nx * 60, y2: cy + ny * 60 }
  }

  function svgToScreen(svgX: number, svgY: number): [number, number] {
    if (!svgRef.current || !containerRef.current) return [svgX, svgY]
    const svgRect = svgRef.current.getBoundingClientRect()
    const conRect = containerRef.current.getBoundingClientRect()
    const sx = svgRect.width / SVG_W
    const sy = svgRect.height / SVG_H
    return [svgX * sx + svgRect.left - conRect.left, svgY * sy + svgRect.top - conRect.top]
  }

  function showNodeTip(n: CableNode, e: React.MouseEvent) {
    const [sx, sy] = svgToScreen(0, 0)
    void sx; void sy
    setTooltip({
      title: n.name,
      lines: [
        TYPE_LABEL[n.type] ?? n.type,
        n.owner ? `Owner: ${n.owner}` : '',
        `ID: ${n.id}`,
      ].filter(Boolean),
      screenX: e.clientX,
      screenY: e.clientY,
    })
  }

  function showSegTip(seg: CableSegment, e: React.MouseEvent) {
    const cap = capacityMap[seg.id]
    setTooltip({
      title: seg.name || seg.id,
      lines: [
        `ID: ${seg.id}`,
        `Length: ${seg.length_km} km`,
        `Latency: ${(seg.latency * 1000).toFixed(1)} ms`,
        cap ? `Capacity: ${cap.available_capacity_t}/${cap.total_capacity_t} Tbps avail` : '',
      ].filter(Boolean),
      screenX: e.clientX,
      screenY: e.clientY,
    })
  }

  function showStubTip(seg: CableSegment, e: React.MouseEvent) {
    const sys = systemsById[seg.system_id]
    const foreignId = clsIds.has(seg.start_node_id) ? seg.end_node_id : seg.start_node_id
    const foreign = nodesById[foreignId]
    setTooltip({
      title: sys?.name ?? seg.system_id,
      lines: [
        `System: ${seg.system_id}`,
        foreign ? `→ ${foreign.name} (${foreign.country})` : '',
        `Length: ${seg.length_km} km`,
        `Latency: ${(seg.latency * 1000).toFixed(1)} ms`,
      ].filter(Boolean),
      screenX: e.clientX,
      screenY: e.clientY,
    })
  }

  // Legend items
  const legend = [
    { color: NODE_COLOR.landing_station, label: 'Cable Landing Station', shape: 'diamond' },
    { color: NODE_COLOR.primary_pop,     label: 'Primary PoP',           shape: 'circle' },
    { color: NODE_COLOR.secondary_pop,   label: 'Secondary PoP',         shape: 'circle' },
    { color: NODE_COLOR.extension_pop,   label: 'Extension PoP',         shape: 'circle' },
    { color: '#94a3b8',                  label: 'Terrestrial backhaul',   shape: 'line' },
    { color: '#fb923c',                  label: 'Cross-country link',     shape: 'dashed' },
    { color: '#22d3ee',                  label: 'Subsea cable stub',      shape: 'arrow' },
  ]

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9000,
      background: 'rgba(0,0,0,0.72)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div ref={containerRef} style={{
        position: 'relative',
        width: 'min(96vw, 980px)', maxHeight: '92vh',
        background: t.bgDeep,
        border: `1px solid ${t.border}`,
        borderRadius: 12,
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
        boxShadow: '0 24px 64px rgba(0,0,0,0.7)',
      }}>

        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 18px',
          borderBottom: `1px solid ${t.border}`,
          background: t.bgBase,
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 18 }}>🗺</span>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: t.text }}>
                {countryHighlight.countryName} Node Diagram
              </div>
              <div style={{ fontSize: 11, color: t.textFaint }}>
                {countryNodes.length} nodes · {internalSegs.length} backhauls · {subseaStubs.length} cable stubs
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: `1px solid ${t.border}`, borderRadius: 6,
              color: t.textFaint, cursor: 'pointer', padding: '4px 10px', fontSize: 13,
              fontFamily: 'inherit',
            }}
          >Close ✕</button>
        </div>

        {/* Diagram */}
        <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
          <svg
            ref={svgRef}
            viewBox={`0 0 ${SVG_W} ${SVG_H}`}
            style={{ width: '100%', height: '100%', display: 'block' }}
            onMouseLeave={() => setTooltip(null)}
          >
            {/* Background */}
            <rect x={0} y={0} width={SVG_W} height={SVG_H} fill={t.bgDeep} />

            {/* Subtle grid / atmosphere */}
            <rect x={PAD - 20} y={PAD - 20} width={SVG_W - (PAD - 20) * 2} height={SVG_H - (PAD - 20) * 2}
              fill="none" stroke={t.border} strokeWidth={0.5} rx={8} opacity={0.4} />

            {/* Arrow marker definitions */}
            <defs>
              <marker id="arrowStub" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                <path d="M0,0 L0,6 L8,3 z" fill="#22d3ee" />
              </marker>
              <marker id="arrowCross" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                <path d="M0,0 L0,6 L8,3 z" fill="#fb923c" />
              </marker>
            </defs>

            {/* Cross-country links */}
            {crossCountrySegs.map(seg => {
              const inNode = countryHighlight.nodeIds.has(seg.start_node_id) ? seg.start_node_id : seg.end_node_id
              const outId  = countryHighlight.nodeIds.has(seg.start_node_id) ? seg.end_node_id : seg.start_node_id
              const p1 = nodePos.get(inNode)
              const out = nodesById[outId]
              if (!p1 || !out) return null
              const [fx, fy] = project(out.lat, out.lng)
              const [cx, cy] = p1
              const dx = fx - cx, dy = fy - cy
              const len = Math.sqrt(dx * dx + dy * dy)
              if (len < 1) return null
              const nx = dx / len, ny = dy / len
              const r = NODE_RADIUS[nodesById[inNode]?.type ?? 'extension_pop'] ?? 7
              const x2 = cx + nx * 55, y2 = cy + ny * 55
              return (
                <g key={seg.id}>
                  <line
                    x1={cx + nx * (r + 2)} y1={cy + ny * (r + 2)}
                    x2={x2} y2={y2}
                    stroke="#fb923c" strokeWidth={1.5} strokeDasharray="5,3"
                    markerEnd="url(#arrowCross)"
                    style={{ cursor: 'pointer' }}
                    onMouseEnter={e => showSegTip(seg, e)}
                    onMouseMove={e => setTooltip(prev => prev ? { ...prev, screenX: e.clientX, screenY: e.clientY } : null)}
                    onMouseLeave={() => setTooltip(null)}
                  />
                </g>
              )
            })}

            {/* Subsea stubs */}
            {subseaStubs.map(seg => {
              const arr = stubArrow(seg)
              if (!arr) return null
              const sysColor = countryHighlight.systemColors.get(seg.system_id) ?? '#22d3ee'
              const sys = systemsById[seg.system_id]
              const midX = (arr.x1 + arr.x2) / 2, midY = (arr.y1 + arr.y2) / 2
              const dx = arr.x2 - arr.x1, dy = arr.y2 - arr.y1
              const len = Math.sqrt(dx * dx + dy * dy)
              // Label offset perpendicular to arrow
              const nx = -dy / len * 12, ny = dx / len * 12
              return (
                <g key={seg.id}>
                  <line
                    x1={arr.x1} y1={arr.y1} x2={arr.x2} y2={arr.y2}
                    stroke={sysColor} strokeWidth={2} strokeDasharray="4,3"
                    markerEnd="url(#arrowStub)"
                    style={{ cursor: 'pointer' }}
                    onMouseEnter={e => showStubTip(seg, e)}
                    onMouseMove={e => setTooltip(prev => prev ? { ...prev, screenX: e.clientX, screenY: e.clientY } : null)}
                    onMouseLeave={() => setTooltip(null)}
                  />
                  <text
                    x={midX + nx} y={midY + ny}
                    fontSize={7} fill={sysColor} opacity={0.85}
                    textAnchor="middle" dominantBaseline="middle"
                    style={{ pointerEvents: 'none', userSelect: 'none' }}
                  >
                    {sys?.name ?? seg.system_id}
                  </text>
                </g>
              )
            })}

            {/* Internal terrestrial segments */}
            {internalSegs.map(seg => {
              const p1 = nodePos.get(seg.start_node_id)
              const p2 = nodePos.get(seg.end_node_id)
              if (!p1 || !p2) return null
              const mx = (p1[0] + p2[0]) / 2, my = (p1[1] + p2[1]) / 2
              return (
                <g key={seg.id}>
                  <line
                    x1={p1[0]} y1={p1[1]} x2={p2[0]} y2={p2[1]}
                    stroke="#94a3b8" strokeWidth={1.8} opacity={0.55}
                    style={{ cursor: 'pointer' }}
                    onMouseEnter={e => showSegTip(seg, e)}
                    onMouseMove={e => setTooltip(prev => prev ? { ...prev, screenX: e.clientX, screenY: e.clientY } : null)}
                    onMouseLeave={() => setTooltip(null)}
                  />
                  <text
                    x={mx} y={my - 5}
                    fontSize={6.5} fill="#94a3b8" opacity={0.6}
                    textAnchor="middle"
                    style={{ pointerEvents: 'none', userSelect: 'none' }}
                  >
                    {seg.id.replace('TERRESTRIAL_', '')}
                  </text>
                </g>
              )
            })}

            {/* Nodes */}
            {countryNodes.map(n => {
              const pos = nodePos.get(n.id)
              if (!pos) return null
              const [x, y] = pos
              const color = NODE_COLOR[n.type] ?? '#94a3b8'
              const r = NODE_RADIUS[n.type] ?? 7
              const isLanding = n.type === 'landing_station'
              return (
                <g
                  key={n.id}
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={e => showNodeTip(n, e)}
                  onMouseMove={e => setTooltip(prev => prev ? { ...prev, screenX: e.clientX, screenY: e.clientY } : null)}
                  onMouseLeave={() => setTooltip(null)}
                >
                  {/* Glow */}
                  <circle cx={x} cy={y} r={r + 5} fill={color} opacity={0.12} />
                  {/* Shape */}
                  {isLanding ? (
                    <rect
                      x={x - r} y={y - r} width={r * 2} height={r * 2}
                      fill={color} stroke={t.bgDeep} strokeWidth={1.5}
                      transform={`rotate(45, ${x}, ${y})`}
                    />
                  ) : (
                    <circle cx={x} cy={y} r={r} fill={color} stroke={t.bgDeep} strokeWidth={1.5} />
                  )}
                  {/* Label */}
                  <text
                    x={x} y={y + r + 11}
                    fontSize={8} fill={t.text} opacity={0.85}
                    textAnchor="middle"
                    style={{ pointerEvents: 'none', userSelect: 'none' }}
                  >
                    {n.id}
                  </text>
                  <text
                    x={x} y={y + r + 20}
                    fontSize={6.5} fill={t.textFaint} opacity={0.7}
                    textAnchor="middle"
                    style={{ pointerEvents: 'none', userSelect: 'none' }}
                  >
                    {n.name.length > 22 ? n.name.slice(0, 20) + '…' : n.name}
                  </text>
                </g>
              )
            })}
          </svg>

          {/* Hover tooltip */}
          {tooltip && (
            <div style={{
              position: 'fixed',
              left: tooltip.screenX + 14,
              top: tooltip.screenY - 8,
              background: t.bgBase,
              border: `1px solid ${t.border}`,
              borderRadius: 7,
              padding: '7px 11px',
              pointerEvents: 'none',
              zIndex: 9100,
              maxWidth: 240,
              boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
            }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: t.text, marginBottom: 4 }}>
                {tooltip.title}
              </div>
              {tooltip.lines.map((line, i) => (
                <div key={i} style={{ fontSize: 11, color: t.textFaint, lineHeight: 1.5 }}>{line}</div>
              ))}
            </div>
          )}
        </div>

        {/* Legend */}
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: '6px 18px',
          padding: '8px 18px',
          borderTop: `1px solid ${t.border}`,
          background: t.bgBase,
          flexShrink: 0,
        }}>
          {legend.map(item => (
            <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {item.shape === 'circle' && (
                <svg width={14} height={14} style={{ flexShrink: 0 }}>
                  <circle cx={7} cy={7} r={5} fill={item.color} />
                </svg>
              )}
              {item.shape === 'diamond' && (
                <svg width={14} height={14} style={{ flexShrink: 0 }}>
                  <rect x={3} y={3} width={8} height={8} fill={item.color} transform="rotate(45, 7, 7)" />
                </svg>
              )}
              {item.shape === 'line' && (
                <svg width={20} height={10} style={{ flexShrink: 0 }}>
                  <line x1={0} y1={5} x2={20} y2={5} stroke={item.color} strokeWidth={2} opacity={0.7} />
                </svg>
              )}
              {item.shape === 'dashed' && (
                <svg width={20} height={10} style={{ flexShrink: 0 }}>
                  <line x1={0} y1={5} x2={20} y2={5} stroke={item.color} strokeWidth={2} strokeDasharray="4,3" />
                </svg>
              )}
              {item.shape === 'arrow' && (
                <svg width={22} height={10} style={{ flexShrink: 0 }}>
                  <defs>
                    <marker id="la" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                      <path d="M0,0 L0,6 L6,3 z" fill={item.color} />
                    </marker>
                  </defs>
                  <line x1={0} y1={5} x2={16} y2={5} stroke={item.color} strokeWidth={2} strokeDasharray="4,2" markerEnd="url(#la)" />
                </svg>
              )}
              <span style={{ fontSize: 10, color: t.textFaint }}>{item.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
