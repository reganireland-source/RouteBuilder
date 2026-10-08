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
 * arrow carries the exact bearing. It is drawn at a WHOLE-NUMBER multiple of
 * its 32×20 art grid in device pixels (see spriteSize) — any other scale makes
 * some art pixels wider than others and the sprite looks soft and washed out —
 * with a 1px dark outline so a white hull still reads over satellite imagery.
 * A ship whose fix is stale is greyed out (not made translucent) and its label
 * says how old the fix is.
 *
 * HOVER: a themed card (name, status, speed, heading, last ping, source)
 * instead of the browser's native title tooltip.
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
import { SOURCE_LABEL, navStatusLabel } from '../utils/shipLabels'
import { useTheme } from '../theme'

const PANE_NAME = 'rb-ships'
const PANE_Z = 620
const MOORED_KN = 0.5
const ARROW_MIN_PX = 16
const ARROW_PX_PER_KN = 2.5
const ARROW_MAX_PX = 60
// The sprites are 32×20 pixel art (stored 8× as 256×160 PNGs).
const ART_W = 32
const ART_H = 20
const ARROW_COLOR = '#ffd84d'

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
function bowSvg(bearing: number, spriteW: number): string {
  const reach = spriteW / 2 + 10   // just clear of the sprite
  const size = 2 * (reach + 10)
  const c = size / 2
  const tipY = c - reach
  return `
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="position:absolute;left:${-c}px;top:${-c}px;pointer-events:none;overflow:visible">
      <g transform="rotate(${bearing} ${c} ${c})">
        <path d="M ${c} ${tipY} L ${c - 6} ${tipY + 10} L ${c + 6} ${tipY + 10} Z" fill="none" stroke="#000" stroke-opacity="0.6" stroke-width="4" stroke-linejoin="round"/>
        <path d="M ${c} ${tipY} L ${c - 6} ${tipY + 10} L ${c + 6} ${tipY + 10} Z" fill="none" stroke="${ARROW_COLOR}" stroke-width="2" stroke-linejoin="round"/>
      </g>
    </svg>`
}

