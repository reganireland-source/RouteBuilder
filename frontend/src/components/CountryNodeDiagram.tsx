import { useState, useMemo, useRef, useEffect } from 'react'
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
  landing_station: '#0369a1',   // ocean blue  (was neon cyan)
  primary_pop:     '#15803d',   // forest green (was bright green)
  secondary_pop:   '#b45309',   // dark amber   (was bright yellow-amber)
  extension_pop:   '#7c3aed',   // violet       (keep)
  branching_unit:  '#6b7280',   // gray         (keep)
  off_net:         '#374151',   // dark slate
}
const NODE_R: Record<string, number> = {
  landing_station: 10,
  primary_pop:     12,
  secondary_pop:   10,
  extension_pop:    9,
  branching_unit:   5,
  off_net:          8,
}
const TYPE_LABEL: Record<string, string> = {
  landing_station: 'CLS',
  primary_pop:     'Primary PoP',
  secondary_pop:   'Secondary PoP',
  extension_pop:   'Extension PoP',
  branching_unit:  'BU',
  off_net:         'Off-Net',
}

// 14 visually distinct segment colours — all dark enough to read on a light grey background
const SEG_PALETTE = [
  '#0369a1', // ocean blue
  '#6d28d9', // violet
  '#15803d', // forest green
  '#c2410c', // burnt orange
  '#be185d', // deep rose
  '#92400e', // dark amber
  '#1d4ed8', // royal blue
  '#0f766e', // dark teal
  '#a21caf', // deep magenta (was neon #c026d3)
  '#b91c1c', // crimson
  '#115e59', // dark emerald
  '#4d7c0f', // olive        (was neon lime #65a30d)
  '#4338ca', // indigo
  '#9a3412', // brick
]

const STUB_COLOR  = '#0369a1'  // deep blue (was neon cyan #22d3ee)
const CROSS_COLOR = '#c2410c'  // burnt orange (was bright #fb923c)

const BOX_H    = 34    // half-side of routing box → 68×68 px
const GW       = 300   // grid column spacing
const GH       = 200   // grid row spacing
const PAD      = 180   // outer padding (room for 45° stubs + labels)
const PORT_SP  = 20    // px between parallel lines within one group
const GROUP_GAP = 20   // px gap between separate groups on the same (node, side)
const STUB_LEN = 100   // length of subsea stub lines
const TURN_SEP = 20    // minimum px between any two parallel vertical (or horizontal) segments

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

// ── Orthogonal routing helpers ───────────────────────────────────────────────
function determineSides(c1: number, r1: number, c2: number, r2: number): [Side, Side] {
  const dc = c2 - c1, dr = r2 - r1
  if (dc === 0 && dr === 0) return ['right', 'left']
  if (dc === 0) return dr > 0 ? ['bottom', 'top'] : ['top', 'bottom']
  if (dr === 0) return dc > 0 ? ['right', 'left'] : ['left', 'right']
  // Only use horizontal faces when the connection is strongly horizontal (> 2:1 ratio).
  // All other diagonals exit top/bottom — keeps left/right faces clear of diagonal routes.
  if (Math.abs(dc) > Math.abs(dr) * 2) {
    return dc > 0 ? ['right', 'left'] : ['left', 'right']
  }
  return dr > 0 ? ['bottom', 'top'] : ['top', 'bottom']
}

/** Port using a pre-computed perpendicular offset. */
function sidePort(cx: number, cy: number, side: Side, off: number): [number, number] {
  switch (side) {
    case 'right':  return [cx + BOX_H, cy + off]
    case 'left':   return [cx - BOX_H, cy + off]
    case 'bottom': return [cx + off,   cy + BOX_H]
    case 'top':    return [cx + off,   cy - BOX_H]
  }
}

/** Port using group-local idx/total (used for cross-country stubs). */
function portXY(cx: number, cy: number, side: Side, idx: number, total: number): [number, number] {
  const off = total === 1 ? 0 : (idx - (total - 1) / 2) * PORT_SP
  return sidePort(cx, cy, side, off)
}

function orthoPath(sx: number, sy: number, dx: number, dy: number, exitSide: Side, bypassOff = 0, turnOff = 0): string {
  const isH = exitSide === 'right' || exitSide === 'left'
  if (!isH && bypassOff > 0) {
    // Top-exit bypass: V-H-V path. x positions are pre-staggered via offA/offB port spread
    // so each bypass path has its own unique x column at both source and destination.
    const yBypass = Math.min(sy, dy) - bypassOff
    return `M${sx},${sy} V${yBypass} H${dx} V${dy}`
  }
  if (isH) {
    if (Math.abs(sy - dy) < 0.5) return `M${sx},${sy} H${dx}`
    const mid = (sx + dx) / 2 + turnOff
    return `M${sx},${sy} H${mid} V${dy} H${dx}`
  }
  if (Math.abs(sx - dx) < 0.5) return `M${sx},${sy} V${dy}`
  const mid = (sy + dy) / 2 + turnOff
  return `M${sx},${sy} V${mid} H${dx} V${dy}`
}


// ── 45° diagonal stub for subsea cables ─────────────────────────────────────
/**
 * Subsea stubs exit from the outward-facing CORNER of the routing box
 * at 45° (or fanned around 45°). This guarantees they never overlap with
 * horizontal/vertical internal lines and are visually distinctive.
 */
