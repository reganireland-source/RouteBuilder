/**
 * ============================================================================
 * components/EditorMapLayer.tsx — Network Editor's map-side interaction layer
 * ============================================================================
 *
 * Mounted inside Map.tsx's <MapContainer> only when editorMode is on (see
 * Map.tsx's "Network Editor overlay" block, mirroring how the RouteManual
 * overlay is conditionally mounted the same way). Everything editor-specific
 * that touches the map lives here so Map.tsx's already-large read-mostly
 * rendering pipeline doesn't have to grow a second interaction model.
 *
 * Sub-modes:
 *  - 'move'      — every node renders as a draggable Leaflet `Marker`
 *                  (react-leaflet's `CircleMarker` has no native drag support,
 *                  so this is the first use of `Marker`/`L.divIcon` in this
 *                  codebase) styled to match Map.tsx's NODE_STYLE. Releasing a
 *                  drag on anything except a branching_unit ("physical site" —
 *                  CLS/PoP/off-net all correspond to a real location) asks for
 *                  confirmation before staging the move; Cancel snaps back.
 *  - 'waypoints' — a faint clickable overlay over every segment: click one to
 *                  select it, then its waypoints appear as draggable handles.
 *                  Clicking the selected segment's own line inserts a new
 *                  waypoint at that point (spliced into the right position via
 *                  nearestSegmentIndex); right-clicking a handle deletes it.
 *
 * Longitudes: the map draws in Pacific-normalised space (see normalizeLng), so
 * anything read back out of Leaflet — a dragged marker's position, a click's
 * latlng — is denormalised before being handed upward for storage.
 *
 * Note the segment LINES themselves are still drawn by Map.tsx's normal
 * rendering pipeline (it already receives the derived base+staged segments),
 * so this layer only adds interaction affordances on top of them.
 */
import { useMemo, useState } from 'react'
import * as L from 'leaflet'
import { Marker, Polyline, Tooltip, useMapEvents } from 'react-leaflet'
import type { CableNode, CableSegment } from '../types'
import type { EditorSelection, EditorSubMode, SegmentDraft } from '../state/editorState'
import { normalizeLng, denormalizeLng, geoLines, nearestSegmentIndex, NODE_STYLE } from '../mapGeometry'
import { useTheme } from '../theme'
import { ConfirmDialog } from './ConfirmDialog'

interface Props {
  nodes: CableNode[]
  segments: CableSegment[]
  subMode: EditorSubMode
  selection: EditorSelection
  segmentDraft: SegmentDraft
  pendingNodeIds: Set<string>
  pendingSegmentIds: Set<string>
  onNodeDragEnd: (nodeId: string, lat: number, lng: number, fromLat: number, fromLng: number) => void
  onNodeSelect: (nodeId: string) => void
  onSegmentSelect: (segmentId: string) => void
  onWaypointInsert: (segmentId: string, insertIndex: number, lat: number, lng: number) => void
  onWaypointDragEnd: (segmentId: string, index: number, lat: number, lng: number) => void
  onWaypointDelete: (segmentId: string, index: number) => void
  onPickEndpoint: (nodeId: string) => void
  onPickEmptySpace: (lat: number, lng: number) => void
}

/** Empty-map-space clicks for Create sub-mode — clicking anywhere that isn't a
 *  node or segment offers to drop a brand-new node there. Mounted only in that
 *  sub-mode so no other mode's map clicks are affected. */
function MapClickCatcher({ onClick }: { onClick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onClick(e.latlng.lat, denormalizeLng(e.latlng.lng)) })
  return null
}

/** Builds a divIcon matching NODE_STYLE for the given type, with an optional
 *  outer ring for "selected" (solid blue) or "pending" (dashed amber) state —
 *  baked into the icon HTML itself since Marker can't host a second Marker
 *  as a child the way Polyline can host a Tooltip. */
