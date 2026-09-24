/**
 * utils/editorGeo.ts — pure helpers for the Network Editor's "create segment"
 * flow: distance, sensible metric defaults, and id/name generation that
 * matches the conventions already in the dataset.
 *
 * Every value here is a SUGGESTION the user can overwrite in the form — the
 * point is that a new segment starts out with plausible numbers rather than
 * blank fields, not that these are authoritative.
 */
import type { CableNode, CableSegment, CableSystem, SegmentType } from '../types'

const EARTH_RADIUS_KM = 6371

/** Great-circle distance between two [lat, lng] points, in km. */
export function haversineKm(a: [number, number], b: [number, number]): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b[0] - a[0])
  const dLng = toRad(b[1] - a[1])
  const lat1 = toRad(a[0])
  const lat2 = toRad(b[0])
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Path length in km following a segment's waypoints (or the direct
 *  great-circle distance when it has none). */
export function pathLengthKm(start: [number, number], end: [number, number], waypoints?: [number, number][]): number {
  const pts: [number, number][] = [start, ...(waypoints ?? []), end]
  let total = 0
  for (let i = 0; i < pts.length - 1; i++) total += haversineKm(pts[i], pts[i + 1])
  return total
}

/**
 * Metric defaults derived from the existing dataset:
 *  - latency: length_km × 0.005 — this holds exactly across all 322 existing
 *    segments, wet and terrestrial alike (~200,000 km/s in fibre).
 *  - cost_weight: roughly length_km / 300, floored at 1 — a rough fit to the
 *    existing spread, which is noisy enough that this is only ever a starting
 *    point.
 *  - reliability: the median for that segment type in the current data.
 */
export function suggestSegmentDefaults(lengthKm: number, type: SegmentType): {
  latency: number; cost_weight: number; reliability: number
} {
  return {
    latency: Math.round(lengthKm * 0.005 * 1000) / 1000,
    cost_weight: Math.max(1, Math.round(lengthKm / 300)),
    reliability: type === 'wet' ? 0.9993 : 0.9998,
  }
}

/** Strip anything the backend's id validator would reject, and upper-case it
 *  (the backend normalises ids to upper case on write anyway). */
/** Keep a suggested id to the characters the backend accepts (the allow-list in
 *  backend/app/id_utils.py — letters, digits, `_`, `-` and `&`). This only ever
 *  trims a SUGGESTION, so being marginally out of date with the backend would
 *  cost the user a retype rather than corrupt anything; `&` is here because
 *  node codes carry it and a suggested segment id is built out of node ids. */
function sanitiseId(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9_&-]/g, '').slice(0, 30)
}

/**
 * Suggest a segment id in the style the dataset already uses:
 *  - wet:         {SYSTEM}-{START}-{END}   e.g. AJC-SYD-GUM, JUPITER-BU-MNL
 *  - terrestrial: TERRESTRIAL_{CC}{NN}     e.g. TERRESTRIAL_AU03
 * Falls back to a numeric suffix if the natural id is already taken.
 */
export function generateSegmentId(
  type: SegmentType,
  systemId: string,
  startNode: CableNode | undefined,
  endNode: CableNode | undefined,
  existing: CableSegment[],
): string {
  const taken = new Set(existing.map(s => s.id.toUpperCase()))
  let base: string

  if (type === 'terrestrial') {
    const cc = (startNode?.country || endNode?.country || 'XX').toUpperCase().slice(0, 2)
    const prefix = `TERRESTRIAL_${cc}`
    let maxN = 0
    for (const s of existing) {
      const m = s.id.toUpperCase().match(new RegExp(`^${prefix}(\\d+)$`))
      if (m) maxN = Math.max(maxN, parseInt(m[1], 10))
    }
    base = `${prefix}${String(maxN + 1).padStart(2, '0')}`
  } else {
    base = sanitiseId(`${systemId}-${startNode?.id ?? ''}-${endNode?.id ?? ''}`)
  }

  base = sanitiseId(base)
  if (!taken.has(base)) return base
  for (let i = 2; i < 100; i++) {
    const candidate = sanitiseId(`${base}-${i}`)
    if (!taken.has(candidate)) return candidate
  }
  return base
}

/** Suggest a segment name matching existing style: "TGA Sydney–Auckland"
 *  for wet, "Terrestrial Melbourne–Perth" for terrestrial (en dash, as used
 *  throughout the dataset). */
export function generateSegmentName(
  type: SegmentType,
  system: CableSystem | undefined,
  startNode: CableNode | undefined,
  endNode: CableNode | undefined,
): string {
  const a = startNode?.name ?? startNode?.id ?? '?'
  const b = endNode?.name ?? endNode?.id ?? '?'
  const prefix = type === 'terrestrial' ? 'Terrestrial' : (system?.id ?? system?.name ?? '')
  return `${prefix} ${a}–${b}`.trim()
}

/** Suggest an id for a brand-new node dropped on the map: a short code from
 *  the country plus a running number (e.g. AUBU1), avoiding collisions. */
export function generateNodeId(country: string, type: string, existing: CableNode[]): string {
  const taken = new Set(existing.map(n => n.id.toUpperCase()))
  const cc = (country || 'XX').toUpperCase().slice(0, 2)
  const kind = type === 'branching_unit' ? 'BU' : 'ND'
  for (let i = 1; i < 1000; i++) {
    const candidate = `${cc}${kind}${i}`
    if (!taken.has(candidate)) return candidate
  }
  return `${cc}${kind}`
}
