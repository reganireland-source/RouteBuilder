/**
 * KmlBulkImport — drop a folder of KMZ files, review what the matcher thinks
 * each one is, then attach the ones you agree with.
 *
 * NOTHING IS ATTACHED WITHOUT A PERSON SEEING WHERE IT WENT. The upload step
 * parses and scores but writes no links; only Attach does, and only for the
 * rows still ticked. That split exists because the failure this feature can
 * produce is silent: a surveyed route attached to the wrong cable draws a map
 * that looks entirely plausible and is wrong, and nothing downstream would
 * catch it.
 *
 * THE SCORE IS SHOWN WITH ITS WORKING. Each row carries the geometry and name
 * components separately and the endpoint gaps in km, because "94%" on its own
 * is not something a reviewer can check. Geometry is worth up to 70 and the
 * filename up to 30 — a name is a claim, endpoints are evidence — so a row can
 * be confidently named and still obviously wrong, and the split shows it.
 *
 * ROWS THE MATCHER IS NOT SURE OF ARE UNTICKED BY DEFAULT. Two cables landing
 * at the same pair of stations are geometrically identical — that is what
 * diversity means, so it is common rather than exotic — and the matcher flags
 * those rather than guessing. Approve All ticks only the confident ones.
 *
 * Uploads go in batches (MAX_FILES_PER_BATCH server-side) so a few hundred
 * files show progress as they go and one failed batch does not lose the rest.
 */
import { useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CableSegment, KmlCommitResponse, KmlPreviewLine, KmlProposal, KmlProposeResponse } from '../types'
import { useTheme, type Theme } from '../theme'
import { api } from '../api/client'
import { PREVIEW_COLORS } from './KmlPreviewLayer'

interface Props {
  segments: CableSegment[]
  onClose: () => void
  /** Refetch hook so the map and Ref Data pick up what was attached. */
  onDataChange?: () => void
  /** Draw a proposal on the real map. Passing [] clears it. */
  onPreview?: (lines: KmlPreviewLine[]) => void
}

/** Matches MAX_FILES_PER_BATCH in backend/app/api/kml.py. */
const BATCH_SIZE = 25

/** Above the modal stack but below ConfirmDialog (12500). */
const Z = 11500

type Decision = {
  /** Ticked for attachment. */
  accept: boolean
  /** Which segment — the matcher's pick unless the reviewer changed it. */
  segmentId: string
}

/**
 * Turn the rows being shown into drawable lines.
 *
 * Each piece gets its own colour, and every piece after the first is marked
 * where it STARTS — that point is a cut this import proposes. The first piece's
 * start is the file's own beginning, not a cut, so it carries no marker.
 */
function previewLines(rows: KmlProposal[]): KmlPreviewLine[] {
  return rows.map((q, i) => ({
    label: q.piece_index !== null ? `piece ${q.piece_index + 1}` : q.filename,
    coords: q.preview_path,
    color: PREVIEW_COLORS[i % PREVIEW_COLORS.length],
    cutAt: i > 0 && q.preview_path.length ? q.preview_path[0] : undefined,
    cutLabel: q.piece_start_node ?? undefined,
  }))
}

/** Empty totals, accumulated across batches. */
function zeroTotals(): KmlProposeResponse['summary'] {
  return { files_read: 0, files_rejected: 0, paths_found: 0, auto_acceptable: 0, ambiguous: 0, no_candidate: 0 }
}

/**
 * Upload a set of files in batches, reporting after each one.
 *
 * Batched rather than sent as a single request because a few hundred files is
 * the stated scale: one giant multipart body gives no progress, and a failure
 * anywhere loses everything. `onBatch` fires per batch so the table fills as it
 * goes — with 300 files that is the difference between visible progress and an
 * apparently hung dialog.
 *
 * Module-level and callback-driven so it is plain async logic rather than more
 * branching inside the component.
 */
