import { useState } from 'react'
import type { CableNode } from '../types'
import { useTheme } from '../theme'

interface Props {
  nodes: CableNode[]
  onPinChange: (pin: { lat: number; lng: number; label: string } | null, nearestIds: string[]) => void
  onSetOrigin: (nodeId: string) => void
  onSetDest: (nodeId: string) => void
}

interface Result {
  node: CableNode
  distanceKm: number
}

const OWNER_LOGOS: Record<string, string> = {
  // Original full-art logos
  'Telstra':                      '/logos/telstra.svg',
  'Telstra International':        '/logos/telstra.svg',
  'Equinix':                      '/logos/equinix.svg',
  'PCCW':                         '/logos/pccw.svg',
  'DRT':                          '/logos/digitalrealty.svg',
  'Digital Realty':               '/logos/digitalrealty.svg',
  'NTT':                          '/logos/ntt.svg',
  'NEXTDC':                       '/logos/nextdc.svg',
  // Wordmark logos
  'Singtel':                      '/logos/singtel.svg',
  'Lumen':                        '/logos/lumen.svg',
  'Tata Communications':          '/logos/tatacoms.svg',
  'PLDT':                         '/logos/pldt.svg',
  'Globe Telecom':                '/logos/globetelecom.svg',
  'StarHub':                      '/logos/starhub.svg',
  'Spark NZ':                     '/logos/sparknz.svg',
  'Telkom Indonesia':             '/logos/telkomindonesia.svg',
  'Telekom Malaysia':             '/logos/telekommalaysia.svg',
  'BT':                           '/logos/bt.svg',
  'Microsoft':                    '/logos/microsoft.svg',
  'KINX':                         '/logos/kinx.svg',
  'Converge ICT':                 '/logos/converge.svg',
  'Epsilon':                      '/logos/epsilon.svg',
  'eASPNet':                      '/logos/easpnet.svg',
  'e&':                           '/logos/eand.svg',
  'Reach':                        '/logos/reach.svg',
  'Southern Cross Cable Network': '/logos/southerncross.svg',
  'Hawaiian Telcom':              '/logos/hawaiiantelcom.svg',
  'Singapore Stock Exchange':     '/logos/sgx.svg',
  'Hong Kong Exchange':           '/logos/hkex.svg',
  'GTA':                          '/logos/gta.svg',
  'IT&E Overseas':                '/logos/ite.svg',
  'Djibouti Telecom':             '/logos/djiboutitelecom.svg',
  'Dynamic Computing Technology': '/logos/dct.svg',
  'BDX':                          '/logos/bdx.svg',
  'Seren Juno':                   '/logos/serenjuno.svg',
  'TIS':                          '/logos/tis.svg',
  'TBC':                          '/logos/tbc.svg',
  'Apricot Consortium':           '/logos/apricot.svg',
  'JGA Consortium':               '/logos/jga.svg',
  'Jupiter Consortium':           '/logos/jupiter.svg',
}

const TYPE_LABEL: Record<CableNode['type'], string> = {
  landing_station: 'Landing Station',
  primary_pop:     'Primary PoP',
  secondary_pop:   'Secondary PoP',
  extension_pop:   'Extension PoP',
  branching_unit:  'Branching Unit',
  off_net:         'Off-Net Node',
}

const TYPE_SHORT: Record<CableNode['type'], string> = {
  landing_station: 'CLS',
  primary_pop:     '1°PoP',
  secondary_pop:   '2°PoP',
  extension_pop:   'ExtPoP',
  branching_unit:  'BU',
  off_net:         'Off-Net',
}

