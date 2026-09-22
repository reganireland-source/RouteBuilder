/**
 * ============================================================================
 *  AssetFilterBar.tsx — the "Asset Filter" dropdown at the top of the map.
 * ============================================================================
 *
 * A collapsed pill button (matching the top-right "Controls" button's own
 * convention) that expands into a panel with two independent things in it:
 *
 * 1. THE SAME "one box" search AssetSearch.tsx already is (mounted here
 *    verbatim, not reimplemented) — picking a result zooms/selects it via
 *    whatever onAssetSelect the host passes (App.tsx's handleAssetSelect),
 *    exactly like the left-panel search does. It is deliberately independent
 *    of the badges below: typing a name finds one specific thing regardless
 *    of what's filtered, the badges dim/highlight the whole map.
 *
 * 2. A faceted set of clickable badges across every asset field worth
 *    slicing the network by — see utils/assetFilters.ts for the actual
 *    matching logic (kept there, pure, so it's independently testable and
 *    Map.tsx could theoretically reuse it without this UI). Categories AND
 *    together, badges within one category OR together, an empty category
 *    imposes no constraint. The result is reported upward as an
 *    AssetFilterMatch (two id sets + an `active` flag) via onFilterChange;
 *    this component does not touch the map itself — Map.tsx dims whatever
 *    isn't in those sets, the same way it already dims for Country Viewer.
 *
 * Selections persist to localStorage (rb.assetFilter), matching every other
 * map toggle in this app. Mounted once per render (App.tsx's desktop layout
 * XOR MobileLayout — never both), so there is exactly one live copy of the
 * selection at a time; switching layouts (e.g. resizing past the mobile
 * breakpoint) just remounts and re-reads the same stored selection.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { CableNode, CableSegment, CableSystem, SegmentCapacity, NodeType, Ownership, OnNet, AssetFilterMatch } from '../types'
import type { AssetHit } from '../utils/assetSearch'
import {
  type AssetFilterSelection, type AssetKindFilter,
  emptyAssetFilterSelection, isAssetFilterActive, nodeMatchesFilter, segmentMatchesFilter,
  distinctFacilityOwners, distinctCountries,
} from '../utils/assetFilters'
import { NODE_TYPE_LABEL } from '../mapGeometry'
import { useTheme } from '../theme'
import type { Theme } from '../theme'
import { AssetSearch } from './AssetSearch'

const STORAGE_KEY = 'rb.assetFilter'

const NODE_TYPE_OPTS: NodeType[] = [
  'landing_station', 'primary_pop', 'secondary_pop', 'extension_pop', 'branching_unit', 'off_net',
]
const OWNERSHIP_OPTS: [Ownership, string][] = [
  ['owned', 'Owned'],
  ['consortium', 'Consortium'],
  ['iru', 'IRU'],
  ['integrated_lit_lease', 'Integrated Lit Lease'],
  ['offnet_resell', 'Offnet Resell'],
]
/** Preset thresholds for the "available capacity below X%" badge — a slider
 *  would invite a value with no round-number meaning to anyone reading the
 *  map over your shoulder; these four cover the range planners actually ask. */
const CAPACITY_PRESETS = [10, 20, 30, 50]

/** ISO code → display name. Kept local, matching the existing convention in
 *  SearchForm / AssetSearch / CountryViewer / CityPairPanel, each of which
 *  already carries its own copy rather than a shared module. */
