/**
 * ============================================================================
 *  AssetSearch.tsx — the "one box" quick-search bar that lives in the app header.
 * ============================================================================
 *
 * WHAT IT IS
 * A single small input that live-filters across EVERYTHING on the network at
 * once — nodes (by 4-alpha code or name), cities, cable systems, segments and
 * countries — and, when the user picks a result, hands that result straight to
 * its parent. It is the "I know what I am looking for, just take me there"
 * path, as opposed to SearchForm (build a route) or NodeFinder (find the
 * nearest node to an address). Nothing here talks to the backend: everything
 * is filtered in memory from the nodes/segments/systems the parent already
 * loaded.
 *
 * WHY A FLAT RANKED LIST RATHER THAN GROUPED SECTIONS
 * Typing "SYD1" should put SYD1 first, full stop — not first-within-Nodes
 * under a "Nodes" heading you have to scan past. So results from all five
 * kinds compete in one list ordered purely by how well they matched, exactly
 * in the order utils/assetSearch.ts's searchAssets() returns them. The small
 * coloured type chip on each row carries the "what kind of thing is this?"
 * information that grouping would otherwise have provided, without costing a
 * heading, a fixed per-kind quota, or a scan. The full reasoning — and the
 * ranking itself — lives in the header of utils/assetSearch.ts; this file is
 * deliberately nothing but presentation on top of it.
 *
 * THE PARENT OWNS NAVIGATION — THIS COMPONENT NAVIGATES NOTHING
 * On selection we call onSelect(hit) and then clear ourselves, and that is the
 * end of our involvement. We do not fly the map, switch sidebar mode, open a
 * node panel or select a country. Those actions differ per host (App.tsx's
 * desktop layout vs MobileLayout's tab stack) and per kind (a 'city' hit has
 * to be split with parseCityId and turned into a map viewport; a 'country' hit
 * has to be handed to CountryViewer), so the host decides. That keeps this
 * component testable, reusable in both layouts, and free of any knowledge of
 * the app's routing.
 *
 * WHY THE INDEX IS MEMOISED
 * buildAssetIndex() walks every node, segment and system to flatten them into
 * searchable entries — cheap enough to do on a data change, far too wasteful
 * to do on a keystroke. It is memoised on the three array identities, so it
 * rebuilds only when the parent actually swaps in new reference data. The
 * per-keystroke work is then just searchAssets() over a few hundred in-memory
 * entries, which is fast enough that a debounce would only add lag.
 *
 * INTERACTION
 *   • Ctrl+K / ⌘K anywhere in the app focuses (and, in compact mode, expands)
 *     the bar. We preventDefault so the browser's own find bar stays shut.
 *   • ↑ / ↓ move the highlight, Enter picks it, Escape closes and blurs.
 *   • A click anywhere outside closes the dropdown.
 *   • Under two characters we show no dropdown at all (searchAssets returns
 *     nothing for those — one character matches most of the network); a query
 *     that matches nothing shows a muted "No matches" row rather than an empty
 *     floating box, so the user can tell the difference between "still typing"
 *     and "nothing there".
 *
 * PROPS
 *   • nodes / segments / systems — the reference data to index.
 *   • onSelect(hit) — the chosen AssetHit. The parent navigates.
 *   • compact — phone header mode: render as a magnifier icon that expands
 *     into a field overlaying the header, with a × to close it again.
 *
 * Mounted from: App.tsx (desktop header) and MobileLayout.tsx (compact).
 * Backend endpoints: none.
 * ============================================================================
 */
