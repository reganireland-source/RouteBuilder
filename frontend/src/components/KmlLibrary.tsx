/**
 * KmlLibrary — what route geometry we hold, what we do not, and how to undo
 * an upload (or sync) that turned out to be wrong.
 *
 * IT OPENS ON COVERAGE, NOT ON CONTENT. A library that lists 218 attached files
 * and says nothing about the 104 segments still drawn from waypoints invites
 * exactly the wrong reading — that the network is surveyed. The header states
 * all three numbers together and the Gaps tab is a first-class view, not a
 * footnote, because "which cables are still approximations" is the question a
 * library like this is usually being opened to answer.
 *
 * NOT EVERY LINKED SEGMENT IS SURVEYED — the Linked tab's Source column says
 * which of "uploaded" (potentially a real carrier survey) or "synced" (a
 * simplified public trace from submarinecablemap.com) each one is. See
 * types.ts's KmlSource and SegmentKmlCard.tsx.
 *
 * NOTHING IS EVER OVERWRITTEN, so every upload is recoverable. Re-uploading a
 * segment adds a version and makes it active; the previous one stays, and one
 * click puts it back. That is the whole reason the version history is here
 * rather than an admin-only afterthought: the failure this feature can produce
 * is attaching the wrong route, and the fix has to be as cheap as the mistake.
 *
 * FOUR VIEWS:
 *   Linked   segments with a surveyed route, and the surveyed-vs-stored length
 *            comparison that turns every upload into a check on a number that
 *            was previously unfalsifiable.
 *   Gaps     segments still drawn from waypoints, worst first (no waypoints at
 *            all is worse than several).
 *   Orphans  versions whose segment no longer exists — renamed or deleted after
 *            the KML was attached. Surfaced rather than silently ignored.
 *   Unused   uploaded blobs no version points at, left behind by abandoned
 *            reviews. Listed, never swept automatically.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type {
  KmlLibrary as KmlLibraryData, KmlLibraryGap, KmlLibraryLinked,
  KmlPreviewLine, KmlUnusedFiles, KmlVersion,
} from '../types'
import { useTheme, type Theme } from '../theme'
import { useAuth } from '../context/AuthContext'
import { api } from '../api/client'
import { ConfirmDialog } from './ConfirmDialog'
import { PREVIEW_COLORS } from './KmlPreviewLayer'

interface Props {
  onClose: () => void
  /** Refetch hook so the map picks up a rollback or a deletion. */
  onDataChange?: () => void
  /** Draw a segment's surveyed route on the real map. [] clears it. */
  onPreview?: (lines: KmlPreviewLine[]) => void
}

/** Above the modal stack, below ConfirmDialog (12500). */
const Z = 11500

type Tab = 'linked' | 'gaps' | 'orphans' | 'unused'

/** How far the surveyed length may differ from the stored one before it is
 *  worth arguing about. Matches SegmentKmlCard, so the two cannot disagree. */
const LENGTH_WARN_PCT = 15
/** Beyond this an endpoint is called out as possibly the wrong file. */
const ENDPOINT_WARN_KM = 10

/** Both halves of the library in one round trip. */
function fetchAll(): Promise<[KmlLibraryData, KmlUnusedFiles]> {
  return Promise.all([api.getKmlLibrary(), api.getKmlUnusedFiles()])
}

const cell: React.CSSProperties = { padding: '6px 8px', fontSize: 11, verticalAlign: 'top' }

function headCell(t: Theme): React.CSSProperties {
  return {
    ...cell, fontSize: 9, fontWeight: 700, letterSpacing: '0.05em',
    textTransform: 'uppercase', color: t.textMuted, textAlign: 'left',
    position: 'sticky', top: 0, background: t.bgDeep, zIndex: 1,
  }
}

function tabButton(active: boolean, t: Theme): React.CSSProperties {
  return {
    padding: '6px 12px', borderRadius: 6, fontSize: 11, fontFamily: 'inherit',
    fontWeight: active ? 700 : 500, cursor: 'pointer',
    border: `1px solid ${active ? t.blue : t.border}`,
    background: active ? t.blue + '22' : 'transparent',
    color: active ? t.blue : t.textMuted,
  }
}

