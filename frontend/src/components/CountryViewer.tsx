/**
 * CountryViewer — sidebar panel for exploring which submarine cable systems land in a country.
 *
 * Builds a searchable country list from the countries of all non-branching-unit nodes,
 * using a local ISO-code -> display-name table. Selecting a country computes a
 * CountryHighlight describing everything the map should emphasise for that country:
 *   - the set of cable systems whose wet segments (submarine sections) touch any CLS
 *     (Cable Landing Station) in the country, each assigned an evenly-spaced HSL colour;
 *   - terrestrial segments with at least one endpoint in the country;
 *   - the country's node IDs, centroid and lat/lng bounds (longitudes are normalised
 *     across the antimeridian so Pacific countries get sane bounding boxes).
 * The highlight is pushed up via onSelect(highlight | null); clicking the selected
 * country again (or the × button) clears it. A detail card lists the landing systems
 * with their legend colours.
 *
 * Props: nodes / segments / systems (full datasets from the parent), onSelect callback.
 * Mounted from: App.tsx (desktop sidebar, "Countries" mode) and MobileLayout.tsx (mobile tab).
 * Backend endpoints: none — all derivation happens client-side from props.
 */
import { useEffect, useMemo, useState } from 'react'
import type { CableNode, CableSegment, CableSystem, CountryHighlight } from '../types'
import { useTheme } from '../theme'

const COUNTRY_NAMES: Record<string, string> = {
  AE: 'United Arab Emirates', AU: 'Australia', BD: 'Bangladesh', BH: 'Bahrain',
  BR: 'Brazil', CA: 'Canada', CL: 'Chile', CN: 'China', CO: 'Colombia',
  CR: 'Costa Rica', CY: 'Cyprus', DJ: 'Djibouti', EG: 'Egypt', ES: 'Spain',
  FR: 'France', GB: 'United Kingdom', GR: 'Greece', GU: 'Guam', HK: 'Hong Kong',
  ID: 'Indonesia', IL: 'Israel', IN: 'India', IT: 'Italy', JP: 'Japan',
  KE: 'Kenya', KR: 'South Korea', KW: 'Kuwait', LK: 'Sri Lanka', MG: 'Madagascar',
  MU: 'Mauritius', MV: 'Maldives', MY: 'Malaysia', MX: 'Mexico', NG: 'Nigeria',
  NL: 'Netherlands', NZ: 'New Zealand', OM: 'Oman', PA: 'Panama', PE: 'Peru',
  PH: 'Philippines', PK: 'Pakistan', PT: 'Portugal', QA: 'Qatar', RE: 'Réunion',
  SA: 'Saudi Arabia', SG: 'Singapore', SN: 'Senegal', TH: 'Thailand',
  TR: 'Turkey', TW: 'Taiwan', TZ: 'Tanzania', US: 'United States',
  VN: 'Vietnam', YE: 'Yemen', ZA: 'South Africa', RU: 'Russia',
  UA: 'Ukraine', PL: 'Poland', SE: 'Sweden', NO: 'Norway', DK: 'Denmark',
  FI: 'Finland', DE: 'Germany', BE: 'Belgium', AT: 'Austria', CH: 'Switzerland',
}

function genCountryColors(n: number): string[] {
  if (n === 0) return []
  return Array.from({ length: n }, (_, i) => {
    const hue = Math.round((i * 360) / n)
    return `hsl(${hue}, 70%, 38%)`
  })
}

function normalizeLng(lng: number): number {
  return lng < -30 ? lng + 360 : lng
}

interface Props {
  nodes: CableNode[]
  segments: CableSegment[]
  systems: CableSystem[]
  onSelect: (h: CountryHighlight | null) => void
}

