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
 *    of the filters below: typing a name finds one specific thing regardless
 *    of what's filtered, the filters dim/highlight the whole map.
 *
 * 2. A faceted set of filters across every asset field worth slicing the
 *    network by — see utils/assetFilters.ts for the actual matching logic
 *    (kept there, pure, so it's independently testable and Map.tsx could
 *    theoretically reuse it without this UI). Each category is its OWN
 *    collapsed dropdown (a button that opens a small checklist), not a wall
 *    of always-visible badges — a category with 70 countries in it would
 *    otherwise dominate the whole panel. Only one category dropdown is open
 *    at a time. Categories AND together, choices within one category OR
 *    together, an empty category imposes no constraint. The result is
 *    reported upward as an AssetFilterMatch (two id sets + an `active` flag)
 *    via onFilterChange; this component does not touch the map itself —
 *    Map.tsx dims whatever isn't in those sets, the same way it already dims
 *    for Country Viewer.
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
import { AssetSearch } from './AssetSearch'
import { Tooltip } from './Tooltip'

const STORAGE_KEY = 'rb.assetFilter'

const KIND_OPTS: AssetKindFilter[] = ['node', 'segment']
const KIND_LABEL: Record<AssetKindFilter, string> = { node: 'PoPs', segment: 'Segments' }

const ON_NET_OPTS: OnNet[] = ['on_net', 'off_net']
const ON_NET_LABEL: Record<OnNet, string> = { on_net: 'On-Net', off_net: 'Off-Net' }

const NODE_TYPE_OPTS: NodeType[] = [
  'landing_station', 'primary_pop', 'secondary_pop', 'extension_pop', 'branching_unit', 'off_net',
]

const OWNERSHIP_OPTS: Ownership[] = ['owned', 'consortium', 'iru', 'integrated_lit_lease', 'offnet_resell']
const OWNERSHIP_LABEL: Record<Ownership, string> = {
  owned: 'Owned',
  consortium: 'Consortium',
  iru: 'IRU',
  integrated_lit_lease: 'Integrated Lit Lease',
  offnet_resell: 'Offnet Resell',
}

/** Preset thresholds for the "available capacity below X%" filter — a slider
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

/** Which category dropdown (if any) is currently open. Only one at a time. */
type Category = 'kinds' | 'onNet' | 'nodeTypes' | 'ownerships' | 'facilityOwners' | 'countries'

/** The localStorage-serializable shape of AssetFilterSelection: identical
 *  fields, but each Set<T> becomes a plain array (JSON has no Set type) —
 *  see loadSelection/saveSelection for the conversion in each direction. */
interface StoredSelection {
  kinds: AssetKindFilter[]
  nodeTypes: NodeType[]
  onNet: OnNet[]
  ownerships: Ownership[]
  facilityOwners: string[]
  countries: string[]
  capacityBelowPct: number | null
}

/** Read the persisted filter selection from localStorage, converting each
 *  stored array back into a Set. Falls back to an empty selection on missing
 *  data, malformed JSON, or a storage read failure (private browsing etc.) —
 *  `Partial<StoredSelection>` plus the `?? []` fallbacks below also cover a
 *  selection saved by an older app version that's missing newer fields. */
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

/** Persist the current selection to localStorage, converting each Set to a
 *  plain array for JSON. Swallows write failures (private browsing / quota) —
 *  the filter just won't survive a reload, which is a safe degrade. */
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

/** Immutably add `value` to `set` if absent, else remove it — returns a new
 *  Set so React state updates see a changed reference. */
function toggleInSet<V>(set: Set<V>, value: V): Set<V> {
  const next = new Set(set)
  if (next.has(value)) next.delete(value)
  else next.add(value)
  return next
}

/**
 * One filter category, collapsed to a button ("PoP Type (2) ▾") that opens a
 * small checklist. This is the whole point of this rewrite: a category with
 * dozens of options (Country, Facility Owner) never sits permanently on
 * screen — only the categories the user actually opens do, one at a time.
 */
