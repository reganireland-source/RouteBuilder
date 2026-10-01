/**
 * ============================================================================
 *  SegmentFullView.tsx — the segment "Full View" modal.
 * ============================================================================
 *
 * The Segment Breakdown in a route card answers "what is this hop?" in four
 * lines. Full View answers "tell me everything about this cable segment" on a
 * page of its own: a stylised drawing of the segment, both endpoints in full,
 * every waypoint that shapes its path, the routing metrics, its capacity and
 * utilisation, its RFS/EOL lifecycle, any live or planned outage on it, and any
 * solution notes recorded against it.
 *
 * It is the deliberate twin of NodeFullView — same shell, same cards, same
 * breakpoints, same admin-edit contract — and shares all of that chrome through
 * `fullViewChrome.tsx` rather than reimplementing it. Four things are worth
 * knowing about how it behaves:
 *
 * 1. It NAVIGATES, both ways. Clicking either endpoint (in the diagram or in
 *    the Endpoints card) opens that node's Full View stacked on top of this
 *    one; a node Full View's capacity list opens a segment's in the same way.
 *    That is why it holds `segmentId` in state rather than a segment object —
 *    a prop would go stale the moment the data refetched after an edit — and
 *    why it sits at a higher z-index than the node view.
 *
 * 2. ADMINS CAN EDIT IN PLACE, over the same fields the Reference Data segment
 *    tab exposes, including the waypoint list. Save writes straight through
 *    `api.updateSegment` — no staging, same as Reference Data — and
 *    `onDataChange` then tells the app to refetch so the map, the route results
 *    and the card underneath all pick the change up. `EditSegmentForm` owns its
 *    own draft/saving/error state, so cancelling unmounts it and there is no
 *    half-typed draft left lying around. `id` is deliberately NOT editable: it
 *    is the identifier, and renaming it would orphan the capacity record, the
 *    outages and the notes that point at it.
 *
 * 3. NUMBERS ARE HELD AS STRINGS while editing. A half-typed "-" or "3." must
 *    survive keystroke to keystroke rather than collapsing to NaN mid-edit, so
 *    the draft is all text and is parsed exactly once, on save, where a bad
 *    value becomes a validation message instead of a silent zero.
 *
 * 4. IT CROSS-CHECKS THE GEOMETRY. `length_km` is a stored figure, not a
 *    derived one, and in a hand-maintained dataset it drifts from the path the
 *    waypoints actually describe. The Path Geometry card computes the
 *    great-circle length of the drawn path and flags a disagreement over 10%,
 *    which is the cheapest way to catch a segment whose waypoints were edited
 *    without its length being updated.
 *
 * Mounted from: RouteList.tsx (the ⛶ on each Segment Breakdown row) and
 * NodeFullView.tsx (the ⛶ on each segment-capacity row).
 * Backend: GET /api/solution-notes + /api/note-categories (via
 * EntityNotesPanel), PUT /api/segments/{id} on save.
 * ============================================================================
 */
import { useState } from 'react'
import { createPortal } from 'react-dom'
import type {
  CableNode, CableSegment, CableSystem, SegmentCapacity, SegmentOutage,
  SolutionNote, NoteCategory, SegmentType, Ownership, RfsStatus, EolStatus, KmlPathInfo,
} from '../types'
import { useTheme } from '../theme'
import { useAuth } from '../context/AuthContext'
import { api } from '../api/client'
import { nodeLabel } from '../utils/nodeLabel'
import { pathLengthKm, suggestSegmentDefaults } from '../utils/editorGeo'
import { NODE_TYPE_LABEL } from '../mapGeometry'
import {
  effectiveRfsDate, effectiveEolDate, isSegmentUsableOn, formatQuarter, todayIso,
} from '../utils/serviceDate'
import { SegmentPathDiagram } from './SegmentPathDiagram'
import { EntityNotesPanel } from './EntityNotesPanel'
import { HazardsNearbyCard } from './HazardsNearbyCard'
import { SegmentKmlCard } from './SegmentKmlCard'
import { ConfirmDialog } from './ConfirmDialog'
import { useHazardsFor } from '../context/HazardContext'
import { NodeFullView } from './NodeFullView'
import {
  type T, LayoutContext, useLayout, useFullViewLayout, useEscapeKey,
  backdropClose, backdropStyle, dialogStyle, headerShell, scrollerStyle, rowStyle,
  Card, Row, TextRow, Empty, NotFound, EditField, SelectField, ReadOnlyIdField, FullViewColumn,
  EditFormFooter, iconBtn, closeBtnStyle, inputStyle, fieldLabelStyle, Pill,
  utilisationColor, Z_FULL_VIEW_BASE, nextFullViewLayer,
} from './fullViewChrome'

// The same option sets the Reference Data segment form uses — kept identical on
// purpose so an admin sees the same choices wherever they edit a segment.
const TYPE_OPTS: [string, string][] = [
  ['wet',         'Wet (Submarine)'],
  ['terrestrial', 'Terrestrial'],
]
const OWNERSHIP_OPTS: [string, string][] = [
  ['owned',                'Owned'],
  ['consortium',           'Consortium'],
  ['iru',                  'IRU'],
  ['integrated_lit_lease', 'Integrated Lit Lease'],
  ['offnet_resell',        'Offnet Resell'],
]
const RFS_OPTS: [string, string][] = [
  ['in_service', 'In Service'],
  ['planned',    'Planned'],
]
const EOL_OPTS: [string, string][] = [
  ['active', 'Active'],
  ['eol',    'End of Life'],
]

const TYPE_LABEL: Record<string, string> = Object.fromEntries(TYPE_OPTS)
const OWNERSHIP_LABEL: Record<string, string> = Object.fromEntries(OWNERSHIP_OPTS)

/** How far the stored length may differ from the drawn path before the Path
 *  Geometry card calls it out. Generous, because a great-circle chain through
 *  the waypoints is itself only an approximation of the laid cable. */
