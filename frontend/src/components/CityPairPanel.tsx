import { useMemo, useState } from 'react'
import { useTheme } from '../theme'
import { api } from '../api/client'
import type { CableNode, CableSegment, CableSystem, CityPairRoute } from '../types'

interface Props {
  nodes: CableNode[]
  segments: CableSegment[]
  systems: CableSystem[]
  onNetOwnership: string[]
  onPlanRoute: (originNodeId: string, destNodeId: string) => void
}

const COUNTRY_NAMES: Record<string, string> = {
  AU: 'Australia', NZ: 'New Zealand', SG: 'Singapore', HK: 'Hong Kong',
  JP: 'Japan', KR: 'South Korea', GU: 'Guam', PH: 'Philippines',
  TW: 'Taiwan', IN: 'India', DJ: 'Djibouti', AE: 'UAE',
  GB: 'United Kingdom', ID: 'Indonesia', MY: 'Malaysia',
  FJ: 'Fiji', VU: 'Vanuatu', MP: 'Northern Mariana Islands',
  US: 'United States',
}

const SYS_COLORS = [
  '#89b4fa', '#a6e3a1', '#f9e2af', '#cba6f7', '#94e2d5',
  '#f38ba8', '#fab387', '#a6e3a1', '#89dceb', '#eba0ac',
]

type NetClass = 'on_net' | 'off_net' | 'mixed'

function classifyCityPairRoute(
  route: CityPairRoute,
  segByEndpoints: Map<string, CableSegment>,
  onNetSet: Set<string>,
): NetClass {
  const segs: CableSegment[] = []
  for (let i = 0; i < route.nodes.length - 1; i++) {
    const a = route.nodes[i], b = route.nodes[i + 1]
    const seg = segByEndpoints.get(`${a}|${b}`) ?? segByEndpoints.get(`${b}|${a}`)
    if (seg) segs.push(seg)
  }
  if (segs.length === 0) return 'on_net'
  const allOn  = segs.every(s => onNetSet.has(s.ownership))
  const allOff = segs.every(s => !onNetSet.has(s.ownership))
  return allOn ? 'on_net' : allOff ? 'off_net' : 'mixed'
}

