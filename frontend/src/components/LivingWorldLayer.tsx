/**
 * ============================================================================
 *  LivingWorldLayer.tsx — "Living World": the map is not empty.
 * ============================================================================
 *
 * Every so often a 16-bit container ship crosses the Coral Sea, a whale surfaces
 * off Guam, or — if you are very patient — something with tentacles comes up in
 * the middle of the Pacific. That is the entire feature. It is on by default and
 * switched off from the Controls menu.
 *
 * The rules it plays by, in order of how much they matter:
 *
 * 1. IT NEVER GETS IN THE WAY. The sprites live in their OWN Leaflet pane at
 *    z-index 350 — above the basemap tiles (200), below the cable lines and
 *    node markers (400+). So a whale can never cover a cable, and the pane has
 *    `pointer-events: none`, so it can never eat a click meant for a node. If
 *    you ignore this feature completely it costs you nothing.
 *
 * 2. IT NEVER LANDS ON LAND. Spawn points come from a hand-picked list of open
 *    water (livingWorld/oceans.ts), intersected with what is actually on screen
 *    and weighted by visible area. No ocean in view — over land, or zoomed into
 *    a city — means nothing spawns, rather than something spawning somewhere
 *    silly.
 *
 * 3. IT NEVER SITS ON YOUR DATA. A candidate point is rejected if it lands
 *    within MIN_NODE_GAP_PX of a node, so a cargo ship never parks on top of
 *    the landing station you are reading.
 *
 * 4. IT IS CHEAP. Markers are created and moved imperatively through the
 *    Leaflet API on a requestAnimationFrame loop — React re-renders exactly
 *    zero times while a whale swims across the Pacific. The whole population is
 *    capped at MAX_POPULATION, and the loop stops dead when the tab is hidden
 *    or the feature is switched off.
 *
 * 5. IT RESPECTS `prefers-reduced-motion`. Under that setting sprites still
 *    appear and fade, but they do not drift and they do not bob. The joke
 *    survives; the movement does not.
 *
 * Drift is measured in PIXELS per second, not degrees: a ship crossing the
 * screen should look the same speed whether you are zoomed out to the whole
 * Pacific or in on the Tasman. Each step therefore projects the sprite's
 * lat/lng to the current zoom's pixel space, moves it, and unprojects.
 *
 * Mounted from: Map.tsx, inside MapContainer, when `livingWorld` is on.
 * ============================================================================
 */
import { useEffect, useRef } from 'react'
import * as L from 'leaflet'
import { useMap } from 'react-leaflet'
import type { CableNode } from '../types'
import { pickSprite, spriteSvg, spriteWidth, spriteHeight, type Sprite } from '../livingWorld/sprites'
import { pickSpawnPoint, pickHeading, type ViewBox } from '../livingWorld/oceans'

/** Our own pane, between the tiles (200) and the cables/nodes (400+). */
const PANE_NAME = 'rb-living-world'
const PANE_Z = 350

/** How many sprites may be alive at once. Deliberately small — this is meant to
 *  be noticed occasionally, not to turn the Pacific into a shipping lane. */
const MAX_POPULATION = 4
/** Gap between successful spawns. Long enough that the ocean stays mostly
 *  empty — with MAX_POPULATION this fills up over about twenty seconds. */
const SPAWN_INTERVAL_MS = 5000
/** Wait after a spawn attempt that found nowhere to put anything. Without its
 *  own (much shorter) interval a failed attempt either retried on every single
 *  frame or stalled the ocean for a full SPAWN_INTERVAL_MS. */
const SPAWN_RETRY_MS = 1200
/** Delay before the first attempt, so the map has settled and the sprite does
 *  not pop in while tiles are still loading. */
const FIRST_SPAWN_DELAY_MS = 1500
/** How long a sprite lives before it fades out, in ms. */
const LIFETIME_MIN_MS = 26000
const LIFETIME_MAX_MS = 60000
const FADE_IN_MS = 2200
const FADE_OUT_MS = 3200
/** Peak opacity. Low on purpose: this sits under a working tool. */
const PEAK_OPACITY = 0.78
/** A spawn is rejected if a node is within this many pixels of it. */
const MIN_NODE_GAP_PX = 44
/** …and if another sprite is this close, so a whale never surfaces under a
 *  yacht. Larger than the node gap because two sprites are both ~32px wide. */
const MIN_SPRITE_GAP_PX = 70
/**
 * Zoomed in past this, nothing spawns. At street level you are looking at a
 * building, and a container ship parked next to it is no longer a joke.
 */
const MAX_SPAWN_ZOOM = 7

/** One currently-alive sprite's full runtime state — its Leaflet marker and
 *  DOM element, current position, heading, and lifecycle timestamps. Lives
 *  entirely inside the effect below (never in React state), since every
 *  field changes every animation frame and would be far too expensive to
 *  push through React's render cycle. */
interface Creature {
  marker: L.Marker
  el: HTMLElement
  sprite: Sprite
  lat: number
  lng: number
  /** Unit heading in screen space. */
  dx: number
  dy: number
  bornAt: number
  diesAt: number
  /** Cached so the transform can be rebuilt without re-reading the DOM. */
  flipped: boolean
}