const LENGTH_TOLERANCE = 0.1

interface Props {
  segmentId: string
  nodes: CableNode[]
  segments: CableSegment[]
  systems: CableSystem[]
  capacity: SegmentCapacity[]
  outages?: SegmentOutage[]
  /** Surveyed routes on file, keyed by segment id. */
  kmlPaths?: Record<string, KmlPathInfo>
  notes?: SolutionNote[]
  noteCategories?: NoteCategory[]
  onClose: () => void
  onDataChange?: () => void
  /** The stacking layer to render at. Defaults to the base; a view that opens
   *  this one on top of itself passes the next rung of the ladder. */
  zIndex?: number
}

/**
 * The segment Full View modal. Portals `SegmentHeader` + `SegmentBody` into
 * `document.body` inside `fullViewChrome`'s shared backdrop/dialog/layout
 * context. Holds `current`/`stack` (ids, not segment objects — see the file
 * header point 1) so that both same-type navigation (endpoint → parallel
 * segment → back) and opening a stacked `NodeFullView` from an endpoint work
 * without ever going stale after a refetch. See the file header for the full
 * behavioural contract (navigation, in-place admin editing, string-held
 * numeric drafts, and the geometry cross-check).
 */
export function SegmentFullView({
  segmentId, nodes, segments, systems, capacity, outages = [], notes, noteCategories,
  onClose, onDataChange, kmlPaths, zIndex = Z_FULL_VIEW_BASE,
}: Props) {
  const t = useTheme()
  const { isAdmin } = useAuth()
  const layout = useFullViewLayout()
  const { phone } = layout

  // `current` is what's on screen, `stack` is where we came from — walking the
  // network segment by segment through a node's exits. Ids, not objects, so a
  // refetch after an edit flows straight through.
  const [current, setCurrent] = useState(segmentId)
  const [stack, setStack] = useState<string[]>([])
  const [editing, setEditing] = useState(false)
  /** A node Full View stacked on top of this one, opened from an endpoint. */
  const [openNodeId, setOpenNodeId] = useState<string | null>(null)

  // Null once the stack is as deep as it may go, which hides the endpoint ⛶
  // rather than opening a view that would land behind the tooltip layer.
  const stackedLayer = nextFullViewLayer(zIndex)

  const segmentsById = Object.fromEntries(segments.map(s => [s.id, s])) as Record<string, CableSegment>
  const nodesById = Object.fromEntries(nodes.map(n => [n.id, n])) as Record<string, CableNode>
  const segment = segmentsById[current]

  useEscapeKey(() => {
    // Escape unwinds one layer at a time — losing a walk through the network to
    // a stray keypress would be worse than needing two presses.
    if (openNodeId) { setOpenNodeId(null); return }
    if (editing) { setEditing(false); return }
    if (stack.length) { goBack(); return }
    onClose()
  })

  function navigateTo(id: string) {
    if (!segmentsById[id] || id === current) return
    setStack(s => [...s, current])
    setCurrent(id)
    setEditing(false)
  }

  function goBack() {
    const prev = stack[stack.length - 1]
    if (prev === undefined) return
    setStack(s => s.slice(0, -1))
    setCurrent(prev)
    setEditing(false)
  }

  const body = (
    <LayoutContext.Provider value={layout}>
      <div
        role="presentation"
        onClick={backdropClose(onClose)}
        style={backdropStyle(phone, zIndex)}
        className="rb-anim-fade"
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label={segment ? `Segment ${segment.name || segment.id}` : 'Segment'}
          style={dialogStyle(t, phone)}
          className="rb-anim-pop"
        >
          <SegmentHeader
            t={t}
            phone={phone}
            segment={segment}
            current={current}
            nodesById={nodesById}
            backTo={backTarget(stack, segmentsById)}
            canEdit={Boolean(isAdmin && segment && !editing)}
            onBack={goBack}
            onEdit={() => setEditing(true)}
            onClose={onClose}
          />

          {segment ? (
            <SegmentBody
              t={t}
              segment={segment}
              nodesById={nodesById}
              segments={segments}
              systems={systems}
              capacity={capacity}
              outages={outages}
              notes={notes}
              noteCategories={noteCategories}
              editing={editing}
              onOpenNode={stackedLayer === null ? undefined : setOpenNodeId}
              onNavigateSegment={navigateTo}
              onSaved={() => { setEditing(false); onDataChange?.() }}
              onCancelEdit={() => setEditing(false)}
              kmlPaths={kmlPaths}
              onDataChange={onDataChange}
            />
          ) : (
            <NotFound t={t} what="segment" id={current} />
          )}
        </div>
      </div>
    </LayoutContext.Provider>
  )

  return (
    <>
      {createPortal(body, document.body)}
      {openNodeId && stackedLayer !== null && (
        <NodeFullView
          zIndex={stackedLayer}
          nodeId={openNodeId}
          nodes={nodes}
          segments={segments}
          systems={systems}
          capacity={capacity}
          notes={notes}
          noteCategories={noteCategories}
          onClose={() => setOpenNodeId(null)}
          onDataChange={onDataChange}
          // Picking a segment inside that node view brings you BACK here on the
          // segment you picked, rather than stacking a third modal on a second.
          onOpenSegment={id => { setOpenNodeId(null); navigateTo(id) }}
        />
      )}
    </>
  )
}

/** Label for the "← Back" button's tooltip, or null when the stack is empty. */
function backTarget(stack: string[], segmentsById: Record<string, CableSegment>): string | null {
  const prev = stack[stack.length - 1]
  if (prev === undefined) return null
  return segmentsById[prev]?.name || prev
}

// ── Header ────────────────────────────────────────────────────────────────

/**
 * On desktop this is a single wrapping row. On a phone it splits into two
 * deliberate lines — title + × on top, Back/Edit underneath — because letting
 * a wrapping row decide where the × lands is how it ends up off the bottom of
 * a 430px header. The × keeps a 40px touch target there.
 */
