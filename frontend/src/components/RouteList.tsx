import type { Route, CableNode } from '../types'

interface Props {
  primaryRoutes: Route[]
  diverseRoutes: Route[]
  selectedRouteIds: string[]
  onSelectRoute: (id: string) => void
  nodes: CableNode[]
}

export function RouteList({ primaryRoutes, diverseRoutes, selectedRouteIds, onSelectRoute, nodes }: Props) {
  const nodesById = Object.fromEntries(nodes.map(n => [n.id, n]))

  if (primaryRoutes.length === 0 && diverseRoutes.length === 0) {
    return <p style={{ color: '#6c7086', fontSize: 13, padding: '8px 0' }}>No routes found.</p>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {primaryRoutes.length > 0 && (
        <div>
          <div style={sectionLabelStyle}>Primary Routes</div>
          {primaryRoutes.map(r => (
            <RouteCard key={r.id} route={r} selected={selectedRouteIds.includes(r.id)} onSelect={onSelectRoute} nodesById={nodesById} color="#89b4fa" />
          ))}
        </div>
      )}
      {diverseRoutes.length > 0 && (
        <div>
          <div style={sectionLabelStyle}>Diverse Routes</div>
          {diverseRoutes.map(r => (
            <RouteCard key={r.id} route={r} selected={selectedRouteIds.includes(r.id)} onSelect={onSelectRoute} nodesById={nodesById} color="#a6e3a1" />
          ))}
        </div>
      )}
    </div>
  )
}

function RouteCard({
  route, selected, onSelect, nodesById, color,
}: {
  route: Route
  selected: boolean
  onSelect: (id: string) => void
  nodesById: Record<string, { name: string }>
  color: string
}) {
  const systems = [...new Set(route.segments.map(s => s.system_id))]
  const reliabilityPct = (route.end_to_end_reliability * 100).toFixed(3)

  return (
    <div
      onClick={() => onSelect(route.id)}
      style={{
        padding: '10px 12px', borderRadius: 6, marginBottom: 4, cursor: 'pointer',
        border: `1px solid ${selected ? color : '#313244'}`,
        background: selected ? '#1e1e2e' : '#181825',
        transition: 'border-color 0.15s',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color }}>
          {route.id}
          <span style={{ fontWeight: 400, color: '#a6adc8', marginLeft: 6 }}>
            {systems.join(' · ')}
          </span>
        </span>
        <span style={{ fontSize: 11, color: '#6c7086' }}>
          {route.nodes.length - 1} hops
        </span>
      </div>

      <div style={{ fontSize: 11, color: '#cdd6f4', marginBottom: 4 }}>
        {route.nodes.map(id => nodesById[id]?.name ?? id).join(' → ')}
      </div>

      <div style={{ display: 'flex', gap: 12, fontSize: 11, color: '#a6adc8' }}>
        <span>Cost: <strong style={{ color: '#cdd6f4' }}>{route.total_cost}</strong></span>
        <span>{route.total_length_km.toLocaleString()} km</span>
        <span>Avail: <strong style={{ color: '#cdd6f4' }}>{reliabilityPct}%</strong></span>
      </div>
    </div>
  )
}

const sectionLabelStyle: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, color: '#6c7086',
  textTransform: 'uppercase', letterSpacing: '0.08em',
  marginBottom: 6, marginTop: 4,
}
