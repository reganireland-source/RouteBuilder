/**
 * livingWorld/oceans.ts — where a sprite is allowed to appear, and the pure
 * maths for choosing a spot.
 *
 * A whale beached in the Simpson Desert is not charming, it is a bug. There is
 * no coastline data in this app and adding some for an easter egg would be
 * absurd, so instead this is a hand-picked list of boxes that are known open
 * water. It is deliberately conservative: better to have a sprite appear in
 * only a dozen places than to have one turn up in Kazakhstan.
 *
 * LONGITUDES ARE PACIFIC-NORMALISED, i.e. the same space Leaflet is actually
 * in on this map (see mapGeometry.normalizeLng — anything west of -30° is
 * shifted by +360°, so the Americas live at 180-345 and the map runs roughly
 * -25 to 345). Spawn points therefore go straight to Leaflet with no
 * conversion, and the boxes below can be read against the map as drawn.
 *
 * Pure functions only — no React, no Leaflet. `rand` is injected everywhere so
 * the behaviour can be exercised deterministically instead of by waiting.
 */

export interface OceanRegion {
  name: string
  latMin: number
  latMax: number
  /** Pacific-normalised. See the file header. */
  lngMin: number
  lngMax: number
  /** Polar regions get icebergs and nothing else. */
  polar?: boolean
  /**
   * Multiplier on how often this region is chosen, default 1. The Southern
   * Ocean is the reason this exists: it is a 240°-wide band, and on raw area it
   * won roughly half of all spawns, which made the ICEBERG the most common
   * thing on an Asia-Pacific map. Turning it down keeps it as the polar
   * curiosity it is meant to be.
   */
  weight?: number
}

/**
 * Open water, every box checked by drawing it over satellite imagery — the only
 * honest way to do this, and it caught ten that looked perfectly reasonable as
 * numbers. Among them: "Labrador Sea" was squarely on the Greenland ice sheet,
 * the Caribbean box covered Haiti and the Dominican Republic, the Coral Sea one
 * contained the whole of New Caledonia, the Tasman reached the South Island,
 * North-West Pacific lay along the Aleutian arc, and the South Pacific's western
 * edge sat on Fiji and Tonga.
 *
 * Boxes are pulled IN from the coast rather than out to it: a sprite further
 * offshore than it strictly needs to be costs nothing, one on land costs the
 * whole illusion. Scattered specks inside the big open-ocean boxes — the Azores,
 * the Cooks, French Polynesia — are left alone deliberately: at the zoom levels
 * this map is used at they are a pixel or two, and chasing them would carve the
 * ocean into confetti for no visible gain.
 */
export const OCEAN_REGIONS: OceanRegion[] = [
  // ── Asia-Pacific, where most of this network lives ──
  { name: 'Coral Sea',            latMin: -25, latMax: -13, lngMin: 154, lngMax: 163 },
  { name: 'Tasman Sea',           latMin: -41, latMax: -31, lngMin: 153, lngMax: 167 },
  { name: 'South Pacific',        latMin: -28, latMax:  -6, lngMin: 190, lngMax: 232 },
  { name: 'North Pacific',        latMin:  17, latMax:  40, lngMin: 166, lngMax: 224 },
  { name: 'Equatorial Pacific',   latMin:  -8, latMax:   8, lngMin: 190, lngMax: 240 },
  { name: 'Philippine Sea',       latMin:  13, latMax:  27, lngMin: 129, lngMax: 141 },
  { name: 'South China Sea',      latMin:   7, latMax:  17, lngMin: 111, lngMax: 118 },
  { name: 'Sea of Japan',         latMin:  38, latMax:  42, lngMin: 132, lngMax: 136 },
  { name: 'North-West Pacific',   latMin:  42, latMax:  50, lngMin: 163, lngMax: 195 },
  // ── Indian Ocean ──
  { name: 'Bay of Bengal',        latMin:   6, latMax:  17, lngMin:  84, lngMax:  92 },
  { name: 'Arabian Sea',          latMin:   8, latMax:  19, lngMin:  60, lngMax:  70 },
  { name: 'Indian Ocean',         latMin: -34, latMax: -11, lngMin:  72, lngMax: 100 },
  { name: 'Great Australian Bight', latMin: -38, latMax: -34, lngMin: 125, lngMax: 133 },
  // ── Atlantic and Mediterranean ──
  { name: 'North Atlantic',       latMin:  27, latMax:  44, lngMin: 305, lngMax: 338 },
  { name: 'South Atlantic',       latMin: -30, latMax:  -6, lngMin: 335, lngMax: 355 },
  { name: 'Caribbean Sea',        latMin:  13, latMax:  16, lngMin: 287, lngMax: 297 },
  { name: 'Mediterranean',        latMin:  34, latMax:  37, lngMin:  17, lngMax:  23 },
  // ── Polar: icebergs only ──
  { name: 'Southern Ocean',       latMin: -58, latMax: -48, lngMin:  60, lngMax: 300, polar: true, weight: 0.35 },
  { name: 'Labrador Sea',         latMin:  56, latMax:  62, lngMin: 303, lngMax: 309, polar: true },
]