function SegmentHeader({ t, phone, segment, current, nodesById, backTo, canEdit, onBack, onEdit, onClose }: {
  t: T
  phone: boolean
  segment: CableSegment | undefined
  current: string
  nodesById: Record<string, CableNode>
  backTo: string | null
  canEdit: boolean
  onBack: () => void
  onEdit: () => void
  onClose: () => void
}) {
  const title = segment ? (segment.name || segment.id) : current
  const subtitle = segment
    ? `${nodeLabel(nodesById[segment.start_node_id], segment.start_node_id)}  →  ${nodeLabel(nodesById[segment.end_node_id], segment.end_node_id)}`
    : 'Segment not found in the loaded dataset'

  const backBtn = backTo === null ? null : (
    <button onClick={onBack} title={`Back to ${backTo}`} style={iconBtn(t)}>← Back</button>
  )
  // Editing is admin-only; the button is hidden rather than disabled because a
  // read-only viewer has nothing to gain from seeing it.
  const editBtn = canEdit ? (
    <button onClick={onEdit} style={iconBtn(t, t.blue)}>✎ Edit segment</button>
  ) : null
  const closeBtn = (
    <button onClick={onClose} title="Close" aria-label="Close" style={closeBtnStyle(t, phone)}>×</button>
  )
  const medium = segment ? (
    <Pill color={segment.type === 'wet' ? t.blue : t.orange}>
      {segment.type === 'wet' ? 'Wet' : 'Terrestrial'}
    </Pill>
  ) : null
  const titleBlock = (
    <div style={{ minWidth: 0, flex: phone ? 1 : undefined }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 16, fontWeight: 800, color: t.text, overflowWrap: 'anywhere' }}>{title}</span>
        {medium}
      </div>
      <div style={{ fontSize: 11, color: t.textFaint, marginTop: 2, overflowWrap: 'anywhere' }}>{subtitle}</div>
    </div>
  )

  if (phone) {
    return (
      <div style={headerShell(t, true)}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          {titleBlock}
          {closeBtn}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          {backBtn}
          {editBtn}
        </div>
      </div>
    )
  }

  return (
    <div style={headerShell(t, false)}>
      {backBtn}
      {titleBlock}
      <div style={{ flex: 1 }} />
      {editBtn}
      {closeBtn}
    </div>
  )
}

// ── Body ──────────────────────────────────────────────────────────────────

/**
 * The scrollable body beneath the header: builds every card once (`diagramCard`,
 * `identityCard`, ... `notesCard`) and then arranges the SAME set of card
 * elements into either a two-column landscape layout or a single stacked
 * column, so the two layouts can never carry different content by accident.
 */