function smallButton(t: Theme, tone: 'plain' | 'danger' = 'plain'): React.CSSProperties {
  const c = tone === 'danger' ? t.red : t.textMuted
  return {
    padding: '3px 8px', borderRadius: 4, fontSize: 10, fontFamily: 'inherit',
    whiteSpace: 'nowrap', cursor: 'pointer',
    border: `1px solid ${tone === 'danger' ? t.red + '66' : t.border}`,
    background: 'transparent', color: c,
  }
}

function pct(kml: number | null, stored: number): number | null {
  if (kml == null || !stored) return null
  return ((kml - stored) / stored) * 100
}

function bytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1048576).toFixed(1)} MB`
}

/** Date without the seconds and timezone noise; the day is what matters here. */
function day(iso: string | null): string {
  return iso ? iso.slice(0, 10) : '—'
}

/** Segment ids for the bulk-delete confirm dialog — every one for a small
 *  selection, truncated for a large one so the dialog stays readable rather
 *  than turning into a scrollable wall of ids. */
function listSelected(ids: Set<string>, max = 8): string {
  const all = [...ids]
  if (all.length <= max) return all.join(', ')
  return `${all.slice(0, max).join(', ')}, +${all.length - max} more`
}

/** One linked segment, expandable into its full version history. */
function LinkedRow({
  row, t, expanded, versions, busy, isAdmin, selected, onToggle, onToggleSelect, onPreview, onActivate, onDelete,
}: {
  row: KmlLibraryLinked
  t: Theme
  expanded: boolean
  versions: KmlVersion[] | undefined
  busy: boolean
  isAdmin: boolean
  selected: boolean
  onToggle: () => void
  onToggleSelect: () => void
  onPreview: () => void
  onActivate: (linkId: string) => void
  onDelete: (linkId: string) => void
}) {
  const delta = pct(row.kml_length_km, row.stored_length_km)
  const deltaLarge = delta != null && Math.abs(delta) > LENGTH_WARN_PCT
  const gap = Math.max(row.a_end_gap_km ?? 0, row.z_end_gap_km ?? 0)

  return (
    <>
      <tr style={{ borderBottom: `1px solid ${t.border}`, background: selected ? t.blue + '0c' : 'transparent' }}>
        {isAdmin && (
          <td style={cell}>
            <input type="checkbox" checked={selected} onChange={onToggleSelect} title="Select for bulk delete" />
          </td>
        )}
        <td style={cell}>
          <button onClick={onToggle} style={{ ...smallButton(t), width: 22 }} title="Version history">
            {expanded ? '▾' : '▸'}
          </button>
        </td>
        <td style={cell}>
          <div style={{ color: t.text }}>{row.segment_id}</div>
          <div style={{ color: t.textFaint, fontSize: 10 }}>{row.name}</div>
        </td>
        <td style={cell}>{row.system_id}</td>
        <td style={cell}>
          <span style={{
            fontSize: 9, fontWeight: 700, letterSpacing: '0.03em', padding: '2px 6px', borderRadius: 4,
            border: `1px solid ${row.source === 'submarinecablemap' ? t.blue : t.green}`,
            color: row.source === 'submarinecablemap' ? t.blue : t.green,
            background: (row.source === 'submarinecablemap' ? t.blue : t.green) + '14',
            whiteSpace: 'nowrap',
          }}>
            {row.source === 'submarinecablemap' ? 'SYNCED' : 'UPLOADED'}
          </span>
        </td>
        <td style={cell}>v{row.version}</td>
        <td style={cell}>{row.point_count.toLocaleString()}</td>
        <td style={cell}>
          {row.kml_length_km != null ? `${row.kml_length_km.toLocaleString()} km` : '—'}
          {delta != null && (
            <div style={{ fontSize: 10, color: deltaLarge ? t.orange : t.textFaint }}>
              {delta >= 0 ? '+' : ''}{delta.toFixed(1)}% vs {row.stored_length_km.toLocaleString()} stored
            </div>
          )}
        </td>
        <td style={cell}>
          <span style={{ color: gap > ENDPOINT_WARN_KM ? t.orange : t.textMuted }}>
            {row.a_end_gap_km?.toFixed(1) ?? '?'} / {row.z_end_gap_km?.toFixed(1) ?? '?'} km
          </span>
        </td>
        <td style={cell}>{day(row.created_at)}</td>
        <td style={cell}>
          <div style={{ display: 'flex', gap: 4 }}>
            <button onClick={onPreview} style={smallButton(t)} title="Draw this route on the map">◎ Map</button>
            <a href={api.kmlDownloadUrl(row.link_id)} style={{ ...smallButton(t), textDecoration: 'none' }}>⬇</a>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr style={{ borderBottom: `1px solid ${t.border}`, background: t.bgDeep }}>
          <td colSpan={isAdmin ? 11 : 10} style={{ padding: '8px 14px' }}>
            {versions === undefined ? (
              <div style={{ fontSize: 11, color: t.textFaint }}>Loading history…</div>
            ) : (
              <>
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: t.textMuted, marginBottom: 5 }}>
                  Version history — nothing is overwritten, so any of these can be put back
                </div>
                {versions.map(v => (
                  <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '3px 0', fontSize: 11 }}>
                    <span style={{ width: 40, fontWeight: v.active ? 700 : 400, color: v.active ? t.green : t.textMuted }}>
                      v{v.version}
                    </span>
                    {v.active
                      ? <span style={{ fontSize: 9, fontWeight: 700, color: t.green, border: `1px solid ${t.green}`, borderRadius: 3, padding: '1px 5px' }}>ACTIVE</span>
                      : <span style={{ width: 52 }} />}
                    <span style={{ color: t.textMuted, minWidth: 150 }}>{v.filename}</span>
                    <span style={{ color: t.textFaint }}>{bytes(v.size_bytes)}</span>
                    <span style={{ color: t.textFaint }}>{v.point_count.toLocaleString()} pts</span>
                    <span style={{ color: t.textFaint }}>
                      {v.length_km != null ? `${v.length_km.toLocaleString()} km` : '—'}
                    </span>
                    <span style={{ color: t.textFaint }}>{day(v.created_at)}</span>
                    {v.created_by && <span style={{ color: t.textFaint }}>{v.created_by}</span>}
                    <div style={{ flex: 1 }} />
                    <a href={api.kmlDownloadUrl(v.id)} style={{ ...smallButton(t), textDecoration: 'none' }}>⬇ Original</a>
                    {isAdmin && !v.active && (
                      <button onClick={() => onActivate(v.id)} disabled={busy} style={smallButton(t)}>
                        ↩ Make active
                      </button>
                    )}
                    {isAdmin && (
                      <button onClick={() => onDelete(v.id)} disabled={busy} style={smallButton(t, 'danger')}>
                        Delete
                      </button>
                    )}
                  </div>
                ))}
              </>
            )}
          </td>
        </tr>
      )}
    </>
  )
}

/** Segments still drawn from waypoints, worst first. */
function GapsTable({ gaps, t }: { gaps: KmlLibraryGap[]; t: Theme }) {
  // No waypoints at all means the map is drawing a straight line between two
  // landing stations, which is the least true thing it can draw — so those sort
  // to the top rather than being buried alphabetically.
  const sorted = useMemo(
    () => [...gaps].sort((a, b) => a.waypoint_count - b.waypoint_count || a.segment_id.localeCompare(b.segment_id)),
    [gaps],
  )
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          <th style={headCell(t)}>Segment</th>
          <th style={headCell(t)}>System</th>
          <th style={headCell(t)}>Type</th>
          <th style={headCell(t)}>Drawn from</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map(g => (
          <tr key={g.segment_id} style={{ borderBottom: `1px solid ${t.border}` }}>
            <td style={cell}>
              <div style={{ color: t.text }}>{g.segment_id}</div>
              <div style={{ color: t.textFaint, fontSize: 10 }}>{g.name}</div>
            </td>
            <td style={cell}>{g.system_id}</td>
            <td style={cell}>{g.type}</td>
            <td style={cell}>
              {g.waypoint_count === 0
                ? <span style={{ color: t.orange }}>a straight line between its nodes</span>
                : <span style={{ color: t.textMuted }}>{g.waypoint_count} hand-placed waypoint{g.waypoint_count === 1 ? '' : 's'}</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function KmlLibrary({ onClose, onDataChange, onPreview }: Props) {
  const t = useTheme()
  const { isAdmin } = useAuth()
  const [tab, setTab] = useState<Tab>('linked')
  const [data, setData] = useState<KmlLibraryData | null>(null)
  const [unused, setUnused] = useState<KmlUnusedFiles | null>(null)
  const [filter, setFilter] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [versions, setVersions] = useState<Record<string, KmlVersion[]>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmClearAll, setConfirmClearAll] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false)

  // Applying a fetched result is one function, used by the mount effect and by
  // every action that changes something. The error is cleared on actual success
  // rather than on merely attempting, so a failure stays on screen until
  // something works.
  const apply = useCallback((lib: KmlLibraryData, un: KmlUnusedFiles) => {
    setData(lib)
    setUnused(un)
    setVersions({})            // stale after any change
    setSelected(new Set())     // a deleted/renamed segment can't stay selected
    setError(null)
  }, [])

  const reload = useCallback(async () => {
    try {
      const [lib, un] = await fetchAll()
      apply(lib, un)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [apply])

  // The initial load. State is only set from inside a promise callback, never
  // synchronously in the effect body — a synchronous setState there triggers a
  // cascading render, and the lint rule that enforces it is worth keeping
  // satisfied rather than silenced. `alive` stops a late response writing to a
  // dialog the user has already closed.
  useEffect(() => {
    let alive = true
    fetchAll()
      .then(([lib, un]) => { if (alive) apply(lib, un) })
      .catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : String(e)) })
    return () => { alive = false }
  }, [apply])

  async function toggle(segmentId: string) {
    if (expanded === segmentId) { setExpanded(null); return }
    setExpanded(segmentId)
    if (!versions[segmentId]) {
      const res = await api.getKmlVersions(segmentId)
      setVersions(v => ({ ...v, [segmentId]: res.versions }))
    }
  }

  async function act(fn: () => Promise<unknown>) {
    setBusy(true); setError(null)
    try {
      await fn()
      await reload()
      onDataChange?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function preview(segmentId: string) {
    try {
      const full = await api.getKmlFullPath(segmentId)
      onPreview?.([{ label: segmentId, coords: full.full_path, color: PREVIEW_COLORS[0] }])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function clearAllUnused() {
    setConfirmClearAll(false)
    await act(() => api.clearKmlUnusedFiles())
  }

  function toggleSelect(segmentId: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(segmentId)) next.delete(segmentId); else next.add(segmentId)
      return next
    })
  }

  async function deleteSelected() {
    setConfirmBulkDelete(false)
    await act(() => api.deleteSegmentsKml([...selected]))
  }

  const q = filter.trim().toLowerCase()
  const match = (a: string, b: string, c: string) =>
    !q || a.toLowerCase().includes(q) || b.toLowerCase().includes(q) || c.toLowerCase().includes(q)

  const linked = (data?.linked ?? []).filter(r => match(r.segment_id, r.name, r.system_id))
  const allVisibleSelected = linked.length > 0 && linked.every(r => selected.has(r.segment_id))
  function toggleSelectAllVisible() {
    setSelected(allVisibleSelected ? new Set() : new Set(linked.map(r => r.segment_id)))
  }
  const gaps = (data?.gaps ?? []).filter(r => match(r.segment_id, r.name, r.system_id))
  const s = data?.summary

  return createPortal(
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: Z, background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        width: 'min(1280px, 100%)', maxHeight: '90vh', display: 'flex', flexDirection: 'column',
        background: t.bgPanel, border: `1px solid ${t.border}`, borderRadius: 10,
        boxShadow: '0 12px 48px rgba(0,0,0,0.5)', fontFamily: 'system-ui, sans-serif', overflow: 'hidden',
      }}>
        <div style={{
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
          padding: '12px 16px', background: t.bgDeep, borderBottom: `1px solid ${t.border}`,
        }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: t.text }}>KML Library</div>
            {/* All three numbers together. "218 files" alone reads as coverage. */}
            <div style={{ fontSize: 11, color: t.textMuted, marginTop: 2 }}>
              {s ? (
                <>
                  <strong style={{ color: t.green }}>{s.linked}</strong> of {s.segments_total} segments have
                  route geometry on file · <strong style={{ color: t.orange }}>{s.gaps}</strong> still drawn from waypoints
                  {s.orphans > 0 && <> · <strong style={{ color: t.red }}>{s.orphans}</strong> orphaned</>}
                </>
              ) : 'Loading…'}
            </div>
          </div>
          <button onClick={onClose} title="Close"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: t.textFaint, fontSize: 20, lineHeight: 1 }}
          >×</button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderBottom: `1px solid ${t.border}`, flexWrap: 'wrap' }}>
          <button onClick={() => setTab('linked')} style={tabButton(tab === 'linked', t)}>Linked {s ? `(${s.linked})` : ''}</button>
          <button onClick={() => setTab('gaps')} style={tabButton(tab === 'gaps', t)}>Gaps {s ? `(${s.gaps})` : ''}</button>
          <button onClick={() => setTab('orphans')} style={tabButton(tab === 'orphans', t)}>Orphans {s ? `(${s.orphans})` : ''}</button>
          <button onClick={() => setTab('unused')} style={tabButton(tab === 'unused', t)}>Unused files {unused ? `(${unused.count})` : ''}</button>
          <div style={{ flex: 1 }} />
          {tab === 'linked' && isAdmin && selected.size > 0 && (
            <button onClick={() => setConfirmBulkDelete(true)} disabled={busy} style={smallButton(t, 'danger')}>
              Delete {selected.size} selected
            </button>
          )}
          {(tab === 'linked' || tab === 'gaps') && (
            <input
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder="Filter by segment, name or system…"
              style={{
                width: 260, padding: '5px 9px', fontSize: 11, fontFamily: 'inherit',
                background: t.bgDeep, color: t.text, border: `1px solid ${t.border}`, borderRadius: 5,
              }}
            />
          )}
        </div>

        {error && (
          <div style={{ padding: '8px 16px', fontSize: 11, color: t.red, borderBottom: `1px solid ${t.border}` }}>{error}</div>
        )}

        <div style={{ overflowY: 'auto', flex: 1 }}>
          {tab === 'linked' && (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {isAdmin && (
                    <th style={{ ...headCell(t), width: 22 }}>
                      <input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectAllVisible} title="Select all" />
                    </th>
                  )}
                  <th style={{ ...headCell(t), width: 34 }} />
                  <th style={headCell(t)}>Segment</th>
                  <th style={headCell(t)}>System</th>
                  <th style={headCell(t)}>Source</th>
                  <th style={headCell(t)}>Ver</th>
                  <th style={headCell(t)}>Points</th>
                  <th style={headCell(t)}>Length on file</th>
                  <th style={headCell(t)}>End gaps A / Z</th>
                  <th style={headCell(t)}>Added</th>
                  <th style={{ ...headCell(t), width: 110 }} />
                </tr>
              </thead>
              <tbody>
                {linked.map(row => (
                  <LinkedRow
                    key={row.segment_id}
                    row={row} t={t}
                    expanded={expanded === row.segment_id}
                    versions={versions[row.segment_id]}
                    busy={busy}
                    isAdmin={isAdmin}
                    selected={selected.has(row.segment_id)}
                    onToggle={() => void toggle(row.segment_id)}
                    onToggleSelect={() => toggleSelect(row.segment_id)}
                    onPreview={() => void preview(row.segment_id)}
                    onActivate={id => void act(() => api.activateKml(id))}
                    onDelete={id => void act(() => api.deleteKml(id))}
                  />
                ))}
              </tbody>
            </table>
          )}

          {tab === 'gaps' && <GapsTable gaps={gaps} t={t} />}

          {tab === 'orphans' && (
            <div style={{ padding: 14 }}>
              {(data?.orphans.length ?? 0) === 0 ? (
                <div style={{ fontSize: 12, color: t.textMuted }}>
                  No orphans — every surveyed route belongs to a segment that still exists.
                </div>
              ) : (
                <>
                  <div style={{ fontSize: 11, color: t.textMuted, marginBottom: 8, lineHeight: 1.6 }}>
                    These routes are attached to segment ids that are no longer in the network — renamed or
                    deleted after the KML was attached. They are not drawn anywhere. Deleting one removes the
                    version; re-import it against the new segment id if the cable still exists.
                  </div>
                  {data?.orphans.map(o => (
                    <div key={o.link_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0', fontSize: 11 }}>
                      <span style={{ color: t.text, minWidth: 200 }}>{o.segment_id}</span>
                      <span style={{ color: t.textFaint }}>v{o.version}</span>
                      <div style={{ flex: 1 }} />
                      <a href={api.kmlDownloadUrl(o.link_id)} style={{ ...smallButton(t), textDecoration: 'none' }}>⬇ Original</a>
                      {isAdmin && (
                        <button onClick={() => void act(() => api.deleteKml(o.link_id))} disabled={busy} style={smallButton(t, 'danger')}>
                          Delete
                        </button>
                      )}
                    </div>
                  ))}
                </>
              )}
            </div>
          )}

          {tab === 'unused' && (
            <div style={{ padding: 14 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
                <div style={{ fontSize: 11, color: t.textMuted, lineHeight: 1.6, flex: 1 }}>
                  Files uploaded during a review but never attached to a segment. An import stores every file it
                  reads so the approval step only has to send an index rather than the bytes again, so abandoning a
                  review — or approving three of fifty paths — leaves the rest here.
                  {unused && unused.count > 0 && <> Currently <strong style={{ color: t.text }}>{bytes(unused.total_bytes)}</strong>.</>}
                </div>
                {isAdmin && (unused?.count ?? 0) > 0 && (
                  <button onClick={() => setConfirmClearAll(true)} disabled={busy} style={{ ...smallButton(t, 'danger'), whiteSpace: 'nowrap' }}>
                    Clear all ({unused?.count})
                  </button>
                )}
              </div>
              {(unused?.count ?? 0) === 0 ? (
                <div style={{ fontSize: 12, color: t.textMuted }}>Nothing unused.</div>
              ) : (
                unused?.files.map(f => (
                  <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0', fontSize: 11 }}>
                    <span style={{ color: t.text, minWidth: 240 }}>{f.filename}</span>
                    <span style={{ color: t.textFaint }}>{bytes(f.size_bytes)}</span>
                    <span style={{ color: t.textFaint }}>{day(f.uploaded_at)}</span>
                    <div style={{ flex: 1 }} />
                    {isAdmin && (
                      <button onClick={() => void act(() => api.deleteKmlUnusedFile(f.id))} disabled={busy} style={smallButton(t, 'danger')}>
                        Delete
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          {confirmClearAll && (
            <ConfirmDialog
              title="Clear all unused files?"
              body={`This permanently deletes ${unused?.count ?? 0} unattached file${unused?.count === 1 ? '' : 's'} (${bytes(unused?.total_bytes ?? 0)}). Anything still attached to a segment version is untouched.`}
              confirmLabel="Clear all"
              danger
              onConfirm={() => void clearAllUnused()}
              onCancel={() => setConfirmClearAll(false)}
            />
          )}

          {confirmBulkDelete && (
            <ConfirmDialog
              title={`Delete all KML for ${selected.size} segment${selected.size === 1 ? '' : 's'}?`}
              body={
                <>
                  This permanently removes EVERY version, not just the active one, for:{' '}
                  <strong style={{ color: t.text }}>{listSelected(selected)}</strong>.
                  {' '}Each reverts to being drawn from its waypoints (or a straight line) until re-imported.
                </>
              }
              confirmLabel="Delete all"
              danger
              onConfirm={() => void deleteSelected()}
              onCancel={() => setConfirmBulkDelete(false)}
            />
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
