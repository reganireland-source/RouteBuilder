/**
 * OutageParserModal — the AI Outage Parser flow, opened from the Outages tab in
 * RefDataModal (admin-only).
 *
 * WHAT IT DOES
 * A network engineer pastes/uploads their current outage table (text, a
 * screenshot image, or a CSV/XLSX file). The backend (POST /api/outages/parse)
 * uses a vision LLM to extract each outage AND map its human cable name to a
 * real segment_id, returning proposals with a per-row confidence. This modal
 * shows those proposals in a fully editable review table with a traffic-light
 * status per row:
 *   green  — confident single segment match
 *   amber  — a best guess / several plausible candidates
 *   red    — no valid segment yet (excluded from saving until fixed or removed)
 * The engineer edits/adds/removes rows, then "Accept All & Replace" performs the
 * destructive PUT /api/outages that wipes the current outage set and inserts the
 * reviewed rows.
 *
 * State lives entirely here; on a successful replace it calls onReplaced() so
 * the parent can refresh, then closes.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api/client'
import { useTheme } from '../theme'
import type { CableSegment, ParsedOutage, SegmentOutage } from '../types'

type Row = ParsedOutage

/** Pull image files out of a clipboard payload (screenshot paste). */
function imagesFromClipboard(dt: DataTransfer): File[] {
  const out: File[] = []
  for (const item of Array.from(dt.items)) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const blob = item.getAsFile()
      if (blob) {
        const ext = blob.type.split('/')[1] || 'png'
        out.push(new File([blob], `pasted-${Date.now()}-${out.length}.${ext}`, { type: blob.type }))
      }
    }
  }
  return out
}

/** A row is savable only once it points at a real segment_id. */
function isRowValid(r: Row): boolean {
  return !!r.segment_id && r.matched
}

/** Traffic-light colour for a row given its live (possibly edited) state. */
function statusColor(r: Row, ok: string, warn: string, bad: string): string {
  if (!isRowValid(r)) return bad
  return r.confidence === 'low' ? warn : ok
}

