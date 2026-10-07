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
 * reports it, else course over ground. COG is noise for a stationary ship, so
 * below MOORED_KN a ship gets no arrow at all rather than one spinning
 * randomly between refreshes.
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

const PANE_NAME = 'rb-ships'
const PANE_Z = 620
const MOORED_KN = 0.5
const ARROW_MIN_PX = 16
const ARROW_PX_PER_KN = 2.5
const ARROW_MAX_PX = 60
const SPRITE_W = 40
const SPRITE_H = 25
const ARROW_COLOR = '#ffd84d'

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}

export function shipBearing(ship: TrackedShip): number | null {
  const live = ship.live
  if (!live) return null
  // A course from hours ago says nothing about where the ship is heading now.
  if (shipFixAge(live)?.stale) return null
  if (live.sog != null && live.sog < MOORED_KN) return null
  if (live.true_heading != null) return live.true_heading
  return live.cog
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
  const bearing = shipBearing(ship)
  const age = shipFixAge(ship.live)
  const stale = !!age?.stale
  const label = escapeHtml(ship.name) + (stale && age ? ` · ${escapeHtml(age.label)}` : '')
  const faceLeft = bearing != null && bearing > 180 && bearing < 360
  const arrow = bearing != null ? arrowSvg(bearing, ship.live?.sog ?? null).svg : ''
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
