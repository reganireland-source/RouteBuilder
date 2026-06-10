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

// Grid spacing (pixels per cell)
const CW = 160  // column width
const RH = 120  // row height
const PX = 80   // left/right padding before first column
const PY = 70   // top/bottom padding before first row

/**
 * Assign every node a [col, row] grid cell.
 * Strategy: BFS from the most-connected node, fill left→right, top→bottom.
 * No geography involved — pure topology.
 */
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

  // Sort neighbours by degree descending for a better spread
  for (const [id, nb] of adj) adj.set(id, nb.sort((a, b) => (degree.get(b) ?? 0) - (degree.get(a) ?? 0)))

  // BFS order
  const startId = [...degree.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? nodes[0].id
  const order: string[] = []
  const visited = new Set([startId])
  const q = [startId]
  while (q.length) {
    const curr = q.shift()!
    order.push(curr)
    for (const nb of adj.get(curr) ?? []) if (!visited.has(nb)) { visited.add(nb); q.push(nb) }
  }
  for (const n of nodes) if (!visited.has(n.id)) order.push(n.id)

  // Lay out in a grid that is wider than tall (~16:9 feel)
  const total = order.length
  const cols  = Math.max(2, Math.ceil(Math.sqrt(total * 1.8)))

  const grid = new Map<string, [number, number]>()
  order.forEach((id, i) => grid.set(id, [i % cols, Math.floor(i / cols)]))
  return grid
}

function cell2svg(col: number, row: number): [number, number] {
  return [PX + col * CW, PY + row * RH]
}

/**
 * Orthogonal path between (x1,y1) and (x2,y2).
 * Uses a Z-shape: horizontal → vertical → horizontal, with the elbow at fraction `t`.
 * For same-row or same-column pairs this degenerates to a straight line.
 */
function ortho(x1: number, y1: number, x2: number, y2: number, t = 0.5): string {
  if (Math.abs(y1 - y2) < 0.5) return `M${x1},${y1} H${x2}`
  if (Math.abs(x1 - x2) < 0.5) return `M${x1},${y1} V${y2}`
  const xm = x1 + (x2 - x1) * t
  return `M${x1},${y1} H${xm} V${y2} H${x2}`
}

interface Tip { title: string; lines: string[]; sx: number; sy: number }

