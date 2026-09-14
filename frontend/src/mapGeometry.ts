/**
 * mapGeometry.ts — shared map geometry/styling, extracted from Map.tsx so
 * EditorMapLayer.tsx (Network Editor mode) can reuse the exact same curve
 * math and node visual hierarchy without duplicating or drifting from it.
 * Pure functions/constants only — no React, no Leaflet component code.
 */

/**
 * The network is Asia-Pacific centric, so the map is centred on the Pacific.
 * Shifts any longitude < -30° (the Americas) by +360° so e.g. Los Angeles
 * (-118°) plots at 242°, to the RIGHT of Asia — lets transpacific cables
 * draw as ONE continuous polyline instead of splitting at the antimeridian.
 */
export function normalizeLng(lng: number): number {
  return lng < -30 ? lng + 360 : lng
}

/** Inverse of normalizeLng — converts a Pacific-normalised longitude (as read
 *  back from a dragged Leaflet marker, which lives in normalized map space)
 *  back to a standard signed -180..180 longitude for storage/the backend. */
export function denormalizeLng(lng: number): number {
  return lng > 180 ? lng - 360 : lng
}

/**
 * Catmull-Rom spline: interpolates `steps` points between each pair of
 * control points, producing a smooth curve that passes through every point.
 */
export function catmullRom(pts: [number, number][], steps = 12): [number, number][] {
  if (pts.length < 3) return pts
  const out: [number, number][] = []
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[Math.min(pts.length - 1, i + 2)]
    for (let s = 0; s < steps; s++) {
      const t  = s / steps
      const t2 = t * t
      const t3 = t2 * t
      out.push([
        0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2*p0[0] - 5*p1[0] + 4*p2[0] - p3[0]) * t2 + (-p0[0] + 3*p1[0] - 3*p2[0] + p3[0]) * t3),
        0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2*p0[1] - 5*p1[1] + 4*p2[1] - p3[1]) * t2 + (-p0[1] + 3*p1[1] - 3*p2[1] + p3[1]) * t3),
      ])
    }
  }
  out.push(pts[pts.length - 1])
  return out
}

/**
 * Return Leaflet Polyline positions for a segment. When waypoints are
 * provided (static ocean-routing hints) the path threads through them via
 * a Catmull-Rom spline for smooth rendering; otherwise a direct arc is drawn.
 * All longitudes are Pacific-normalised so transpacific cables render as
 * single lines without antimeridian splits.
 */
export function geoLines(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
  waypoints?: [number, number][],
): [number, number][][] {
  const nLng1 = normalizeLng(lng1)
  const nLng2 = normalizeLng(lng2)
  let d = nLng2 - nLng1
  if (d >  180) d -= 360
  if (d < -180) d += 360

  if (waypoints && waypoints.length > 0) {
    const pts: [number, number][] = [
      [lat1, nLng1],
      ...waypoints.map(([wlat, wlng]): [number, number] => [wlat, normalizeLng(wlng)]),
      [lat2, nLng1 + d],
    ]
    return [catmullRom(pts)]
  }

  return [[[lat1, nLng1], [lat2, nLng1 + d]]]
}

/**
 * Given a clicked point and an ordered list of reference points — for a segment
 * that's [startNode, ...waypoints, endNode] — return the index of the PAIR whose
 * connecting line is closest to the click. That index is also where a new
 * waypoint should be spliced into the raw waypoints array: pair 0 is
 * start→waypoints[0] (insert at 0), pair 1 is waypoints[0]→waypoints[1]
 * (insert at 1), and so on.
 *
 * Planar (lat/lng treated as XY) closest-point-on-line-segment distance. Good
 * enough for click hit-testing at the zoom levels this editor is used at, and
 * consistent with how the rest of the app already treats coordinates for
 * on-screen geometry. Expects every point already Pacific-normalised so the
 * comparison happens in the same space the map is drawn in.
 */
export function nearestSegmentIndex(click: [number, number], points: [number, number][]): number {
  let bestIdx = 0
  let bestDist = Infinity
  for (let i = 0; i < points.length - 1; i++) {
    const [ax, ay] = points[i]
    const [bx, by] = points[i + 1]
    const [px, py] = click
    const dx = bx - ax
    const dy = by - ay
    const lenSq = dx * dx + dy * dy
    let t = lenSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lenSq
    t = Math.max(0, Math.min(1, t))
    const cx = ax + t * dx
    const cy = ay + t * dy
    const dist = (px - cx) ** 2 + (py - cy) ** 2
    if (dist < bestDist) { bestDist = dist; bestIdx = i }
  }
  return bestIdx
}

// Visual hierarchy for node types: size + colour scale from most to least significant
export const NODE_STYLE: Record<string, { color: string; fill: string; radius: number; weight: number; opacity: number }> = {
  landing_station: { color: '#ea580c', fill: '#f97316', radius: 8,   weight: 2.5, opacity: 1    },
  primary_pop:     { color: '#1d4ed8', fill: '#3b82f6', radius: 7,   weight: 2,   opacity: 1    },
  secondary_pop:   { color: '#7c3aed', fill: '#a855f7', radius: 6,   weight: 1.5, opacity: 1    },
  extension_pop:   { color: '#475569', fill: '#64748b', radius: 5,   weight: 1,   opacity: 0.85 },
  branching_unit:  { color: '#92400e', fill: '#d97706', radius: 3,   weight: 1,   opacity: 0.75 },
  off_net:         { color: '#374151', fill: '#6b7280', radius: 5,   weight: 1,   opacity: 0.65 },
}

export const NODE_TYPE_LABEL: Record<string, string> = {
  landing_station: 'CLS (Landing Station)',
  primary_pop:     'Primary PoP',
  secondary_pop:   'Secondary PoP',
  extension_pop:   'Extension PoP',
  branching_unit:  'Branching Unit',
  off_net:         'Off-Net Node',
}
