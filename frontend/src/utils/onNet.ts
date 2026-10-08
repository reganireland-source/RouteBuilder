/**
 * "Is this asset on our own network?" — for nodes and for segments.
 *
 * The two answer the question from different fields, which is why this exists
 * rather than an inline check at each call site.
 *
 * SEGMENTS are decided by commercial ownership, and which ownership types count
 * is an admin setting (AppConfig.on_net_ownership, default owned/consortium/iru).
 * That convention is already used by RouteList's route badges and CityPairPanel;
 * this is the same rule, just reusable.
 *
 * NODES carry an explicit `on_net` field — and the important thing about it is
 * that MOST NODES DO NOT SET IT. In the current dataset 160 of 230 are unset,
 * including 66 landing stations and 35 primary PoPs, which are plainly our own
 * sites. So a literal `on_net === 'on_net'` test would call 70% of the network
 * third-party and hide it, which is worse than not filtering at all.
 *
 * The rule is therefore NEGATIVE: a node is off-net only when it SAYS so —
 * `on_net === 'off_net'`, or `type === 'off_net'` which means the same thing in
 * node-type form. Everything else, including unset, is ours. That matches how
 * the data is actually maintained: off-net sites get marked because they are the
 * exception; nobody goes round tagging their own CLSs. It resolves to 205 on-net
 * and 25 off-net nodes today.
 *
 * The consequence to keep in mind: unset means "assumed ours", not "known ours".
 * If a third-party site is ever added without being marked off-net, an on-net
 * filter will include it. That is the safe direction to fail for a hazard view —
 * showing one asset you do not own beats hiding one you do.
 */
import type { CableNode, CableSegment } from '../types'

/** True unless the node is explicitly flagged as third-party. See above. */
export function isNodeOnNet(node: CableNode): boolean {
  return node.on_net !== 'off_net' && node.type !== 'off_net'
}

/** True when the segment's ownership is one of the configured on-net types. */
export function isSegmentOnNet(segment: CableSegment, onNetOwnership: ReadonlySet<string>): boolean {
  return onNetOwnership.has(segment.ownership)
}
