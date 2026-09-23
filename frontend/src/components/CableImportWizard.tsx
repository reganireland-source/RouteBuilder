/**
 * ============================================================================
 *  CableImportWizard.tsx — model a cable we do not own.
 * ============================================================================
 *
 * Phase 1 of the "Cable Import" feature (see the approved plan): a manual,
 * four-step wizard that creates a CableSystem, resolves or creates its
 * landing-station Nodes, and proposes+creates a trunk-topology breakdown of
 * Segments — with no web research and no geometry sync yet (that's Phase 2/3).
 * It exists so a competitor/future cable this org does not own can be modeled
 * with the same rigor as owned infrastructure, without ever touching a
 * scraper. Every created segment defaults to Ownership.offnet_resell and
 * participates in RouteFinder exactly like any other off-net segment today —
 * a deliberate choice confirmed with the user, not an oversight (see the
 * plan's Context section).
 *
 * Steps:
 *   1. Cable identity   — system-level facts (name, RFS/EOL, fibre pairs,
 *      consortium owners). Staged only; nothing is POSTed until step 4.
 *   2. Landing stations  — an ORDERED list (order drives step 3's default
 *      trunk chop). Each row is either linked to an existing node (ranked by
 *      utils/nodeMatch.ts's rankNodeCandidates) or resolved to a new CLS.
 *   3. Segment breakdown — auto-proposed as one segment per consecutive
 *      landing pair, then freely editable (including re-pointing a row's own
 *      start/end, which covers both "merge two hops" and "branch to a third
 *      landing" without needing dedicated merge/branch controls).
 *   4. Review & create   — POSTs in dependency order (system → new nodes →
 *      segments → capacity), one item at a time with its own progress state,
 *      matching the commit pattern already established by
 *      hooks/useKmlChopState.ts's own commit() function.
 *
 * Reuses rather than reinvents: generateNodeId/generateSegmentId/
 * generateSegmentName/suggestSegmentDefaults (utils/editorGeo.ts, the same
 * helpers Network Editor's own "create segment" flow uses), haversineKm for
 * a straight-line length_km placeholder (the same fallback NewSegmentForm
 * uses before real geometry exists), and the api.create* endpoints already
 * used everywhere else in the app — no new backend CRUD.
 */
import { useId, useMemo, useState } from 'react'
import type {
  CableNode, CableSegment, CableSystem, EolStatus, NodeType, Ownership, RfsStatus, SegmentType,
} from '../types'
import { useTheme } from '../theme'
import type { Theme } from '../theme'
import { api } from '../api/client'
import {
  generateNodeId, generateSegmentId, generateSegmentName, haversineKm, suggestSegmentDefaults,
} from '../utils/editorGeo'
import { rankNodeCandidates } from '../utils/nodeMatch'
import { NODE_TYPE_LABEL } from '../mapGeometry'

interface Props {
  nodes: CableNode[]
  segments: CableSegment[]
  systems: CableSystem[]
  onClose: () => void
  onDataChange: () => void
}

// ── Draft state ──────────────────────────────────────────────────────────

interface SystemDraft {
  id: string
  name: string
  description: string
  margin: string
  rfs_status: RfsStatus
  rfs_quarter: string
  eol_status: EolStatus
  eol_quarter: string
  fiber_pair_count: string
  consortium_owners: string[]
}

function emptySystemDraft(): SystemDraft {
  return {
    id: '', name: '', description: '', margin: '',
    rfs_status: 'planned', rfs_quarter: '', eol_status: 'active', eol_quarter: '',
    fiber_pair_count: '', consortium_owners: [],
  }
}

interface LandingDraft {
  key: string
  name: string
  lat: string
  lng: string
  city: string
  country: string
  resolution: 'unresolved' | 'existing' | 'new'
  existingNodeId?: string
  newNodeId?: string
  newNodeType: NodeType
  newNodeOwner: string
}

let landingKeySeq = 0
function emptyLandingDraft(): LandingDraft {
  landingKeySeq += 1
  return {
    key: `landing-${landingKeySeq}`,
    name: '', lat: '', lng: '', city: '', country: '',
    resolution: 'unresolved', newNodeType: 'landing_station', newNodeOwner: '',
  }
}

interface SegmentDraft {
  key: string
  startKey: string
  endKey: string
  id: string
  name: string
  type: SegmentType
  ownership: Ownership
  length_km: string
  reliability: string
  cost_weight: string
  total_capacity_t: string
}

let segmentKeySeq = 0

// ── Small local helpers ──────────────────────────────────────────────────

/** backend/app/id_utils.py's ID_MAX_LEN for a system (same cap as a node). */
const SYSTEM_ID_MAX_LEN = 15

/** Same character allow-list AND length cap as the backend's id normaliser,
 *  applied to a suggested system id the same way editorGeo.ts's (unexported)
 *  sanitiseId trims a suggested segment id — this only ever trims a
 *  SUGGESTION, so being off by a character costs a retype, not a corruption. */