export function CityPairPanel({ nodes, segments, systems, onNetOwnership, onPlanRoute }: Props) {
  const t = useTheme()

  const [origin, setOrigin]   = useState('')
  const [dest, setDest]       = useState('')
  const [originQuery, setOriginQuery] = useState('')
  const [destQuery, setDestQuery]     = useState('')
  const [originOpen, setOriginOpen]   = useState(false)
  const [destOpen, setDestOpen]       = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [results, setResults] = useState<CityPairRoute[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)

  const onNetSet = useMemo(() => new Set(onNetOwnership), [onNetOwnership])

  const segByEndpoints = useMemo(() => {
    const m = new Map<string, CableSegment>()
    for (const s of segments) m.set(`${s.start_node_id}|${s.end_node_id}`, s)
    return m
  }, [segments])

  // Derive cities from landing_station nodes, grouped by country
  const cities = useMemo(() => {
    const map = new Map<string, { name: string; nodeIds: string[]; country: string }>()
    for (const n of nodes) {
      if (n.type !== 'landing_station') continue
      if (!map.has(n.name)) map.set(n.name, { name: n.name, nodeIds: [], country: n.country })
      map.get(n.name)!.nodeIds.push(n.id)
    }
    return Array.from(map.values()).sort((a, b) =>
      a.country !== b.country
        ? a.country.localeCompare(b.country)
        : a.name.localeCompare(b.name)
    )
  }, [nodes])

  const systemsById = useMemo(() =>
    Object.fromEntries(systems.map(s => [s.id, s])), [systems])

  const sysColorMap = useMemo(() => {
    const m: Record<string, string> = {}
    let i = 0
    for (const s of systems) { m[s.id] = SYS_COLORS[i % SYS_COLORS.length]; i++ }
    return m
  }, [systems])

  function selectOrigin(name: string) { setOrigin(name); setOriginQuery(name); setOriginOpen(false) }
  function selectDest(name: string)   { setDest(name);   setDestQuery(name);   setDestOpen(false) }

  const originFiltered = useMemo(() => {
    const q = originQuery.toLowerCase()
    return (q ? cities.filter(c =>
      c.name.toLowerCase().includes(q) ||
      (COUNTRY_NAMES[c.country] ?? c.country).toLowerCase().includes(q)
    ) : cities).slice(0, 16)
  }, [cities, originQuery])

  const destFiltered = useMemo(() => {
    const q = destQuery.toLowerCase()
    return (q ? cities.filter(c =>
      c.name.toLowerCase().includes(q) ||
      (COUNTRY_NAMES[c.country] ?? c.country).toLowerCase().includes(q)
    ) : cities).slice(0, 16)
  }, [cities, destQuery])

  async function handleSearch() {
    if (!origin || !dest || origin === dest) return
    setLoading(true)
    setError(null)
    setResults(null)
    setSelected(null)
    try {
      const res = await api.searchCityPairs(origin, dest)
      setResults(res.routes)
      if (res.routes.length > 0) setSelected(res.routes[0].id)
    } catch {
      setError('Search failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  function handlePlan(route: CityPairRoute) {
    if (route.cls_nodes.length < 2) return
    onPlanRoute(route.cls_nodes[0], route.cls_nodes[route.cls_nodes.length - 1])
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '7px 10px', borderRadius: 6, boxSizing: 'border-box',
    border: `1px solid ${t.border}`, background: t.bgInput,
    color: t.text, fontSize: 13, outline: 'none',
  }

  const dropdownStyle: React.CSSProperties = {
    position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 300,
    background: t.bgDeep, border: `1px solid ${t.border}`, borderTop: 'none',
    borderRadius: '0 0 6px 6px', maxHeight: 220, overflowY: 'auto',
  }

  const dropItemStyle = (disabled: boolean): React.CSSProperties => ({
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '7px 10px', cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.35 : 1,
    borderBottom: `1px solid ${t.border}`,
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p style={{ fontSize: 12, color: t.textFaint, margin: 0, lineHeight: 1.5 }}>
        Find submarine cable systems connecting two cities. Routes are ranked by total latency and deduplicated by system itinerary.
      </p>

      {/* Origin */}
      <div>
        <label style={{ fontSize: 11, color: t.textMuted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 4 }}>
          Origin City
        </label>
        <div style={{ position: 'relative' }}>
          <input
            style={{ ...inputStyle, borderColor: origin ? t.blue : t.border }}
            placeholder="Type to search cities…"
            value={originQuery}
            onChange={e => { setOriginQuery(e.target.value); setOrigin(''); setOriginOpen(true) }}
            onFocus={() => setOriginOpen(true)}
            onBlur={() => setTimeout(() => setOriginOpen(false), 150)}
          />
          {originOpen && originFiltered.length > 0 && (
            <div style={dropdownStyle}>
              {originFiltered.map(c => (
                <div key={c.name} style={dropItemStyle(false)}
                  onMouseDown={() => selectOrigin(c.name)}>
                  <span style={{ fontSize: 13, color: t.text }}>{c.name}</span>
                  <span style={{ fontSize: 11, color: t.textFaint }}>{COUNTRY_NAMES[c.country] ?? c.country}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Destination */}
      <div>
        <label style={{ fontSize: 11, color: t.textMuted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 4 }}>
          Destination City
        </label>
        <div style={{ position: 'relative' }}>
          <input
            style={{ ...inputStyle, borderColor: dest ? t.blue : t.border }}
            placeholder="Type to search cities…"
            value={destQuery}
            onChange={e => { setDestQuery(e.target.value); setDest(''); setDestOpen(true) }}
            onFocus={() => setDestOpen(true)}
            onBlur={() => setTimeout(() => setDestOpen(false), 150)}
          />
          {destOpen && destFiltered.length > 0 && (
            <div style={dropdownStyle}>
              {destFiltered.map(c => (
                <div key={c.name} style={dropItemStyle(c.name === origin)}
                  onMouseDown={() => c.name !== origin && selectDest(c.name)}>
                  <span style={{ fontSize: 13, color: t.text }}>{c.name}</span>
                  <span style={{ fontSize: 11, color: t.textFaint }}>{COUNTRY_NAMES[c.country] ?? c.country}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Search button */}
      <button
        onClick={handleSearch}
        disabled={!origin || !dest || origin === dest || loading}
        style={{
          padding: '9px 0', borderRadius: 6, border: 'none', cursor: 'pointer',
          background: (!origin || !dest || origin === dest || loading) ? t.bgCard : t.blue,
          color: (!origin || !dest || origin === dest || loading) ? t.textFaint : '#11111b',
          fontSize: 13, fontWeight: 700, transition: 'all 0.15s',
        }}
      >
        {loading ? 'Searching…' : 'Find Systems'}
      </button>

      {error && (
        <p style={{ fontSize: 12, color: t.red, margin: 0 }}>{error}</p>
      )}

      {/* Results */}
      {results !== null && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
          <div style={{ fontSize: 11, color: t.textFaint, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {results.length === 0
              ? 'No routes found'
              : `${results.length} itinerar${results.length === 1 ? 'y' : 'ies'} found`}
          </div>
          {results.map(route => (
            <RouteCard
              key={route.id}
              route={route}
              selected={selected === route.id}
              origin={origin}
              dest={dest}
              sysColorMap={sysColorMap}
              systemsById={systemsById}
              netClass={classifyCityPairRoute(route, segByEndpoints, onNetSet)}
              onSelect={() => setSelected(selected === route.id ? null : route.id)}
              onPlan={() => handlePlan(route)}
              t={t}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Route card ────────────────────────────────────────────────────────────────

interface CardProps {
  route: CityPairRoute
  selected: boolean
  origin: string
  dest: string
  sysColorMap: Record<string, string>
  systemsById: Record<string, CableSystem>
  netClass: NetClass
  onSelect: () => void
  onPlan: () => void
  t: ReturnType<typeof useTheme>
}

function RouteCard({ route, selected, origin, dest, sysColorMap, systemsById, netClass, onSelect, onPlan, t }: CardProps) {
  const hopLabel = route.hop_count === 1 ? 'Direct' : `${route.hop_count} systems`
  const netColor = netClass === 'on_net' ? t.green : netClass === 'off_net' ? t.red : t.orange
  const netLabel = netClass === 'on_net' ? 'ON-NET' : netClass === 'off_net' ? 'OFF-NET' : 'MIXED'

  return (
    <div
      onClick={onSelect}
      style={{
        background: selected ? t.bgCardSelected : t.bgCard,
        border: `1px solid ${selected ? t.blue : t.border}`,
        borderRadius: 8, padding: '10px 12px', cursor: 'pointer',
        transition: 'all 0.15s',
      }}
    >
      {/* Hop count badge + net badge + system IDs */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <span style={{
          fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 3,
          background: route.hop_count === 1 ? t.green : t.blue,
          color: '#11111b', textTransform: 'uppercase', letterSpacing: '0.05em', flexShrink: 0,
        }}>
          {hopLabel}
        </span>
        <span style={{
          fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 3,
          background: netColor + '22', color: netColor,
          border: `1px solid ${netColor}55`,
          letterSpacing: '0.04em', flexShrink: 0,
        }}>
          {netLabel}
        </span>
        <span style={{ fontSize: 10, color: t.textFaintest, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {route.systems.join(' + ')}
        </span>
      </div>

      {/* Visual itinerary: City → [System] → City → [System] → City */}
      <Itinerary route={route} origin={origin} dest={dest} sysColorMap={sysColorMap} systemsById={systemsById} t={t} />

      {/* Metrics */}
      <div style={{ display: 'flex', gap: 14, marginTop: 8 }}>
        <Metric label="RTD" value={`${(route.total_latency_ms * 2).toFixed(0)} ms`} t={t} />
        <Metric label="Dist" value={`${Math.round(route.total_length_km).toLocaleString()} km`} t={t} />
        <Metric label="Avail" value={`${(route.end_to_end_reliability * 100).toFixed(3)}%`} t={t} />
      </div>

      {/* Plan Route button (only when selected) */}
      {selected && route.cls_nodes.length >= 2 && (
        <button
          onClick={e => { e.stopPropagation(); onPlan() }}
          style={{
            marginTop: 10, width: '100%', padding: '7px 0', borderRadius: 5,
            border: `1px solid ${t.blue}`, background: 'transparent',
            color: t.blue, fontSize: 12, fontWeight: 700, cursor: 'pointer',
          }}
        >
          Plan Route →
        </button>
      )}
    </div>
  )
}

// ── Itinerary visual ─────────────────────────────────────────────────────────

function Itinerary({ route, origin, dest, sysColorMap, systemsById, t }: {
  route: CityPairRoute
  origin: string
  dest: string
  sysColorMap: Record<string, string>
  systemsById: Record<string, CableSystem>
  t: ReturnType<typeof useTheme>
}) {
  // Build: City → [SysA] → Intermediate → [SysB] → City
  const items: React.ReactNode[] = []

  // origin city
  items.push(
    <span key="origin" style={{ fontSize: 12, fontWeight: 600, color: t.textMuted }}>{origin}</span>
  )

  // For each system, push: arrow → system badge → intermediate CLS (if any after this system)
  route.systems.forEach((sysId, idx) => {
    const color = sysColorMap[sysId] ?? t.blue
    const name  = systemsById[sysId]?.name ?? sysId
    items.push(
      <span key={`arr-${idx}`} style={{ fontSize: 10, color: t.textFaintest, flexShrink: 0 }}>→</span>
    )
    items.push(
      <span key={`sys-${idx}`} style={{
        fontSize: 10, fontWeight: 700, padding: '2px 5px', borderRadius: 3,
        background: color + '22', color: color, border: `1px solid ${color}55`,
        whiteSpace: 'nowrap', flexShrink: 0,
      }}>
        {name}
      </span>
    )
    // If there's an intermediate CLS after this system
    const intermediate = route.intermediate_cls[idx]
    if (intermediate) {
      items.push(
        <span key={`arr2-${idx}`} style={{ fontSize: 10, color: t.textFaintest, flexShrink: 0 }}>→</span>
      )
      items.push(
        <span key={`cls-${idx}`} style={{ fontSize: 11, color: t.textMuted, fontWeight: 500, whiteSpace: 'nowrap' }}>
          {intermediate.name}
        </span>
      )
    }
  })

  // destination city
  items.push(
    <span key={`arr-dest`} style={{ fontSize: 10, color: t.textFaintest, flexShrink: 0 }}>→</span>
  )
  items.push(
    <span key="dest" style={{ fontSize: 12, fontWeight: 600, color: t.textMuted }}>{dest}</span>
  )

  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', alignItems: 'center',
      gap: 4, lineHeight: 1.4,
    }}>
      {items}
    </div>
  )
}

// ── Small metric chip ─────────────────────────────────────────────────────────

function Metric({ label, value, t }: { label: string; value: string; t: ReturnType<typeof useTheme> }) {
  return (
    <div>
      <div style={{ fontSize: 9, color: t.textFaintest, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
      <div style={{ fontSize: 12, fontWeight: 600, color: t.textMuted }}>{value}</div>
    </div>
  )
}
