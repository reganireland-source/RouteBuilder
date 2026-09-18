/**
 * KmlPreviewLayer — draws an uploaded-but-not-yet-attached cable path on the
 * real map, so the import can be judged against the network it will join.
 *
 * WHY THIS IS WORTH A LAYER OF ITS OWN. The review table can say a file was cut
 * into three pieces at TUAS, BOM1 and DXB1, and that tells you nothing about
 * whether those are the right cuts. A join 200 km out to sea, a piece that
 * doubles back on itself, a path that follows a neighbouring cable's corridor —
 * all of them read as perfectly ordinary rows in a table and are obvious the
 * moment the geometry is on the map next to the existing network.
 *
 * EACH PIECE GETS ITS OWN COLOUR and the cuts are marked, because the question
 * being asked is specifically "where does this stop being one segment and start
 * being the next". One colour for the whole trace would answer a different
 * question.
 *
 * Drawn ABOVE the network in its own pane. The preview is the thing under
 * examination and the network is the reference it is being checked against, so
 * the preview must never end up underneath a cable it is being compared with.
 * Non-interactive throughout — a click belongs to the map beneath, and this is
 * a transient overlay, not something to select.
 */
import { useEffect } from 'react'
import * as L from 'leaflet'
import { Polyline, CircleMarker, Tooltip, useMap } from 'react-leaflet'
import type { KmlPreviewLine } from '../types'
import { normalizeLng } from '../mapGeometry'

/** Above cables (400) and hazards (450), below markers (600). */
const PANE_NAME = 'rb-kml-preview'
const PANE_Z = 500

/** Distinct hues for consecutive pieces. Chosen to stay legible over both the
 *  satellite basemap and the network's own blue/orange vocabulary. */
export const PREVIEW_COLORS = [
  '#f472b6', // pink
  '#facc15', // yellow
  '#4ade80', // green
  '#22d3ee', // cyan
  '#c084fc', // violet
  '#fb923c', // orange
]

interface Props {
  lines: KmlPreviewLine[]
  /** Bumped by the caller each time a new preview is requested, so asking for
   *  the SAME geometry twice still re-fits the map. */
  fitKey: number
}

/**
 * Creates the pane and fits the map to whatever is being previewed.
 *
 * ALWAYS MOUNTED, even with nothing to draw. The pane must exist before any
 * polyline asks to be rendered into it: an earlier version returned null from
 * the layer until there were lines, so the pane's effect and the polylines
 * mounted in the same render — effects run after children, so the lines were
 * created pointing at a pane that did not exist yet and nothing appeared at
 * all. Mounting this unconditionally means the pane is there from startup.
 */
function PreviewPane({ lines, fitKey }: Props) {
  const map = useMap()

  useEffect(() => {
    if (!map.getPane(PANE_NAME)) {
      const pane = map.createPane(PANE_NAME)
      pane.style.zIndex = String(PANE_Z)
      pane.style.pointerEvents = 'none'
    }
  }, [map])

  useEffect(() => {
    const pts = lines.flatMap(l => l.coords.map(([lat, lng]): [number, number] => [lat, normalizeLng(lng)]))
    if (pts.length < 2) return
    // THE REVIEW DIALOG COVERS THE BOTTOM OF THE MAP while a preview is up, and
    // Leaflet fits to the whole container regardless. Fitting without allowing
    // for it put half a Singapore-London trace behind the dialog — visible to
    // Leaflet, invisible to the person looking. Padding the bottom by the
    // dialog's share of the viewport puts the whole path in the part that can
    // actually be seen.
    //
    // Asymmetric padding rather than a single number: the top and sides only
    // need enough room to show the surrounding network for context.
    const docked = lines.length > 0
    map.fitBounds(L.latLngBounds(pts), {
      paddingTopLeft: [60, 60],
      paddingBottomRight: [60, docked ? Math.round(window.innerHeight * 0.5) : 60],
      maxZoom: 7,
      animate: true,
    })
  }, [map, fitKey, lines])

  return null
}

export function KmlPreviewLayer({ lines, fitKey }: Props) {
  return (
    <>
      <PreviewPane lines={lines} fitKey={fitKey} />
      {lines.map((line, i) => {
        const positions = line.coords.map(([lat, lng]): [number, number] => [lat, normalizeLng(lng)])
        return (
          <Polyline
            key={`${line.label}-${i}`}
            positions={positions}
            interactive={false}
            pathOptions={{
              // Heavier than any network line so it reads as the subject rather
              // than as one more cable among the others.
              color: line.color, weight: 5, opacity: 0.95,
              lineCap: 'round', lineJoin: 'round',
              pane: PANE_NAME,
              renderer: L.svg({ pane: PANE_NAME }),
            }}
          />
        )
      })}
      {/* The cuts themselves. Without these you can see three coloured lines
          but not precisely where one ends and the next begins — which is the
          whole question a split is being reviewed for. */}
      {lines.map((line, i) =>
        line.cutAt ? (
          <CircleMarker
            key={`cut-${line.label}-${i}`}
            center={[line.cutAt[0], normalizeLng(line.cutAt[1])]}
            radius={7}
            interactive={false}
            pathOptions={{
              color: '#ffffff', weight: 2.5, fillColor: line.color, fillOpacity: 1,
              pane: PANE_NAME,
              renderer: L.svg({ pane: PANE_NAME }),
            }}
          >
            <Tooltip permanent direction="top" offset={[0, -8]} className="seg-label">
              {line.cutLabel ?? 'cut'}
            </Tooltip>
          </CircleMarker>
        ) : null,
      )}
    </>
  )
}
