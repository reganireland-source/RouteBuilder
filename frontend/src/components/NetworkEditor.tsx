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
import type { CableNode, CableSegment, CableSystem, CountryHighlight, SegmentCapacity, SelectedSystem, NodeType } from '../types'
import type { EditorState, EditorAction, EditorSubMode } from '../state/editorState'
import { emptySegmentDraft } from '../state/editorState'
import { useTheme } from '../theme'
import { CountryViewer } from './CountryViewer'
import { SystemViewer } from './SystemViewer'
import { ConfirmDialog } from './ConfirmDialog'
import { generateNodeId } from '../utils/editorGeo'
import { LabeledInput, LabeledSelect, actionBtn } from './formFields'
import { NewSegmentForm } from './NewSegmentForm'

/** Props for {@link NetworkEditor}. */
interface Props {
  nodes: CableNode[]
  segments: CableSegment[]
  systems: CableSystem[]
  capacity: SegmentCapacity[]
  /** Currently active "dim everything but this country" clutter filter, or
   *  null when unset — shared state with Country Viewer, see the file header. */
  countryHighlight: CountryHighlight | null
  onCountrySelect: (h: CountryHighlight | null) => void
  /** Currently active "dim everything but these systems" clutter filter —
   *  shared state with System Viewer, see the file header. */
  selectedSystems: SelectedSystem[]
  onToggleSystem: (systemId: string) => void
  /** The staged-changes state this panel reads and edits — see
   *  state/editorState.ts for the reducer and PendingChange shape. */
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

/**
 * Left-panel UI for Network Editor mode — see the file header docblock for
 * the four sub-modes and how staging works. Renders the sub-mode strip, the
 * sub-mode-specific panel (Move's NodeLatLngForm, Create's CreatePanel,
 * Delete's DeletePanel — Waypoints has no dedicated form, since the actual
 * editing happens on the map via EditorMapLayer.tsx), and the collapsible
 * clutter filter. Derives `selectedNode`/`selectedSegment` from
 * `editorState.selection`, which the map layer sets when the user clicks a
 * node/segment on screen.
 */
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

/** Typed lat/lng precision override for the node currently selected on the
 *  map — the alternative to dragging. Local text state so the fields don't
 *  fight the user's keystrokes while they're mid-edit; committed on blur/Enter.
 *  `key={selectedNode.id}` at the call site remounts this component whenever
 *  the selection changes, so its local `lat`/`lng` state always starts fresh
 *  from the newly selected node rather than carrying over stale text. */
function NodeLatLngForm({ node, dispatchEditor }: { node: CableNode; dispatchEditor: (action: EditorAction) => void }) {
  const t = useTheme()
  const [lat, setLat] = useState(String(node.lat))
  const [lng, setLng] = useState(String(node.lng))
  // Same physical-site guard as dragging, asked through the app's own dialog
  // rather than window.confirm — so it's async, hence the held-back coords.
  const [pendingMove, setPendingMove] = useState<{ lat: number; lng: number } | null>(null)

  /** Reverts the text fields back to the node's actual (last-committed)
   *  coordinates — used both on invalid input and after a cancelled confirm. */
  function reset() { setLat(String(node.lat)); setLng(String(node.lng)) }

  /** Parses the typed lat/lng and, if both are valid numbers and actually
   *  different from the node's current position, either dispatches the move
   *  immediately (branching units — virtual points, no real-world coordinate
   *  to get wrong) or holds it in `pendingMove` for the ConfirmDialog below
   *  (physical sites — moving one is consequential enough to double-check).
   *  Invalid input silently reverts via reset() rather than showing an error,
   *  since the only invalid state here is "not parseable as a number". */
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

/**
 * Panel for the Create sub-mode — a small three-state machine driven by
 * `editorState.segmentDraft` (see state/editorState.ts's SegmentDraft type):
 *  1. `draft.newNodeAt` set → the user clicked empty map space; show
 *     NewNodeForm to fill in the new node's details.
 *  2. Both `startNodeId` and `endNodeId` resolved to real nodes → show
 *     NewSegmentForm to fill in the segment connecting them.
 *  3. Otherwise → a plain instructional prompt (and the confirmed start
 *     node, if one is picked) telling the user what to click next.
 * The actual node-clicking interaction lives in EditorMapLayer.tsx, which
 * dispatches SET_SEGMENT_DRAFT as the user picks; this panel only reacts to
 * the resulting draft state and supplies the two creation forms.
 */
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

/** Form for creating a brand-new node at a specific point the user clicked
 *  on the map (`at`). Suggests an id via generateNodeId() whenever type or
 *  country changes (the id is derived from both), which the user can still
 *  overwrite by hand. On submit, calls `onCreate` with a fully-formed
 *  CableNode (always `verification_status: 'draft'`, matching every other
 *  editor-created record) — the caller (CreatePanel) is responsible for
 *  staging it as an ADD_CHANGE and wiring it up as the pending segment's
 *  endpoint. */
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

// ── Delete sub-mode ─────────────────────────────────────────────────────────

/**
 * Panel for the Delete sub-mode. Renders one of three views depending on
 * `editorState.selection` (passed in as `selectedNode`/`selectedSegment`):
 *  - neither selected → instructional prompt.
 *  - a segment selected → confirm-delete card; stages a single
 *    'delete-segment' PendingChange (its capacity, if any, is implicitly
 *    deleted alongside it by saveAll()).
 *  - a node selected → confirm-delete card that also warns about, and
 *    optionally cascades to, every segment still referencing that node (see
 *    `referencing`/`cascade` below) — since orphaning a segment's endpoint id
 *    would otherwise leave it pointing at a node that no longer exists.
 */
function DeletePanel({ segments, capacity, selectedNode, selectedSegment, dispatchEditor }: {
  segments: CableSegment[]; capacity: SegmentCapacity[]
  selectedNode: CableNode | null; selectedSegment: CableSegment | null
  dispatchEditor: (a: EditorAction) => void
}) {
  const t = useTheme()
  const [cascade, setCascade] = useState(false)

  // Every segment that would be left pointing at a now-nonexistent node id
  // if `selectedNode` were deleted without cascading.
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
            // Stage each cascaded segment's own 'delete-segment' change FIRST
            // (each an independent, individually undoable/discardable entry —
            // see editorState.ts's snapshot-per-entry design note), then the
            // node's 'delete-node' change below records their ids in
            // `cascadeSegmentIds` purely for saveAll()'s own dependency
            // ordering (segments before the node they reference).
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
