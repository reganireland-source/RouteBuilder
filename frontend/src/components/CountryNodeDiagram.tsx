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
  landing_station: 13,
  primary_pop:     11,
  secondary_pop:    9,
  extension_pop:    8,
  branching_unit:   5,
}
const TYPE_LABEL: Record<string, string> = {
  landing_station: 'CLS',
  primary_pop:     'Primary PoP',
  secondary_pop:   'Secondary PoP',
  extension_pop:   'Extension PoP',
  branching_unit:  'BU',
}

// Distinct palette for segments (cycles if more than 14)
const SEG_PALETTE = [
  '#22d3ee', '#a78bfa', '#4ade80', '#fb923c', '#f472b6',
  '#fbbf24', '#60a5fa', '#34d399', '#e879f9', '#f87171',
  '#2dd4bf', '#a3e635', '#818cf8', '#fdba74',
]

const BOX_H   = 32    // half-side of routing box → 64×64 px
const GW      = 280   // grid column spacing (centre-to-centre)
const GH      = 180   // grid row spacing
const PAD     = 170   // outer padding — room for stubs + labels
const PORT_SP = 10    // px between parallel lines within a group
const STUB_LEN = 90

type Side = 'left' | 'right' | 'top' | 'bottom'

// ── Grid (BFS, topology only) ────────────────────────────────────────────────
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
    const curr = q.shift()!; order.push(curr)
    for (const nb of adj.get(curr) ?? [])
      if (!visited.has(nb)) { visited.add(nb); q.push(nb) }
  }
  for (const n of nodes) if (!visited.has(n.id)) order.push(n.id)
  const cols = Math.max(2, Math.ceil(Math.sqrt(order.length * 1.8)))
  const grid = new Map<string, [number, number]>()
  order.forEach((id, i) => grid.set(id, [i % cols, Math.floor(i / cols)]))
  return grid
}

function boxCenter(col: number, row: number): [number, number] {
  return [PAD + col * GW, PAD + row * GH]
}

// ── Routing helpers ──────────────────────────────────────────────────────────
function determineSides(c1: number, r1: number, c2: number, r2: number): [Side, Side] {
  const dc = c2 - c1, dr = r2 - r1
  if (dc === 0 && dr === 0) return ['right', 'left']
  if (dc === 0) return dr > 0 ? ['bottom', 'top'] : ['top', 'bottom']
  if (dr === 0) return dc > 0 ? ['right', 'left'] : ['left', 'right']
  return Math.abs(dc) >= Math.abs(dr)
    ? (dc > 0 ? ['right', 'left'] : ['left', 'right'])
    : (dr > 0 ? ['bottom', 'top'] : ['top', 'bottom'])
}

/**
 * Port on the box side using group-local index/total.
 * Group-local ensures srcOff == dstOff within a group → lines stay truly parallel.
 */
function portXY(cx: number, cy: number, side: Side, idx: number, total: number): [number, number] {
  const off = total === 1 ? 0 : (idx - (total - 1) / 2) * PORT_SP
  switch (side) {
    case 'right':  return [cx + BOX_H, cy + off]
    case 'left':   return [cx - BOX_H, cy + off]
    case 'bottom': return [cx + off,   cy + BOX_H]
    case 'top':    return [cx + off,   cy - BOX_H]
  }
}

/** H-first ortho path (or V-first). With group-local ports srcOff==dstOff so same-row = straight. */
function orthoPath(sx: number, sy: number, dx: number, dy: number, exitSide: Side): string {
  const isH = exitSide === 'right' || exitSide === 'left'
  if (isH) {
    if (Math.abs(sy - dy) < 0.5) return `M${sx},${sy} H${dx}`
    const mx = (sx + dx) / 2
    return `M${sx},${sy} H${mx} V${dy} H${dx}`
  } else {
    if (Math.abs(sx - dx) < 0.5) return `M${sx},${sy} V${dy}`
    const my = (sy + dy) / 2
    return `M${sx},${sy} V${my} H${dx} V${dy}`
  }
}

/**
 * Label position: spread along the segment using group index.
 * t varies across [0.2 … 0.8] so labels for a group are distributed horizontally.
 */
