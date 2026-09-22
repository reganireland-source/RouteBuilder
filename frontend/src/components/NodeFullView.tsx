/**
 * ============================================================================
 *  NodeFullView.tsx — the node "Full View" modal.
 * ============================================================================
 *
 * The floating NodeInfoPanel card answers "what is this node?" in the corner of
 * the map. Full View answers "tell me everything about this node" on a page of
 * its own: the same identity fields and site map, plus the product coverage
 * matrix, every segment leaving the node drawn as a fan-out diagram, the
 * capacity on those segments, the cable systems present, and any solution notes
 * recorded against the site.
 *
 * Three things worth knowing about how it behaves:
 *
 * 1. It NAVIGATES. Clicking a spoke in the fan diagram reloads the whole view
 *    on the node at the far end, pushing the current one onto a back stack, so
 *    you can walk the network hop by hop without closing and re-clicking on the
 *    map. That is why it holds `nodeId` in state rather than taking a `node`
 *    object — the node prop would go stale the moment you navigated.
 *
 * 2. ADMINS CAN EDIT IN PLACE. The Edit button turns the identity block into a
 *    form over the same fields the Reference Data node tab exposes, and Save
 *    writes straight through `api.updateNode` — no staging, same as Reference
 *    Data. `onDataChange` then tells the app to refetch so every other surface
 *    (map, route results, the card underneath) picks the change up. The form
 *    (`EditNodeForm`) owns its own draft/saving/error state, so navigating away
 *    unmounts it and there is no half-typed draft left lying around.
 *
 * 3. THE SHELL IS SHARED. The dialog, the cards, the form controls and the
 *    three responsive breakpoints all live in `fullViewChrome.tsx`, so this
 *    view and SegmentFullView are the same screen with different contents
 *    rather than two that drift apart. See that file for the breakpoint model.
 *
 * Notes and note categories can be passed in when the parent already has them;
 * otherwise EntityNotesPanel fetches its own, because the notes API has no
 * per-node filter and refetching on every navigation would be wasteful.
 *
 * Mounted from: NodeInfoPanel.tsx (its "⛶ Full View" button).
 * Backend: GET /api/solution-notes + /api/note-categories (via EntityNotesPanel),
 * PUT /api/nodes/{id} on save, and the openstreetmap.org embed iframe.
 * ============================================================================
 */
import { useState } from 'react'
import { createPortal } from 'react-dom'
import type {
  CableNode, CableSegment, CableSystem, SegmentCapacity,
  SolutionNote, NoteCategory, NodeType, OnNet,
} from '../types'
import { useTheme } from '../theme'
import { useAuth } from '../context/AuthContext'
import { api } from '../api/client'
import { nodeLabel } from '../utils/nodeLabel'
import { OWNER_LOGOS } from '../utils/ownerLogos'
import { ProductCoverageMatrix } from './ProductCoverageMatrix'
import { SegmentFanDiagram } from './SegmentFanDiagram'
import { EntityNotesPanel } from './EntityNotesPanel'
import { HazardsNearbyCard } from './HazardsNearbyCard'
import { useHazardsFor } from '../context/HazardContext'
import { SegmentFullView } from './SegmentFullView'
import {
  type T, LayoutContext, useLayout, useFullViewLayout, useEscapeKey,
  backdropClose, backdropStyle, dialogStyle, headerShell, scrollerStyle, rowStyle,
  Card, Row, Empty, NotFound, EditField, SelectField, ReadOnlyIdField, EditFormFooter, FullViewColumn,
  iconBtn, closeBtnStyle, utilisationColor, Z_FULL_VIEW_BASE, nextFullViewLayer,
} from './fullViewChrome'

// Same option sets the Reference Data node form uses — kept identical on
// purpose so an admin sees the same choices wherever they edit a node.
const TYPE_OPTS: [NodeType, string][] = [
  ['landing_station', 'CLS (Landing Station)'],
  ['primary_pop',     'Primary PoP'],
  ['secondary_pop',   'Secondary PoP'],
  ['extension_pop',   'Extension PoP'],
  ['branching_unit',  'BU (Branching Unit)'],
  ['off_net',         'Off-Net Node'],
]
const ON_NET_OPTS: [string, string][] = [
  ['',        '— Not set —'],
  ['on_net',  'On-Net'],
  ['off_net', 'Off-Net'],
]

