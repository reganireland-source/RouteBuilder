/**
 * NewSegmentForm — inline form for creating a segment between two EXISTING
 * nodes, with plausible defaults so nobody has to know every field before
 * they start.
 *
 * Extracted from NetworkEditor.tsx (where it still lives, via CreatePanel's
 * click-two-nodes flow) so KmlChopImport.tsx's "this stretch doesn't match
 * any segment we have — create one" flow can reuse it exactly rather than
 * rebuilding the same form. CALLER-AGNOSTIC BY DESIGN: this component never
 * calls the backend itself, only `onCreate(segment, capacity)` — Network
 * Editor stages that into its PendingChange list for a later Save All,
 * KmlChopImport calls api.createSegment/api.createCapacity immediately
 * instead (a chop session has no staged-changes model of its own; see
 * kmlChop's own docs). Same component, two different "what happens next".
 *
 * `suggestedLengthKm`, if given, overrides the default straight-line
 * great-circle guess between the two nodes — KmlChopImport passes the
 * REAL on-file stretch length it already has in hand, which is a better
 * starting point than a straight line when real geometry is on screen.
 */
import { useState } from 'react'
import type { CableNode, CableSegment, CableSystem, SegmentCapacity, SegmentType, Ownership } from '../types'
import { useTheme } from '../theme'
import { nodeLabel } from '../utils/nodeLabel'
import { pathLengthKm, suggestSegmentDefaults, generateSegmentId, generateSegmentName } from '../utils/editorGeo'
import { LabeledInput, LabeledSelect, OWNERSHIP_OPTS, actionBtn } from './formFields'

/** Props for {@link NewSegmentForm}. */
interface Props {
  startNode: CableNode
  endNode: CableNode
  /** All cable systems — used to populate the System select for a 'wet'
   *  segment (terrestrial segments are always pinned to the synthetic
   *  'TERRESTRIAL' system, see `effectiveSystemId` below). */
  systems: CableSystem[]
  /** All existing segments — used only for id-collision checking (`idTaken`)
   *  and passed straight through to generateSegmentId's own suggestion logic. */
  segments: CableSegment[]
  suggestedLengthKm?: number
  onCancel: () => void
  /** Called with a fully-formed CableSegment + SegmentCapacity once the form
   *  is valid and submitted. Never touches the backend itself — see the file
   *  header comment for why (two different callers, two different "what
   *  happens next"). */
  onCreate: (segment: CableSegment, capacity: SegmentCapacity) => void
}

/**
 * Inline form for creating one CableSegment (+ its initial SegmentCapacity)
 * between two already-existing nodes. See the file header docblock for why
 * this is a standalone, caller-agnostic component rather than living only
 * inside NetworkEditor.tsx.
 *
 * Owns all of the segment's editable fields as local state, pre-filled with
 * plausible defaults (suggestSegmentDefaults()) derived from either the
 * caller-supplied `suggestedLengthKm` or the great-circle distance between
 * the two nodes (pathLengthKm()). The id/name fields and the latency/cost-
 * weight/reliability defaults are RE-SUGGESTED (not locked) whenever type,
 * system, or length change — see retype()/resystem()/relength() below — but
 * the user can still freely overwrite any field by hand afterward; nothing
 * here re-derives a field the user has directly edited themselves except via
 * one of those three specific triggers.
 */