function SegmentBody({
  t, segment, nodesById, segments, systems, capacity, outages, notes, noteCategories,
  editing, onOpenNode, onNavigateSegment, onSaved, onCancelEdit, kmlPaths, onDataChange,
}: {
  t: T
  segment: CableSegment
  nodesById: Record<string, CableNode>
  segments: CableSegment[]
  systems: CableSystem[]
  capacity: SegmentCapacity[]
  outages: SegmentOutage[]
  notes?: SolutionNote[]
  noteCategories?: NoteCategory[]
  editing: boolean
  onOpenNode?: (id: string) => void
  onNavigateSegment: (id: string) => void
  onSaved: () => void
  onCancelEdit: () => void
  kmlPaths?: Record<string, KmlPathInfo>
  onDataChange?: () => void
}) {
  const { phone, landscape } = useLayout()

  const segmentHazards = useHazardsFor('segment', segment.id)

  const start = nodesById[segment.start_node_id]
  const end = nodesById[segment.end_node_id]
  const system = systems.find(s => s.id === segment.system_id)
  const cap = capacity.find(c => c.segment_id === segment.id)
  const segOutages = outages.filter(o => o.segment_id === segment.id)
  // Parallel capacity: other segments joining the same two nodes, which is the
  // question a planner asks immediately after "what is this one?".
  const parallel = segments.filter(s =>
    s.id !== segment.id
    && ((s.start_node_id === segment.start_node_id && s.end_node_id === segment.end_node_id)
      || (s.start_node_id === segment.end_node_id && s.end_node_id === segment.start_node_id)))

  const row = rowStyle(phone)

  // The cards, named once so the two layouts below compose the SAME content
  // rather than each carrying its own copy that could drift.
  const diagramCard = (
    <Card t={t} title="Segment" grow>
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <SegmentPathDiagram
          segment={segment}
          start={start}
          end={end}
          onSelectNode={onOpenNode}
          width={diagramWidth(phone, landscape)}
          compact={phone}
        />
      </div>
    </Card>
  )
  const identityCard = (
    <Card key="identity" t={t} title={editing ? 'Edit Segment' : 'Key Information'} grow>
      {editing
        ? <EditSegmentForm t={t} segment={segment} systems={systems} onSaved={onSaved} onCancel={onCancelEdit} />
        : <IdentityList t={t} segment={segment} system={system} />}
    </Card>
  )
  const endpointsCard = (
    <Card key="endpoints" t={t} title="Endpoints" grow>
      <EndpointRow t={t} role="A-End" node={start} fallbackId={segment.start_node_id} onOpen={onOpenNode} />
      <div style={{ height: 8 }} />
      <EndpointRow t={t} role="Z-End" node={end} fallbackId={segment.end_node_id} onOpen={onOpenNode} />
    </Card>
  )
  const kmlCard = (
    <SegmentKmlCard key="kml" t={t} segment={segment} info={kmlPaths?.[segment.id]} onUploaded={onDataChange} />
  )
  const geometryCard = (
    <Card key="geometry" t={t} title="Path Geometry" grow>
      <PathGeometry t={t} segment={segment} start={start} end={end} kmlInfo={kmlPaths?.[segment.id]} onUpdated={onDataChange} />
    </Card>
  )
  const metricsCard = (
    <Card key="metrics" t={t} title="Routing Metrics" grow>
      <MetricsList t={t} segment={segment} />
    </Card>
  )
  const capacityCard = (
    <Card key="capacity" t={t} title="Capacity" grow>
      <CapacityBlock t={t} cap={cap} />
    </Card>
  )
  const lifecycleCard = (
    <Card key="lifecycle" t={t} title="Lifecycle" grow>
      <LifecycleBlock t={t} segment={segment} system={system} />
    </Card>
  )
  const parallelCard = (
    <Card key="parallel" t={t} title={`Parallel Segments (${parallel.length})`} grow>
      <ParallelList t={t} parallel={parallel} capacity={capacity} onOpen={onNavigateSegment} />
    </Card>
  )
  const outagesCard = (
    <Card key="outages" t={t} title={`Outages & Planned Work (${segOutages.length})`} grow>
      <OutageList t={t} outages={segOutages} />
    </Card>
  )
  const notesCard = (
    <Card key="notes" t={t} title={null} grow>
      <EntityNotesPanel kind="segment" entityId={segment.id} notes={notes} categories={noteCategories} />
    </Card>
  )
  // Renders nothing when there is nothing to report — see HazardsNearbyCard.
  const hazardsCard = <HazardsNearbyCard key="hazards" hazards={segmentHazards} kind="segment" assetId={segment.id} />

  const scroller = scrollerStyle(phone)

  // ── Landscape: two columns side by side ──────────────────────────────────
  // The diagram spans BOTH columns rather than sitting in one: it is a wide,
  // short picture, and halving its width for the sake of a tidy grid would
  // squeeze the endpoint captions it depends on. Below it, the left column
  // holds what the segment IS, the right what it CARRIES.
  if (landscape) {
    return (
      <div style={{ ...scroller, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* In its own ROW, not straight into the column: a Card's `flex: 1 1
            320px` sizes its HEIGHT inside a flex column, and the diagram
            collapsed to a sliver. */}
        <div style={row}>{diagramCard}</div>
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
          <FullViewColumn>{[identityCard, endpointsCard, geometryCard, kmlCard]}</FullViewColumn>
          <FullViewColumn>{[metricsCard, capacityCard, lifecycleCard, hazardsCard, parallelCard, outagesCard, notesCard]}</FullViewColumn>
        </div>
      </div>
    )
  }

  // ── Stacked: phones and narrow windows ───────────────────────────────────
  return (
    <div style={{ ...scroller, display: 'flex', flexDirection: 'column', gap: phone ? 12 : 16 }}>
      <div style={row}>{diagramCard}</div>
      <div style={row}>{identityCard}{endpointsCard}</div>
      <div style={row}>{kmlCard}</div>
      <div style={row}>{metricsCard}{capacityCard}</div>
      <div style={row}>{geometryCard}{lifecycleCard}</div>
      <div style={row}>{hazardsCard}</div>
      <div style={row}>{parallelCard}{outagesCard}</div>
      <div style={row}>{notesCard}</div>
    </div>
  )
}

/** Nominal width cap for the path diagram. The phone also switches the diagram
 *  to its `compact` viewBox, which is what actually keeps the labels legible
 *  there — see SegmentPathDiagram's Geometry block. */
function diagramWidth(phone: boolean, landscape: boolean): number {
  if (phone) return 420
  return landscape ? 900 : 660
}

// ── The self-contained panels ─────────────────────────────────────────────

/** The read-only identity block: every populated field, in a fixed order. */
function IdentityList({ t, segment, system }: { t: T; segment: CableSegment; system?: CableSystem }) {
  const fields: [string, string | undefined][] = [
    ['ID', segment.id],
    ['Name', segment.name],
    ['System', system ? `${system.id} — ${system.name}` : segment.system_id],
    ['Medium', TYPE_LABEL[segment.type] ?? segment.type],
    ['Ownership', OWNERSHIP_LABEL[segment.ownership] ?? segment.ownership],
    ['Verification', segment.verification_status],
    ['Last Verified', segment.last_verified_date],
  ]
  return (
    <div>
      {fields.filter(([, v]) => v).map(([label, value]) => (
        <TextRow key={label} t={t} label={label} value={value} />
      ))}
    </div>
  )
}

/** One endpoint: the node, code-first, with its type and place, and a control
 *  that opens the node's own Full View stacked above this one. */
function EndpointRow({ t, role, node, fallbackId, onOpen }: {
  t: T; role: string; node?: CableNode; fallbackId: string; onOpen?: (id: string) => void
}) {
  const place = node ? [node.city, node.country].filter(Boolean).join(', ') : ''
  return (
    <div style={{
      border: `1px solid ${t.border}`, borderRadius: 6, padding: '8px 10px', background: t.bgDeep,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{
          fontSize: 9, fontWeight: 800, letterSpacing: '0.06em', color: t.textFaint,
        }}>{role}</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: t.text, wordBreak: 'break-word' }}>
          {nodeLabel(node, fallbackId)}
        </span>
        <div style={{ flex: 1 }} />
        {node && onOpen && (
          <button onClick={() => onOpen(node.id)} style={iconBtn(t, t.blue)} title={`Full view of ${nodeLabel(node)}`}>
            ⛶ Node
          </button>
        )}
      </div>
      {node ? (
        <div style={{ fontSize: 11, color: t.textMuted, marginTop: 4, lineHeight: 1.5 }}>
          {NODE_TYPE_LABEL[node.type] ?? node.type}
          {place && ` · ${place}`}
          <br />
          <span style={{ fontFamily: 'ui-monospace, monospace', color: t.textFaint }}>
            {node.lat.toFixed(4)}, {node.lng.toFixed(4)}
          </span>
          {node.owner && <span style={{ color: t.textFaint }}> · {node.owner}</span>}
        </div>
      ) : (
        <div style={{ marginTop: 4 }}>
          <Empty t={t}>This node is not in the loaded dataset.</Empty>
        </div>
      )}
    </div>
  )
}

/**
 * The waypoint list, plus the stored-vs-drawn length cross-check. `length_km`
 * is a stored figure; in a hand-maintained dataset it drifts from the path the
 * waypoints describe, and nothing else in the app would ever tell you.
 *
 * When a surveyed KMZ is linked, its length (measured along the FULL path,
 * not the simplified one used for the overview map — see `KmlPathInfo`) is
 * the real cable, so it outranks the waypoint spline as the "drawn path" an
 * admin can pull the stored length from.
 */
function PathGeometry({ t, segment, start, end, kmlInfo, onUpdated }: {
  t: T; segment: CableSegment; start?: CableNode; end?: CableNode
  kmlInfo?: KmlPathInfo; onUpdated?: () => void
}) {
  const { isAdmin } = useAuth()
  const waypoints = segment.waypoints ?? []
  const drawn = start && end
    ? pathLengthKm([start.lat, start.lng], [end.lat, end.lng], waypoints)
    : null
  const direct = start && end
    ? pathLengthKm([start.lat, start.lng], [end.lat, end.lng])
    : null
  const surveyed = kmlInfo?.length_km ?? null

  // What "update stored length" applies: the surveyed KMZ length when there
  // is one, the drawn waypoint path otherwise.
  let bestSource: 'kml' | 'waypoints' | null = null
  if (surveyed !== null) bestSource = 'kml'
  else if (drawn !== null) bestSource = 'waypoints'
  const bestLength = surveyed ?? drawn

  // Guard the ratio against a zero stored length as well as a missing endpoint.
  const drift = bestLength !== null && segment.length_km > 0
    ? Math.abs(bestLength - segment.length_km) / segment.length_km
    : null

  const [recalcLatency, setRecalcLatency] = useState(true)
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const newLatency = bestLength !== null ? suggestSegmentDefaults(bestLength, segment.type).latency : null

  async function applyUpdate() {
    if (bestLength === null || saving) return
    setSaving(true)
    setSaveError(null)
    try {
      await api.updateSegment(segment.id, {
        length_km: Math.round(bestLength * 100) / 100,
        ...(recalcLatency && newLatency !== null ? { latency: newLatency } : {}),
      })
      setConfirming(false)
      onUpdated?.()
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <TextRow t={t} label="Stored length" value={`${segment.length_km.toLocaleString()} km`} />
      {surveyed !== null && (
        <TextRow t={t} label="Surveyed (KMZ)" value={`${Math.round(surveyed).toLocaleString()} km`} />
      )}
      {drawn !== null && (
        <Row t={t} label="Drawn path">
          <span style={{ color: t.text }}>
            {Math.round(drawn).toLocaleString()} km
            {drift !== null && drift > LENGTH_TOLERANCE && (
              <>
                {' '}
                <Pill color={t.orange} title="The stored length and the best-known path (the surveyed KMZ when one is linked, otherwise the drawn waypoints) differ by more than 10%. One of the two is probably stale.">
                  {`${(drift * 100).toFixed(0)}% off`}
                </Pill>
              </>
            )}
          </span>
        </Row>
      )}
      {direct !== null && (
        <TextRow t={t} label="Direct" value={`${Math.round(direct).toLocaleString()} km great-circle`} />
      )}
      <TextRow t={t} label="Waypoints" value={String(waypoints.length)} />
      {waypoints.length > 0 && (
        <div style={{
          marginTop: 6, maxHeight: 180, overflowY: 'auto',
          border: `1px solid ${t.border}`, borderRadius: 5,
        }}>
          {waypoints.map(([lat, lng], i) => (
            <div
              key={`${lat},${lng},${i}`}
              style={{
                display: 'flex', gap: 10, padding: '4px 8px', fontSize: 11,
                fontFamily: 'ui-monospace, monospace', color: t.textMuted,
                borderBottom: i === waypoints.length - 1 ? 'none' : `1px solid ${t.border}55`,
              }}
            >
              <span style={{ color: t.textFaintest, width: 22, textAlign: 'right', flexShrink: 0 }}>{i + 1}</span>
              <span>{lat.toFixed(4)}, {lng.toFixed(4)}</span>
            </div>
          ))}
        </div>
      )}

      {isAdmin && bestLength !== null && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${t.border}` }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: t.textMuted, marginBottom: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={recalcLatency} onChange={e => setRecalcLatency(e.target.checked)} />
            Also recalculate latency{newLatency !== null ? ` (→ ${newLatency} ms)` : ''}
          </label>
          <button type="button" onClick={() => setConfirming(true)} style={iconBtn(t, t.blue)}>
            ⟳ Update stored length {bestSource === 'kml' ? 'from surveyed KMZ' : 'from drawn path'}
          </button>
          {saveError && <div style={{ color: t.red, fontSize: 11, marginTop: 6 }}>{saveError}</div>}
        </div>
      )}

      {confirming && bestLength !== null && (
        <ConfirmDialog
          title="Update stored length?"
          body={
            <>
              Stored length will change from <strong>{segment.length_km.toLocaleString()} km</strong> to{' '}
              <strong>{Math.round(bestLength).toLocaleString()} km</strong>, based on the {bestSource === 'kml' ? 'surveyed KMZ path' : 'drawn waypoint path'}.
              {recalcLatency && newLatency !== null && (
                <> Latency will also change from <strong>{segment.latency} ms</strong> to <strong>{newLatency} ms</strong>.</>
              )}
            </>
          }
          confirmLabel={saving ? 'Saving…' : 'Update'}
          onConfirm={() => void applyUpdate()}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  )
}

/** The four figures the pathfinder actually routes on. */
function MetricsList({ t, segment }: { t: T; segment: CableSegment }) {
  return (
    <div>
      <TextRow t={t} label="Length" value={`${segment.length_km.toLocaleString()} km`} />
      <TextRow t={t} label="Latency" value={`${segment.latency} ms`} />
      <TextRow t={t} label="Availability" value={`${(segment.reliability * 100).toFixed(3)}%`} />
      <TextRow t={t} label="Cost weight" value={String(segment.cost_weight)} />
    </div>
  )
}

/** Total/available/used figures plus a utilisation bar, or an `Empty` line
 *  when the segment has no capacity record at all. */
function CapacityBlock({ t, cap }: { t: T; cap?: SegmentCapacity }) {
  if (!cap) return <Empty t={t}>No capacity record for this segment.</Empty>
  const total = cap.total_capacity_t
  const used = total - cap.available_capacity_t
  const pct = total > 0 ? used / total : 0
  return (
    <div>
      <TextRow t={t} label="Total" value={`${total.toLocaleString()} T`} />
      <TextRow t={t} label="Available" value={`${cap.available_capacity_t.toLocaleString()} T`} />
      <TextRow t={t} label="Used" value={`${used.toLocaleString()} T (${Math.round(pct * 100)}%)`} />
      {total > 0 && (
        <div style={{ height: 6, borderRadius: 3, background: t.bgDeep, marginTop: 8, overflow: 'hidden' }}>
          <div style={{ width: `${Math.round(pct * 100)}%`, height: '100%', background: utilisationColor(pct, t) }} />
        </div>
      )}
    </div>
  )
}

/**
 * RFS and EOL, for the segment and for the cable it belongs to, plus the one
 * answer that matters: is it usable today? The effective dates come from
 * utils/serviceDate — the same module the map and the route request use — so
 * this card can never disagree with what the router will actually do.
 */
function LifecycleBlock({ t, segment, system }: { t: T; segment: CableSegment; system?: CableSystem }) {
  const today = todayIso()
  const usable = isSegmentUsableOn(segment, system, today)
  const rfsEffective = effectiveRfsDate(segment, system)
  const eolEffective = effectiveEolDate(segment, system)

  return (
    <div>
      <Row t={t} label="Status today">
        <Pill color={usable ? t.green : t.orange}>{usable ? 'In service' : 'Not usable'}</Pill>
      </Row>
      <TextRow t={t} label="Segment RFS" value={lifecycleText(segment.rfs_status ?? 'in_service', segment.rfs_quarter, RFS_OPTS)} />
      <TextRow t={t} label="Segment EOL" value={lifecycleText(segment.eol_status ?? 'active', segment.eol_quarter, EOL_OPTS)} />
      <TextRow t={t} label="System RFS" value={system ? lifecycleText(system.rfs_status ?? 'in_service', system.rfs_quarter, RFS_OPTS) : '—'} />
      <TextRow t={t} label="System EOL" value={system ? lifecycleText(system.eol_status ?? 'active', system.eol_quarter, EOL_OPTS) : '—'} />
      {/* The effective dates are the LATER of the two RFS and the EARLIER of
          the two EOL — a segment cannot be live before its cable, nor outlive
          it — so showing the pair explains any surprise in the status above. */}
      <TextRow t={t} label="Effective from" value={boundaryText(rfsEffective, 'always')} />
      <TextRow t={t} label="Effective until" value={boundaryText(eolEffective, 'no end date')} />
    </div>
  )
}

/** "Planned — Q2 2027", or just the status when there is no quarter to add. */
function lifecycleText(status: RfsStatus | EolStatus | string, quarter: string | null | undefined, opts: [string, string][]): string {
  const label = Object.fromEntries(opts)[status] ?? status
  return quarter ? `${label} — ${formatQuarter(quarter)}` : label
}

/** The sentinel effective dates ('0000-01-01' / '9999-12-31') mean "no bound",
 *  and printing them raw would read as a real date that happens to be absurd. */
function boundaryText(iso: string, unbounded: string): string {
  if (iso.startsWith('0000') || iso.startsWith('9999')) return unbounded
  return iso
}

/** Other segments joining the same two nodes — the diversity/parallel question. */
function ParallelList({ t, parallel, capacity, onOpen }: {
  t: T; parallel: CableSegment[]; capacity: SegmentCapacity[]; onOpen: (id: string) => void
}) {
  if (parallel.length === 0) return <Empty t={t}>No other segment joins these two nodes.</Empty>
  const capById = Object.fromEntries(capacity.map(c => [c.segment_id, c]))
  return (
    <>
      {parallel.map(s => {
        const cap = capById[s.id]
        return (
          <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 12 }}>
            <Pill color={s.type === 'wet' ? t.blue : t.orange}>{s.type === 'wet' ? 'Wet' : 'Terr'}</Pill>
            <button
              onClick={() => onOpen(s.id)}
              style={{
                flex: 1, minWidth: 0, textAlign: 'left', background: 'none', border: 'none',
                padding: 0, cursor: 'pointer', color: t.blue, fontSize: 12, fontFamily: 'inherit',
                wordBreak: 'break-word',
              }}
            >
              {s.name || s.id}
            </button>
            <span style={{ color: t.textFaint, fontSize: 11, whiteSpace: 'nowrap' }}>
              {cap ? `${cap.available_capacity_t} T free` : 'no capacity'}
            </span>
          </div>
        )
      })}
    </>
  )
}

