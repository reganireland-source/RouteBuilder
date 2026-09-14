/**
 * NetworkEditor — left-panel UI for the admin-only "Network Editor" mode.
 *
 * Four interaction sub-modes, each paired with EditorMapLayer.tsx's matching
 * map-side affordances:
 *   Move      — drag nodes (or type an exact lat/lng here for precision).
 *   Waypoints — click a segment, then click/drag/right-click its path points.
 *   Create    — click two nodes (or empty space to drop a new one) and fill in
 *               the segment + its initial capacity.
 *   Delete    — click a node or segment, confirm, optionally cascading to the
 *               segments that reference a deleted node.
 *
 * Nothing here writes to the backend: every action stages a PendingChange (see
 * state/editorState.ts) that the middle panel's EditorPendingPanel lists and
 * Save All applies.
 *
 * The clutter filter reuses CountryViewer/SystemViewer verbatim, wired to the
 * same countryHighlight/selectedSystems state App.tsx already threads into
 * NetworkMap — the live map dims non-matching nodes/segments exactly like
 * Country Viewer / System Viewer already do.
 *
 * Mounted from: App.tsx, only when `mode === 'networkeditor' && isAdmin`.
 */
import { useState } from 'react'
import type { CableNode, CableSegment, CableSystem, CountryHighlight, SegmentCapacity, SelectedSystem, NodeType, SegmentType, Ownership } from '../types'
import type { EditorState, EditorAction, EditorSubMode } from '../state/editorState'
import { emptySegmentDraft } from '../state/editorState'
import { useTheme } from '../theme'
import { CountryViewer } from './CountryViewer'
import { SystemViewer } from './SystemViewer'
import { ConfirmDialog } from './ConfirmDialog'
import { nodeLabel } from '../utils/nodeLabel'
import { pathLengthKm, suggestSegmentDefaults, generateSegmentId, generateSegmentName, generateNodeId } from '../utils/editorGeo'

interface Props {
  nodes: CableNode[]
  segments: CableSegment[]
  systems: CableSystem[]
  capacity: SegmentCapacity[]
  countryHighlight: CountryHighlight | null
  onCountrySelect: (h: CountryHighlight | null) => void
  selectedSystems: SelectedSystem[]
  onToggleSystem: (systemId: string) => void
  editorState: EditorState
  dispatchEditor: (action: EditorAction) => void
}

const SUBMODES: { id: EditorSubMode; label: string; icon: string }[] = [
  { id: 'move', label: 'Move', icon: '✥' },
  { id: 'waypoints', label: 'Waypoints', icon: '〰' },
  { id: 'create', label: 'Create', icon: '+' },
  { id: 'delete', label: 'Delete', icon: '🗑' },
]

const NODE_TYPE_OPTS: { value: NodeType; label: string }[] = [
  { value: 'branching_unit', label: 'BU (Branching Unit)' },
  { value: 'landing_station', label: 'CLS (Landing Station)' },
  { value: 'primary_pop', label: 'Primary PoP' },
  { value: 'secondary_pop', label: 'Secondary PoP' },
  { value: 'extension_pop', label: 'Extension PoP' },
  { value: 'off_net', label: 'Off-Net Node' },
]

const OWNERSHIP_OPTS: { value: Ownership; label: string }[] = [
  { value: 'owned', label: 'Owned' },
  { value: 'consortium', label: 'Consortium' },
  { value: 'iru', label: 'IRU' },
  { value: 'integrated_lit_lease', label: 'Integrated Lit Lease' },
  { value: 'offnet_resell', label: 'Offnet Resell' },
]

