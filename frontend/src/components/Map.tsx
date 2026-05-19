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
}

const DIVERSITY_COLORS: Record<number, string> = {
  1: '#89b4fa',
  2: '#a6e3a1',
}

/**
 * Split a geodesic segment into 1 or 2 polyline position arrays so that
 * Leaflet always draws the shortest-arc path and handles antimeridian crossings.
 *
 * Strategy:
 *  1. Normalise the end longitude so the delta is in (−180, +180].
 *  2. If the normalised end is outside [−180, 180] the line crosses ±180°;
 *     split it there, mirroring the crossing point onto the other side.
 */
function geoLines(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): [number, number][][] {
  // Shortest-arc delta
  let d = lng2 - lng1
  while (d >  180) d -= 360
  while (d < -180) d += 360
  const adjLng2 = lng1 + d

  // No antimeridian crossing
  if (adjLng2 >= -180 && adjLng2 <= 180) {
    return [[[lat1, lng1], [lat2, adjLng2]]]
  }

  // Crosses antimeridian — find crossing latitude by linear interpolation
  const crossLng = adjLng2 > 180 ? 180 : -180
  const t        = (crossLng - lng1) / (adjLng2 - lng1)
  const crossLat = lat1 + t * (lat2 - lat1)

  return [
    [[lat1, lng1],         [crossLat,  crossLng]],
    [[crossLat, -crossLng], [lat2,     lng2]],
  ]
}

export function Map({ nodes, segments, selectedRoutes, capacity, pinnedRoutes, selectedSystems }: Props) {
  const t = useTheme()
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
    const color = DIVERSITY_COLORS[r.diversity_group] ?? '#89b4fa'
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

        const color     = isRouteNode ? t.pink : isSystemNode ? sysColor : t.borderSubtle
        const fillColor = isRouteNode ? t.pink : isSystemNode ? sysColor : t.border
        const radius    = isRouteNode || isSystemNode ? 6 : 4

        return (
          <CircleMarker
            key={node.id}
            center={[node.lat, node.lng]}
            radius={radius}
            pathOptions={{
              color, fillColor, fillOpacity: isDimmed ? 0.15 : 1,
              weight: isRouteNode || isSystemNode ? 2 : 1,
              opacity: isDimmed ? 0.15 : 1,
            }}
          >
            <Tooltip>
              <strong>{node.name}</strong> ({node.id})
              <br />{node.country} · {node.type.replace('_', ' ')}
            </Tooltip>
          </CircleMarker>
        )
      })}
    </MapContainer>
  )
}
