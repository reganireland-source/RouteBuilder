import { MapContainer, TileLayer, CircleMarker, Polyline, Tooltip, Marker } from 'react-leaflet'
import L from 'leaflet'
import type { CableNode, CableSegment, Route } from '../types'

interface Props {
  nodes: CableNode[]
  segments: CableSegment[]
  selectedRoutes: Route[]
  primaryColor?: string
  diverseColor?: string
}

const ROUTE_COLORS: Record<number, string> = {
  1: '#89b4fa',
  2: '#a6e3a1',
}

export function Map({ nodes, segments, selectedRoutes }: Props) {
  const nodesById = Object.fromEntries(nodes.map(n => [n.id, n]))

  const activeSegmentIds = new Set(
    selectedRoutes.flatMap(r => r.segments.map(s => s.segment_id))
  )

  return (
    <MapContainer
      center={[10, 130]}
      zoom={3}
      style={{ height: '100%', width: '100%', background: '#0f0f1a' }}
      minZoom={2}
      maxZoom={10}
    >
      <TileLayer
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        attribution='&copy; <a href="https://carto.com/">CARTO</a>'
      />

      {/* Render all cable segments as faint background lines */}
      {segments.map(seg => {
        const start = nodesById[seg.start_node_id]
        const end = nodesById[seg.end_node_id]
        if (!start || !end) return null

        const isActive = activeSegmentIds.has(seg.id)
        const activeRoute = selectedRoutes.find(r => r.segments.some(s => s.segment_id === seg.id))
        const color = activeRoute ? ROUTE_COLORS[activeRoute.diversity_group] ?? '#89b4fa' : '#2a2a3e'
        const weight = isActive ? 3 : 1
        const opacity = isActive ? 0.9 : 0.35

        return (
          <Polyline
            key={seg.id}
            positions={[
              [start.lat, start.lng],
              [end.lat, end.lng],
            ]}
            pathOptions={{
              color,
              weight,
              opacity,
              dashArray: seg.type === 'terrestrial' ? '6 4' : undefined,
            }}
          >
            <Tooltip sticky>
              <strong>{seg.name}</strong>
              <br />{seg.system_id} · {seg.type}
              <br />{seg.length_km.toLocaleString()} km · Cost: {seg.cost_weight}
            </Tooltip>
          </Polyline>
        )
      })}

      {/* Segment name labels at midpoint of each line */}
      {segments.map(seg => {
        const start = nodesById[seg.start_node_id]
        const end = nodesById[seg.end_node_id]
        if (!start || !end) return null

        const isActive = activeSegmentIds.has(seg.id)
        const midLat = (start.lat + end.lat) / 2
        const midLng = (start.lng + end.lng) / 2
        const color = isActive ? '#cdd6f4' : '#4a4a6a'

        const icon = L.divIcon({
          html: `<div style="font-size:9px;color:${color};white-space:nowrap;text-align:center;width:180px;margin-left:-90px;text-shadow:0 1px 3px rgba(0,0,0,0.95);pointer-events:none;user-select:none;font-family:system-ui,sans-serif">${seg.name}</div>`,
          className: '',
          iconSize: [0, 0],
          iconAnchor: [0, 0],
        })

        return (
          <Marker
            key={`label-${seg.id}`}
            position={[midLat, midLng]}
            icon={icon}
            interactive={false}
            zIndexOffset={-1000}
          />
        )
      })}

      {/* Render nodes — CLS as larger circles, PoP as smaller diamonds (smaller radius, square dash) */}
      {nodes.map(node => {
        const isOnRoute = selectedRoutes.some(r => r.nodes.includes(node.id))
        const isCls = node.type === 'cls'

        const idleColor = isCls ? '#45475a' : '#6c5a7c'
        const idleFill  = isCls ? '#313244' : '#2a1f3d'
        const activeColor = isCls ? '#f5c2e7' : '#cba6f7'
        const radius = isOnRoute ? (isCls ? 7 : 5) : (isCls ? 4 : 3)

        return (
          <CircleMarker
            key={node.id}
            center={[node.lat, node.lng]}
            radius={radius}
            pathOptions={{
              color: isOnRoute ? activeColor : idleColor,
              fillColor: isOnRoute ? activeColor : idleFill,
              fillOpacity: 1,
              weight: isOnRoute ? 2 : 1,
            }}
          >
            <Tooltip>
              <strong>{node.name}</strong> ({node.id})
              <br />{node.country} · {node.type.toUpperCase()}
            </Tooltip>
          </CircleMarker>
        )
      })}
    </MapContainer>
  )
}
