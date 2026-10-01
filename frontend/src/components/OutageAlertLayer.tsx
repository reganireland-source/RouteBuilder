/**
 * ============================================================================
 *  OutageAlertLayer.tsx — "this cable is active, but it isn't carrying
 *  anything right now."
 * ============================================================================
 *
 * TravelingLightLayer.tsx's partner and opposite: for a segment that is both
 * currently active (selected on the map, part of a highlighted system, or
 * part of a route highlighted in RouteBuilder's results) AND has a real
 * current outage, a moving light would be a lie — nothing is actually
 * flowing down that cable. Instead this draws two flashing red × marks at
 * fixed points along the segment, deliberately NOT moving: the stillness is
 * the message ("no traffic here"), same way the light's movement was the
 * message for a healthy segment. NetworkMap computes the active+outaged set
 * (same shape as TravelingLightLayer's ActiveLightSegment — id, full point
 * sequence — see computeActiveLightSegments's own doc comment for exactly
 * how a segment ends up in this list instead of the light's) and hands it
 * down here as a prop; this layer only owns turning that into markers.
 *
 * Deliberately NOT the same "usual outage map" styling: `showAllOutages`
 * mode and the ordinary red-dashed "downed segment" line styling elsewhere
 * in Map.tsx are unchanged by this file — those already say "this segment
 * has a fault" whenever it's active, all the time, as a static line style.
 * This layer is the ADDITIONAL, harder-to-miss signal for the specific
 * moment a user has selected or highlighted that exact segment (via a map
 * click or a RouteBuilder result), replacing what would otherwise be a
 * traveling light with something that reads as "look here, this one's down."
 *
 * No RAF loop needed (contrast TravelingLightLayer/LivingWorldLayer): the
 * markers' positions never change once placed, only their opacity — a plain
 * CSS keyframe animation on the marker's DivIcon handles the flash for free,
 * so this is just an imperative add/remove-markers effect keyed on
 * `[segments, map]`, no persistent per-frame loop to mount or tear down.
 *
 * Mounted from: Map.tsx, inside MapContainer, right next to
 * TravelingLightLayer — always; cheap no-op with zero markers when nothing
 * active is currently down. Off in Network Editor, matching every other
 * decorative/feedback layer's convention there.
 * ============================================================================
 */
import { useEffect, useRef } from 'react'
import * as L from 'leaflet'
import { useMap } from 'react-leaflet'

/** Same stacking idea as TravelingLightLayer's own pane: above the cable
 *  lines and node markers so a flashing × is never hidden under the line it
 *  sits on. One above the traveling light's pane (648 vs 645) purely so
 *  that if a segment were ever (briefly, mid-transition) in both sets, the
 *  outage alert reads as the more urgent of the two. Both stay below
 *  Leaflet's own built-in tooltipPane (650) and popupPane (700): this pane
 *  used to sit at 660, ABOVE tooltipPane, so hovering an outaged/active
 *  segment drew its × marks straight over the open outage tooltip's text
 *  instead of under it — a flashing marker must never outrank the info
 *  card explaining it. */
const PANE_NAME = 'rb-outage-alert'
const PANE_Z = 648

/** Where along the segment (as a fraction of its total length, 0..1) each
 *  of the two × marks sits. Not the exact midpoint and not the endpoints —
 *  spread out so a long trunk reads as "down along its whole length," not
 *  as a single point failure, while staying clear of the node markers at
 *  either end. */
const CROSS_FRACTIONS = [1 / 3, 2 / 3] as const

export interface OutageAlertSegment {
  id: string
  /** Full point sequence for the segment, already flattened the same way
   *  TravelingLightLayer's ActiveLightSegment.points is — see that type. */
  points: [number, number][]
  /** The × marks' color — the worst service_impact across this segment's
   *  active outage(s) (see utils/outageImpact.ts's impactColor/worstImpact),
   *  computed by NetworkMap and handed down the same way
   *  ActiveLightSegment.color is. */
  color: string
}

interface Alert {
  markers: L.Marker[]
  color: string
}

interface Props {
  segments: OutageAlertSegment[]
}

/** True when the visitor has asked the OS for less animation — mirrors
 *  TravelingLightLayer.tsx's own check exactly. Unlike that layer (where
 *  reduced motion means no light at all, because the movement WAS the
 *  entire signal), the × marks still convey real information — "this
 *  active segment is down" — independent of whether they flash, so reduced
 *  motion here means "keep the marks, drop the flash," not "drop the
 *  layer": see buildIcon's `animate` param.
 */
function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

const EARTH_RADIUS_KM = 6371
/** Great-circle distance in km between two [lat, lng] points (haversine
 *  formula) — same formula TravelingLightLayer.tsx uses, duplicated locally
 *  rather than shared, matching this codebase's existing convention of each
 *  map layer owning its own small geometry helpers (see e.g. HazardLayer's
 *  and TravelingLightLayer's own copies). */