const COUNTRY_NAMES: Record<string, string> = {
  AE: 'United Arab Emirates', AU: 'Australia', AT: 'Austria', BD: 'Bangladesh',
  BE: 'Belgium', BH: 'Bahrain', BR: 'Brazil', CA: 'Canada', CH: 'Switzerland',
  CL: 'Chile', CN: 'China', CO: 'Colombia', CR: 'Costa Rica', CY: 'Cyprus',
  DE: 'Germany', DJ: 'Djibouti', DK: 'Denmark', EG: 'Egypt', ES: 'Spain',
  FI: 'Finland', FJ: 'Fiji', FR: 'France', GB: 'United Kingdom', GR: 'Greece',
  GU: 'Guam', HK: 'Hong Kong', ID: 'Indonesia', IL: 'Israel', IN: 'India',
  IT: 'Italy', JP: 'Japan', KE: 'Kenya', KH: 'Cambodia', KR: 'South Korea',
  KW: 'Kuwait', LK: 'Sri Lanka', MG: 'Madagascar', MM: 'Myanmar',
  MP: 'Northern Mariana Islands', MU: 'Mauritius', MV: 'Maldives',
  MX: 'Mexico', MY: 'Malaysia', NG: 'Nigeria', NL: 'Netherlands',
  NO: 'Norway', NZ: 'New Zealand', OM: 'Oman', PA: 'Panama', PE: 'Peru',
  PH: 'Philippines', PK: 'Pakistan', PL: 'Poland', PT: 'Portugal',
  QA: 'Qatar', RE: 'Réunion', RU: 'Russia', SA: 'Saudi Arabia', SE: 'Sweden',
  SG: 'Singapore', SN: 'Senegal', TH: 'Thailand', TR: 'Turkey', TW: 'Taiwan',
  TZ: 'Tanzania', UA: 'Ukraine', US: 'United States', VN: 'Vietnam',
  VU: 'Vanuatu', YE: 'Yemen', ZA: 'South Africa',
}

interface StoredSelection {
  kinds: AssetKindFilter[]
  nodeTypes: NodeType[]
  onNet: OnNet[]
  ownerships: Ownership[]
  facilityOwners: string[]
  countries: string[]
  capacityBelowPct: number | null
}

function loadSelection(): AssetFilterSelection {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return emptyAssetFilterSelection()
    const parsed = JSON.parse(raw) as Partial<StoredSelection>
    return {
      kinds: new Set(parsed.kinds ?? []),
      nodeTypes: new Set(parsed.nodeTypes ?? []),
      onNet: new Set(parsed.onNet ?? []),
      ownerships: new Set(parsed.ownerships ?? []),
      facilityOwners: new Set(parsed.facilityOwners ?? []),
      countries: new Set(parsed.countries ?? []),
      capacityBelowPct: parsed.capacityBelowPct ?? null,
    }
  } catch {
    return emptyAssetFilterSelection()
  }
}

function saveSelection(sel: AssetFilterSelection) {
  try {
    const stored: StoredSelection = {
      kinds: [...sel.kinds], nodeTypes: [...sel.nodeTypes], onNet: [...sel.onNet],
      ownerships: [...sel.ownerships], facilityOwners: [...sel.facilityOwners], countries: [...sel.countries],
      capacityBelowPct: sel.capacityBelowPct,
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))
  } catch {
    // Private browsing / quota exceeded — the filter just won't persist.
  }
}

function toggleInSet<V>(set: Set<V>, value: V): Set<V> {
  const next = new Set(set)
  if (next.has(value)) next.delete(value)
  else next.add(value)
  return next
}

function Badge({ label, active, color, onClick }: {
  label: string; active: boolean; color: string; onClick: () => void
}) {
  const t = useTheme()
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 12,
        border: `1px solid ${active ? color : t.border}`,
        background: active ? color + '22' : 'transparent',
        color: active ? color : t.textMuted,
        cursor: 'pointer', whiteSpace: 'nowrap',
      }}
    >{label}</button>
  )
}

function FilterGroup({ t, label, scroll = false, children }: {
  t: Theme; label: string; scroll?: boolean; children: React.ReactNode
}) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{
        fontSize: 10, fontWeight: 700, color: t.textFaint,
        textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 5,
      }}>{label}</div>
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: 5,
        ...(scroll ? { maxHeight: 140, overflowY: 'auto' as const, paddingRight: 2 } : {}),
      }}>{children}</div>
    </div>
  )
}