function OwnerLogo({ owner }: { owner?: string }) {
  if (!owner) return null
  const logoUrl = OWNER_LOGOS[owner]
  const initial = owner.charAt(0).toUpperCase()
  const hue = [...owner].reduce((a, c) => a + c.charCodeAt(0), 0) % 360

  if (logoUrl) {
    return (
      <div style={{ background: '#fff', borderRadius: 5, padding: '3px 6px', display: 'flex', alignItems: 'center', height: 32, flexShrink: 0 }}>
        <img src={logoUrl} alt={owner} style={{ height: 20, maxWidth: 68, objectFit: 'contain' }} />
      </div>
    )
  }

  return (
    <div style={{
      width: 32, height: 32, borderRadius: 6, flexShrink: 0,
      background: `hsl(${hue}, 65%, 42%)`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 14, fontWeight: 800, color: '#fff',
    }}>
      {initial}
    </div>
  )
}

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export function NodeFinder({ nodes, onPinChange, onSetOrigin, onSetDest }: Props) {
  const t = useTheme()
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<Result[]>([])
  const [countryLabel, setCountryLabel] = useState<string | null>(null)

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    if (!query.trim() || loading) return
    setLoading(true)
    setError(null)
    setResults([])
    setCountryLabel(null)
    onPinChange(null, [])

    try {
      let lat: number, lng: number, countryCode: string, displayLabel: string, countryName: string

      const latLngMatch = query.trim().match(/^(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)$/)

      if (latLngMatch) {
        lat = parseFloat(latLngMatch[1])
        lng = parseFloat(latLngMatch[2])
        const res = await fetch(
          `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`
        )
        if (!res.ok) throw new Error('Reverse geocoding failed')
        const data = await res.json()
        countryCode = (data.address?.country_code ?? '').toUpperCase()
        countryName = data.address?.country ?? countryCode
        displayLabel = `${lat.toFixed(4)}, ${lng.toFixed(4)}`
      } else {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query.trim())}&format=json&limit=1&addressdetails=1`
        )
        if (!res.ok) throw new Error('Geocoding failed')
        const data = await res.json()
        if (!data.length) throw new Error('Address not found — try a more specific address')
        lat = parseFloat(data[0].lat)
        lng = parseFloat(data[0].lon)
        countryCode = (data[0].address?.country_code ?? '').toUpperCase()
        countryName = data[0].address?.country ?? countryCode
        displayLabel = data[0].display_name
      }

      const countryNodes = nodes.filter(n => n.country === countryCode && n.type !== 'branching_unit')
      if (countryNodes.length === 0) throw new Error(`No nodes found in ${countryName}`)

      const ranked = countryNodes
        .map(n => ({ node: n, distanceKm: haversine(lat, lng, n.lat, n.lng) }))
        .sort((a, b) => a.distanceKm - b.distanceKm)
        .slice(0, 3)

      setResults(ranked)
      setCountryLabel(countryName)
      onPinChange({ lat, lng, label: displayLabel }, ranked.map(r => r.node.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 11, color: t.textFaint, lineHeight: 1.5 }}>
        Enter a customer address or lat, lng to find the nearest network nodes.
      </div>

      <form onSubmit={handleSearch} style={{ display: 'flex', gap: 6 }}>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Address or lat, lng"
          style={{
            flex: 1, padding: '6px 8px', borderRadius: 4,
            border: `1px solid ${t.border}`, background: t.bgInput,
            color: t.text, fontSize: 13, outline: 'none',
          }}
        />
        <button
          type="submit"
          disabled={loading || !query.trim()}
          style={{
            padding: '6px 12px', borderRadius: 4, border: 'none', flexShrink: 0,
            background: loading || !query.trim() ? t.borderSubtle : t.blue,
            color: loading || !query.trim() ? t.textFaint : t.bgBase,
            fontWeight: 700, cursor: loading || !query.trim() ? 'not-allowed' : 'pointer',
            fontSize: 13,
          }}
        >
          {loading ? '…' : '↵'}
        </button>
      </form>

      {error && (
        <div style={{
          fontSize: 12, color: t.red, padding: '6px 8px', borderRadius: 4,
          background: 'rgba(243,139,168,0.1)', border: `1px solid ${t.red}`,
        }}>
          {error}
        </div>
      )}

      {results.length > 0 && (
        <>
          <div style={{ fontSize: 11, color: t.textFaint }}>
            Nearest nodes in <strong style={{ color: t.textMuted }}>{countryLabel}</strong>
          </div>

          {results.map((r, i) => {
            const n = r.node
            const showTrading = n.trading_name && n.trading_name !== n.name
            return (
              <div key={n.id} style={{
                borderRadius: 6, border: `1px solid ${t.border}`,
                background: t.bgCard, padding: '10px 10px 8px',
                display: 'flex', flexDirection: 'column', gap: 7,
              }}>
                {/* Header row: logo + name + type badge */}
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9 }}>
                  <OwnerLogo owner={n.owner} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 11, color: t.textFaintest, fontWeight: 700, minWidth: 12 }}>{i + 1}</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: t.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {n.name}
                      </span>
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 3, marginLeft: 'auto',
                        background: t.bgDeep, color: t.textFaint, letterSpacing: '0.05em', flexShrink: 0,
                      }}>
                        {TYPE_SHORT[n.type]}
                      </span>
                    </div>

                    {/* Trading name */}
                    {showTrading && (
                      <div style={{ fontSize: 11, color: t.textMuted, marginTop: 2, paddingLeft: 17 }}>
                        {n.trading_name}
                      </div>
                    )}

                    {/* Owner + Type */}
                    <div style={{ display: 'flex', gap: 10, marginTop: 3, paddingLeft: 17, flexWrap: 'wrap' }}>
                      {n.owner && (
                        <span style={{ fontSize: 11, color: t.blue }}>{n.owner}</span>
                      )}
                      <span style={{ fontSize: 11, color: t.textFaint }}>{TYPE_LABEL[n.type]}</span>
                    </div>
                  </div>
                </div>

                {/* Distance + ID */}
                <div style={{ fontSize: 12, color: t.textFaint, paddingLeft: 41 }}>
                  {Math.round(r.distanceKm).toLocaleString()} km straight line · <code style={{ fontSize: 11, color: t.textMuted }}>{n.id}</code>
                </div>

                {/* Product coverage traffic lights */}
                {n.capabilities && (() => {
                  const cap = n.capabilities
                  const bb = cap.backbone
                  const ul = cap.underlay
                  const indicators: { label: string; active: boolean; sub?: string }[] = [
                    { label: 'Backbone', active: !!(bb?.ipt?.length || bb?.epl?.length || bb?.evpl?.length) },
                    { label: 'Underlay', active: !!(ul?.gid?.length || ul?.ipvpn?.length) },
                    { label: 'Colo',     active: !!cap.colocation, sub: cap.colocation ? `Cat ${cap.colocation.category}` : undefined },
                  ]
                  return (
                    <div style={{ display: 'flex', gap: 10, paddingLeft: 41, alignItems: 'center' }}>
                      {indicators.map(({ label, active, sub }) => (
                        <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <div style={{
                            width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                            background: active ? '#16a34a' : '#3f0f0f',
                            border: `1px solid ${active ? '#22c55e' : '#7f1d1d'}`,
                            boxShadow: active ? '0 0 5px rgba(34,197,94,0.6)' : '0 0 3px rgba(239,68,68,0.2)',
                          }} />
                          <span style={{ fontSize: 9, fontWeight: 600, color: active ? '#6b7280' : '#374151' }}>
                            {sub ?? label}
                          </span>
                        </div>
                      ))}
                    </div>
                  )
                })()}

                {/* Action buttons */}
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => onSetOrigin(n.id)} style={{
                    flex: 1, padding: '4px 6px', borderRadius: 3, fontSize: 11, fontWeight: 600,
                    border: `1px solid ${t.blue}`, background: 'transparent', color: t.blue, cursor: 'pointer',
                  }}>
                    Set Origin
                  </button>
                  <button onClick={() => onSetDest(n.id)} style={{
                    flex: 1, padding: '4px 6px', borderRadius: 3, fontSize: 11, fontWeight: 600,
                    border: `1px solid ${t.green}`, background: 'transparent', color: t.green, cursor: 'pointer',
                  }}>
                    Set Dest
                  </button>
                </div>
              </div>
            )
          })}

          <div style={{ fontSize: 10, color: t.textFaintest }}>
            Geocoding by{' '}
            <a href="https://nominatim.openstreetmap.org" target="_blank" rel="noreferrer" style={{ color: t.textFaintest }}>
              Nominatim / OSM
            </a>
          </div>
        </>
      )}
    </div>
  )
}