function subsea45(
  cx: number, cy: number,
  centX: number, centY: number,
  pIdx: number, pTotal: number,
): { x1: number; y1: number; x2: number; y2: number; labelAngle: number } {
  const goRight = cx >= centX
  const goDown  = cy >= centY

  // Corner of the box facing outward
  const x1 = goRight ? cx + BOX_H : cx - BOX_H
  const y1 = goDown  ? cy + BOX_H : cy - BOX_H

  // Base 45° angle toward the outward quadrant
  let base: number
  if ( goRight && !goDown) base = -Math.PI / 4        // NE
  else if ( goRight &&  goDown) base =  Math.PI / 4   // SE
  else if (!goRight &&  goDown) base =  3 * Math.PI / 4  // SW
  else                          base = -3 * Math.PI / 4  // NW

  // Fan spread: ±30° around base (total 60° for many stubs)
  const spread = (Math.PI / 3) * Math.min(1, pTotal / 5)
  const t = pTotal === 1 ? 0.5 : pIdx / (pTotal - 1)
  const angle = base - spread / 2 + t * spread

  const x2 = x1 + Math.cos(angle) * STUB_LEN
  const y2 = y1 + Math.sin(angle) * STUB_LEN

  return { x1, y1, x2, y2, labelAngle: angle }
}

/** Straight H/V stub from box side for cross-country links. */
function outwardSide(cx: number, cy: number, centX: number, centY: number): Side {
  const dx = cx - centX, dy = cy - centY
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left'
  return dy >= 0 ? 'bottom' : 'top'
}

function sideStubEnd(px: number, py: number, side: Side): [number, number] {
  const L = STUB_LEN
  switch (side) {
    case 'right':  return [px + L, py]
    case 'left':   return [px - L, py]
    case 'bottom': return [px,     py + L]
    case 'top':    return [px,     py - L]
  }
}

// ── Types ────────────────────────────────────────────────────────────────────
interface Tip { title: string; lines: string[]; sx: number; sy: number }
type SelItem =
  | { kind: 'node'; node: CableNode }
  | { kind: 'seg';  seg: CableSegment; color: string }
interface RoutedEdge {
  seg: CableSegment; color: string
  /** Canonical src/dst node IDs (from first seg in group) */
  nodeA: string; nodeB: string
  sideA: Side; sideB: Side
  /** Pre-computed perpendicular port offsets */
  offA: number; offB: number
  groupLocalIdx: number; groupN: number
  /** >0 = bypass above the row; staggered per row so labels don't stack */
  bypassOff: number
  /** Stagger the source-side stub x so parallel bypass paths don't share the same vertical */
  turnOff: number
}
interface RoutedCross {
  seg: CableSegment; nodeId: string; side: Side; pIdx: number; pTotal: number
}

