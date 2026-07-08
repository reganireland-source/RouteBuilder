/**
 * SolutionNotesOverlay — full-screen modal showing engineering notes attached to a route.
 *
 * Given one computed Route (an ordered walk of nodes and segments), this overlay fetches
 * all solution notes and note categories from the backend, keeps only the notes whose
 * node_id or segment_id lies on this route, and displays them two ways:
 *   - Left column (desktop only): a vertical "metro map" of the route where each node dot
 *     and segment bar is coloured by the worst note severity present (info / warning /
 *     critical) and badged with its note count.
 *   - Right column: the route in order, one section per node/segment, with the note cards
 *     underneath (severity badge, category label, title, collapsible long text) and an
 *     optional "+ Add Note" button per item when the onAddNote callback is supplied.
 *
 * Props:
 *   - route:     the Route whose nodes/segments scope the notes.
 *   - nodesById: minimal node lookup ({name, type}) for labels and branching-unit styling.
 *   - onClose:   dismiss handler (backdrop click or ✕ button).
 *   - onAddNote: optional (kind: 'node'|'segment', id) => opens the note-creation UI.
 *
 * Mounted from: RouteList.tsx (per-route "notes" action on a search result / pinned route);
 * rendered through createPortal into document.body at z-index 9000. Switches to a
 * full-viewport layout (metro map hidden) below 768 px.
 * Backend endpoints: GET /api/solution-notes and GET /api/note-categories on mount.
 */
import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { Route, SolutionNote, NoteCategory } from '../types'
import { useTheme } from '../theme'
import { api } from '../api/client'

const TEXT_COLLAPSE_THRESHOLD = 160

const SEVERITY_CFG = {
  info:     { label: 'Info',     color: '#89b4fa' },
  warning:  { label: 'Warning',  color: '#fab387' },
  critical: { label: 'Critical', color: '#f38ba8' },
} as const

function SeverityBadge({ severity }: { severity: string }) {
  const cfg = SEVERITY_CFG[severity as keyof typeof SEVERITY_CFG] ?? SEVERITY_CFG.info
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
      letterSpacing: '0.05em', textTransform: 'uppercase',
      background: cfg.color + '22', color: cfg.color,
      border: `1px solid ${cfg.color}55`, whiteSpace: 'nowrap', flexShrink: 0,
    }}>
      {cfg.label}
    </span>
  )
}

