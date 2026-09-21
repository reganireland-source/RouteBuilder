/**
 * KmlChopMapLayer — the interactive map surface for chopping a flattened
 * import into segments.
 *
 * MIRRORS EditorMapLayer.tsx'S CLICK-TO-INSERT PATTERN, not KmlPreviewLayer's
 * read-only one: a wide, low-opacity hit-target Polyline captures clicks and
 * maps them back to the nearest point along the chain via mapGeometry.ts's
 * nearestSegmentIndex — the exact mechanism EditorMapLayer already uses to
 * insert a waypoint into a segment's path, reused here to drop a CUT marker
 * instead. Existing cuts render as draggable handles (same divIcon idiom as
 * EditorMapLayer's waypoint handles) that can be dragged along the line or
 * right-clicked to remove.
 *
 * COLOUR IS OWNED BY THE CALLER. This layer only draws; which colour a given
 * stretch gets (a declared segment's own colour, or grey-dashed for
 * unassigned) is computed by KmlChopImport from its own assignment state, via
 * `colorForStretch` — keeping "what does a colour mean" in one place rather
 * than duplicated between the table and the map.
 *
 * kink_indices (backend/app/kml/flatten.py: a re-chopping walk that likely
 * reversed onto the wrong side of a fragment, or hit a real Y-branch a linear
 * chain cannot represent) are drawn as a small warning glyph — not an error,
 * a place worth a second look before trusting a cut placed nearby.
 */
import { Fragment, useEffect } from 'react'
import * as L from 'leaflet'
import { Marker, Polyline, Tooltip, useMap } from 'react-leaflet'
import type { KmlChain } from '../types'
import { nearestSegmentIndex, normalizeLng } from '../mapGeometry'
import { useTheme, type Theme } from '../theme'

/** Above the read-only KML preview (500), below markers (600) — this layer is
 *  itself the thing being edited, so it sits above a mere preview. */
const PANE_NAME = 'rb-kml-chop'
const PANE_Z = 520

/** Exported so App.tsx/Map.tsx and KmlChopImport.tsx (the state owner that
 *  builds this object) can share one canonical shape rather than each
 *  redeclaring it and risking drift. */
export interface KmlChopMapLayerProps {
  chains: KmlChain[]
  /** Per-chain, the sorted INTERIOR cut indices the user has placed so far
   *  (never includes a chain's own 0 or point_count-1 — those boundaries are
   *  implicit, not user-placed cuts). */
  cutsByChain: Record<number, number[]>
  /** The colour to draw the stretch at position `indexInChain` (0-based,
   *  in on-chain order) within `chainIndex` — an identity colour assigned
   *  the moment the stretch exists, before any segment matching, never one
   *  that reshuffles all of a chain's other stretches when this one is
   *  added or removed. */
  colorForStretch: (chainIndex: number, indexInChain: number) => string
  onAddCut: (chainIndex: number, vertexIndex: number) => void
  onMoveCut: (chainIndex: number, oldIndex: number, newIndex: number) => void
  onRemoveCut: (chainIndex: number, index: number) => void
  /** Bumped whenever the caller wants the map to re-fit to the chains — a
   *  fresh flatten() result, typically. */
  fitKey: number
}

function buildCutIcon(): L.DivIcon {
  return L.divIcon({
    className: '',
    html: '<div style="width:13px;height:13px;border-radius:50%;background:#fff;'
      + 'border:3px solid #1d4ed8;box-shadow:0 0 0 1px rgba(0,0,0,0.5);cursor:grab;"></div>',
    iconSize: [17, 17],
    iconAnchor: [8.5, 8.5],
  })
}

function buildKinkIcon(): L.DivIcon {
  return L.divIcon({
    className: '',
    html: '<div style="width:0;height:0;border-left:6px solid transparent;'
      + 'border-right:6px solid transparent;border-bottom:10px solid #f59e0b;'
      + 'filter:drop-shadow(0 0 1px rgba(0,0,0,0.6));"></div>',
    iconSize: [12, 10],
    iconAnchor: [6, 8],
  })
}

const CUT_ICON = buildCutIcon()
const KINK_ICON = buildKinkIcon()

/** Every chain's coords, Pacific-normalised — computed once per chain rather
 *  than inline in every callback, since several handlers need the same
 *  normalised array to stay in the same space as what is actually drawn. */
function normalizedCoords(chain: KmlChain): [number, number][] {
  return chain.coords.map(([lat, lng]): [number, number] => [lat, normalizeLng(lng)])
}

/** [0, ...interior cuts, last] — the boundary indices bracketing every
 *  stretch this chain is currently divided into. */
function boundaries(chain: KmlChain, cuts: number[]): number[] {
  return [0, ...cuts, chain.point_count - 1]
}

/** Creates the pane once, before anything asks to render into it — the same
 *  ordering requirement KmlPreviewLayer's own pane setup documents: an effect
 *  runs after children mount, so a pane created only once there is something
 *  to draw is created too late for that first render. */
function ChopPane() {
  const map = useMap()
  useEffect(() => {
    if (!map.getPane(PANE_NAME)) {
      const pane = map.createPane(PANE_NAME)
      pane.style.zIndex = String(PANE_Z)
      // Deliberately NOT pointerEvents:'none' — unlike KmlPreviewLayer, this
      // pane is the whole point of interaction.
    }
  }, [map])
  return null
}