export function NetworkEditor({
  nodes, segments, systems, capacity, countryHighlight, onCountrySelect,
  selectedSystems, onToggleSystem, editorState, dispatchEditor,
}: Props) {
  const t = useTheme()
  const [filterOpen, setFilterOpen] = useState(false)

  const selectedNode = editorState.selection?.kind === 'node' ? nodes.find(n => n.id === editorState.selection!.id) ?? null : null
  const selectedSegment = editorState.selection?.kind === 'segment' ? segments.find(s => s.id === editorState.selection!.id) ?? null : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{
        padding: '8px 10px', borderRadius: 6, fontSize: 11, lineHeight: 1.5,
        background: t.orange + '14', border: `1px solid ${t.orange}55`, color: t.textMuted,
      }}>
        ✎ <strong style={{ color: t.text }}>Network Editor</strong> — changes are staged locally
        and only written to the database when you click Save All (see the panel on the right).
      </div>

      {/* Interaction-mode strip */}
      <div style={{ display: 'flex', gap: 4 }}>
        {SUBMODES.map(m => (
          <button
            key={m.id}
            onClick={() => dispatchEditor({ type: 'SET_SUBMODE', subMode: m.id })}
            style={{
              flex: 1, padding: '7px 4px', borderRadius: 5, fontSize: 11, fontWeight: 700, cursor: 'pointer',
              border: `1px solid ${editorState.subMode === m.id ? t.blue : t.border}`,
              background: editorState.subMode === m.id ? t.blue + '22' : 'transparent',
              color: editorState.subMode === m.id ? t.blue : t.textMuted,
            }}
          >
            {m.icon} {m.label}
          </button>
        ))}
      </div>

      {editorState.subMode === 'move' && (
        <div style={{ fontSize: 12, color: t.textFaint }}>
          Drag any node on the map to reposition it. Moving a physical site (CLS/PoP/off-net)
          asks for confirmation first — branching units move freely.
        </div>
      )}

      {editorState.subMode === 'waypoints' && (
        <div style={{ fontSize: 12, color: t.textFaint }}>
          Click a segment on the map to edit its path. Then click anywhere along its line to
          insert a waypoint there, drag a square handle to move one, or right-click a handle
          to delete it. The line re-smooths through the new points on each change.
          {selectedSegment && (
            <div style={{ marginTop: 6, padding: '6px 8px', borderRadius: 5, border: `1px solid ${t.blue}55`, background: t.blue + '10', color: t.text }}>
              <strong>{selectedSegment.name}</strong> <span style={{ color: t.textFaint }}>({selectedSegment.id})</span>
              <br />
              <span style={{ color: t.textMuted }}>{(selectedSegment.waypoints ?? []).length} waypoint{(selectedSegment.waypoints ?? []).length === 1 ? '' : 's'}</span>
            </div>
          )}
        </div>
      )}

      {selectedNode && editorState.subMode === 'move' && (
        <NodeLatLngForm key={selectedNode.id} node={selectedNode} dispatchEditor={dispatchEditor} />
      )}

      {editorState.subMode === 'create' && (
        <CreatePanel
          nodes={nodes} segments={segments} systems={systems}
          editorState={editorState} dispatchEditor={dispatchEditor}
        />
      )}

      {editorState.subMode === 'delete' && (
        <DeletePanel
          segments={segments} capacity={capacity}
          selectedNode={selectedNode} selectedSegment={selectedSegment}
          dispatchEditor={dispatchEditor}
        />
      )}

      {/* Clutter filter — reuses the exact Country/System Viewer components and state. */}
      <div style={{ border: `1px solid ${t.border}`, borderRadius: 6, overflow: 'hidden' }}>
        <button
          onClick={() => setFilterOpen(o => !o)}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '8px 10px', background: t.bgCard, border: 'none', cursor: 'pointer',
            fontSize: 11, fontWeight: 700, color: t.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em',
          }}
        >
          Filter (reduce clutter while editing)
          <span style={{ color: t.textFaint }}>{filterOpen ? '▴' : '▾'}</span>
        </button>
        {filterOpen && (
          <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: t.textFaint, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>By country</div>
              <CountryViewer nodes={nodes} segments={segments} systems={systems} onSelect={onCountrySelect} />
            </div>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: t.textFaint, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>By system</div>
              <SystemViewer systems={systems} selected={selectedSystems} onToggle={onToggleSystem} />
            </div>
          </div>
        )}
        {!filterOpen && countryHighlight && (
          <div style={{ padding: '6px 10px', fontSize: 11, color: t.textFaint }}>
            Filtered to <strong style={{ color: t.textMuted }}>{countryHighlight.countryName}</strong>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Shared tiny form primitives (same visual language as RefDataModal) ───────

function useFieldStyles() {
  const t = useTheme()
  return {
    input: {
      background: t.bgInput, border: `1px solid ${t.border}`, borderRadius: 3,
      color: t.text, fontSize: 12, padding: '4px 7px', width: '100%',
      boxSizing: 'border-box' as const, fontFamily: 'inherit',
    },
    label: { fontSize: 10, color: t.textFaint, textTransform: 'uppercase' as const, letterSpacing: '0.05em' },
  }
}

function LabeledInput({ label, value, onChange, placeholder, invalid }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; invalid?: boolean
}) {
  const t = useTheme()
  const s = useFieldStyles()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
      <label style={s.label}>{label}</label>
      <input
        style={{ ...s.input, border: `1px solid ${invalid ? t.red : t.border}` }}
        value={value} placeholder={placeholder} autoComplete="off"
        onChange={e => onChange(e.target.value)}
      />
    </div>
  )
}

