import { useMemo, useState } from 'react'
import type { CableNode, CableSegment, CableSystem, Route, RouteSegmentDetail, SegmentCapacity } from '../types'
import { useTheme } from '../theme'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ManualStep {
  nodeId:    string
  segmentId: string
}

export interface ManualState {
  originId:  string
  steps:     ManualStep[]   // each step: the segment taken + node arrived at
}

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

const OWNERSHIP_LABEL: Record<string, string> = {
  owned:                'Owned',
  consortium:           'Consortium',
  iru:                  'IRU',
  integrated_lit_lease: 'Int. Lit Lease',
  offnet_resell:        'Offnet Resell',
}

function getMargin(systemId: string, systems: CableSystem[]): number | null {
  return systems.find(s => s.id === systemId)?.margin ?? null
}

/** All direct neighbours of a node (excluding any already in the locked path) */
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
    let peerId: string | null = null
    if (seg.start_node_id === currentNodeId) peerId = seg.end_node_id
    else if (seg.end_node_id === currentNodeId) peerId = seg.start_node_id
    if (!peerId) continue
    if (visitedNodeIds.has(peerId)) continue   // no loops
    const node = nodesById[peerId]
    if (!node) continue
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
    return a.segment.latency - b.segment.latency
  })
}

/** Build a Route object from a completed ManualState */
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