export function CountryViewer({ nodes, segments, systems, onSelect }: Props) {
  const t = useTheme()
  const [query, setQuery] = useState('')
  const [selectedCode, setSelectedCode] = useState<string | null>(null)

  const countryList = useMemo(() => {
    const codes = new Set<string>()
    for (const n of nodes) {
      if (n.type !== 'branching_unit') codes.add(n.country)
    }
    return Array.from(codes)
      .map(code => ({ code, name: COUNTRY_NAMES[code] ?? code }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [nodes])

  const filtered = useMemo(() => {
    if (!query) return countryList
    const q = query.toLowerCase()
    return countryList.filter(c =>
      c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q)
    )
  }, [countryList, query])

  const systemsById = useMemo(() =>
    Object.fromEntries(systems.map(s => [s.id, s])), [systems])

  function buildHighlight(code: string): CountryHighlight | null {
    const countryNodes = nodes.filter(n => n.country === code && n.type !== 'branching_unit')
    if (countryNodes.length === 0) return null

    const nodeIds = new Set(countryNodes.map(n => n.id))
    const clsIds = new Set(countryNodes.filter(n => n.type === 'landing_station').map(n => n.id))

    // Systems touching any CLS in this country (via wet segments)
    const touchingSysIds = new Set<string>()
    for (const seg of segments) {
      if (seg.type === 'wet' && (clsIds.has(seg.start_node_id) || clsIds.has(seg.end_node_id))) {
        touchingSysIds.add(seg.system_id)
      }
    }

    // Terrestrial segments with at least one endpoint in the country
    const terrestrialSegIds = new Set<string>()
    for (const seg of segments) {
      if (seg.type === 'terrestrial' &&
          (nodeIds.has(seg.start_node_id) || nodeIds.has(seg.end_node_id))) {
        terrestrialSegIds.add(seg.id)
      }
    }

    const sysIdArray = Array.from(touchingSysIds).filter(id => id !== 'TERRESTRIAL')
    const colors = genCountryColors(sysIdArray.length)
    const systemColors = new Map<string, string>()
    sysIdArray.forEach((id, i) => systemColors.set(id, colors[i]))

    const lats = countryNodes.map(n => n.lat)
    const lngs = countryNodes.map(n => normalizeLng(n.lng))
    const minLat = Math.min(...lats), maxLat = Math.max(...lats)
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs)

    return {
      countryCode: code,
      countryName: COUNTRY_NAMES[code] ?? code,
      systemIds: touchingSysIds,
      systemColors,
      terrestrialSegIds,
      nodeIds,
      centroid: [(minLat + maxLat) / 2, (minLng + maxLng) / 2],
      boundsLL: [[minLat, minLng], [maxLat, maxLng]],
    }
  }

  const selectedHighlight = useMemo(() =>
    selectedCode ? buildHighlight(selectedCode) : null
  // eslint-disable-next-line react-hooks/exhaustive-deps
  , [selectedCode, nodes, segments])

  useEffect(() => {
    onSelect(selectedHighlight)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedHighlight])

  function handleSelect(code: string) {
    setSelectedCode(prev => prev === code ? null : code)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

      {/* Search */}
      <input
        type="text"
        placeholder="Search countries…"
        value={query}
        onChange={e => setQuery(e.target.value)}
        style={{
          width: '100%', padding: '6px 8px', borderRadius: 4, boxSizing: 'border-box',
          border: `1px solid ${t.border}`, background: t.bgInput, color: t.text,
          fontSize: 13, outline: 'none',
        }}
      />

      {/* Selected country detail panel */}
      {selectedHighlight && (
        <div style={{
          border: `1px solid ${t.border}`, borderRadius: 6,
          background: t.bgBase, overflow: 'hidden',
        }}>
          <div style={{
            padding: '8px 10px', borderBottom: `1px solid ${t.border}`,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <div>
              <span style={{ fontSize: 13, fontWeight: 700, color: t.text }}>
                {selectedHighlight.countryName}
              </span>
              <span style={{ fontSize: 11, color: t.textFaint, marginLeft: 6 }}>
                {selectedHighlight.countryCode}
              </span>
            </div>
            <button
              onClick={() => handleSelect(selectedCode!)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: t.textFaint, fontSize: 16, padding: '0 2px' }}
            >×</button>
          </div>

          <div style={{ padding: '8px 10px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: t.textFaint, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
              Cable Systems ({selectedHighlight.systemIds.size})
            </div>
            {selectedHighlight.systemIds.size === 0 ? (
              <div style={{ fontSize: 12, color: t.textFaintest }}>No cable systems land here</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {Array.from(selectedHighlight.systemIds).filter(id => id !== 'TERRESTRIAL').map(sysId => {
                  const color = selectedHighlight.systemColors.get(sysId) ?? t.blue
                  const sys = systemsById[sysId]
                  return (
                    <div key={sysId} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <div style={{
                        width: 8, height: 8, borderRadius: '50%',
                        background: color, flexShrink: 0,
                        boxShadow: `0 0 6px ${color}`,
                      }} />
                      <span style={{ fontSize: 12, color: t.text }}>
                        {sys?.name ?? sysId}
                      </span>
                      <span style={{ fontSize: 10, color: t.textFaint }}>{sysId}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Country list */}
      <div style={{ border: `1px solid ${t.border}`, borderRadius: 4, background: t.bgInput, overflow: 'hidden' }}>
        {filtered.map((c, i) => {
          const isSelected = c.code === selectedCode
          return (
            <div
              key={c.code}
              onClick={() => handleSelect(c.code)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '7px 10px', cursor: 'pointer',
                borderBottom: i < filtered.length - 1 ? `1px solid ${t.border}` : 'none',
                background: isSelected ? t.bgDeep : 'transparent',
                transition: 'background 0.1s',
              }}
            >
              <div style={{
                width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
                background: isSelected ? t.blue : 'transparent',
                border: `2px solid ${isSelected ? t.blue : t.borderSubtle}`,
                transition: 'all 0.15s',
              }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 12, fontWeight: isSelected ? 600 : 400, color: isSelected ? t.text : t.textMuted }}>
                  {c.name}
                </span>
              </div>
              <span style={{ fontSize: 10, color: t.textFaint, fontFamily: 'monospace' }}>
                {c.code}
              </span>
            </div>
          )
        })}
        {filtered.length === 0 && (
          <div style={{ padding: '14px 10px', fontSize: 12, color: t.textFaint, textAlign: 'center' }}>
            No countries match "{query}"
          </div>
        )}
      </div>

      {!selectedCode && (
        <p style={{ fontSize: 12, color: t.textFaintest, margin: 0 }}>
          Select a country to highlight its cable systems on the map.
        </p>
      )}
    </div>
  )
}