/** A rectangle in the same normalised space, as Leaflet reports map bounds. */
export interface ViewBox {
  latMin: number
  latMax: number
  lngMin: number
  lngMax: number
}

/** The overlap of a region and the view, or null when they do not touch. */
export function intersect(region: OceanRegion, view: ViewBox): ViewBox | null {
  const latMin = Math.max(region.latMin, view.latMin)
  const latMax = Math.min(region.latMax, view.latMax)
  const lngMin = Math.max(region.lngMin, view.lngMin)
  const lngMax = Math.min(region.lngMax, view.lngMax)
  if (latMin >= latMax || lngMin >= lngMax) return null
  return { latMin, latMax, lngMin, lngMax }
}

export interface SpawnPoint {
  lat: number
  /** Pacific-normalised, ready for Leaflet. */
  lng: number
  /** Which pool the sprite should come from. */
  polar: boolean
  region: string
}

/**
 * Pick a point in open water inside the current view.
 *
 * Regions are weighted by the SQUARE ROOT of their visible area, times the
 * region's own `weight`. Both halves of that are deliberate:
 *
 *   - Weighting by area at all, rather than picking a region uniformly, stops
 *     a sliver of the Coral Sea that happens to be on screen from attracting
 *     as many whales as the whole North Pacific.
 *   - Taking the square root stops the reverse. On raw area the 240°-wide
 *     Southern Ocean band took about half of every spawn, and a two-minute
 *     sample of the default view came back 47% icebergs. sqrt keeps bigger
 *     regions busier without letting one of them swallow the map.
 *
 * Returns null when no ocean is in view at all — over land, or zoomed into a
 * city — which is the signal to spawn nothing rather than to force something
 * somewhere silly.
 */
export function pickSpawnPoint(view: ViewBox, rand: () => number = Math.random): SpawnPoint | null {
  const visible: { region: OceanRegion; box: ViewBox; weight: number }[] = []
  for (const region of OCEAN_REGIONS) {
    const box = intersect(region, view)
    if (!box) continue
    const area = (box.latMax - box.latMin) * (box.lngMax - box.lngMin)
    visible.push({ region, box, weight: Math.sqrt(area) * (region.weight ?? 1) })
  }
  if (visible.length === 0) return null

  const total = visible.reduce((sum, v) => sum + v.weight, 0)
  let roll = rand() * total
  let chosen = visible[visible.length - 1]
  for (const v of visible) {
    roll -= v.weight
    if (roll <= 0) { chosen = v; break }
  }

  const { box, region } = chosen
  return {
    lat: box.latMin + rand() * (box.latMax - box.latMin),
    lng: box.lngMin + rand() * (box.lngMax - box.lngMin),
    polar: region.polar === true,
    region: region.name,
  }
}

/**
 * A heading in radians, biased towards horizontal travel. Something drifting
 * almost straight up the screen reads as a glitch rather than as a ship, so the
 * vertical component is squashed to a quarter.
 */
export function pickHeading(rand: () => number = Math.random): { dx: number; dy: number } {
  const angle = rand() * Math.PI * 2
  const dx = Math.cos(angle)
  const dy = Math.sin(angle) * 0.25
  const len = Math.hypot(dx, dy) || 1
  return { dx: dx / len, dy: dy / len }
}
