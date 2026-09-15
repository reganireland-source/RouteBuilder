/**
 * ============================================================================
 *  HazardLayer.tsx — "Network Hazards": live disasters over the network.
 * ============================================================================
 *
 * An optional overlay, OFF by default, drawing current fires, floods, storms,
 * earthquakes and tsunamis from two feeds the backend merges (bushfire.io and
 * USGS — see backend/app/hazards/). Each event is annotated server-side with the
 * nodes and segments it sits near, which is the whole point: a fire in Oregon is
 * news, a fire 4 km from TERRESTRIAL_US03 is a problem.
 *
 * WHY IT SITS ABOVE THE CABLES, unlike Living World. Living World is decoration
 * and hides under everything. This is data, and the question it answers is "does
 * this event overlap my route?" — which you cannot answer if the cable is drawn
 * on top of the fire. So the pane sits at 450: above the cable polylines (400),
 * below the node markers (600), so a landing station is never hidden by a
 * polygon covering the city it is in.
 *
 * SEVERITY IS SHAPE AND COLOUR, NOT COLOUR ALONE. Every marker carries its
 * kind's glyph and the ring thickens with severity, because a red-vs-amber-only
 * scheme fails for the colour-blind and in print — the same reasoning as the
 * wet/terrestrial distinction elsewhere in this app.
 *
 * AN EMPTY LAYER IS NOT "ALL CLEAR". The most dangerous failure mode here is a
 * feed that is down, or a region neither source covers, rendering as a calm map.
 * `HazardStatusBadge` therefore always states what is loaded, what failed and
 * what the sources can actually speak for. bushfire.io covers Australia, North
 * America and Europe only; USGS is worldwide but earthquakes only.
 *
 * Mounted from: Map.tsx, inside MapContainer, when `hazards` is on.
 * ============================================================================
 */
import { useEffect, useMemo } from 'react'
import * as L from 'leaflet'
import { useMap } from 'react-leaflet'
import type { Hazard, HazardKind, HazardSeverity } from '../types'
import { useTheme } from '../theme'

/** Our own pane: above the cable lines (400), below the node markers (600). */
const PANE_NAME = 'rb-hazards'
const PANE_Z = 450

/** Glyph per kind. Shape carries the meaning as well as colour. */
const KIND_GLYPH: Record<HazardKind, string> = {
  fire: '🔥',
  flood: '🌊',
  storm: '⛈',
  cyclone: '🌀',
  earthquake: '⚡',
  tsunami: '🌊',
  landslide: '⛰',
  marine: '⚓',
  power: '⚡',
  hazmat: '☢',
  other: '⚠',
}

export const KIND_LABEL: Record<HazardKind, string> = {
  fire: 'Fire',
  flood: 'Flood',
  storm: 'Storm',
  cyclone: 'Cyclone',
  earthquake: 'Earthquake',
  tsunami: 'Tsunami',
  landslide: 'Landslide',
  marine: 'Marine',
  power: 'Power',
  hazmat: 'Hazmat',
  other: 'Other',
}

export const SEVERITY_LABEL: Record<HazardSeverity, string> = {
  advisory: 'Advisory',
  watch: 'Watch',
  warning: 'Warning',
  emergency: 'Emergency',
}

/** Ring weight and marker size climb with severity, so the ladder is legible
 *  without reading colour at all. */
const SEVERITY_WEIGHT: Record<HazardSeverity, number> = {
  advisory: 1, watch: 1.5, warning: 2.5, emergency: 3.5,
}
const SEVERITY_SIZE: Record<HazardSeverity, number> = {
  advisory: 20, watch: 22, warning: 26, emergency: 30,
}

type T = ReturnType<typeof useTheme>

/**
 * Severity colour, from the theme so it reads in dark, dusk and light.
 *
 * `watch` and `warning` deliberately share the theme's orange: the palette has
 * no distinct amber, and inventing a literal hex here would be the one colour
 * on the map that ignores the theme. The two are told apart by ring weight and
 * marker size instead, which is the more accessible signal anyway.
 */
export function severityColor(severity: HazardSeverity, t: T): string {
  if (severity === 'emergency') return t.red
  if (severity === 'warning' || severity === 'watch') return t.orange
  return t.blue
}

/** A hazard that touches one of our assets is the one worth noticing. */
function isRelevant(h: Hazard): boolean {
  return h.affected.length > 0
}

