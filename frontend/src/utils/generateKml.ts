/**
 * generateKml.ts — compose a KML file from segments of this network.
 *
 * The companion to the KML import: geometry comes in from a carrier's survey,
 * and this is how a route or a whole cable system goes back out — to a
 * customer, a carrier, or anyone who wants to open it in Google Earth.
 *
 * THE FILE SAYS WHICH LINES ARE SURVEYED AND WHICH ARE NOT, and that is the
 * point rather than a nicety. Coverage is partial and will stay partial: some
 * segments have an uploaded route measured along the cable as laid, and the
 * rest are drawn from a median of two hand-placed waypoints threaded through a
 * spline to look like a cable. Both render as a confident line in Google Earth.
 * Exporting them identically would hand someone a file that looks like a survey
 * and is in part a sketch — so surveyed segments are drawn solid and green,
 * approximated ones dashed and amber, each placemark's description says which
 * it is, and the document description states the split up front.
 *
 * FULL RESOLUTION WHERE WE HAVE IT. The map draws a simplified path because a
 * browser is redrawing 322 of them; an exported file is opened once and may be
 * used to plan real work, so it carries every surveyed point. The caller
 * supplies the geometry, which keeps the fetching (and its failure handling)
 * out of a pure string-building module.
 *
 * Pure functions, no I/O, no React — which is what lets the output be parsed
 * and checked rather than eyeballed.
 */
import type { CableNode, CableSegment } from '../types'
import { geoLines } from '../mapGeometry'

/** KML colours are aabbggrr — alpha, blue, green, red. Not rrggbb. */
const COLOR_SURVEYED = 'ff4ade80'      // green
const COLOR_APPROX = 'ff15c0f9'        // amber
const WIDTH_SURVEYED = 3
const WIDTH_APPROX = 2

/** Geometry for one exported segment, and where it came from. */
export interface ExportGeometry {
  /** [[lat, lng], ...] in export order (A→Z). */
  coords: [number, number][]
  /** True when these are surveyed points from an uploaded KML. */
  surveyed: boolean
  /** Measured length of the surveyed path, when there is one. */
  surveyedLengthKm?: number | null
}

export interface KmlExportOptions {
  /** Document name, e.g. "SYD1 → TKO1" or "EAC". */
  title: string
  /** Extra context for the document description. */
  subtitle?: string
}

/** XML-escape. Cable names carry ampersands — see backend/app/id_utils.py. */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * KML writes `lng,lat[,alt]` — LONGITUDE FIRST, the opposite of everything
 * else in this codebase. The swap happens here, once, mirroring the same note
 * in the parser so a reader of either finds the warning.
 */
function coordsToKml(coords: [number, number][]): string {
  return coords.map(([lat, lng]) => `${lng.toFixed(6)},${lat.toFixed(6)},0`).join(' ')
}

function styleBlock(): string {
  return `
    <Style id="surveyed">
      <LineStyle><color>${COLOR_SURVEYED}</color><width>${WIDTH_SURVEYED}</width></LineStyle>
    </Style>
    <Style id="approximate">
      <LineStyle><color>${COLOR_APPROX}</color><width>${WIDTH_APPROX}</width></LineStyle>
    </Style>`
}

/**
 * The geometry to export for a segment that has no surveyed route.
 *
 * Deliberately the SAME function the map draws with, so the exported line is
 * the line you were looking at when you decided to export it. It is still an
 * approximation, and the placemark says so.
 */
export function approximateGeometry(
  segment: CableSegment,
  nodesById: Record<string, CableNode>,
): [number, number][] {
  const a = nodesById[segment.start_node_id]
  const z = nodesById[segment.end_node_id]
  if (!a || !z) return []
  const lines = geoLines(a.lat, a.lng, z.lat, z.lng, segment.waypoints ?? undefined)
  // geoLines normalises longitudes for the Pacific-centred map (LA at 242°).
  // A KML must carry real signed longitudes or Google Earth puts the cable in
  // the wrong hemisphere, so that shift is undone on the way out.
  return (lines[0] ?? []).map(([lat, lng]): [number, number] => [lat, lng > 180 ? lng - 360 : lng])
}

/** "SGCS1 (Singapore)", or just the code when we have no node for it. */
function endLabel(nodeId: string, node: CableNode | undefined): string {
  return node ? `${nodeId} (${node.name})` : nodeId
}

