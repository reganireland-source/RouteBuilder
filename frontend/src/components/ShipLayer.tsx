/**
 * ============================================================================
 *  ShipLayer.tsx — tracked cable repair ships on the map.
 * ============================================================================
 *
 * Draws every ShipTracker ship that has a live AIS fix at its current
 * position: the ship's pixel-art sprite, its name, and a heading vector — an
 * arrow pointing where the ship is going, whose length scales with speed over
 * ground, so a ship steaming at 12 kn toward a fault reads differently at a
 * glance from one drifting on station.
 *
 * HEADING SOURCE: TrueHeading (the gyro — where the bow points) when AIS
 * reports it, else course over ground.
 *   - Under way (≥ MOORED_KN, fix not stale): a solid arrow, length by speed.
 *   - Stopped or stale, but TrueHeading known: a short hollow "bow" pointer —
 *     the gyro is still right about which way the ship faces when moored or
 *     on station, it just isn't going anywhere.
 *   - Stopped or stale with only COG: no arrow. COG is noise for a ship that
 *     isn't moving and would spin randomly between refreshes.
 *
 * THE SPRITE IS NEVER ROTATED. Rotating pixel art by arbitrary angles smears
 * it; instead it is mirrored to face left when heading westward, and the
 * arrow carries the exact bearing.
 *
 * Own pane at 620 — above node markers (600) and hazards (450): a ship is a
 * moving asset someone is actively watching, and it must not hide under a
 * landing station it is sailing toward. Ships with no live fix are simply not
 * drawn (ShipTrackerDialog says "No live signal yet" for those).
 *
 * Mounted from: Map.tsx, inside MapContainer, when the ships toggle is on.
 * ============================================================================
 */
import { useEffect } from 'react'
import * as L from 'leaflet'
import { useMap } from 'react-leaflet'
import type { TrackedShip } from '../types'
import { shipFixAge } from '../utils/shipFixAge'
import { flagFromMmsi } from '../utils/mmsiFlag'

const PANE_NAME = 'rb-ships'
const PANE_Z = 620
const MOORED_KN = 0.5
const ARROW_MIN_PX = 16
const ARROW_PX_PER_KN = 2.5
const ARROW_MAX_PX = 60
const SPRITE_W = 40
const SPRITE_H = 25
const ARROW_COLOR = '#ffd84d'
// Bow pointer for a stopped ship: just clear of the sprite (half its width + a little).
const BOW_PX = 30

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}

export interface ShipHeading {
  bearing: number
  /** Under way: draw a speed-scaled arrow. Otherwise a short bow pointer. */
  moving: boolean
}

export function shipBearing(ship: TrackedShip): ShipHeading | null {
  const live = ship.live
  if (!live) return null
  // A course from hours ago says nothing about where the ship is going now.
  const stale = !!shipFixAge(live)?.stale
  const stopped = live.sog != null && live.sog < MOORED_KN
  if (stale || stopped) {
    return live.true_heading != null ? { bearing: live.true_heading, moving: false } : null
  }
  const bearing = live.true_heading ?? live.cog
  return bearing != null ? { bearing, moving: true } : null
}

/** Short hollow pointer off the bow: which way a stopped ship faces. */
function bowSvg(bearing: number): string {
  const size = 2 * (BOW_PX + 10)
  const c = size / 2
  const tipY = c - BOW_PX
  return `
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="position:absolute;left:${-c}px;top:${-c}px;pointer-events:none;overflow:visible">
      <g transform="rotate(${bearing} ${c} ${c})">
        <path d="M ${c} ${tipY} L ${c - 6} ${tipY + 10} L ${c + 6} ${tipY + 10} Z" fill="none" stroke="#000" stroke-opacity="0.6" stroke-width="4" stroke-linejoin="round"/>
        <path d="M ${c} ${tipY} L ${c - 6} ${tipY + 10} L ${c + 6} ${tipY + 10} Z" fill="none" stroke="${ARROW_COLOR}" stroke-width="2" stroke-linejoin="round"/>
      </g>
    </svg>`
}