function LabeledSelect<T extends string>({ label, value, onChange, options }: {
  label: string; value: T; onChange: (v: T) => void; options: { value: T; label: string }[]
}) {
  const s = useFieldStyles()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
      <label style={s.label}>{label}</label>
      <select style={s.input} value={value} onChange={e => onChange(e.target.value as T)}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )
}

function actionBtn(t: ReturnType<typeof useTheme>, kind: 'primary' | 'danger' | 'ghost', disabled = false) {
  const bg = kind === 'primary' ? t.green : kind === 'danger' ? t.red : 'transparent'
  return {
    flex: 1, padding: '8px 10px', borderRadius: 5, fontSize: 12, fontWeight: 700,
    cursor: disabled ? 'default' : 'pointer', fontFamily: 'inherit',
    border: kind === 'ghost' ? `1px solid ${t.border}` : 'none',
    background: disabled ? t.textFaintest : bg,
    color: kind === 'ghost' ? t.textMuted : kind === 'primary' ? '#0b1f14' : '#fff',
    opacity: disabled ? 0.6 : 1,
  } as const
}

/** Typed lat/lng precision override for the node currently selected on the
 *  map — the alternative to dragging. Local text state so the fields don't
 *  fight the user's keystrokes while they're mid-edit; committed on blur/Enter. */
