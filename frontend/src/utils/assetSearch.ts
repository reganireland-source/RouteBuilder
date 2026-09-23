/**
 * utils/assetSearch.ts — the index and ranking behind the Asset Search bar.
 *
 * One box that searches every kind of thing on the network at once: nodes (by
 * 4-alpha code or name), cities, cable systems, segments and countries. Pure
 * functions only — no React, no DOM — so the ranking can be reasoned about and
 * tested on its own, and so the component above it is just presentation.
 *
 * WHY A FLAT RANKED LIST RATHER THAN GROUPED SECTIONS
 * Typing "SYD1" should put SYD1 first, full stop — not first-within-Nodes
 * under a heading you have to scan past. So results from all five kinds
 * compete in a single list ordered by how well they matched, with a small type
 * chip on each row carrying the "what kind of thing is this" information that
 * grouping would otherwise provide.
 *
 * THE RANKING, STRONGEST FIRST
 *   1. exact code/id match            — "SYD1" is a unique identifier; nothing
 *                                       should ever outrank typing one exactly
 *   2. exact name match               — "Singapore"
 *   3. prefix match on code/id
 *   4. prefix match on name
 *   5. word-start match inside a name — "cross" finds "Southern Cross NEXT"
 *   6. plain substring match
 *   7. substring of the secondary line
 *   8-9. every WORD of a multi-word query present, though not contiguously —
 *        this is what lets "C2C S5" find "C2C Segment S5 Ajigaura–Nasugbu"
 * Ties break by kind (nodes before cities before systems before segments
 * before countries — roughly how specific each is), then alphabetically, so
 * the order is stable and never jitters between keystrokes.
 *
 * Used by: components/AssetSearch.tsx.
 */
import type { CableNode, CableSegment, CableSystem } from '../types'

export type AssetKind = 'node' | 'city' | 'system' | 'segment' | 'country'

export interface AssetHit {
  kind: AssetKind
  /** Stable identity: node/segment/system id, city name, or ISO country code. */
  id: string
  /** Primary line — what the user reads first. */
  label: string
  /** Secondary line: context such as the city and country, or a cable's endpoints. */
  sublabel?: string
  /** Lower is better. See the ranking note in the file header. */
  score: number
}

/** One searchable thing, flattened out of the network data. */
interface Entry {
  kind: AssetKind
  id: string
  label: string
  sublabel?: string
  /** The unique identifier to match "exactly" against — a code, id or ISO code. */
  code?: string
}

const KIND_ORDER: Record<AssetKind, number> = {
  node: 0, city: 1, system: 2, segment: 3, country: 4,
}

/** Nodes: searchable by 4-alpha code or name, with their city/country/owner
 *  as context. */
function nodeEntries(nodes: CableNode[]): Entry[] {
  return nodes.map(n => ({
    kind: 'node' as const,
    id: n.id,
    code: n.id,
    label: `${n.id} - ${n.name}`,
    sublabel: [n.city, n.country, n.owner].filter(Boolean).join(' \u00b7 '),
  }))
}

/** Cities are DERIVED, not stored: a city exists because nodes claim it. Keyed
 *  on city+country so two "Portland"s in different countries stay distinct. */
function cityEntries(nodes: CableNode[]): Entry[] {
  const cities = new Map<string, { city: string; country: string; count: number }>()
  for (const n of nodes) {
    if (!n.city) continue
    const key = `${n.city}|${n.country}`
    const found = cities.get(key)
    if (found) found.count++
    else cities.set(key, { city: n.city, country: n.country, count: 1 })
  }
  return [...cities.entries()].map(([key, c]) => ({
    kind: 'city' as const,
    id: key,
    label: c.city,
    sublabel: `${c.country} \u00b7 ${c.count} node${c.count === 1 ? '' : 's'}`,
  }))
}

function systemEntries(systems: CableSystem[]): Entry[] {
  // TERRESTRIAL is the catch-all bucket for backhaul, not a real cable.
  return systems.filter(s => s.id !== 'TERRESTRIAL').map(s => ({
    kind: 'system' as const,
    id: s.id,
    code: s.id,
    label: s.name || s.id,
    sublabel: s.id,
  }))
}

function segmentEntries(segments: CableSegment[], nodes: CableNode[]): Entry[] {
  const nameById = new Map(nodes.map(n => [n.id, n.name]))
  const nodeName = (id: string) => nameById.get(id) ?? id
  return segments.map(seg => ({
    kind: 'segment' as const,
    id: seg.id,
    code: seg.id,
    label: seg.name || seg.id,
    sublabel: `${nodeName(seg.start_node_id)} \u2192 ${nodeName(seg.end_node_id)} \u00b7 ${seg.type}`,
  }))
}

/** Countries come from the nodes that sit in them. A code with no display name
 *  still gets an entry — searching "SG" must work whether or not we can spell
 *  Singapore. */
function countryEntries(nodes: CableNode[], countryNames: Record<string, string>): Entry[] {
  const counts = new Map<string, number>()
  for (const n of nodes) {
    if (n.country) counts.set(n.country, (counts.get(n.country) ?? 0) + 1)
  }
  return [...counts.entries()].map(([code, count]) => ({
    kind: 'country' as const,
    id: code,
    code,
    label: countryNames[code] || code,
    sublabel: `${code} \u00b7 ${count} node${count === 1 ? '' : 's'}`,
  }))
}

/**
 * Flatten the network into a searchable list. Rebuild only when the underlying
 * data changes (callers memoise on the array identities) — it walks every node,
 * segment and system, so it is not free.
 *
 * Split into one builder per kind rather than one long function: each kind has
 * genuinely different derivation rules (cities and countries are aggregated out
 * of nodes; systems filter a pseudo-entry; segments need a node-name lookup),
 * and they read far better side by side than interleaved.
 */