const TYPE_LABEL: Record<string, string> = Object.fromEntries(TYPE_OPTS)

/** The node fields this form edits — the same eleven the Reference Data tab
 *  exposes. `id` is deliberately absent: it is the identifier, and renaming it
 *  would orphan every segment that references it. */
interface EditDraft {
  name: string
  country: string
  type: NodeType
  lat: string
  lng: string
  owner: string
  trading_name: string
  city: string
  street_address: string
  description: string
  on_net: string
}

function draftFrom(n: CableNode): EditDraft {
  return {
    name: n.name ?? '',
    country: n.country ?? '',
    type: n.type,
    // Held as strings so a half-typed "-" or "3." doesn't collapse to NaN
    // while the user is still typing; parsed once on save.
    lat: String(n.lat),
    lng: String(n.lng),
    owner: n.owner ?? '',
    trading_name: n.trading_name ?? '',
    city: n.city ?? '',
    street_address: n.street_address ?? '',
    description: n.description ?? '',
    on_net: n.on_net ?? '',
  }
}

/** Pure draft validation — returns the message to show, or null when savable. */
function validateDraft(draft: EditDraft): string | null {
  const lat = Number(draft.lat)
  const lng = Number(draft.lng)
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) return 'Latitude must be between -90 and 90'
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) return 'Longitude must be between -180 and 180'
  if (!draft.name.trim()) return 'Name is required'
  return null
}

interface Props {
  nodeId: string
  nodes: CableNode[]
  segments: CableSegment[]
  systems: CableSystem[]
  capacity: SegmentCapacity[]
  notes?: SolutionNote[]
  noteCategories?: NoteCategory[]
  onClose: () => void
  onDataChange?: () => void
  /**
   * Where a segment's ⛶ should go. Omit it and this view stacks its own
   * SegmentFullView on top; supply it and the parent handles it instead. That
   * is how SegmentFullView — which opens node views of its own — keeps the
   * stack from growing without bound: it hands down its own `navigateTo`, so
   * picking a segment inside a node view returns to the segment screen rather
   * than opening a third modal on top of the second.
   */
  onOpenSegment?: (segmentId: string) => void
  /** The stacking layer to render at. Defaults to the base; a view that opens
   *  this one on top of itself passes the next rung of the ladder. */
  zIndex?: number
}

export function NodeFullView({
  nodeId, nodes, segments, systems, capacity, notes, noteCategories, onClose, onDataChange,
  onOpenSegment, zIndex = Z_FULL_VIEW_BASE,
}: Props) {
  const t = useTheme()
  const { isAdmin } = useAuth()
  const layout = useFullViewLayout()
  const { phone } = layout

  // Navigation state: `current` is what's on screen, `stack` is where we came
  // from. Both are ids, so a refetch after an edit flows straight through.
  const [current, setCurrent] = useState(nodeId)
  const [stack, setStack] = useState<string[]>([])
  const [editing, setEditing] = useState(false)
  /** A segment Full View stacked on top — only used when the parent did not
   *  claim segment opening for itself via `onOpenSegment`. */
  const [openSegmentId, setOpenSegmentId] = useState<string | null>(null)

  const nodesById = Object.fromEntries(nodes.map(n => [n.id, n])) as Record<string, CableNode>
  const node = nodesById[current]

  useEscapeKey(() => {
    // Escape backs out one hop before it closes — losing a five-node walk to
    // a stray keypress would be worse than needing two presses.
    if (openSegmentId) { setOpenSegmentId(null); return }
    if (editing) { setEditing(false); return }
    if (stack.length) { goBack(); return }
    onClose()
  })

  function navigateTo(id: string) {
    if (!nodesById[id] || id === current) return
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

  // Null once the stack is as deep as it may go, which hides the ⛶ rather than
  // opening a view that would land behind the tooltip layer.
  const stackedLayer = nextFullViewLayer(zIndex)
  const openSegment = onOpenSegment ?? (stackedLayer === null ? undefined : setOpenSegmentId)

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
          aria-label={node ? `Node ${nodeLabel(node)}` : 'Node'}
          style={dialogStyle(t, phone)}
          className="rb-anim-pop"
        >
          <FullViewHeader
            t={t}
            phone={phone}
            node={node}
            current={current}
            backTo={backTarget(stack, nodesById)}
            canEdit={Boolean(isAdmin && node && !editing)}
            onBack={goBack}
            onEdit={() => setEditing(true)}
            onClose={onClose}
          />

          {node ? (
            <FullViewBody
              t={t}
              node={node}
              nodesById={nodesById}
              segments={segments}
              systems={systems}
              capacity={capacity}
              notes={notes}
              noteCategories={noteCategories}
              editing={editing}
              onNavigate={navigateTo}
              onOpenSegment={openSegment}
              onSaved={() => { setEditing(false); onDataChange?.() }}
              onCancelEdit={() => setEditing(false)}
            />
          ) : (
            <NotFound t={t} what="node" id={current} />
          )}
        </div>
      </div>
    </LayoutContext.Provider>
  )

  return (
    <>
      {createPortal(body, document.body)}
      {openSegmentId && stackedLayer !== null && (
        <SegmentFullView
          zIndex={stackedLayer}
          segmentId={openSegmentId}
          nodes={nodes}
          segments={segments}
          systems={systems}
          capacity={capacity}
          notes={notes}
          noteCategories={noteCategories}
          onClose={() => setOpenSegmentId(null)}
          onDataChange={onDataChange}
        />
      )}
    </>
  )
}

