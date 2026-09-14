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
 * Two things worth knowing about how it behaves:
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
 *    (map, route results, the card underneath) picks the change up.
 *
 * Notes and note categories can be passed in when the parent already has them;
 * otherwise NodeNotesPanel fetches its own, because the notes API has no
 * per-node filter and refetching on every navigation would be wasteful.
 *
 * Mounted from: NodeInfoPanel.tsx (its "⛶ Full View" button).
 * Backend: GET /api/solution-notes + /api/note-categories (via NodeNotesPanel),
 * PUT /api/nodes/{id} on save, and the openstreetmap.org embed iframe.
 * ============================================================================
 */
import { useEffect, useState } from 'react'
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
import { NodeNotesPanel } from './NodeNotesPanel'

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
}

export function NodeFullView({
  nodeId, nodes, segments, systems, capacity, notes, noteCategories, onClose, onDataChange,
}: Props) {
  const t = useTheme()
  const { isAdmin } = useAuth()

  // Navigation state: `current` is what's on screen, `stack` is where we came
  // from. Both are ids, so a refetch after an edit flows straight through.
  const [current, setCurrent] = useState(nodeId)
  const [stack, setStack] = useState<string[]>([])

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<EditDraft | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const nodesById = Object.fromEntries(nodes.map(n => [n.id, n])) as Record<string, CableNode>
  const node = nodesById[current]

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      // Escape backs out one hop before it closes — losing a five-node walk to
      // a stray keypress would be worse than needing two presses.
      if (editing) { setEditing(false); return }
      if (stack.length) { goBack(); return }
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  function navigateTo(id: string) {
    if (!nodesById[id] || id === current) return
    setStack(s => [...s, current])
    setCurrent(id)
    setEditing(false)
    setError(null)
  }

  function goBack() {
    setStack(s => {
      if (!s.length) return s
      setCurrent(s[s.length - 1])
      return s.slice(0, -1)
    })
    setEditing(false)
    setError(null)
  }

  function startEdit() {
    if (!node) return
    setDraft(draftFrom(node))
    setError(null)
    setEditing(true)
  }

  async function save() {
    if (!node || !draft) return
    const lat = Number(draft.lat)
    const lng = Number(draft.lng)
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) { setError('Latitude must be between -90 and 90'); return }
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) { setError('Longitude must be between -180 and 180'); return }
    if (!draft.name.trim()) { setError('Name is required'); return }

    setSaving(true)
    setError(null)
    try {
      await api.updateNode(node.id, {
        ...draft,
        lat,
        lng,
        on_net: (draft.on_net || undefined) as OnNet | undefined,
      })
      setEditing(false)
      onDataChange?.()
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }

  // ── Derived data for the read-only panels ────────────────────────────────
  const nodeSegments = node
    ? segments.filter(s => s.start_node_id === node.id || s.end_node_id === node.id)
    : []
  const systemsById = Object.fromEntries(systems.map(s => [s.id, s]))
  const capacityBySegment = Object.fromEntries(capacity.map(c => [c.segment_id, c]))

  const systemCounts = new Map<string, number>()
  for (const seg of nodeSegments) systemCounts.set(seg.system_id, (systemCounts.get(seg.system_id) ?? 0) + 1)

  const logoUrl = node?.owner ? OWNER_LOGOS[node.owner] : undefined

  const delta = 0.01
  const mapUrl = node
    ? `https://www.openstreetmap.org/export/embed.html?bbox=${node.lng - delta},${node.lat - delta},${node.lng + delta},${node.lat + delta}&layer=mapnik&marker=${node.lat},${node.lng}`
    : ''

  const body = (
    <div
      role="presentation"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 9000,
        background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={node ? `Node ${nodeLabel(node)}` : 'Node'}
        style={{
          background: t.bgPanel, border: `1px solid ${t.border}`, borderRadius: 12,
          width: 'min(1180px, 96vw)', maxHeight: '92vh', display: 'flex', flexDirection: 'column',
          boxShadow: '0 24px 64px rgba(0,0,0,0.5)', overflow: 'hidden',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        {/* ── Header ──────────────────────────────────────────────────── */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
          padding: '13px 16px', background: t.bgDeep, borderBottom: `1px solid ${t.border}`,
        }}>
          {stack.length > 0 && (
            <button
              onClick={goBack}
              title={`Back to ${nodeLabel(nodesById[stack[stack.length - 1]], stack[stack.length - 1])}`}
              style={iconBtn(t)}
            >← Back</button>
          )}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: t.text }}>
              {node ? nodeLabel(node) : current}
            </div>
            <div style={{ fontSize: 11, color: t.textFaint, marginTop: 2 }}>
              {node
                ? [TYPE_LABEL[node.type] ?? node.type, node.city, node.country].filter(Boolean).join(' · ')
                : 'Node not found in the loaded dataset'}
            </div>
          </div>
          <div style={{ flex: 1 }} />
          {logoUrl && (
            <div style={{ background: '#fff', borderRadius: 5, padding: '3px 7px', display: 'flex', alignItems: 'center', height: 32 }}>
              <img src={logoUrl} alt={node?.owner ?? ''} style={{ height: 22, maxWidth: 80, objectFit: 'contain' }} />
            </div>
          )}
          {/* Editing is admin-only; the button is hidden rather than disabled
              because a read-only viewer has nothing to gain from seeing it. */}
          {isAdmin && node && !editing && (
            <button onClick={startEdit} style={iconBtn(t, t.blue)}>✎ Edit node</button>
          )}
          <button onClick={onClose} title="Close" style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: t.textMuted, fontSize: 22, lineHeight: 1, padding: '0 2px',
          }}>×</button>
        </div>

        {!node ? (
          <div style={{ padding: 28, color: t.textMuted, fontSize: 13 }}>
            No node with id <strong style={{ color: t.text }}>{current}</strong> is loaded.
          </div>
        ) : (
          // Stacked sections rather than one auto-placed grid: a full-width
          // "span" item mixed into `repeat(auto-fit, …)` auto-placement made the
          // browser size the implicit rows off the wrong items, and the cards
          // overlapped each other. Each section owns its own row, so nothing
          // can be placed into a row it doesn't fit.
          <div style={{ overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* ── Row 1: identity and where the site is ────────────────── */}
            <div style={rowStyle}>
            <Card t={t} title={editing ? 'Edit Node' : 'Key Information'} grow>
              {editing && draft ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <Row t={t} label="ID">
                    <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, color: t.textMuted }}>
                      {node.id} <span style={{ color: t.textFaintest }}>(not editable)</span>
                    </span>
                  </Row>
                  <EditField t={t} label="Name *"      value={draft.name}           onChange={v => setDraft({ ...draft, name: v })} />
                  <EditField t={t} label="Country"     value={draft.country}        onChange={v => setDraft({ ...draft, country: v })} />
                  <SelectField t={t} label="Type"      value={draft.type}           options={TYPE_OPTS} onChange={v => setDraft({ ...draft, type: v as NodeType })} />
                  <SelectField t={t} label="On-Net"    value={draft.on_net}         options={ON_NET_OPTS} onChange={v => setDraft({ ...draft, on_net: v })} />
                  <EditField t={t} label="Latitude"    value={draft.lat}            onChange={v => setDraft({ ...draft, lat: v })} mono />
                  <EditField t={t} label="Longitude"   value={draft.lng}            onChange={v => setDraft({ ...draft, lng: v })} mono />
                  <EditField t={t} label="Owner"       value={draft.owner}          onChange={v => setDraft({ ...draft, owner: v })} />
                  <EditField t={t} label="Trading Name" value={draft.trading_name}  onChange={v => setDraft({ ...draft, trading_name: v })} />
                  <EditField t={t} label="City"        value={draft.city}           onChange={v => setDraft({ ...draft, city: v })} />
                  <EditField t={t} label="Address"     value={draft.street_address} onChange={v => setDraft({ ...draft, street_address: v })} />
                  <EditField t={t} label="Description" value={draft.description}    onChange={v => setDraft({ ...draft, description: v })} />

                  {error && <div style={{ fontSize: 11, color: t.red, lineHeight: 1.5 }}>⚠ {error}</div>}
                  <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
                    <button onClick={save} disabled={saving} style={{
                      flex: 1, padding: '8px 12px', borderRadius: 6, border: 'none', cursor: saving ? 'default' : 'pointer',
                      background: saving ? t.textFaintest : t.green, color: '#0b1f14',
                      fontSize: 12, fontWeight: 700, fontFamily: 'inherit',
                    }}>{saving ? 'Saving…' : 'Save changes'}</button>
                    <button onClick={() => { setEditing(false); setError(null) }} disabled={saving} style={iconBtn(t)}>Cancel</button>
                  </div>
                  <div style={{ fontSize: 10, color: t.textFaintest, lineHeight: 1.5 }}>
                    Saves immediately to the database — this is not staged like the Network Editor.
                  </div>
                </div>
              ) : (
                <div>
                  {([
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
                  ] as [string, string | undefined][]).filter(([, v]) => v).map(([label, value]) => (
                    <Row key={label} t={t} label={label}>
                      <span style={{ color: t.text, wordBreak: 'break-word' }}>{value}</span>
                    </Row>
                  ))}
                </div>
              )}
            </Card>

            <Card t={t} title="Site Location" pad={0} grow>
              <iframe
                key={node.id}
                src={mapUrl}
                style={{ width: '100%', height: 300, border: 'none', display: 'block' }}
                title={`Map of ${node.name}`}
              />
            </Card>
            </div>

            {/* ── Row 2: the fan-out, on a row of its own ──────────────────
                A busy CLS has a dozen-plus segments, and the spoke labels are
                what runs out of room first — so this gets the full width and
                the largest canvas that still fits the dialog. */}
            {/* Wrapped in a row even though it is alone: `grow` means
                `flex: 1 1 320px`, which sizes the HEIGHT when the parent is a
                flex column — the card collapsed and clipped the diagram. */}
            <div style={rowStyle}>
              <Card t={t} title={`Segments Leaving This Node (${nodeSegments.length})`} grow>
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  <SegmentFanDiagram
                    node={node}
                    segments={segments}
                    nodesById={nodesById}
                    onSelectNode={navigateTo}
                    size={620}
                  />
                </div>
              </Card>
            </div>

            {/* ── Row 3: products, systems ─────────────────────────────── */}
            <div style={rowStyle}>
            <Card t={t} title="Product Coverage" grow>
              {node.capabilities
                ? <ProductCoverageMatrix capabilities={node.capabilities} heading={null} />
                : <Empty t={t}>No product coverage configured for this node.</Empty>}
            </Card>

            <Card t={t} title={`Cable Systems (${systemCounts.size})`} grow>
              {systemCounts.size === 0 ? (
                <Empty t={t}>No systems at this node.</Empty>
              ) : (
                [...systemCounts.entries()]
                  .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
                  .map(([sysId, count]) => {
                    const sys = systemsById[sysId]
                    const planned = sys?.rfs_status === 'planned'
                    return (
                      <div key={sysId} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 12 }}>
                        <span style={{ color: t.text, flex: 1 }}>{sys?.name ?? sysId}</span>
                        {planned && (
                          <span style={{
                            fontSize: 9, fontWeight: 800, letterSpacing: '0.06em', padding: '1px 5px', borderRadius: 3,
                            color: t.orange, border: `1px solid ${t.orange}66`,
                          }}>RFS {sys?.rfs_quarter ?? 'PLANNED'}</span>
                        )}
                        <span style={{ color: t.textFaint, fontSize: 11 }}>{count} segment{count === 1 ? '' : 's'}</span>
                      </div>
                    )
                  })
              )}
            </Card>

            </div>

            {/* ── Row 4: capacity and notes ────────────────────────────── */}
            <div style={rowStyle}>
            <Card t={t} title="Segment Capacity" grow>
              {nodeSegments.length === 0 ? (
                <Empty t={t}>No segments at this node.</Empty>
              ) : (
                nodeSegments.map(seg => {
                  const cap = capacityBySegment[seg.id]
                  const far = seg.start_node_id === node.id ? seg.end_node_id : seg.start_node_id
                  const used = cap ? cap.total_capacity_t - cap.available_capacity_t : 0
                  const pct = cap && cap.total_capacity_t > 0 ? used / cap.total_capacity_t : 0
                  // Amber past 75% used, red past 90% — a node whose every exit
                  // is nearly full is the thing worth spotting here.
                  const barColor = utilisationColor(pct, t)
                  return (
                    <div key={seg.id} style={{ padding: '5px 0', borderBottom: `1px solid ${t.border}55` }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 11 }}>
                        <span style={{ color: t.text, flex: 1, wordBreak: 'break-word' }}>
                          → {nodeLabel(nodesById[far], far)}
                        </span>
                        <span style={{ color: t.textFaint, fontFamily: 'ui-monospace, monospace', whiteSpace: 'nowrap' }}>
                          {cap ? `${cap.available_capacity_t} / ${cap.total_capacity_t} T free` : 'no capacity record'}
                        </span>
                      </div>
                      {cap && cap.total_capacity_t > 0 && (
                        <div style={{ height: 3, borderRadius: 2, background: t.bgDeep, marginTop: 3, overflow: 'hidden' }}>
                          <div style={{ width: `${Math.round(pct * 100)}%`, height: '100%', background: barColor }} />
                        </div>
                      )}
                    </div>
                  )
                })
              )}
            </Card>

            <Card t={t} title={null} grow>
              <NodeNotesPanel nodeId={node.id} notes={notes} categories={noteCategories} />
            </Card>
            </div>
          </div>
        )}
      </div>
    </div>
  )

  return createPortal(body, document.body)
}