// ── Component ────────────────────────────────────────────────────────────────
export function CountryNodeDiagram({
  nodes, segments, systems, capacity, countryHighlight, onClose,
}: Props) {
  const t = useTheme()
  const [tip, setTip]       = useState<Tip | null>(null)
  const [selected, setSelected] = useState<SelItem | null>(null)
  const [zoom, setZoom] = useState(1)
  const [pan,  setPan]  = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const diagramRef  = useRef<HTMLDivElement>(null)
  const dragRef     = useRef<{ mx: number; my: number; px: number; py: number } | null>(null)
  const dragMoved   = useRef(false)

  // Non-passive wheel listener so we can preventDefault (stops page scroll while zooming)
  useEffect(() => {
    const el = diagramRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12
      const rect = el.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      setZoom(pz => {
        const nz = Math.min(6, Math.max(0.15, pz * factor))
        setPan(pp => ({
          x: mx - ((mx - pp.x) / pz) * nz,
          y: my - ((my - pp.y) / pz) * nz,
        }))
        return nz
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // Fit diagram to container after first render (reads SVG size from DOM)
  useEffect(() => {
    const el = diagramRef.current
    if (!el) return
    const svg = el.querySelector('svg')
    if (!svg) return
    const w = parseFloat(svg.getAttribute('width') ?? '0')
    const h = parseFloat(svg.getAttribute('height') ?? '0')
    if (!w || !h) return
    const z = Math.min(el.clientWidth / w, el.clientHeight / h) * 0.92
    setZoom(z)
    setPan({ x: (el.clientWidth - w * z) / 2, y: (el.clientHeight - h * z) / 2 })
  }, [])

  function startDrag(e: React.MouseEvent) {
    if (e.button !== 0) return
    dragRef.current = { mx: e.clientX, my: e.clientY, px: pan.x, py: pan.y }
    dragMoved.current = false
  }
  function moveDrag(e: React.MouseEvent) {
    setTip(p => p ? { ...p, sx: e.clientX, sy: e.clientY } : null)
    if (!dragRef.current) return
    const dx = e.clientX - dragRef.current.mx
    const dy = e.clientY - dragRef.current.my
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      dragMoved.current = true
      setIsDragging(true)
      setPan({ x: dragRef.current.px + dx, y: dragRef.current.py + dy })
    }
  }
  function endDrag() {
    dragRef.current = null
    setIsDragging(false)
  }
  function fitView() {
    const el = diagramRef.current
    if (!el) return
    const svg = el.querySelector('svg')
    if (!svg) return
    const w = parseFloat(svg.getAttribute('width') ?? '0')
    const h = parseFloat(svg.getAttribute('height') ?? '0')
    if (!w || !h) return
    const z = Math.min(el.clientWidth / w, el.clientHeight / h) * 0.92
    setZoom(z)
    setPan({ x: (el.clientWidth - w * z) / 2, y: (el.clientHeight - h * z) / 2 })
  }

  function clickSeg(seg: CableSegment, color: string, e: React.MouseEvent) {
    e.stopPropagation()
    setSelected(prev => prev?.kind === 'seg' && prev.seg.id === seg.id ? null : { kind: 'seg', seg, color })
  }
  function clickNode(node: CableNode, e: React.MouseEvent) {
    e.stopPropagation()
    setSelected(prev => prev?.kind === 'node' && prev.node.id === node.id ? null : { kind: 'node', node })
  }

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
  const grid      = useMemo(() => buildGrid(countryNodes, internalSegs), [countryNodes, internalSegs])

  const edgeGroups = useMemo(() => {
    const g = new Map<string, CableSegment[]>()
    for (const seg of internalSegs) {
      const key = [seg.start_node_id, seg.end_node_id].sort().join('§')
      if (!g.has(key)) g.set(key, [])
      g.get(key)!.push(seg)
    }
    return g
  }, [internalSegs])

  // Extra y-offset so stacked bypass paths on row 0 never clip above y=0
  const topExtra = useMemo(() => {
    const BYPASS_BASE_L = BOX_H + 34, BYPASS_STEP_L = 30
    const rowBypasses = new Map<number, number>()
    for (const segs of edgeGroups.values()) {
      const s0 = segs[0]
      const g1 = grid.get(s0.start_node_id), g2 = grid.get(s0.end_node_id)
      if (!g1 || !g2) continue
      if (g1[1] === g2[1] && Math.abs(g1[0] - g2[0]) >= 2) {
        const row = g1[1]
        rowBypasses.set(row, (rowBypasses.get(row) ?? 0) + 1)
      }
    }
    if (rowBypasses.size === 0) return 0
    const maxN = Math.max(...rowBypasses.values())
    const maxOff = BYPASS_BASE_L + (maxN - 1) * BYPASS_STEP_L
    const minY = PAD - BOX_H - maxOff - 24   // 24 px clearance for label above top line
    return Math.max(0, -minY + 10)
  }, [edgeGroups, grid])

  const nodePos = useMemo(() => {
    const m = new Map<string, [number, number]>()
    for (const [id, [c, r]] of grid) m.set(id, [PAD + c * GW, PAD + topExtra + r * GH])
    return m
  }, [grid, topExtra])

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
    return {
      svgW: PAD * 2 + maxC * GW,
      svgH: PAD * 2 + maxR * GH + 80 + topExtra,
    }
  }, [grid, topExtra])

  // Global grouped port assignment: groups on the same (node, side) are stacked
  // with GROUP_GAP between them so lines from different pairs never overlap.
  const routedEdges = useMemo((): RoutedEdge[] => {
    interface GrpInfo {
      segs: CableSegment[]
      nodeA: string; nodeB: string
      sideA: Side; sideB: Side
      N: number; colors: string[]
      colSpan: number   // |dc|; 0 for non-horizontal or same-col
    }
    const groups: GrpInfo[] = []
    let colorIdx = 0
    for (const segs of edgeGroups.values()) {
      const s0 = segs[0]
      const g1 = grid.get(s0.start_node_id), g2 = grid.get(s0.end_node_id)
      if (!g1 || !g2) continue
      const [sideA, sideB] = determineSides(g1[0], g1[1], g2[0], g2[1])
      const colSpan = g1[1] === g2[1] ? Math.abs(g1[0] - g2[0]) : 0
      groups.push({
        segs, nodeA: s0.start_node_id, nodeB: s0.end_node_id,
        sideA: colSpan >= 2 ? 'top' : sideA,
        sideB: colSpan >= 2 ? 'top' : sideB,
        N: segs.length,
        colors: segs.map(() => SEG_PALETTE[colorIdx++ % SEG_PALETTE.length]),
        colSpan,
      })
    }

    // For each (nodeId, side), collect which group indices use it
    const sideGroups = new Map<string, number[]>()
    groups.forEach((grp, gi) => {
      for (const k of [`${grp.nodeA}|${grp.sideA}`, `${grp.nodeB}|${grp.sideB}`]) {
        if (!sideGroups.has(k)) sideGroups.set(k, [])
        sideGroups.get(k)!.push(gi)
      }
    })

    // Compute each group's center offset within each (nodeId, side),
    // stacking groups with GROUP_GAP between them
    const groupCenters = new Map<string, Map<number, number>>()
    for (const [key, gIdxs] of sideGroups) {
      const totalSpan =
        gIdxs.reduce((s, gi) => s + (groups[gi].N - 1) * PORT_SP, 0) +
        (gIdxs.length - 1) * GROUP_GAP
      let cursor = -totalSpan / 2
      const cMap = new Map<number, number>()
      for (const gi of gIdxs) {
        const N = groups[gi].N
        cMap.set(gi, cursor + (N - 1) / 2 * PORT_SP)
        cursor += (N - 1) * PORT_SP + GROUP_GAP
      }
      groupCenters.set(key, cMap)
    }

    // Stagger bypass heights for long same-row segments so their labels don't overlap.
    // Within each grid row, sort groups by column span (shorter = lower bypass), then
    // assign incremental heights: base + k * BYPASS_STEP.
    const BYPASS_BASE = BOX_H + 34   // 68px above port centre for shortest long-hop
    const BYPASS_STEP = 30           // each additional level adds 30px
    const bypassOffMap = new Map<number, number>()  // groupIdx → bypassOff
    const rowLongGroups = new Map<number, number[]>()
    groups.forEach((grp, gi) => {
      if (grp.colSpan < 2) return
      const row = grid.get(grp.nodeA)?.[1] ?? 0
      if (!rowLongGroups.has(row)) rowLongGroups.set(row, [])
      rowLongGroups.get(row)!.push(gi)
    })
    for (const gIdxs of rowLongGroups.values()) {
      gIdxs.sort((a, b) => groups[a].colSpan - groups[b].colSpan)
      gIdxs.forEach((gi, k) => { bypassOffMap.set(gi, BYPASS_BASE + k * BYPASS_STEP) })
    }

    // Build edges with pre-computed offsets
    const result: RoutedEdge[] = []
    groups.forEach((grp, gi) => {
      const cA = groupCenters.get(`${grp.nodeA}|${grp.sideA}`)!.get(gi)!
      const cB = groupCenters.get(`${grp.nodeB}|${grp.sideB}`)!.get(gi)!
      const bypassOff = bypassOffMap.get(gi) ?? 0
      grp.segs.forEach((seg, i) => {
        const localOff = grp.N === 1 ? 0 : (i - (grp.N - 1) / 2) * PORT_SP
        result.push({
          seg, color: grp.colors[i],
          nodeA: grp.nodeA, nodeB: grp.nodeB,
          sideA: grp.sideA, sideB: grp.sideB,
          offA: cA + localOff, offB: cB + localOff,
          groupLocalIdx: i, groupN: grp.N,
          bypassOff,
          turnOff: 0,
        })
      })
    })

    // Guarantee every edge leaving the same node-face has its H→V turn at a unique x (or y),
    // TURN_SEP px apart.  We sort by (destination, within-group index) so parallel edges to the
    // same node stay adjacent, then assign sequential slots centred on zero.
    const faceMap = new Map<string, number[]>()
    result.forEach((edge, idx) => {
      const key = `${edge.nodeA}|${edge.sideA}`
      if (!faceMap.has(key)) faceMap.set(key, [])
      faceMap.get(key)!.push(idx)
    })
    for (const idxs of faceMap.values()) {
      if (idxs.length <= 1) continue
      const sorted = [...idxs].sort((a, b) => {
        const na = result[a].nodeB, nb = result[b].nodeB
        if (na < nb) return -1
        if (na > nb) return 1
        return result[a].groupLocalIdx - result[b].groupLocalIdx
      })
      const total = sorted.length
      sorted.forEach((origIdx, rank) => {
        result[origIdx].turnOff = (rank - (total - 1) / 2) * TURN_SEP
      })
    }

    // ── Global track spread ────────────────────────────────────────────────────
    // Ensure every vertical segment (H-exit) is >= TURN_SEP px from every other
    // in x, and every horizontal segment (V-exit) is >= TURN_SEP px from every
    // other in y.  Handles coincidental overlaps between different source nodes.
    //
    // Algorithm: sort all edges by current absolute turn position, forward-push
    // to enforce the minimum gap, then shift the whole cluster to preserve the
    // original mean (so lines stay centred between their endpoints).
    const hTurnX = (e: RoutedEdge): number => {
      const pA = nodePos.get(e.nodeA)!, pB = nodePos.get(e.nodeB)!
      const sx = e.sideA === 'right' ? pA[0] + BOX_H : pA[0] - BOX_H
      const dx = e.sideB === 'right' ? pB[0] + BOX_H : pB[0] - BOX_H
      return (sx + dx) / 2
    }
    const vTurnY = (e: RoutedEdge): number => {
      const pA = nodePos.get(e.nodeA)!, pB = nodePos.get(e.nodeB)!
      const sy = e.sideA === 'bottom' ? pA[1] + BOX_H : pA[1] - BOX_H
      const dy = e.sideB === 'bottom' ? pB[1] + BOX_H : pB[1] - BOX_H
      return (sy + dy) / 2
    }
    const spreadToGap = (
      idxs: number[],
      naturalFn: (e: RoutedEdge) => number,
      gap: number,
    ) => {
      if (idxs.length <= 1) return
      const items = idxs.map(i => {
        const nat = naturalFn(result[i])
        return { i, nat, abs: nat + result[i].turnOff }
      })
      items.sort((a, b) => a.abs - b.abs)
      const origMean = items.reduce((s, e) => s + e.abs, 0) / items.length
      for (let k = 1; k < items.length; k++) {
        if (items[k].abs < items[k - 1].abs + gap) items[k].abs = items[k - 1].abs + gap
      }
      const shift = origMean - items.reduce((s, e) => s + e.abs, 0) / items.length
      items.forEach(({ i, nat, abs }) => { result[i].turnOff = abs + shift - nat })
    }

    const hNonBypass = result.flatMap((e, i) =>
      (e.sideA === 'left' || e.sideA === 'right') && e.bypassOff === 0 ? [i] : [])
    // bypass paths use sideA='top' and are spread via offA/offB — no spreadToGap needed
    const vAll = result.flatMap((e, i) =>
      (e.sideA === 'top' || e.sideA === 'bottom') && e.bypassOff === 0 ? [i] : [])

    spreadToGap(hNonBypass, hTurnX, TURN_SEP)
    spreadToGap(vAll, vTurnY, TURN_SEP)

    return result
  }, [edgeGroups, grid, nodePos])

  // Group stubs by CLS for 45° fan
  const stubsByCls = useMemo(() => {
    const m = new Map<string, CableSegment[]>()
    for (const s of stubs) {
      const clsId = clsIds.has(s.start_node_id) ? s.start_node_id : s.end_node_id
      if (!m.has(clsId)) m.set(clsId, [])
      m.get(clsId)!.push(s)
    }
    return m
  }, [stubs, clsIds])

  // Cross-country stubs (H/V from side)
  const crossRouting = useMemo((): RoutedCross[] => {
    const [centX, centY] = centroid
    const byNode = new Map<string, CableSegment[]>()
    for (const seg of crossSegs) {
      const inId = countryHighlight.nodeIds.has(seg.start_node_id) ? seg.start_node_id : seg.end_node_id
      if (!byNode.has(inId)) byNode.set(inId, [])
      byNode.get(inId)!.push(seg)
    }
    const result: RoutedCross[] = []
    for (const [nodeId, segs] of byNode) {
      const p = nodePos.get(nodeId); if (!p) continue
      const side = outwardSide(p[0], p[1], centX, centY)
      segs.forEach((seg, i) =>
        result.push({ seg, nodeId, side, pIdx: i, pTotal: segs.length }))
    }
    return result
  }, [crossSegs, countryHighlight, nodePos, centroid])

  // ── Tooltip helpers ──────────────────────────────────────────────────────
  function nodeTip(n: CableNode, e: React.MouseEvent) {
    setTip({ title: n.name, sx: e.clientX, sy: e.clientY,
      lines: [TYPE_LABEL[n.type] ?? n.type, n.owner ? `Owner: ${n.owner}` : '', `ID: ${n.id}`].filter(Boolean) })
  }
  function segTip(seg: CableSegment, e: React.MouseEvent) {
    const cap = capMap[seg.id]
    setTip({ title: seg.name || seg.id, sx: e.clientX, sy: e.clientY,
      lines: [`ID: ${seg.id}`, `${seg.length_km} km · ${seg.latency.toFixed(1)} ms`,
              cap ? `${cap.available_capacity_t}/${cap.total_capacity_t} T avail` : ''].filter(Boolean) })
  }
  function stubTip(seg: CableSegment, e: React.MouseEvent) {
    const sys = systemsById[seg.system_id]
    const fId = clsIds.has(seg.start_node_id) ? seg.end_node_id : seg.start_node_id
    const f   = nodesById[fId]
    setTip({ title: sys?.name ?? seg.system_id, sx: e.clientX, sy: e.clientY,
      lines: [`ID: ${seg.id}`, f ? `→ ${f.name} (${f.country})` : '',
              `${seg.length_km} km · ${seg.latency.toFixed(1)} ms`].filter(Boolean) })
  }

  const legend = [
    { color: NODE_COLOR.landing_station, label: 'Cable Landing Station', shape: 'diamond' },
    { color: NODE_COLOR.primary_pop,     label: 'Primary PoP',           shape: 'circle'  },
    { color: NODE_COLOR.secondary_pop,   label: 'Secondary PoP',         shape: 'circle'  },
    { color: NODE_COLOR.extension_pop,   label: 'Extension PoP',         shape: 'circle'  },
    { color: SEG_PALETTE[0],             label: 'Terrestrial backhaul',   shape: 'line'    },
    { color: CROSS_COLOR,                label: 'Cross-country link',     shape: 'dashed'  },
    { color: STUB_COLOR,                 label: 'Subsea cable stub',      shape: 'arrow'   },
  ]

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(0,0,0,0.72)',
               display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        width: 'min(98vw, 1500px)', height: '94vh',
        background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 12,
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: '0 24px 64px rgba(0,0,0,0.7)',
      }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '10px 18px', borderBottom: '1px solid #e2e8f0',
                      background: '#ffffff', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 16 }}>🗺</span>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>
                {countryHighlight.countryName} — Node Diagram
              </div>
              <div style={{ fontSize: 11, color: '#6b7280' }}>
                {countryNodes.length} nodes · {internalSegs.length} backhauls · {stubs.length} subsea stubs
              </div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: '1px solid #d1d5db',
            borderRadius: 6, color: '#6b7280', cursor: 'pointer', padding: '4px 10px',
            fontSize: 13, fontFamily: 'inherit' }}>Close ✕</button>
        </div>

        {/* Diagram — zoom (scroll wheel) + pan (drag) */}
        <div
          ref={diagramRef}
          style={{ flex: 1, overflow: 'hidden', position: 'relative',
                   cursor: isDragging ? 'grabbing' : 'grab' }}
          onMouseDown={startDrag}
          onMouseMove={moveDrag}
          onMouseUp={endDrag}
          onMouseLeave={() => { endDrag(); setTip(null) }}
          onClick={() => { if (!dragMoved.current) setSelected(null) }}
        >
          {/* zoom-pan transform wrapper */}
          <div style={{
            transform: `translate(${pan.x}px,${pan.y}px) scale(${zoom})`,
            transformOrigin: '0 0',
            position: 'absolute', top: 0, left: 0,
          }}>
          <svg
            width={svgW}
            height={svgH}
            style={{ display: 'block' }}
          >
            <rect width={svgW} height={svgH} fill="#ffffff" />
            <defs>
              <marker id="ndSub" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
                <path d="M0,0 L0,6 L8,3 z" fill={STUB_COLOR} />
              </marker>
              <marker id="ndCrs" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
                <path d="M0,0 L0,6 L8,3 z" fill={CROSS_COLOR} />
              </marker>
            </defs>

            {/* ── Internal terrestrial edges ── */}
            {routedEdges.map(({ seg, color, nodeA, sideA, sideB, offA, offB, groupLocalIdx, groupN, bypassOff, turnOff }) => {
              const isForward = seg.start_node_id === nodeA
              const [srcSide, dstSide] = isForward ? [sideA, sideB] : [sideB, sideA]
              const [srcOff, dstOff]   = isForward ? [offA,  offB]  : [offB,  offA]
              const p1 = nodePos.get(seg.start_node_id), p2 = nodePos.get(seg.end_node_id)
              if (!p1 || !p2) return null
              const [sx, sy] = sidePort(p1[0], p1[1], srcSide, srcOff)
              const [dx, dy] = sidePort(p2[0], p2[1], dstSide, dstOff)
              const effTurn = isForward ? turnOff : -turnOff
              const d = orthoPath(sx, sy, dx, dy, srcSide, bypassOff, effTurn)
              const tFrac = groupN <= 1 ? 0.5 : 0.2 + (groupLocalIdx / (groupN - 1)) * 0.6
              // Label placement: each path gets a position unique to its stagger offset so
              // labels from different groups never land at the same point.
              const isHExit = srcSide === 'left' || srcSide === 'right'
              const [lx, ly] = bypassOff > 0
                ? [sx + (dx - sx) * tFrac, Math.min(sy, dy) - bypassOff + 14]
                : isHExit
                  ? [(sx + dx) / 2 + effTurn, Math.min(sy, dy) - 14]   // staggered x, above line
                  : [Math.min(sx, dx) - 16, (sy + dy) / 2 + effTurn]   // left of line, staggered y
              const isSel = selected?.kind === 'seg' && selected.seg.id === seg.id
              return (
                <g key={seg.id}>
                  {isSel && <path d={d} fill="none" stroke={color} strokeWidth={14} opacity={0.25}
                    style={{ pointerEvents: 'none' }} />}
                  <path d={d} fill="none" stroke="transparent" strokeWidth={14}
                    style={{ cursor: 'pointer' }}
                    onMouseEnter={e => segTip(seg, e)} onMouseLeave={() => setTip(null)}
                    onClick={e => clickSeg(seg, color, e)} />
                  <path d={d} fill="none" stroke={color} strokeWidth={isSel ? 5 : 2.2}
                    style={{ pointerEvents: 'none' }} />
                  <text x={lx} y={ly} fontSize={11} fontWeight="600" fill={color}
                    stroke="white" strokeWidth="3"
                    textAnchor="middle"
                    style={{ paintOrder: 'stroke fill', pointerEvents: 'none', userSelect: 'none' }}>
                    {seg.id.replace('TERRESTRIAL_', '')}
                  </text>
                </g>
              )
            })}

            {/* ── Subsea stubs — always 45° diagonal from outward box corner ── */}
            {[...stubsByCls.entries()].flatMap(([clsId, clsStubs]) => {
              const p = nodePos.get(clsId); if (!p) return []
              const [centX, centY] = centroid
              return clsStubs.map((seg, i) => {
                const { x1, y1, x2, y2, labelAngle } = subsea45(
                  p[0], p[1], centX, centY, i, clsStubs.length)
                const sysColor = countryHighlight.systemColors.get(seg.system_id) ?? STUB_COLOR
                const fId  = clsIds.has(seg.start_node_id) ? seg.end_node_id : seg.start_node_id
                const foreign = nodesById[fId]
                const destCC  = foreign?.country ?? '?'
                const goRight = Math.cos(labelAngle) >= 0
                const lx = x2 + Math.cos(labelAngle) * 6
                const ly = y2 + Math.sin(labelAngle) * 6
                const isSelSub = selected?.kind === 'seg' && selected.seg.id === seg.id
                return (
                  <g key={`${seg.id}-stub`}>
                    {isSelSub && <line x1={x1} y1={y1} x2={x2} y2={y2}
                      stroke={sysColor} strokeWidth={14} opacity={0.25}
                      style={{ pointerEvents: 'none' }} />}
                    <line x1={x1} y1={y1} x2={x2} y2={y2}
                      stroke="transparent" strokeWidth={14} style={{ cursor: 'pointer' }}
                      onMouseEnter={e => stubTip(seg, e)} onMouseLeave={() => setTip(null)}
                      onClick={e => clickSeg(seg, sysColor, e)} />
                    <line x1={x1} y1={y1} x2={x2} y2={y2}
                      stroke={sysColor} strokeWidth={isSelSub ? 5 : 2.2} strokeDasharray="5,3"
                      markerEnd="url(#ndSub)" style={{ pointerEvents: 'none' }} />
                    <text x={lx} y={ly - 4} fontSize={11} fontWeight="600" fill={sysColor}
                      stroke="white" strokeWidth="3"
                      textAnchor={goRight ? 'start' : 'end'}
                      style={{ paintOrder: 'stroke fill', pointerEvents: 'none', userSelect: 'none' }}>
                      {seg.id}
                    </text>
                    <text x={lx} y={ly + 9} fontSize={10} fill={sysColor} opacity={0.8}
                      stroke="white" strokeWidth="3"
                      textAnchor={goRight ? 'start' : 'end'}
                      style={{ paintOrder: 'stroke fill', pointerEvents: 'none', userSelect: 'none' }}>
                      → {destCC}
                    </text>
                  </g>
                )
              })
            })}

            {/* ── Cross-country stubs — H/V from side ── */}
            {crossRouting.map(({ seg, nodeId, side, pIdx, pTotal }) => {
              const p = nodePos.get(nodeId); if (!p) return null
              const [px, py] = portXY(p[0], p[1], side, pIdx, pTotal)
              const [ex, ey] = sideStubEnd(px, py, side)
              const outId = countryHighlight.nodeIds.has(seg.start_node_id)
                ? seg.end_node_id : seg.start_node_id
              const out = nodesById[outId]
              const anchor: 'start' | 'end' | 'middle' =
                side === 'left' ? 'end' : side === 'right' ? 'start' : 'middle'
              const lx = side === 'right' ? ex + 5 : side === 'left' ? ex - 5 : ex
              const ly = side === 'bottom' ? ey + 14 : side === 'top' ? ey - 12 : ey - 6
              const isSelCrs = selected?.kind === 'seg' && selected.seg.id === seg.id
              return (
                <g key={seg.id}>
                  {isSelCrs && <line x1={px} y1={py} x2={ex} y2={ey}
                    stroke={CROSS_COLOR} strokeWidth={14} opacity={0.25}
                    style={{ pointerEvents: 'none' }} />}
                  <line x1={px} y1={py} x2={ex} y2={ey}
                    stroke="transparent" strokeWidth={14} style={{ cursor: 'pointer' }}
                    onMouseEnter={e => segTip(seg, e)} onMouseLeave={() => setTip(null)}
                    onClick={e => clickSeg(seg, CROSS_COLOR, e)} />
                  <line x1={px} y1={py} x2={ex} y2={ey}
                    stroke={CROSS_COLOR} strokeWidth={isSelCrs ? 5 : 2.2} strokeDasharray="5,3"
                    markerEnd="url(#ndCrs)" style={{ pointerEvents: 'none' }} />
                  <text x={lx} y={ly} fontSize={11} fontWeight="600" fill={CROSS_COLOR}
                    stroke="white" strokeWidth="3"
                    textAnchor={anchor}
                    style={{ paintOrder: 'stroke fill', pointerEvents: 'none', userSelect: 'none' }}>
                    {seg.id}
                  </text>
                  <text x={lx} y={ly + 13} fontSize={10} fill={CROSS_COLOR} opacity={0.8}
                    stroke="white" strokeWidth="3"
                    textAnchor={anchor}
                    style={{ paintOrder: 'stroke fill', pointerEvents: 'none', userSelect: 'none' }}>
                    → {out?.country ?? '?'}
                  </text>
                </g>
              )
            })}

            {/* ── Nodes: routing box + symbol + label ── */}
            {countryNodes.map(n => {
              const pos = nodePos.get(n.id); if (!pos) return null
              const [x, y] = pos
              const col   = NODE_COLOR[n.type] ?? '#94a3b8'
              const r     = NODE_R[n.type] ?? 8
              const isCls = n.type === 'landing_station'
              return (
                <g key={n.id} style={{ cursor: 'pointer' }}
                  onMouseEnter={e => nodeTip(n, e)} onMouseLeave={() => setTip(null)}
                  onClick={e => clickNode(n, e)}>
                  {/* Opaque background — occludes any edges drawn behind this node */}
                  <rect x={x - BOX_H} y={y - BOX_H} width={BOX_H * 2} height={BOX_H * 2}
                    fill="#ffffff" stroke="none" rx={3} />
                  {/* Coloured tint + border */}
                  <rect x={x - BOX_H} y={y - BOX_H} width={BOX_H * 2} height={BOX_H * 2}
                    fill={col} fillOpacity={selected?.kind === 'node' && selected.node.id === n.id ? 0.35 : 0.15}
                    stroke={col} strokeOpacity={0.8}
                    strokeWidth={selected?.kind === 'node' && selected.node.id === n.id ? 3 : 2} rx={3} />
                  {/* Symbol */}
                  {isCls ? (
                    <rect x={x - r} y={y - r} width={r * 2} height={r * 2}
                      fill={col} stroke="#cbd5e1" strokeWidth={1.5}
                      transform={`rotate(45,${x},${y})`} />
                  ) : (
                    <circle cx={x} cy={y} r={r} fill={col} stroke={t.bgDeep} strokeWidth={1.5} />
                  )}
                  {/* ID code inside the box — never occludes egress lines */}
                  <text x={x} y={y + BOX_H - 10} fontSize={11} fontWeight="700"
                    fill={col} textAnchor="middle"
                    style={{ pointerEvents: 'none', userSelect: 'none' }}>{n.id}</text>
                </g>
              )
            })}
          </svg>
          </div>{/* end zoom-pan wrapper */}

          {/* Zoom controls */}
          <div style={{ position: 'absolute', bottom: 12, left: 12, display: 'flex',
                        flexDirection: 'column', gap: 4, zIndex: 20 }}>
            {[
              { label: '+', action: () => setZoom(z => Math.min(6, z * 1.25)) },
              { label: '⌂', action: fitView },
              { label: '−', action: () => setZoom(z => Math.max(0.15, z / 1.25)) },
            ].map(btn => (
              <button key={btn.label} onClick={e => { e.stopPropagation(); btn.action() }}
                style={{ width: 28, height: 28, border: '1px solid #d1d5db', borderRadius: 6,
                         background: '#ffffff', color: '#374151', cursor: 'pointer',
                         fontSize: 14, fontFamily: 'inherit', lineHeight: 1,
                         boxShadow: '0 1px 3px rgba(0,0,0,0.1)', display: 'flex',
                         alignItems: 'center', justifyContent: 'center' }}>
                {btn.label}
              </button>
            ))}
          </div>

          {/* Info panel — bottom right, shown on click */}
          {selected && (
            <div
              style={{
                position: 'absolute', bottom: 12, right: 12,
                width: 280, maxHeight: 320, overflowY: 'auto',
                background: '#ffffff',
                border: `1px solid ${selected.kind === 'node'
                  ? NODE_COLOR[(selected as { kind: 'node'; node: CableNode }).node.type] + '55'
                  : (selected as { kind: 'seg'; seg: CableSegment; color: string }).color + '55'}`,
                borderRadius: 10, padding: '12px 14px',
                boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
                zIndex: 100,
              }}
              onClick={e => e.stopPropagation()}
            >
              {selected.kind === 'node' ? (
                <NodeInfoPanel node={selected.node} capMap={capMap} />
              ) : (
                <SegInfoPanel
                  seg={selected.seg}
                  color={selected.color}
                  nodesById={nodesById}
                  systemsById={systemsById}
                  capMap={capMap}
                />
              )}
              <button
                onClick={() => setSelected(null)}
                style={{
                  position: 'absolute', top: 8, right: 8,
                  background: 'none', border: 'none', color: '#9ca3af',
                  cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 2,
                }}
              >✕</button>
            </div>
          )}
        </div>

        {/* Legend */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px 16px',
                      padding: '7px 18px', borderTop: '1px solid #e2e8f0',
                      background: '#ffffff', flexShrink: 0 }}>
          {legend.map(item => (
            <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              {item.shape === 'circle'  && <svg width={14} height={14}><circle cx={7} cy={7} r={5} fill={item.color} /></svg>}
              {item.shape === 'diamond' && <svg width={14} height={14}><rect x={3} y={3} width={8} height={8} fill={item.color} transform="rotate(45,7,7)" /></svg>}
              {item.shape === 'line'    && <svg width={22} height={10}><line x1={0} y1={5} x2={22} y2={5} stroke={item.color} strokeWidth={2} /></svg>}
              {item.shape === 'dashed'  && <svg width={22} height={10}><line x1={0} y1={5} x2={22} y2={5} stroke={item.color} strokeWidth={2} strokeDasharray="4,3" /></svg>}
              {item.shape === 'arrow' && (
                <svg width={24} height={10}>
                  <defs><marker id="ll" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                    <path d="M0,0 L0,6 L6,3 z" fill={item.color} />
                  </marker></defs>
                  <line x1={0} y1={5} x2={18} y2={5} stroke={item.color} strokeWidth={2}
                    strokeDasharray="4,2" markerEnd="url(#ll)" />
                </svg>
              )}
              <span style={{ fontSize: 10, color: '#6b7280' }}>{item.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Hover tooltip */}
      {tip && (
        <div style={{ position: 'fixed', left: tip.sx + 14, top: tip.sy - 8,
                      background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 7,
                      padding: '7px 11px', pointerEvents: 'none', zIndex: 9100, maxWidth: 260,
                      boxShadow: '0 4px 16px rgba(0,0,0,0.15)' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#111827', marginBottom: 4 }}>{tip.title}</div>
          {tip.lines.map((l, i) => <div key={i} style={{ fontSize: 11, color: '#6b7280', lineHeight: 1.5 }}>{l}</div>)}
        </div>
      )}
    </div>
  )
}

// ── Info panel sub-components ─────────────────────────────────────────────────

const OWNERSHIP_LABELS: Record<string, string> = {
  owned:                'Owned',
  consortium:           'Consortium',
  iru:                  'IRU',
  integrated_lit_lease: 'Int. Lit Lease',
  offnet_resell:        'Offnet Resell',
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: 6, padding: '4px 0',
                  borderTop: '1px solid #f1f5f9', alignItems: 'baseline' }}>
      <span style={{ fontSize: 9, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase',
                     letterSpacing: '0.07em' }}>{label}</span>
      <span style={{ fontSize: 11, color: '#1f2937', lineHeight: 1.4,
                     fontFamily: mono ? 'monospace' : 'inherit' }}>{value}</span>
    </div>
  )
}

