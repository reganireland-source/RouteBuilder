import { MapContainer, TileLayer, CircleMarker, Polyline, Tooltip } from 'react-leaflet'
import type { CableNode, CableSegment, PinnedRoute, Route, SegmentCapacity } from '../types'
import { useTheme } from '../theme'

interface Props {
  nodes: CableNode[]
  segments: CableSegment[]
  selectedRoutes: Route[]
  capacity: SegmentCapacity[]
  pinnedRoutes: PinnedRoute[]
}

const DIVERSITY_COLORS: Record<number, string> = {
  1: '#89b4fa',
  2: '#a6e3a1',
}

export function Map({ nodes, segments, selectedRoutes, capacity, pinnedRoutes }: Props) {
  const t = useTheme()
  const nodesById = Object.fromEntries(nodes.map(n => [n.id, n]))
  const capacityById = Object.fromEntries(capacity.map(c => [c.segment_id, c]))

  // Build segment colour lookup: pinned first, then active search (active takes precedence)
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

  const highlightedNodes = new Set([
    ...selectedRoutes.flatMap(r => r.nodes),
    ...pinnedRoutes.flatMap(p => p.route.nodes),
  ])

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

      {segments.map(seg => {
        const start = nodesById[seg.start_node_id]
        const end = nodesById[seg.end_node_id]
        if (!start || !end) return null

        const color = segmentColor[seg.id] ?? t.mapInactiveSegment
        const weight = segmentWeight[seg.id] ?? 1
        const opacity = segmentOpacity[seg.id] ?? 0.35

        return (
          <Polyline
            key={seg.id}
            positions={[[start.lat, start.lng], [end.lat, end.lng]]}
            pathOptions={{
              color,
              weight,
              opacity,
              dashArray: seg.type === 'terrestrial' ? '6 4' : undefined,
            }}
          >
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
          </Polyline>
        )
      })}

      {nodes.map(node => {
        const isOnRoute = highlightedNodes.has(node.id)
        return (
          <CircleMarker
            key={node.id}
            center={[node.lat, node.lng]}
            radius={isOnRoute ? 7 : 4}
            pathOptions={{
              color: isOnRoute ? t.pink : t.borderSubtle,
              fillColor: isOnRoute ? t.pink : t.border,
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