/** Amber past 75% used, red past 90% — a node whose every exit is nearly full
 *  is the thing worth spotting in the capacity list. */
function utilisationColor(pct: number, t: T): string {
  if (pct >= 0.9) return t.red
  if (pct >= 0.75) return t.orange
  return t.green
}

function onNetLabel(v: string | undefined): string | undefined {
  if (v === 'on_net') return 'On-Net'
  if (v === 'off_net') return 'Off-Net'
  return undefined
}

// ── Small presentational helpers ──────────────────────────────────────────
type T = ReturnType<typeof useTheme>

/** One row of cards: side by side when there's room, stacked on a phone. */
const rowStyle = { display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' } as const

/** Cards sit in `rowStyle` rows. `grow` lets a card take the slack in its row;
 *  a card without it is sized by its content (the fan diagram, which has a
 *  fixed square aspect and looks wrong stretched). */
function Card({ t, title, children, pad = 12, grow = false }: {
  t: T; title: string | null; children: React.ReactNode; pad?: number; grow?: boolean
}) {
  return (
    <div style={{
      background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 8, overflow: 'hidden',
      flex: grow ? '1 1 320px' : '0 0 auto', minWidth: 0,
    }}>
      {title && (
        <div style={{
          padding: '8px 12px', background: t.bgDeep, borderBottom: `1px solid ${t.border}`,
          fontSize: 10, fontWeight: 700, color: t.textFaint, textTransform: 'uppercase', letterSpacing: '0.06em',
        }}>{title}</div>
      )}
      <div style={{ padding: pad }}>{children}</div>
    </div>
  )
}

function Row({ t, label, children }: { t: T; label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 8, padding: '3px 0', fontSize: 12 }}>
      <span style={{ width: 108, flexShrink: 0, color: t.textFaint, fontWeight: 600 }}>{label}</span>
      {children}
    </div>
  )
}

