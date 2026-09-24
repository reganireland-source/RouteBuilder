/**
 * ============================================================================
 *  TravelingLightLayer.tsx — "this cable is active, watch the light move."
 * ============================================================================
 *
 * A small glowing marker travels back and forth along every segment that is
 * currently "active" — selected on the map or via Asset Search, part of a
 * cable system highlighted in NetworkExplorer's SystemViewer, or part of a
 * route highlighted in RouteBuilder's results — the literal metaphor for
 * what these cables actually carry: light, moving. NetworkMap computes the
 * active set (id, its full point sequence reusing the exact geoLines()
 * output the main render loop already produces, and an accent colour) and
 * hands it down here as a prop; this layer only owns turning that into
 * moving markers.
 *
 * Same imperative, RAF-driven, own-pane pattern as LivingWorldLayer.tsx —
 * React re-renders zero times while a light crosses the Pacific. See that
 * file's own header for why this is the established way to animate a
 * Leaflet marker cheaply in this codebase. Two effects, not one: mounting
 * the pane + starting the persistent RAF loop happens once ([map] deps);
 * syncing which segments have a light, separately, whenever the active set
 * changes ([segments] deps) — so a selection change never tears down and
 * restarts the shared loop, only adds/removes the markers it drives.
 *
 * Mounted from: Map.tsx, inside MapContainer, always — cheap no-op with
 * zero markers when nothing is active. Off in Network Editor, matching
 * LivingWorldLayer/HazardLayer's own convention: that mode is for precise
 * topology work, where a moving light would be a distraction, not feedback.
 * ============================================================================
 */
import { useEffect, useRef } from 'react'
import * as L from 'leaflet'
import { useMap } from 'react-leaflet'

/** Our own pane, ABOVE the cable lines and node markers (400+) — the whole
 *  point is a light traveling ON a cable, so it must never be hidden under
 *  the line it represents (contrast LivingWorldLayer's pane at 350, which
 *  is deliberately UNDER the cables). */
const PANE_NAME = 'rb-traveling-light'
const PANE_Z = 650

/** One-way traversal duration, in ms, as a function of the segment's real
 *  length — a 50km backhaul and a 10,000km trunk should not take the same
 *  time to cross, but neither should the trunk take literal minutes.
 *  Clamped so nothing is ever an imperceptible blink or a multi-minute
 *  crawl. */
const MIN_DURATION_MS = 1100
const MAX_DURATION_MS = 3200
function durationForLength(lengthKm: number): number {
  const raw = 850 + lengthKm * 0.32
  return Math.min(MAX_DURATION_MS, Math.max(MIN_DURATION_MS, raw))
}

export interface ActiveLightSegment {
  id: string
  /** Full point sequence for the segment, already flattened across every
   *  piece geoLines() returned (usually one piece, occasionally more). */
  points: [number, number][]
  color: string
}

interface Light {
  marker: L.Marker
  points: [number, number][]
  /** Cumulative distance (km) at each point; cumKm[0] === 0. */
  cumKm: number[]
  totalKm: number
  durationMs: number
  /** A stable-but-varied per-segment start offset, so a whole highlighted
   *  system's worth of lights read as independent packets of light rather
   *  than one synchronised pulse. */
  phaseOffsetMs: number
  color: string
}

interface Props {
  segments: ActiveLightSegment[]
}

/** True when the visitor has asked the OS for less animation — mirrors
 *  LivingWorldLayer.tsx's own check exactly. */
function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

const EARTH_RADIUS_KM = 6371
function haversineKm(a: [number, number], b: [number, number]): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b[0] - a[0])
  const dLng = toRad(b[1] - a[1])
  const lat1 = toRad(a[0])
  const lat2 = toRad(b[0])
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Cheap, non-cryptographic string hash — only ever used to pick a phase
 *  offset, so a collision or a bad distribution costs nothing but two
 *  lights briefly moving in step. */
function hashOffset(id: string, durationMs: number): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  return ((Math.abs(h) % 1000) / 1000) * durationMs * 2
}

/** Position at cumulative distance `d` (km) along a cached point sequence —
 *  plain linear lat/lng interpolation between the two bracketing points,
 *  same precision tradeoff stretchLengthKm/haversineKm already make
 *  elsewhere: point spacing along a real segment (or its Catmull-Rom
 *  smoothing) is short enough that this is visually indistinguishable from
 *  a great-circle interpolation. */
function pointAt(points: [number, number][], cumKm: number[], totalKm: number, d: number): [number, number] {
  if (points.length === 1) return points[0]
  const target = Math.min(Math.max(d, 0), totalKm)
  let i = 1
  while (i < cumKm.length - 1 && cumKm[i] < target) i++
  const segStart = cumKm[i - 1]
  const segLen = cumKm[i] - segStart
  const frac = segLen > 0 ? (target - segStart) / segLen : 0
  const a = points[i - 1]
  const b = points[i]
  return [a[0] + (b[0] - a[0]) * frac, a[1] + (b[1] - a[1]) * frac]
}