function buildIcon(type: string, ringColor: string | null, ringDashed: boolean): L.DivIcon {
  const style = NODE_STYLE[type] ?? NODE_STYLE.extension_pop
  const d = style.radius * 2
  const ring = ringColor
    ? `position:absolute;inset:-6px;border-radius:50%;border:2px ${ringDashed ? 'dashed' : 'solid'} ${ringColor};`
    : ''
  const total = d + 12
  return L.divIcon({
    className: '',
    html: `<div style="position:relative;width:${d}px;height:${d}px;">
      ${ringColor ? `<div style="${ring}"></div>` : ''}
      <div style="width:${d}px;height:${d}px;border-radius:50%;background:${style.fill};border:${style.weight + 1}px solid ${style.color};box-shadow:0 0 0 2px rgba(0,0,0,0.35);cursor:grab;"></div>
    </div>`,
    iconSize: [total, total],
    iconAnchor: [total / 2, total / 2],
  })
}

/** Small square handle for a segment waypoint — deliberately a different shape
 *  from the round node markers so the two are never confused on a busy map. */
function buildWaypointIcon(color: string): L.DivIcon {
  return L.divIcon({
    className: '',
    html: `<div style="width:11px;height:11px;background:${color};border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,0.5);cursor:grab;"></div>`,
    iconSize: [15, 15],
    iconAnchor: [7.5, 7.5],
  })
}