/** What the map is falling back to for a segment with no surveyed route. */
function approximationSource(segment: CableSegment): string {
  const n = segment.waypoints?.length ?? 0
  if (n === 0) return 'the two endpoints as a straight line'
  return `${n} hand-placed waypoint${n === 1 ? '' : 's'}`
}

/** The provenance sentence — the honest half of every placemark. */
function provenanceOf(segment: CableSegment, geom: ExportGeometry): string {
  if (geom.surveyed) {
    const measured = geom.surveyedLengthKm != null
      ? `, measured ${geom.surveyedLengthKm.toLocaleString()} km`
      : ''
    return `Surveyed route from an uploaded KML — ${geom.coords.length.toLocaleString()} points${measured}`
  }
  return 'APPROXIMATE. No surveyed route on file; this line is drawn from '
    + approximationSource(segment)
    + ' and is for orientation only.'
}

function placemark(
  segment: CableSegment,
  geom: ExportGeometry,
  nodesById: Record<string, CableNode>,
): string {
  const a = nodesById[segment.start_node_id]
  const z = nodesById[segment.end_node_id]
  const ends = `${endLabel(segment.start_node_id, a)} → ${endLabel(segment.end_node_id, z)}`

  // The description is where the honesty actually lands: someone opening this
  // in Google Earth sees the line first and clicks it second, and this is what
  // they read when they do.
  const desc = [
    ends,
    `System: ${segment.system_id}`,
    `Type: ${segment.type === 'wet' ? 'Wet (submarine)' : 'Terrestrial'}`,
    `Recorded length: ${segment.length_km.toLocaleString()} km`,
    '',
    provenanceOf(segment, geom),
  ].join('\n')

  return `
      <Placemark>
        <name>${esc(segment.id)} — ${esc(segment.name)}</name>
        <description>${esc(desc)}</description>
        <styleUrl>#${geom.surveyed ? 'surveyed' : 'approximate'}</styleUrl>
        <LineString>
          <tessellate>1</tessellate>
          <coordinates>${coordsToKml(geom.coords)}</coordinates>
        </LineString>
      </Placemark>`
}

/**
 * Build a KML document for an ordered list of segments.
 *
 * `geometryFor` supplies each segment's points and says whether they are
 * surveyed; the caller owns the fetching so this stays pure.
 */
export function generateKml(
  segments: CableSegment[],
  nodesById: Record<string, CableNode>,
  geometryFor: (segment: CableSegment) => ExportGeometry,
  options: KmlExportOptions,
): string {
  const rows = segments
    .map(seg => ({ seg, geom: geometryFor(seg) }))
    .filter(r => r.geom.coords.length >= 2)

  const surveyed = rows.filter(r => r.geom.surveyed).length
  const approx = rows.length - surveyed

  // Stated on the document itself, not only per placemark: whoever receives
  // this should learn the mix before they have clicked anything.
  const summary = [
    options.subtitle,
    `${rows.length} segment${rows.length === 1 ? '' : 's'}.`,
    surveyed > 0 ? `${surveyed} drawn from a surveyed route (solid green).` : null,
    approx > 0
      ? `${approx} APPROXIMATE (dashed amber) — drawn from hand-placed waypoints, `
        + 'for orientation only, not survey data.'
      : null,
    `Exported ${new Date().toISOString().slice(0, 10)} from RouteBuilder.`,
  ].filter(Boolean).join(' ')

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${esc(options.title)}</name>
    <description>${esc(summary)}</description>${styleBlock()}
    <Folder>
      <name>${esc(options.title)}</name>${rows.map(r => placemark(r.seg, r.geom, nodesById)).join('')}
    </Folder>
  </Document>
</kml>
`
}

/**
 * Hand the built document to the browser as a download.
 *
 * The anchor is ATTACHED TO THE DOCUMENT before it is clicked and removed
 * after. A detached anchor's click() is not reliably honoured — it produced no
 * download at all under test — and the older exporters in generateDiagram.ts
 * get away with it only by luck. The revoke is deferred a tick so the browser
 * has actually started reading the blob before its URL is torn down.
 */
export function downloadKml(xml: string, filename: string): void {
  const blob = new Blob([xml], { type: 'application/vnd.google-earth.kml+xml' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.kml') ? filename : `${filename}.kml`
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** Filesystem-safe, without mangling it beyond recognition. */
export function safeFilename(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'export'
}