function slugifySystemId(name: string): string {
  return name.toUpperCase().replace(/[^A-Z0-9_&-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, SYSTEM_ID_MAX_LEN)
}

/** The node id a landing row resolves to, or undefined while unresolved. */
function landingNodeId(row: LandingDraft): string | undefined {
  if (row.resolution === 'existing') return row.existingNodeId
  if (row.resolution === 'new') return row.newNodeId
  return undefined
}

/** The real CableNode a landing row resolves to (existing lookup), or a
 *  synthesised stand-in for a not-yet-created new node — good enough for
 *  generateSegmentId/generateSegmentName/distance math, which only read
 *  id/name/lat/lng/country/type off it. */
function landingAsNode(row: LandingDraft, nodes: CableNode[]): CableNode | undefined {
  if (row.resolution === 'existing') return nodes.find(n => n.id === row.existingNodeId)
  if (row.resolution === 'new') {
    const lat = parseFloat(row.lat)
    const lng = parseFloat(row.lng)
    if (!row.newNodeId || Number.isNaN(lat) || Number.isNaN(lng)) return undefined
    return {
      id: row.newNodeId, name: row.name || row.newNodeId, lat, lng,
      type: row.newNodeType, country: row.country, owner: row.newNodeOwner || undefined, city: row.city,
    }
  }
  return undefined
}

const OWNERSHIP_LABEL: Record<Ownership, string> = {
  owned: 'Owned', consortium: 'Consortium', iru: 'IRU',
  integrated_lit_lease: 'Integrated Lit Lease', offnet_resell: 'Offnet Resell',
}

function fieldStyle(t: Theme): React.CSSProperties {
  return {
    background: t.bgInput, border: `1px solid ${t.border}`, borderRadius: 3,
    color: t.text, fontSize: 12, padding: '4px 7px', width: '100%', boxSizing: 'border-box',
    fontFamily: 'inherit',
  }
}
function labelStyle(t: Theme): React.CSSProperties {
  return { fontSize: 10, color: t.textFaint, textTransform: 'uppercase', letterSpacing: '0.05em' }
}

/** One labelled input, wired up with a stable id via useId — every field in
 *  this wizard uses this so labels stay properly associated (matching this
 *  app's earlier form-label accessibility fixes). */
function LabeledField({ label, children }: { label: string; children: (id: string) => React.ReactNode }) {
  const id = useId()
  const t = useTheme()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <label htmlFor={id} style={labelStyle(t)}>{label}</label>
      {children(id)}
    </div>
  )
}

// ── Step 1: Cable identity ───────────────────────────────────────────────

