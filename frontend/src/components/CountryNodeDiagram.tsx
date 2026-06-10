import { useState, useMemo } from 'react'
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
const NODE_R: Record<string, number> = {
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

// Grid cell size — generous spacing so edges have room to fan
const CW  = 190
const RH  = 140
const PAD = 110   // outer padding (stubs need space to exit)

/** BFS grid assignment — pure topology, no lat/lng. */
function buildGrid(nodes: CableNode[], segs: CableSegment[]): Map<string, [number, number]> {
  if (!nodes.length) return new Map()
  const nodeSet = new Set(nodes.map(n => n.id))
  const degree  = new Map(nodes.map(n => [n.id, 0]))
  const adj     = new Map(nodes.map(n => [n.id, [] as string[]]))
  for (const s of segs) {
    if (!nodeSet.has(s.start_node_id) || !nodeSet.has(s.end_node_id)) continue
    adj.get(s.start_node_id)!.push(s.end_node_id)
    adj.get(s.end_node_id)!.push(s.start_node_id)
    degree.set(s.start_node_id, degree.get(s.start_node_id)! + 1)
    degree.set(s.end_node_id,   degree.get(s.end_node_id)!   + 1)
  }
  for (const [id, nb] of adj)
    adj.set(id, nb.sort((a, b) => (degree.get(b) ?? 0) - (degree.get(a) ?? 0)))

  const startId = [...degree.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? nodes[0].id
  const order: string[] = []
  const visited = new Set([startId])
  const q = [startId]
  while (q.length) {
    const curr = q.shift()!
    order.push(curr)
    for (const nb of adj.get(curr) ?? [])
      if (!visited.has(nb)) { visited.add(nb); q.push(nb) }
  }
  for (const n of nodes) if (!visited.has(n.id)) order.push(n.id)

  const cols = Math.max(2, Math.ceil(Math.sqrt(order.length * 1.8)))
  const grid = new Map<string, [number, number]>()
  order.forEach((id, i) => grid.set(id, [i % cols, Math.floor(i / cols)]))
  return grid
}

function cell2svg(col: number, row: number): [number, number] {
  return [PAD + col * CW, PAD + row * RH]
}

/**
 * Straight line from (x1,y1) to (x2,y2), offset perpendicularly for parallel edges.
 * idx = 0-based index among siblings, total = count of parallel edges.
 * Returns SVG path string.
 */
function fanLine(
  x1: number, y1: number, x2: number, y2: number,
  idx: number, total: number, spacing = 7
): string {
  const dx = x2 - x1, dy = y2 - y1
  const len = Math.sqrt(dx * dx + dy * dy)
  if (len < 0.1) return `M${x1},${y1}`
  const px = -dy / len, py = dx / len   // perpendicular unit vector
  const off = total === 1 ? 0 : (idx - (total - 1) / 2) * spacing
  return `M${x1 + px * off},${y1 + py * off} L${x2 + px * off},${y2 + py * off}`
}

/** Midpoint of a fanLine path (for label placement). */
function fanMid(
  x1: number, y1: number, x2: number, y2: number,
  idx: number, total: number, spacing = 7
): [number, number] {
  const dx = x2 - x1, dy = y2 - y1
  const len = Math.sqrt(dx * dx + dy * dy)
  if (len < 0.1) return [(x1 + x2) / 2, (y1 + y2) / 2]
  const px = -dy / len, py = dx / len
  const off = total === 1 ? 0 : (idx - (total - 1) / 2) * spacing
  return [(x1 + x2) / 2 + px * off, (y1 + y2) / 2 + py * off]
}

interface Tip { title: string; lines: string[]; sx: number; sy: number }

export function CountryNodeDiagram({
  nodes, segments, systems, capacity, countryHighlight, onClose,
}: Props) {
  const t = useTheme()
  const [tip, setTip] = useState<Tip | null>(null)

  const nodesById   = useMemo(() => Object.fromEntries(nodes.map(n => [n.id, n])),   [nodes])
  const systemsById = useMemo(() => Object.fromEntries(systems.map(s => [s.id, s])), [systems])
  const capMap      = useMemo(() => Object.fromEntries(capacity.map(c => [c.segment_id, c])), [capacity])

  const countryNodes = useMemo(() =>
    nodes.filter(n => countryHighlight.nodeIds.has(n.id) && n.type !== 'branching_unit'),
    [nodes, countryHighlight])

  const clsIds = useMemo(() =>
    new Set(countryNodes.filter(n => n.type === 'landing_station').map(n => n.id)),
    [countryNodes])

  // ── Segment categorisation ───────────────────────────────────────────────
  const { internalSegs, crossSegs, stubs } = useMemo(() => {
    const internal: CableSegment[] = []
    const cross: CableSegment[] = []
    const stubList: CableSegment[] = []
    const seen = new Set<string>()
    for (const seg of segments) {
      const sIn = countryHighlight.nodeIds.has(seg.start_node_id)
      const eIn = countryHighlight.nodeIds.has(seg.end_node_id)
      if (seg.type === 'terrestrial') {
        if (sIn && eIn) internal.push(seg)
        else if (sIn || eIn) cross.push(seg)
      } else if (seg.type === 'wet') {
        const sCls = clsIds.has(seg.start_node_id)
        const eCls = clsIds.has(seg.end_node_id)
        if ((sCls && !eIn) || (eCls && !sIn)) {
          const clsId = sCls ? seg.start_node_id : seg.end_node_id
          const key = `${seg.system_id}|${clsId}`
          if (!seen.has(key)) { seen.add(key); stubList.push(seg) }
        }
      }
    }
    return { internalSegs: internal, crossSegs: cross, stubs: stubList }
  }, [segments, countryHighlight, clsIds])

  // ── Grid layout ──────────────────────────────────────────────────────────
  const grid    = useMemo(() => buildGrid(countryNodes, internalSegs), [countryNodes, internalSegs])
  const nodePos = useMemo(() => {
    const m = new Map<string, [number, number]>()
    for (const [id, [c, r]] of grid) m.set(id, cell2svg(c, r))
    return m
  }, [grid])

  // Centroid of all rendered nodes — used for outward stub direction
  const centroid = useMemo(() => {
    const pts = [...nodePos.values()]
    if (!pts.length) return [0, 0] as [number, number]
    return [
      pts.reduce((s, p) => s + p[0], 0) / pts.length,
      pts.reduce((s, p) => s + p[1], 0) / pts.length,
    ] as [number, number]
  }, [nodePos])

  // SVG canvas — extra right/bottom space for outward stubs
  const { svgW, svgH } = useMemo(() => {
    let maxC = 0, maxR = 0
    for (const [c, r] of grid.values()) { maxC = Math.max(maxC, c); maxR = Math.max(maxR, r) }
    return { svgW: PAD * 2 + maxC * CW, svgH: PAD * 2 + maxR * RH + 40 }
  }, [grid])

  // Group parallel internal edges
  const edgeGroups = useMemo(() => {
    const g = new Map<string, CableSegment[]>()
    for (const seg of internalSegs) {
      const key = [seg.start_node_id, seg.end_node_id].sort().join('§')
      if (!g.has(key)) g.set(key, [])
      g.get(key)!.push(seg)
    }
    return g
  }, [internalSegs])

  // Group stubs by CLS for angular fan-out
  const stubsByCls = useMemo(() => {
    const g = new Map<string, CableSegment[]>()
    for (const s of stubs) {
      const clsId = clsIds.has(s.start_node_id) ? s.start_node_id : s.end_node_id
      if (!g.has(clsId)) g.set(clsId, [])
      g.get(clsId)!.push(s)
    }
    return g
  }, [stubs, clsIds])

  // ── Tooltip helpers ──────────────────────────────────────────────────────
  const mv = (e: React.MouseEvent) =>
    setTip(p => p ? { ...p, sx: e.clientX, sy: e.clientY } : null)

  function nodeTip(n: CableNode, e: React.MouseEvent) {
    setTip({ title: n.name, sx: e.clientX, sy: e.clientY,
      lines: [TYPE_LABEL[n.type] ?? n.type, n.owner ? `Owner: ${n.owner}` : '', `ID: ${n.id}`].filter(Boolean) })
  }
  function segTip(seg: CableSegment, e: React.MouseEvent) {
    const cap = capMap[seg.id]
    setTip({ title: seg.name || seg.id, sx: e.clientX, sy: e.clientY,
      lines: [`ID: ${seg.id}`, `${seg.length_km} km · ${(seg.latency * 1000).toFixed(1)} ms`,
              cap ? `${cap.available_capacity_t}/${cap.total_capacity_t} Tbps avail` : ''].filter(Boolean) })
  }
  function stubTip(seg: CableSegment, e: React.MouseEvent) {
    const sys = systemsById[seg.system_id]
    const fId = clsIds.has(seg.start_node_id) ? seg.end_node_id : seg.start_node_id
    const f   = nodesById[fId]
    setTip({ title: sys?.name ?? seg.system_id, sx: e.clientX, sy: e.clientY,
      lines: [`System: ${seg.system_id}`, f ? `→ ${f.name} (${f.country})` : '',
              `${seg.length_km} km · ${(seg.latency * 1000).toFixed(1)} ms`].filter(Boolean) })
  }

  const legend = [
    { color: NODE_COLOR.landing_station, label: 'Cable Landing Station', shape: 'diamond' },
    { color: NODE_COLOR.primary_pop,     label: 'Primary PoP',           shape: 'circle'  },
    { color: NODE_COLOR.secondary_pop,   label: 'Secondary PoP',         shape: 'circle'  },
    { color: NODE_COLOR.extension_pop,   label: 'Extension PoP',         shape: 'circle'  },
    { color: '#94a3b8',                  label: 'Terrestrial backhaul',   shape: 'line'    },
    { color: '#fb923c',                  label: 'Cross-country link',     shape: 'dashed'  },
    { color: '#22d3ee',                  label: 'Subsea cable stub',      shape: 'arrow'   },
  ]

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(0,0,0,0.72)',
               display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        width: 'min(97vw, 1100px)', maxHeight: '93vh',
        background: t.bgDeep, border: `1px solid ${t.border}`, borderRadius: 12,
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: '0 24px 64px rgba(0,0,0,0.7)',
      }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '12px 18px', borderBottom: `1px solid ${t.border}`,
                      background: t.bgBase, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 18 }}>🗺</span>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: t.text }}>
                {countryHighlight.countryName} — Node Diagram
              </div>
              <div style={{ fontSize: 11, color: t.textFaint }}>
                {countryNodes.length} nodes · {internalSegs.length} backhauls · {stubs.length} subsea stubs
              </div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: `1px solid ${t.border}`,
            borderRadius: 6, color: t.textFaint, cursor: 'pointer', padding: '4px 10px',
            fontSize: 13, fontFamily: 'inherit' }}>Close ✕</button>
        </div>

        {/* Diagram */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          <svg
            viewBox={`0 0 ${svgW} ${svgH}`}
            style={{ width: '100%', minWidth: svgW, display: 'block' }}
            onMouseLeave={() => setTip(null)}
          >
            <rect width={svgW} height={svgH} fill={t.bgDeep} />
            <defs>
              <marker id="ndSub" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
                <path d="M0,0 L0,6 L8,3 z" fill="#22d3ee" />
              </marker>
              <marker id="ndCrs" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
                <path d="M0,0 L0,6 L8,3 z" fill="#fb923c" />
              </marker>
            </defs>

            {/* ── Internal terrestrial — straight lines, fan-out for parallels ── */}
            {[...edgeGroups.values()].flatMap(segs =>
              segs.map((seg, idx) => {
                const p1 = nodePos.get(seg.start_node_id)
                const p2 = nodePos.get(seg.end_node_id)
                if (!p1 || !p2) return null
                const d  = fanLine(p1[0], p1[1], p2[0], p2[1], idx, segs.length)
                const [mx, my] = fanMid(p1[0], p1[1], p2[0], p2[1], idx, segs.length)
                return (
                  <g key={seg.id}>
                    <path d={d} fill="none" stroke="transparent" strokeWidth={12}
                      style={{ cursor: 'pointer' }}
                      onMouseEnter={e => segTip(seg, e)} onMouseMove={mv}
                      onMouseLeave={() => setTip(null)} />
                    <path d={d} fill="none" stroke="#94a3b8" strokeWidth={1.8} opacity={0.55}
                      style={{ pointerEvents: 'none' }} />
                    <text x={mx} y={my - 7} fontSize={7.5} fill="#94a3b8" opacity={0.75}
                      textAnchor="middle" style={{ pointerEvents: 'none', userSelect: 'none' }}>
                      {seg.id.replace('TERRESTRIAL_', '')}
                    </text>
                  </g>
                )
              })
            )}

            {/* ── Subsea stubs — fan outward from centroid, one arrow per system ── */}
            {[...stubsByCls.entries()].flatMap(([clsId, clsStubs]) => {
              const p = nodePos.get(clsId)
              if (!p) return []
              const [cx, cy] = p
              const [centX, centY] = centroid

              // Base angle: direction FROM centroid TO this CLS (outward)
              const baseDx = cx - centX, baseDy = cy - centY
              const baseLen = Math.sqrt(baseDx * baseDx + baseDy * baseDy)
              const baseAngle = baseLen > 1
                ? Math.atan2(baseDy, baseDx)
                : 0  // fallback: point right

              // Fan spread: 25° per stub, centred on baseAngle
              const fanDeg   = (25 * Math.PI) / 180
              const halfSpan = ((clsStubs.length - 1) / 2) * fanDeg
              const stubLen  = 75
              const r        = NODE_R['landing_station'] + 3

              return clsStubs.map((seg, i) => {
                const angle    = baseAngle - halfSpan + i * fanDeg
                const x1       = cx + Math.cos(angle) * r
                const y1       = cy + Math.sin(angle) * r
                const x2       = cx + Math.cos(angle) * (r + stubLen)
                const y2       = cy + Math.sin(angle) * (r + stubLen)
                const fId      = clsIds.has(seg.start_node_id) ? seg.end_node_id : seg.start_node_id
                const foreign  = nodesById[fId]
                const sysColor = countryHighlight.systemColors.get(seg.system_id) ?? '#22d3ee'
                const sys      = systemsById[seg.system_id]
                const destCC   = foreign?.country ?? '?'
                // Label sits past the arrowhead, offset slightly perpendicular
                const lx = x2 + Math.cos(angle) * 6
                const ly = y2 + Math.sin(angle) * 6
                return (
                  <g key={`${seg.id}-stub`}>
                    <line x1={x1} y1={y1} x2={x2} y2={y2}
                      stroke="transparent" strokeWidth={12}
                      style={{ cursor: 'pointer' }}
                      onMouseEnter={e => stubTip(seg, e)} onMouseMove={mv}
                      onMouseLeave={() => setTip(null)} />
                    <line x1={x1} y1={y1} x2={x2} y2={y2}
                      stroke={sysColor} strokeWidth={2} strokeDasharray="5,3"
                      markerEnd="url(#ndSub)" style={{ pointerEvents: 'none' }} />
                    {/* Label anchored past arrowhead */}
                    <text
                      x={lx} y={ly - 4}
                      fontSize={7} fill={sysColor} opacity={0.9}
                      textAnchor={Math.cos(angle) >= 0 ? 'start' : 'end'}
                      style={{ pointerEvents: 'none', userSelect: 'none' }}>
                      {sys?.name ?? seg.system_id}
                    </text>
                    <text
                      x={lx} y={ly + 5}
                      fontSize={6.5} fill={sysColor} opacity={0.6}
                      textAnchor={Math.cos(angle) >= 0 ? 'start' : 'end'}
                      style={{ pointerEvents: 'none', userSelect: 'none' }}>
                      → {destCC}
                    </text>
                  </g>
                )
              })
            })}

            {/* ── Cross-country terrestrial — short arrow outward ── */}
            {crossSegs.map(seg => {
              const inId = countryHighlight.nodeIds.has(seg.start_node_id) ? seg.start_node_id : seg.end_node_id
              const outId = countryHighlight.nodeIds.has(seg.start_node_id) ? seg.end_node_id : seg.start_node_id
              const p   = nodePos.get(inId)
              const out = nodesById[outId]
              if (!p || !out) return null
              const [cx, cy] = p
              const [centX, centY] = centroid
              // Point away from centroid
              const dx = cx - centX, dy = cy - centY
              const len = Math.sqrt(dx * dx + dy * dy)
              const angle = len > 1 ? Math.atan2(dy, dx) : 0
              const r  = (NODE_R[nodesById[inId]?.type ?? 'extension_pop'] ?? 7) + 3
              const x2 = cx + Math.cos(angle) * (r + 55)
              const y2 = cy + Math.sin(angle) * (r + 55)
              return (
                <g key={seg.id}>
                  <line x1={cx + Math.cos(angle) * r} y1={cy + Math.sin(angle) * r}
                    x2={x2} y2={y2}
                    stroke="transparent" strokeWidth={12} style={{ cursor: 'pointer' }}
                    onMouseEnter={e => segTip(seg, e)} onMouseMove={mv}
                    onMouseLeave={() => setTip(null)} />
                  <line x1={cx + Math.cos(angle) * r} y1={cy + Math.sin(angle) * r}
                    x2={x2} y2={y2}
                    stroke="#fb923c" strokeWidth={1.8} strokeDasharray="5,3"
                    markerEnd="url(#ndCrs)" style={{ pointerEvents: 'none' }} />
                  <text
                    x={x2 + Math.cos(angle) * 5} y={y2 + Math.sin(angle) * 5}
                    fontSize={7} fill="#fb923c" opacity={0.85}
                    textAnchor={Math.cos(angle) >= 0 ? 'start' : 'end'}
                    style={{ pointerEvents: 'none', userSelect: 'none' }}>
                    → {out.country}
                  </text>
                </g>
              )
            })}

            {/* ── Nodes ── */}
            {countryNodes.map(n => {
              const pos = nodePos.get(n.id)
              if (!pos) return null
              const [x, y] = pos
              const col   = NODE_COLOR[n.type] ?? '#94a3b8'
              const r     = NODE_R[n.type] ?? 7
              const isCls = n.type === 'landing_station'
              return (
                <g key={n.id} style={{ cursor: 'pointer' }}
                  onMouseEnter={e => nodeTip(n, e)} onMouseMove={mv}
                  onMouseLeave={() => setTip(null)}>
                  <circle cx={x} cy={y} r={r + 7} fill={col} opacity={0.10} />
                  {isCls ? (
                    <rect x={x - r} y={y - r} width={r * 2} height={r * 2}
                      fill={col} stroke={t.bgDeep} strokeWidth={1.5}
                      transform={`rotate(45,${x},${y})`} />
                  ) : (
                    <circle cx={x} cy={y} r={r} fill={col} stroke={t.bgDeep} strokeWidth={1.5} />
                  )}
                  <text x={x} y={y + r + 13} fontSize={8.5} fontWeight="600"
                    fill={t.text} opacity={0.9} textAnchor="middle"
                    style={{ pointerEvents: 'none', userSelect: 'none' }}>{n.id}</text>
                  <text x={x} y={y + r + 23} fontSize={6.5}
                    fill={t.textFaint} opacity={0.7} textAnchor="middle"
                    style={{ pointerEvents: 'none', userSelect: 'none' }}>
                    {n.name.length > 22 ? n.name.slice(0, 20) + '…' : n.name}
                  </text>
                </g>
              )
            })}
          </svg>
        </div>

        {/* Legend */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 18px',
                      padding: '8px 18px', borderTop: `1px solid ${t.border}`,
                      background: t.bgBase, flexShrink: 0 }}>
          {legend.map(item => (
            <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {item.shape === 'circle'  && <svg width={14} height={14}><circle cx={7} cy={7} r={5} fill={item.color} /></svg>}
              {item.shape === 'diamond' && <svg width={14} height={14}><rect x={3} y={3} width={8} height={8} fill={item.color} transform="rotate(45,7,7)" /></svg>}
              {item.shape === 'line'    && <svg width={20} height={10}><line x1={0} y1={5} x2={20} y2={5} stroke={item.color} strokeWidth={2} opacity={0.7} /></svg>}
              {item.shape === 'dashed'  && <svg width={20} height={10}><line x1={0} y1={5} x2={20} y2={5} stroke={item.color} strokeWidth={2} strokeDasharray="4,3" /></svg>}
              {item.shape === 'arrow'   && (
                <svg width={22} height={10}>
                  <defs><marker id="ll" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                    <path d="M0,0 L0,6 L6,3 z" fill={item.color} />
                  </marker></defs>
                  <line x1={0} y1={5} x2={16} y2={5} stroke={item.color} strokeWidth={2} strokeDasharray="4,2" markerEnd="url(#ll)" />
                </svg>
              )}
              <span style={{ fontSize: 10, color: t.textFaint }}>{item.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Tooltip */}
      {tip && (
        <div style={{ position: 'fixed', left: tip.sx + 14, top: tip.sy - 8,
                      background: t.bgBase, border: `1px solid ${t.border}`, borderRadius: 7,
                      padding: '7px 11px', pointerEvents: 'none', zIndex: 9100, maxWidth: 240,
                      boxShadow: '0 4px 16px rgba(0,0,0,0.5)' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: t.text, marginBottom: 4 }}>{tip.title}</div>
          {tip.lines.map((l, i) => <div key={i} style={{ fontSize: 11, color: t.textFaint, lineHeight: 1.5 }}>{l}</div>)}
        </div>
      )}
    </div>
  )
}