export function RouteManual({ nodes, segments, systems, capacity, state, onPickHop, onUndo, onFinish, onDiscard, onNetOwnership }: Props) {
  const t = useTheme()
  const [filter, setFilter] = useState('')

  const nodesById       = useMemo(() => Object.fromEntries(nodes.map(n => [n.id, n])), [nodes])
  const segmentsById    = useMemo(() => Object.fromEntries(segments.map(s => [s.id, s])), [segments])
  const capacityBySegId = useMemo(() => Object.fromEntries(capacity.map(c => [c.segment_id, c])), [capacity])
  const onNetSet        = useMemo(() => new Set(onNetOwnership), [onNetOwnership])

  const currentNodeId = state
    ? (state.steps.length ? state.steps[state.steps.length - 1].nodeId : state.originId)
    : null

  const visitedIds = useMemo(() => {
    if (!state) return new Set<string>()
    return new Set([state.originId, ...state.steps.map(s => s.nodeId)])
  }, [state])

  const candidates = useMemo(() => {
    if (!currentNodeId) return []
    return computeCandidates(currentNodeId, visitedIds, segments, nodesById, systems, capacityBySegId)
  }, [currentNodeId, visitedIds, segments, nodesById, systems, capacityBySegId])

  const filtered = filter.trim()
    ? candidates.filter(c =>
        c.node.name.toLowerCase().includes(filter.toLowerCase()) ||
        c.node.country.toLowerCase().includes(filter.toLowerCase()) ||
        c.segment.system_id.toLowerCase().includes(filter.toLowerCase()))
    : candidates

  // Assemble running stats
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
      <div style={{ padding: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: t.text, marginBottom: 8 }}>RouteManual</div>
        <div style={{ fontSize: 12, color: t.textMuted, lineHeight: 1.6, marginBottom: 16 }}>
          Click any node on the map to set your <strong style={{ color: t.text }}>origin</strong> and begin building a path hop-by-hop.
        </div>
        <div style={{ ...card, background: t.bgBase }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: t.blue, marginBottom: 6 }}>How it works</div>
          {[
            '① Click a node on the map to set origin',
            '② Connected nodes highlight — pick the next hop from the list below or click on the map',
            '③ Repeat until you reach your destination',
            '④ Double-click the final node to finish and review route stats',
          ].map((s, i) => (
            <div key={i} style={{ fontSize: 11, color: t.textMuted, marginBottom: 4, lineHeight: 1.5 }}>{s}</div>
          ))}
        </div>
      </div>
    )
  }

  const originNode   = nodesById[state.originId]
  const currentNode  = currentNodeId ? nodesById[currentNodeId] : null
  const hopCount     = state.steps.length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '12px 14px', borderBottom: `1px solid ${t.border}`, flexShrink: 0 }}>
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
            <button onClick={onDiscard} title="Discard and start over" style={{
              padding: '4px 10px', borderRadius: 5, fontSize: 11, fontWeight: 600,
              border: `1px solid ${t.red}44`, background: 'transparent', color: t.red,
              cursor: 'pointer', fontFamily: 'inherit',
            }}>✕ Discard</button>
          </div>
        </div>

        {/* Path breadcrumb */}
        <div style={{ fontSize: 10, color: t.textMuted, lineHeight: 1.6, overflowX: 'auto', whiteSpace: 'nowrap' }}>
          <span style={{ color: t.blue, fontWeight: 700 }}>{originNode?.name ?? state.originId}</span>
          {state.steps.map((step, i) => {
            const n = nodesById[step.nodeId]
            const isLast = i === state.steps.length - 1
            return (
              <span key={i}>
                <span style={{ color: t.textFaint }}> → </span>
                <span style={{ color: isLast ? t.text : t.textMuted, fontWeight: isLast ? 700 : 400 }}>
                  {n?.name ?? step.nodeId}
                </span>
              </span>
            )
          })}
        </div>
      </div>

      {/* Running stats */}
      {runningStats && (
        <div style={{ display: 'flex', gap: 0, borderBottom: `1px solid ${t.border}`, flexShrink: 0 }}>
          {[
            { label: 'Hops',    value: `${hopCount}` },
            { label: 'km',      value: `${runningStats.km.toLocaleString()}` },
            { label: 'ms',      value: `${runningStats.latency.toFixed(1)}` },
            { label: 'On-Net',  value: `${runningStats.onNetPct}%` },
          ].map(({ label, value }) => (
            <div key={label} style={{ flex: 1, textAlign: 'center', padding: '7px 4px', borderRight: `1px solid ${t.border}` }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: t.text }}>{value}</div>
              <div style={{ fontSize: 9, color: t.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Current position */}
      <div style={{ padding: '10px 14px', borderBottom: `1px solid ${t.border}`, flexShrink: 0 }}>
        <div style={{ fontSize: 10, color: t.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3 }}>
          Current node
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: t.text }}>{currentNode?.name ?? currentNodeId}</div>
            <div style={{ fontSize: 10, color: t.textMuted }}>{currentNode?.country} · {currentNode?.type?.replace('_', ' ')}</div>
          </div>
          {hopCount > 0 && (
            <button
              onClick={onFinish}
              style={{
                padding: '6px 14px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                border: 'none', background: t.green, color: '#fff',
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              ✓ Finish Here
            </button>
          )}
        </div>
      </div>

      {/* Next hop candidates */}
      <div style={{ padding: '10px 14px 6px', borderBottom: `1px solid ${t.border}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <div style={{ fontSize: 10, color: t.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Next hop · {candidates.length} option{candidates.length !== 1 ? 's' : ''}
          </div>
        </div>
        <input
          placeholder="Filter nodes, country, system…"
          value={filter}
          onChange={e => setFilter(e.target.value)}
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
        {filtered.map(c => {
          const isOwned  = onNetSet.has(c.segment.ownership)
          const ownerColor = isOwned ? t.green : t.textMuted
          return (
            <button
              key={c.segmentId}
              onClick={() => onPickHop(c)}
              style={{
                width: '100%', textAlign: 'left', background: t.bgCard,
                border: `1px solid ${t.border}`, borderRadius: 7,
                padding: '9px 11px', marginBottom: 6, cursor: 'pointer',
                fontFamily: 'inherit', transition: 'border-color 0.1s',
              }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = t.blue)}
              onMouseLeave={e => (e.currentTarget.style.borderColor = t.border)}
            >
              {/* Node name + country */}
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 3 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: t.text }}>{c.node.name}</div>
                <div style={{ fontSize: 10, color: t.textMuted }}>{c.node.country}</div>
              </div>
              {/* Segment / system */}
              <div style={{ fontSize: 10, color: t.blue, marginBottom: 4 }}>{c.segment.system_id} · {c.segment.name}</div>
              {/* Stats row */}
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <Stat label="km"      value={c.segment.length_km.toLocaleString()} />
                <Stat label="ms"      value={c.segment.latency.toFixed(1)} />
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
    </div>
  )
}

function Stat({ label, value, color, bold }: { label: string; value: string; color?: string; bold?: boolean }) {
  const t = useTheme()
  return (
    <span style={{ fontSize: 10, color: color ?? t.textMuted, fontWeight: bold ? 700 : 400 }}>
      {value ? <><span style={{ fontWeight: 700, color: color ?? t.text }}>{value}</span> {label}</> : label}
    </span>
  )
}
