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
 * Phase B (current): Move sub-mode only — every node renders as a draggable
 * Leaflet `Marker` (react-leaflet's `CircleMarker` has no native drag support,
 * so this is the first use of `Marker`/`L.divIcon` in this codebase) styled
 * to match Map.tsx's NODE_STYLE. Releasing a drag on anything except a
 * branching_unit ("physical site" — CLS/PoP/off-net all correspond to a real
 * location) asks for confirmation before staging the move; Cancel snaps the
 * marker back. Later phases add Waypoints/Create/Delete sub-modes here too.
 */
import * as L from 'leaflet'
import { Marker, Tooltip } from 'react-leaflet'
import type { CableNode } from '../types'
import type { EditorSelection, EditorSubMode } from '../state/editorState'
import { normalizeLng, denormalizeLng, NODE_STYLE } from '../mapGeometry'
import { useTheme } from '../theme'

interface Props {
  nodes: CableNode[]
  subMode: EditorSubMode
  selection: EditorSelection
  pendingNodeIds: Set<string>
  onNodeDragEnd: (nodeId: string, lat: number, lng: number, fromLat: number, fromLng: number) => void
  onNodeSelect: (nodeId: string) => void
}

const PHYSICAL_SITE_CONFIRM = (name: string) =>
  `"${name}" is a physical site (a real building/landing point), not a virtual routing point. Really move it?`

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

export function EditorMapLayer({ nodes, subMode, selection, pendingNodeIds, onNodeDragEnd, onNodeSelect }: Props) {
  const t = useTheme()

  if (subMode !== 'move') return null

  return (
    <>
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
                const physicalSite = node.type !== 'branching_unit'
                if (physicalSite && !window.confirm(PHYSICAL_SITE_CONFIRM(node.name))) {
                  marker.setLatLng([node.lat, normalizeLng(node.lng)]) // snap back
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
