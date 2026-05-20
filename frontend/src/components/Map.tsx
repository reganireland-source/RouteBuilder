import { MapContainer, TileLayer, CircleMarker, Polyline, Tooltip } from 'react-leaflet'
import type { CableNode, CableSegment, PinnedRoute, Route, SegmentCapacity, SelectedSystem } from '../types'
import { useTheme } from '../theme'

interface Props {
  nodes: CableNode[]
  segments: CableSegment[]
  selectedRoutes: Route[]
  capacity: SegmentCapacity[]
  pinnedRoutes: PinnedRoute[]
  selectedSystems: SelectedSystem[]
  onNodeClick?: (node: CableNode, screenX: number, screenY: number) => void
  searchPin?: { lat: number; lng: number; label: string }
  nearestNodeIds?: string[]
}


/**
 * Normalise a longitude for a Pacific-centred map view.
 * Western Hemisphere longitudes (Americas, < −30°) are shifted +360°
 * so they render to the RIGHT of the Pacific (e.g. LA −118° → 242°)
 * rather than to the left of Europe, keeping all transpacific cables
 * as single continuous lines without antimeridian splits.
 */
function normalizeLng(lng: number): number {
  return lng < -30 ? lng + 360 : lng
}

/**
 * Return Leaflet Polyline positions for a segment, always taking the
 * shortest arc.  Both endpoints are first Pacific-normalised so that
 * American nodes appear east of the antimeridian in the same world-copy
 * as Asia/Pacific nodes.  The result is always a single array (no split).
 */
function geoLines(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): [number, number][][] {
  const nLng1 = normalizeLng(lng1)
  const nLng2 = normalizeLng(lng2)
  let d = nLng2 - nLng1
  if (d >  180) d -= 360
  if (d < -180) d += 360
  return [[[lat1, nLng1], [lat2, nLng1 + d]]]
}