function arrowSvg(bearing: number, sog: number | null): { svg: string; size: number } {
  const len = Math.min(ARROW_MAX_PX, ARROW_MIN_PX + (sog ?? 0) * ARROW_PX_PER_KN)
  const size = Math.ceil(len * 2 + 12)
  const c = size / 2
  // Drawn pointing north (up), then rotated about the centre to the bearing —
  // compass bearings are clockwise from north, which is exactly CSS/SVG rotate.
  const tipY = c - len
  const svg = `
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="position:absolute;left:${-c}px;top:${-c}px;pointer-events:none;overflow:visible">
      <g transform="rotate(${bearing} ${c} ${c})">
        <line x1="${c}" y1="${c}" x2="${c}" y2="${tipY + 6}" stroke="#000" stroke-opacity="0.55" stroke-width="5" stroke-linecap="round"/>
        <line x1="${c}" y1="${c}" x2="${c}" y2="${tipY + 6}" stroke="${ARROW_COLOR}" stroke-width="2.5" stroke-linecap="round"/>
        <path d="M ${c} ${tipY} L ${c - 6} ${tipY + 10} L ${c + 6} ${tipY + 10} Z" fill="${ARROW_COLOR}" stroke="#000" stroke-opacity="0.55" stroke-width="1.2"/>
      </g>
    </svg>`
  return { svg, size }
}

function buildIcon(ship: TrackedShip): L.DivIcon {
  const heading = shipBearing(ship)
  const bearing = heading?.bearing ?? null
  const age = shipFixAge(ship.live)
  const stale = !!age?.stale
  const flag = flagFromMmsi(ship.mmsi)
  const label = (flag ? `${flag.emoji} ` : '') + escapeHtml(ship.name) + (stale && age ? ` · ${escapeHtml(age.label)}` : '')
  const faceLeft = bearing != null && bearing > 180 && bearing < 360
  let arrow = ''
  if (heading) arrow = heading.moving ? arrowSvg(heading.bearing, ship.live?.sog ?? null).svg : bowSvg(heading.bearing)
  const sprite = `/ships/${encodeURIComponent(ship.sprite || 'generic')}.png`
  const html = `
    <div class="rb-ship-marker" style="position:relative;width:0;height:0;opacity:${stale ? 0.55 : 1}">
      ${arrow}
      <img src="${sprite}" onerror="this.onerror=null;this.src='/ships/generic.png'" alt=""
        width="${SPRITE_W}" height="${SPRITE_H}"
        style="position:absolute;left:${-SPRITE_W / 2}px;top:${-SPRITE_H / 2}px;image-rendering:pixelated;
               transform:${faceLeft ? 'scaleX(-1)' : 'none'};filter:drop-shadow(0 1px 2px rgba(0,0,0,0.7))" />
      <div style="position:absolute;left:0;top:${SPRITE_H / 2 + 2}px;transform:translateX(-50%);
                  white-space:nowrap;font:700 11px system-ui,sans-serif;color:#fff;
                  text-shadow:0 0 3px #000,0 0 3px #000,0 1px 2px #000">${label}</div>
    </div>`
  return L.divIcon({ html, className: '', iconSize: [0, 0], iconAnchor: [0, 0] })
}

interface Props {
  ships: TrackedShip[]
  onShipClick?: (mmsi: string) => void
}

export function ShipLayer({ ships, onShipClick }: Props) {
  const map = useMap()

  useEffect(() => {
    const pane = map.createPane(PANE_NAME)
    pane.style.zIndex = String(PANE_Z)
    const layer = L.layerGroup([], { pane: PANE_NAME }).addTo(map)

    for (const ship of ships) {
      const live = ship.live
      if (!live || live.lat == null || live.lon == null) continue
      const marker = L.marker([live.lat, live.lon], {
        icon: buildIcon(ship),
        pane: PANE_NAME,
        keyboard: true,
        title: ship.name,
        riseOnHover: true,
      })
      if (onShipClick) marker.on('click', () => onShipClick(ship.mmsi))
      marker.addTo(layer)
    }

    return () => {
      layer.remove()
      pane.remove()
    }
  }, [map, ships, onShipClick])

  return null
}
