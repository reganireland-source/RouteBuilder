/**
 * NodeFinder — node lookup by code, or "nearest node" search from an address.
 *
 * The one search box serves two lookup paths, decided by what the user typed:
 *
 *  1. NODE CODE (e.g. SYD1, PALI, EQ-PE1). If the trimmed input matches a loaded
 *     node's `id` case-insensitively it is a direct lookup — no geocoding, no
 *     nearest-neighbour ranking — and `onGoToNode` flies the map to it. Matching is
 *     done against the real loaded ids rather than a "4 letters" shape rule, because
 *     ids vary in length (SYD1, BRQ1, EQ-PE1, JGABU1); ids are normalised upper-case
 *     in this dataset, so upper-casing the input is enough to compare. While typing,
 *     ids that start with the input are offered as a tappable shortlist — half-
 *     remembered codes are the common case. An input that LOOKS like a code but
 *     matches nothing is reported as such instead of being handed to the geocoder,
 *     which would answer a nonsense string like "ZZZZ" with a confusing address
 *     error; a one-tap escape hatch runs the address search anyway, so an all-caps
 *     place name is never a dead end.
 *
 *  2. ADDRESS or raw "lat, lng" pair. Geocoded with the public OpenStreetMap
 *     Nominatim API (forward search for addresses, reverse for coordinates — both
 *     direct browser fetch() calls, not our backend), then the network nodes in the
 *     resolved country are ranked by straight-line (haversine) distance and the
 *     closest three shown as cards. Branching units are excluded.
 *
 * Both paths render the same card: owner logo (or a generated initial tile), node type
 * badge (CLS = Cable Landing Station, PoP tiers, etc.), distance (ranked results only),
 * and traffic-light dots for product coverage (Backbone / Underlay / Colocation) when
 * the node has capabilities data.
 *
 * Props:
 *   - nodes:       full CableNode list — ranked against, and the source of truth for
 *                  which code lookups/suggestions are valid.
 *   - onPinChange: reports the geocoded pin ({lat, lng, label}) and the nearest node IDs
 *                  so the parent can drop a marker and highlight those nodes on the map;
 *                  called with (null, []) when a new search starts, and with
 *                  (null, [nodeId]) on a code hit so the node lights up on the map even
 *                  when no onGoToNode handler is wired.
 *   - onGoToNode:  optional — a code hit asks the parent to fly the map to that node and
 *                  open its info. Absent, the component still shows the node as a single
 *                  result card, so the lookup degrades instead of doing nothing.
 *   - onSetOrigin / onSetDest: "Set Origin"/"Set Dest" buttons feed a node straight into
 *                  the route builder's endpoint pickers.
 *
 * Mounted from: App.tsx (desktop sidebar, "Node Finder" mode) and MobileLayout.tsx.
 * Backend endpoints: none of ours — only https://nominatim.openstreetmap.org search/reverse.
 */
import { useMemo, useState } from 'react'
import type { CableNode } from '../types'
import { useTheme } from '../theme'

interface Props {
  nodes: CableNode[]
  onPinChange: (pin: { lat: number; lng: number; label: string } | null, nearestIds: string[]) => void
  onSetOrigin: (nodeId: string) => void
  onSetDest: (nodeId: string) => void
  /** Jump the map to this node and select it. When absent, the code lookup
   *  falls back to showing the node as a single result. */
  onGoToNode?: (nodeId: string) => void
}

interface Result {
  node: CableNode
  /** null for a direct code lookup — there is no origin point to measure from. */
  distanceKm: number | null
}