function FitToChains({ chains, fitKey }: { chains: KmlChain[]; fitKey: number }) {
  const map = useMap()
  useEffect(() => {
    const pts = chains.flatMap(c => normalizedCoords(c))
    if (pts.length < 2) return
    map.fitBounds(L.latLngBounds(pts), { padding: [60, 60], maxZoom: 8, animate: true })
    // fitKey alone would miss a same-key re-flatten; chains.length covers the
    // common "user re-ran flatten" case without needing the caller to also
    // manage a key bump for that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, fitKey, chains.length])
  return null
}

/** One chain's click-to-cut hit target — a single wide, faint Polyline over
 *  the WHOLE chain (not per-stretch) so a click anywhere along it resolves to
 *  the nearest actual vertex, the same nearestSegmentIndex mechanism
 *  EditorMapLayer already uses for waypoint insertion. */
function ChainHitTarget({ chainIndex, positions, onAddCut, cuts, t }: {
  chainIndex: number
  positions: [number, number][]
  onAddCut: (chainIndex: number, vertexIndex: number) => void
  cuts: number[]
  t: Theme
}) {
  return (
    <Polyline
      positions={positions}
      pathOptions={{
        color: t.blue, weight: 14, opacity: 0.001, lineCap: 'round',
        pane: PANE_NAME, renderer: L.svg({ pane: PANE_NAME }),
      }}
      eventHandlers={{
        click: (e) => {
          L.DomEvent.stopPropagation(e)
          const idx = nearestSegmentIndex([e.latlng.lat, e.latlng.lng], positions)
          // nearestSegmentIndex returns which PAIR the click is nearest to;
          // the cut lands on whichever of that pair's two vertices is
          // actually closer, and never on the chain's own two ends (index 0
          // or the last one), which are not cuts — they are what a stretch
          // already trivially starts or ends at.
          const a = idx, b = Math.min(idx + 1, positions.length - 1)
          const da = L.latLng(e.latlng).distanceTo(positions[a])
          const db = L.latLng(e.latlng).distanceTo(positions[b])
          const vertex = da <= db ? a : b
          if (vertex <= 0 || vertex >= positions.length - 1) return
          if (cuts.includes(vertex)) return
          onAddCut(chainIndex, vertex)
        },
      }}
    />
  )
}

export function KmlChopMapLayer({ chains, cutsByChain, colorForStretch, onAddCut, onMoveCut, onRemoveCut, fitKey }: KmlChopMapLayerProps) {
  const t = useTheme()

  return (
    <>
      <ChopPane />
      <FitToChains chains={chains} fitKey={fitKey} />

      {chains.map(chain => {
        const positions = normalizedCoords(chain)
        const cuts = cutsByChain[chain.index] ?? []
        const bounds = boundaries(chain, cuts)

        return (
          <Fragment key={`chain-group-${chain.index}`}>
            <ChainHitTarget
              chainIndex={chain.index} positions={positions} onAddCut={onAddCut} cuts={cuts} t={t}
            />
            {/* The visible line, one Polyline per stretch so each can carry
                its own assigned colour. */}
            {bounds.slice(0, -1).map((start, i) => {
              const end = bounds[i + 1]
              return (
                <Polyline
                  key={`chain-${chain.index}-stretch-${start}`}
                  positions={positions.slice(start, end + 1)}
                  interactive={false}
                  pathOptions={{
                    color: colorForStretch(chain.index, i), weight: 4, opacity: 0.9,
                    lineCap: 'round', lineJoin: 'round',
                    pane: PANE_NAME, renderer: L.svg({ pane: PANE_NAME }),
                  }}
                />
              )
            })}
            {/* Cut handles — draggable along the SAME chain, right-click to remove. */}
            {cuts.map(cutIdx => (
              <Marker
                key={`cut-${chain.index}-${cutIdx}`}
                position={positions[cutIdx]}
                icon={CUT_ICON}
                draggable
                eventHandlers={{
                  dragend: (e) => {
                    // Both the dragged marker's own position and `positions`
                    // live in the same Pacific-normalised map space — no
                    // denormalising needed here, only an index comes out.
                    const { lat, lng } = (e.target as L.Marker).getLatLng()
                    const idx = nearestSegmentIndex([lat, lng], positions)
                    const a = idx, b = Math.min(idx + 1, positions.length - 1)
                    const da = L.latLng(lat, lng).distanceTo(positions[a])
                    const db = L.latLng(lat, lng).distanceTo(positions[b])
                    const vertex = Math.max(1, Math.min(positions.length - 2, da <= db ? a : b))
                    onMoveCut(chain.index, cutIdx, vertex)
                  },
                  contextmenu: (e) => {
                    L.DomEvent.stopPropagation(e)
                    onRemoveCut(chain.index, cutIdx)
                  },
                }}
              >
                <Tooltip>Drag to move · right-click to remove</Tooltip>
              </Marker>
            ))}
            {/* Kink warnings — non-interactive, purely informational. */}
            {chain.kink_indices.map(k => (
              <Marker key={`kink-${chain.index}-${k}`} position={positions[k]} icon={KINK_ICON} interactive={false}>
                <Tooltip>Sharp turn here — check this is a real join, not a mis-chained fragment</Tooltip>
              </Marker>
            ))}
          </Fragment>
        )
      })}
    </>
  )
}
