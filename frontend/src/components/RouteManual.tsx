/**
 * RouteManual — the hop-by-hop manual route builder ("RouteManual" sub-tab of
 * the RouteBuilder tab). Instead of asking the backend route solver, the user
 * picks an origin node and then chooses each next hop from a candidate list
 * (or by clicking candidate nodes on the map) until the route is finished.
 *
 * This module exports both pure logic and three UI components:
 * - computeCandidates(): all direct neighbour segments of the current node,
 *   excluding already-visited nodes (no loops), sorted owned-ownership first
 *   then by latency. Each candidate carries system margin and capacity data.
 * - assembleRoute(): converts a finished ManualState into a regular Route
 *   object (total km, latency, cost, and end-to-end reliability as the product
 *   of segment reliabilities) so it can be listed, pinned, and exported like a
 *   solver result.
 * - RouteManual: single-panel variant mounted by MobileLayout.tsx.
 * - RouteManualLeft / RouteManualMiddle: desktop split-panel variants mounted
 *   by App.tsx when mode === 'routemanual' (left = origin search, running
 *   stats, next-hop candidates; middle = the locked-in path so far).
 *
 * All state (ManualState = origin + ordered steps of segment/node picks) is
 * lifted into App.tsx / MobileLayout so the map can highlight candidates and
 * handle node clicks. Purely client-side: makes no backend calls; it works on
 * the nodes/segments/systems/capacity arrays already loaded by App.tsx.
 */
import React, { useMemo, useState } from 'react'
import type { CableNode, CableSegment, CableSystem, Route, RouteSegmentDetail, SegmentCapacity } from '../types'
import { useTheme } from '../theme'
import { candidateColor } from './Map'

// ── Types ─────────────────────────────────────────────────────────────────────

/** One hop already committed to the manual route: the segment traversed and
 *  the node arrived at on the far end of it. */
export interface ManualStep {
  nodeId:    string
  segmentId: string
}

/**
 * The full state of an in-progress (or finished) manually-built route.
 * Owned by the host (App.tsx / MobileLayout.tsx), not by this component, so
 * that the map can read/drive it too (e.g. highlighting candidates, handling
 * node clicks as hop picks). `steps` is empty for a fresh route that has only
 * an origin set; the "current node" the user is extending from is always
 * `steps.length ? steps[steps.length - 1].nodeId : originId`.
 */
export interface ManualState {
  originId:  string
  steps:     ManualStep[]   // each step: the segment taken + node arrived at
}

/**
 * One candidate next hop offered from the current node: the neighbour node
 * and the segment connecting to it, plus the data needed to render its stat
 * chips (the owning system's margin, and the segment's available/total
 * capacity in Tbps — either capacity field is null when no capacity row
 * exists for that segment).
 */