/** Resolved geocoder answer, shared by the address and lat/lng paths. */
interface Geo {
  lat: number
  lng: number
  countryCode: string
  countryName: string
  displayLabel: string
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

const LAT_LNG_RE = /^(-?\d+(?:\.\d*)?)\s*,\s*(-?\d+(?:\.\d*)?)$/
/** One token of letters/digits/hyphens: the shape every node id has, from SYD1 and
 *  EQ-PE1 up to the longest in the dataset, APRICOTBU1. */
const CODE_SHAPE_RE = /^[A-Z0-9][A-Z0-9-]{1,11}$/
const MAX_SUGGESTIONS = 8

/** Node ids are stored upper-case, so upper-casing the input is the whole comparison. */
function findNodeByCode(nodes: CableNode[], raw: string): CableNode | undefined {
  const code = raw.trim().toUpperCase()
  return code ? nodes.find(n => n.id.toUpperCase() === code) : undefined
}

/**
 * Would a reasonable user have meant this as a node code? Only consulted once an exact
 * id match has already failed, to decide between "no such node" and a silent fall-through
 * to the geocoder. Deliberately conservative: a lower-case word with no digit (paris,
 * chennai) stays an address, because single-word city searches must keep working.
 */
function looksLikeNodeCode(raw: string): boolean {
  const trimmed = raw.trim()
  if (!CODE_SHAPE_RE.test(trimmed.toUpperCase())) return false
  if (!/[A-Z]/i.test(trimmed)) return false
  return /\d/.test(trimmed) || trimmed === trimmed.toUpperCase()
}

/** Ids starting with what has been typed so far, for the tap-ahead shortlist. */
function codeSuggestions(nodes: CableNode[], raw: string): CableNode[] {
  const code = raw.trim().toUpperCase()
  if (code.length < 2 || !CODE_SHAPE_RE.test(code)) return []
  const hits = nodes.filter(n => n.id.toUpperCase().startsWith(code))
  // A lone exact hit is already one Enter away; a list of one adds nothing.
  if (hits.length === 1 && hits[0].id.toUpperCase() === code) return []
  return hits.sort((a, b) => a.id.localeCompare(b.id)).slice(0, MAX_SUGGESTIONS)
}

async function reverseGeocode(lat: number, lng: number): Promise<Geo> {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`
  )
  if (!res.ok) throw new Error('Reverse geocoding failed')
  const data = await res.json()
  const countryCode = (data.address?.country_code ?? '').toUpperCase()
  return {
    lat, lng, countryCode,
    countryName: data.address?.country ?? countryCode,
    displayLabel: `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
  }
}