function FilterDropdown<V extends string>({ label, hint, options, optionLabel, selected, onToggle, isOpen, onOpenChange, searchable = false }: {
  label: string
  /** A short explanation of what this category actually filters by — shown
   *  as a Tooltip on the trigger, since "Ownership" or "On-Net" alone don't
   *  say which field they read or what the values mean. Omitted only where
   *  the label is already fully self-explanatory. */
  hint?: string
  options: V[]
  optionLabel: (v: V) => string
  selected: Set<V>
  onToggle: (v: V) => void
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  searchable?: boolean
}) {
  const t = useTheme()
  const [query, setQuery] = useState('')
  const count = selected.size
  const shown = searchable && query.trim()
    ? options.filter(o => optionLabel(o).toLowerCase().includes(query.trim().toLowerCase()))
    : options

  const trigger = (
    <button
      type="button"
      onClick={() => onOpenChange(!isOpen)}
      className="rb-btn-motion"
      style={{
        display: 'flex', alignItems: 'center', gap: 5,
        padding: '5px 9px', borderRadius: 6,
        border: `1px solid ${count > 0 || isOpen ? t.blue : t.border}`,
        background: count > 0 ? t.blue + '18' : t.bgDeep,
        color: count > 0 || isOpen ? t.blue : t.textMuted,
        cursor: 'pointer', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap',
      }}
    >
      {label}{count > 0 ? ` (${count})` : ''}
      <span style={{ fontSize: 9, lineHeight: 1 }}>▾</span>
    </button>
  )

  return (
    <div style={{ position: 'relative' }}>
      {hint ? <Tooltip label={hint}>{trigger}</Tooltip> : trigger}

      {isOpen && (
        <div className="rb-anim-dropdown" style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 20,
          minWidth: 190, maxWidth: 'min(280px, calc(100vw - 16px))', maxHeight: 260, overflowY: 'auto',
          background: t.bgPanel, border: `1px solid ${t.border}`, borderRadius: 8,
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)', padding: 6,
        }}>
          {searchable && (
            // Opened deliberately by a click, so autofocus here isn't a
            // surprise page-load steal — typing to narrow the list is the point.
            <input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Filter…"
              style={{
                width: '100%', boxSizing: 'border-box', marginBottom: 6,
                padding: '4px 7px', borderRadius: 4, fontSize: 12,
                border: `1px solid ${t.border}`, background: t.bgInput, color: t.text,
              }}
            />
          )}
          {shown.length === 0 && (
            <div style={{ fontSize: 11, color: t.textFaint, padding: '4px 6px' }}>No matches</div>
          )}
          {shown.map(v => (
            <label
              key={v}
              style={{
                display: 'flex', alignItems: 'center', gap: 7, padding: '4px 6px',
                borderRadius: 4, cursor: 'pointer', fontSize: 12, color: t.text,
              }}
            >
              <input type="checkbox" checked={selected.has(v)} onChange={() => onToggle(v)} />
              {optionLabel(v)}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

/** The trigger button, split out from AssetFilterBar itself so the compact/
 *  full-size branching lives in its own small function rather than adding to
 *  AssetFilterBar's already-substantial cognitive complexity. */
function FilterTrigger({ compact, open, activeCount, onClick }: {
  compact: boolean
  open: boolean
  activeCount: number
  onClick: () => void
}) {
  const t = useTheme()
  if (compact) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label="Asset filter"
        className="rb-btn-motion"
        style={{
          position: 'relative', width: 30, height: 30, borderRadius: 4,
          border: `1px solid ${open || activeCount > 0 ? t.blue : t.border}`,
          background: activeCount > 0 ? t.blue + '18' : t.bgInput,
          color: open || activeCount > 0 ? t.blue : t.textMuted,
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <svg width={14} height={14} viewBox="0 0 14 14" fill="none">
          <path d="M1 2h12l-4.5 5.5v3.5l-3 1.5v-5z" stroke="currentColor" strokeWidth={1.3} strokeLinejoin="round" />
        </svg>
        {activeCount > 0 && (
          <span style={{
            position: 'absolute', top: -5, right: -5,
            minWidth: 14, height: 14, padding: '0 3px', boxSizing: 'border-box',
            borderRadius: 7, background: t.blue, color: t.bgDeep,
            fontSize: 9, fontWeight: 700, lineHeight: '14px', textAlign: 'center',
          }}>{activeCount}</span>
        )}
      </button>
    )
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="rb-btn-motion"
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
  /** Phone header mode, matching AssetSearch/ServiceDateSelector's own
   *  `compact` convention: collapses the trigger to a 30x30 icon (with a
   *  small badge instead of an inline count) and clamps the opened panel's
   *  width to the viewport instead of a fixed 360px. Anchoring stays
   *  left-aligned to the trigger either way — MobileLayout docks the compact
   *  trigger near the phone's left edge, where a left-anchored panel has
   *  room to open rightward. */
  compact?: boolean
}

/**
 * The Asset Filter dropdown itself — see the file header for the full
 * picture (embedded AssetSearch + the faceted filter categories below it).
 * Owns the selection state (persisted to localStorage) and which category
 * dropdown is open; reports the computed node/segment id match up to the
 * host via onFilterChange whenever the selection or the underlying reference
 * data changes. Renders nothing on the map itself — that's the host's job.
 */
export function AssetFilterBar({ nodes, segments, systems, capacity, onNetOwnership, onAssetSelect, onFilterChange, compact = false }: Props) {
  const t = useTheme()
  const [open, setOpen] = useState(false)
  const [openCategory, setOpenCategory] = useState<Category | null>(null)
  const [sel, setSel] = useState<AssetFilterSelection>(loadSelection)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => { saveSelection(sel) }, [sel])

  // Click-outside closes the whole panel (and whatever category was open in
  // it), matching AssetSearch/Controls menu convention.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (containerRef.current?.contains(e.target as Node)) return
      setOpen(false)
      setOpenCategory(null)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  const nodesById = useMemo(() => Object.fromEntries(nodes.map(n => [n.id, n])), [nodes])
  const capacityById = useMemo(() => Object.fromEntries(capacity.map(c => [c.segment_id, c])), [capacity])
  const onNetSet = useMemo(() => new Set(onNetOwnership), [onNetOwnership])
  const facilityOwners = useMemo(() => distinctFacilityOwners(nodes), [nodes])
  const countries = useMemo(() => distinctCountries(nodes), [nodes])

  // The actual filter evaluation: with nothing selected in any category, the
  // filter is inactive and matches everything (empty id sets + active:false
  // tells the map "don't dim anything"). Otherwise every node/segment is
  // tested against the current selection via nodeMatchesFilter/
  // segmentMatchesFilter (utils/assetFilters.ts) — categories AND together,
  // choices within one category OR together, per the file header — and only
  // the ids that pass go into the returned sets.
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
  function clearAll()                       { setSel(emptyAssetFilterSelection()); setOpenCategory(null) }

  function openOnly(cat: Category, isOpen: boolean) { setOpenCategory(isOpen ? cat : null) }

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <Tooltip label="Dim assets that don't match your filters below — the search box zooms to one specific asset instead, independent of them">
        <FilterTrigger
          compact={compact}
          open={open}
          activeCount={activeCount}
          onClick={() => { setOpen(o => !o); setOpenCategory(null) }}
        />
      </Tooltip>

      {open && (
        <div className="rb-anim-dropdown" style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0,
          width: compact ? 'min(88vw, 360px)' : 360,
          background: t.bgPanel, border: `1px solid ${t.border}`, borderRadius: 10,
          boxShadow: '0 12px 36px rgba(0,0,0,0.45)', padding: 12,
        }}>
          <div style={{ marginBottom: 10 }}>
            <AssetSearch nodes={nodes} segments={segments} systems={systems} onSelect={hit => { onAssetSelect(hit); setOpen(false) }} />
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            <FilterDropdown
              label="Show" hint="Limit the filter to PoPs, Segments, or both"
              options={KIND_OPTS} optionLabel={v => KIND_LABEL[v]}
              selected={sel.kinds} onToggle={toggleKind}
              isOpen={openCategory === 'kinds'} onOpenChange={o => openOnly('kinds', o)}
            />
            <FilterDropdown
              label="On-Net" hint="Whether an asset is on our own network or third-party"
              options={ON_NET_OPTS} optionLabel={v => ON_NET_LABEL[v]}
              selected={sel.onNet} onToggle={toggleOnNet}
              isOpen={openCategory === 'onNet'} onOpenChange={o => openOnly('onNet', o)}
            />
            <FilterDropdown
              label="PoP Type" hint="Node classification — landing station, PoP tier, or branching unit"
              options={NODE_TYPE_OPTS} optionLabel={v => NODE_TYPE_LABEL[v] ?? v}
              selected={sel.nodeTypes} onToggle={toggleNodeType}
              isOpen={openCategory === 'nodeTypes'} onOpenChange={o => openOnly('nodeTypes', o)}
            />
            <FilterDropdown
              label="Ownership" hint="Segment's commercial ownership model (owned, IRU, consortium, ...)"
              options={OWNERSHIP_OPTS} optionLabel={v => OWNERSHIP_LABEL[v]}
              selected={sel.ownerships} onToggle={toggleOwnership}
              isOpen={openCategory === 'ownerships'} onOpenChange={o => openOnly('ownerships', o)}
            />
            {facilityOwners.length > 0 && (
              <FilterDropdown
                label="Facility Owner" hint="Which company owns the landing site or PoP" searchable
                options={facilityOwners} optionLabel={v => v}
                selected={sel.facilityOwners} onToggle={toggleFacilityOwner}
                isOpen={openCategory === 'facilityOwners'} onOpenChange={o => openOnly('facilityOwners', o)}
              />
            )}
            {countries.length > 0 && (
              <FilterDropdown
                label="Country" hint="Node's country, or either endpoint's for a segment" searchable
                options={countries} optionLabel={v => COUNTRY_NAMES[v] ?? v}
                selected={sel.countries} onToggle={toggleCountry}
                isOpen={openCategory === 'countries'} onOpenChange={o => openOnly('countries', o)}
              />
            )}

            {/* Single-value threshold: a literal native <select>, not a
                checklist — there is only ever one active choice. */}
            <Tooltip label="Flag segments running low on spare capacity">
              <select
                value={sel.capacityBelowPct ?? ''}
                onChange={e => setSel(s => ({ ...s, capacityBelowPct: e.target.value === '' ? null : Number(e.target.value) }))}
                className="rb-btn-motion"
                style={{
                  padding: '5px 8px', borderRadius: 6,
                  border: `1px solid ${sel.capacityBelowPct !== null ? t.blue : t.border}`,
                  background: sel.capacityBelowPct !== null ? t.blue + '18' : t.bgDeep,
                  color: sel.capacityBelowPct !== null ? t.blue : t.textMuted,
                  cursor: 'pointer', fontSize: 11, fontWeight: 700, fontFamily: 'inherit',
                }}
              >
                <option value="">Capacity: Any</option>
                {CAPACITY_PRESETS.map(p => (
                  <option key={p} value={p}>{`< ${p}% free`}</option>
                ))}
              </select>
            </Tooltip>
          </div>

          {activeCount > 0 && (
            <button
              type="button"
              onClick={clearAll}
              className="rb-btn-motion"
              style={{
                marginTop: 10, width: '100%', padding: '7px', borderRadius: 6,
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