/** Label for the "← Back" button's tooltip, or null when the stack is empty. */
function backTarget(stack: string[], nodesById: Record<string, CableNode>): string | null {
  const prev = stack[stack.length - 1]
  if (prev === undefined) return null
  return nodeLabel(nodesById[prev], prev)
}

// ── Header ────────────────────────────────────────────────────────────────

/**
 * On desktop this is the original single wrapping row. On a phone it splits
 * into two deliberate lines — title + × on top, Back/Edit/logo underneath —
 * because letting a wrapping row decide where the × lands is how it ended up
 * off the bottom of a 430px header. The × keeps a 40px touch target there.
 */
function FullViewHeader({ t, phone, node, current, backTo, canEdit, onBack, onEdit, onClose }: {
  t: T
  phone: boolean
  node: CableNode | undefined
  current: string
  backTo: string | null
  canEdit: boolean
  onBack: () => void
  onEdit: () => void
  onClose: () => void
}) {
  const title = node ? nodeLabel(node) : current
  const subtitle = node
    ? [TYPE_LABEL[node.type] ?? node.type, node.city, node.country].filter(Boolean).join(' · ')
    : 'Node not found in the loaded dataset'
  const logoUrl = node?.owner ? OWNER_LOGOS[node.owner] : undefined

  const backBtn = backTo === null ? null : (
    <button onClick={onBack} title={`Back to ${backTo}`} style={iconBtn(t)}>← Back</button>
  )
  const logo = logoUrl === undefined ? null : (
    <div style={{ background: '#fff', borderRadius: 5, padding: '3px 7px', display: 'flex', alignItems: 'center', height: 32 }}>
      <img src={logoUrl} alt={node?.owner ?? ''} style={{ height: 22, maxWidth: 80, objectFit: 'contain' }} />
    </div>
  )
  // Editing is admin-only; the button is hidden rather than disabled because a
  // read-only viewer has nothing to gain from seeing it.
  const editBtn = canEdit ? (
    <button onClick={onEdit} style={iconBtn(t, t.blue)}>✎ Edit node</button>
  ) : null
  const closeBtn = (
    <button onClick={onClose} title="Close" aria-label="Close" style={closeBtnStyle(t, phone)}>×</button>
  )
  const titleBlock = (
    <div style={{ minWidth: 0, flex: phone ? 1 : undefined }}>
      <div style={{ fontSize: 16, fontWeight: 800, color: t.text, overflowWrap: 'anywhere' }}>{title}</div>
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
          <div style={{ flex: 1 }} />
          {logo}
        </div>
      </div>
    )
  }

  return (
    <div style={headerShell(t, false)}>
      {backBtn}
      {titleBlock}
      <div style={{ flex: 1 }} />
      {logo}
      {editBtn}
      {closeBtn}
    </div>
  )
}

// ── Body ──────────────────────────────────────────────────────────────────

/**
 * Stacked sections rather than one auto-placed grid: a full-width "span" item
 * mixed into `repeat(auto-fit, …)` auto-placement made the browser size the
 * implicit rows off the wrong items, and the cards overlapped each other. Each
 * section owns its own row, so nothing can be placed into a row it doesn't fit.
 */