interface Props {
  nodes: CableNode[]
}

/**
 * How long one sprite lives, in ms.
 *
 * eslint-disable below is deliberate: `sonarjs/pseudo-random` guards against
 * Math.random in places where predictability matters. This decides how long a
 * cartoon whale stays on screen. There is no secret here, nothing downstream
 * depends on it being unguessable, and spending real entropy on it would be a
 * stranger choice than using Math.random.
 */
// eslint-disable-next-line sonarjs/pseudo-random -- decorative only; see above
const randomLifetimeMs = () => LIFETIME_MIN_MS + Math.random() * (LIFETIME_MAX_MS - LIFETIME_MIN_MS)

/** True when the visitor has asked the OS for less animation. */
function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** The current view as the plain box oceans.ts works in. */
function viewBoxOf(map: L.Map): ViewBox {
  const b = map.getBounds()
  return {
    latMin: b.getSouth(), latMax: b.getNorth(),
    lngMin: b.getWest(), lngMax: b.getEast(),
  }
}

/** Screen-space distance from `point` to the nearest node in view, in pixels.
 *  Infinity when there are no nodes on screen to be near. */
function nearestNodePx(map: L.Map, lat: number, lng: number, nodes: CableNode[]): number {
  const view = viewBoxOf(map)
  const here = map.latLngToContainerPoint([lat, lng])
  let best = Infinity
  for (const n of nodes) {
    // Cheap lat/lng reject first: projecting all 230 nodes on every spawn
    // attempt would be wasteful when most of them are off screen.
    const nLng = n.lng < -30 ? n.lng + 360 : n.lng
    if (n.lat < view.latMin || n.lat > view.latMax) continue
    if (nLng < view.lngMin || nLng > view.lngMax) continue
    const p = map.latLngToContainerPoint([n.lat, nLng])
    const d = here.distanceTo(p)
    if (d < best) best = d
  }
  return best
}

/** Screen-space distance to the nearest sprite already out there, in pixels. */
function nearestCreaturePx(map: L.Map, lat: number, lng: number, creatures: Creature[]): number {
  const here = map.latLngToContainerPoint([lat, lng])
  let best = Infinity
  for (const c of creatures) {
    const d = here.distanceTo(map.latLngToContainerPoint([c.lat, c.lng]))
    if (d < best) best = d
  }
  return best
}

/** The marker's inner element, styled and ready to be faded/flipped. */
function buildIcon(sprite: Sprite, bob: boolean): L.DivIcon {
  const w = spriteWidth(sprite) * sprite.scale
  const h = spriteHeight(sprite) * sprite.scale
  // The bob is on an INNER element so the outer one owns the flip transform
  // and the two never fight over the same property.
  const anim = bob ? `animation: rb-lw-bob ${2.4 + (sprite.id.length % 3) * 0.4}s ease-in-out infinite;` : ''
  return L.divIcon({
    className: 'rb-living-world-icon',
    html: `<div class="rb-lw-outer" style="width:${w}px;height:${h}px;opacity:0;">`
      + `<div class="rb-lw-inner" style="${anim}">${spriteSvg(sprite, sprite.scale)}</div>`
      + '</div>',
    iconSize: [w, h],
    iconAnchor: [w / 2, h / 2],
  })
}

/** Opacity for a sprite's age: fade in, hold, fade out. */
function opacityAt(now: number, c: Creature): number {
  const age = now - c.bornAt
  if (age < FADE_IN_MS) return (age / FADE_IN_MS) * PEAK_OPACITY
  const remaining = c.diesAt - now
  if (remaining < FADE_OUT_MS) return Math.max(0, remaining / FADE_OUT_MS) * PEAK_OPACITY
  return PEAK_OPACITY
}

/**
 * The "Living World" easter egg — see the file header for the full rules.
 * Runs its own imperative spawn/animate/despawn loop entirely inside a
 * single mount-time effect (no React re-renders on every frame); `nodes` is
 * only read to keep sprites off the network's markers and is held in a ref
 * so a data refresh doesn't restart the whole population. Renders only
 * `LivingWorldStyles` — every visible sprite is a Leaflet marker created and
 * moved directly through the Leaflet API, not JSX.
 */