export function Map({ nodes, segments, selectedRoutes, capacity, pinnedRoutes, selectedSystems, onNodeClick, searchPin, nearestNodeIds }: Props) {
  const t = useTheme()
  const diversityColors: Record<number, string> = { 1: t.blue, 2: t.green }
  const nodesById = Object.fromEntries(nodes.map(n => [n.id, n]))
  const capacityById = Object.fromEntries(capacity.map(c => [c.segment_id, c]))

  const systemViewerActive = selectedSystems.length > 0
  const systemColorMap: Record<string, string> = Object.fromEntries(
    selectedSystems.map(s => [s.systemId, s.color])
  )

  // Segment highlight: pinned first, active search on top
  const segmentColor: Record<string, string> = {}
  const segmentWeight: Record<string, number> = {}
  const segmentOpacity: Record<string, number> = {}

  for (const p of pinnedRoutes) {
    for (const s of p.route.segments) {
      segmentColor[s.segment_id] = p.color
      segmentWeight[s.segment_id] = 2
      segmentOpacity[s.segment_id] = 0.8
    }
  }
  for (const r of selectedRoutes) {
    const color = diversityColors[r.diversity_group] ?? t.blue
    for (const s of r.segments) {
      segmentColor[s.segment_id] = color
      segmentWeight[s.segment_id] = 3
      segmentOpacity[s.segment_id] = 0.9
    }
  }

  // Nodes for routes/pins
  const routeNodeIds = new Set([
    ...selectedRoutes.flatMap(r => r.nodes),
    ...pinnedRoutes.flatMap(p => p.route.nodes),
  ])

  // Nodes for selected systems (systemId -> color for first matching system)
  const systemNodeColor: Record<string, string> = {}
  if (systemViewerActive) {
    for (const seg of segments) {
      const color = systemColorMap[seg.system_id]
      if (color) {
        if (!systemNodeColor[seg.start_node_id]) systemNodeColor[seg.start_node_id] = color
        if (!systemNodeColor[seg.end_node_id]) systemNodeColor[seg.end_node_id] = color
      }
    }
  }

  return (
    <MapContainer
      center={[10, 130]}
      zoom={3}
      style={{ height: '100%', width: '100%', background: t.bgMap }}
      minZoom={2}
      maxZoom={10}
    >
      <TileLayer
        key={t.mapTileUrl}
        url={t.mapTileUrl}
        attribution='&copy; <a href="https://carto.com/">CARTO</a>'
      />

      {segments.flatMap(seg => {
        const start = nodesById[seg.start_node_id]
        const end = nodesById[seg.end_node_id]
        if (!start || !end) return []

        // System viewer colouring takes priority when active
        let color: string
        let weight: number
        let opacity: number

        if (systemViewerActive && systemColorMap[seg.system_id]) {
          color  = systemColorMap[seg.system_id]
          weight = 3
          opacity = 0.9
        } else if (systemViewerActive) {
          color   = segmentColor[seg.id] ?? t.mapInactiveSegment
          weight  = segmentWeight[seg.id] ?? 1
          opacity = segmentOpacity[seg.id] ?? 0.08
        } else {
          color   = segmentColor[seg.id] ?? t.mapInactiveSegment
          weight  = segmentWeight[seg.id] ?? 1
          opacity = segmentOpacity[seg.id] ?? 0.35
        }

        const pathOptions = { color, weight, opacity, dashArray: seg.type === 'terrestrial' ? '6 4' : undefined }
        const lines = geoLines(start.lat, start.lng, end.lat, end.lng)

        const tooltip = (
          <Tooltip sticky>
            <strong>{seg.name}</strong>
            <br />{seg.system_id} · {seg.type} · {seg.ownership}
            <br />{start.name} → {end.name}
            <br />{seg.length_km.toLocaleString()} km · {seg.latency} ms · Cost: {seg.cost_weight}
            {capacityById[seg.id] && (() => {
              const cap = capacityById[seg.id]
              const pct = Math.round((cap.available_capacity_t / cap.total_capacity_t) * 100)
              return <><br />Capacity: {cap.available_capacity_t}T / {cap.total_capacity_t}T available ({pct}%)</>
            })()}
          </Tooltip>
        )

        return lines.map((positions, i) => (
          <Polyline
            key={`${seg.id}-${i}`}
            positions={positions}
            pathOptions={pathOptions}
          >
            {i === 0 && tooltip}
          </Polyline>
        ))
      })}

      {nodes.map(node => {
        const isRouteNode   = routeNodeIds.has(node.id)
        const sysColor      = systemNodeColor[node.id]
        const isSystemNode  = !!sysColor
        const isDimmed      = systemViewerActive && !isSystemNode && !isRouteNode
        const isBU          = node.type === 'branching_unit'
        const isNearest     = nearestNodeIds?.includes(node.id) ?? false

        const color     = isNearest ? '#f9a825' : isRouteNode ? t.pink : isSystemNode ? sysColor : isBU ? '#e5a045' : t.borderSubtle
        const fillColor = isNearest ? '#ffd54f' : isRouteNode ? t.pink : isSystemNode ? sysColor : isBU ? '#e5a045' : t.border
        const radius    = isNearest ? 7 : isRouteNode || isSystemNode ? 6 : isBU ? 3 : 4
        const weight    = isNearest ? 2.5 : isRouteNode || isSystemNode ? 2 : 1

        return (
          <CircleMarker
            key={node.id}
            center={[node.lat, normalizeLng(node.lng)]}
            radius={radius}
            pathOptions={{
              color, fillColor, fillOpacity: isDimmed ? 0.15 : isBU ? 0.7 : 1,
              weight,
              opacity: isDimmed ? 0.15 : isBU ? 0.7 : 1,
            }}
            eventHandlers={{ click: (e) => { e.originalEvent.stopPropagation(); onNodeClick?.(node, e.originalEvent.clientX, e.originalEvent.clientY) } }}
          >
            <Tooltip>
              <strong>{node.name}</strong> ({node.id})
              {!isBU && <><br />{node.country} · {node.type.replace('_', ' ')}</>}
              {isBU && <><br />Branching Unit</>}
              {node.owner && <><br />Owner: {node.owner}</>}
            </Tooltip>
          </CircleMarker>
        )
      })}

      {searchPin && (
        <CircleMarker
          center={[searchPin.lat, normalizeLng(searchPin.lng)]}
          radius={9}
          pathOptions={{ color: '#fff', fillColor: '#ff6b35', fillOpacity: 0.95, weight: 2.5 }}
        >
          <Tooltip>
            <strong>Search Location</strong><br />
            {searchPin.label.length > 60 ? searchPin.label.slice(0, 57) + '…' : searchPin.label}
          </Tooltip>
        </CircleMarker>
      )}
    </MapContainer>
  )
}
