import { MapContainer, TileLayer, CircleMarker, Polyline, Tooltip } from 'react-leaflet'
import type { CableNode, CableSegment, Route, SegmentCapacity } from '../types'

interface Props {
  nodes: CableNode[]
  segments: CableSegment[]
  selectedRoutes: Route[]
  capacity: SegmentCapacity[]
}

const ROUTE_COLORS: Record<number, string> = {
  1: '#89b4fa',
  2: '#a6e3a1',
}

export function Map({ nodes, segments, selectedRoutes, capacity }: Props) {
  const nodesById = Object.fromEntries(nodes.map(n => [n.id, n]))
  const capacityById = Object.fromEntries(capacity.map(c => [c.segment_id, c]))

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
              <br />{seg.length_km.toLocaleString()} km · {seg.latency} ms · Cost: {seg.cost_weight}
              {capacityById[seg.id] && (() => {
                const cap = capacityById[seg.id]
                const pct = Math.round((cap.available_capacity_t / cap.total_capacity_t) * 100)
                return <><br />Capacity: {cap.available_capacity_t}T / {cap.total_capacity_t}T available ({pct}%)</>
              })()}
            </Tooltip>
          </Polyline>
        )
      })}

      {/* Render nodes */}
      {nodes.map(node => {
        const isOnRoute = selectedRoutes.some(r => r.nodes.includes(node.id))
        return (
          <CircleMarker
            key={node.id}
            center={[node.lat, node.lng]}
            radius={isOnRoute ? 7 : 4}
            pathOptions={{
              color: isOnRoute ? '#f5c2e7' : '#45475a',
              fillColor: isOnRoute ? '#f5c2e7' : '#313244',
              fillOpacity: 1,
              weight: isOnRoute ? 2 : 1,
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
