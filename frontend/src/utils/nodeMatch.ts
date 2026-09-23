/**
 * utils/nodeMatch.ts — "does this landing point already have a node?"
 *
 * Built for the Cable Import wizard's landing-station step: given a raw
 * coordinate (and optionally a name/city) crawled or typed in for a new
 * cable, rank the existing nodes that might actually BE that landing point,
 * so the wizard can offer "link to this existing node" instead of always
 * proposing a brand-new one.
 *
 * Distance alone isn't enough — two landing stations for different cables
 * can sit a few km apart in the same port city — so this combines great-
 * circle distance (reusing editorGeo.ts's haversineKm, the same distance
 * math the Network Editor's own node-snap picker uses) with a lightweight
 * name/city token-overlap score, mirroring the approach of the backend's
 * app/kml/matcher.py (tokenise + a shared-token ratio), reimplemented here
 * in TS rather than shared cross-language since it's a handful of lines.
 *
 * Deliberately NOT a single silent "nearest node" guess: always returns a
 * ranked list, and always includes at least the closest node even when
 * nothing is within range, so "create a new node instead" is a decision the
 * user makes with real distance/name context in front of them rather than
 * an empty list.
 */
import type { CableNode } from '../types'
import { haversineKm } from './editorGeo'

export interface NodeCandidate {
  node: CableNode
  distKm: number
  nameScore: number
}

export interface RankNodeCandidatesOptions {
  /** Only candidates within this radius count as "in range" (km). The
   *  single closest node is always returned regardless, as a fallback. */
  maxKm?: number
  /** Max candidates returned. */
  limit?: number
}

const DEFAULT_MAX_KM = 40
const DEFAULT_LIMIT = 5

const WORD_SPLIT = /[\s\-–—/(),.]+/
// Words too generic to mean anything when comparing landing-station names —
// "Cable Landing Station" itself is the biggest offender.
const STOPWORDS = new Set(['cable', 'landing', 'station', 'cls', 'the', 'of', 'and'])

function tokenise(...values: (string | undefined)[]): Set<string> {
  const tokens = new Set<string>()
  for (const value of values) {
    if (!value) continue
    for (const word of value.toLowerCase().split(WORD_SPLIT)) {
      if (word.length < 2 || STOPWORDS.has(word)) continue
      tokens.add(word)
    }
  }
  return tokens
}

/** Jaccard-style overlap: how much of the two token sets is shared, out of
 *  everything either one mentions. Symmetric, since neither side here is
 *  more authoritative than the other (unlike matcher.py's path-vs-segment
 *  asymmetry, this is just "two labels for maybe the same place"). */
function nameScore(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let shared = 0
  for (const token of a) if (b.has(token)) shared++
  return shared / (a.size + b.size - shared)
}

export function rankNodeCandidates(
  point: { lat: number; lng: number; name?: string; city?: string },
  nodes: CableNode[],
  opts: RankNodeCandidatesOptions = {},
): NodeCandidate[] {
  const maxKm = opts.maxKm ?? DEFAULT_MAX_KM
  const limit = opts.limit ?? DEFAULT_LIMIT
  const pointTokens = tokenise(point.name, point.city)

  const scored: NodeCandidate[] = nodes.map(node => ({
    node,
    distKm: haversineKm([point.lat, point.lng], [node.lat, node.lng]),
    nameScore: nameScore(pointTokens, tokenise(node.name, node.city)),
  }))
  scored.sort((a, b) => a.distKm - b.distKm)

  const inRange = scored.filter(c => c.distKm <= maxKm)
  const candidates = inRange.length > 0 ? inRange : scored.slice(0, 1)

  // Within range, a strong name/city match outranks pure proximity — two
  // landing stations for different cables can share a city.
  candidates.sort((a, b) => (b.nameScore - a.nameScore) || (a.distKm - b.distKm))

  return candidates.slice(0, limit)
}