import { Fragment, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { CableNode, CableSegment, CableSystem } from '../types'
import type { Theme } from '../theme'
import { useTheme } from '../theme'
import type { AssetHit, AssetKind } from '../utils/assetSearch'
import { KIND_LABEL, buildAssetIndex, searchAssets, segmentsForNode } from '../utils/assetSearch'

interface Props {
  nodes: CableNode[]
  segments: CableSegment[]
  systems: CableSystem[]
  /** Fired when the user picks a result. The parent does the navigating. */
  onSelect: (hit: AssetHit) => void
  /** Phone header: render as a magnifier icon that expands into the field. */
  compact?: boolean
}

/**
 * ISO code → display name, so a country row reads "Singapore" rather than "SG"
 * and typing "singapore" finds the country entry as well as the city. Kept
 * local, matching the existing convention in SearchForm / CountryViewer /
 * CityPairPanel, each of which carries its own copy — there is no shared
 * country module yet, and adding one would touch files outside this component.
 * A code with no entry still works: buildAssetIndex falls back to the code.
 */
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

/**
 * One accent per kind, read from the active theme rather than hard-coded, so
 * the chips follow dark / light / dusk automatically.
 *
 * The picks are deliberate. Blue is already the app's "this is an identity /
 * a node code" colour (NodeFinder's code column, the endpoint pickers), so
 * nodes keep it. Systems get orange because a cable-system name is the most
 * commonly searched string and orange is the strongest of the remaining
 * accents in all three palettes. Segments get pink — the one accent that is
 * muted in the dusk palette — because a raw segment id is the least-typed
 * query of the five. Countries get the neutral muted text colour: the broadest
 * and least specific kind reads as the quietest chip. Red is deliberately not
 * used: everywhere else in this app red means "error" or "avoid".
 */
const KIND_ACCENT: Record<AssetKind, (t: Theme) => string> = {
  node:    t => t.blue,
  city:    t => t.green,
  system:  t => t.orange,
  segment: t => t.pink,
  country: t => t.textMuted,
}

/** The small right-hand type chip. Tinted fill + ring, matching the chip
 *  treatment used in SearchForm's pickers and NodeFinder's cards. */
function KindChip({ kind }: { kind: AssetKind }) {
  const t = useTheme()
  const accent = KIND_ACCENT[kind](t)
  return (
    <span style={{
      flexShrink: 0, marginLeft: 'auto',
      fontSize: 9, fontWeight: 800, letterSpacing: '0.06em',
      padding: '1px 5px', borderRadius: 3,
      background: accent + '22', border: `1px solid ${accent}55`, color: accent,
    }}>
      {KIND_LABEL[kind]}
    </span>
  )
}

interface ListProps {
  hits: AssetHit[]
  activeIdx: number
  listId: string
  optionId: (i: number) => string
  query: string
  onPick: (hit: AssetHit) => void
  onHover: (i: number) => void
  /** For expanding a node row into the segments that terminate there. */
  nodes: CableNode[]
  segments: CableSegment[]
}

/** One segment terminating at a node hit above it — a button (not a div),
 *  so it is keyboard-reachable via Tab/Enter without wiring it into the
 *  listbox's own arrow-key roving highlight, which stays scoped to the
 *  top-level hits. Labelled by id first (what "SEG_ID" means at a glance)
 *  then both endpoint node names, matching the request that drove this: see
 *  the node it's under, then see what it connects to. */
function NodeSegmentRow({ hit, onPick }: { hit: AssetHit; onPick: (hit: AssetHit) => void }) {
  const t = useTheme()
  return (
    <button
      type="button"
      onClick={() => onPick(hit)}
      style={{
        display: 'flex', alignItems: 'baseline', gap: 6, width: '100%',
        padding: '4px 10px 4px 28px', cursor: 'pointer', textAlign: 'left',
        border: 'none', background: 'transparent', fontFamily: 'inherit',
      }}
    >
      <span style={{ fontSize: 11, fontWeight: 700, color: t.pink, flexShrink: 0 }}>
        {hit.label}
      </span>
      <span style={{
        fontSize: 11, color: t.textFaint,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {hit.sublabel}
      </span>
    </button>
  )
}

/**
 * The floating result list. Split out of the main component so neither one
 * grows past the repo's cognitive-complexity cap, and so the scroll-the-
 * highlight-into-view effect can live next to the rows it measures: keyboard
 * navigation must not push the highlight below the fold of a scrolled list.
 */
function ResultList({ hits, activeIdx, listId, optionId, query, onPick, onHover, nodes, segments }: ListProps) {
  const t = useTheme()
  const rowRefs = useRef<(HTMLDivElement | null)[]>([])

  // 'nearest' scrolls only when the row is actually out of view, so walking the
  // list with ↓ does not jerk the whole dropdown on every step.
  useEffect(() => {
    rowRefs.current[activeIdx]?.scrollIntoView({ block: 'nearest' })
  }, [activeIdx])

  // Keyed on the node hits actually on screen (at most a handful of the ≤12
  // results), not recomputed on every activeIdx-driven re-render — arrow-key
  // navigation changes activeIdx far more often than it changes which node
  // hits are showing.
  const nodeSegments = useMemo(() => {
    const map = new Map<string, AssetHit[]>()
    for (const hit of hits) {
      if (hit.kind === 'node') map.set(hit.id, segmentsForNode(hit.id, segments, nodes))
    }
    return map
  }, [hits, segments, nodes])

  const panel: React.CSSProperties = {
    position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 1300,
    background: t.bgPanel, border: `1px solid ${t.border}`, borderRadius: 6,
    maxHeight: 320, overflowY: 'auto',
    boxShadow: '0 8px 28px rgba(0,0,0,0.35)',
  }

  if (hits.length === 0) {
    return (
      <div id={listId} role="listbox" aria-label="Asset search results" style={{ ...panel, padding: '9px 12px' }}>
        <span style={{ fontSize: 12, color: t.textFaint }}>No matches for “{query.trim()}”</span>
      </div>
    )
  }

  return (
    <div id={listId} role="listbox" aria-label="Asset search results" style={panel}>
      {hits.map((hit, i) => {
        const childSegments = hit.kind === 'node' ? nodeSegments.get(hit.id) ?? [] : []
        return (
          <Fragment key={`${hit.kind}:${hit.id}`}>
            <div
              id={optionId(i)}
              ref={el => { rowRefs.current[i] = el }}
              role="option"
              aria-selected={i === activeIdx}
              // mousedown, not click: the input's blur would otherwise tear the
              // dropdown down before the click ever landed on a row.
              onMouseDown={e => { e.preventDefault(); onPick(hit) }}
              onMouseEnter={() => onHover(i)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '7px 10px', cursor: 'pointer',
                background: i === activeIdx ? t.bgDeep : 'transparent',
                borderBottom: childSegments.length === 0 && i < hits.length - 1 ? `1px solid ${t.border}` : 'none',
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{
                  fontSize: 13, fontWeight: 600, color: t.text,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {hit.label}
                </div>
                {hit.sublabel && (
                  <div style={{
                    fontSize: 11, color: t.textFaint, marginTop: 1,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {hit.sublabel}
                  </div>
                )}
              </div>
              <KindChip kind={hit.kind} />
            </div>
            {childSegments.map((segHit, si) => (
              <div
                key={`${hit.id}-seg-${segHit.id}`}
                style={{
                  background: t.bgDeep,
                  borderBottom: si === childSegments.length - 1 && i < hits.length - 1
                    ? `1px solid ${t.border}` : 'none',
                }}
              >
                <NodeSegmentRow hit={segHit} onPick={onPick} />
              </div>
            ))}
          </Fragment>
        )
      })}
    </div>
  )
}

/**
 * The quick-search bar. Owns only its own query/highlight/open state; the
 * chosen AssetHit goes straight out through onSelect and the parent decides
 * what "go there" means.
 */
export function AssetSearch({ nodes, segments, systems, onSelect, compact = false }: Props) {
  const t = useTheme()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [rawActiveIdx, setActiveIdx] = useState(0)
  /** compact only: false = just the magnifier, true = the field is showing. */
  const [expanded, setExpanded] = useState(false)

  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const uid = useId()
  const listId = `asset-search-list-${uid}`
  const optionId = (i: number) => `asset-search-opt-${uid}-${i}`

  // Rebuild only when the parent swaps in new reference data — see the header.
  const index = useMemo(
    () => buildAssetIndex(nodes, segments, systems, COUNTRY_NAMES),
    [nodes, segments, systems],
  )

  // A few hundred entries in memory: cheap enough to rank on every keystroke,
  // so there is no debounce to make the box feel laggy.
  const hits = useMemo(() => searchAssets(index, query), [index, query])

  // searchAssets returns nothing under two characters, so "no dropdown yet"
  // and "no matches" are told apart by the query length, not by hits.length.
  const hasQuery = query.trim().length >= 2
  const showList = open && hasQuery

  // The highlight is clamped rather than reset from an effect: when the result
  // list shrinks (another keystroke, or the parent swapping in new reference
  // data) an ordinal that no longer exists simply falls back to the top row —
  // the new best match — with no extra render pass to get there.
  const activeIdx = rawActiveIdx < hits.length ? rawActiveIdx : 0

  function close() {
    setOpen(false)
    if (compact) { setExpanded(false); setQuery('') }
  }

  /** Focus the field, waiting a frame only when it is not on screen yet. In
   *  collapsed compact mode the input does not exist until the expand commits,
   *  so focusing it has to wait for the frame that mounts it; everywhere else
   *  the focus is immediate, which keeps the caret in step with the keypress. */
  function focusField() {
    const el = inputRef.current
    if (el) { el.focus(); el.select(); return }
    requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.select() })
  }

  function reveal() {
    setExpanded(true)
    setOpen(true)
    focusField()
  }

  // Ctrl+K / ⌘K from anywhere in the app. preventDefault keeps the browser's
  // own find/search bar (and Firefox's quick-find) out of the way.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'k') return
      e.preventDefault()
      setExpanded(true)
      setOpen(true)
      focusField()
    }
    window.addEventListener('keydown', onKey)
    // Bound once: focusField and the setters it calls only touch refs and
    // state setters, so the listener never needs re-binding.
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Click-outside closes. mousedown rather than click so the dropdown is gone
  // before whatever was clicked underneath reacts.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (containerRef.current?.contains(e.target as Node)) return
      setOpen(false)
      if (compact) { setExpanded(false); setQuery('') }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [compact])

  /** Hand the hit up and reset ourselves — we never navigate. */
  function pick(hit: AssetHit) {
    onSelect(hit)
    setQuery('')
    setOpen(false)
    setActiveIdx(0)
    if (compact) setExpanded(false)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { close(); inputRef.current?.blur(); return }
    if (!showList || hits.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx(i => Math.min(i + 1, hits.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      // Nothing explicitly highlighted still means "take the best match".
      pick(hits[activeIdx] ?? hits[0])
    }
  }

  // Collapsed phone header: a magnifier and nothing else.
  if (compact && !expanded) {
    return (
      <div ref={containerRef} style={{ position: 'relative', flexShrink: 0 }}>
        <button
          type="button"
          onClick={reveal}
          aria-label="Asset search"
          style={{
            width: 30, height: 30, borderRadius: 4, cursor: 'pointer',
            border: `1px solid ${t.border}`, background: t.bgInput,
            color: t.textMuted, fontSize: 14, lineHeight: 1,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          🔍
        </button>
      </div>
    )
  }

  // Expanded compact mode floats the field over the header (which has no room
  // for it inline); at normal size it is a plain inline field.
  const field: React.CSSProperties = compact
    ? {
        position: 'absolute', top: 0, right: 0, zIndex: 1300,
        width: 'min(76vw, 280px)',
        display: 'flex', alignItems: 'center', gap: 4,
      }
    : { position: 'relative', display: 'flex', alignItems: 'center', gap: 4, width: '100%' }

  return (
    <div
      ref={containerRef}
      style={{ position: 'relative', flexShrink: 0, width: compact ? 30 : 'min(100%, 260px)' }}
    >
      <div style={field}>
        <input
          ref={inputRef}
          value={query}
          aria-label="Asset search"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && hits.length > 0 ? optionId(activeIdx) : undefined}
          autoComplete="off"
          placeholder={compact ? 'Search assets…' : 'Search assets…  ⌘K'}
          // A new query means a new best match, so the highlight goes back to
          // the top row rather than staying on whatever ordinal the pointer or
          // the arrow keys last left it on.
          onChange={e => { setQuery(e.target.value); setActiveIdx(0); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          style={{
            flex: 1, minWidth: 0, padding: '5px 8px', borderRadius: 4,
            border: `1px solid ${t.border}`, background: t.bgInput,
            color: t.text, fontSize: 13, outline: 'none', boxSizing: 'border-box',
          }}
        />
        {(compact || query.length > 0) && (
          <button
            type="button"
            // Compact always needs a way back to the icon; inline only needs a
            // way to empty a field that has something in it.
            onClick={() => { setQuery(''); close() }}
            aria-label={compact ? 'Close asset search' : 'Clear asset search'}
            style={{
              flexShrink: 0, width: 22, height: 22, borderRadius: 4,
              border: 'none', background: 'transparent', cursor: 'pointer',
              color: t.textFaint, fontSize: 16, lineHeight: 1, padding: 0,
            }}
          >
            ×
          </button>
        )}

        {showList && (
          <ResultList
            hits={hits}
            activeIdx={activeIdx}
            listId={listId}
            optionId={optionId}
            query={query}
            onPick={pick}
            onHover={setActiveIdx}
            nodes={nodes}
            segments={segments}
          />
        )}
      </div>
    </div>
  )
}