export interface NextHopCandidate {
  nodeId:         string
  segmentId:      string
  node:           CableNode
  segment:        CableSegment
  margin:         number | null
  availCapTbps:   number | null   // available capacity in Tbps (null = no data)
  totalCapTbps:   number | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Human-readable labels for the CableSegment.ownership enum, used on the
 *  candidate-hop stat chips and the progressive metro map. */
const OWNERSHIP_LABEL: Record<string, string> = {
  owned:                'Owned',
  consortium:           'Consortium',
  iru:                  'IRU',
  integrated_lit_lease: 'Int. Lit Lease',
  offnet_resell:        'Offnet Resell',
}

/** Look up a cable system's commercial margin by id.
 * @returns The system's margin, or null if the system id isn't found or has
 *   no margin recorded. */
function getMargin(systemId: string, systems: CableSystem[]): number | null {
  return systems.find(s => s.id === systemId)?.margin ?? null
}

/**
 * All direct neighbours of a node (excluding any already in the locked path).
 * This is the core of the manual builder: rather than solving a path, it
 * simply enumerates every segment touching `currentNodeId` and turns each
 * into a NextHopCandidate the user can pick from.
 * @param currentNodeId The node the user is currently extending the route from.
 * @param visitedNodeIds Every node already on the path (origin + all step
 *   nodes) — a candidate landing on one of these is dropped so the manual
 *   builder can never loop back on itself.
 * @param segments The full segment list to scan for neighbours of currentNodeId.
 * @param nodesById Lookup for resolving a neighbour segment's far-end node id
 *   to its full CableNode record.
 * @param systems Used to resolve each candidate segment's owning system margin.
 * @param capacityBySegId Used to resolve each candidate segment's available/total capacity.
 * @returns Candidates sorted owned-ownership first, then by ascending latency
 *   within each ownership tier — so the "best" (cheapest, lowest-latency)
 *   options surface at the top of the Next Hop list.
 */
export function computeCandidates(
  currentNodeId: string,
  visitedNodeIds: Set<string>,
  segments: CableSegment[],
  nodesById: Record<string, CableNode>,
  systems: CableSystem[],
  capacityBySegId: Record<string, SegmentCapacity>,
): NextHopCandidate[] {
  const out: NextHopCandidate[] = []
  for (const seg of segments) {
    // A segment is a candidate only if one of its two endpoints IS the
    // current node; peerId becomes the OTHER endpoint (the node we'd land on).
    let peerId: string | null = null
    if (seg.start_node_id === currentNodeId) peerId = seg.end_node_id
    else if (seg.end_node_id === currentNodeId) peerId = seg.start_node_id
    if (!peerId) continue   // segment doesn't touch the current node at all
    if (visitedNodeIds.has(peerId)) continue   // no loops
    const node = nodesById[peerId]
    if (!node) continue   // defensive: skip if node data is missing/stale
    const cap = capacityBySegId[seg.id]
    out.push({
      nodeId:       peerId,
      segmentId:    seg.id,
      node,
      segment:      seg,
      margin:       getMargin(seg.system_id, systems),
      availCapTbps: cap ? cap.available_capacity_t : null,
      totalCapTbps: cap ? cap.total_capacity_t : null,
    })
  }
  // Sort: owned first, then by latency
  return out.sort((a, b) => {
    const ownA = a.segment.ownership === 'owned' ? 0 : 1
    const ownB = b.segment.ownership === 'owned' ? 0 : 1
    if (ownA !== ownB) return ownA - ownB
    return (a.segment.latency ?? Infinity) - (b.segment.latency ?? Infinity)
  })
}

/**
 * Build a Route object from a completed ManualState, so the manually-picked
 * path can flow through the same RouteList/pin/project/export machinery as a
 * solver-produced route.
 * @param state The finished (or in-progress) manual route: origin + ordered steps.
 * @param _nodesById Unused (kept for a symmetrical signature with call sites
 *   that already have a nodesById lookup handy); node names are not needed
 *   here since Route only stores node ids.
 * @param segmentsById Lookup used to expand each step's segmentId into a full
 *   RouteSegmentDetail snapshot.
 * @returns A Route with a synthetic `manual-<timestamp>` id, aggregate
 *   distance/latency/cost totals (summed across steps), and
 *   end_to_end_reliability computed as the PRODUCT of each segment's
 *   reliability (matching how the backend solver computes path reliability —
 *   independent failures multiply, they don't average). `diversity_group` is
 *   always 0 since a manual route has no notion of a diverse pairing.
 */
export function assembleRoute(
  state: ManualState,
  _nodesById: Record<string, CableNode>,
  segmentsById: Record<string, CableSegment>,
): Route {
  const nodeIds = [state.originId, ...state.steps.map(s => s.nodeId)]
  const segDetails: RouteSegmentDetail[] = state.steps.map(step => {
    const seg = segmentsById[step.segmentId]!
    return {
      segment_id:   seg.id,
      system_id:    seg.system_id,
      start_node_id: seg.start_node_id,
      end_node_id:  seg.end_node_id,
      type:         seg.type,
      length_km:    seg.length_km,
      reliability:  seg.reliability,
      cost_weight:  seg.cost_weight,
      ownership:    seg.ownership,
      latency:      seg.latency,
    }
  })
  const totalKm      = segDetails.reduce((a, s) => a + s.length_km, 0)
  const totalLatency = segDetails.reduce((a, s) => a + s.latency, 0)
  const totalCost    = segDetails.reduce((a, s) => a + s.cost_weight, 0)
  // Product (not sum/average) of per-segment reliability: end-to-end
  // reliability of a series of independent links is the probability that
  // ALL of them are simultaneously up.
  const reliability  = segDetails.reduce((a, s) => a * s.reliability, 1)
  return {
    id:                    `manual-${Date.now()}`,
    nodes:                 nodeIds,
    segments:              segDetails,
    total_cost:            totalCost,
    total_length_km:       totalKm,
    total_latency:         totalLatency,
    end_to_end_reliability: reliability,
    diversity_group:       0,
  }
}

// ── RouteManual panel ─────────────────────────────────────────────────────────

/** Props shared by the single-panel {@link RouteManual} component. All
 *  callbacks are provided by the host (App.tsx / MobileLayout.tsx), which
 *  owns `state` and applies the resulting mutations. */
interface Props {
  nodes:    CableNode[]
  segments: CableSegment[]
  systems:  CableSystem[]
  capacity: SegmentCapacity[]
  state:    ManualState | null
  onStart:  (nodeId: string) => void   // user picks an origin via node search
  onPickHop: (candidate: NextHopCandidate) => void
  onUndo:   () => void
  onFinish: () => void   // triggered when user double-clicks end node
  onDiscard: () => void
  onNetOwnership: string[]
}

/**
 * Single-panel manual route builder, mounted by MobileLayout.tsx (phones
 * get one column, so origin search / running stats / next-hop candidates /
 * progressive path map are combined into tabs here instead of split across
 * separate desktop panels the way RouteManualLeft/RouteManualMiddle are).
 *
 * Renders one of two things depending on `state`:
 *  - state === null: {@link OriginSearch} — pick a starting node.
 *  - state set: a header with Undo/Finish/Discard controls and a running
 *    stats strip, plus a 'path' / 'nexthop' tab switcher — 'path' shows the
 *    {@link ManualMetroMap} built so far, 'nexthop' shows the filterable
 *    list of {@link NextHopCandidate}s computed via computeCandidates().
 *
 * All hop/candidate computation is memoised off `state` and the reference
 * data arrays so re-renders triggered by unrelated App.tsx state don't
 * recompute the neighbour scan.
 */
export function RouteManual({ nodes, segments, systems, capacity, state, onStart, onPickHop, onUndo, onFinish, onDiscard, onNetOwnership }: Props) {
  const t = useTheme()
  const [tab, setTab]       = useState<'nexthop' | 'path'>('nexthop')
  const [search, setSearch] = useState('')

  const nodesById       = useMemo(() => Object.fromEntries(nodes.map(n => [n.id, n])), [nodes])
  const segmentsById    = useMemo(() => Object.fromEntries(segments.map(s => [s.id, s])), [segments])
  const capacityBySegId = useMemo(() => Object.fromEntries(capacity.map(c => [c.segment_id, c])), [capacity])
  const onNetSet        = useMemo(() => new Set(onNetOwnership), [onNetOwnership])

  // The node the user is extending FROM right now: the last step's arrival
  // node if any hops have been picked yet, otherwise the origin itself.
  const currentNodeId = state
    ? (state.steps.length ? state.steps[state.steps.length - 1].nodeId : state.originId)
    : null

  // Every node already on the path (origin + all steps so far), passed to
  // computeCandidates() so it can exclude them and keep the route loop-free.
  const visitedIds = useMemo(() => {
    if (!state) return new Set<string>()
    return new Set([state.originId, ...state.steps.map(s => s.nodeId)])
  }, [state])

  const candidates = useMemo(() => {
    if (!currentNodeId) return []
    return computeCandidates(currentNodeId, visitedIds, segments, nodesById, systems, capacityBySegId)
  }, [currentNodeId, visitedIds, segments, nodesById, systems, capacityBySegId])

  // Free-text filter over the Next Hop candidate list — matches on the
  // neighbour node's id/name/country or the connecting segment's system id.
  const filtered = search.trim()
    ? candidates.filter(c => {
        const q = search.toLowerCase()
        return c.node.id.toLowerCase().includes(q) ||
               c.node.name.toLowerCase().includes(q) ||
               c.node.country.toLowerCase().includes(q) ||
               c.segment.system_id.toLowerCase().includes(q)
      })
    : candidates

  // Assemble running stats
  // Aggregate distance/latency/on-net% across every step committed so far,
  // for the header's live stat strip. null while no hops are picked yet, so
  // the strip is hidden entirely rather than showing all-zero stats.
  const runningStats = useMemo(() => {
    if (!state || state.steps.length === 0) return null
    const segs = state.steps.map(s => segmentsById[s.segmentId]).filter(Boolean) as CableSegment[]
    const km      = segs.reduce((a, s) => a + s.length_km, 0)
    const latency = segs.reduce((a, s) => a + s.latency, 0)
    const systems_used = [...new Set(segs.map(s => s.system_id))]
    const onNetKm  = segs.filter(s => onNetSet.has(s.ownership)).reduce((a, s) => a + s.length_km, 0)
    const onNetPct = km > 0 ? Math.round((onNetKm / km) * 100) : 0
    return { km, latency, systems_used, onNetPct }
  }, [state, segmentsById, onNetSet])

  const card = {
    background: t.bgCard, border: `1px solid ${t.border}`,
    borderRadius: 8, padding: '10px 12px', marginBottom: 8,
  }

  if (!state) {
    return (
      <OriginSearch nodes={nodes} onStart={onStart} card={card} />
    )
  }

  const hopCount = state.steps.length

  // Build ordered node+segment list for metro map
  const metroNodeIds = [state.originId, ...state.steps.map(s => s.nodeId)]
  const metroSegs    = state.steps.map(s => segmentsById[s.segmentId]).filter(Boolean) as CableSegment[]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '10px 12px 8px', borderBottom: `1px solid ${t.border}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: t.text }}>Building Route</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {hopCount > 0 && (
              <button onClick={onUndo} title="Undo last hop" style={{
                padding: '4px 10px', borderRadius: 5, fontSize: 11, fontWeight: 600,
                border: `1px solid ${t.border}`, background: 'transparent', color: t.textMuted,
                cursor: 'pointer', fontFamily: 'inherit',
              }}>↩ Undo</button>
            )}
            {hopCount > 0 && (
              <button onClick={onFinish} style={{
                padding: '4px 10px', borderRadius: 5, fontSize: 11, fontWeight: 700,
                border: 'none', background: t.green, color: '#fff',
                cursor: 'pointer', fontFamily: 'inherit',
              }}>✓ Finish</button>
            )}
            <button onClick={onDiscard} title="Discard and start over" style={{
              padding: '4px 10px', borderRadius: 5, fontSize: 11, fontWeight: 600,
              border: `1px solid ${t.red}44`, background: 'transparent', color: t.red,
              cursor: 'pointer', fontFamily: 'inherit',
            }}>✕</button>
          </div>
        </div>

        {/* Running stats */}
        {runningStats && (
          <div style={{ display: 'flex', gap: 0, borderRadius: 6, overflow: 'hidden', border: `1px solid ${t.border}` }}>
            {[
              { label: 'Hops',   value: `${hopCount}` },
              { label: 'km',     value: runningStats.km.toLocaleString() },
              { label: 'ms',     value: (runningStats.latency ?? 0).toFixed(1) },
              { label: 'On-Net', value: `${runningStats.onNetPct}%` },
            ].map(({ label, value }, i, arr) => (
              <div key={label} style={{
                flex: 1, textAlign: 'center', padding: '5px 2px',
                borderRight: i < arr.length - 1 ? `1px solid ${t.border}` : 'none',
              }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: t.text }}>{value}</div>
                <div style={{ fontSize: 9, color: t.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Tab bar: Path map | Next hop */}
      <div style={{ display: 'flex', borderBottom: `1px solid ${t.border}`, flexShrink: 0 }}>
        {(['path', 'nexthop'] as const).map(t_ => {
          const active = tab === t_
          const label  = t_ === 'path' ? `Path (${metroNodeIds.length})` : `Next Hop (${candidates.length})`
          return (
            <button
              key={t_}
              onClick={() => setTab(t_)}
              style={{
                flex: 1, padding: '7px 4px', fontSize: 11, fontWeight: active ? 700 : 400,
                color: active ? t.blue : t.textMuted,
                background: 'transparent', border: 'none',
                borderBottom: active ? `2px solid ${t.blue}` : '2px solid transparent',
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >{label}</button>
          )
        })}
      </div>

      {/* ── Path tab: progressive metro map ── */}
      {tab === 'path' && (
        <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px 16px' }}>
          {metroNodeIds.length === 1 && (
            <div style={{ fontSize: 11, color: t.textFaint, padding: '12px 0' }}>
              Origin set — pick the first hop to see the path grow.
            </div>
          )}
          <ManualMetroMap
            nodeIds={metroNodeIds}
            segments={metroSegs}
            nodesById={nodesById}
            onNetSet={onNetSet}
          />
        </div>
      )}

      {/* ── Next hop tab: filter + candidate list ── */}
      {tab === 'nexthop' && (
        <>
          <div style={{ padding: '8px 12px 6px', borderBottom: `1px solid ${t.border}`, flexShrink: 0 }}>
            <input
              placeholder="Filter nodes, country, system…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{
                width: '100%', background: t.bgBase, border: `1px solid ${t.border}`,
                borderRadius: 5, padding: '5px 8px', color: t.text, fontSize: 11,
                outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
              }}
            />
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '6px 10px 16px' }}>
            {filtered.length === 0 && (
              <div style={{ fontSize: 11, color: t.textFaint, textAlign: 'center', padding: '20px 0' }}>
                {candidates.length === 0 ? 'No onward connections from this node' : 'No matches'}
              </div>
            )}
            {filtered.map((c, idx) => {
              const dotColor   = candidateColor(idx)
              const ownerColor = onNetSet.has(c.segment.ownership) ? t.green : t.textMuted
              return (
                <button
                  key={c.segmentId}
                  onClick={() => { onPickHop(c); setTab('path') }}
                  style={{
                    width: '100%', textAlign: 'left', background: t.bgCard,
                    border: `1px solid ${t.border}`,
                    borderLeft: `3px solid ${dotColor}`,
                    borderRadius: 7,
                    padding: '9px 11px', marginBottom: 6, cursor: 'pointer',
                    fontFamily: 'inherit', transition: 'border-color 0.1s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = dotColor; e.currentTarget.style.borderLeftColor = dotColor }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = t.border; e.currentTarget.style.borderLeftColor = dotColor }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: 1 }}>
                      {/* Colour dot — matches the map circle */}
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor, flexShrink: 0 }} />
                      <div style={{ minWidth: 0 }}>
                        <span style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 800, color: t.blue }}>{c.node.id}</span>
                        <span style={{ fontSize: 11, color: t.textFaint }}> – </span>
                        <span style={{ fontSize: 11, fontWeight: 600, color: t.text }}>{c.node.name}</span>
                      </div>
                    </div>
                    <div style={{ fontSize: 10, color: t.textMuted, flexShrink: 0, marginLeft: 6 }}>{c.node.country}</div>
                  </div>
                  <div style={{ fontSize: 10, color: t.blue, marginBottom: 4, paddingLeft: 14 }}>{c.segment.system_id} · {c.segment.name}</div>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', paddingLeft: 14 }}>
                    <Stat label="km"   value={c.segment.length_km != null ? c.segment.length_km.toLocaleString() : '—'} />
                    <Stat label="ms"   value={c.segment.latency != null ? c.segment.latency.toFixed(1) : '—'} />
                    {c.margin != null && <Stat label="margin" value={`${c.margin.toFixed(0)}%`} />}
                    {c.availCapTbps != null && (
                      <Stat
                        label="avail"
                        value={`${c.availCapTbps.toFixed(1)}T`}
                        color={c.availCapTbps < 1 ? t.red : c.availCapTbps < 5 ? '#c07a20' : t.green}
                        bold
                      />
                    )}
                    <Stat label={OWNERSHIP_LABEL[c.segment.ownership] ?? c.segment.ownership} value="" color={ownerColor} bold />
                    <Stat label={c.segment.type} value="" color={c.segment.type === 'wet' ? t.blue : '#c07a20'} />
                  </div>
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

// ── Progressive metro map ─────────────────────────────────────────────────────

const AMBER = '#f9a825'

/**
 * Vertical "metro map" style rendering of the manual route built so far: a
 * dot for each node (blue for the origin, green for the current end, amber
 * for everything in between; smaller for branching units) connected by
 * tracked segment cards showing system, type, ON-NET status, distance and
 * latency. Used by both the single-panel {@link RouteManual} (path tab) and
 * the desktop {@link RouteManualMiddle} panel.
 * @param nodeIds Ordered node ids along the path: [originId, ...step node ids].
 * @param segments The segments taken for each step, in the same order (so
 *   segments[i-1] is the segment that led TO nodeIds[i]).
 */
function ManualMetroMap({ nodeIds, segments, nodesById, onNetSet }: {
  nodeIds:   string[]
  segments:  CableSegment[]
  nodesById: Record<string, CableNode>
  onNetSet:  Set<string>
}) {
  const t = useTheme()
  return (
    <div style={{ paddingBottom: 4 }}>
      {nodeIds.map((nodeId, i) => {
        // segments is one element shorter than nodeIds (n hops connect n+1
        // nodes), so segments[i-1] is the hop that led TO nodeIds[i]; it is
        // undefined for i===0 (the origin has no incoming segment).
        const seg     = segments[i - 1]   // segment that led TO this node (undefined for origin)
        const node    = nodesById[nodeId]
        const isBU    = node?.type === 'branching_unit'
        const isFirst = i === 0
        const isLast  = i === nodeIds.length - 1

        // Node dot colour: blue origin, green current end, amber intermediates
        const dotColor = isFirst ? '#60a5fa' : isLast ? '#4ade80' : AMBER
        const dotSize  = isBU ? 8 : 12
        const dotOffset = isBU ? 2 : 0

        // Segment track colour based on ownership
        const isOnNet     = seg ? onNetSet.has(seg.ownership) : false
        const trackColor  = seg?.type === 'wet' ? '#60a5fa88' : '#4ade8088'
        const cardBorder  = isOnNet ? '#4ade8066' : t.border
        const cardBg      = isOnNet ? '#4ade8011' : t.bgCard

        return (
          <div key={`${nodeId}-${i}`}>
            {/* Track + segment card above this node (i > 0) */}
            {seg && (
              <div style={{ display: 'flex', alignItems: 'stretch', margin: '2px 0' }}>
                <div style={{
                  width: 2, flexShrink: 0, background: trackColor,
                  marginLeft: 5, borderRadius: 1,
                }} />
                <div style={{
                  flex: 1, marginLeft: 10, marginTop: 3, marginBottom: 3,
                  padding: '5px 8px', borderRadius: 5,
                  border: `1px solid ${cardBorder}`, background: cardBg,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: seg.type === 'wet' ? '#60a5fa' : '#4ade80' }}>
                      {seg.system_id}
                    </span>
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      {isOnNet && (
                        <span style={{ fontSize: 7, fontWeight: 700, color: '#4ade80', background: '#4ade8022', padding: '1px 4px', borderRadius: 3, letterSpacing: '0.04em' }}>
                          ON-NET
                        </span>
                      )}
                      <span style={{ fontSize: 9, color: t.textFaint, textTransform: 'uppercase' as const }}>{seg.type}</span>
                    </div>
                  </div>
                  {seg.name && seg.name !== seg.system_id && (
                    <div style={{ fontSize: 9, color: t.textMuted, marginBottom: 2 }}>{seg.name}</div>
                  )}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' as const }}>
                    <span style={{ fontSize: 9, color: t.textFaint }}>{seg.length_km != null ? seg.length_km.toLocaleString() : '—'} km</span>
                    <span style={{ fontSize: 9, color: t.textFaint }}>{seg.latency != null ? seg.latency.toFixed(1) : '—'} ms</span>
                    <span style={{ fontSize: 9, color: t.textMuted }}>{OWNERSHIP_LABEL[seg.ownership] ?? seg.ownership}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Node dot + label */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{
                width: dotSize, height: dotSize, borderRadius: '50%',
                background: isFirst || isLast ? dotColor : t.bgDeep,
                border: `2px solid ${dotColor}`,
                flexShrink: 0, marginLeft: dotOffset,
              }} />
              <div style={{ minWidth: 0 }}>
                {isBU ? (
                  <span style={{ fontSize: 8, color: t.textFaint, fontFamily: 'monospace' }}>◈ {nodeId}</span>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 5, flexWrap: 'wrap' as const }}>
                    <span style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 800, color: dotColor }}>{nodeId}</span>
                    {node?.name && <span style={{ fontSize: 10, color: t.textMuted }}>– {node.name}</span>}
                    {node?.country && <span style={{ fontSize: 9, color: t.textFaint }}>{node.country}</span>}
                    {isFirst && <span style={{ fontSize: 8, fontWeight: 700, color: '#60a5fa', background: '#60a5fa22', padding: '1px 4px', borderRadius: 3 }}>ORIGIN</span>}
                    {isLast && nodeIds.length > 1 && <span style={{ fontSize: 8, fontWeight: 700, color: '#4ade80', background: '#4ade8022', padding: '1px 4px', borderRadius: 3 }}>HERE</span>}
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Origin search panel ───────────────────────────────────────────────────────

/**
 * Initial panel shown before a manual route has an origin: a live-filtering
 * node search (by name, country, or id — up to 8 matches shown) plus a short
 * "How it works" explainer. Calling `onStart(nodeId)` (via search result
 * click, or a map click handled upstream by the host) sets ManualState.
 */
function OriginSearch({ nodes, onStart, card }: {
  nodes: CableNode[]
  onStart: (nodeId: string) => void
  card: React.CSSProperties
}) {
  const t = useTheme()
  const [query, setQuery] = useState('')

  const results = query.trim().length >= 1
    ? nodes.filter(n =>
        n.name.toLowerCase().includes(query.toLowerCase()) ||
        n.country.toLowerCase().includes(query.toLowerCase()) ||
        n.id.toLowerCase().includes(query.toLowerCase())
      ).slice(0, 8)
    : []

  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: t.text, marginBottom: 8 }}>RouteManual</div>

      {/* Origin search */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: t.textMuted, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>
          Set origin node
        </div>
        <input
          autoFocus
          placeholder="Search by name, country or ID…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          style={{
            width: '100%', background: t.bgBase, border: `1px solid ${t.blue}`,
            borderRadius: 7, padding: '10px 12px', color: t.text, fontSize: 13,
            outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
          }}
        />
        {results.length > 0 && (
          <div style={{
            marginTop: 4, border: `1px solid ${t.border}`, borderRadius: 7,
            overflow: 'hidden', background: t.bgCard,
          }}>
            {results.map(n => (
              <button
                key={n.id}
                onClick={() => onStart(n.id)}
                style={{
                  width: '100%', textAlign: 'left', padding: '9px 12px',
                  background: 'transparent', border: 'none',
                  borderBottom: `1px solid ${t.border}`,
                  cursor: 'pointer', fontFamily: 'inherit',
                  display: 'flex', alignItems: 'baseline', gap: 8,
                }}
                onMouseEnter={e => (e.currentTarget.style.background = t.bgDeep)}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <span style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 800, color: t.blue, flexShrink: 0 }}>{n.id}</span>
                <span style={{ fontSize: 11, color: t.textFaint, flexShrink: 0 }}>–</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: t.text, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.name}</span>
                <span style={{ fontSize: 10, color: t.textMuted, flexShrink: 0 }}>{n.country}</span>
              </button>
            ))}
          </div>
        )}
        {query.trim().length >= 1 && results.length === 0 && (
          <div style={{ fontSize: 11, color: t.textFaint, padding: '8px 0' }}>No nodes match</div>
        )}
      </div>

      <div style={{ fontSize: 11, color: t.textMuted, marginBottom: 10 }}>
        or tap any node directly on the map
      </div>

      <div style={{ ...card, background: t.bgBase }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: t.blue, marginBottom: 6 }}>How it works</div>
        {[
          '① Set origin by searching above or tapping a node on the map',
          '② Reachable next hops highlight — pick from the list or tap the map',
          '③ Repeat until you reach your destination',
          '④ Tap Finish to review route stats, then pin or add to project',
        ].map((s, i) => (
          <div key={i} style={{ fontSize: 11, color: t.textMuted, marginBottom: 4, lineHeight: 1.5 }}>{s}</div>
        ))}
      </div>
    </div>
  )
}

// ── Stat chip ─────────────────────────────────────────────────────────────────

/** Small "value label" chip used in candidate rows and running-stat strips
 *  (e.g. "120 km", "owned" in green). When `value` is empty, only the label
 *  is shown (used for the ownership/type indicators that have no numeric
 *  value of their own). */
function Stat({ label, value, color, bold }: { label: string; value: string; color?: string; bold?: boolean }) {
  const t = useTheme()
  return (
    <span style={{ fontSize: 10, color: color ?? t.textMuted, fontWeight: bold ? 700 : 400 }}>
      {value ? <><span style={{ fontWeight: 700, color: color ?? t.text }}>{value}</span> {label}</> : label}
    </span>
  )
}

// ── Desktop split-panel components ────────────────────────────────────────────

/** Props shared by the desktop split-panel variant. Unlike the single-panel
 *  {@link RouteManual}, `candidates` is computed by the host and passed in
 *  (rather than derived internally) so both RouteManualLeft and the map can
 *  share the same computeCandidates() result without recomputing it twice. */
interface DesktopProps {
  nodes:          CableNode[]
  segments:       CableSegment[]
  systems:        CableSystem[]
  capacity:       SegmentCapacity[]
  state:          ManualState | null
  candidates:     NextHopCandidate[]
  onStart:        (nodeId: string) => void
  onPickHop:      (c: NextHopCandidate) => void
  onUndo:         () => void
  onFinish:       () => void
  onDiscard:      () => void
  onNetOwnership: string[]
}

/** Left panel for desktop: origin search → candidate list + stats + controls */
export function RouteManualLeft({ nodes, segments, systems: _systems, capacity: _capacity, state, candidates, onStart, onPickHop, onUndo, onFinish, onDiscard, onNetOwnership }: DesktopProps) {
  const t = useTheme()
  const [search, setSearch] = useState('')

  const segmentsById    = useMemo(() => Object.fromEntries(segments.map(s => [s.id, s])), [segments])
  const onNetSet        = useMemo(() => new Set(onNetOwnership), [onNetOwnership])

  // Free-text filter over the host-supplied candidate list (same matching
  // rules as the single-panel RouteManual: node id/name/country or system id).
  const filtered = search.trim()
    ? candidates.filter(c => {
        const q = search.toLowerCase()
        return c.node.id.toLowerCase().includes(q) ||
               c.node.name.toLowerCase().includes(q) ||
               c.node.country.toLowerCase().includes(q) ||
               c.segment.system_id.toLowerCase().includes(q)
      })
    : candidates

  // Aggregate distance/latency/on-net% across the committed steps for the
  // header's live stat strip; null (strip hidden) until the first hop is picked.
  const runningStats = useMemo(() => {
    if (!state || state.steps.length === 0) return null
    const segs = state.steps.map(s => segmentsById[s.segmentId]).filter(Boolean) as CableSegment[]
    const km      = segs.reduce((a, s) => a + s.length_km, 0)
    const latency = segs.reduce((a, s) => a + s.latency, 0)
    const onNetKm = segs.filter(s => onNetSet.has(s.ownership)).reduce((a, s) => a + s.length_km, 0)
    const onNetPct = km > 0 ? Math.round((onNetKm / km) * 100) : 0
    return { km, latency, hopCount: state.steps.length, onNetPct }
  }, [state, segmentsById, onNetSet])

  const card: React.CSSProperties = {
    background: t.bgCard, border: `1px solid ${t.border}`,
    borderRadius: 8, padding: '10px 12px', marginBottom: 8,
  }

  // ── No active route: show origin search ──
  if (!state) {
    return (
      <OriginSearch nodes={nodes} onStart={onStart} card={card} />
    )
  }

  // ── Building: stats + controls + candidate list ──
  const hopCount = state.steps.length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

      {/* Controls header */}
      <div style={{ padding: '10px 14px 8px', borderBottom: `1px solid ${t.border}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: runningStats ? 8 : 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: t.text }}>Building Route</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {hopCount > 0 && (
              <button onClick={onUndo} style={{
                padding: '4px 10px', borderRadius: 5, fontSize: 11, fontWeight: 600,
                border: `1px solid ${t.border}`, background: 'transparent', color: t.textMuted,
                cursor: 'pointer', fontFamily: 'inherit',
              }}>↩ Undo</button>
            )}
            {hopCount > 0 && (
              <button onClick={onFinish} style={{
                padding: '4px 12px', borderRadius: 5, fontSize: 11, fontWeight: 700,
                border: 'none', background: t.green, color: '#fff',
                cursor: 'pointer', fontFamily: 'inherit',
              }}>✓ Finish</button>
            )}
            <button onClick={onDiscard} style={{
              padding: '4px 8px', borderRadius: 5, fontSize: 11, fontWeight: 600,
              border: `1px solid ${t.red}44`, background: 'transparent', color: t.red,
              cursor: 'pointer', fontFamily: 'inherit',
            }}>✕</button>
          </div>
        </div>

        {/* Running stats strip */}
        {runningStats && (
          <div style={{ display: 'flex', gap: 0, borderRadius: 6, overflow: 'hidden', border: `1px solid ${t.border}` }}>
            {[
              { label: 'Hops',   value: `${runningStats.hopCount}` },
              { label: 'km',     value: runningStats.km.toLocaleString() },
              { label: 'ms',     value: (runningStats.latency ?? 0).toFixed(1) },
              { label: 'On-Net', value: `${runningStats.onNetPct}%` },
            ].map(({ label, value }, i, arr) => (
              <div key={label} style={{
                flex: 1, textAlign: 'center', padding: '5px 2px',
                borderRight: i < arr.length - 1 ? `1px solid ${t.border}` : 'none',
              }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: t.text }}>{value}</div>
                <div style={{ fontSize: 9, color: t.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Next hop header + filter */}
      <div style={{ padding: '8px 14px 6px', borderBottom: `1px solid ${t.border}`, flexShrink: 0 }}>
        <div style={{ fontSize: 10, color: t.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
          Next hop · {candidates.length} option{candidates.length !== 1 ? 's' : ''}
        </div>
        <input
          placeholder="Filter nodes, country, system…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            width: '100%', background: t.bgBase, border: `1px solid ${t.border}`,
            borderRadius: 5, padding: '5px 8px', color: t.text, fontSize: 11,
            outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
          }}
        />
      </div>

      {/* Candidate list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 10px 16px' }}>
        {filtered.length === 0 && (
          <div style={{ fontSize: 11, color: t.textFaint, textAlign: 'center', padding: '20px 0' }}>
            {candidates.length === 0 ? 'No onward connections from this node' : 'No matches'}
          </div>
        )}
        {filtered.map((c, idx) => {
          const dotColor   = candidateColor(idx)
          const ownerColor = onNetSet.has(c.segment.ownership) ? t.green : t.textMuted
          return (
            <button
              key={c.segmentId}
              onClick={() => onPickHop(c)}
              style={{
                width: '100%', textAlign: 'left', background: t.bgCard,
                border: `1px solid ${t.border}`,
                borderLeft: `3px solid ${dotColor}`,
                borderRadius: 7,
                padding: '9px 11px', marginBottom: 6, cursor: 'pointer',
                fontFamily: 'inherit', transition: 'border-color 0.1s',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = dotColor; e.currentTarget.style.borderLeftColor = dotColor }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = t.border; e.currentTarget.style.borderLeftColor = dotColor }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: 1 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor, flexShrink: 0 }} />
                  <div style={{ minWidth: 0 }}>
                    <span style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 800, color: t.blue }}>{c.node.id}</span>
                    <span style={{ fontSize: 11, color: t.textFaint }}> – </span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: t.text }}>{c.node.name}</span>
                  </div>
                </div>
                <div style={{ fontSize: 10, color: t.textMuted, flexShrink: 0, marginLeft: 6 }}>{c.node.country}</div>
              </div>
              <div style={{ fontSize: 10, color: t.blue, marginBottom: 4, paddingLeft: 14 }}>{c.segment.system_id} · {c.segment.name}</div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', paddingLeft: 14 }}>
                <Stat label="km"   value={c.segment.length_km != null ? c.segment.length_km.toLocaleString() : '—'} />
                <Stat label="ms"   value={c.segment.latency != null ? c.segment.latency.toFixed(1) : '—'} />
                {c.margin != null && <Stat label="margin" value={`${c.margin.toFixed(0)}%`} />}
                {c.availCapTbps != null && (
                  <Stat label="avail" value={`${c.availCapTbps.toFixed(1)}T`}
                    color={c.availCapTbps < 1 ? t.red : c.availCapTbps < 5 ? '#c07a20' : t.green} bold />
                )}
                <Stat label={OWNERSHIP_LABEL[c.segment.ownership] ?? c.segment.ownership} value="" color={ownerColor} bold />
                <Stat label={c.segment.type} value="" color={c.segment.type === 'wet' ? t.blue : '#c07a20'} />
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** Middle panel for desktop: progressive metro map of the WIP route */
export function RouteManualMiddle({ state, segments, nodes, onNetOwnership }: {
  state:          ManualState | null
  segments:       CableSegment[]
  nodes:          CableNode[]
  onNetOwnership: string[]
}) {
  const t = useTheme()
  const nodesById  = useMemo(() => Object.fromEntries(nodes.map(n => [n.id, n])), [nodes])
  const segById    = useMemo(() => Object.fromEntries(segments.map(s => [s.id, s])), [segments])
  const onNetSet   = useMemo(() => new Set(onNetOwnership), [onNetOwnership])

  if (!state) {
    return (
      <div style={{ padding: '24px 20px', color: t.textFaint, fontSize: 13 }}>
        Set an origin node on the left to begin building your route.
      </div>
    )
  }

  const metroNodeIds = [state.originId, ...state.steps.map(s => s.nodeId)]
  const metroSegs    = state.steps.map(s => segById[s.segmentId]).filter(Boolean) as CableSegment[]

  return (
    <div style={{ padding: '12px 16px 32px', overflowY: 'auto', height: '100%', boxSizing: 'border-box' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: t.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>
        Route in progress
      </div>
      <ManualMetroMap nodeIds={metroNodeIds} segments={metroSegs} nodesById={nodesById} onNetSet={onNetSet} />
    </div>
  )
}