interface Props {
  nodes: CableNode[]
  segments: CableSegment[]
  systems: CableSystem[]
  capacity: SegmentCapacity[]
  /** AppConfig.on_net_ownership — which Ownership values count as on-net. */
  onNetOwnership: string[]
  /** The search half hands its pick straight to the host, same as the
   *  left-panel AssetSearch (App.tsx's handleAssetSelect). */
  onAssetSelect: (hit: AssetHit) => void
  /** Fired whenever the computed match changes (selection edit, or the
   *  underlying nodes/segments/capacity data itself changing). */
  onFilterChange: (match: AssetFilterMatch) => void
}

export function AssetFilterBar({ nodes, segments, systems, capacity, onNetOwnership, onAssetSelect, onFilterChange }: Props) {
  const t = useTheme()
  const [open, setOpen] = useState(false)
  const [sel, setSel] = useState<AssetFilterSelection>(loadSelection)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => { saveSelection(sel) }, [sel])

  // Click-outside closes, matching AssetSearch/Controls menu convention.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (containerRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  const nodesById = useMemo(() => Object.fromEntries(nodes.map(n => [n.id, n])), [nodes])
  const capacityById = useMemo(() => Object.fromEntries(capacity.map(c => [c.segment_id, c])), [capacity])
  const onNetSet = useMemo(() => new Set(onNetOwnership), [onNetOwnership])
  const facilityOwners = useMemo(() => distinctFacilityOwners(nodes), [nodes])
  const countries = useMemo(() => distinctCountries(nodes), [nodes])

  const match = useMemo<AssetFilterMatch>(() => {
    const active = isAssetFilterActive(sel)
    if (!active) return { active: false, nodeIds: new Set(), segmentIds: new Set() }
    return {
      active: true,
      nodeIds: new Set(nodes.filter(n => nodeMatchesFilter(n, sel)).map(n => n.id)),
      segmentIds: new Set(segments.filter(s => segmentMatchesFilter(s, sel, nodesById, onNetSet, capacityById)).map(s => s.id)),
    }
  }, [sel, nodes, segments, nodesById, onNetSet, capacityById])

  useEffect(() => { onFilterChange(match) }, [match, onFilterChange])

  const activeCount = sel.kinds.size + sel.nodeTypes.size + sel.onNet.size + sel.ownerships.size
    + sel.facilityOwners.size + sel.countries.size + (sel.capacityBelowPct !== null ? 1 : 0)

  function toggleKind(v: AssetKindFilter)   { setSel(s => ({ ...s, kinds: toggleInSet(s.kinds, v) })) }
  function toggleNodeType(v: NodeType)      { setSel(s => ({ ...s, nodeTypes: toggleInSet(s.nodeTypes, v) })) }
  function toggleOnNet(v: OnNet)            { setSel(s => ({ ...s, onNet: toggleInSet(s.onNet, v) })) }
  function toggleOwnership(v: Ownership)    { setSel(s => ({ ...s, ownerships: toggleInSet(s.ownerships, v) })) }
  function toggleFacilityOwner(v: string)   { setSel(s => ({ ...s, facilityOwners: toggleInSet(s.facilityOwners, v) })) }
  function toggleCountry(v: string)         { setSel(s => ({ ...s, countries: toggleInSet(s.countries, v) })) }
  function toggleCapacity(v: number)        { setSel(s => ({ ...s, capacityBelowPct: s.capacityBelowPct === v ? null : v })) }
  function clearAll()                       { setSel(emptyAssetFilterSelection()) }

  return (
    <div ref={containerRef} style={{ position: 'absolute', top: 12, left: 64, zIndex: 1090 }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 7,
          padding: '7px 14px', borderRadius: 10,
          border: `1px solid ${open || activeCount > 0 ? t.blue : t.border}`,
          background: open ? t.blue + '22' : t.bgPanel,
          color: open || activeCount > 0 ? t.blue : t.textMuted,
          cursor: 'pointer', fontSize: 12, fontWeight: 700,
          boxShadow: '0 2px 10px rgba(0,0,0,0.35)',
        }}
      >
        <span style={{ fontSize: 14, lineHeight: 1 }}>▾</span>
        Asset Filter
        {activeCount > 0 && (
          <span style={{
            fontSize: 10, fontWeight: 700, lineHeight: 1,
            background: t.blue + '33', color: t.blue, borderRadius: 10, padding: '2px 6px',
          }}>{activeCount}</span>
        )}
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0, width: 320, maxHeight: '75vh', overflowY: 'auto',
          background: t.bgPanel, border: `1px solid ${t.border}`, borderRadius: 10,
          boxShadow: '0 12px 36px rgba(0,0,0,0.45)', padding: 12,
        }}>
          <div style={{ marginBottom: 10 }}>
            <AssetSearch nodes={nodes} segments={segments} systems={systems} onSelect={hit => { onAssetSelect(hit); setOpen(false) }} />
          </div>

          <FilterGroup t={t} label="Show">
            <Badge label="PoPs" active={sel.kinds.has('node')} color={t.blue} onClick={() => toggleKind('node')} />
            <Badge label="Segments" active={sel.kinds.has('segment')} color={t.blue} onClick={() => toggleKind('segment')} />
          </FilterGroup>

          <FilterGroup t={t} label="On-Net / Off-Net">
            <Badge label="On-Net" active={sel.onNet.has('on_net')} color={t.green} onClick={() => toggleOnNet('on_net')} />
            <Badge label="Off-Net" active={sel.onNet.has('off_net')} color={t.orange} onClick={() => toggleOnNet('off_net')} />
          </FilterGroup>

          <FilterGroup t={t} label="PoP Type">
            {NODE_TYPE_OPTS.map(nt => (
              <Badge key={nt} label={NODE_TYPE_LABEL[nt] ?? nt} active={sel.nodeTypes.has(nt)} color={t.blue} onClick={() => toggleNodeType(nt)} />
            ))}
          </FilterGroup>

          <FilterGroup t={t} label="Ownership">
            {OWNERSHIP_OPTS.map(([v, label]) => (
              <Badge key={v} label={label} active={sel.ownerships.has(v)} color={t.pink} onClick={() => toggleOwnership(v)} />
            ))}
          </FilterGroup>

          <FilterGroup t={t} label="Capacity">
            {CAPACITY_PRESETS.map(p => (
              <Badge key={p} label={`<${p}% free`} active={sel.capacityBelowPct === p} color={t.red} onClick={() => toggleCapacity(p)} />
            ))}
          </FilterGroup>

          {facilityOwners.length > 0 && (
            <FilterGroup t={t} label="Facility Owner" scroll>
              {facilityOwners.map(o => (
                <Badge key={o} label={o} active={sel.facilityOwners.has(o)} color={t.blue} onClick={() => toggleFacilityOwner(o)} />
              ))}
            </FilterGroup>
          )}

          {countries.length > 0 && (
            <FilterGroup t={t} label="Country" scroll>
              {countries.map(c => (
                <Badge key={c} label={COUNTRY_NAMES[c] ?? c} active={sel.countries.has(c)} color={t.blue} onClick={() => toggleCountry(c)} />
              ))}
            </FilterGroup>
          )}

          {activeCount > 0 && (
            <button
              type="button"
              onClick={clearAll}
              style={{
                marginTop: 2, width: '100%', padding: '7px', borderRadius: 6,
                border: `1px solid ${t.border}`, background: 'transparent',
                color: t.textMuted, fontSize: 11, fontWeight: 700, cursor: 'pointer',
              }}
            >Clear all filters</button>
          )}
        </div>
      )}
    </div>
  )
}