function buildIcon(color: string): L.DivIcon {
  return L.divIcon({
    className: 'rb-traveling-light-icon',
    html: `<div class="rb-tl-dot" style="--rb-tl-color:${color}"></div>`,
    iconSize: [12, 12],
    iconAnchor: [6, 6],
  })
}

export function TravelingLightLayer({ segments }: Props) {
  const map = useMap()
  const lightsRef = useRef(new Map<string, Light>())
  const rafRef = useRef(0)
  const reducedRef = useRef(false)

  // ── Mount: pane + persistent RAF loop, once. ──
  useEffect(() => {
    // Captured once per mount, not re-read via the ref inside the cleanup —
    // the ref's own .current identity never changes (only its Map contents
    // do, via .set/.delete/.clear), but capturing it here is what lets the
    // cleanup below safely reference "the same Map this effect created."
    const lights = lightsRef.current
    reducedRef.current = prefersReducedMotion()
    const pane = map.createPane(PANE_NAME)
    pane.style.zIndex = String(PANE_Z)
    pane.style.pointerEvents = 'none'

    function frame(now: number) {
      rafRef.current = requestAnimationFrame(frame)
      for (const light of lights.values()) {
        const cycle = light.durationMs * 2
        const phased = (now + light.phaseOffsetMs) % cycle
        // Triangle wave — 0 -> totalKm -> 0 — not a hard snap-back at the end.
        const progress = phased < light.durationMs ? phased / light.durationMs : 2 - phased / light.durationMs
        light.marker.setLatLng(pointAt(light.points, light.cumKm, light.totalKm, progress * light.totalKm))
      }
    }

    function onVisibility() {
      if (document.hidden) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = 0
      } else if (rafRef.current === 0) {
        rafRef.current = requestAnimationFrame(frame)
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    rafRef.current = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(rafRef.current)
      document.removeEventListener('visibilitychange', onVisibility)
      for (const light of lights.values()) light.marker.remove()
      lights.clear()
      // Leaflet has no removePane — empty it and take it out of the flow, the
      // same reasoning LivingWorldLayer's own cleanup gives for this exact line.
      pane.remove()
    }
  }, [map])

  // ── Sync markers to whichever segments are currently active. ──
  useEffect(() => {
    const current = lightsRef.current
    const nextIds = new Set(segments.map(s => s.id))

    for (const [id, light] of [...current]) {
      if (!nextIds.has(id)) { light.marker.remove(); current.delete(id) }
    }

    // Reduced motion: a segment's own color/weight styling already marks it
    // "active" with no animation at all, so the honest reduced-motion
    // response is no traveling light rather than a static one standing in —
    // nothing here would be readable as "reduced," just as "different."
    if (reducedRef.current) return

    for (const seg of segments) {
      if (seg.points.length < 2) continue
      const existing = current.get(seg.id)
      if (existing) {
        // Same segment still active — only its color can have changed (e.g.
        // which system's highlight now owns it). Recolor in place rather
        // than tearing the marker down, so its current position/phase in
        // the back-and-forth travel isn't lost to a visible jump/restart.
        if (existing.color !== seg.color) {
          existing.marker.setIcon(buildIcon(seg.color))
          existing.color = seg.color
        }
        continue
      }
      let total = 0
      const cumKm = [0]
      for (let i = 1; i < seg.points.length; i++) {
        total += haversineKm(seg.points[i - 1], seg.points[i])
        cumKm.push(total)
      }
      const durationMs = durationForLength(total)
      const marker = L.marker(seg.points[0], {
        icon: buildIcon(seg.color), pane: PANE_NAME, interactive: false, keyboard: false,
      }).addTo(map)
      current.set(seg.id, {
        marker, points: seg.points, cumKm, totalKm: total,
        durationMs, phaseOffsetMs: hashOffset(seg.id, durationMs), color: seg.color,
      })
    }
  }, [segments, map])

  return <TravelingLightStyles />
}

/** Styles for the glowing dot itself, injected once with the layer. */
function TravelingLightStyles() {
  return (
    <style>{`
      .rb-traveling-light-icon { background: none; border: none; }
      .rb-tl-dot {
        width: 10px; height: 10px; border-radius: 50%;
        background: radial-gradient(circle, #fff 0%, var(--rb-tl-color) 55%, transparent 100%);
        box-shadow: 0 0 8px 3px var(--rb-tl-color), 0 0 2px 1px rgba(255,255,255,0.9);
      }
    `}</style>
  )
}