/** Live faults and future planned windows on this segment. */
function OutageList({ t, outages }: { t: T; outages: SegmentOutage[] }) {
  if (outages.length === 0) return <Empty t={t}>No outages or planned work recorded.</Empty>
  return (
    <>
      {outages.map(o => {
        const planned = o.event_type === 'planned_event'
        const color = planned ? t.orange : t.red
        const window = planned
          ? `${o.planned_start ?? 'TBC'} – ${o.planned_end ?? 'TBC'}`
          : `Raised ${o.fault_date} · ETA ${o.estimated_repair_date ?? 'TBC'}`
        return (
          <div key={`${o.fault_id}-${o.fault_date}`} style={{
            borderLeft: `3px solid ${color}`, background: t.bgDeep, borderRadius: 4,
            padding: '6px 9px', marginBottom: 6,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <Pill color={color}>{planned ? 'Planned' : 'Outage'}</Pill>
              <span style={{ fontSize: 11, fontWeight: 700, color: t.text }}>{o.fault_id}</span>
            </div>
            <div style={{ fontSize: 11, color: t.textMuted, marginTop: 3 }}>{window}</div>
            {o.description && (
              <div style={{ fontSize: 11, color: t.textFaint, marginTop: 3, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                {o.description}
              </div>
            )}
          </div>
        )
      })}
    </>
  )
}

// ── The admin edit form ───────────────────────────────────────────────────

/**
 * Every field the Reference Data segment tab exposes except `id`. Numbers are
 * held as strings so a half-typed "-" or "3." survives keystroke to keystroke;
 * they are parsed exactly once, in `save`.
 */
interface EditDraft {
  name: string
  system_id: string
  type: string
  ownership: string
  length_km: string
  latency: string
  reliability: string
  cost_weight: string
  rfs_status: string
  rfs_quarter: string
  eol_status: string
  eol_quarter: string
  waypoints: [number, number][]
}

/** Builds an `EditDraft` snapshot of `s` for the edit form to start from — see
 *  `EditDraft`'s own docstring for why numbers are strings and waypoints are
 *  deep-copied. */
function draftFrom(s: CableSegment): EditDraft {
  return {
    name: s.name ?? '',
    system_id: s.system_id ?? '',
    type: s.type,
    ownership: s.ownership,
    length_km: String(s.length_km),
    latency: String(s.latency),
    reliability: String(s.reliability),
    cost_weight: String(s.cost_weight),
    rfs_status: s.rfs_status ?? 'in_service',
    rfs_quarter: s.rfs_quarter ?? '',
    eol_status: s.eol_status ?? 'active',
    eol_quarter: s.eol_quarter ?? '',
    // Deep-copied: the draft's waypoint rows are edited in place, and mutating
    // the live segment's array would change the map under the dialog.
    waypoints: (s.waypoints ?? []).map(([a, b]): [number, number] => [a, b]),
  }
}

const QUARTER_PATTERN = /^\d{4}-Q[1-4]$/

/** The four metric fields, each of which must parse as a non-negative number. */
function validateMetrics(draft: EditDraft): string | null {
  const numbers: [string, string][] = [
    ['Length (km)', draft.length_km],
    ['Latency (ms)', draft.latency],
    ['Availability', draft.reliability],
    ['Cost weight', draft.cost_weight],
  ]
  for (const [label, raw] of numbers) {
    const n = Number(raw)
    if (raw.trim() === '' || !Number.isFinite(n)) return `${label} must be a number`
    if (n < 0) return `${label} cannot be negative`
  }
  // 99.95 typed into a field that means 0.9995 would quietly make the segment
  // the most reliable thing on the network and win every route.
  if (Number(draft.reliability) > 1) return 'Availability is a fraction — 0.9995, not 99.95'
  return null
}

/**
 * A planned/eol row with no usable quarter is treated as NEVER USABLE by the
 * router (see utils/serviceDate), so saving one silently removes the segment
 * from every search. Refuse it here rather than let that happen quietly.
 */
function validateLifecycle(draft: EditDraft): string | null {
  if (draft.rfs_status === 'planned' && !QUARTER_PATTERN.test(draft.rfs_quarter.trim())) {
    return 'A planned segment needs an RFS quarter like 2027-Q2'
  }
  if (draft.eol_status === 'eol' && !QUARTER_PATTERN.test(draft.eol_quarter.trim())) {
    return 'An end-of-life segment needs an EOL quarter like 2027-Q2'
  }
  return null
}

/** Every waypoint must be a real coordinate: latitude in [-90, 90], longitude
 *  in [-180, 180]. Returns the first violation found, or null when all pass. */
function validateWaypoints(draft: EditDraft): string | null {
  for (const [lat, lng] of draft.waypoints) {
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) return 'Every waypoint latitude must be between -90 and 90'
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) return 'Every waypoint longitude must be between -180 and 180'
  }
  return null
}

/** Pure draft validation — returns the FIRST message to show, or null when
 *  savable. Split into four so no one check hides inside a long function. */
function validateDraft(draft: EditDraft): string | null {
  if (!draft.name.trim()) return 'Name is required'
  if (!draft.system_id) return 'A cable system is required'
  return validateMetrics(draft) ?? validateLifecycle(draft) ?? validateWaypoints(draft)
}

function EditSegmentForm({ t, segment, systems, onSaved, onCancel }: {
  t: T; segment: CableSegment; systems: CableSystem[]; onSaved: () => void; onCancel: () => void
}) {
  const [draft, setDraft] = useState<EditDraft>(() => draftFrom(segment))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const systemOpts: [string, string][] = systems.map(s => [s.id, `${s.id} — ${s.name}`])

  async function save() {
    const invalid = validateDraft(draft)
    if (invalid) { setError(invalid); return }

    setSaving(true)
    setError(null)
    try {
      await api.updateSegment(segment.id, {
        name: draft.name,
        system_id: draft.system_id,
        type: draft.type as SegmentType,
        ownership: draft.ownership as Ownership,
        length_km: Number(draft.length_km),
        latency: Number(draft.latency),
        reliability: Number(draft.reliability),
        cost_weight: Number(draft.cost_weight),
        rfs_status: draft.rfs_status as RfsStatus,
        // An empty quarter box must clear the stored value, not send "".
        rfs_quarter: draft.rfs_quarter.trim() || null,
        eol_status: draft.eol_status as EolStatus,
        eol_quarter: draft.eol_quarter.trim() || null,
        // Same null-not-empty-array convention the Reference Data form uses,
        // so a segment stripped of its waypoints goes back to a direct line.
        waypoints: draft.waypoints.length > 0 ? draft.waypoints : null,
      } as Partial<CableSegment>)
      onSaved()
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }

  const set = (patch: Partial<EditDraft>) => setDraft({ ...draft, ...patch })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <ReadOnlyIdField t={t} label="ID" id={segment.id} />
      <EditField t={t} label="Name *" value={draft.name} onChange={v => set({ name: v })} />
      <SelectField t={t} label="System" value={draft.system_id} options={systemOpts} onChange={v => set({ system_id: v })} />
      <SelectField t={t} label="Medium" value={draft.type} options={TYPE_OPTS} onChange={v => set({ type: v })} />
      <SelectField t={t} label="Ownership" value={draft.ownership} options={OWNERSHIP_OPTS} onChange={v => set({ ownership: v })} />
      <EditField t={t} label="Length (km)" value={draft.length_km} onChange={v => set({ length_km: v })} type="number" mono />
      <EditField t={t} label="Latency (ms)" value={draft.latency} onChange={v => set({ latency: v })} type="number" mono />
      <EditField t={t} label="Availability" value={draft.reliability} onChange={v => set({ reliability: v })} type="number" mono />
      <EditField t={t} label="Cost weight" value={draft.cost_weight} onChange={v => set({ cost_weight: v })} type="number" mono />
      <SelectField t={t} label="RFS status" value={draft.rfs_status} options={RFS_OPTS} onChange={v => set({ rfs_status: v })} />
      <EditField t={t} label="RFS quarter" value={draft.rfs_quarter} onChange={v => set({ rfs_quarter: v })} mono />
      <SelectField t={t} label="EOL status" value={draft.eol_status} options={EOL_OPTS} onChange={v => set({ eol_status: v })} />
      <EditField t={t} label="EOL quarter" value={draft.eol_quarter} onChange={v => set({ eol_quarter: v })} mono />

      <WaypointEditor t={t} waypoints={draft.waypoints} onChange={wps => set({ waypoints: wps })} />

      <EditFormFooter t={t} error={error} saving={saving} onSave={save} onCancel={onCancel} />
    </div>
  )
}

/**
 * Add, reorder, retype and delete the intermediate lat/lng points that shape
 * the cable's path. Pasting "12.34, 56.78" into the latitude box fills BOTH
 * boxes — coordinates are almost always copied as a pair, and typing them into
 * two fields is where transcription errors come from.
 */
function WaypointEditor({ t, waypoints, onChange }: {
  t: T; waypoints: [number, number][]; onChange: (wps: [number, number][]) => void
}) {
  const { stackLabels } = useLayout()

  function update(i: number, which: 0 | 1, raw: string) {
    const n = Number(raw)
    if (!Number.isFinite(n)) return
    const next = waypoints.map((w): [number, number] => [w[0], w[1]])
    next[i][which] = n
    onChange(next)
  }

  function swap(i: number, j: number) {
    const next = waypoints.map((w): [number, number] => [w[0], w[1]]);
    [next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }

  function pastePair(i: number, e: React.ClipboardEvent) {
    const parts = e.clipboardData.getData('text').trim().split(/[\s,;]+/).filter(Boolean)
    if (parts.length < 2) return
    const [lat, lng] = [Number(parts[0]), Number(parts[1])]
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return
    e.preventDefault()
    const next = waypoints.map((w): [number, number] => [w[0], w[1]])
    next[i] = [lat, lng]
    onChange(next)
  }

  const box = { ...inputStyle(t, false), flex: '0 0 auto', width: 92 } as React.CSSProperties

  return (
    <div style={{ marginTop: 4 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 5, flexWrap: 'wrap' }}>
        <span style={fieldLabelStyle(t, stackLabels)}>Waypoints</span>
        <span style={{ fontSize: 10, color: t.textFaintest }}>
          Intermediate points from A-end to Z-end. Paste "lat, lng" to fill both.
        </span>
      </div>
      {waypoints.map(([lat, lng], i) => (
        <div key={i} style={{ display: 'flex', gap: 5, alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10, color: t.textFaint, width: 18, textAlign: 'right', flexShrink: 0 }}>{i + 1}</span>
          <input
            aria-label={`Waypoint ${i + 1} latitude`} inputMode="decimal" value={String(lat)} style={box}
            onChange={e => update(i, 0, e.target.value)} onPaste={e => pastePair(i, e)}
          />
          <input
            aria-label={`Waypoint ${i + 1} longitude`} inputMode="decimal" value={String(lng)} style={box}
            onChange={e => update(i, 1, e.target.value)}
          />
          <button disabled={i === 0} onClick={() => swap(i, i - 1)} style={miniBtn(t, i === 0)} title="Move up">↑</button>
          <button disabled={i === waypoints.length - 1} onClick={() => swap(i, i + 1)} style={miniBtn(t, i === waypoints.length - 1)} title="Move down">↓</button>
          <button onClick={() => onChange(waypoints.filter((_, j) => j !== i))} style={miniBtn(t, false, t.red)} title="Delete waypoint">×</button>
        </div>
      ))}
      <button
        onClick={() => onChange([...waypoints, [0, 0]])}
        style={{ ...iconBtn(t, t.blue), padding: '4px 10px', marginTop: 2 }}
      >
        + Add waypoint
      </button>
    </div>
  )
}

/** Tiny icon-only button style for the waypoint editor's ↑/↓/× row controls. */
function miniBtn(t: T, disabled: boolean, color?: string): React.CSSProperties {
  return {
    fontSize: 11, padding: '3px 7px', borderRadius: 3,
    border: `1px solid ${color ? color + '44' : t.border}`,
    background: 'transparent', color: color ?? t.textFaint,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.3 : 1,
    fontFamily: 'inherit',
  }
}
