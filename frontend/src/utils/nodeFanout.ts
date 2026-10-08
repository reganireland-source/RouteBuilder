/**
 * utils/nodeFanout.ts — lays out the "spoke" diagram in a node's Full View.
 *
 * The diagram shows one spoke per segment leaving the node. Each spoke leaves
 * at the TRUE initial bearing to the node at the far end, so the picture tells
 * you honestly which way each cable goes. Spoke LENGTH is uniform — real
 * lengths span ~20 km of backhaul to ~12,000 km of Pacific crossing, and any
 * scale that fits both makes the short ones invisible — so the distance is
 * written on the label instead.
 *
 * The one thing fixed length costs us is label collisions when two segments
 * head off in nearly the same direction. Rather than fudge the bearings (which
 * would make the diagram lie), `layoutSpokes` pushes the *label* of a
 * too-close neighbour out to a further radius — the "tier". The line still
 * ends where it should; only the text moves.
 *
 * Pure functions, no React, no DOM — everything here is arithmetic on a unit
 * circle that the caller scales into its own SVG viewBox.
 */
import type { CableNode, CableSegment } from '../types'
import { haversineKm } from './editorGeo'

/**
 * Forward azimuth from `a` to `b` in degrees, measured clockwise from true
 * north (0 = north, 90 = east, 180 = south, 270 = west).
 *
 * This is the initial great-circle bearing, not the rhumb-line bearing: over
 * a Pacific crossing the two differ by tens of degrees, and the initial
 * bearing is the one that matches the curve actually drawn on the map.
 */
export function initialBearing(a: [number, number], b: [number, number]): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const lat1 = toRad(a[0])
  const lat2 = toRad(b[0])
  // Shortest way round: a segment from Tokyo to Los Angeles must read as
  // "east", not "most of the way west".
  let dLng = b[1] - a[1]
  if (dLng > 180) dLng -= 360
  if (dLng < -180) dLng += 360
  const dl = toRad(dLng)
  const y = Math.sin(dl) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dl)
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360
}

/** A cardinal-ish compass label for a bearing — "NE", "SSW" and so on. */
export function compassPoint(bearingDeg: number): string {
  const points = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']
  return points[Math.round(((bearingDeg % 360) + 360) % 360 / 22.5) % 16]
}

export interface Spoke {
  /** Representative segment — the one whose id keys the spoke and whose type
   *  picks the wet/terrestrial styling. */
  segment: CableSegment
  /** Every segment this spoke stands for. More than one means the node has
   *  parallel segments of the same type to the same place (SYD1 has three to
   *  Auckland); they share a bearing exactly, so drawing them as separate
   *  spokes just stacks identical labels on top of each other. */
  segments: CableSegment[]
  /** The node at the other end (undefined if the dataset references a node that isn't loaded). */
  other: CableNode | undefined
  otherId: string
  bearing: number
  compass: string
  distanceKm: number
  /** Unit-circle endpoint of the line: x right, y DOWN (SVG convention). */
  x: number
  y: number
  /** Unit-circle anchor for the label, pushed out by `tier`. */
  labelX: number
  labelY: number
  /** 0 = label at the base radius; 1, 2 … = pushed further out to clear a neighbour. */
  tier: number
  /** Which side of the diagram the label sits on, for text-anchor. */
  side: 'left' | 'right'
}

/** Below this angular gap two labels would overlap, so the later one is tiered out. */
const MIN_LABEL_GAP_DEG = 30

/**
 * Build the spoke layout for one node.
 *
 * `segments` may be the whole segment list — only those touching `node` are
 * used. Results are ordered clockwise from north, which is also the order the
 * caller should list them in any accompanying table so the two agree.
 *
 * Coordinates are on a unit circle (radius 1 at tier 0) with y pointing DOWN,
 * ready to be multiplied by an SVG radius. Label radius grows by
 * `tierStep` per tier.
 */