function NoteCard({ note, categoryLabel }: { note: SolutionNote; categoryLabel: string }) {
  const t = useTheme()
  const cfg = SEVERITY_CFG[note.severity as keyof typeof SEVERITY_CFG] ?? SEVERITY_CFG.info
  const isLong = note.text.length > TEXT_COLLAPSE_THRESHOLD
  const [expanded, setExpanded] = useState(false)
  const displayText = isLong && !expanded ? note.text.slice(0, TEXT_COLLAPSE_THRESHOLD) + '…' : note.text
  return (
    <div style={{
      marginBottom: 8, padding: '8px 10px', borderRadius: 5,
      border: `1px solid ${cfg.color}44`,
      background: cfg.color + '0a',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
        <SeverityBadge severity={note.severity} />
        <span style={{ fontSize: 10, color: t.textFaint, background: t.bgDeep, padding: '1px 5px', borderRadius: 3 }}>
          {categoryLabel}
        </span>
        {note.created_at && (
          <span style={{ fontSize: 9, color: t.textFaintest, marginLeft: 'auto' }}>{note.created_at}</span>
        )}
      </div>
      <div style={{ fontSize: 12, fontWeight: 600, color: t.text, marginBottom: 3 }}>{note.title}</div>
      <div style={{ fontSize: 11, color: t.textMuted, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{displayText}</div>
      {isLong && (
        <button
          onClick={() => setExpanded(v => !v)}
          style={{
            marginTop: 4, background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 10, color: t.blue, padding: 0,
          }}
        >
          {expanded ? '▲ Show less' : '▼ Show more'}
        </button>
      )}
    </div>
  )
}

// Metro-map side — adapted from PairBreakdown
function RouteMetroMap({ route, nodesById, notesByNode, notesBySegment }: {
  route: Route
  nodesById: Record<string, { name?: string; type?: string }>
  notesByNode: Record<string, SolutionNote[]>
  notesBySegment: Record<string, SolutionNote[]>
}) {
  const t = useTheme()

  function noteIndicator(notes: SolutionNote[]) {
    if (!notes.length) return null
    const worst = notes.some(n => n.severity === 'critical') ? 'critical'
      : notes.some(n => n.severity === 'warning') ? 'warning' : 'info'
    const color = SEVERITY_CFG[worst].color
    return (
      <span style={{
        fontSize: 9, fontWeight: 700, padding: '1px 4px', borderRadius: 3,
        background: color + '33', color, border: `1px solid ${color}55`,
        marginLeft: 4,
      }}>
        {notes.length}
      </span>
    )
  }

  return (
    <div style={{ paddingBottom: 8 }}>
      {route.nodes.map((nodeId, i) => {
        const seg = route.segments[i]
        const node = nodesById[nodeId]
        const isBU = node?.type === 'branching_unit'
        const nodeNotes = notesByNode[nodeId] ?? []
        const hasNodeNotes = nodeNotes.length > 0
        const dotSize = isBU ? 8 : 12
        const dotMarginLeft = isBU ? 2 : 0
        const nodeColor = hasNodeNotes
          ? (nodeNotes.some(n => n.severity === 'critical') ? SEVERITY_CFG.critical.color
            : nodeNotes.some(n => n.severity === 'warning') ? SEVERITY_CFG.warning.color
            : SEVERITY_CFG.info.color)
          : t.blue

        const segNotes = seg ? (notesBySegment[seg.segment_id] ?? []) : []
        const hasSegNotes = segNotes.length > 0
        const segColor = hasSegNotes
          ? (segNotes.some(n => n.severity === 'critical') ? SEVERITY_CFG.critical.color
            : segNotes.some(n => n.severity === 'warning') ? SEVERITY_CFG.warning.color
            : SEVERITY_CFG.info.color)
          : t.border

        return (
          <div key={`${nodeId}-${i}`}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{
                width: dotSize, height: dotSize, borderRadius: '50%',
                background: hasNodeNotes ? nodeColor + '33' : t.bgDeep,
                border: `2px solid ${nodeColor}`,
                flexShrink: 0, marginLeft: dotMarginLeft,
              }} />
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap' }}>
                  {isBU ? (
                    <span style={{ fontSize: 9, color: t.textFaint, fontFamily: 'monospace' }}>◈ {nodeId}</span>
                  ) : (
                    <>
                      <span style={{ fontSize: 11, fontWeight: 700, color: nodeColor, fontFamily: 'monospace' }}>{nodeId}</span>
                      {node?.name && node.name !== nodeId && (
                        <span style={{ fontSize: 9, color: t.textMuted, marginLeft: 4 }}>{node.name}</span>
                      )}
                    </>
                  )}
                  {noteIndicator(nodeNotes)}
                </div>
              </div>
            </div>

            {seg && (
              <div style={{ display: 'flex', alignItems: 'stretch', margin: '2px 0' }}>
                <div style={{ width: 2, flexShrink: 0, background: segColor, marginLeft: 5, borderRadius: 1 }} />
                <div style={{
                  flex: 1, marginLeft: 10, marginTop: 3, marginBottom: 3,
                  padding: '4px 7px', borderRadius: 4,
                  border: `1px solid ${hasSegNotes ? segColor : t.border}`,
                  background: hasSegNotes ? segColor + '14' : t.bgCard,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: seg.type === 'wet' ? t.blue : t.green }}>
                      {seg.system_id}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      {noteIndicator(segNotes)}
                      <span style={{ fontSize: 9, color: t.textFaint, textTransform: 'uppercase' }}>{seg.type}</span>
                    </div>
                  </div>
                  <div style={{ fontSize: 9, color: t.textFaintest, fontFamily: 'monospace' }}>{seg.segment_id}</div>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

interface Props {
  route: Route
  nodesById: Record<string, { name?: string; type?: string }>
  onClose: () => void
  onAddNote?: (kind: 'node' | 'segment', id: string) => void
}

export function SolutionNotesOverlay({ route, nodesById, onClose, onAddNote }: Props) {
  const t = useTheme()
  const [notes, setNotes] = useState<SolutionNote[]>([])
  const [categories, setCategories] = useState<NoteCategory[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([api.getSolutionNotes(), api.getNoteCategories()])
      .then(([n, c]) => { setNotes(n); setCategories(c) })
      .finally(() => setLoading(false))
  }, [])

  const categoryById = Object.fromEntries(categories.map(c => [c.id, c]))

  // Collect all node/segment IDs on this route
  const routeNodeIds = new Set(route.nodes)
  const routeSegIds = new Set(route.segments.map(s => s.segment_id))

  const notesByNode: Record<string, SolutionNote[]> = {}
  const notesBySegment: Record<string, SolutionNote[]> = {}
  for (const n of notes) {
    if (n.node_id && routeNodeIds.has(n.node_id)) {
      ;(notesByNode[n.node_id] ??= []).push(n)
    }
    if (n.segment_id && routeSegIds.has(n.segment_id)) {
      ;(notesBySegment[n.segment_id] ??= []).push(n)
    }
  }

  const totalNotes = Object.values(notesByNode).flat().length + Object.values(notesBySegment).flat().length

  // Build the ordered notes list (route sequence)
  const orderedItems: { type: 'node' | 'segment'; id: string; name: string; notes: SolutionNote[] }[] = []
  route.nodes.forEach((nodeId, i) => {
    const nodeNotes = notesByNode[nodeId] ?? []
    const node = nodesById[nodeId]
    orderedItems.push({
      type: 'node', id: nodeId,
      name: node ? (node.name !== nodeId ? `${nodeId} — ${node.name}` : nodeId) : nodeId,
      notes: nodeNotes,
    })
    const seg = route.segments[i]
    if (seg) {
      const segNotes = notesBySegment[seg.segment_id] ?? []
      orderedItems.push({
        type: 'segment', id: seg.segment_id,
        name: `${seg.system_id} (${seg.segment_id})`,
        notes: segNotes,
      })
    }
  })
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768

  const overlay = (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9000,
      background: 'rgba(0,0,0,0.75)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'system-ui, sans-serif',
    }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        width: isMobile ? '100vw' : '92vw',
        height: isMobile ? '100dvh' : '90vh',
        background: t.bgPanel,
        borderRadius: isMobile ? 0 : 10,
        border: `1px solid ${t.border}`,
        boxShadow: '0 16px 64px rgba(0,0,0,0.6)',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '12px 16px', borderBottom: `1px solid ${t.border}`,
          background: t.bgDeep, flexShrink: 0,
        }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: t.text, flex: 1 }}>
            Solution Notes
          </span>
          {!loading && (
            <span style={{ fontSize: 11, color: t.textFaint }}>
              {totalNotes} note{totalNotes !== 1 ? 's' : ''} on this route
            </span>
          )}
          <button
            onClick={onClose}
            style={{
              background: 'none', border: `1px solid ${t.border}`, borderRadius: 4,
              color: t.textMuted, cursor: 'pointer', fontSize: 14,
              padding: '2px 10px', lineHeight: 1.4,
            }}
          >✕ Close</button>
        </div>

        {loading ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: t.textFaint }}>
            Loading notes…
          </div>
        ) : (
          <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

            {/* LHS: Metro map */}
            {!isMobile && (
              <div style={{
                width: 300, flexShrink: 0,
                borderRight: `1px solid ${t.border}`,
                overflowY: 'auto', padding: '16px 14px',
              }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: t.textFaint, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 12 }}>
                  Route Map
                </div>
                <RouteMetroMap
                  route={route}
                  nodesById={nodesById}
                  notesByNode={notesByNode}
                  notesBySegment={notesBySegment}
                />
              </div>
            )}

            {/* RHS: Notes panel */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: t.textFaint, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 14 }}>
                Route Order
                {totalNotes > 0 && (
                  <span style={{ fontWeight: 400, textTransform: 'none', marginLeft: 8 }}>
                    — {totalNotes} note{totalNotes !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
              {orderedItems.map(item => (
                <div key={`${item.type}-${item.id}`} style={{ marginBottom: item.notes.length ? 20 : 10 }}>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    marginBottom: item.notes.length ? 8 : 2,
                    paddingBottom: 5, borderBottom: `1px solid ${t.border}`,
                  }}>
                    <span style={{
                      fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
                      letterSpacing: '0.05em', textTransform: 'uppercase',
                      background: item.type === 'node' ? t.blue + '22' : t.green + '22',
                      color: item.type === 'node' ? t.blue : t.green,
                    }}>
                      {item.type === 'node' ? 'Node' : 'Segment'}
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: t.text, fontFamily: 'monospace', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.name}
                    </span>
                    {onAddNote && (
                      <button
                        onClick={() => onAddNote(item.type, item.id)}
                        title={`Add note to this ${item.type}`}
                        style={{
                          background: 'none', border: `1px solid ${t.border}`, borderRadius: 3,
                          color: t.textFaint, cursor: 'pointer', fontSize: 11,
                          padding: '1px 6px', lineHeight: 1.4, flexShrink: 0,
                        }}
                      >+ Add Note</button>
                    )}
                  </div>
                  {item.notes.map(note => (
                    <NoteCard
                      key={note.id}
                      note={note}
                      categoryLabel={categoryById[note.category_id]?.label ?? note.category_id}
                    />
                  ))}
                </div>
              ))}
            </div>

          </div>
        )}
      </div>
    </div>
  )

  return createPortal(overlay, document.body)
}