export function buildAssetIndex(
  nodes: CableNode[],
  segments: CableSegment[],
  systems: CableSystem[],
  countryNames: Record<string, string> = {},
): Entry[] {
  return [
    ...nodeEntries(nodes),
    ...cityEntries(nodes),
    ...systemEntries(systems),
    ...segmentEntries(segments, nodes),
    ...countryEntries(nodes, countryNames),
  ]
}

/** Split a label into words on the separators these names actually use. */
const WORD_SPLIT = /[\s\-–—/(),.]+/

/**
 * Score one entry against a lower-cased query, treating the query as ONE
 * contiguous string. Returns null when it does not match, so the caller can
 * filter and rank in one pass.
 */
function scoreContiguous(e: Entry, q: string): number | null {
  const code = e.code?.toLowerCase()
  const label = e.label.toLowerCase()

  if (code === q) return 1
  if (label === q) return 2
  if (code?.startsWith(q)) return 3
  if (label.startsWith(q)) return 4

  // Word-start: "cross" should find "Southern Cross NEXT", but "ross" should
  // not rank as highly as a real word boundary would.
  if (label.split(WORD_SPLIT).some(w => w.startsWith(q))) return 5

  if (label.includes(q)) return 6
  if (e.sublabel?.toLowerCase().includes(q)) return 7
  return null
}

/**
 * Score an entry against a MULTI-WORD query, where every word must appear
 * somewhere but not necessarily together.
 *
 * This is what makes "C2C S5" find "C2C Segment S5 Ajigaura–Nasugbu". As one
 * contiguous string that query matches nothing — the real name has "Segment"
 * sitting between the two halves — so typing the 5 made the result the user was
 * clearly aiming at vanish. People type the distinctive bits of a name and
 * leave out the filler, and the search has to expect that.
 *
 * Tier 8 is every word landing on a word boundary ("s5" matching the word
 * "S5"), tier 9 is every word merely present somewhere. Both rank below every
 * contiguous tier, so a true prefix or exact hit is never displaced by a
 * scattered one.
 */
function scoreTokens(e: Entry, tokens: string[]): number | null {
  const haystack = `${e.label} ${e.sublabel ?? ''} ${e.code ?? ''}`.toLowerCase()
  const words = haystack.split(WORD_SPLIT)

  if (!tokens.every(tok => haystack.includes(tok))) return null
  return tokens.every(tok => words.some(w => w.startsWith(tok))) ? 8 : 9
}

/**
 * Rank the index against a query. Returns at most `limit` hits, best first.
 *
 * A query shorter than two characters returns nothing: one character matches
 * most of the network and the dropdown would be noise rather than help.
 */
export function searchAssets(index: Entry[], query: string, limit = 12): AssetHit[] {
  const q = query.trim().toLowerCase()
  if (q.length < 2) return []

  // Multi-word queries fall back to all-words-present matching when the query
  // does not appear as one contiguous run — see scoreTokens.
  const tokens = q.split(/\s+/).filter(Boolean)
  const multiWord = tokens.length > 1

  const hits: AssetHit[] = []
  for (const e of index) {
    const score = scoreContiguous(e, q) ?? (multiWord ? scoreTokens(e, tokens) : null)
    if (score === null) continue
    hits.push({ kind: e.kind, id: e.id, label: e.label, sublabel: e.sublabel, score })
  }

  hits.sort((a, b) =>
    a.score - b.score ||
    KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
    a.label.localeCompare(b.label))

  return hits.slice(0, limit)
}

/** A segment-under-node sub-row: an AssetHit (so it can go straight to
 *  onSelect on a pick) plus the 4-alpha code of the node at the OTHER end
 *  from the one it's listed under, so the reader sees "leads to JWLS"
 *  before they even read the segment id. */
export interface NodeSegmentHit extends AssetHit {
  otherNodeCode: string
}

/**
 * The segments terminating at one node, shaped for AssetSearch to list
 * beneath that node's row and hand a pick straight to onSelect like any
 * other hit. Labelled by segment ID rather than name (name is often blank
 * or a duplicate of the id for backhaul) with both endpoint node names as
 * the sublabel, since "which two nodes does this connect" is exactly what
 * someone expanding a node's segments wants to see next to the id. Not part
 * of the ranked index — these aren't matched against a query, they're a
 * fixed lookup keyed on the node the user already picked.
 */
export function segmentsForNode(nodeId: string, segments: CableSegment[], nodes: CableNode[]): NodeSegmentHit[] {
  const nameById = new Map(nodes.map(n => [n.id, n.name]))
  const nodeName = (id: string) => nameById.get(id) ?? id
  return segments
    .filter(seg => seg.start_node_id === nodeId || seg.end_node_id === nodeId)
    .map(seg => ({
      kind: 'segment' as const,
      id: seg.id,
      label: seg.id,
      sublabel: `${nodeName(seg.start_node_id)} → ${nodeName(seg.end_node_id)}`,
      score: 0,
      otherNodeCode: seg.start_node_id === nodeId ? seg.end_node_id : seg.start_node_id,
    }))
}

/** Display chip text per kind — kept here so the component has no vocabulary
 *  of its own to drift from the index's. */
export const KIND_LABEL: Record<AssetKind, string> = {
  node: 'NODE',
  city: 'CITY',
  system: 'SYSTEM',
  segment: 'SEGMENT',
  country: 'COUNTRY',
}

/** Split a "city|country" city entry id back into its parts. */
export function parseCityId(id: string): { city: string; country: string } {
  const [city, country] = id.split('|')
  return { city, country: country ?? '' }
}
