/**
 * NodeNotesPanel — read-only list of the solution notes attached to a single node.
 *
 * A solution note is an engineering/commercial annotation pinned to a node or a segment
 * ("permit required at this CLS", "power constrained until Q3"). This panel shows only
 * the NODE notes for one node id, grouped under their NoteCategory label, with the
 * categories in their configured `order` and the notes inside each group ordered by
 * severity (critical → warning → info) then newest first. Nothing here edits anything:
 * creating/editing/deleting notes lives in RefDataModal.tsx's Solution Notes section.
 *
 * The one non-obvious fact: the backend has NO per-node filter for notes. Both
 * api.getSolutionNotes() and api.getNoteCategories() take no arguments and return the
 * entire table, so the "notes for this node" narrowing is done client-side here with
 * `n.node_id === nodeId`. That is also why the caller is allowed to pass `notes` and
 * `categories` in as props: when the user is jumping between nodes in the Full View, a
 * parent that already holds the full lists should hand them down rather than make this
 * panel refetch every table on every node change. When those props are omitted the
 * panel falls back to fetching for itself (on mount and whenever nodeId changes) and
 * owns its own loading and error states.
 *
 * Colour convention: categories deliberately carry no colour and no icon — only a label
 * — so every colour in the notes UI comes from SEVERITY. The severity → theme-colour map
 * and the badge styling below mirror RefDataModal.tsx's SEVERITY_COLORS / SeverityBadge
 * so the two screens read as the same feature. All colours come from useTheme(), so the
 * panel is legible in the dark, dusk and light palettes alike.
 *
 * Props:
 *   - nodeId:     the node whose notes to show.
 *   - notes:      optional pre-fetched notes (ALL of them — filtering happens here).
 *   - categories: optional pre-fetched categories.
 *
 * Mounted from: NodeFullView.tsx (the node "Full View" modal).
 * Backend endpoints: GET /api/solution-notes and GET /api/note-categories, but only
 * when the caller did not supply the data.
 */
import { useEffect, useState } from 'react'
import type { SolutionNote, NoteCategory, NoteSeverity } from '../types'
import { useTheme } from '../theme'
import { api } from '../api/client'

interface Props {
  nodeId: string
  /** Optional pre-fetched data; when omitted the panel fetches its own. */
  notes?: SolutionNote[]
  categories?: NoteCategory[]
}

/** Lower number = more urgent, so a plain ascending sort puts critical at the top. */
const SEVERITY_RANK: Record<NoteSeverity, number> = { critical: 0, warning: 1, info: 2 }

/** Id used for the synthetic trailing group holding notes with an unknown category_id. */
const UNCATEGORISED_ID = '__uncategorised__'

/**
 * created_at is an optional ISO-ish string from the backend. Parse defensively: a note
 * saved before the column existed, or any value Date can't read, should still render
 * (we fall back to showing the raw string) rather than printing "Invalid Date".
 */