export function NewSegmentForm({ startNode, endNode, systems, segments, suggestedLengthKm, onCancel, onCreate }: Props) {
  const t = useTheme()
  const nonTerrestrialSystems = systems.filter(s => s.id !== 'TERRESTRIAL')
  const suggestedLength = Math.round(
    suggestedLengthKm ?? pathLengthKm([startNode.lat, startNode.lng], [endNode.lat, endNode.lng]),
  )

  const [type, setType] = useState<SegmentType>('wet')
  const [systemId, setSystemId] = useState(() => nonTerrestrialSystems[0]?.id ?? systems[0]?.id ?? '')
  const [ownership, setOwnership] = useState<Ownership>('owned')
  const [lengthKm, setLengthKm] = useState(String(suggestedLength))
  const defaults = suggestSegmentDefaults(parseFloat(lengthKm) || 0, type)
  const [latency, setLatency] = useState(String(defaults.latency))
  const [costWeight, setCostWeight] = useState(String(defaults.cost_weight))
  const [reliability, setReliability] = useState(String(defaults.reliability))
  const [rfsStatus, setRfsStatus] = useState<'in_service' | 'planned'>('in_service')
  const [rfsQuarter, setRfsQuarter] = useState('')
  const [totalCap, setTotalCap] = useState('')
  const [availCap, setAvailCap] = useState('')

  // Terrestrial segments always belong to the synthetic 'TERRESTRIAL' system
  // regardless of whatever `systemId` was last selected while `type` was
  // 'wet' — this is the value actually submitted (see the `system_id` field
  // in the onCreate call below), not `systemId` itself.
  const effectiveSystemId = type === 'terrestrial' ? 'TERRESTRIAL' : systemId
  const [id, setId] = useState(() => generateSegmentId('wet', nonTerrestrialSystems[0]?.id ?? '', startNode, endNode, segments))
  const [name, setName] = useState(() => generateSegmentName('wet', nonTerrestrialSystems[0], startNode, endNode))

  /** Re-suggest id/name/metrics when the inputs they derive from change —
   *  the user can still overwrite any of them afterwards. */
  function retype(next: SegmentType) {
    setType(next)
    const sysId = next === 'terrestrial' ? 'TERRESTRIAL' : systemId
    setId(generateSegmentId(next, sysId, startNode, endNode, segments))
    setName(generateSegmentName(next, systems.find(s => s.id === sysId), startNode, endNode))
    const d = suggestSegmentDefaults(parseFloat(lengthKm) || 0, next)
    setLatency(String(d.latency)); setCostWeight(String(d.cost_weight)); setReliability(String(d.reliability))
  }
  /** Re-suggests id/name when the chosen System changes — a no-op while
   *  `type === 'terrestrial'`, since the system is then always 'TERRESTRIAL'
   *  regardless of `systemId` (see `effectiveSystemId`), so there is nothing
   *  meaningful to re-derive from a system pick the UI doesn't even show. */
  function resystem(next: string) {
    setSystemId(next)
    if (type !== 'terrestrial') {
      setId(generateSegmentId(type, next, startNode, endNode, segments))
      setName(generateSegmentName(type, systems.find(s => s.id === next), startNode, endNode))
    }
  }
  /** Re-derives latency and cost weight (not id/name, which don't depend on
   *  length) whenever the length field changes. */
  function relength(next: string) {
    setLengthKm(next)
    const d = suggestSegmentDefaults(parseFloat(next) || 0, type)
    setLatency(String(d.latency)); setCostWeight(String(d.cost_weight))
  }

  const idTaken = segments.some(s => s.id.toUpperCase() === id.trim().toUpperCase())
  const quarterValid = rfsStatus !== 'planned' || /^\d{4}-Q[1-4]$/.test(rfsQuarter)
  const totalNum = parseFloat(totalCap)
  const availNum = parseFloat(availCap)
  const capValid = !Number.isNaN(totalNum) && !Number.isNaN(availNum) && totalNum >= 0 && availNum >= 0 && availNum <= totalNum
  const relNum = parseFloat(reliability)
  const valid = id.trim() !== '' && !idTaken && name.trim() !== '' && effectiveSystemId !== ''
    && !Number.isNaN(parseFloat(lengthKm)) && relNum > 0 && relNum <= 1 && quarterValid && capValid

  return (
    <div style={{ padding: 10, borderRadius: 6, border: `1px solid ${t.green}55`, background: t.green + '0d', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: t.text }}>
        New segment
        <div style={{ fontSize: 11, fontWeight: 400, color: t.textMuted, marginTop: 2 }}>
          {nodeLabel(startNode)} → {nodeLabel(endNode)}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6 }}>
        <LabeledSelect label="Type" value={type} onChange={retype} options={[{ value: 'wet' as SegmentType, label: 'Wet' }, { value: 'terrestrial' as SegmentType, label: 'Terrestrial' }]} />
        {type === 'wet' ? (
          <LabeledSelect label="System" value={systemId} onChange={resystem} options={nonTerrestrialSystems.map(s => ({ value: s.id, label: `${s.id} — ${s.name}` }))} />
        ) : (
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <label style={{ fontSize: 10, color: t.textFaint, textTransform: 'uppercase', letterSpacing: '0.05em' }}>System</label>
            <div style={{ fontSize: 12, color: t.textMuted, padding: '4px 0' }}>TERRESTRIAL</div>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 6 }}>
        <LabeledInput label="ID" value={id} onChange={setId} invalid={idTaken || id.trim() === ''} />
        <LabeledSelect label="Ownership" value={ownership} onChange={setOwnership} options={OWNERSHIP_OPTS} />
      </div>
      <LabeledInput label="Name" value={name} onChange={setName} invalid={name.trim() === ''} />

      <div style={{ display: 'flex', gap: 6 }}>
        <LabeledInput label="Length (km)" value={lengthKm} onChange={relength} />
        <LabeledInput label="Latency (ms)" value={latency} onChange={setLatency} />
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <LabeledInput label="Cost weight" value={costWeight} onChange={setCostWeight} />
        <LabeledInput label="Reliability" value={reliability} onChange={setReliability} invalid={!(relNum > 0 && relNum <= 1)} />
      </div>

      <div style={{ display: 'flex', gap: 6 }}>
        <LabeledSelect
          label="Ready for Service" value={rfsStatus}
          onChange={(v) => { setRfsStatus(v); if (v === 'in_service') setRfsQuarter('') }}
          options={[{ value: 'in_service' as const, label: 'In Service' }, { value: 'planned' as const, label: 'Planned' }]}
        />
        {rfsStatus === 'planned' && (
          <LabeledInput label="RFS Quarter" value={rfsQuarter} onChange={setRfsQuarter} placeholder="2027-Q3" invalid={!quarterValid} />
        )}
      </div>

      <div style={{ display: 'flex', gap: 6 }}>
        <LabeledInput label="Total capacity (T)" value={totalCap} onChange={setTotalCap} placeholder="2" invalid={totalCap !== '' && Number.isNaN(totalNum)} />
        <LabeledInput label="Available (T)" value={availCap} onChange={setAvailCap} placeholder="2" invalid={availCap !== '' && (Number.isNaN(availNum) || availNum > totalNum)} />
      </div>
      {!capValid && (totalCap !== '' || availCap !== '') && (
        <div style={{ fontSize: 11, color: t.red }}>Both capacities are required; available cannot exceed total.</div>
      )}
      {idTaken && <div style={{ fontSize: 11, color: t.red }}>That segment id is already taken.</div>}

      <div style={{ display: 'flex', gap: 6 }}>
        <button
          disabled={!valid}
          onClick={() => {
            const segId = id.trim().toUpperCase()
            onCreate(
              {
                id: segId, name: name.trim(), system_id: effectiveSystemId,
                start_node_id: startNode.id, end_node_id: endNode.id, type,
                length_km: parseFloat(lengthKm), reliability: relNum,
                cost_weight: parseFloat(costWeight) || 1, ownership,
                latency: parseFloat(latency) || 0,
                verification_status: 'draft',
                rfs_status: rfsStatus,
                rfs_quarter: rfsStatus === 'planned' ? rfsQuarter : null,
              },
              { segment_id: segId, total_capacity_t: totalNum, available_capacity_t: availNum },
            )
          }}
          style={actionBtn(t, 'primary', !valid)}
        >Add segment</button>
        <button onClick={onCancel} style={actionBtn(t, 'ghost')}>Cancel</button>
      </div>
      <div style={{ fontSize: 10, color: t.textFaintest }}>
        {suggestedLengthKm != null
          ? 'Suggested length is the on-file distance for this stretch; latency and cost are derived from it.'
          : 'Suggested length is the great-circle distance between the two nodes; latency and cost are derived from it.'}
        {' '}Adjust anything before adding.
      </div>
    </div>
  )
}