function NodeLatLngForm({ node, dispatchEditor }: { node: CableNode; dispatchEditor: (action: EditorAction) => void }) {
  const t = useTheme()
  const [lat, setLat] = useState(String(node.lat))
  const [lng, setLng] = useState(String(node.lng))
  // Same physical-site guard as dragging, asked through the app's own dialog
  // rather than window.confirm — so it's async, hence the held-back coords.
  const [pendingMove, setPendingMove] = useState<{ lat: number; lng: number } | null>(null)

  function reset() { setLat(String(node.lat)); setLng(String(node.lng)) }

  function commit() {
    const parsedLat = parseFloat(lat)
    const parsedLng = parseFloat(lng)
    if (Number.isNaN(parsedLat) || Number.isNaN(parsedLng)) { reset(); return }
    if (parsedLat === node.lat && parsedLng === node.lng) return
    if (node.type !== 'branching_unit') { setPendingMove({ lat: parsedLat, lng: parsedLng }); return }
    dispatchEditor({ type: 'MOVE_NODE', nodeId: node.id, lat: parsedLat, lng: parsedLng, fromLat: node.lat, fromLng: node.lng })
  }

  return (
    <div style={{ padding: 10, borderRadius: 6, border: `1px solid ${t.blue}55`, background: t.blue + '10', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: t.text }}>{node.name} <span style={{ color: t.textFaint, fontWeight: 400 }}>({node.id})</span></div>
      <div style={{ display: 'flex', gap: 6 }}>
        <LabeledInput label="Lat" value={lat} onChange={setLat} />
        <LabeledInput label="Lng" value={lng} onChange={setLng} />
      </div>
      <button onClick={commit} style={actionBtn(t, 'primary')}>Apply coordinates</button>
      {pendingMove && (
        <ConfirmDialog
          title="Move a physical site?"
          body={<>
            <strong style={{ color: t.text }}>{node.name}</strong>{' '}
            <span style={{ color: t.textFaint }}>({node.id})</span> is a physical site — a real
            building or landing point — not a virtual routing point like a branching unit.
            Its coordinates should match the actual location.
            <div style={{ marginTop: 10, fontSize: 12, fontFamily: 'monospace', color: t.textFaint }}>
              {node.lat.toFixed(4)}, {node.lng.toFixed(4)}
              {'  →  '}
              <span style={{ color: t.orange }}>{pendingMove.lat.toFixed(4)}, {pendingMove.lng.toFixed(4)}</span>
            </div>
          </>}
          confirmLabel="Move it"
          cancelLabel="Put it back"
          onConfirm={() => {
            dispatchEditor({ type: 'MOVE_NODE', nodeId: node.id, lat: pendingMove.lat, lng: pendingMove.lng, fromLat: node.lat, fromLng: node.lng })
            setPendingMove(null)
          }}
          onCancel={() => { reset(); setPendingMove(null) }}
        />
      )}
    </div>
  )
}

// ── Create sub-mode ─────────────────────────────────────────────────────────