function labelPos(
  sx: number, sy: number, dx: number, dy: number,
  exitSide: Side, idx: number, total: number
): [number, number] {
  const t = total <= 1 ? 0.5 : 0.2 + (idx / (total - 1)) * 0.6
  const isH = exitSide === 'right' || exitSide === 'left'
  if (isH) {
    const lx = sx + (dx - sx) * t
    return [lx, sy - 9]   // above the line (sy is already the port y = group-local offset)
  } else {
    const ly = sy + (dy - sy) * t
    return [sx - 9, ly]
  }
}

function outwardSide(cx: number, cy: number, centX: number, centY: number): Side {
  const dx = cx - centX, dy = cy - centY
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left'
  return dy >= 0 ? 'bottom' : 'top'
}

function stubEnd(px: number, py: number, side: Side): [number, number] {
  switch (side) {
    case 'right':  return [px + STUB_LEN, py]
    case 'left':   return [px - STUB_LEN, py]
    case 'bottom': return [px,            py + STUB_LEN]
    case 'top':    return [px,            py - STUB_LEN]
  }
}

// ── Types ────────────────────────────────────────────────────────────────────
interface Tip { title: string; lines: string[]; sx: number; sy: number }
interface RoutedEdge {
  seg: CableSegment
  color: string
  srcSide: Side; dstSide: Side
  pIdx: number; pTotal: number   // group-local
}
interface RoutedStub {
  seg: CableSegment
  nodeId: string; side: Side; pIdx: number; pTotal: number
}