export function OutageParserModal({ segments, onClose, onReplaced }: {
  segments: CableSegment[]
  onClose: () => void
  onReplaced: () => Promise<void> | void
}) {
  const t = useTheme()
  const [text, setText] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [parsing, setParsing] = useState(false)
  const [parseTokens, setParseTokens] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<Row[] | null>(null)
  const [existingCount, setExistingCount] = useState(0)
  const [modelUsed, setModelUsed] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // Segment options for the per-row dropdown, sorted by id.
  const segOptions = useMemo(
    () => [...segments].sort((a, b) => a.id.localeCompare(b.id)),
    [segments],
  )
  const segById = useMemo(() => Object.fromEntries(segments.map(s => [s.id, s])), [segments])

  const validCount = rows ? rows.filter(isRowValid).length : 0
  const invalidCount = rows ? rows.length - validCount : 0

  // Thumbnail previews for uploaded/pasted files; object URLs are revoked when
  // the file set changes or the modal unmounts to avoid leaks.
  const previews = useMemo(() => files.map(f => ({
    file: f,
    isImage: f.type.startsWith('image/'),
    url: f.type.startsWith('image/') ? URL.createObjectURL(f) : '',
  })), [files])
  useEffect(() => () => { previews.forEach(p => p.url && URL.revokeObjectURL(p.url)) }, [previews])

  // Capture screenshots pasted from the clipboard (⌘/Ctrl+V) anywhere in the
  // input stage — regardless of focus — while still letting plain-text paste
  // fall through to the textarea. Only active before parsing (rows === null).
  useEffect(() => {
    if (rows) return
    function onPaste(e: ClipboardEvent) {
      if (!e.clipboardData) return
      const imgs = imagesFromClipboard(e.clipboardData)
      if (imgs.length) { e.preventDefault(); setFiles(fs => [...fs, ...imgs]) }
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [rows])

  function addFiles(list: FileList | null) {
    if (list && list.length) setFiles(fs => [...fs, ...Array.from(list)])
  }
  function removeFile(i: number) {
    setFiles(fs => fs.filter((_, idx) => idx !== i))
  }

  async function runParse() {
    if (!text.trim() && files.length === 0) { setError('Paste a table, paste a screenshot, or choose a file first.'); return }
    setParsing(true); setError(null); setParseTokens(0)
    try {
      const res = await api.parseOutages(text.trim(), files, tokens => setParseTokens(tokens))
      setRows(res.proposals)
      setExistingCount(res.existing_count)
      setModelUsed(res.model)
      if (res.proposals.length === 0) setError('The AI found no outages in that input.')
    } catch (e) {
      setError(`Parse failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setParsing(false)
    }
  }

  function patchRow(i: number, patch: Partial<Row>) {
    setRows(rs => rs ? rs.map((r, idx) => idx === i ? { ...r, ...patch } : r) : rs)
  }

  // Picking a segment from the dropdown makes the row valid + high confidence.
  function pickSegment(i: number, segId: string) {
    patchRow(i, { segment_id: segId, matched: !!segId, confidence: segId ? 'high' : 'none' })
  }

  function removeRow(i: number) {
    setRows(rs => rs ? rs.filter((_, idx) => idx !== i) : rs)
  }

  function addRow() {
    setRows(rs => ([...(rs ?? []), {
      segment_id: '', fault_id: '', fault_date: '', repair_start: null,
      estimated_repair_date: null, description: '',
      matched: false, confidence: 'none', candidates: [], raw_cable: '', raw_segment: '',
    }]))
  }

  async function acceptAndReplace() {
    if (!rows) return
    setSaving(true); setError(null)
    try {
      // Only the SegmentOutage fields go to the backend; strip review metadata.
      const payload: SegmentOutage[] = rows.filter(isRowValid).map(r => ({
        segment_id: r.segment_id,
        fault_id: r.fault_id.trim() || r.segment_id,
        fault_date: r.fault_date,
        repair_start: r.repair_start || undefined,
        estimated_repair_date: r.estimated_repair_date || undefined,
        description: r.description,
      }))
      await api.replaceAllOutages(payload)
      await onReplaced()
      onClose()
    } catch (e) {
      setError(`Save failed: ${e instanceof Error ? e.message : String(e)}`)
      setConfirming(false)
    } finally {
      setSaving(false)
    }
  }

  const inp: React.CSSProperties = {
    width: '100%', padding: '5px 7px', fontSize: 12, borderRadius: 4,
    border: `1px solid ${t.border}`, background: t.bgInput, color: t.text, fontFamily: 'inherit',
  }

  return (
    <div
      // This modal is rendered inside RefDataModal, whose backdrop closes on
      // click. Stop clicks here from bubbling up to it, or every click in the
      // parser (including into the textarea) would close the whole Ref Data modal.
      onClick={e => e.stopPropagation()}
      onMouseDown={e => e.stopPropagation()}
      style={{
        position: 'fixed', inset: 0, zIndex: 12000, background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      }}>
      <style>{'@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }'}</style>
      <div style={{
        width: 'min(1100px, 96vw)', maxHeight: '92vh', background: t.bgPanel,
        border: `1px solid ${t.border}`, borderRadius: 10, display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px', borderBottom: `1px solid ${t.border}`, flexShrink: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: t.text }}>⚡ AI Outage Parser</div>
          <div style={{ fontSize: 11, color: t.textFaint, flex: 1 }}>
            Paste or upload your outage table — AI extracts and maps each to a segment.
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: t.textMuted, fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        <div style={{ overflowY: 'auto', padding: 18 }}>
          {/* ── Input stage ── */}
          {!rows && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ fontSize: 12, color: t.textMuted }}>Paste a table (from email, a report, or a spreadsheet):</div>
              <textarea
                value={text}
                onChange={e => setText(e.target.value)}
                placeholder="Cable   Segment   Fault Date   Reference   Status ..."
                style={{ ...inp, minHeight: 120, fontFamily: 'ui-monospace, monospace', resize: 'vertical' }}
              />

              {/* Screenshot paste zone — captures ⌘/Ctrl+V images anywhere on the page */}
              <div
                onClick={() => fileRef.current?.click()}
                style={{
                  border: `1.5px dashed ${t.border}`, borderRadius: 8, padding: '16px 14px',
                  textAlign: 'center', cursor: 'pointer', background: t.bgDeep,
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 600, color: t.textMuted }}>
                  📋 Paste screenshot(s) here — press ⌘/Ctrl + V
                </div>
                <div style={{ fontSize: 11, color: t.textFaint, marginTop: 3 }}>
                  Paste multiple images for a large table · or click to choose image / CSV / XLSX files
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  multiple
                  accept="image/png,image/jpeg,image/gif,image/webp,.csv,.xlsx,.xlsm,text/csv"
                  onChange={e => { addFiles(e.target.files); if (fileRef.current) fileRef.current.value = '' }}
                  style={{ display: 'none' }}
                />
              </div>

              {/* Thumbnails / file chips */}
              {previews.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-start' }}>
                  {previews.map((p, i) => (
                    <div key={i} style={{ position: 'relative', border: `1px solid ${t.border}`, borderRadius: 6, overflow: 'hidden', background: t.bgCard }}>
                      {p.isImage
                        ? <img src={p.url} alt="" style={{ display: 'block', width: 96, height: 72, objectFit: 'cover' }} />
                        : <div style={{ width: 120, height: 72, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 6, fontSize: 10, color: t.textMuted, textAlign: 'center', wordBreak: 'break-all' }}>📄 {p.file.name}</div>}
                      <button
                        onClick={e => { e.stopPropagation(); removeFile(i) }}
                        title="Remove"
                        style={{ position: 'absolute', top: 2, right: 2, width: 18, height: 18, borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 12, lineHeight: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                      >×</button>
                    </div>
                  ))}
                  <button onClick={() => setFiles([])} style={{ alignSelf: 'center', fontSize: 11, color: t.textFaint, background: 'transparent', border: `1px solid ${t.border}`, borderRadius: 4, padding: '3px 10px', cursor: 'pointer' }}>Clear all</button>
                </div>
              )}

              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <button
                  onClick={runParse}
                  disabled={parsing}
                  style={{ padding: '9px 20px', borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: parsing ? 'default' : 'pointer', border: 'none', background: t.blue, color: '#04121f', opacity: parsing ? 0.6 : 1 }}
                >
                  {parsing ? 'Parsing with AI…' : `Parse with AI${files.length ? ` (${files.length} file${files.length === 1 ? '' : 's'})` : ''}`}
                </button>
                {parsing && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12, color: t.textMuted, fontFamily: 'ui-monospace, monospace' }}>
                    <span style={{ width: 12, height: 12, borderRadius: '50%', border: `2px solid ${t.border}`, borderTopColor: t.blue, display: 'inline-block', animation: 'spin 0.8s linear infinite' }} />
                    {parseTokens > 0
                      ? <>thinking… <strong style={{ color: t.text }}>{parseTokens.toLocaleString()}</strong> tokens</>
                      : <>contacting model…</>}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* ── Review stage ── */}
          {rows && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', fontSize: 12 }}>
                <span style={{ color: t.textMuted }}>
                  <strong style={{ color: t.text }}>{rows.length}</strong> parsed
                </span>
                <span style={{ color: t.green }}>● {validCount} ready</span>
                {invalidCount > 0 && <span style={{ color: t.red }}>● {invalidCount} need a segment</span>}
                <span style={{ color: t.textFaint }}>model: {modelUsed}</span>
                <span style={{ flex: 1 }} />
                <button onClick={() => { setRows(null); setError(null) }} style={{ fontSize: 11, color: t.textMuted, background: 'transparent', border: `1px solid ${t.border}`, borderRadius: 4, padding: '3px 10px', cursor: 'pointer' }}>← New input</button>
              </div>

              {/* Column header */}
              <div style={{ display: 'flex', gap: 6, fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: t.textFaint, padding: '0 4px' }}>
                <div style={{ width: 16 }} />
                <div style={{ width: 190 }}>Segment</div>
                <div style={{ width: 110 }}>Fault ID</div>
                <div style={{ width: 96 }}>Fault Date</div>
                <div style={{ width: 96 }}>Repair Start</div>
                <div style={{ width: 96 }}>ETA Repair</div>
                <div style={{ flex: 1 }}>Description</div>
                <div style={{ width: 24 }} />
              </div>

              {/* Rows */}
              {rows.map((r, i) => {
                const dot = statusColor(r, t.green, t.orange, t.red)
                const seg = r.segment_id ? segById[r.segment_id] : undefined
                return (
                  <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'flex-start', padding: '6px 4px', borderTop: `1px solid ${t.border}` }}>
                    <div title={isRowValid(r) ? (r.confidence === 'low' ? 'Best guess — check the segment' : 'Confident match') : 'No valid segment — pick one or delete'}
                      style={{ width: 16, paddingTop: 8, display: 'flex', justifyContent: 'center' }}>
                      <span style={{ width: 9, height: 9, borderRadius: '50%', background: dot, flexShrink: 0 }} />
                    </div>
                    <div style={{ width: 190 }}>
                      <select value={r.segment_id} onChange={e => pickSegment(i, e.target.value)}
                        style={{ ...inp, borderColor: isRowValid(r) ? t.border : t.red }}>
                        <option value="">— unmatched —</option>
                        {/* Surface AI's candidates first for quick amber resolution */}
                        {r.candidates.filter(c => c !== r.segment_id).map(c => (
                          <option key={`c-${c}`} value={c}>★ {c} — {segById[c]?.name ?? ''}</option>
                        ))}
                        {segOptions.map(s => <option key={s.id} value={s.id}>{s.id} — {s.name}</option>)}
                      </select>
                      {(r.raw_cable || r.raw_segment) && (
                        <div style={{ fontSize: 9, color: t.textFaint, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                          title={`${r.raw_cable} ${r.raw_segment}`}>
                          from: {r.raw_cable} {r.raw_segment}
                        </div>
                      )}
                      {seg && <div style={{ fontSize: 9, color: t.textFaint, marginTop: 1 }}>{seg.name}</div>}
                    </div>
                    <div style={{ width: 110 }}><input value={r.fault_id} onChange={e => patchRow(i, { fault_id: e.target.value })} style={inp} /></div>
                    <div style={{ width: 96 }}><input value={r.fault_date} onChange={e => patchRow(i, { fault_date: e.target.value })} placeholder="YYYY-MM-DD" style={inp} /></div>
                    <div style={{ width: 96 }}><input value={r.repair_start ?? ''} onChange={e => patchRow(i, { repair_start: e.target.value || null })} placeholder="TBC" style={inp} /></div>
                    <div style={{ width: 96 }}><input value={r.estimated_repair_date ?? ''} onChange={e => patchRow(i, { estimated_repair_date: e.target.value || null })} placeholder="TBC" style={inp} /></div>
                    <div style={{ flex: 1 }}>
                      <textarea value={r.description} onChange={e => patchRow(i, { description: e.target.value })}
                        style={{ ...inp, minHeight: 34, resize: 'vertical', lineHeight: 1.4 }} />
                    </div>
                    <div style={{ width: 24, paddingTop: 4 }}>
                      <button onClick={() => removeRow(i)} title="Remove row"
                        style={{ background: 'transparent', border: 'none', color: t.textFaint, cursor: 'pointer', fontSize: 15 }}>×</button>
                    </div>
                  </div>
                )
              })}

              <div>
                <button onClick={addRow} style={{ fontSize: 11, color: t.textMuted, background: 'transparent', border: `1px dashed ${t.border}`, borderRadius: 4, padding: '5px 12px', cursor: 'pointer' }}>+ Add row</button>
              </div>
            </div>
          )}

          {error && <div style={{ marginTop: 12, fontSize: 12, color: t.red, whiteSpace: 'pre-wrap' }}>{error}</div>}
        </div>

        {/* Footer — replace action (review stage only) */}
        {rows && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px', borderTop: `1px solid ${t.border}`, flexShrink: 0 }}>
            {invalidCount > 0 && (
              <span style={{ fontSize: 11, color: t.orange }}>
                {invalidCount} unmatched row{invalidCount === 1 ? '' : 's'} will be skipped.
              </span>
            )}
            <span style={{ flex: 1 }} />
            <button onClick={onClose} style={{ fontSize: 12, color: t.textMuted, background: 'transparent', border: `1px solid ${t.border}`, borderRadius: 5, padding: '8px 14px', cursor: 'pointer' }}>Cancel</button>
            <button
              onClick={() => setConfirming(true)}
              disabled={validCount === 0}
              style={{ fontSize: 12, fontWeight: 700, color: '#fff', background: validCount === 0 ? t.textFaint : t.red, border: 'none', borderRadius: 5, padding: '8px 16px', cursor: validCount === 0 ? 'default' : 'pointer' }}
            >
              Accept All &amp; Replace ({validCount})
            </button>
          </div>
        )}
      </div>

      {/* Destructive confirm */}
      {confirming && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 12100, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ width: 'min(440px, 92vw)', background: t.bgPanel, border: `1px solid ${t.border}`, borderRadius: 10, padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: t.text, marginBottom: 8 }}>Replace all outages?</div>
            <div style={{ fontSize: 12, color: t.textMuted, lineHeight: 1.6, marginBottom: 18 }}>
              This will <strong style={{ color: t.red }}>permanently delete all {existingCount} existing outage{existingCount === 1 ? '' : 's'}</strong> and replace them with the <strong style={{ color: t.text }}>{validCount}</strong> reviewed row{validCount === 1 ? '' : 's'}. This cannot be undone.
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setConfirming(false)} disabled={saving} style={{ fontSize: 12, color: t.textMuted, background: 'transparent', border: `1px solid ${t.border}`, borderRadius: 5, padding: '8px 14px', cursor: 'pointer' }}>Cancel</button>
              <button onClick={acceptAndReplace} disabled={saving} style={{ fontSize: 12, fontWeight: 700, color: '#fff', background: t.red, border: 'none', borderRadius: 5, padding: '8px 16px', cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.6 : 1 }}>
                {saving ? 'Replacing…' : `Replace ${existingCount} → ${validCount}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