export function CountryNodeDiagram({ nodes, segments, systems, capacity, countryHighlight, onClose }: Props) {
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

  // ── Segment categorisation ──────────────────────────────────────────────
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

  // ── Grid layout ─────────────────────────────────────────────────────────
  const grid    = useMemo(() => buildGrid(countryNodes, internalSegs), [countryNodes, internalSegs])
  const nodePos = useMemo(() => {
    const m = new Map<string, [number, number]>()
    for (const [id, [c, r]] of grid) m.set(id, cell2svg(c, r))
    return m
  }, [grid])

  // SVG canvas size: fit the grid, plus a stub column on the right
  const { svgW, svgH } = useMemo(() => {
    let maxC = 0, maxR = 0
    for (const [c, r] of grid.values()) { maxC = Math.max(maxC, c); maxR = Math.max(maxR, r) }
    return { svgW: PX * 2 + maxC * CW + 160, svgH: PY * 2 + maxR * RH + 50 }
  }, [grid])

  // Group parallel internal edges to spread their elbows
  const edgeGroups = useMemo(() => {
    const g = new Map<string, CableSegment[]>()
    for (const seg of internalSegs) {
      const key = [seg.start_node_id, seg.end_node_id].sort().join('§')
      if (!g.has(key)) g.set(key, [])
      g.get(key)!.push(seg)
    }
    return g
  }, [internalSegs])

  // Group stubs by CLS so we can stack them vertically
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
    setTip(prev => prev ? { ...prev, sx: e.clientX, sy: e.clientY } : null)

  function nodeTip(n: CableNode, e: React.MouseEvent) {
    setTip({ title: n.name, sx: e.clientX, sy: e.clientY,
      lines: [TYPE_LABEL[n.type] ?? n.type, n.owner ? `Owner: ${n.owner}` : '', `ID: ${n.id}`].filter(Boolean) })
  }
  function segTip(seg: CableSegment, e: React.MouseEvent) {
    const cap = capMap[seg.id]
    setTip({ title: seg.name || seg.id, sx: e.clientX, sy: e.clientY,
      lines: [`ID: ${seg.id}`, `Length: ${seg.length_km} km`,
              `Latency: ${(seg.latency * 1000).toFixed(1)} ms`,
              cap ? `Capacity: ${cap.available_capacity_t}/${cap.total_capacity_t} Tbps` : ''].filter(Boolean) })
  }
  function stubTip(seg: CableSegment, e: React.MouseEvent) {
    const sys = systemsById[seg.system_id]
    const fId = clsIds.has(seg.start_node_id) ? seg.end_node_id : seg.start_node_id
    const f   = nodesById[fId]
    setTip({ title: sys?.name ?? seg.system_id, sx: e.clientX, sy: e.clientY,
      lines: [`System: ${seg.system_id}`, f ? `→ ${f.name} (${f.country})` : '',
              `Length: ${seg.length_km} km`, `Latency: ${(seg.latency * 1000).toFixed(1)} ms`].filter(Boolean) })
  }

  // ── Legend ───────────────────────────────────────────────────────────────
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
        position: 'relative', width: 'min(97vw, 1100px)', maxHeight: '93vh',
        background: t.bgDeep, border: `1px solid ${t.border}`, borderRadius: 12,
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: '0 24px 64px rgba(0,0,0,0.7)',
      }}>

        {/* ── Header ── */}
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

        {/* ── Diagram ── */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          <svg
            viewBox={`0 0 ${svgW} ${svgH}`}
            style={{ width: '100%', minWidth: svgW, display: 'block' }}
            onMouseLeave={() => setTip(null)}
          >
            <rect x={0} y={0} width={svgW} height={svgH} fill={t.bgDeep} />

            <defs>
              <marker id="ndArrowSub"  markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
                <path d="M0,0 L0,6 L8,3 z" fill="#22d3ee" />
              </marker>
              <marker id="ndArrowCrs"  markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
                <path d="M0,0 L0,6 L8,3 z" fill="#fb923c" />
              </marker>
            </defs>

            {/* ── Internal terrestrial segments (orthogonal) ── */}
            {[...edgeGroups.values()].flatMap(segs => {
              // Spread elbows for parallel edges
              const ts = segs.length === 1 ? [0.5]
                       : segs.length === 2 ? [0.35, 0.65]
                       :                     [0.25, 0.5, 0.75]
              return segs.map((seg, idx) => {
                const p1 = nodePos.get(seg.start_node_id)
                const p2 = nodePos.get(seg.end_node_id)
                if (!p1 || !p2) return null
                const d  = ortho(p1[0], p1[1], p2[0], p2[1], ts[idx] ?? 0.5)
                const mx = (p1[0] + p2[0]) / 2
                const my = (p1[1] + p2[1]) / 2
                return (
                  <g key={seg.id}>
                    {/* Fat invisible hit area */}
                    <path d={d} fill="none" stroke="transparent" strokeWidth={12}
                      style={{ cursor: 'pointer' }}
                      onMouseEnter={e => segTip(seg, e)} onMouseMove={mv}
                      onMouseLeave={() => setTip(null)} />
                    {/* Visible line */}
                    <path d={d} fill="none" stroke="#94a3b8" strokeWidth={1.8}
                      opacity={0.55} style={{ pointerEvents: 'none' }} />
                    <text x={mx} y={my - 7} fontSize={7.5} fill="#94a3b8" opacity={0.65}
                      textAnchor="middle" style={{ pointerEvents: 'none', userSelect: 'none' }}>
                      {seg.id.replace('TERRESTRIAL_', '')}
                    </text>
                  </g>
                )
              })
            })}

            {/* ── Subsea stubs — stacked vertically off each CLS ── */}
            {[...stubsByCls.entries()].flatMap(([clsId, clsStubs]) => {
              const p = nodePos.get(clsId)
              if (!p) return []
              const [cx, cy] = p
              const stubH   = 18                // vertical pitch between stubs
              const totalH  = (clsStubs.length - 1) * stubH
              const startY  = cy - totalH / 2
              const stubLen = 80                // horizontal length of stub arrow

              return clsStubs.map((seg, i) => {
                const sy       = startY + i * stubH
                const fId      = clsIds.has(seg.start_node_id) ? seg.end_node_id : seg.start_node_id
                const foreign  = nodesById[fId]
                const sysColor = countryHighlight.systemColors.get(seg.system_id) ?? '#22d3ee'
                const sys      = systemsById[seg.system_id]
                const destCC   = foreign?.country ?? '?'
                // Orthogonal route: from node edge → right → to stub tip
                const x1 = cx + (NODE_R['landing_station'] + 2)
                const x2 = cx + stubLen
                // L-shape: go horizontal from node then vertical to stub row then horizontal to tip
                const d  = sy === cy
                  ? `M${x1},${cy} H${x2}`
                  : `M${x1},${cy} H${cx + stubLen * 0.4} V${sy} H${x2}`

                return (
                  <g key={`${seg.id}-stub`}>
                    <path d={d} fill="none" stroke="transparent" strokeWidth={10}
                      style={{ cursor: 'pointer' }}
                      onMouseEnter={e => stubTip(seg, e)} onMouseMove={mv}
                      onMouseLeave={() => setTip(null)} />
                    <path d={d} fill="none" stroke={sysColor} strokeWidth={1.8}
                      strokeDasharray="5,3" markerEnd="url(#ndArrowSub)"
                      style={{ pointerEvents: 'none' }} />
                    <text x={x2 + 6} y={sy - 3} fontSize={7.5} fill={sysColor} opacity={0.9}
                      style={{ pointerEvents: 'none', userSelect: 'none' }}>
                      {sys?.name ?? seg.system_id}
                    </text>
                    <text x={x2 + 6} y={sy + 7} fontSize={6.5} fill={sysColor} opacity={0.6}
                      style={{ pointerEvents: 'none', userSelect: 'none' }}>
                      → {destCC}
                    </text>
                  </g>
                )
              })
            })}

            {/* ── Cross-country terrestrial links ── */}
            {crossSegs.map(seg => {
              const inId  = countryHighlight.nodeIds.has(seg.start_node_id) ? seg.start_node_id : seg.end_node_id
              const outId = countryHighlight.nodeIds.has(seg.start_node_id) ? seg.end_node_id : seg.start_node_id
              const p     = nodePos.get(inId)
              const out   = nodesById[outId]
              if (!p || !out) return null
              const [cx, cy] = p
              const r   = NODE_R[nodesById[inId]?.type ?? 'extension_pop'] ?? 7
              const x2  = cx + 70
              return (
                <g key={seg.id}>
                  <line x1={cx + r + 2} y1={cy} x2={x2} y2={cy}
                    stroke="#fb923c" strokeWidth={1.8} strokeDasharray="5,3"
                    markerEnd="url(#ndArrowCrs)" style={{ cursor: 'pointer' }}
                    onMouseEnter={e => segTip(seg, e)} onMouseMove={mv}
                    onMouseLeave={() => setTip(null)} />
                  <text x={cx + r + 38} y={cy - 7} fontSize={7} fill="#fb923c" opacity={0.85}
                    textAnchor="middle" style={{ pointerEvents: 'none', userSelect: 'none' }}>
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
              const col    = NODE_COLOR[n.type] ?? '#94a3b8'
              const r      = NODE_R[n.type] ?? 7
              const isCls  = n.type === 'landing_station'
              return (
                <g key={n.id} style={{ cursor: 'pointer' }}
                  onMouseEnter={e => nodeTip(n, e)} onMouseMove={mv}
                  onMouseLeave={() => setTip(null)}>
                  {/* Glow halo */}
                  <circle cx={x} cy={y} r={r + 6} fill={col} opacity={0.10} />
                  {/* Shape */}
                  {isCls ? (
                    <rect x={x - r} y={y - r} width={r * 2} height={r * 2}
                      fill={col} stroke={t.bgDeep} strokeWidth={1.5}
                      transform={`rotate(45,${x},${y})`} />
                  ) : (
                    <circle cx={x} cy={y} r={r} fill={col} stroke={t.bgDeep} strokeWidth={1.5} />
                  )}
                  {/* Labels below */}
                  <text x={x} y={y + r + 12} fontSize={8.5} fontWeight="600"
                    fill={t.text} opacity={0.9} textAnchor="middle"
                    style={{ pointerEvents: 'none', userSelect: 'none' }}>
                    {n.id}
                  </text>
                  <text x={x} y={y + r + 22} fontSize={6.5}
                    fill={t.textFaint} opacity={0.7} textAnchor="middle"
                    style={{ pointerEvents: 'none', userSelect: 'none' }}>
                    {n.name.length > 22 ? n.name.slice(0, 20) + '…' : n.name}
                  </text>
                </g>
              )
            })}
          </svg>
        </div>

        {/* ── Legend ── */}
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

      {/* ── Tooltip ── */}
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