function arrowSvg(bearing: number, sog: number | null, spriteW: number): { svg: string; size: number } {
  // Starts clear of the sprite, then grows with speed.
  const base = spriteW / 2
  const len = base + Math.min(ARROW_MAX_PX, ARROW_MIN_PX + (sog ?? 0) * ARROW_PX_PER_KN)
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

/** CSS size that lands on a whole-number multiple of the art grid in device
 *  pixels, aiming for roughly 48px wide: 64px on a standard screen (2×),
 *  48px on a 2× phone (6 device px per art pixel). */
function spriteSize(): { w: number; h: number } {
  const dpr = typeof window !== 'undefined' && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1
  const scale = Math.max(1, Math.round((48 * dpr) / ART_W))
  return { w: (ART_W * scale) / dpr, h: (ART_H * scale) / dpr }
}

// 1px outline (four hard shadows) plus a soft drop shadow: legible on any basemap.
const OUTLINE = 'drop-shadow(1px 0 0 #0b1220) drop-shadow(-1px 0 0 #0b1220) drop-shadow(0 1px 0 #0b1220) drop-shadow(0 -1px 0 #0b1220) drop-shadow(0 2px 3px rgba(0,0,0,0.6))'

function tooltipHtml(ship: TrackedShip): string {
  const live = ship.live
  const flag = flagFromMmsi(ship.mmsi)
  const age = shipFixAge(live)
  let direction: string | null = null
  if (live?.true_heading != null) direction = `heading ${live.true_heading}°`
  else if (live?.cog != null && (live.sog ?? 0) >= MOORED_KN) direction = `course ${Math.round(live.cog)}°`
  const facts = [
    navStatusLabel(live?.nav_status),
    live?.sog != null ? `${live.sog.toFixed(1)} kn` : null,
    direction,
  ].filter(Boolean).map(f => escapeHtml(f as string))
  const ping = age ? `Last ping ${escapeHtml(age.label)}` : 'No ping yet'
  const source = live?.source ? ` · ${escapeHtml(SOURCE_LABEL[live.source] ?? live.source)}` : ''
  return `
    <div class="rb-ship-tip__name">${flag ? `${flag.emoji} ` : ''}${escapeHtml(ship.name)}</div>
    ${facts.length ? `<div class="rb-ship-tip__row">${facts.join(' · ')}</div>` : ''}
    <div class="rb-ship-tip__row ${age?.stale ? 'rb-ship-tip__stale' : 'rb-ship-tip__muted'}">${ping}${source}</div>
    <div class="rb-ship-tip__hint">Click for details</div>`
}

function tooltipCss(t: ReturnType<typeof useTheme>): string {
  return `
    .leaflet-tooltip.rb-ship-tip {
      background: ${t.bgPanel}; color: ${t.text}; border: 1px solid ${t.border};
      border-radius: 8px; padding: 8px 10px; box-shadow: 0 8px 24px rgba(0,0,0,0.45);
      font: 12px/1.45 system-ui, sans-serif; white-space: nowrap;
    }
    .leaflet-tooltip-top.rb-ship-tip::before { border-top-color: ${t.border}; }
    .rb-ship-tip__name { font-weight: 700; font-size: 13px; color: ${t.text}; }
    .rb-ship-tip__row { color: ${t.textMuted}; }
    .rb-ship-tip__muted { color: ${t.textFaint}; }
    .rb-ship-tip__stale { color: ${t.orange}; }
    .rb-ship-tip__hint { margin-top: 4px; font-size: 11px; color: ${t.blue}; }`
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
  if (heading) arrow = heading.moving ? arrowSvg(heading.bearing, ship.live?.sog ?? null, spriteSize().w).svg : bowSvg(heading.bearing, spriteSize().w)
  const sprite = `/ships/${encodeURIComponent(ship.sprite || 'generic')}.png`
  const { w, h } = spriteSize()
  const filter = stale ? `grayscale(0.85) brightness(0.9) ${OUTLINE}` : OUTLINE
  const html = `
    <div class="rb-ship-marker" role="img" aria-label="${escapeHtml(ship.name)}" style="position:relative;width:0;height:0">
      ${arrow}
      <img src="${sprite}" onerror="this.onerror=null;this.src='/ships/generic.png'" alt=""
        width="${w}" height="${h}"
        style="position:absolute;left:${-w / 2}px;top:${-h / 2}px;image-rendering:pixelated;
               transform:${faceLeft ? 'scaleX(-1)' : 'none'};filter:${filter}" />
      <div style="position:absolute;left:0;top:${h / 2 + 3}px;transform:translateX(-50%);
                  white-space:nowrap;font:700 11px system-ui,sans-serif;color:${stale ? '#d6d9e0' : '#fff'};
                  text-shadow:0 0 3px #000,0 0 3px #000,0 1px 2px #000">${label}</div>
    </div>`
  return L.divIcon({ html, className: '', iconSize: [0, 0], iconAnchor: [0, 0] })
}

interface Props {
  ships: TrackedShip[]
  onShipClick?: (mmsi: string) => void
}

const TIP_STYLE_ID = 'rb-ship-tip-style'

export function ShipLayer({ ships, onShipClick }: Props) {
  const map = useMap()
  const t = useTheme()

  // Theme the hover card (Leaflet tooltips are plain DOM outside React).
  useEffect(() => {
    let el = document.getElementById(TIP_STYLE_ID) as HTMLStyleElement | null
    if (!el) {
      el = document.createElement('style')
      el.id = TIP_STYLE_ID
      document.head.appendChild(el)
    }
    el.textContent = tooltipCss(t)
  }, [t])

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
        riseOnHover: true,
      })
      const { h } = spriteSize()
      marker.bindTooltip(tooltipHtml(ship), { direction: 'top', offset: [0, -(h / 2 + 4)], className: 'rb-ship-tip', opacity: 1 })
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