function haversineKm(a: [number, number], b: [number, number]): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b[0] - a[0])
  const dLng = toRad(b[1] - a[1])
  const lat1 = toRad(a[0])
  const lat2 = toRad(b[0])
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Position at cumulative distance `d` (km) along a point sequence — plain
 *  linear lat/lng interpolation between the two bracketing points, same
 *  precision tradeoff TravelingLightLayer's own pointAt makes. Computed
 *  once per mark here (never per-frame — these marks don't move), so this
 *  is intentionally simpler than that: no cached cumKm table, just a fresh
 *  walk each time since it only ever runs when a segment enters the set. */
function pointAtFraction(points: [number, number][], frac: number): [number, number] {
  if (points.length === 1) return points[0]
  let total = 0
  const segLens: number[] = []
  for (let i = 1; i < points.length; i++) {
    const len = haversineKm(points[i - 1], points[i])
    segLens.push(len)
    total += len
  }
  const target = Math.min(Math.max(frac, 0), 1) * total
  let covered = 0
  for (let i = 0; i < segLens.length; i++) {
    if (covered + segLens[i] >= target || i === segLens.length - 1) {
      const into = segLens[i] > 0 ? (target - covered) / segLens[i] : 0
      const a = points[i]
      const b = points[i + 1]
      return [a[0] + (b[0] - a[0]) * into, a[1] + (b[1] - a[1]) * into]
    }
    covered += segLens[i]
  }
  return points[points.length - 1]
}

/** The flashing (or, under reduced motion, static) red × marker for one
 *  outage-alert mark. `animate` is resolved once at mount from
 *  prefersReducedMotion() — see that function's own doc comment for why
 *  reduced motion keeps the mark but drops the flash rather than hiding it. */
function buildIcon(animate: boolean, color: string): L.DivIcon {
  return L.divIcon({
    className: 'rb-outage-alert-icon',
    html: `<div class="rb-oa-x${animate ? ' rb-oa-flash' : ''}" style="--rb-oa-color:${color}"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  })
}

/** Same segment still down — only its color can have changed (e.g. its
 *  worst outage was reclassified). Recolors in place rather than tearing
 *  the markers down, matching TravelingLightLayer's own in-place recolor
 *  for the same reason (no flicker/reset). Pulled out of the effect body
 *  purely to keep that (already very large) effect's own cognitive-
 *  complexity budget down. */
function recolorAlert(alert: Alert, color: string, animate: boolean): void {
  if (alert.color === color) return
  for (const m of alert.markers) m.setIcon(buildIcon(animate, color))
  alert.color = color
}

/**
 * "This active segment is down" — draws two static, flashing red × marks
 * per entry in `segments` (see `OutageAlertSegment`/the file header for how
 * NetworkMap computes that set). One effect only, keyed on `[segments,
 * map]`: mounts the pane on first run (idempotent — Leaflet's own
 * createPane no-ops if it already exists, same as TravelingLightLayer
 * relies on for its own pane) and adds/removes marker pairs to match
 * whichever segments are currently both active and down.
 */
export function OutageAlertLayer({ segments }: Props) {
  const map = useMap()
  const alertsRef = useRef(new Map<string, Alert>())

  useEffect(() => {
    const alerts = alertsRef.current
    const pane = map.createPane(PANE_NAME)
    pane.style.zIndex = String(PANE_Z)
    pane.style.pointerEvents = 'none'

    const animate = !prefersReducedMotion()
    const nextIds = new Set(segments.map(s => s.id))

    for (const [id, alert] of [...alerts]) {
      if (!nextIds.has(id)) {
        for (const m of alert.markers) m.remove()
        alerts.delete(id)
      }
    }

    for (const seg of segments) {
      if (seg.points.length < 2) continue
      const existing = alerts.get(seg.id)
      if (existing) {
        recolorAlert(existing, seg.color, animate)
        continue
      }
      const markers = CROSS_FRACTIONS.map(frac =>
        L.marker(pointAtFraction(seg.points, frac), {
          icon: buildIcon(animate, seg.color), pane: PANE_NAME, interactive: false, keyboard: false,
        }).addTo(map),
      )
      alerts.set(seg.id, { markers, color: seg.color })
    }

    return () => {
      for (const alert of alerts.values()) for (const m of alert.markers) m.remove()
      alerts.clear()
      pane.remove()
    }
  }, [segments, map])

  return <OutageAlertStyles />
}

/** Styles for the × mark itself, injected once with the layer. Drawn from
 *  two rotated CSS bars rather than a font glyph (÷/✕/×), matching
 *  TravelingLightLayer's own dot — a radial-gradient, not an image or
 *  glyph — so neither layer's marker depends on font fallback rendering
 *  consistently across platforms. */
function OutageAlertStyles() {
  return (
    <style>{`
      .rb-outage-alert-icon { background: none; border: none; }
      .rb-oa-x { position: relative; width: 16px; height: 16px; }
      .rb-oa-x::before, .rb-oa-x::after {
        content: '';
        position: absolute; top: 50%; left: 50%;
        width: 17px; height: 3px; margin-top: -1.5px; margin-left: -8.5px;
        background: var(--rb-oa-color);
        border-radius: 1.5px;
        box-shadow: 0 0 6px 1px var(--rb-oa-color), 0 0 2px rgba(255,255,255,0.85);
      }
      .rb-oa-x::before { transform: rotate(45deg); }
      .rb-oa-x::after { transform: rotate(-45deg); }
      .rb-oa-x.rb-oa-flash { animation: rb-oa-flash 1000ms ease-in-out infinite; }
      @keyframes rb-oa-flash {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.2; }
      }
    `}</style>
  )
}