function StatusQuarterField({ draft, setDraft, kind }: {
  draft: SystemDraft
  setDraft: (d: SystemDraft) => void
  kind: 'rfs' | 'eol'
}) {
  const t = useTheme()
  const isRfs = kind === 'rfs'
  const statusVal = isRfs ? draft.rfs_status : draft.eol_status
  const quarterVal = isRfs ? draft.rfs_quarter : draft.eol_quarter
  const activeValue = isRfs ? 'planned' : 'eol'
  const isActive = statusVal === activeValue
  const options: [string, string][] = isRfs
    ? [['in_service', 'In Service'], ['planned', 'Planned']]
    : [['active', 'Active'], ['eol', 'Scheduled EOL']]

  function onStatusChange(value: string) {
    if (isRfs) setDraft({ ...draft, rfs_status: value as RfsStatus, rfs_quarter: value === 'planned' ? draft.rfs_quarter : '' })
    else setDraft({ ...draft, eol_status: value as EolStatus, eol_quarter: value === 'eol' ? draft.eol_quarter : '' })
  }
  function onQuarterChange(value: string) {
    if (isRfs) setDraft({ ...draft, rfs_quarter: value })
    else setDraft({ ...draft, eol_quarter: value })
  }

  return (
    <>
      <LabeledField label={isRfs ? 'Ready for Service' : 'End of Life'}>
        {id => (
          <select id={id} style={fieldStyle(t)} value={statusVal} onChange={e => onStatusChange(e.target.value)}>
            {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        )}
      </LabeledField>
      {isActive && (
        <LabeledField label={isRfs ? 'RFS Quarter' : 'EOL Quarter'}>
          {id => (
            <input
              id={id} style={fieldStyle(t)} type="text" autoComplete="off" placeholder="2027-Q3"
              value={quarterVal} onChange={e => onQuarterChange(e.target.value)}
            />
          )}
        </LabeledField>
      )}
    </>
  )
}

function ConsortiumOwnersField({ owners, setOwners }: { owners: string[]; setOwners: (o: string[]) => void }) {
  const t = useTheme()
  const [draftName, setDraftName] = useState('')
  const id = useId()

  function add() {
    const name = draftName.trim()
    if (name && !owners.includes(name)) setOwners([...owners, name])
    setDraftName('')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <label htmlFor={id} style={labelStyle(t)}>Consortium Owners</label>
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          id={id} style={fieldStyle(t)} type="text" autoComplete="off" placeholder="Add an operator…"
          value={draftName} onChange={e => setDraftName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
        />
        <button type="button" onClick={add} style={{
          flexShrink: 0, padding: '4px 10px', borderRadius: 3, border: `1px solid ${t.border}`,
          background: t.bgCard, color: t.text, fontSize: 12, cursor: 'pointer',
        }}>Add</button>
      </div>
      {owners.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
          {owners.map(name => (
            <span key={name} style={{
              display: 'flex', alignItems: 'center', gap: 5, fontSize: 11,
              padding: '2px 7px', borderRadius: 10, background: t.bgCard, border: `1px solid ${t.border}`,
            }}>
              {name}
              <button
                type="button" onClick={() => setOwners(owners.filter(o => o !== name))}
                aria-label={`Remove ${name}`}
                style={{ border: 'none', background: 'transparent', color: t.textFaint, cursor: 'pointer', fontSize: 12, padding: 0, lineHeight: 1 }}
              >×</button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function StepIdentity({ draft, setDraft, systems }: {
  draft: SystemDraft
  setDraft: (d: SystemDraft) => void
  systems: CableSystem[]
}) {
  const t = useTheme()
  const idTaken = draft.id.length > 0 && systems.some(s => s.id === draft.id)
  const idTooLong = draft.id.length > SYSTEM_ID_MAX_LEN
  const idInvalid = idTaken || idTooLong

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 460 }}>
      <LabeledField label="Cable Name">
        {id => (
          <input
            id={id} style={fieldStyle(t)} type="text" autoComplete="off" placeholder="e.g. Bifrost"
            value={draft.name}
            onChange={e => {
              const name = e.target.value
              // Only auto-follow the id while the user hasn't hand-edited it —
              // otherwise typing a name after fixing a typo'd id would silently
              // clobber the fix.
              const autoId = draft.id === '' || draft.id === slugifySystemId(draft.name)
              setDraft({ ...draft, name, id: autoId ? slugifySystemId(name) : draft.id })
            }}
          />
        )}
      </LabeledField>
      <LabeledField label="System ID">
        {id => (
          <input
            id={id} style={{ ...fieldStyle(t), border: `1px solid ${idInvalid ? t.red : t.border}` }}
            type="text" autoComplete="off" maxLength={SYSTEM_ID_MAX_LEN}
            value={draft.id} onChange={e => setDraft({ ...draft, id: e.target.value.toUpperCase() })}
          />
        )}
      </LabeledField>
      {idTaken && <span style={{ fontSize: 11, color: t.red }}>A system with this id already exists.</span>}
      {idTooLong && <span style={{ fontSize: 11, color: t.red }}>System ids are capped at {SYSTEM_ID_MAX_LEN} characters.</span>}
      <LabeledField label="Description">
        {id => (
          <textarea
            id={id} style={{ ...fieldStyle(t), minHeight: 50, resize: 'vertical' }}
            value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })}
          />
        )}
      </LabeledField>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <StatusQuarterField draft={draft} setDraft={setDraft} kind="rfs" />
        <StatusQuarterField draft={draft} setDraft={setDraft} kind="eol" />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <LabeledField label="Fibre Pair Count">
          {id => (
            <input
              id={id} style={fieldStyle(t)} type="number" min={0} autoComplete="off"
              value={draft.fiber_pair_count} onChange={e => setDraft({ ...draft, fiber_pair_count: e.target.value })}
            />
          )}
        </LabeledField>
        <LabeledField label="Margin">
          {id => (
            <input
              id={id} style={fieldStyle(t)} type="number" step="any" autoComplete="off"
              value={draft.margin} onChange={e => setDraft({ ...draft, margin: e.target.value })}
            />
          )}
        </LabeledField>
      </div>
      <ConsortiumOwnersField
        owners={draft.consortium_owners}
        setOwners={owners => setDraft({ ...draft, consortium_owners: owners })}
      />
    </div>
  )
}

// ── Step 2: Landing stations ─────────────────────────────────────────────

function NodeCandidateRow({ candidate, onLink, t }: {
  candidate: { node: CableNode; distKm: number; nameScore: number }
  onLink: () => void
  t: Theme
}) {
  return (
    <button
      type="button" onClick={onLink}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
        padding: '5px 8px', borderRadius: 4, border: `1px solid ${t.border}`, background: t.bgCard,
        color: t.text, fontSize: 12, cursor: 'pointer', marginBottom: 4,
      }}
    >
      <span style={{ fontWeight: 700 }}>{candidate.node.id}</span>
      <span style={{ color: t.textFaint, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {candidate.node.name}
      </span>
      <span style={{ fontSize: 10, color: t.textFaint, flexShrink: 0 }}>{candidate.distKm.toFixed(0)} km away</span>
    </button>
  )
}

function LandingRow({ row, index, onChange, onRemove, nodes, defaultOwner }: {
  row: LandingDraft
  index: number
  onChange: (row: LandingDraft) => void
  onRemove: () => void
  nodes: CableNode[]
  defaultOwner: string
}) {
  const t = useTheme()
  const lat = parseFloat(row.lat)
  const lng = parseFloat(row.lng)
  const hasCoords = !Number.isNaN(lat) && !Number.isNaN(lng)

  const candidates = useMemo(
    () => (hasCoords ? rankNodeCandidates({ lat, lng, name: row.name, city: row.city }, nodes) : []),
    [hasCoords, lat, lng, row.name, row.city, nodes],
  )

  function createNew() {
    const newId = generateNodeId(row.country, row.newNodeType, nodes)
    // Pre-fill from the cable's own consortium — a landing station almost
    // always belongs to one of the system's declared owners, not "Telstra"
    // (Node.owner's server-side default), which would be actively wrong for
    // a cable this org doesn't operate. Still freely editable below.
    onChange({ ...row, resolution: 'new', newNodeId: newId, newNodeOwner: row.newNodeOwner || defaultOwner })
  }

  return (
    <div style={{ border: `1px solid ${t.border}`, borderRadius: 6, padding: 10, marginBottom: 10, background: t.bgPanel }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{
          width: 20, height: 20, borderRadius: '50%', background: t.bgCard, border: `1px solid ${t.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, flexShrink: 0,
        }}>{index + 1}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: t.textFaint, flex: 1 }}>LANDING STATION</span>
        <button type="button" onClick={onRemove} aria-label="Remove landing station" style={{
          border: 'none', background: 'transparent', color: t.textFaint, cursor: 'pointer', fontSize: 14, padding: 0,
        }}>×</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
        <LabeledField label="Name">
          {id => <input id={id} style={fieldStyle(t)} type="text" autoComplete="off" value={row.name}
            onChange={e => onChange({ ...row, name: e.target.value, resolution: 'unresolved' })} />}
        </LabeledField>
        <LabeledField label="Lat">
          {id => <input id={id} style={fieldStyle(t)} type="number" step="any" autoComplete="off" value={row.lat}
            onChange={e => onChange({ ...row, lat: e.target.value, resolution: 'unresolved' })} />}
        </LabeledField>
        <LabeledField label="Lng">
          {id => <input id={id} style={fieldStyle(t)} type="number" step="any" autoComplete="off" value={row.lng}
            onChange={e => onChange({ ...row, lng: e.target.value, resolution: 'unresolved' })} />}
        </LabeledField>
        <LabeledField label="City">
          {id => <input id={id} style={fieldStyle(t)} type="text" autoComplete="off" value={row.city}
            onChange={e => onChange({ ...row, city: e.target.value, resolution: 'unresolved' })} />}
        </LabeledField>
        <LabeledField label="Country">
          {id => <input id={id} style={fieldStyle(t)} type="text" autoComplete="off" placeholder="ISO-2" maxLength={2} value={row.country}
            onChange={e => onChange({ ...row, country: e.target.value.toUpperCase(), resolution: 'unresolved' })} />}
        </LabeledField>
      </div>

      {row.resolution === 'existing' && (
        <div style={{ fontSize: 12, color: t.green, display: 'flex', alignItems: 'center', gap: 8 }}>
          ✓ Linked to existing node <strong>{row.existingNodeId}</strong>
          <button type="button" onClick={() => onChange({ ...row, resolution: 'unresolved' })} style={{
            border: 'none', background: 'transparent', color: t.textFaint, cursor: 'pointer', fontSize: 11, textDecoration: 'underline',
          }}>change</button>
        </div>
      )}
      {row.resolution === 'new' && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 10 }}>
          <span style={{ fontSize: 12, color: t.blue }}>+ New node <strong>{row.newNodeId}</strong></span>
          <LabeledField label="Type">
            {id => (
              <select id={id} style={{ ...fieldStyle(t), width: 160 }} value={row.newNodeType}
                onChange={e => onChange({ ...row, newNodeType: e.target.value as NodeType })}>
                {Object.entries(NODE_TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            )}
          </LabeledField>
          <LabeledField label="Owner">
            {id => (
              <input id={id} style={{ ...fieldStyle(t), width: 160 }} type="text" autoComplete="off"
                value={row.newNodeOwner} onChange={e => onChange({ ...row, newNodeOwner: e.target.value })} />
            )}
          </LabeledField>
          <button type="button" onClick={() => onChange({ ...row, resolution: 'unresolved' })} style={{
            border: 'none', background: 'transparent', color: t.textFaint, cursor: 'pointer', fontSize: 11, textDecoration: 'underline',
          }}>change</button>
        </div>
      )}
      {row.resolution === 'unresolved' && hasCoords && (
        <div>
          {candidates.length > 0 && (
            <div style={{ marginBottom: 6 }}>
              <span style={{ fontSize: 10, color: t.textFaint, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Possible existing matches
              </span>
              {candidates.map(c => (
                <NodeCandidateRow key={c.node.id} candidate={c}
                  onLink={() => onChange({ ...row, resolution: 'existing', existingNodeId: c.node.id })} t={t} />
              ))}
            </div>
          )}
          <button type="button" onClick={createNew} style={{
            padding: '5px 10px', borderRadius: 4, border: `1px solid ${t.blue}`, background: t.blue + '18',
            color: t.blue, fontSize: 12, cursor: 'pointer',
          }}>+ Create new CLS node</button>
        </div>
      )}
      {row.resolution === 'unresolved' && !hasCoords && (
        <span style={{ fontSize: 11, color: t.textFaint }}>Enter a lat/lng to see nearby existing nodes.</span>
      )}
    </div>
  )
}

function StepLandingStations({ rows, setRows, nodes, defaultOwner }: {
  rows: LandingDraft[]
  setRows: (rows: LandingDraft[]) => void
  nodes: CableNode[]
  defaultOwner: string
}) {
  function updateRow(key: string, updated: LandingDraft) {
    setRows(rows.map(r => (r.key === key ? updated : r)))
  }
  return (
    <div style={{ maxWidth: 720 }}>
      {rows.map((row, i) => (
        <LandingRow
          key={row.key} row={row} index={i} nodes={nodes} defaultOwner={defaultOwner}
          onChange={updated => updateRow(row.key, updated)}
          onRemove={() => setRows(rows.filter(r => r.key !== row.key))}
        />
      ))}
      <AddRowButton label="+ Add landing station" onClick={() => setRows([...rows, emptyLandingDraft()])} />
    </div>
  )
}

function AddRowButton({ label, onClick }: { label: string; onClick: () => void }) {
  const t = useTheme()
  return (
    <button type="button" onClick={onClick} style={{
      padding: '7px 12px', borderRadius: 5, border: `1px dashed ${t.border}`, background: 'transparent',
      color: t.textMuted, fontSize: 12, cursor: 'pointer', width: '100%',
    }}>{label}</button>
  )
}

// ── Step 3: Segment breakdown ────────────────────────────────────────────

function proposeSegments(landingRows: LandingDraft[], nodes: CableNode[], systemId: string): SegmentDraft[] {
  const resolved = landingRows.filter(r => landingNodeId(r) !== undefined)
  const drafts: SegmentDraft[] = []
  for (let i = 0; i < resolved.length - 1; i++) {
    const start = resolved[i]
    const end = resolved[i + 1]
    drafts.push(buildSegmentDraft(start, end, nodes, systemId))
  }
  return drafts
}

function buildSegmentDraft(
  start: LandingDraft, end: LandingDraft, nodes: CableNode[], systemId: string,
): SegmentDraft {
  segmentKeySeq += 1
  const startNode = landingAsNode(start, nodes)
  const endNode = landingAsNode(end, nodes)
  const type: SegmentType = startNode?.country && startNode.country === endNode?.country ? 'terrestrial' : 'wet'
  // Straight-line placeholder — the same fallback NewSegmentForm.tsx uses
  // before real geometry exists; KML Import (Phase 2) replaces this once
  // the cable's actual path is attached.
  const lengthKm = startNode && endNode ? haversineKm([startNode.lat, startNode.lng], [endNode.lat, endNode.lng]) : 0
  const defaults = suggestSegmentDefaults(lengthKm, type)
  return {
    key: `segment-${segmentKeySeq}`,
    startKey: start.key, endKey: end.key,
    id: generateSegmentId(type, systemId, startNode, endNode, []),
    name: generateSegmentName(type, undefined, startNode, endNode),
    type, ownership: 'offnet_resell',
    length_km: String(Math.round(lengthKm * 10) / 10),
    reliability: String(defaults.reliability), cost_weight: String(defaults.cost_weight),
    total_capacity_t: '',
  }
}

function SegmentRow({ draft, landingRows, onChange, onRemove, t }: {
  draft: SegmentDraft
  landingRows: LandingDraft[]
  onChange: (d: SegmentDraft) => void
  onRemove: () => void
  t: Theme
}) {
  const startLabel = landingRows.find(r => r.key === draft.startKey)?.name || '?'
  const endLabel = landingRows.find(r => r.key === draft.endKey)?.name || '?'
  return (
    <div style={{ border: `1px solid ${t.border}`, borderRadius: 6, padding: 10, marginBottom: 10, background: t.bgPanel }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: t.pink, flex: 1 }}>
          {startLabel} → {endLabel}
        </span>
        <button type="button" onClick={onRemove} aria-label="Remove segment" style={{
          border: 'none', background: 'transparent', color: t.textFaint, cursor: 'pointer', fontSize: 14, padding: 0,
        }}>×</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
        <LabeledField label="Segment ID">
          {id => <input id={id} style={fieldStyle(t)} type="text" autoComplete="off" value={draft.id}
            onChange={e => onChange({ ...draft, id: e.target.value.toUpperCase() })} />}
        </LabeledField>
        <LabeledField label="Type">
          {id => (
            <select id={id} style={fieldStyle(t)} value={draft.type} onChange={e => onChange({ ...draft, type: e.target.value as SegmentType })}>
              <option value="wet">Wet</option>
              <option value="terrestrial">Terrestrial</option>
            </select>
          )}
        </LabeledField>
        <LabeledField label="Ownership">
          {id => (
            <select id={id} style={fieldStyle(t)} value={draft.ownership} onChange={e => onChange({ ...draft, ownership: e.target.value as Ownership })}>
              {Object.entries(OWNERSHIP_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          )}
        </LabeledField>
      </div>
      <LabeledField label="Name">
        {id => <input id={id} style={fieldStyle(t)} type="text" autoComplete="off" value={draft.name}
          onChange={e => onChange({ ...draft, name: e.target.value })} />}
      </LabeledField>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8, marginTop: 8 }}>
        <LabeledField label="Length (km)">
          {id => <input id={id} style={fieldStyle(t)} type="number" step="any" min={0} autoComplete="off" value={draft.length_km}
            onChange={e => onChange({ ...draft, length_km: e.target.value })} />}
        </LabeledField>
        <LabeledField label="Reliability">
          {id => <input id={id} style={fieldStyle(t)} type="number" step="any" min={0} max={1} autoComplete="off" value={draft.reliability}
            onChange={e => onChange({ ...draft, reliability: e.target.value })} />}
        </LabeledField>
        <LabeledField label="Cost Weight">
          {id => <input id={id} style={fieldStyle(t)} type="number" step="any" min={0} autoComplete="off" value={draft.cost_weight}
            onChange={e => onChange({ ...draft, cost_weight: e.target.value })} />}
        </LabeledField>
        <LabeledField label="Total Capacity (Tbps)">
          {id => <input id={id} style={fieldStyle(t)} type="number" step="any" min={0} autoComplete="off" value={draft.total_capacity_t}
            onChange={e => onChange({ ...draft, total_capacity_t: e.target.value })} />}
        </LabeledField>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
        <LabeledField label="Start">
          {id => (
            <select id={id} style={fieldStyle(t)} value={draft.startKey} onChange={e => onChange({ ...draft, startKey: e.target.value })}>
              {landingRows.map(r => <option key={r.key} value={r.key}>{r.name || r.key}</option>)}
            </select>
          )}
        </LabeledField>
        <LabeledField label="End">
          {id => (
            <select id={id} style={fieldStyle(t)} value={draft.endKey} onChange={e => onChange({ ...draft, endKey: e.target.value })}>
              {landingRows.map(r => <option key={r.key} value={r.key}>{r.name || r.key}</option>)}
            </select>
          )}
        </LabeledField>
      </div>
    </div>
  )
}

function StepSegments({ landingRows, segmentDrafts, setSegmentDrafts, nodes, systemId }: {
  landingRows: LandingDraft[]
  segmentDrafts: SegmentDraft[]
  setSegmentDrafts: (d: SegmentDraft[]) => void
  nodes: CableNode[]
  systemId: string
}) {
  const t = useTheme()

  function addSegment() {
    if (landingRows.length < 2) return
    const draft = buildSegmentDraft(landingRows[0], landingRows[1], nodes, systemId)
    setSegmentDrafts([...segmentDrafts, draft])
  }
  function resetToAutoProposal() {
    setSegmentDrafts(proposeSegments(landingRows, nodes, systemId))
  }

  return (
    <div style={{ maxWidth: 720 }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <button type="button" onClick={resetToAutoProposal} style={{
          padding: '5px 10px', borderRadius: 4, border: `1px solid ${t.border}`, background: t.bgCard,
          color: t.text, fontSize: 12, cursor: 'pointer',
        }}>↺ Reset to trunk proposal</button>
      </div>
      {segmentDrafts.length === 0 && (
        <p style={{ fontSize: 12, color: t.textFaint }}>
          No segments yet — resolve at least two landing stations, or add one manually below.
        </p>
      )}
      {segmentDrafts.map(draft => (
        <SegmentRow
          key={draft.key} draft={draft} landingRows={landingRows} t={t}
          onChange={updated => setSegmentDrafts(segmentDrafts.map(d => (d.key === updated.key ? updated : d)))}
          onRemove={() => setSegmentDrafts(segmentDrafts.filter(d => d.key !== draft.key))}
        />
      ))}
      <AddRowButton label="+ Add segment" onClick={addSegment} />
    </div>
  )
}

// ── Step 4: Review & create ──────────────────────────────────────────────

type CommitStatus = 'pending' | 'committing' | 'success' | 'fail'
interface CommitItem { key: string; label: string; status: CommitStatus; reason?: string }

function patchCommitItem(items: CommitItem[], key: string, patch: Partial<CommitItem>): CommitItem[] {
  return items.map(it => (it.key === key ? { ...it, ...patch } : it))
}

const COMMIT_STATUS_ICON: Record<CommitStatus, string> = { success: '✓', fail: '✗', committing: '…', pending: '·' }

function commitStatusColor(status: CommitStatus, t: Theme): string {
  if (status === 'success') return t.green
  if (status === 'fail') return t.red
  if (status === 'committing') return t.blue
  return t.textFaint
}

function CommitRow({ item, t }: { item: CommitItem; t: Theme }) {
  const color = commitStatusColor(item.status, t)
  const icon = COMMIT_STATUS_ICON[item.status]
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '3px 0' }}>
      <span style={{ color, width: 14, flexShrink: 0 }}>{icon}</span>
      <span style={{ color: t.text, flex: 1 }}>{item.label}</span>
      {item.reason && <span style={{ color: t.red, fontSize: 11 }}>{item.reason}</span>}
    </div>
  )
}

function StepReview({ system, landingRows, segmentDrafts, commitItems }: {
  system: SystemDraft
  landingRows: LandingDraft[]
  segmentDrafts: SegmentDraft[]
  commitItems: CommitItem[] | null
}) {
  const t = useTheme()
  const newNodes = landingRows.filter(r => r.resolution === 'new')
  const existingNodes = landingRows.filter(r => r.resolution === 'existing')

  return (
    <div style={{ maxWidth: 560 }}>
      <h3 style={{ fontSize: 13, color: t.text, margin: '0 0 6px' }}>{system.name || '(unnamed cable)'} — {system.id}</h3>
      <p style={{ fontSize: 12, color: t.textFaint, margin: '0 0 12px' }}>
        {newNodes.length} new node{newNodes.length === 1 ? '' : 's'}, {existingNodes.length} linked to existing,{' '}
        {segmentDrafts.length} segment{segmentDrafts.length === 1 ? '' : 's'}.
      </p>
      {commitItems && (
        <div style={{ border: `1px solid ${t.border}`, borderRadius: 6, padding: 10, background: t.bgPanel }}>
          {commitItems.map(item => <CommitRow key={item.key} item={item} t={t} />)}
        </div>
      )}
    </div>
  )
}

// ── Wizard shell ──────────────────────────────────────────────────────────

const STEP_LABELS = ['Cable identity', 'Landing stations', 'Segment breakdown', 'Review & create']

const QUARTER_PATTERN = /^\d{4}-Q[1-4]$/

/** The backend rejects rfs_quarter/eol_quarter as required (and pattern-
 *  checked) whenever the matching status is 'planned'/'eol' — see
 *  models.py's _check_rfs_quarter/_check_eol_quarter. Mirrored here so the
 *  wizard catches it before the commit round-trip does. */
function identityStepValid(system: SystemDraft, systems: CableSystem[]): boolean {
  if (system.name.trim().length === 0 || system.id.trim().length === 0) return false
  if (system.id.length > SYSTEM_ID_MAX_LEN) return false
  if (systems.some(s => s.id === system.id)) return false
  if (system.rfs_status === 'planned' && !QUARTER_PATTERN.test(system.rfs_quarter)) return false
  if (system.eol_status === 'eol' && !QUARTER_PATTERN.test(system.eol_quarter)) return false
  return true
}

function canAdvance(
  step: number, system: SystemDraft, systems: CableSystem[], landingRows: LandingDraft[], segmentDrafts: SegmentDraft[],
): boolean {
  if (step === 1) return identityStepValid(system, systems)
  if (step === 2) return landingRows.filter(r => r.resolution !== 'unresolved').length >= 2
  if (step === 3) return segmentDrafts.length > 0
  return true
}

export function CableImportWizard({ nodes, segments, systems, onClose, onDataChange }: Props) {
  const t = useTheme()
  const [step, setStep] = useState(1)
  const [system, setSystem] = useState<SystemDraft>(emptySystemDraft)
  const [landingRows, setLandingRows] = useState<LandingDraft[]>(() => [emptyLandingDraft(), emptyLandingDraft()])
  const [segmentDrafts, setSegmentDrafts] = useState<SegmentDraft[]>([])
  const [proposalGenerated, setProposalGenerated] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [commitItems, setCommitItems] = useState<CommitItem[] | null>(null)
  const [done, setDone] = useState(false)

  function goToStep(next: number) {
    if (next === 3 && !proposalGenerated) {
      setSegmentDrafts(proposeSegments(landingRows, nodes, system.id))
      setProposalGenerated(true)
    }
    setStep(next)
  }

  async function commit() {
    setCommitting(true)
    const items: CommitItem[] = [
      { key: 'system', label: `System ${system.id}`, status: 'pending' },
      ...landingRows.filter(r => r.resolution === 'new').map(r => ({ key: `node:${r.key}`, label: `Node ${r.newNodeId}`, status: 'pending' as CommitStatus })),
      ...segmentDrafts.map(d => ({ key: `segment:${d.key}`, label: `Segment ${d.id}`, status: 'pending' as CommitStatus })),
      ...segmentDrafts.filter(d => d.total_capacity_t.trim() !== '').map(d => ({ key: `capacity:${d.key}`, label: `Capacity for ${d.id}`, status: 'pending' as CommitStatus })),
    ]
    setCommitItems(items)

    const setItem = (key: string, patch: Partial<CommitItem>) =>
      setCommitItems(prev => (prev ? patchCommitItem(prev, key, patch) : prev))

    const systemOk = await commitSystem(system, setItem)
    if (!systemOk) { setCommitting(false); return }

    for (const row of landingRows) {
      if (row.resolution !== 'new') continue
      await commitNewNode(row, setItem)
    }
    for (const draft of segmentDrafts) {
      await commitSegment(draft, system, landingRows, setItem)
    }

    onDataChange()
    setCommitting(false)
    setDone(true)
  }

  const stepContent = renderStep(step, {
    system, setSystem, systems, landingRows, setLandingRows, nodes,
    segmentDrafts, setSegmentDrafts, segments, commitItems,
  })

  return (
    <div role="presentation" onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 11000, background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div role="dialog" aria-modal="true" aria-label="Cable Import" onClick={e => e.stopPropagation()} style={{
        width: '84vw', maxWidth: 880, height: '86vh', display: 'flex', flexDirection: 'column',
        background: t.bgPanel, borderRadius: 8, border: `1px solid ${t.border}`,
        boxShadow: '0 8px 40px rgba(0,0,0,0.5)', overflow: 'hidden', fontFamily: 'system-ui, sans-serif',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderBottom: `1px solid ${t.border}` }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: t.text, margin: 0, flex: 1 }}>Cable Import</h2>
          <button type="button" onClick={onClose} aria-label="Close Cable Import" style={{
            border: 'none', background: 'transparent', color: t.textFaint, cursor: 'pointer', fontSize: 18, padding: 0,
          }}>×</button>
        </div>
        <StepTabs step={step} t={t} />
        <div style={{ flex: 1, overflowY: 'auto', padding: 18 }}>
          {done ? <DonePanel t={t} onClose={onClose} /> : stepContent}
        </div>
        {!done && (
          <WizardFooter
            step={step} t={t} committing={committing}
            canAdvance={canAdvance(step, system, systems, landingRows, segmentDrafts)}
            onBack={() => setStep(s => Math.max(1, s - 1))}
            onNext={() => goToStep(Math.min(4, step + 1))}
            onCommit={commit}
          />
        )}
      </div>
    </div>
  )
}

function renderStep(step: number, props: {
  system: SystemDraft; setSystem: (s: SystemDraft) => void; systems: CableSystem[]
  landingRows: LandingDraft[]; setLandingRows: (r: LandingDraft[]) => void; nodes: CableNode[]
  segmentDrafts: SegmentDraft[]; setSegmentDrafts: (d: SegmentDraft[]) => void; segments: CableSegment[]
  commitItems: CommitItem[] | null
}): React.ReactNode {
  if (step === 1) return <StepIdentity draft={props.system} setDraft={props.setSystem} systems={props.systems} />
  if (step === 2) {
    return (
      <StepLandingStations
        rows={props.landingRows} setRows={props.setLandingRows} nodes={props.nodes}
        defaultOwner={props.system.consortium_owners[0] ?? ''}
      />
    )
  }
  if (step === 3) {
    return (
      <StepSegments
        landingRows={props.landingRows} segmentDrafts={props.segmentDrafts} setSegmentDrafts={props.setSegmentDrafts}
        nodes={props.nodes} systemId={props.system.id}
      />
    )
  }
  return (
    <StepReview
      system={props.system} landingRows={props.landingRows} segmentDrafts={props.segmentDrafts}
      commitItems={props.commitItems}
    />
  )
}

function StepTabs({ step, t }: { step: number; t: Theme }) {
  return (
    <div style={{ display: 'flex', gap: 4, padding: '10px 18px', borderBottom: `1px solid ${t.border}` }}>
      {STEP_LABELS.map((label, i) => {
        const n = i + 1
        const active = n === step
        const complete = n < step
        let color = t.textFaint
        if (active) color = t.blue
        else if (complete) color = t.textMuted
        return (
          <div key={label} style={{
            display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: active ? 700 : 500, color,
          }}>
            <span style={{
              width: 16, height: 16, borderRadius: '50%', fontSize: 9, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: active ? t.blue + '22' : 'transparent', border: `1px solid ${active ? t.blue : t.border}`,
            }}>{n}</span>
            {label}
            {n < STEP_LABELS.length && <span style={{ color: t.textFaint, margin: '0 4px' }}>→</span>}
          </div>
        )
      })}
    </div>
  )
}

function WizardFooter({ step, t, committing, canAdvance: advanceOk, onBack, onNext, onCommit }: {
  step: number; t: Theme; committing: boolean; canAdvance: boolean
  onBack: () => void; onNext: () => void; onCommit: () => void
}) {
  const btnBase: React.CSSProperties = { padding: '7px 16px', borderRadius: 5, fontSize: 12, cursor: 'pointer', border: `1px solid ${t.border}` }
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 18px', borderTop: `1px solid ${t.border}` }}>
      <button type="button" onClick={onBack} disabled={step === 1} style={{
        ...btnBase, background: 'transparent', color: t.textMuted, opacity: step === 1 ? 0.4 : 1,
      }}>← Back</button>
      {step < 4 ? (
        <button type="button" onClick={onNext} disabled={!advanceOk} style={{
          ...btnBase, background: advanceOk ? t.blue : t.bgCard, color: advanceOk ? '#fff' : t.textFaint,
          border: 'none', opacity: advanceOk ? 1 : 0.6,
        }}>Next →</button>
      ) : (
        <button type="button" onClick={onCommit} disabled={committing} style={{
          ...btnBase, background: t.green, color: '#fff', border: 'none', opacity: committing ? 0.6 : 1,
        }}>{committing ? 'Creating…' : 'Create Cable'}</button>
      )}
    </div>
  )
}

function DonePanel({ t, onClose }: { t: Theme; onClose: () => void }) {
  return (
    <div style={{ maxWidth: 480 }}>
      <p style={{ fontSize: 13, color: t.text }}>
        Cable created. Its segments have no geometry yet — open <strong>Controls → KML Import</strong> to
        attach a KMZ/KML or sync it from submarinecablemap.com.
      </p>
      <button type="button" onClick={onClose} style={{
        marginTop: 10, padding: '7px 16px', borderRadius: 5, border: 'none', background: t.blue, color: '#fff',
        fontSize: 12, cursor: 'pointer',
      }}>Done</button>
    </div>
  )
}

// ── Commit helpers ───────────────────────────────────────────────────────

async function commitSystem(system: SystemDraft, setItem: (key: string, patch: Partial<CommitItem>) => void): Promise<boolean> {
  setItem('system', { status: 'committing' })
  try {
    await api.createSystem({
      id: system.id, name: system.name, description: system.description,
      margin: system.margin.trim() === '' ? undefined : parseFloat(system.margin),
      rfs_status: system.rfs_status, rfs_quarter: system.rfs_status === 'planned' ? system.rfs_quarter : null,
      eol_status: system.eol_status, eol_quarter: system.eol_status === 'eol' ? system.eol_quarter : null,
      fiber_pair_count: system.fiber_pair_count.trim() === '' ? null : parseInt(system.fiber_pair_count, 10),
      consortium_owners: system.consortium_owners.length > 0 ? system.consortium_owners : null,
    })
    setItem('system', { status: 'success' })
    return true
  } catch (e) {
    setItem('system', { status: 'fail', reason: e instanceof Error ? e.message : String(e) })
    return false
  }
}

async function commitNewNode(row: LandingDraft, setItem: (key: string, patch: Partial<CommitItem>) => void): Promise<void> {
  const key = `node:${row.key}`
  setItem(key, { status: 'committing' })
  try {
    await api.createNode({
      id: row.newNodeId!, name: row.name || row.newNodeId!, lat: parseFloat(row.lat), lng: parseFloat(row.lng),
      type: row.newNodeType, country: row.country, owner: row.newNodeOwner || undefined, city: row.city || undefined,
    })
    setItem(key, { status: 'success' })
  } catch (e) {
    setItem(key, { status: 'fail', reason: e instanceof Error ? e.message : String(e) })
  }
}

async function commitSegment(
  draft: SegmentDraft, system: SystemDraft, landingRows: LandingDraft[],
  setItem: (key: string, patch: Partial<CommitItem>) => void,
): Promise<void> {
  const key = `segment:${draft.key}`
  setItem(key, { status: 'committing' })
  const startId = landingNodeId(landingRows.find(r => r.key === draft.startKey)!)
  const endId = landingNodeId(landingRows.find(r => r.key === draft.endKey)!)
  if (!startId || !endId) {
    setItem(key, { status: 'fail', reason: 'endpoint not resolved' })
    return
  }
  try {
    // Straight-line length until real geometry is attached via KML Import
    // (Phase 2); latency derives from it via the same rule NewSegmentForm uses.
    const lengthKm = parseFloat(draft.length_km) || 0
    await api.createSegment({
      id: draft.id, name: draft.name, system_id: system.id,
      start_node_id: startId, end_node_id: endId, type: draft.type,
      length_km: lengthKm,
      reliability: parseFloat(draft.reliability) || 0.999,
      cost_weight: parseFloat(draft.cost_weight) || 1,
      ownership: draft.ownership,
      latency: suggestSegmentDefaults(lengthKm, draft.type).latency,
      rfs_status: system.rfs_status, rfs_quarter: system.rfs_status === 'planned' ? system.rfs_quarter : null,
      eol_status: system.eol_status, eol_quarter: system.eol_status === 'eol' ? system.eol_quarter : null,
    })
    setItem(key, { status: 'success' })
  } catch (e) {
    setItem(key, { status: 'fail', reason: e instanceof Error ? e.message : String(e) })
    return
  }
  if (draft.total_capacity_t.trim() === '') return
  const capKey = `capacity:${draft.key}`
  setItem(capKey, { status: 'committing' })
  try {
    const total = parseFloat(draft.total_capacity_t)
    await api.createCapacity({ segment_id: draft.id, total_capacity_t: total, available_capacity_t: total })
    setItem(capKey, { status: 'success' })
  } catch (e) {
    setItem(capKey, { status: 'fail', reason: e instanceof Error ? e.message : String(e) })
  }
}