export function EditorMapLayer({
  nodes, segments, subMode, selection, segmentDraft, pendingNodeIds, pendingSegmentIds,
  onNodeDragEnd, onNodeSelect, onSegmentSelect, onWaypointInsert, onWaypointDragEnd, onWaypointDelete,
  onPickEndpoint, onPickEmptySpace,
}: Props) {
  const t = useTheme()
  const nodesById = useMemo(() => Object.fromEntries(nodes.map(n => [n.id, n])), [nodes])
  const waypointIcon = useMemo(() => buildWaypointIcon(t.blue), [t.blue])
  // A physical-site move waiting on the in-app confirmation. The Leaflet marker
  // is kept here too: unlike window.confirm this is async, so if the user
  // cancels we need the handle to snap the marker back to where it started.
  const [pendingMove, setPendingMove] = useState<
    { node: CableNode; lat: number; lng: number; marker: L.Marker } | null
  >(null)

  const moveConfirm = pendingMove && (
    <ConfirmDialog
      title="Move a physical site?"
      body={<>
        <strong style={{ color: t.text }}>{pendingMove.node.name}</strong>{' '}
        <span style={{ color: t.textFaint }}>({pendingMove.node.id})</span> is a physical site — a
        real building or landing point — not a virtual routing point like a branching unit.
        Its coordinates should match the actual location.
        <div style={{ marginTop: 10, fontSize: 12, fontFamily: 'monospace', color: t.textFaint }}>
          {pendingMove.node.lat.toFixed(4)}, {pendingMove.node.lng.toFixed(4)}
          {'  →  '}
          <span style={{ color: t.orange }}>{pendingMove.lat.toFixed(4)}, {pendingMove.lng.toFixed(4)}</span>
        </div>
      </>}
      confirmLabel="Move it"
      cancelLabel="Put it back"
      onConfirm={() => {
        onNodeDragEnd(pendingMove.node.id, pendingMove.lat, pendingMove.lng, pendingMove.node.lat, pendingMove.node.lng)
        setPendingMove(null)
      }}
      onCancel={() => {
        pendingMove.marker.setLatLng([pendingMove.node.lat, normalizeLng(pendingMove.node.lng)])
        setPendingMove(null)
      }}
    />
  )

  if (subMode === 'move') {
    return (
      <>
        {moveConfirm}
        {nodes.map(node => {
          const isSelected = selection?.kind === 'node' && selection.id === node.id
          const isPending = pendingNodeIds.has(node.id)
          const icon = isSelected
            ? buildIcon(node.type, t.blue, false)
            : isPending
            ? buildIcon(node.type, t.orange, true)
            : buildIcon(node.type, null, false)
          return (
            <Marker
              key={node.id}
              position={[node.lat, normalizeLng(node.lng)]}
              icon={icon}
              draggable
              eventHandlers={{
                click: () => onNodeSelect(node.id),
                dragend: (e) => {
                  const marker = e.target as L.Marker
                  const { lat, lng } = marker.getLatLng()
                  const finalLng = denormalizeLng(lng)
                  // Physical sites (CLS/PoP/off-net) ask first; branching units,
                  // which are virtual routing points, move freely.
                  if (node.type !== 'branching_unit') {
                    setPendingMove({ node, lat, lng: finalLng, marker })
                    return
                  }
                  onNodeDragEnd(node.id, lat, finalLng, node.lat, node.lng)
                },
              }}
            >
              <Tooltip>
                <strong>{node.name}</strong> ({node.id})
                {isPending && <><br /><span style={{ color: '#c2410c' }}>Pending move — not yet saved</span></>}
              </Tooltip>
            </Marker>
          )
        })}
      </>
    )
  }

  if (subMode === 'waypoints') {
    const selectedId = selection?.kind === 'segment' ? selection.id : null
    const selectedSeg = selectedId ? segments.find(s => s.id === selectedId) ?? null : null

    return (
      <>
        {/* Clickable overlay over every segment — click to select which one to
            edit, or (on the already-selected one) to insert a waypoint there. */}
        {segments.map(seg => {
          const start = nodesById[seg.start_node_id]
          const end = nodesById[seg.end_node_id]
          if (!start || !end) return null
          const isSelected = seg.id === selectedId
          const isPending = pendingSegmentIds.has(seg.id)
          const lines = geoLines(start.lat, start.lng, end.lat, end.lng, seg.waypoints ?? undefined)
          return lines.map((positions, i) => (
            <Polyline
              key={`editor-seg-${seg.id}-${i}`}
              positions={positions}
              pathOptions={{
                color: isSelected ? t.blue : isPending ? t.orange : t.textFaint,
                weight: isSelected ? 10 : 8,
                opacity: isSelected ? 0.45 : 0.12,
                lineCap: 'round',
              }}
              eventHandlers={{
                click: (e) => {
                  L.DomEvent.stopPropagation(e)
                  if (!isSelected) { onSegmentSelect(seg.id); return }
                  // Already selected → clicking its line inserts a waypoint at
                  // the right position along the existing path.
                  const wps = seg.waypoints ?? []
                  const refPoints: [number, number][] = [
                    [start.lat, normalizeLng(start.lng)],
                    ...wps.map(([wlat, wlng]): [number, number] => [wlat, normalizeLng(wlng)]),
                    [end.lat, normalizeLng(end.lng)],
                  ]
                  const idx = nearestSegmentIndex([e.latlng.lat, e.latlng.lng], refPoints)
                  onWaypointInsert(seg.id, idx, e.latlng.lat, denormalizeLng(e.latlng.lng))
                },
              }}
            >
              {i === 0 && (
                <Tooltip sticky>
                  <strong>{seg.name}</strong> ({seg.id})
                  <br />{isSelected ? 'Click the line to add a waypoint · drag a handle to move it · right-click a handle to delete' : 'Click to edit this segment’s path'}
                </Tooltip>
              )}
            </Polyline>
          ))
        })}

        {/* Draggable handles for the selected segment's existing waypoints. */}
        {selectedSeg && (selectedSeg.waypoints ?? []).map(([wlat, wlng], idx) => (
          <Marker
            key={`wp-${selectedSeg.id}-${idx}`}
            position={[wlat, normalizeLng(wlng)]}
            icon={waypointIcon}
            draggable
            eventHandlers={{
              dragend: (e) => {
                const { lat, lng } = (e.target as L.Marker).getLatLng()
                onWaypointDragEnd(selectedSeg.id, idx, lat, denormalizeLng(lng))
              },
              contextmenu: (e) => {
                L.DomEvent.stopPropagation(e)
                onWaypointDelete(selectedSeg.id, idx)
              },
            }}
          >
            <Tooltip>
              Waypoint {idx + 1} of {(selectedSeg.waypoints ?? []).length}
              <br />Drag to move · right-click to delete
            </Tooltip>
          </Marker>
        ))}
      </>
    )
  }

  if (subMode === 'create') {
    const { startNodeId, endNodeId } = segmentDraft
    const startNode = startNodeId ? nodesById[startNodeId] : undefined
    const endNode = endNodeId ? nodesById[endNodeId] : undefined

    return (
      <>
        <MapClickCatcher onClick={onPickEmptySpace} />

        {/* Every node is a pick target; the chosen endpoints are highlighted. */}
        {nodes.map(node => {
          const isStart = node.id === startNodeId
          const isEnd = node.id === endNodeId
          const ring = isStart ? t.green : isEnd ? t.blue : pendingNodeIds.has(node.id) ? t.orange : null
          return (
            <Marker
              key={`create-${node.id}`}
              position={[node.lat, normalizeLng(node.lng)]}
              icon={buildIcon(node.type, ring, ring === t.orange)}
              eventHandlers={{
                click: (e) => { L.DomEvent.stopPropagation(e); onPickEndpoint(node.id) },
              }}
            >
              <Tooltip>
                <strong>{node.name}</strong> ({node.id})
                <br />{isStart ? 'Start node' : isEnd ? 'End node' : startNodeId ? 'Click to use as the end node' : 'Click to use as the start node'}
              </Tooltip>
            </Marker>
          )
        })}

        {/* Preview line once both ends are chosen. */}
        {startNode && endNode && geoLines(startNode.lat, startNode.lng, endNode.lat, endNode.lng).map((positions, i) => (
          <Polyline
            key={`create-preview-${i}`}
            positions={positions}
            pathOptions={{ color: t.green, weight: 3, opacity: 0.85, dashArray: '8 5' }}
            interactive={false}
          />
        ))}
      </>
    )
  }

  if (subMode === 'delete') {
    const selectedNodeId = selection?.kind === 'node' ? selection.id : null
    const selectedSegId = selection?.kind === 'segment' ? selection.id : null

    return (
      <>
        {/* Clickable segment overlay — same hit-target trick as Waypoints mode. */}
        {segments.map(seg => {
          const start = nodesById[seg.start_node_id]
          const end = nodesById[seg.end_node_id]
          if (!start || !end) return null
          const isSelected = seg.id === selectedSegId
          const lines = geoLines(start.lat, start.lng, end.lat, end.lng, seg.waypoints ?? undefined)
          return lines.map((positions, i) => (
            <Polyline
              key={`del-seg-${seg.id}-${i}`}
              positions={positions}
              pathOptions={{
                color: isSelected ? t.red : t.textFaint,
                weight: isSelected ? 10 : 8,
                opacity: isSelected ? 0.55 : 0.12,
                lineCap: 'round',
              }}
              eventHandlers={{ click: (e) => { L.DomEvent.stopPropagation(e); onSegmentSelect(seg.id) } }}
            >
              {i === 0 && <Tooltip sticky><strong>{seg.name}</strong> ({seg.id})<br />Click to select for deletion</Tooltip>}
            </Polyline>
          ))
        })}

        {nodes.map(node => (
          <Marker
            key={`del-${node.id}`}
            position={[node.lat, normalizeLng(node.lng)]}
            icon={buildIcon(node.type, node.id === selectedNodeId ? t.red : pendingNodeIds.has(node.id) ? t.orange : null, node.id !== selectedNodeId)}
            eventHandlers={{ click: (e) => { L.DomEvent.stopPropagation(e); onNodeSelect(node.id) } }}
          >
            <Tooltip><strong>{node.name}</strong> ({node.id})<br />Click to select for deletion</Tooltip>
          </Marker>
        ))}
      </>
    )
  }

  return null
}
