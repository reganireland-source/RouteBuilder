/**
 * exportKml.ts — gather the geometry for an export and hand back a KML file.
 *
 * The impure half of the pair: generateKml.ts builds the string from geometry
 * it is given, and this is what goes and gets it.
 *
 * FULL RESOLUTION IS FETCHED PER SEGMENT, in parallel. The map deliberately
 * holds only a simplified path for each segment — it is redrawing 322 of them,
 * and shipping full detail would be ~39 MB per page load. An exported file is
 * opened once and may be used to plan real work, so it is worth the extra
 * round trips to carry every surveyed point. A route is a handful of segments;
 * a whole system is a few dozen.
 *
 * A SEGMENT WHOSE FETCH FAILS FALLS BACK TO THE APPROXIMATION rather than
 * dropping out of the file. Silently omitting a cable from an exported route
 * would be the worst of the options: the recipient sees a gap and has no way
 * to know whether the cable is missing or simply does not exist.
 */
import type { CableNode, CableSegment } from '../types'
import { api } from '../api/client'
import {
  approximateGeometry, downloadKml, generateKml, safeFilename,
  type ExportGeometry,
} from './generateKml'

/**
 * Fetch full-resolution surveyed paths for whichever of `segments` have one.
 *
 * `hasKml` is the set the caller already knows about from /api/kml/paths, so
 * segments with nothing on file are never requested at all.
 */
async function fetchSurveyed(
  segments: CableSegment[],
  hasKml: (segmentId: string) => boolean,
): Promise<Map<string, ExportGeometry>> {
  const wanted = segments.filter(s => hasKml(s.id))
  const results = await Promise.allSettled(wanted.map(s => api.getKmlFullPath(s.id)))

  const out = new Map<string, ExportGeometry>()
  results.forEach((r, i) => {
    if (r.status !== 'fulfilled') return       // falls back to the approximation
    out.set(wanted[i].id, {
      coords: r.value.full_path,
      // Carried straight through from what the segment was actually linked
      // as — never upgraded to 'upload' just because geometry exists, which
      // is the mistake this whole source field exists to prevent.
      source: r.value.source,
      fileLengthKm: r.value.length_km,
    })
  })
  return out
}

/** Build and download a KML for an ordered list of segments. */
export async function exportSegmentsAsKml(
  segments: CableSegment[],
  nodes: CableNode[],
  hasKml: (segmentId: string) => boolean,
  options: { title: string; subtitle?: string; filename: string },
): Promise<{ surveyed: number; synced: number; approximate: number }> {
  const nodesById = Object.fromEntries(nodes.map(n => [n.id, n]))
  const surveyed = await fetchSurveyed(segments, hasKml)

  let surveyedCount = 0
  let syncedCount = 0
  let approxCount = 0
  const geometryFor = (seg: CableSegment): ExportGeometry => {
    const got = surveyed.get(seg.id)
    if (got && got.coords.length >= 2) {
      if (got.source === 'upload') surveyedCount += 1
      else syncedCount += 1
      return got
    }
    approxCount += 1
    return { coords: approximateGeometry(seg, nodesById), source: 'approximate' }
  }

  const xml = generateKml(segments, nodesById, geometryFor, {
    title: options.title,
    subtitle: options.subtitle,
  })
  downloadKml(xml, safeFilename(options.filename))
  return { surveyed: surveyedCount, synced: syncedCount, approximate: approxCount }
}