function NodeInfoPanel({ node, capMap: _capMap }: { node: CableNode; capMap: Record<string, SegmentCapacity> }) {
  const col = NODE_COLOR[node.type] ?? '#94a3b8'
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, paddingRight: 20 }}>
        <span style={{ fontFamily: 'monospace', fontSize: 15, fontWeight: 800, color: col }}>{node.id}</span>
        <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                       background: col + '22', color: col, border: `1px solid ${col}44` }}>
          {TYPE_LABEL[node.type] ?? node.type}
        </span>
      </div>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 8, lineHeight: 1.3 }}>
        {node.name}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        <InfoRow label="Country"  value={node.country} />
        {node.owner        && <InfoRow label="Owner"    value={node.owner} />}
        {node.trading_name && node.trading_name !== node.owner &&
                              <InfoRow label="Trading"  value={node.trading_name} />}
        {node.city         && <InfoRow label="City"     value={node.city} />}
        {node.street_address && <InfoRow label="Address" value={node.street_address} />}
        {node.description  && <InfoRow label="Notes"   value={node.description} />}
        {node.verification_status && (
          <InfoRow label="Status" value={node.verification_status.replace('_', ' ')} />
        )}
      </div>
    </div>
  )
}

function SegInfoPanel({ seg, color, nodesById, systemsById, capMap }: {
  seg: CableSegment
  color: string
  nodesById: Record<string, CableNode>
  systemsById: Record<string, CableSystem>
  capMap: Record<string, SegmentCapacity>
}) {
  const cap = capMap[seg.id]
  const sys = systemsById[seg.system_id]
  const startNode = nodesById[seg.start_node_id]
  const endNode   = nodesById[seg.end_node_id]
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, paddingRight: 20 }}>
        <span style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 800, color }}>
          {seg.id.replace('TERRESTRIAL_', '')}
        </span>
        <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                       background: color + '22', color, border: `1px solid ${color}44`,
                       textTransform: 'uppercase' }}>
          {seg.type}
        </span>
      </div>
      {seg.name && seg.name !== seg.id && (
        <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 8 }}>{seg.name}</div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        <InfoRow label="System"  value={sys?.name ?? seg.system_id} />
        <InfoRow label="From"
          value={startNode ? `${seg.start_node_id} – ${startNode.name}` : seg.start_node_id}
          mono={!startNode} />
        <InfoRow label="To"
          value={endNode ? `${seg.end_node_id} – ${endNode.name}` : seg.end_node_id}
          mono={!endNode} />
        <InfoRow label="Length"  value={`${seg.length_km.toLocaleString()} km`} />
        <InfoRow label="Latency" value={`${seg.latency.toFixed(2)} ms`} />
        <InfoRow label="Own'ship" value={OWNERSHIP_LABELS[seg.ownership] ?? seg.ownership} />
        <InfoRow label="Avail."  value={`${(seg.reliability * 100).toFixed(2)}%`} />
        {cap && (
          <InfoRow label="Capacity"
            value={`${cap.available_capacity_t} T free / ${cap.total_capacity_t} T total`} />
        )}
        {seg.verification_status && (
          <InfoRow label="Status" value={seg.verification_status.replace('_', ' ')} />
        )}
      </div>
    </div>
  )
}