function buildIcon(h: Hazard, color: string, relevant: boolean): L.DivIcon {
  const size = SEVERITY_SIZE[h.severity]
  const weight = SEVERITY_WEIGHT[h.severity]
  // A hazard near our network gets a solid ring and full opacity; everything
  // else is dashed and muted, so the map reads as "these few matter" rather
  // than as an undifferentiated wall of alarm.
  const border = relevant
    ? `${weight + 0.5}px solid ${color}`
    : `${weight}px dashed ${color}99`
  return L.divIcon({
    className: 'rb-hazard-icon',
    html:
      `<div style="width:${size}px;height:${size}px;border-radius:50%;`
      + `border:${border};background:${color}${relevant ? '33' : '18'};`
      + `display:flex;align-items:center;justify-content:center;`
      + `font-size:${Math.round(size * 0.5)}px;line-height:1;`
      + `opacity:${relevant ? 1 : 0.65};box-shadow:0 0 0 1px rgba(0,0,0,0.35);">`
      + `${KIND_GLYPH[h.kind] ?? '⚠'}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })
}

/** Escape anything that came from a third-party feed before it meets innerHTML.
 *  The popup is built as an HTML string for Leaflet, so every interpolated
 *  value has to be escaped here — `detail` and `title` are upstream text. */
function esc(value: string | null | undefined): string {
  return String(value ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ))
}

function popupHtml(h: Hazard, t: T): string {
  const color = severityColor(h.severity, t)
  const affected = h.affected.length === 0
    ? `<div style="color:${t.textFaintest};font-style:italic;margin-top:6px">No network assets within range.</div>`
    : `<div style="margin-top:6px">
         <div style="font-size:9px;font-weight:700;letter-spacing:.06em;color:${t.textFaint};text-transform:uppercase">
           Network assets in range (${h.affected.length})
         </div>
         ${h.affected.slice(0, 8).map(a => (
           `<div style="font-size:11px;color:${t.text};margin-top:2px">`
           + `<span style="color:${t.textFaint}">${a.kind === 'node' ? '◉' : '━'}</span> `
           + `${esc(a.label)} <span style="color:${t.textFaint}">· ${a.distance_km} km</span></div>`
         )).join('')}
         ${h.affected.length > 8 ? `<div style="font-size:10px;color:${t.textFaint};margin-top:2px">…and ${h.affected.length - 8} more</div>` : ''}
       </div>`
  const when = h.updated_at || h.reported_at
  return `
    <div style="font-family:system-ui,sans-serif;min-width:230px;max-width:320px">
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
        <span style="font-size:9px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;
                     padding:1px 5px;border-radius:3px;color:${color};background:${color}22;border:1px solid ${color}66">
          ${SEVERITY_LABEL[h.severity]}
        </span>
        <span style="font-size:9px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:${t.textFaint}">
          ${KIND_LABEL[h.kind] ?? h.kind}
        </span>
      </div>
      <div style="font-size:13px;font-weight:700;color:${t.text};margin-top:4px">${esc(h.title)}</div>
      ${h.detail ? `<div style="font-size:11px;color:${t.textMuted};margin-top:4px;line-height:1.5;max-height:120px;overflow:auto">${esc(h.detail)}</div>` : ''}
      ${affected}
      <div style="font-size:10px;color:${t.textFaintest};margin-top:7px;border-top:1px solid ${t.border};padding-top:5px">
        ${esc(h.attribution)}${when ? ` · ${esc(when.slice(0, 16).replace('T', ' '))}` : ''}
        ${h.url ? ` · <a href="${esc(h.url)}" target="_blank" rel="noopener noreferrer" style="color:${t.blue}">source</a>` : ''}
      </div>
    </div>`
}

interface Props {
  hazards: Hazard[]
  /** When set, only this hazard is drawn — used to spotlight one from a badge. */
  focusId?: string | null
}

export function HazardLayer({ hazards, focusId }: Props) {
  const map = useMap()
  const t = useTheme()

  const shown = useMemo(
    () => (focusId ? hazards.filter(h => h.id === focusId) : hazards),
    [hazards, focusId],
  )

  useEffect(() => {
    const pane = map.createPane(PANE_NAME)
    pane.style.zIndex = String(PANE_Z)
    const layer = L.layerGroup([], { pane: PANE_NAME }).addTo(map)

    for (const h of shown) {
      const relevant = isRelevant(h)
      const color = severityColor(h.severity, t)

      // The footprint, when the feed gave one. Non-interactive so it can never
      // swallow a click meant for the cable underneath it; the marker at the
      // centroid is what you click.
      if (h.geometry) {
        try {
          L.geoJSON(h.geometry as never, {
            pane: PANE_NAME,
            interactive: false,
            style: () => ({
              color,
              weight: relevant ? 2 : 1,
              opacity: relevant ? 0.9 : 0.5,
              fillColor: color,
              fillOpacity: relevant ? 0.22 : 0.1,
            }),
            // A GeometryCollection can still carry loose Points; drawing them
            // as default blue Leaflet pins next to our own marker looks broken.
            pointToLayer: () => L.circleMarker([0, 0], { radius: 0, opacity: 0, fillOpacity: 0 }),
          }).addTo(layer)
        } catch {
          // A malformed geometry from a third-party feed must not take the
          // whole layer down — the marker below still places the event.
        }
      }

      L.marker([h.lat, h.lng], {
        icon: buildIcon(h, color, relevant),
        pane: PANE_NAME,
        // Relevant hazards sit above the rest of the pile.
        zIndexOffset: relevant ? 1000 : 0,
        riseOnHover: true,
      })
  .bindPopup(popupHtml(h, t), { maxWidth: 340, className: 'rb-hazard-popup', autoPan: true })
        .addTo(layer)
    }

    return () => {
      layer.remove()
      pane.remove()
    }
  }, [map, shown, t])

  return <HazardStyles />
}

/**
 * Leaflet ships its popup as a white card with a white tip, which on the dark
 * and dusk themes put this popup's theme-coloured text on a white ground —
 * legible only by accident. The chrome is restyled here from the same theme the
 * content uses, so the two cannot disagree.
 */
function HazardStyles() {
  const t = useTheme()
  return (
    <style>{`
      .rb-hazard-icon { background: none; border: none; }
      .rb-hazard-popup .leaflet-popup-content { margin: 10px 12px; }
      .rb-hazard-popup .leaflet-popup-content-wrapper {
        background: ${t.bgPanel};
        color: ${t.text};
        border: 1px solid ${t.border};
        border-radius: 8px;
        box-shadow: 0 6px 24px rgba(0,0,0,0.45);
      }
      .rb-hazard-popup .leaflet-popup-tip {
        background: ${t.bgPanel};
        border: 1px solid ${t.border};
      }
      .rb-hazard-popup a.leaflet-popup-close-button { color: ${t.textFaint}; }
      .rb-hazard-popup a.leaflet-popup-close-button:hover { color: ${t.text}; }
    `}</style>
  )
}