// ── Component ────────────────────────────────────────────────────────────────
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
    const internal: CableSegment[] = [], cross: CableSegment[] = [], stubList: CableSegment[] = []
    const seen = new Set<string>()
    for (const seg of segments) {
      const sIn = countryHighlight.nodeIds.has(seg.start_node_id)
      const eIn = countryHighlight.nodeIds.has(seg.end_node_id)
      if (seg.type === 'terrestrial') {
        if (sIn && eIn) internal.push(seg)
        else if (sIn || eIn) cross.push(seg)
      } else if (seg.type === 'wet') {
        const sCls = clsIds.has(seg.start_node_id), eCls = clsIds.has(seg.end_node_id)
        if ((sCls && !eIn) || (eCls && !sIn)) {
          const clsId = sCls ? seg.start_node_id : seg.end_node_id
          const key = `${seg.system_id}|${clsId}`
          if (!seen.has(key)) { seen.add(key); stubList.push(seg) }
        }
      }
    }
    return { internalSegs: internal, crossSegs: cross, stubs: stubList }
  }, [segments, countryHighlight, clsIds])

  // ── Grid + positions ─────────────────────────────────────────────────────
  const grid    = useMemo(() => buildGrid(countryNodes, internalSegs), [countryNodes, internalSegs])
  const nodePos = useMemo(() => {
    const m = new Map<string, [number, number]>()
    for (const [id, [c, r]] of grid) m.set(id, boxCenter(c, r))
    return m
  }, [grid])

  const centroid = useMemo(() => {
    const pts = [...nodePos.values()]
    if (!pts.length) return [0, 0] as [number, number]
    return [
      pts.reduce((s, p) => s + p[0], 0) / pts.length,
      pts.reduce((s, p) => s + p[1], 0) / pts.length,
    ] as [number, number]
  }, [nodePos])

  const { svgW, svgH } = useMemo(() => {
    let maxC = 0, maxR = 0
    for (const [c, r] of grid.values()) { maxC = Math.max(maxC, c); maxR = Math.max(maxR, r) }
    return { svgW: PAD * 2 + maxC * GW, svgH: PAD * 2 + maxR * GH + 80 }
  }, [grid])

  // ── Group parallel internal edges ────────────────────────────────────────
  const edgeGroups = useMemo(() => {
    const g = new Map<string, CableSegment[]>()
    for (const seg of internalSegs) {
      const key = [seg.start_node_id, seg.end_node_id].sort().join('§')
      if (!g.has(key)) g.set(key, [])
      g.get(key)!.push(seg)
    }
    return g
  }, [internalSegs])

  // ── Port-based routing — GROUP-LOCAL indices so parallels stay parallel ──
  const routedEdges = useMemo((): RoutedEdge[] => {
    const result: RoutedEdge[] = []
    let colorIdx = 0
    for (const segs of edgeGroups.values()) {
      const s0 = segs[0]
      const g1 = grid.get(s0.start_node_id), g2 = grid.get(s0.end_node_id)
      if (!g1 || !g2) continue
      const [srcSide, dstSide] = determineSides(g1[0], g1[1], g2[0], g2[1])
      const N = segs.length
      segs.forEach((seg, i) => {
        result.push({
          seg, srcSide, dstSide, pIdx: i, pTotal: N,
          color: SEG_PALETTE[colorIdx % SEG_PALETTE.length],
        })
        colorIdx++
      })
    }
    return result
  }, [edgeGroups, grid])

  // ── Subsea stub routing ──────────────────────────────────────────────────
  const stubRouting = useMemo((): RoutedStub[] => {
    const [centX, centY] = centroid
    const byCls = new Map<string, CableSegment[]>()
    for (const s of stubs) {
      const clsId = clsIds.has(s.start_node_id) ? s.start_node_id : s.end_node_id
      if (!byCls.has(clsId)) byCls.set(clsId, [])
      byCls.get(clsId)!.push(s)
    }
    const result: RoutedStub[] = []
    for (const [clsId, clsStubs] of byCls) {
      const p = nodePos.get(clsId); if (!p) continue
      const side = outwardSide(p[0], p[1], centX, centY)
      clsStubs.forEach((seg, i) =>
        result.push({ seg, nodeId: clsId, side, pIdx: i, pTotal: clsStubs.length }))
    }
    return result
  }, [stubs, clsIds, nodePos, centroid])

  // ── Cross-country stub routing ───────────────────────────────────────────
  const crossRouting = useMemo((): RoutedStub[] => {
    const [centX, centY] = centroid
    const byNode = new Map<string, CableSegment[]>()
    for (const seg of crossSegs) {
      const inId = countryHighlight.nodeIds.has(seg.start_node_id) ? seg.start_node_id : seg.end_node_id
      if (!byNode.has(inId)) byNode.set(inId, [])
      byNode.get(inId)!.push(seg)
    }
    const result: RoutedStub[] = []
    for (const [nodeId, segs] of byNode) {
      const p = nodePos.get(nodeId); if (!p) continue
      const side = outwardSide(p[0], p[1], centX, centY)
      segs.forEach((seg, i) =>
        result.push({ seg, nodeId, side, pIdx: i, pTotal: segs.length }))
    }
    return result
  }, [crossSegs, countryHighlight, nodePos, centroid])

  // ── Tooltip ──────────────────────────────────────────────────────────────
  const mv = (e: React.MouseEvent) => setTip(p => p ? { ...p, sx: e.clientX, sy: e.clientY } : null)

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
      lines: [`ID: ${seg.id}`, f ? `→ ${f.name} (${f.country})` : '',
              `${seg.length_km} km · ${(seg.latency * 1000).toFixed(1)} ms`].filter(Boolean) })
  }

  // Helper: text anchor + position for a stub endpoint
  function stubLabelPos(ex: number, ey: number, side: Side) {
    const anchor: 'start' | 'end' | 'middle' =
      side === 'left' ? 'end' : side === 'right' ? 'start' : 'middle'
    const lx = side === 'right' ? ex + 5 : side === 'left' ? ex - 5 : ex
    const ly = side === 'bottom' ? ey + 14 : side === 'top' ? ey - 12 : ey - 5
    return { lx, ly, anchor }
  }

  const legend = [
    { color: NODE_COLOR.landing_station, label: 'Cable Landing Station', shape: 'diamond' },
    { color: NODE_COLOR.primary_pop,     label: 'Primary PoP',           shape: 'circle'  },
    { color: NODE_COLOR.secondary_pop,   label: 'Secondary PoP',         shape: 'circle'  },
    { color: NODE_COLOR.extension_pop,   label: 'Extension PoP',         shape: 'circle'  },
    { color: SEG_PALETTE[0],             label: 'Terrestrial backhaul',   shape: 'line'    },
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
        width: 'min(97vw, 1300px)', maxHeight: '93vh',
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

            {/* ── Internal terrestrial edges ── */}
            {routedEdges.map(({ seg, color, srcSide, dstSide, pIdx, pTotal }) => {
              const p1 = nodePos.get(seg.start_node_id), p2 = nodePos.get(seg.end_node_id)
              if (!p1 || !p2) return null
              const [sx, sy] = portXY(p1[0], p1[1], srcSide, pIdx, pTotal)
              const [dx, dy] = portXY(p2[0], p2[1], dstSide, pIdx, pTotal)
              const d = orthoPath(sx, sy, dx, dy, srcSide)
              const [lx, ly] = labelPos(sx, sy, dx, dy, srcSide, pIdx, pTotal)
              return (
                <g key={seg.id}>
                  <path d={d} fill="none" stroke="transparent" strokeWidth={12} style={{ cursor: 'pointer' }}
                    onMouseEnter={e => segTip(seg, e)} onMouseMove={mv} onMouseLeave={() => setTip(null)} />
                  <path d={d} fill="none" stroke={color} strokeWidth={2} opacity={0.85}
                    style={{ pointerEvents: 'none' }} />
                  <text x={lx} y={ly} fontSize={8} fontWeight="500" fill={color} opacity={1}
                    textAnchor="middle" style={{ pointerEvents: 'none', userSelect: 'none' }}>
                    {seg.id.replace('TERRESTRIAL_', '')}
                  </text>
                </g>
              )
            })}

            {/* ── Subsea stubs ── */}
            {stubRouting.map(({ seg, nodeId, side, pIdx, pTotal }) => {
              const p = nodePos.get(nodeId); if (!p) return null
              const [px, py] = portXY(p[0], p[1], side, pIdx, pTotal)
              const [ex, ey] = stubEnd(px, py, side)
              const sysColor = countryHighlight.systemColors.get(seg.system_id) ?? '#22d3ee'
              const fId = clsIds.has(seg.start_node_id) ? seg.end_node_id : seg.start_node_id
              const foreign = nodesById[fId]
              const destCC = foreign?.country ?? '?'
              const { lx, ly, anchor } = stubLabelPos(ex, ey, side)
              return (
                <g key={`${seg.id}-stub`}>
                  <line x1={px} y1={py} x2={ex} y2={ey}
                    stroke="transparent" strokeWidth={14} style={{ cursor: 'pointer' }}
                    onMouseEnter={e => stubTip(seg, e)} onMouseMove={mv} onMouseLeave={() => setTip(null)} />
                  <line x1={px} y1={py} x2={ex} y2={ey}
                    stroke={sysColor} strokeWidth={2.2} strokeDasharray="5,3"
                    markerEnd="url(#ndSub)" style={{ pointerEvents: 'none' }} />
                  <text x={lx} y={ly} fontSize={7.5} fontWeight="500" fill={sysColor} opacity={1}
                    textAnchor={anchor} style={{ pointerEvents: 'none', userSelect: 'none' }}>
                    {seg.id}
                  </text>
                  <text x={lx} y={ly + 10} fontSize={7} fill={sysColor} opacity={0.75}
                    textAnchor={anchor} style={{ pointerEvents: 'none', userSelect: 'none' }}>
                    → {destCC}
                  </text>
                </g>
              )
            })}

            {/* ── Cross-country stubs ── */}
            {crossRouting.map(({ seg, nodeId, side, pIdx, pTotal }) => {
              const p = nodePos.get(nodeId); if (!p) return null
              const [px, py] = portXY(p[0], p[1], side, pIdx, pTotal)
              const [ex, ey] = stubEnd(px, py, side)
              const outId = countryHighlight.nodeIds.has(seg.start_node_id) ? seg.end_node_id : seg.start_node_id
              const out = nodesById[outId]
              const { lx, ly, anchor } = stubLabelPos(ex, ey, side)
              return (
                <g key={seg.id}>
                  <line x1={px} y1={py} x2={ex} y2={ey}
                    stroke="transparent" strokeWidth={14} style={{ cursor: 'pointer' }}
                    onMouseEnter={e => segTip(seg, e)} onMouseMove={mv} onMouseLeave={() => setTip(null)} />
                  <line x1={px} y1={py} x2={ex} y2={ey}
                    stroke="#fb923c" strokeWidth={2.2} strokeDasharray="5,3"
                    markerEnd="url(#ndCrs)" style={{ pointerEvents: 'none' }} />
                  <text x={lx} y={ly} fontSize={7.5} fontWeight="500" fill="#fb923c" opacity={1}
                    textAnchor={anchor} style={{ pointerEvents: 'none', userSelect: 'none' }}>
                    {seg.id}
                  </text>
                  <text x={lx} y={ly + 10} fontSize={7} fill="#fb923c" opacity={0.75}
                    textAnchor={anchor} style={{ pointerEvents: 'none', userSelect: 'none' }}>
                    → {out?.country ?? '?'}
                  </text>
                </g>
              )
            })}

            {/* ── Nodes: outer routing box + inner symbol + labels ── */}
            {countryNodes.map(n => {
              const pos = nodePos.get(n.id); if (!pos) return null
              const [x, y] = pos
              const col   = NODE_COLOR[n.type] ?? '#94a3b8'
              const r     = NODE_R[n.type] ?? 8
              const isCls = n.type === 'landing_station'
              return (
                <g key={n.id} style={{ cursor: 'pointer' }}
                  onMouseEnter={e => nodeTip(n, e)} onMouseMove={mv}
                  onMouseLeave={() => setTip(null)}>
                  {/* Routing box */}
                  <rect x={x - BOX_H} y={y - BOX_H} width={BOX_H * 2} height={BOX_H * 2}
                    fill={col} fillOpacity={0.08} stroke={col} strokeOpacity={0.55}
                    strokeWidth={1.5} rx={3} />
                  {/* Symbol */}
                  {isCls ? (
                    <rect x={x - r} y={y - r} width={r * 2} height={r * 2}
                      fill={col} stroke={t.bgDeep} strokeWidth={1.5}
                      transform={`rotate(45,${x},${y})`} />
                  ) : (
                    <circle cx={x} cy={y} r={r} fill={col} stroke={t.bgDeep} strokeWidth={1.5} />
                  )}
                  {/* ID */}
                  <text x={x} y={y + BOX_H + 15} fontSize={9.5} fontWeight="700"
                    fill={t.text} opacity={1} textAnchor="middle"
                    style={{ pointerEvents: 'none', userSelect: 'none' }}>{n.id}</text>
                  {/* Name */}
                  <text x={x} y={y + BOX_H + 27} fontSize={7.5}
                    fill={t.textMuted} opacity={0.9} textAnchor="middle"
                    style={{ pointerEvents: 'none', userSelect: 'none' }}>
                    {n.name.length > 20 ? n.name.slice(0, 18) + '…' : n.name}
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
              {item.shape === 'line'    && <svg width={22} height={10}><line x1={0} y1={5} x2={22} y2={5} stroke={item.color} strokeWidth={2} /></svg>}
              {item.shape === 'dashed'  && <svg width={22} height={10}><line x1={0} y1={5} x2={22} y2={5} stroke={item.color} strokeWidth={2} strokeDasharray="4,3" /></svg>}
              {item.shape === 'arrow'   && (
                <svg width={24} height={10}>
                  <defs><marker id="ll" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                    <path d="M0,0 L0,6 L6,3 z" fill={item.color} />
                  </marker></defs>
                  <line x1={0} y1={5} x2={18} y2={5} stroke={item.color} strokeWidth={2}
                    strokeDasharray="4,2" markerEnd="url(#ll)" />
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
                      padding: '7px 11px', pointerEvents: 'none', zIndex: 9100, maxWidth: 260,
                      boxShadow: '0 4px 16px rgba(0,0,0,0.5)' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: t.text, marginBottom: 4 }}>{tip.title}</div>
          {tip.lines.map((l, i) => <div key={i} style={{ fontSize: 11, color: t.textFaint, lineHeight: 1.5 }}>{l}</div>)}
        </div>
      )}
    </div>
  )
}