function FullViewBody({
  t, node, nodesById, segments, systems, capacity, notes, noteCategories,
  editing, onNavigate, onOpenSegment, onSaved, onCancelEdit,
}: {
  t: T
  node: CableNode
  nodesById: Record<string, CableNode>
  segments: CableSegment[]
  systems: CableSystem[]
  capacity: SegmentCapacity[]
  notes?: SolutionNote[]
  noteCategories?: NoteCategory[]
  editing: boolean
  onNavigate: (id: string) => void
  onOpenSegment?: (id: string) => void
  onSaved: () => void
  onCancelEdit: () => void
}) {
  const { phone, landscape } = useLayout()
  const nodeHazards = useHazardsFor('node', node.id)

  const nodeSegments = segments.filter(s => s.start_node_id === node.id || s.end_node_id === node.id)
  const systemsById = Object.fromEntries(systems.map(s => [s.id, s]))

  const systemCounts = new Map<string, number>()
  for (const seg of nodeSegments) systemCounts.set(seg.system_id, (systemCounts.get(seg.system_id) ?? 0) + 1)

  const delta = 0.01
  const mapUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${node.lng - delta},${node.lat - delta},${node.lng + delta},${node.lat + delta}&layer=mapnik&marker=${node.lat},${node.lng}`

  const row = rowStyle(phone)

  // The cards, named once so the two layouts below compose the SAME content
  // rather than each carrying its own copy that could drift.
  const identityCard = (
    <Card key="identity" t={t} title={editing ? 'Edit Node' : 'Key Information'} grow>
      {editing
        ? <EditNodeForm t={t} node={node} onSaved={onSaved} onCancel={onCancelEdit} />
        : <IdentityList t={t} node={node} />}
    </Card>
  )
  const siteCard = (
    <Card key="site" t={t} title="Site Location" pad={0} grow>
      <iframe
        key={node.id}
        src={mapUrl}
        style={{ width: '100%', height: phone ? 220 : 300, border: 'none', display: 'block' }}
        title={`Map of ${node.name}`}
      />
    </Card>
  )
  // The fan diagram is square, so in a half-width column it wants a smaller
  // canvas than it did spanning the whole dialog. The SVG scales to its
  // container and its fonts are fixed in viewBox units, so a smaller nominal
  // size actually MAGNIFIES the labels relative to the picture.
  const fanCard = (
    <Card key="fan" t={t} title={`Segments Leaving This Node (${nodeSegments.length})`} grow>
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <SegmentFanDiagram
          node={node}
          segments={segments}
          nodesById={nodesById}
          onSelectNode={onNavigate}
          size={fanSize(phone, landscape)}
        />
      </div>
    </Card>
  )
  const coverageCard = (
    <Card key="coverage" t={t} title="Product Coverage" grow>
      {node.capabilities
        ? <ProductCoverageMatrix capabilities={node.capabilities} heading={null} />
        : <Empty t={t}>No product coverage configured for this node.</Empty>}
    </Card>
  )
  const systemsCard = (
    <Card key="systems" t={t} title={`Cable Systems (${systemCounts.size})`} grow>
      <CableSystemsList t={t} counts={systemCounts} systemsById={systemsById} />
    </Card>
  )
  const capacityCard = (
    <Card key="capacity" t={t} title="Segment Capacity" grow>
      <SegmentCapacityList
        t={t} node={node} nodeSegments={nodeSegments} capacity={capacity} nodesById={nodesById}
        onOpenSegment={onOpenSegment}
      />
    </Card>
  )
  const notesCard = (
    <Card key="notes" t={t} title={null} grow>
      <EntityNotesPanel kind="node" entityId={node.id} notes={notes} categories={noteCategories} />
    </Card>
  )
  // Renders nothing when there is nothing to report — see HazardsNearbyCard.
  const hazardsCard = <HazardsNearbyCard key="hazards" hazards={nodeHazards} kind="node" assetId={node.id} />

  const scroller = scrollerStyle(phone)

  // ── Landscape: two columns side by side ──────────────────────────────────
  // A wide screen is wide, and the stacked version made you scroll past a
  // full-width fan diagram to reach the capacity and notes. Split so the two
  // halves read together: identity and the visuals on the left, the tabular
  // detail on the right. The columns are balanced by content height, not by
  // card count — the fan diagram is worth roughly three of the small cards.
  if (landscape) {
    return (
      <div style={{ ...scroller, display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <FullViewColumn>{[identityCard, siteCard, coverageCard]}</FullViewColumn>
        <FullViewColumn>{[fanCard, systemsCard, capacityCard, hazardsCard, notesCard]}</FullViewColumn>
      </div>
    )
  }

  // ── Stacked: phones and narrow windows ───────────────────────────────────
  return (
    <div style={{ ...scroller, display: 'flex', flexDirection: 'column', gap: phone ? 12 : 16 }}>
      <div style={row}>{identityCard}{siteCard}</div>
      <div style={row}>{fanCard}</div>
      <div style={row}>{coverageCard}{systemsCard}</div>
      <div style={row}>{capacityCard}{notesCard}</div>
      <div style={row}>{hazardsCard}</div>
    </div>
  )
}

// ── The four self-contained panels ────────────────────────────────────────

/** The read-only identity block: every populated field, in a fixed order. */
function IdentityList({ t, node }: { t: T; node: CableNode }) {
  const fields: [string, string | undefined][] = [
    ['ID', node.id],
    ['Type', TYPE_LABEL[node.type] ?? node.type],
    ['On-Net', onNetLabel(node.on_net)],
    ['Country', node.country],
    ['City', node.city],
    ['Lat / Lng', `${node.lat}, ${node.lng}`],
    ['Owner', node.owner],
    ['Trading Name', node.trading_name],
    ['Street Address', node.street_address],
    ['Description', node.description],
    ['Verification', node.verification_status],
  ]
  return (
    <div>
      {fields.filter(([, v]) => v).map(([label, value]) => (
        <Row key={label} t={t} label={label}>
          <span style={{ color: t.text, wordBreak: 'break-word' }}>{value}</span>
        </Row>
      ))}
    </div>
  )
}

/**
 * The in-place admin edit form. It owns the draft, the saving flag and the
 * validation error: the parent only owns the boolean "are we editing", so
 * cancelling or navigating unmounts this and throws the draft away with it.
 */
function EditNodeForm({ t, node, onSaved, onCancel }: {
  t: T; node: CableNode; onSaved: () => void; onCancel: () => void
}) {
  const [draft, setDraft] = useState<EditDraft>(() => draftFrom(node))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    const invalid = validateDraft(draft)
    if (invalid) { setError(invalid); return }

    setSaving(true)
    setError(null)
    try {
      await api.updateNode(node.id, {
        ...draft,
        lat: Number(draft.lat),
        lng: Number(draft.lng),
        on_net: (draft.on_net || undefined) as OnNet | undefined,
      })
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
      <ReadOnlyIdField t={t} label="ID" id={node.id} />
      <EditField t={t} label="Name *"       value={draft.name}           onChange={v => set({ name: v })} />
      <EditField t={t} label="Country"      value={draft.country}        onChange={v => set({ country: v })} />
      <SelectField t={t} label="Type"       value={draft.type}           options={TYPE_OPTS} onChange={v => set({ type: v as NodeType })} />
      <SelectField t={t} label="On-Net"     value={draft.on_net}         options={ON_NET_OPTS} onChange={v => set({ on_net: v })} />
      <EditField t={t} label="Latitude"     value={draft.lat}            onChange={v => set({ lat: v })} mono />
      <EditField t={t} label="Longitude"    value={draft.lng}            onChange={v => set({ lng: v })} mono />
      <EditField t={t} label="Owner"        value={draft.owner}          onChange={v => set({ owner: v })} />
      <EditField t={t} label="Trading Name" value={draft.trading_name}   onChange={v => set({ trading_name: v })} />
      <EditField t={t} label="City"         value={draft.city}           onChange={v => set({ city: v })} />
      <EditField t={t} label="Address"      value={draft.street_address} onChange={v => set({ street_address: v })} />
      <EditField t={t} label="Description"  value={draft.description}    onChange={v => set({ description: v })} />

      <EditFormFooter t={t} error={error} saving={saving} onSave={save} onCancel={onCancel} />
    </div>
  )
}

/** Cable systems present at the node, busiest first. */
function CableSystemsList({ t, counts, systemsById }: {
  t: T; counts: Map<string, number>; systemsById: Record<string, CableSystem>
}) {
  if (counts.size === 0) return <Empty t={t}>No systems at this node.</Empty>

  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))

  return (
    <>
      {rows.map(([sysId, count]) => {
        const sys = systemsById[sysId]
        const planned = sys?.rfs_status === 'planned'
        return (
          <div key={sysId} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 12 }}>
            <span style={{ color: t.text, flex: 1, minWidth: 0, wordBreak: 'break-word' }}>{sys?.name ?? sysId}</span>
            {planned && (
              <span style={{
                fontSize: 9, fontWeight: 800, letterSpacing: '0.06em', padding: '1px 5px', borderRadius: 3,
                color: t.orange, border: `1px solid ${t.orange}66`, whiteSpace: 'nowrap',
              }}>RFS {sys?.rfs_quarter ?? 'PLANNED'}</span>
            )}
            <span style={{ color: t.textFaint, fontSize: 11, whiteSpace: 'nowrap' }}>
              {count} segment{count === 1 ? '' : 's'}
            </span>
          </div>
        )
      })}
    </>
  )
}

/** Capacity on every segment leaving the node, one utilisation bar each. */
function SegmentCapacityList({ t, node, nodeSegments, capacity, nodesById, onOpenSegment }: {
  t: T
  node: CableNode
  nodeSegments: CableSegment[]
  capacity: SegmentCapacity[]
  nodesById: Record<string, CableNode>
  onOpenSegment?: (id: string) => void
}) {
  if (nodeSegments.length === 0) return <Empty t={t}>No segments at this node.</Empty>

  const capacityBySegment = Object.fromEntries(capacity.map(c => [c.segment_id, c]))

  return (
    <>
      {nodeSegments.map(seg => {
        const far = seg.start_node_id === node.id ? seg.end_node_id : seg.start_node_id
        return (
          <CapacityRow
            key={seg.id}
            t={t}
            farLabel={nodeLabel(nodesById[far], far)}
            cap={capacityBySegment[seg.id]}
            onOpenSegment={onOpenSegment && (() => onOpenSegment(seg.id))}
          />
        )
      })}
    </>
  )
}

function CapacityRow({ t, farLabel, cap, onOpenSegment }: {
  t: T; farLabel: string; cap: SegmentCapacity | undefined; onOpenSegment?: () => void
}) {
  const total = cap?.total_capacity_t ?? 0
  const used = total - (cap?.available_capacity_t ?? 0)
  const pct = total > 0 ? used / total : 0

  return (
    <div style={{ padding: '5px 0', borderBottom: `1px solid ${t.border}55` }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 11, flexWrap: 'wrap' }}>
        <span style={{ color: t.text, flex: 1, minWidth: 0, wordBreak: 'break-word' }}>
          → {farLabel}
        </span>
        <span style={{ color: t.textFaint, fontFamily: 'ui-monospace, monospace', whiteSpace: 'nowrap' }}>
          {cap ? `${cap.available_capacity_t} / ${cap.total_capacity_t} T free` : 'no capacity record'}
        </span>
        {/* The far-end NODE is one click away through the fan diagram above;
            this is the other half of the pair — the SEGMENT in between. */}
        {onOpenSegment && (
          <button
            onClick={onOpenSegment}
            title="Full view of this segment"
            aria-label={`Full view of the segment to ${farLabel}`}
            style={{
              background: 'none', border: 'none', padding: '0 2px', cursor: 'pointer',
              color: t.blue, fontSize: 12, lineHeight: 1, flexShrink: 0,
            }}
          >⛶</button>
        )}
      </div>
      {total > 0 && (
        <div style={{ height: 3, borderRadius: 2, background: t.bgDeep, marginTop: 3, overflow: 'hidden' }}>
          <div style={{ width: `${Math.round(pct * 100)}%`, height: '100%', background: utilisationColor(pct, t) }} />
        </div>
      )}
    </div>
  )
}

function onNetLabel(v: string | undefined): string | undefined {
  if (v === 'on_net') return 'On-Net'
  if (v === 'off_net') return 'Off-Net'
  return undefined
}

/**
 * Canvas size for the fan diagram. The SVG scales to its container and its
 * fonts are fixed in viewBox units, so a SMALLER nominal size magnifies the
 * labels relative to the picture — which is why the phone gets the smallest
 * box, not the largest.
 */
function fanSize(phone: boolean, landscape: boolean): number {
  if (phone) return 380
  return landscape ? 520 : 620
}
