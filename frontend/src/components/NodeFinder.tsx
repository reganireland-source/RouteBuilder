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

  const typeTag = (type: CableNode['type']) =>
    type === 'landing_station' ? 'CLS' : type === 'terrestrial_pop' ? 'POP' : 'BU'

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
            color: t.text, fontSize: 13,
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

          {results.map((r, i) => (
            <div key={r.node.id} style={{
              borderRadius: 6, border: `1px solid ${t.border}`,
              background: t.bgCard, padding: '10px 10px 8px',
              display: 'flex', flexDirection: 'column', gap: 6,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 11, color: t.textFaintest, fontWeight: 700, minWidth: 12 }}>{i + 1}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: t.text }}>{r.node.name}</span>
                </div>
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
                  background: t.bgDeep, color: t.textFaint, letterSpacing: '0.05em', flexShrink: 0,
                }}>
                  {typeTag(r.node.type)}
                </span>
              </div>
              <div style={{ fontSize: 12, color: t.textFaint }}>
                {Math.round(r.distanceKm).toLocaleString()} km straight line · {r.node.id}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  onClick={() => onSetOrigin(r.node.id)}
                  style={{
                    flex: 1, padding: '4px 6px', borderRadius: 3, fontSize: 11, fontWeight: 600,
                    border: `1px solid ${t.blue}`, background: 'transparent', color: t.blue, cursor: 'pointer',
                  }}
                >
                  Set Origin
                </button>
                <button
                  onClick={() => onSetDest(r.node.id)}
                  style={{
                    flex: 1, padding: '4px 6px', borderRadius: 3, fontSize: 11, fontWeight: 600,
                    border: `1px solid ${t.green}`, background: 'transparent', color: t.green, cursor: 'pointer',
                  }}
                >
                  Set Dest
                </button>
              </div>
            </div>
          ))}

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