function Empty({ t, children }: { t: T; children: React.ReactNode }) {
  return <div style={{ fontSize: 12, color: t.textFaintest, fontStyle: 'italic' }}>{children}</div>
}

function EditField({ t, label, value, onChange, mono = false }: {
  t: T; label: string; value: string; onChange: (v: string) => void; mono?: boolean
}) {
  return (
    <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12 }}>
      <span style={{ width: 108, flexShrink: 0, color: t.textFaint, fontWeight: 600 }}>{label}</span>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{ ...inputStyle(t), fontFamily: mono ? 'ui-monospace, monospace' : 'inherit' }}
      />
    </label>
  )
}

function SelectField({ t, label, value, options, onChange }: {
  t: T; label: string; value: string; options: [string, string][]; onChange: (v: string) => void
}) {
  return (
    <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12 }}>
      <span style={{ width: 108, flexShrink: 0, color: t.textFaint, fontWeight: 600 }}>{label}</span>
      <select value={value} onChange={e => onChange(e.target.value)} style={inputStyle(t)}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  )
}

function inputStyle(t: T) {
  return {
    flex: 1, minWidth: 0, padding: '5px 7px', borderRadius: 4,
    border: `1px solid ${t.border}`, background: t.bgInput, color: t.text,
    fontSize: 12, fontFamily: 'inherit',
  } as const
}

function iconBtn(t: T, color?: string) {
  return {
    padding: '6px 11px', borderRadius: 6, cursor: 'pointer',
    border: `1px solid ${color ?? t.border}`,
    background: color ? color + '18' : 'transparent',
    color: color ?? t.textMuted,
    fontSize: 12, fontWeight: 700, fontFamily: 'inherit', whiteSpace: 'nowrap',
  } as const
}