function formatDate(raw: string): string {
  const d = new Date(raw)
  if (isNaN(d.getTime())) return raw
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

/** Sort key for the created_at tie-break; missing dates sort last (treated as oldest). */
function createdAtMillis(note: SolutionNote): number {
  if (!note.created_at) return -Infinity
  const ms = new Date(note.created_at).getTime()
  return isNaN(ms) ? -Infinity : ms
}

/**
 * One settled self-fetch, stamped with the node it was started for.
 *
 * Holding the result as a single stamped value is what lets "loading" be DERIVED
 * (`result.for !== nodeId` — we have nothing for the node on screen yet) instead of
 * mirrored in its own state. Mirroring it meant flipping setLoading(true) synchronously
 * in the effect body on every node change, which is exactly the cascading-render pattern
 * React's set-state-in-effect rule warns about; now the effect's only job is to start the
 * request and hand the answer back from the promise callbacks.
 */
interface FetchResult {
  /** The nodeId this fetch was started for. */
  for: string
  notes: SolutionNote[]
  cats: NoteCategory[]
  error: string | null
}

export function NodeNotesPanel(props: Props) {
  const { nodeId } = props
  const t = useTheme()

  // Only used on the self-fetching path; when the caller supplies data this stays null
  // and is never read, which keeps the "controlled" path free of any fetch flicker.
  const [result, setResult] = useState<FetchResult | null>(null)

  // `notes` is the switch for self-fetching: if the parent gave us notes we never call
  // the API, even if it left categories out (an un-resolvable category just lands the
  // note in the Uncategorised group, which is a better outcome than a surprise refetch).
  const selfFetch = props.notes === undefined

  useEffect(() => {
    if (!selfFetch) return
    // Guard against an out-of-order response overwriting a newer node's data: the user
    // can change node faster than the two requests resolve.
    let cancelled = false
    Promise.all([api.getSolutionNotes(), api.getNoteCategories()])
      .then(([n, c]) => { if (!cancelled) setResult({ for: nodeId, notes: n, cats: c, error: null }) })
      .catch(e => { if (!cancelled) setResult({ for: nodeId, notes: [], cats: [], error: String(e) }) })
    return () => { cancelled = true }
    // nodeId is a dependency because the parent may keep this panel mounted and only
    // swap the node; re-fetching then keeps a long-lived Full View from going stale.
  }, [selfFetch, nodeId])

  // Anything stamped with a different node is last node's answer, so it counts as "not
  // arrived yet" — the same instant the old code showed its spinner for.
  const settled = result?.for === nodeId ? result : null
  const loading = selfFetch && settled === null
  const error = settled?.error ?? null

  const allNotes = props.notes ?? settled?.notes ?? []
  const allCats  = props.categories ?? settled?.cats ?? []

  // The whole point of the client-side filter noted in the file header.
  const nodeNotes = allNotes.filter(n => n.node_id === nodeId)

  // Category order is authoritative for group order; only categories that apply to
  // nodes can legitimately own a node note, so segment categories are ignored here.
  const nodeCats = allCats
    .filter(c => c.applies_to === 'node')
    .sort((a, b) => a.order - b.order)

  const knownCatIds = new Set(nodeCats.map(c => c.id))

  // Build the groups in display order, then drop the empty ones. Notes pointing at a
  // category we don't know about (deleted category, or one flagged 'segment') must not
  // silently vanish, so they collect in a trailing Uncategorised bucket.
  const groups: { id: string; label: string; notes: SolutionNote[] }[] = [
    ...nodeCats.map(c => ({
      id: c.id,
      label: c.label,
      notes: nodeNotes.filter(n => n.category_id === c.id),
    })),
    {
      id: UNCATEGORISED_ID,
      label: 'Uncategorised',
      notes: nodeNotes.filter(n => !knownCatIds.has(n.category_id)),
    },
  ]
    .filter(g => g.notes.length > 0)
    .map(g => ({
      ...g,
      notes: [...g.notes].sort(
        (a, b) =>
          (SEVERITY_RANK[a.severity] ?? 99) - (SEVERITY_RANK[b.severity] ?? 99) ||
          createdAtMillis(b) - createdAtMillis(a),
      ),
    }))

  const severityColor = (sev: NoteSeverity | string): string =>
    ({ info: t.blue, warning: t.orange, critical: t.red } as Record<string, string>)[sev] ?? t.blue

  const header = (
    <div style={{
      fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
      color: t.textMuted, marginBottom: 8,
    }}>
      Solution Notes ({nodeNotes.length})
    </div>
  )

  if (loading) {
    return (
      <div>
        {header}
        <div style={{ fontSize: 12, color: t.textFaint, padding: '6px 0' }}>Loading notes…</div>
      </div>
    )
  }

  if (error) {
    return (
      <div>
        {header}
        <div style={{ fontSize: 12, color: t.red, padding: '6px 0' }}>
          Could not load solution notes: {error}
        </div>
      </div>
    )
  }

  // A node with no notes is the normal case, not a failure — keep it muted and quiet.
  if (nodeNotes.length === 0) {
    return (
      <div>
        {header}
        <div style={{ fontSize: 12, color: t.textFaint, fontStyle: 'italic', padding: '6px 0' }}>
          No notes recorded for this node.
        </div>
      </div>
    )
  }

  return (
    <div>
      {header}
      {/* maxHeight + auto overflow only bites once the list is long; a short list still
          collapses to its natural height so it doesn't leave dead space in the modal. */}
      <div style={{ maxHeight: 340, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {groups.map(group => (
          <div key={group.id}>
            <div style={{
              fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
              color: t.textFaint, marginBottom: 5,
            }}>
              {group.label}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {group.notes.map(note => {
                const color = severityColor(note.severity)
                return (
                  <div
                    key={note.id}
                    style={{
                      background: t.bgCard,
                      border: `1px solid ${t.border}`,
                      // Severity stripe: the single strongest colour cue on the card.
                      borderLeft: `3px solid ${color}`,
                      borderRadius: 4,
                      padding: '7px 9px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      {/* Badge styling copied from RefDataModal.tsx's SeverityBadge so the
                          two solution-note surfaces stay visually identical. */}
                      <span style={{
                        fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
                        letterSpacing: '0.05em', textTransform: 'uppercase',
                        background: color + '22', color, border: `1px solid ${color}55`,
                        whiteSpace: 'nowrap',
                      }}>
                        {note.severity}
                      </span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: t.text }}>
                        {note.title}
                      </span>
                      {note.created_at && (
                        <span style={{ fontSize: 10, color: t.textFaint, marginLeft: 'auto' }}>
                          {formatDate(note.created_at)}
                        </span>
                      )}
                    </div>
                    {note.text && (
                      // User-entered free text: rendered as a text child so React escapes
                      // it. Never dangerouslySetInnerHTML here. whiteSpace preserves the
                      // author's line breaks without letting long words break the layout.
                      <div style={{
                        fontSize: 11, color: t.textMuted, marginTop: 4, lineHeight: 1.45,
                        whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
                      }}>
                        {note.text}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
