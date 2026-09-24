/**
 * utils/assetFilters.ts — pure predicate logic behind the top-of-map Asset
 * Filter bar (AssetFilterBar.tsx).
 *
 * A filter SELECTION is a set of badges chosen per category (asset kind,
 * on-net/off-net, PoP type, ownership, facility owner, country) plus one
 * optional capacity threshold. Categories combine with AND; badges within
 * the same category combine with OR (pick AU or JP and either matches); an
 * empty category imposes no constraint at all. This is the standard
 * faceted-filter shape, matching how e.g. an e-commerce filter sidebar reads.
 *
 * Two categories only ever apply to one asset kind — `ownership` and
 * `capacityBelowPct` are segment-only (nodes don't carry either field),
 * `nodeTypes` and `facilityOwners` are node-only — so they're simply ignored
 * when testing the other kind, rather than forcing a match/no-match either
 * way.
 */
import type { CableNode, CableSegment, NodeType, Ownership, OnNet, SegmentCapacity } from '../types'
import { isNodeOnNet, isSegmentOnNet } from './onNet'

export type AssetKindFilter = 'node' | 'segment'

export interface AssetFilterSelection {
  /** Which asset kinds this filter applies to at all. Empty = both. */
  kinds: Set<AssetKindFilter>
  nodeTypes: Set<NodeType>
  onNet: Set<OnNet>
  ownerships: Set<Ownership>
  facilityOwners: Set<string>
  countries: Set<string>
  /** Segments whose available capacity, as a % of total, is below this
   *  number. null = no capacity constraint. Single-select, not a Set — the
   *  threshold badges replace each other rather than combining. */
  capacityBelowPct: number | null
}

export function emptyAssetFilterSelection(): AssetFilterSelection {
  return {
    kinds: new Set(),
    nodeTypes: new Set(),
    onNet: new Set(),
    ownerships: new Set(),
    facilityOwners: new Set(),
    countries: new Set(),
    capacityBelowPct: null,
  }
}

export function isAssetFilterActive(sel: AssetFilterSelection): boolean {
  return sel.kinds.size > 0 || sel.nodeTypes.size > 0 || sel.onNet.size > 0
    || sel.ownerships.size > 0 || sel.facilityOwners.size > 0 || sel.countries.size > 0
    || sel.capacityBelowPct !== null
}

export function nodeMatchesFilter(node: CableNode, sel: AssetFilterSelection): boolean {
  if (sel.kinds.size > 0 && !sel.kinds.has('node')) return false
  if (sel.nodeTypes.size > 0 && !sel.nodeTypes.has(node.type)) return false
  if (sel.onNet.size > 0) {
    const bucket: OnNet = isNodeOnNet(node) ? 'on_net' : 'off_net'
    if (!sel.onNet.has(bucket)) return false
  }
  if (sel.facilityOwners.size > 0 && !sel.facilityOwners.has(node.owner ?? '')) return false
  if (sel.countries.size > 0 && !sel.countries.has(node.country)) return false
  return true
}

function segmentOnNetOk(seg: CableSegment, sel: AssetFilterSelection, onNetOwnership: ReadonlySet<string>): boolean {
  if (sel.onNet.size === 0) return true
  const bucket: OnNet = isSegmentOnNet(seg, onNetOwnership) ? 'on_net' : 'off_net'
  return sel.onNet.has(bucket)
}

function segmentCountryOk(seg: CableSegment, sel: AssetFilterSelection, nodesById: Record<string, CableNode>): boolean {
  if (sel.countries.size === 0) return true
  const start = nodesById[seg.start_node_id]
  const end = nodesById[seg.end_node_id]
  return (!!start && sel.countries.has(start.country)) || (!!end && sel.countries.has(end.country))
}

function segmentCapacityOk(seg: CableSegment, sel: AssetFilterSelection, capacityById: Record<string, SegmentCapacity>): boolean {
  if (sel.capacityBelowPct === null) return true
  const cap = capacityById[seg.id]
  if (!cap || cap.total_capacity_t <= 0) return false
  return (cap.available_capacity_t / cap.total_capacity_t) * 100 < sel.capacityBelowPct
}

export function segmentMatchesFilter(
  seg: CableSegment,
  sel: AssetFilterSelection,
  nodesById: Record<string, CableNode>,
  onNetOwnership: ReadonlySet<string>,
  capacityById: Record<string, SegmentCapacity>,
): boolean {
  return (sel.kinds.size === 0 || sel.kinds.has('segment'))
    && (sel.ownerships.size === 0 || sel.ownerships.has(seg.ownership))
    && segmentOnNetOk(seg, sel, onNetOwnership)
    && segmentCountryOk(seg, sel, nodesById)
    && segmentCapacityOk(seg, sel, capacityById)
}

/** Every distinct, non-empty node.owner value present in the data, sorted —
 *  the "Facility Owner" badge list. */
export function distinctFacilityOwners(nodes: CableNode[]): string[] {
  return [...new Set(nodes.map(n => n.owner).filter((o): o is string => !!o))].sort()
}

/** Every distinct node.country code present in the data, sorted — the
 *  "Country" badge list. Segments have no country of their own; a segment
 *  matches a country through either endpoint (see segmentMatchesFilter). */
export function distinctCountries(nodes: CableNode[]): string[] {
  return [...new Set(nodes.map(n => n.country))].sort()
}