async function proposeInBatches(
  files: File[],
  onBatch: (soFar: KmlProposal[], rejected: { filename: string; reason: string }[], done: number) => void,
): Promise<{ proposals: KmlProposal[]; totals: KmlProposeResponse['summary'] }> {
  const proposals: KmlProposal[] = []
  const rejected: { filename: string; reason: string }[] = []
  const totals = zeroTotals()

  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const res = await api.proposeKmlBatch(files.slice(i, i + BATCH_SIZE))
    proposals.push(...res.proposals)
    rejected.push(...res.rejected)
    for (const k of Object.keys(totals) as (keyof typeof totals)[]) totals[k] += res.summary[k]
    onBatch([...proposals], [...rejected], Math.min(i + BATCH_SIZE, files.length))
  }
  return { proposals, totals }
}

/**
 * What the last upload found, what could not be read, and what the last attach
 * actually did. Module-level: it is pure presentation of four independent
 * pieces of state, and keeping it out of the dialog leaves that a shell around
 * "choose files / review / attach".
 */
function ImportStatus({ summary, rejected, error, result, t }: {
  summary: KmlProposeResponse['summary'] | null
  rejected: { filename: string; reason: string }[]
  error: string | null
  result: KmlCommitResponse | null
  t: Theme
}) {
  return (
    <>
      {(summary || rejected.length > 0 || error) && (
        <div style={{ padding: '8px 16px', borderBottom: `1px solid ${t.border}`, fontSize: 11, color: t.textMuted }}>
          {summary && (
            <span>
              {summary.files_read} file{summary.files_read === 1 ? '' : 's'} read ·{' '}
              <strong style={{ color: t.text }}>{summary.paths_found}</strong> cable paths ·{' '}
              <strong style={{ color: t.green }}>{summary.auto_acceptable}</strong> confident ·{' '}
              <strong style={{ color: t.orange }}>{summary.ambiguous}</strong> ambiguous
              {summary.no_candidate > 0 && <> · <strong style={{ color: t.red }}>{summary.no_candidate}</strong> with no match</>}
            </span>
          )}
          {rejected.map(r => (
            <div key={r.filename} style={{ color: t.red, marginTop: 4 }}>
              {r.filename}: {r.reason}
            </div>
          ))}
          {error && <div style={{ color: t.red, marginTop: 4 }}>{error}</div>}
        </div>
      )}
      {result && (
        <div style={{ padding: '10px 16px', borderBottom: `1px solid ${t.border}`, fontSize: 12 }}>
          <div style={{ color: t.green, fontWeight: 700 }}>
            Attached {result.summary.linked} route{result.summary.linked === 1 ? '' : 's'}.
          </div>
          {result.failed.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <div style={{ color: t.red, fontWeight: 700, fontSize: 11 }}>
                {result.failed.length} could not be attached:
              </div>
              {result.failed.map(f => (
                <div key={`${f.file_id}:${f.path_index}`} style={{ fontSize: 11, color: t.textMuted }}>
                  {f.segment_id}: {f.reason}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  )
}

/** One table cell. Shared by the header and every row, so module-level. */
const cell: React.CSSProperties = { padding: '6px 8px', fontSize: 11, verticalAlign: 'top' }

/** The small per-row map buttons; filled while that thing is being shown. */
function previewBtn(active: boolean, t: Theme): React.CSSProperties {
  return {
    padding: '3px 7px', borderRadius: 4, fontSize: 10, fontFamily: 'inherit',
    fontWeight: active ? 700 : 500, whiteSpace: 'nowrap', cursor: 'pointer',
    border: `1px solid ${active ? t.blue : t.border}`,
    background: active ? t.blue + '28' : 'transparent',
    color: active ? t.blue : t.textMuted,
  }
}

/** Colour for a row's status chip. */
function toneColorFor(tone: 'ok' | 'warn' | 'bad', t: Theme): string {
  if (tone === 'ok') return t.green
  if (tone === 'warn') return t.orange
  return t.red
}

function scoreColor(score: number, t: Theme): string {
  if (score >= 65) return t.green
  if (score >= 40) return t.orange
  return t.red
}

/** Why this row is or is not safe to wave through, in words. */
function rowStatus(p: KmlProposal): { label: string; tone: 'ok' | 'warn' | 'bad' } {
  if (!p.candidates.length) return { label: 'no match', tone: 'bad' }
  if (p.ambiguous) return { label: 'ambiguous', tone: 'warn' }
  if (p.auto_acceptable) return { label: 'confident', tone: 'ok' }
  return { label: 'check', tone: 'warn' }
}

/**
 * One reviewable row. Module-level rather than inline so the dialog itself
 * stays a shell around "choose files / review / attach" — the row carries most
 * of the conditional logic (status, conflicts, preview state, reassignment) and
 * having it here keeps each piece under the complexity ceiling.
 */
function ReviewRow({
  p, d, chosen, conflicts, segmentIds, previewing, t,
  onDecision, onPreviewRow, onPreviewFile, rowId,
}: {
  p: KmlProposal
  d: Decision
  chosen?: KmlProposal['candidates'][number]
  conflicts: Set<string>
  segmentIds: string[]
  previewing: string | null
  t: Theme
  onDecision: (patch: Partial<Decision>) => void
  onPreviewRow: () => void
  onPreviewFile: () => void
  rowId: string
}) {
  const status = rowStatus(p)
  const toneColor = toneColorFor(status.tone, t)
  const claimedTwice = d.accept && conflicts.has(d.segmentId)
  const fileKey = `file:${p.file_id}:${p.path_index}`
  return (
    <tr style={{ borderBottom: `1px solid ${t.border}`, background: d.accept ? t.green + '0c' : 'transparent' }}>
      <td style={cell}>
        <input
          type="checkbox"
          checked={d.accept}
          disabled={!d.segmentId}
          onChange={e => onDecision({ accept: e.target.checked })}
          aria-label={`Attach ${p.filename} path ${p.path_index + 1}`}
        />
      </td>
      <td style={cell}>
        <div style={{ color: t.text }}>{p.filename}</div>
        <div style={{ color: t.textFaint, fontSize: 10 }}>
          {p.paths_in_file > 1 && `path ${p.path_index + 1} of ${p.paths_in_file} · `}
          {p.path_name || '(unnamed)'}
          {p.folder && ` · ${p.folder}`}
          {' · '}{p.point_count.toLocaleString()} pts
        </div>
        {/* Say plainly when a row is only part of a file. One
            trace cut into three is three rows, and a reviewer
            who does not know that will read them as three
            separate files and wonder where they came from. */}
        {p.piece_index !== null && (
          <div style={{ fontSize: 10, color: t.blue, marginTop: 2 }}>
            ✂ split piece {p.piece_index + 1} of {p.piece_count}
            {p.piece_start_node && p.piece_end_node &&
              ` · ${p.piece_start_node} → ${p.piece_end_node}`}
          </div>
        )}
      </td>
      <td style={cell}>
        <select
          value={d.segmentId}
          onChange={e => onDecision({ segmentId: e.target.value })}
          style={{
            width: '100%', padding: '4px 6px', fontSize: 11, fontFamily: 'inherit',
            background: t.bgDeep, color: t.text,
            border: `1px solid ${claimedTwice ? t.orange : t.border}`, borderRadius: 4,
          }}
        >
          <option value="">— not matched —</option>
          {/* The ranked candidates first, then every segment, so a
              reviewer can always override rather than being limited
              to what the matcher happened to shortlist. */}
          {p.candidates.length > 0 && (
            <optgroup label="Suggested">
              {p.candidates.map(c => (
                <option key={c.segment_id} value={c.segment_id}>
                  {c.segment_id} — {c.score.toFixed(0)}%{c.already_linked ? ' (has one)' : ''}
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label="All segments">
            {segmentIds.map(id => <option key={id} value={id}>{id}</option>)}
          </optgroup>
        </select>
        {chosen?.already_linked && (
          <div style={{ fontSize: 10, color: t.textFaint, marginTop: 2 }}>
            already has a route — this becomes a new version
          </div>
        )}
        {claimedTwice && (
          <div style={{ fontSize: 10, color: t.orange, marginTop: 2 }}>
            another ticked row also claims this segment
          </div>
        )}
      </td>
      <td style={cell}>
        {chosen ? (
          <>
            <div style={{ color: scoreColor(chosen.score, t), fontWeight: 700 }}>
              {chosen.score.toFixed(0)}%
            </div>
            {/* The working, because a bare percentage is not
                something a reviewer can check. */}
            <div style={{ color: t.textFaint, fontSize: 10 }}>
              geometry {chosen.geometry_score.toFixed(0)} · name {chosen.name_score.toFixed(0)}
            </div>
          </>
        ) : <span style={{ color: t.textFaint }}>—</span>}
      </td>
      <td style={cell}>
        {chosen ? (
          <span style={{ color: Math.max(chosen.a_end_gap_km, chosen.z_end_gap_km) > 10 ? t.orange : t.textMuted }}>
            A {chosen.a_end_gap_km.toFixed(1)} · Z {chosen.z_end_gap_km.toFixed(1)} km
            {chosen.reversed && <div style={{ fontSize: 10, color: t.textFaint }}>drawn Z→A</div>}
          </span>
        ) : <span style={{ color: t.textFaint }}>—</span>}
      </td>
      <td style={cell}>
        <span style={{
          fontSize: 9, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
          padding: '2px 6px', borderRadius: 4, whiteSpace: 'nowrap',
          border: `1px solid ${toneColor}`, color: toneColor, background: toneColor + '18',
        }}>{status.label}</span>
      </td>
      <td style={cell}>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            onClick={onPreviewRow}
            title="Draw just this path on the map"
            style={previewBtn(previewing === rowId, t)}
          >{previewing === rowId ? '◉' : '◎'} This</button>
          {/* Only offered where there is more than one piece —
              on a single-path file it would do the same thing
              as the button beside it. */}
          {p.piece_count !== null && p.piece_count > 1 && (
            <button
              onClick={onPreviewFile}
              title="Draw all pieces of this file, each in its own colour, with the cuts marked"
              style={previewBtn(previewing === fileKey, t)}
            >All {p.piece_count}</button>
          )}
        </div>
      </td>
    </tr>
  )
}

export function KmlBulkImport({ segments, onClose, onDataChange, onPreview }: Props) {
  const t = useTheme()
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [proposals, setProposals] = useState<KmlProposal[]>([])
  const [rejected, setRejected] = useState<{ filename: string; reason: string }[]>([])
  const [summary, setSummary] = useState<KmlProposeResponse['summary'] | null>(null)
  const [decisions, setDecisions] = useState<Record<string, Decision>>({})
  const [result, setResult] = useState<KmlCommitResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** Which row (or whole file) is currently drawn on the map, and therefore
   *  whether the dialog has moved aside to let it be seen. */
  const [previewing, setPreviewing] = useState<string | null>(null)

  const segmentIds = useMemo(
    () => segments.map(s => s.id).sort((a, b) => a.localeCompare(b)),
    [segments],
  )

  /** Stable per-row key: a file may contribute several paths. */
  const rowKey = (p: KmlProposal) => `${p.file_id}:${p.path_index}:${p.piece_index ?? 'whole'}`

  async function pickFiles(files: File[]) {
    if (!files.length) return
    setBusy(true); setError(null); setResult(null)
    setProposals([]); setRejected([]); setDecisions({}); setSummary(null)
    clearPreview()

    setProgress({ done: 0, total: files.length })

    try {
      const { proposals: found, totals } = await proposeInBatches(files, (soFar, rej, done) => {
        setProposals(soFar)
        setRejected(rej)
        setProgress({ done, total: files.length })
      })
      setSummary(totals)
      // Pre-tick only what the matcher is confident about. Everything else
      // starts unticked, so waving the dialog through cannot attach a guess.
      const initial: Record<string, Decision> = {}
      for (const p of found) {
        initial[rowKey(p)] = {
          accept: p.auto_acceptable,
          segmentId: p.candidates[0]?.segment_id ?? '',
        }
      }
      setDecisions(initial)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false); setProgress(null)
    }
  }

  /**
   * Draw one row, or — for a file that was cut — ALL its pieces at once.
   *
   * Showing the whole file is the more useful of the two and the reason this
   * exists: the question a split raises is where one segment stops and the next
   * begins, and that can only be answered by seeing the pieces together, in
   * different colours, against the network they are being matched to.
   */
  function preview(p: KmlProposal, whole: boolean) {
    const key = whole ? `file:${p.file_id}:${p.path_index}` : rowKey(p)
    if (previewing === key) {           // second click on the same thing clears it
      setPreviewing(null)
      onPreview?.([])
      return
    }
    const rows = whole
      ? proposals.filter(q => q.file_id === p.file_id && q.path_index === p.path_index)
      : [p]
    setPreviewing(key)
    onPreview?.(previewLines(rows))
  }

  function clearPreview() {
    setPreviewing(null)
    onPreview?.([])
  }

  function setDecision(p: KmlProposal, patch: Partial<Decision>) {
    setDecisions(d => ({ ...d, [rowKey(p)]: { ...d[rowKey(p)], ...patch } }))
  }

  const acceptedCount = Object.values(decisions).filter(d => d.accept && d.segmentId).length

  /** Segments that more than one ticked row is claiming. */
  const conflicts = useMemo(() => {
    const seen = new Map<string, number>()
    for (const d of Object.values(decisions)) {
      if (d.accept && d.segmentId) seen.set(d.segmentId, (seen.get(d.segmentId) ?? 0) + 1)
    }
    return new Set([...seen.entries()].filter(([, n]) => n > 1).map(([id]) => id))
  }, [decisions])

  async function commit() {
    setBusy(true); setError(null)
    try {
      const accepted = proposals
        .filter(p => decisions[rowKey(p)]?.accept && decisions[rowKey(p)]?.segmentId)
        .map(p => ({
          file_id: p.file_id,
          path_index: p.path_index,
          piece_index: p.piece_index,
          segment_id: decisions[rowKey(p)].segmentId,
        }))
      setResult(await api.commitKmlBatch(accepted))
      onDataChange?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const headCell: React.CSSProperties = {
    ...cell, fontSize: 9, fontWeight: 700, letterSpacing: '0.05em',
    textTransform: 'uppercase', color: t.textMuted, textAlign: 'left',
    position: 'sticky', top: 0, background: t.bgDeep, zIndex: 1,
  }

  return createPortal(
    <div
      style={{
        // DOCKED WHILE PREVIEWING. A modal centred over the map is useless for
        // examining geometry on that map, and dimming the backdrop makes it
        // worse. When a preview is up the dialog moves to the bottom and the
        // backdrop becomes a no-op, so the map above can be panned and zoomed
        // with the table still in reach.
        position: 'fixed', inset: 0, zIndex: Z,
        background: previewing ? 'transparent' : 'rgba(0,0,0,0.6)',
        pointerEvents: previewing ? 'none' : 'auto',
        display: 'flex',
        alignItems: previewing ? 'flex-end' : 'center',
        justifyContent: 'center',
        padding: previewing ? 0 : 20,
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        pointerEvents: 'auto',
        width: previewing ? '100%' : 'min(1280px, 100%)',
        maxHeight: previewing ? '46vh' : '90vh',
        display: 'flex', flexDirection: 'column',
        background: t.bgPanel, border: `1px solid ${t.border}`,
        borderRadius: previewing ? '10px 10px 0 0' : 10,
        boxShadow: '0 -8px 48px rgba(0,0,0,0.5)', fontFamily: 'system-ui, sans-serif',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
          padding: '12px 16px', background: t.bgDeep, borderBottom: `1px solid ${t.border}`,
        }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: t.text }}>Bulk KML Import</div>
            <div style={{ fontSize: 11, color: t.textMuted, marginTop: 2 }}>
              Nothing is attached until you press Attach — review every row first.
            </div>
          </div>
          <button onClick={onClose} title="Close"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: t.textFaint, fontSize: 20, lineHeight: 1 }}
          >×</button>
        </div>

        {previewing && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '7px 16px', background: t.blue + '1a',
            borderBottom: `1px solid ${t.border}`, fontSize: 11, color: t.textMuted,
          }}>
            <span style={{ color: t.blue, fontWeight: 700 }}>Showing on the map above</span>
            <span>Each piece is drawn in its own colour; the dots mark where the path was cut.</span>
            <div style={{ flex: 1 }} />
            <button
              onClick={clearPreview}
              style={{
                padding: '4px 10px', borderRadius: 5, fontSize: 11, fontFamily: 'inherit',
                border: `1px solid ${t.border}`, background: 'transparent', color: t.textMuted, cursor: 'pointer',
              }}
            >Stop showing</button>
          </div>
        )}

        {/* Toolbar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderBottom: `1px solid ${t.border}`, flexWrap: 'wrap' }}>
          <input
            ref={fileRef} type="file" multiple
            accept=".kmz,.kml,application/vnd.google-earth.kmz,application/vnd.google-earth.kml+xml"
            style={{ display: 'none' }}
            onChange={e => { void pickFiles([...(e.target.files ?? [])]); e.target.value = '' }}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            style={{
              padding: '7px 13px', borderRadius: 6, fontSize: 12, fontWeight: 700, fontFamily: 'inherit',
              border: `1px solid ${t.blue}`, background: t.blue + '18', color: t.blue,
              cursor: busy ? 'default' : 'pointer',
            }}
          >{busy ? 'Reading…' : '⬆ Choose KMZ / KML files'}</button>

          {progress && (
            <span style={{ fontSize: 11, color: t.textMuted }}>
              {progress.done} / {progress.total} files
            </span>
          )}

          {proposals.length > 0 && !result && (
            <>
              <button
                onClick={() => setDecisions(d => {
                  const next = { ...d }
                  for (const p of proposals) {
                    if (p.auto_acceptable) next[rowKey(p)] = { ...next[rowKey(p)], accept: true }
                  }
                  return next
                })}
                style={{
                  padding: '6px 11px', borderRadius: 5, fontSize: 11, fontFamily: 'inherit',
                  border: `1px solid ${t.border}`, background: 'transparent', color: t.textMuted, cursor: 'pointer',
                }}
                title="Tick every row the matcher is confident about. Ambiguous rows are left alone."
              >Approve all confident</button>
              <button
                onClick={() => setDecisions(d => {
                  const next = { ...d }
                  for (const k of Object.keys(next)) next[k] = { ...next[k], accept: false }
                  return next
                })}
                style={{
                  padding: '6px 11px', borderRadius: 5, fontSize: 11, fontFamily: 'inherit',
                  border: `1px solid ${t.border}`, background: 'transparent', color: t.textMuted, cursor: 'pointer',
                }}
              >Clear all</button>
              <div style={{ flex: 1 }} />
              {conflicts.size > 0 && (
                <span style={{ fontSize: 11, color: t.orange }}>
                  {conflicts.size} segment{conflicts.size === 1 ? '' : 's'} claimed twice
                </span>
              )}
              <button
                onClick={() => void commit()}
                disabled={busy || acceptedCount === 0}
                style={{
                  padding: '7px 14px', borderRadius: 6, fontSize: 12, fontWeight: 700, fontFamily: 'inherit',
                  border: `1px solid ${acceptedCount ? t.green : t.border}`,
                  background: acceptedCount ? t.green + '20' : 'transparent',
                  color: acceptedCount ? t.green : t.textFaint,
                  cursor: busy || !acceptedCount ? 'default' : 'pointer',
                }}
              >Attach {acceptedCount} route{acceptedCount === 1 ? '' : 's'}</button>
            </>
          )}
        </div>

        <ImportStatus summary={summary} rejected={rejected} error={error} result={result} t={t} />
        {/* Review table */}
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {proposals.length === 0 && !busy && (
            <div style={{ padding: 28, textAlign: 'center', fontSize: 12, color: t.textMuted, lineHeight: 1.7 }}>
              Choose a set of KMZ or KML files to begin.<br />
              Files holding a whole cable system are split into their separate paths and
              matched one at a time.
            </div>
          )}
          {proposals.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ ...headCell, width: 34 }} />
                  <th style={headCell}>File / path</th>
                  <th style={headCell}>Matched segment</th>
                  <th style={{ ...headCell, width: 150 }}>Score</th>
                  <th style={{ ...headCell, width: 130 }}>Endpoint gaps</th>
                  <th style={{ ...headCell, width: 90 }}>Status</th>
                  <th style={{ ...headCell, width: 96 }}>Map</th>
                </tr>
              </thead>
              <tbody>
                {proposals.map(p => {
                  const d = decisions[rowKey(p)] ?? { accept: false, segmentId: '' }
                  return (
                    <ReviewRow
                      key={rowKey(p)}
                      rowId={rowKey(p)}
                      p={p}
                      d={d}
                      chosen={p.candidates.find(c => c.segment_id === d.segmentId)}
                      conflicts={conflicts}
                      segmentIds={segmentIds}
                      previewing={previewing}
                      t={t}
                      onDecision={patch => setDecision(p, patch)}
                      onPreviewRow={() => preview(p, false)}
                      onPreviewFile={() => preview(p, true)}
                    />
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