export function LivingWorldLayer({ nodes }: Props) {
  const map = useMap()
  // Nodes change whenever reference data refetches. Held in a ref rather than
  // an effect dependency so a data refresh does not wipe the ocean and start
  // the population over — only the spawn test reads them, and it reads them at
  // spawn time, not at render time.
  const nodesRef = useRef(nodes)
  useEffect(() => { nodesRef.current = nodes }, [nodes])

  useEffect(() => {
    const reduced = prefersReducedMotion()

    // ── Pane ──
    const pane = map.createPane(PANE_NAME)
    pane.style.zIndex = String(PANE_Z)
    pane.style.pointerEvents = 'none'

    const creatures: Creature[] = []
    // Absolute timestamp, not an elapsed counter: `performance.now()` is already
    // some thousands of ms into the page by the time this mounts, so starting a
    // "last spawn" counter at 0 silently delayed the first sighting by a whole
    // interval.
    let nextSpawnAt = performance.now() + FIRST_SPAWN_DELAY_MS
    let lastFrame = performance.now()
    let raf = 0

    /** Removes one creature's marker from the map and the tracked list. */
    function despawn(c: Creature) {
      c.marker.remove()
      const i = creatures.indexOf(c)
      if (i >= 0) creatures.splice(i, 1)
    }

    /** Returns true when something was actually placed. */
    function trySpawn(now: number): boolean {
      if (map.getZoom() > MAX_SPAWN_ZOOM) return false

      const point = pickSpawnPoint(viewBoxOf(map))
      if (!point) return false
      if (nearestNodePx(map, point.lat, point.lng, nodesRef.current) < MIN_NODE_GAP_PX) return false
      if (nearestCreaturePx(map, point.lat, point.lng, creatures) < MIN_SPRITE_GAP_PX) return false

      const sprite = pickSprite(point.polar ? 'polar' : 'open')
      const heading = pickHeading()
      const marker = L.marker([point.lat, point.lng], {
        icon: buildIcon(sprite, !reduced),
        pane: PANE_NAME,
        interactive: false,
        keyboard: false,
      }).addTo(map)

      const el = marker.getElement()?.querySelector<HTMLElement>('.rb-lw-outer')
      if (!el) { marker.remove(); return false }
      // Useful when someone asks "what was that?" and it has already gone.
      el.setAttribute('aria-hidden', 'true')
      el.dataset.creature = sprite.label

      creatures.push({
        marker, el, sprite,
        lat: point.lat, lng: point.lng,
        dx: heading.dx, dy: heading.dy,
        bornAt: now,
        diesAt: now + randomLifetimeMs(),
        flipped: heading.dx < 0,
      })
      return true
    }

    /** Advances one creature by `dtSeconds`, moving it in pixel space at the
     *  current zoom (see the file header's note on why drift is measured in
     *  pixels, not degrees) and writing the result back as lat/lng. No-op
     *  under reduced motion or for a sprite with zero speed. */
    function step(c: Creature, dtSeconds: number) {
      if (reduced || c.sprite.speed === 0) return
      const zoom = map.getZoom()
      const p = map.project([c.lat, c.lng], zoom)
      p.x += c.dx * c.sprite.speed * dtSeconds
      p.y += c.dy * c.sprite.speed * dtSeconds
      const next = map.unproject(p, zoom)
      c.lat = next.lat
      c.lng = next.lng
      c.marker.setLatLng(next)
    }

    /** The animation-frame tick: maybe spawns a new creature, steps and
     *  fades every alive one, and despawns anything expired or drifted off
     *  the current view. Reschedules itself via requestAnimationFrame. */
    function frame(now: number) {
      raf = requestAnimationFrame(frame)
      const dt = Math.min((now - lastFrame) / 1000, 0.25) // clamp: tab was hidden
      lastFrame = now

      if (now >= nextSpawnAt && creatures.length < MAX_POPULATION) {
        nextSpawnAt = now + (trySpawn(now) ? SPAWN_INTERVAL_MS : SPAWN_RETRY_MS)
      }

      const view = viewBoxOf(map)
      for (const c of [...creatures]) {
        if (now >= c.diesAt) { despawn(c); continue }
        step(c, dt)
        // Gone off the edge of the world (or of the window) — retire it early
        // so the population budget goes to something you can actually see.
        if (c.lat < view.latMin - 5 || c.lat > view.latMax + 5
          || c.lng < view.lngMin - 10 || c.lng > view.lngMax + 10) {
          despawn(c)
          continue
        }
        c.el.style.opacity = String(opacityAt(now, c))
        c.el.style.transform = c.flipped ? 'scaleX(-1)' : ''
      }
    }

    // Nothing should run while the tab is in the background: a hidden tab
    // animating a kraken is pure battery drain.
    function onVisibility() {
      if (document.hidden) {
        cancelAnimationFrame(raf)
        raf = 0
      } else if (raf === 0) {
        lastFrame = performance.now()
        raf = requestAnimationFrame(frame)
      }
    }
    document.addEventListener('visibilitychange', onVisibility)

    raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('visibilitychange', onVisibility)
      for (const c of [...creatures]) c.marker.remove()
      creatures.length = 0
      // Leaflet has no removePane, so empty it and take it out of the flow —
      // a stale empty pane would otherwise sit in the DOM until the map itself
      // is torn down, and the toggle can be flipped many times in a session.
      pane.remove()
    }
  }, [map])

  return <LivingWorldStyles />
}

/** Keyframes and base rules for the sprites, injected once with the layer. */
function LivingWorldStyles() {
  return (
    <style>{`
      .rb-living-world-icon { background: none; border: none; }
      .rb-lw-outer {
        transition: opacity 240ms linear;
        will-change: opacity, transform;
      }
      @keyframes rb-lw-bob {
        0%, 100% { transform: translateY(0); }
        50%      { transform: translateY(-2px); }
      }
      @media (prefers-reduced-motion: reduce) {
        .rb-lw-inner { animation: none !important; }
      }
    `}</style>
  )
}