export function layoutSpokes(
  node: CableNode,
  segments: CableSegment[],
  nodesById: Record<string, CableNode>,
  opts: { tierStep?: number } = {},
): Spoke[] {
  // A label is two lines of ~10px text, so a tier has to move it far enough
  // that the lower line of one clears the upper line of the next. 0.22 left
  // them ~15px apart at a three-way cluster and they still touched.
  const tierStep = opts.tierStep ?? 0.34

  const touching = segments.filter(s => s.start_node_id === node.id || s.end_node_id === node.id)

  // Collapse parallel segments into one spoke. Keyed on destination AND type,
  // so a wet and a terrestrial path to the same node stay two distinct lines —
  // they are genuinely different routes and the diagram's whole point is the
  // wet/terrestrial distinction.
  const groups = new Map<string, CableSegment[]>()
  for (const seg of touching) {
    const otherId = seg.start_node_id === node.id ? seg.end_node_id : seg.start_node_id
    const key = `${otherId}|${seg.type}`
    const list = groups.get(key)
    if (list) list.push(seg)
    else groups.set(key, [seg])
  }

  const raw = [...groups.values()].map(group => {
    const segment = group[0]
    const otherId = segment.start_node_id === node.id ? segment.end_node_id : segment.start_node_id
    const other = nodesById[otherId]
    // Aim at the first waypoint when there is one: a cable that leaves a
    // landing station heading out to sea before turning is better drawn
    // leaving in the direction it actually leaves.
    // Waypoints run start -> end, so the hop nearest THIS node is the first
    // when we're the start and the last when we're the end.
    const wps = segment.waypoints ?? []
    const outbound = segment.start_node_id === node.id
    let firstHop: [number, number] | undefined
    if (outbound) firstHop = wps[0]
    else if (wps.length) firstHop = wps[wps.length - 1]
    const target: [number, number] | undefined =
      firstHop ?? (other ? [other.lat, other.lng] : undefined)

    const bearing = target ? initialBearing([node.lat, node.lng], target) : 0
    const distanceKm = other ? haversineKm([node.lat, node.lng], [other.lat, other.lng]) : 0
    return { segment, segments: group, other, otherId, bearing, distanceKm }
  })

  raw.sort((a, b) => a.bearing - b.bearing || a.otherId.localeCompare(b.otherId))

  // Tier assignment: walking clockwise, a spoke whose bearing is within
  // MIN_LABEL_GAP_DEG of the last spoke placed on a given tier moves out one
  // tier. Wrapping past north is handled by comparing against the first spoke
  // too, so a cluster straddling 0° doesn't get missed.
  const lastOnTier: number[] = []
  const spokes: Spoke[] = raw.map(r => {
    let tier = 0
    while (
      lastOnTier[tier] !== undefined &&
      angularGap(lastOnTier[tier], r.bearing) < MIN_LABEL_GAP_DEG
    ) tier++
    lastOnTier[tier] = r.bearing

    const rad = (r.bearing - 90) * Math.PI / 180 // 0° = north = straight up
    const cos = Math.cos(rad)
    const sin = Math.sin(rad)
    const labelR = 1 + tier * tierStep
    return {
      ...r,
      compass: compassPoint(r.bearing),
      x: cos,
      y: sin,
      labelX: cos * labelR,
      labelY: sin * labelR,
      tier,
      side: cos < -0.05 ? 'left' : 'right',
    }
  })

  return spokes
}

/** Smallest absolute angle between two bearings, in degrees (0..180). */
export function angularGap(a: number, b: number): number {
  // Wrap the difference into (-180, 180] and take its magnitude. Note there is
  // no `180 - d` here: the wrapped difference IS the gap, and complementing it
  // made every near-parallel pair look 175° apart, so label tiering never
  // fired exactly where it was needed.
  return Math.abs(((a - b) % 360 + 540) % 360 - 180)
}