async function forwardGeocode(address: string): Promise<Geo> {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1&addressdetails=1`
  )
  if (!res.ok) throw new Error('Geocoding failed')
  const data = await res.json()
  if (!data.length) throw new Error('Address not found — try a more specific address')
  const countryCode = (data[0].address?.country_code ?? '').toUpperCase()
  return {
    lat: parseFloat(data[0].lat),
    lng: parseFloat(data[0].lon),
    countryCode,
    countryName: data[0].address?.country ?? countryCode,
    displayLabel: data[0].display_name,
  }
}

function geocode(raw: string): Promise<Geo> {
  const latLng = LAT_LNG_RE.exec(raw)
  return latLng
    ? reverseGeocode(parseFloat(latLng[1]), parseFloat(latLng[2]))
    : forwardGeocode(raw)
}

function rankNearest(nodes: CableNode[], geo: Geo): Result[] {
  return nodes
    .filter(n => n.country === geo.countryCode && n.type !== 'branching_unit')
    .map(n => ({ node: n, distanceKm: haversine(geo.lat, geo.lng, n.lat, n.lng) }))
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, 3)
}

export function NodeFinder({ nodes, onPinChange, onSetOrigin, onSetDest, onGoToNode }: Props) {
  const t = useTheme()
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<Result[]>([])
  const [countryLabel, setCountryLabel] = useState<string | null>(null)
  /** The unmatched code the user submitted, kept so we can offer to geocode it anyway. */
  const [missedCode, setMissedCode] = useState<string | null>(null)

  const suggestions = useMemo(() => codeSuggestions(nodes, query), [nodes, query])

  function resetOutput() {
    setError(null)
    setResults([])
    setCountryLabel(null)
    setMissedCode(null)
  }

  function goToNode(node: CableNode) {
    resetOutput()
    setQuery(node.id)
    // Highlight it even when the parent has no fly-to wired — onPinChange's second
    // argument is what recolours nodes on the map.
    onPinChange(null, [node.id])
    onGoToNode?.(node.id)
    setResults([{ node, distanceKm: null }])
  }

  async function runAddressSearch(raw: string) {
    setLoading(true)
    resetOutput()
    onPinChange(null, [])
    try {
      const geo = await geocode(raw)
      const ranked = rankNearest(nodes, geo)
      if (ranked.length === 0) throw new Error(`No nodes found in ${geo.countryName}`)
      setResults(ranked)
      setCountryLabel(geo.countryName)
      onPinChange({ lat: geo.lat, lng: geo.lng, label: geo.displayLabel }, ranked.map(r => r.node.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed')
    } finally {
      setLoading(false)
    }
  }

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    const raw = query.trim()
    if (!raw || loading) return

    const match = findNodeByCode(nodes, raw)
    if (match) { goToNode(match); return }

    if (looksLikeNodeCode(raw)) {
      resetOutput()
      onPinChange(null, [])
      setMissedCode(raw.toUpperCase())
      setError(`No node with code "${raw.toUpperCase()}".`)
      return
    }

    await runAddressSearch(raw)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 11, color: t.textFaint, lineHeight: 1.5 }}>
        Enter a customer address or lat, lng for the nearest network nodes, or a node
        code (e.g. SYD1) to jump straight to it.
      </div>

      <form onSubmit={handleSearch} style={{ display: 'flex', gap: 6 }}>
        <input
          value={query}
          onChange={e => { setQuery(e.target.value); setError(null); setMissedCode(null) }}
          placeholder="Address, lat/lng, or node code"
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

      {suggestions.length > 0 && (
        <div style={{
          display: 'flex', flexDirection: 'column',
          borderRadius: 6, border: `1px solid ${t.border}`, background: t.bgCard, overflow: 'hidden',
        }}>
          {suggestions.map((n, i) => (
            <button
              key={n.id}
              type="button"
              onClick={() => goToNode(n)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                padding: '9px 10px', minHeight: 36, textAlign: 'left',
                border: 'none', borderTop: i === 0 ? 'none' : `1px solid ${t.borderSubtle}`,
                background: 'transparent', color: t.text, cursor: 'pointer', font: 'inherit',
              }}
            >
              <code style={{ fontSize: 12, fontWeight: 800, color: t.blue, flexShrink: 0 }}>{n.id}</code>
              <span style={{ fontSize: 11, color: t.textFaint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {n.name}
              </span>
              <span style={{ fontSize: 10, color: t.textFaintest, marginLeft: 'auto', flexShrink: 0 }}>
                {TYPE_SHORT[n.type]}
              </span>
            </button>
          ))}
        </div>
      )}

      {error && (
        <div style={{
          fontSize: 12, color: t.red, padding: '6px 8px', borderRadius: 4,
          background: 'rgba(243,139,168,0.1)', border: `1px solid ${t.red}`,
        }}>
          {error}
          {missedCode && (
            <button
              type="button"
              onClick={() => { const q = missedCode; setMissedCode(null); void runAddressSearch(q) }}
              style={{
                display: 'block', marginTop: 6, padding: '5px 8px', minHeight: 30,
                borderRadius: 3, border: `1px solid ${t.border}`, background: 'transparent',
                color: t.textMuted, fontSize: 11, fontWeight: 600, cursor: 'pointer',
              }}
            >
              Search “{missedCode}” as an address instead
            </button>
          )}
        </div>
      )}

      {results.length > 0 && (
        <>
          <div style={{ fontSize: 11, color: t.textFaint }}>
            {countryLabel
              ? <>Nearest nodes in <strong style={{ color: t.textMuted }}>{countryLabel}</strong></>
              : <>Node <strong style={{ color: t.textMuted }}>{results[0].node.id}</strong></>}
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
                      {/* Rank number only means something for a ranked list; the empty
                          span keeps the card's 17px text indent for a code lookup. */}
                      <span style={{ fontSize: 11, color: t.textFaintest, fontWeight: 700, minWidth: 12 }}>
                        {r.distanceKm == null ? '' : i + 1}
                      </span>
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
                  {r.distanceKm != null && `${Math.round(r.distanceKm).toLocaleString()} km straight line · `}
                  <code style={{ fontSize: 11, color: t.textMuted }}>{n.id}</code>
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

          {/* Attribution is owed only when Nominatim actually produced the result. */}
          <div style={{ fontSize: 10, color: t.textFaintest, display: countryLabel ? undefined : 'none' }}>
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