function CreatePanel({ nodes, segments, systems, editorState, dispatchEditor }: {
  nodes: CableNode[]; segments: CableSegment[]; systems: CableSystem[]
  editorState: EditorState; dispatchEditor: (a: EditorAction) => void
}) {
  const t = useTheme()
  const draft = editorState.segmentDraft
  const startNode = draft.startNodeId ? nodes.find(n => n.id === draft.startNodeId) : undefined
  const endNode = draft.endNodeId ? nodes.find(n => n.id === draft.endNodeId) : undefined

  if (draft.newNodeAt) {
    return (
      <NewNodeForm
        at={draft.newNodeAt}
        nodes={nodes}
        onCancel={() => dispatchEditor({ type: 'SET_SEGMENT_DRAFT', draft: { ...draft, newNodeAt: null } })}
        onCreate={(node) => {
          dispatchEditor({ type: 'ADD_CHANGE', change: { kind: 'new-node', tempId: node.id, draft: node } })
          // Use the brand-new node as whichever endpoint is still empty.
          dispatchEditor({
            type: 'SET_SEGMENT_DRAFT',
            draft: draft.startNodeId
              ? { ...draft, endNodeId: node.id, newNodeAt: null }
              : { ...draft, startNodeId: node.id, newNodeAt: null },
          })
        }}
      />
    )
  }

  if (startNode && endNode) {
    return (
      <NewSegmentForm
        startNode={startNode} endNode={endNode} systems={systems} segments={segments}
        onCancel={() => dispatchEditor({ type: 'SET_SEGMENT_DRAFT', draft: emptySegmentDraft })}
        onCreate={(segment, cap) => {
          dispatchEditor({ type: 'ADD_CHANGE', change: { kind: 'new-segment', tempId: segment.id, draft: segment, capacityDraft: cap } })
          dispatchEditor({ type: 'SET_SEGMENT_DRAFT', draft: emptySegmentDraft })
        }}
      />
    )
  }

  return (
    <div style={{ fontSize: 12, color: t.textFaint, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div>
        {!startNode
          ? 'Click a node on the map to use as the start — or click empty space to drop a brand-new node there.'
          : 'Now click the end node (or empty space for a new one). Click a chosen endpoint again to unpick it.'}
      </div>
      {startNode && (
        <div style={{ padding: '6px 8px', borderRadius: 5, border: `1px solid ${t.green}55`, background: t.green + '10', color: t.text }}>
          Start: <strong>{startNode.id}</strong> <span style={{ color: t.textMuted }}>- {startNode.name}</span>
        </div>
      )}
    </div>
  )
}

function NewNodeForm({ at, nodes, onCancel, onCreate }: {
  at: { lat: number; lng: number }; nodes: CableNode[]
  onCancel: () => void; onCreate: (node: CableNode) => void
}) {
  const t = useTheme()
  const [type, setType] = useState<NodeType>('branching_unit')
  const [country, setCountry] = useState('')
  const [id, setId] = useState(() => generateNodeId('', 'branching_unit', nodes))
  const [name, setName] = useState('')
  const [lat, setLat] = useState(at.lat.toFixed(4))
  const [lng, setLng] = useState(at.lng.toFixed(4))

  const idTaken = nodes.some(n => n.id.toUpperCase() === id.trim().toUpperCase())
  const latNum = parseFloat(lat)
  const lngNum = parseFloat(lng)
  const valid = id.trim() !== '' && !idTaken && name.trim() !== '' && country.trim() !== ''
    && !Number.isNaN(latNum) && !Number.isNaN(lngNum)

  return (
    <div style={{ padding: 10, borderRadius: 6, border: `1px solid ${t.green}55`, background: t.green + '0d', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: t.text }}>New node here</div>
      <div style={{ display: 'flex', gap: 6 }}>
        <LabeledSelect label="Type" value={type} onChange={(v) => { setType(v); setId(generateNodeId(country, v, nodes)) }} options={NODE_TYPE_OPTS} />
        <LabeledInput label="Country" value={country} onChange={(v) => { setCountry(v); setId(generateNodeId(v, type, nodes)) }} placeholder="AU" />
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <LabeledInput label="ID" value={id} onChange={setId} invalid={idTaken || id.trim() === ''} />
        <LabeledInput label="Name" value={name} onChange={setName} placeholder="Coral Sea BU" invalid={name.trim() === ''} />
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <LabeledInput label="Lat" value={lat} onChange={setLat} />
        <LabeledInput label="Lng" value={lng} onChange={setLng} />
      </div>
      {idTaken && <div style={{ fontSize: 11, color: t.red }}>That id is already taken.</div>}
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          disabled={!valid}
          onClick={() => onCreate({
            id: id.trim().toUpperCase(), name: name.trim(), lat: latNum, lng: lngNum,
            type, country: country.trim().toUpperCase(), verification_status: 'draft',
          })}
          style={actionBtn(t, 'primary', !valid)}
        >Add node</button>
        <button onClick={onCancel} style={actionBtn(t, 'ghost')}>Cancel</button>
      </div>
    </div>
  )
}

function NewSegmentForm({ startNode, endNode, systems, segments, onCancel, onCreate }: {
  startNode: CableNode; endNode: CableNode; systems: CableSystem[]; segments: CableSegment[]
  onCancel: () => void; onCreate: (segment: CableSegment, capacity: SegmentCapacity) => void
}) {
  const t = useTheme()
  const nonTerrestrialSystems = systems.filter(s => s.id !== 'TERRESTRIAL')
  const suggestedLength = Math.round(pathLengthKm([startNode.lat, startNode.lng], [endNode.lat, endNode.lng]))

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
  function resystem(next: string) {
    setSystemId(next)
    if (type !== 'terrestrial') {
      setId(generateSegmentId(type, next, startNode, endNode, segments))
      setName(generateSegmentName(type, systems.find(s => s.id === next), startNode, endNode))
    }
  }
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
        Suggested length is the great-circle distance between the two nodes; latency and cost
        are derived from it. Adjust anything before adding — nothing is saved until Save All.
      </div>
    </div>
  )
}

// ── Delete sub-mode ─────────────────────────────────────────────────────────

function DeletePanel({ segments, capacity, selectedNode, selectedSegment, dispatchEditor }: {
  segments: CableSegment[]; capacity: SegmentCapacity[]
  selectedNode: CableNode | null; selectedSegment: CableSegment | null
  dispatchEditor: (a: EditorAction) => void
}) {
  const t = useTheme()
  const [cascade, setCascade] = useState(false)

  const referencing = selectedNode
    ? segments.filter(s => s.start_node_id === selectedNode.id || s.end_node_id === selectedNode.id)
    : []

  if (!selectedNode && !selectedSegment) {
    return (
      <div style={{ fontSize: 12, color: t.textFaint }}>
        Click a node or a segment on the map to select it for deletion. Deletions are staged
        like every other change — nothing is removed until Save All.
      </div>
    )
  }

  if (selectedSegment) {
    const cap = capacity.find(c => c.segment_id === selectedSegment.id)
    return (
      <div style={{ padding: 10, borderRadius: 6, border: `1px solid ${t.red}55`, background: t.red + '10', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 12, color: t.text }}>
          Delete segment <strong>{selectedSegment.name}</strong> <span style={{ color: t.textFaint }}>({selectedSegment.id})</span>?
          {cap && <div style={{ fontSize: 11, color: t.textMuted, marginTop: 4 }}>Its capacity record will be deleted too.</div>}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={() => {
              dispatchEditor({ type: 'ADD_CHANGE', change: { kind: 'delete-segment', segmentId: selectedSegment.id, snapshot: selectedSegment, capacitySnapshot: cap } })
              dispatchEditor({ type: 'SELECT', selection: null })
            }}
            style={actionBtn(t, 'danger')}
          >Stage deletion</button>
          <button onClick={() => dispatchEditor({ type: 'SELECT', selection: null })} style={actionBtn(t, 'ghost')}>Cancel</button>
        </div>
      </div>
    )
  }

  const node = selectedNode!
  return (
    <div style={{ padding: 10, borderRadius: 6, border: `1px solid ${t.red}55`, background: t.red + '10', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 12, color: t.text }}>
        Delete node <strong>{node.name}</strong> <span style={{ color: t.textFaint }}>({node.id})</span>?
      </div>
      {referencing.length > 0 && (
        <>
          <div style={{ fontSize: 11, color: t.orange }}>
            ⚠ {referencing.length} segment{referencing.length === 1 ? '' : 's'} still reference{referencing.length === 1 ? 's' : ''} this node.
            Deleting the node alone leaves them pointing at an id that no longer exists.
          </div>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 11, color: t.textMuted, cursor: 'pointer' }}>
            <input type="checkbox" checked={cascade} onChange={e => setCascade(e.target.checked)} style={{ marginTop: 2 }} />
            <span>Also delete {referencing.length === 1 ? 'that segment' : `those ${referencing.length} segments`}: {referencing.slice(0, 4).map(s => s.id).join(', ')}{referencing.length > 4 ? `, +${referencing.length - 4} more` : ''}</span>
          </label>
        </>
      )}
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          onClick={() => {
            const cascadeIds = cascade ? referencing.map(s => s.id) : []
            if (cascade) {
              for (const seg of referencing) {
                dispatchEditor({
                  type: 'ADD_CHANGE',
                  change: { kind: 'delete-segment', segmentId: seg.id, snapshot: seg, capacitySnapshot: capacity.find(c => c.segment_id === seg.id), viaNodeCascade: node.id },
                })
              }
            }
            dispatchEditor({ type: 'ADD_CHANGE', change: { kind: 'delete-node', nodeId: node.id, snapshot: node, cascadeSegmentIds: cascadeIds } })
            dispatchEditor({ type: 'SELECT', selection: null })
            setCascade(false)
          }}
          style={actionBtn(t, 'danger')}
        >Stage deletion</button>
        <button onClick={() => { dispatchEditor({ type: 'SELECT', selection: null }); setCascade(false) }} style={actionBtn(t, 'ghost')}>Cancel</button>
      </div>
    </div>
  )
}
