/**
 * BulkImportPanel — the "Bulk Data Manager" screen for mass CSV import/export of
 * reference data. It is not mounted from App.tsx directly; it renders inside the
 * "Bulk" tab of RefDataModal (see RefDataModal.tsx, which App.tsx and
 * MobileLayout.tsx open via the Controls menu → Ref Data).
 *
 * Supported tables: nodes, segments (cable sections, including "wet" submarine
 * segments), systems (named submarine cables such as EAC or C2C), capacity, and
 * product coverage. Three import modes: "upsert" (add + overwrite), "add_only"
 * (never touch existing rows), and "full_replace" (destructive — deletes the
 * whole table first, and requires the user to type REPLACE to confirm).
 *
 * Workflow: pick a table and mode → drag-drop or browse for a .csv → Validate
 * (POST /api/bulk/validate/{table}?mode=...) which returns per-row errors,
 * warnings, a summary and a full added/modified/deleted diff for review →
 * Import (POST /api/bulk/import/{table}?mode=...). Current data can be exported
 * any time via GET /api/bulk/export/{table} (triggered as a browser download).
 *
 * Props: `counts` (row counts per table, shown on the selector pills) and
 * `onDataChange` (invoked after a successful import so the parent refetches all
 * network data). Side effects: triggers file downloads (table export and a CSV
 * audit log of the changes that were just applied); otherwise stateless between
 * openings. Import endpoints require admin (X-Admin-Token header set globally
 * in api/client.ts once the user unlocks admin mode).
 */
import { useRef, useState } from 'react'
import { useTheme } from '../theme'
import { api } from '../api/client'

// ── Types ──────────────────────────────────────────────────────────────────────

type BulkTable = 'nodes' | 'segments' | 'systems' | 'capacity' | 'coverage'
type BulkMode  = 'upsert' | 'add_only' | 'full_replace'

interface ValidationError {
  row_num: number
  id: string
  field: string
  value: string
  message: string
}

interface Change {
  status: 'added' | 'modified' | 'deleted'
  id: string
  data?: Record<string, unknown>
  prev_data?: Record<string, unknown>
  changed_fields?: string[]
}

interface ValidateResponse {
  table: string
  mode: string
  validation_errors: ValidationError[]
  warnings: ValidationError[]
  summary: {
    total_in_file: number
    added: number
    modified: number
    unchanged: number
    deleted: number
    kept_in_db: number
  }
  changes: Change[]
  can_import: boolean
}

interface ImportResult {
  status: string
  table: string
  mode: string
  applied: Record<string, number>
}

// ── Config ─────────────────────────────────────────────────────────────────────

const TABLE_META: Record<BulkTable, { label: string; icon: string; pk: string; cols: string[]; notes: string }> = {
  nodes: {
    label: 'Nodes', icon: '📍', pk: 'id',
    cols: ['id', 'name', 'lat', 'lng', 'type', 'country', 'owner', 'trading_name', 'city', 'street_address', 'description', 'verification_status', 'last_verified_date'],
    notes: 'type: landing_station | primary_pop | secondary_pop | extension_pop | branching_unit  ·  lat/lng: decimal degrees  ·  verification_status: draft | under_verification | verified  ·  Note: capabilities managed via Coverage tab',
  },
  segments: {
    label: 'Segments', icon: '🔗', pk: 'id',
    cols: ['id', 'name', 'system_id', 'start_node_id', 'end_node_id', 'type', 'length_km', 'latency', 'reliability', 'cost_weight', 'ownership', 'verification_status', 'last_verified_date'],
    notes: 'type: wet | terrestrial  ·  ownership: owned | iru | consortium | integrated_lit_lease | offnet_resell  ·  reliability: 0–1  ·  latency: ms, optional  ·  verification_status: draft | under_verification | verified  ·  Note: waypoints (cable routing) are preserved as-is and not exposed in bulk CSV',
  },
  systems: {
    label: 'Systems', icon: '🌊', pk: 'id',
    cols: ['id', 'name', 'description', 'margin'],
    notes: 'margin: 1.0–10.0 or blank',
  },
  capacity: {
    label: 'Capacity', icon: '◈', pk: 'segment_id',
    cols: ['segment_id', 'total_capacity_t', 'available_capacity_t'],
    notes: 'Values in Terabits (T)  ·  available cannot exceed total  ·  segment_id must exist in Segments',
  },
  coverage: {
    label: 'Coverage', icon: '🟢', pk: 'node_id',
    cols: ['node_id', 'ipt_speeds', 'epl_speeds', 'evpl_speeds', 'gid_speeds', 'ipvpn_speeds', 'colocation_category'],
    notes: 'Speeds as comma-separated list e.g. "1G,10G,100G"  ·  Backbone (ipt/epl/evpl): 1G|10G|100G|400G  ·  Underlay (gid/ipvpn): 1G|10G  ·  colocation_category: 1–5 or blank',
  },
}

const MODE_META: Record<BulkMode, { label: string; sub: string; risk: string; riskColor: string }> = {
  upsert: {
    label: 'Upsert', sub: 'Add new + overwrite changed. Rows in the database but not in the file are kept.',
    risk: 'Safe', riskColor: '#22c55e',
  },
  add_only: {
    label: 'Add Only', sub: 'Only insert rows with IDs that do not yet exist. Existing records are never touched.',
    risk: 'Safe', riskColor: '#22c55e',
  },
  full_replace: {
    label: 'Full Replace', sub: 'Delete all existing records for this table, then insert from the file. Irreversible.',
    risk: '⚠ Destructive', riskColor: '#ef4444',
  },
}

const DIFF_DISPLAY_LIMIT = 200

// ── Component ──────────────────────────────────────────────────────────────────

interface Props {
  counts: Record<BulkTable, number>
  onDataChange: () => void
}

export function BulkImportPanel({ counts, onDataChange }: Props) {
  const t = useTheme()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [table,       setTable]       = useState<BulkTable>('nodes')
  const [mode,        setMode]        = useState<BulkMode>('upsert')
  const [file,        setFile]        = useState<File | null>(null)
  const [dragOver,    setDragOver]    = useState(false)
  const [validating,  setValidating]  = useState(false)
  const [importing,   setImporting]   = useState(false)
  const [validation,  setValidation]  = useState<ValidateResponse | null>(null)
  const [result,      setResult]      = useState<ImportResult | null>(null)
  const [showFormat,  setShowFormat]  = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [errMsg,      setErrMsg]      = useState<string | null>(null)
  const [lastChanges, setLastChanges] = useState<Change[] | null>(null)

  const meta = TABLE_META[table]

  function resetForTable(t: BulkTable) {
    setTable(t); setFile(null); setValidation(null); setResult(null)
    setErrMsg(null); setConfirmText(''); setLastChanges(null)
  }

  function acceptFile(f: File | null) {
    if (!f) return
    if (!f.name.endsWith('.csv') && f.type !== 'text/csv') {
      setErrMsg('Please upload a .csv file')
      return
    }
    setFile(f); setValidation(null); setResult(null); setErrMsg(null)
  }

  async function handleValidate() {
    if (!file) return
    setValidating(true); setErrMsg(null)
    try {
      const res = await api.bulkValidate<ValidateResponse>(table, file, mode)
      setValidation(res)
    } catch (e: unknown) {
      setErrMsg(e instanceof Error ? e.message : 'Validation failed')
    } finally {
      setValidating(false)
    }
  }

  async function handleImport() {
    if (!file || !validation?.can_import) return
    if (mode === 'full_replace' && confirmText !== 'REPLACE') return
    setImporting(true); setErrMsg(null)
    try {
      const res = await api.bulkImport<ImportResult>(table, file, mode)
      setResult(res)
      setLastChanges(validation?.changes ?? null)
      setValidation(null); setFile(null); setConfirmText('')
      onDataChange()
    } catch (e: unknown) {
      setErrMsg(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setImporting(false)
    }
  }

  function downloadAuditLog(changes: Change[]) {
    const rows = changes.map(c => {
      const fieldChanges = c.changed_fields && c.prev_data && c.data
        ? c.changed_fields.map(f => `${f}: "${c.prev_data![f] ?? ''}" → "${c.data![f] ?? ''}"`).join(' | ')
        : ''
      return `${c.status},${c.id},"${fieldChanges}"`
    })
    const csv = ['status,id,changes', ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${table}_import_log_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  function handleDownload() {
    const url = api.bulkExportUrl(table)
    const a = document.createElement('a')
    a.href = url
    a.download = `${table}.csv`
    a.click()
  }

  // ── Styles ────────────────────────────────────────────────────────────────

  const card = (extra?: object) => ({
    background: t.bgCard, border: `1px solid ${t.border}`,
    borderRadius: 10, padding: '16px 18px', ...extra,
  })

  const pill = (active: boolean, color = t.blue) => ({
    padding: '6px 16px', borderRadius: 20, cursor: 'pointer', fontSize: 12,
    fontWeight: active ? 700 : 500, letterSpacing: '0.02em',
    border: active ? `1px solid ${color}` : `1px solid ${t.border}`,
    background: active ? color + '22' : 'transparent',
    color: active ? color : t.textMuted,
    transition: 'all 0.12s',
  })

  const label = (s?: object) => ({
    fontSize: 10, fontWeight: 800, letterSpacing: '0.1em',
    textTransform: 'uppercase' as const, color: t.blue, marginBottom: 10, ...s,
  })

  // ── Render ────────────────────────────────────────────────────────────────

  const TEAL = '#0ea5e9'

  return (
    <div style={{ padding: '20px 24px 40px', fontFamily: 'system-ui, sans-serif', color: t.text }}>

      {/* ── Header ── */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: t.text, marginBottom: 4 }}>
          🔄 Bulk Data Manager
        </div>
        <div style={{ fontSize: 12, color: t.textMuted, lineHeight: 1.5 }}>
          Export any reference table to CSV, edit in Excel or Google Sheets, then validate and reimport.
          The GUI remains the default for BAU updates — bulk import is for large data loads.
        </div>
      </div>

      {/* ── Table selector ── */}
      <div style={{ marginBottom: 24 }}>
        <div style={label()}>Table</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {(Object.keys(TABLE_META) as BulkTable[]).map(tb => (
            <button key={tb} onClick={() => resetForTable(tb)} style={pill(table === tb, TEAL) as React.CSSProperties}>
              {TABLE_META[tb].icon} {TABLE_META[tb].label}
              <span style={{ marginLeft: 6, opacity: 0.6, fontSize: 10 }}>({counts[tb]})</span>
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 20, alignItems: 'start' }}>

        {/* ── Left: Export ── */}
        <div>
          <div style={label()}>Export Current Data</div>
          <div style={card({ display: 'flex', flexDirection: 'column', gap: 12 })}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 26 }}>{meta.icon}</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: t.text }}>{meta.label}</div>
                <div style={{ fontSize: 11, color: t.textMuted }}>{counts[table]} rows in database</div>
              </div>
            </div>
            <button
              onClick={handleDownload}
              style={{
                padding: '9px 16px', borderRadius: 8, cursor: 'pointer',
                background: TEAL + '20', border: `1px solid ${TEAL}55`,
                color: TEAL, fontSize: 12, fontWeight: 700,
                display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center',
              }}
            >
              ⬇ Download {meta.label}.csv
            </button>
            <div style={{ fontSize: 10, color: t.textFaint, lineHeight: 1.5 }}>
              Opens in Excel / Google Sheets. Save as .csv when done.
            </div>
          </div>

          {/* Format guide */}
          <div style={{ marginTop: 12 }}>
            <button
              onClick={() => setShowFormat(v => !v)}
              style={{
                background: 'none', border: `1px solid ${t.border}`,
                borderRadius: 6, padding: '5px 10px', cursor: 'pointer',
                fontSize: 11, color: t.textMuted, width: '100%', textAlign: 'left',
              }}
            >
              {showFormat ? '▾' : '▸'} CSV Format Reference
            </button>
            {showFormat && (
              <div style={{ ...card({ marginTop: 6, padding: '12px 14px' }) }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: TEAL, marginBottom: 8 }}>
                  COLUMNS
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {meta.cols.map(col => (
                    <code key={col} style={{
                      fontSize: 10, color: t.blue, fontFamily: 'monospace',
                      background: t.bgDeep, borderRadius: 3, padding: '1px 5px',
                      display: 'inline-block', marginRight: 4, marginBottom: 2,
                    }}>{col}</code>
                  ))}
                </div>
                <div style={{ fontSize: 10, color: t.textMuted, lineHeight: 1.5, marginTop: 8 }}>
                  {meta.notes}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Right: Import ── */}
        <div>
          <div style={label()}>Import from CSV</div>

          {/* Drop zone */}
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => {
              e.preventDefault(); setDragOver(false)
              acceptFile(e.dataTransfer.files[0] ?? null)
            }}
            onClick={() => fileInputRef.current?.click()}
            style={{
              border: `2px dashed ${dragOver ? TEAL : file ? '#22c55e' : t.border}`,
              borderRadius: 10, padding: '28px 20px', textAlign: 'center',
              cursor: 'pointer', background: dragOver ? TEAL + '08' : file ? '#22c55e08' : 'transparent',
              transition: 'all 0.15s', marginBottom: 16,
            }}
          >
            <input
              ref={fileInputRef} type="file" accept=".csv"
              style={{ display: 'none' }}
              onChange={e => acceptFile(e.target.files?.[0] ?? null)}
            />
            {file ? (
              <>
                <div style={{ fontSize: 24, marginBottom: 6 }}>✅</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#22c55e' }}>{file.name}</div>
                <div style={{ fontSize: 11, color: t.textMuted, marginTop: 3 }}>
                  {(file.size / 1024).toFixed(1)} KB · click to change
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 28, marginBottom: 8, opacity: 0.5 }}>📂</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: t.textMuted }}>
                  Drop {meta.label}.csv here
                </div>
                <div style={{ fontSize: 11, color: t.textFaint, marginTop: 3 }}>
                  or click to browse
                </div>
              </>
            )}
          </div>

          {/* Mode selector */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: t.textMuted, marginBottom: 8, textTransform: 'uppercase' as const, letterSpacing: '0.07em' }}>Import Mode</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {(Object.keys(MODE_META) as BulkMode[]).map(m => {
                const mm = MODE_META[m]
                const active = mode === m
                return (
                  <button
                    key={m}
                    onClick={() => { setMode(m); setValidation(null); setConfirmText('') }}
                    style={{
                      textAlign: 'left', cursor: 'pointer', borderRadius: 8,
                      padding: '10px 14px',
                      border: active ? `1px solid ${mm.riskColor}55` : `1px solid ${t.border}`,
                      background: active ? mm.riskColor + '10' : 'transparent',
                      display: 'flex', alignItems: 'flex-start', gap: 10,
                    }}
                  >
                    <div style={{
                      width: 16, height: 16, borderRadius: '50%', flexShrink: 0, marginTop: 1,
                      border: `2px solid ${active ? mm.riskColor : t.border}`,
                      background: active ? mm.riskColor : 'transparent',
                    }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: active ? t.text : t.textMuted }}>
                          {mm.label}
                        </span>
                        <span style={{
                          fontSize: 9, fontWeight: 800, padding: '1px 6px', borderRadius: 3,
                          background: mm.riskColor + '20', color: mm.riskColor,
                          border: `1px solid ${mm.riskColor}44`, letterSpacing: '0.05em',
                        }}>{mm.risk}</span>
                      </div>
                      <div style={{ fontSize: 10, color: t.textMuted, lineHeight: 1.5 }}>{mm.sub}</div>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Validate button */}
          {!result && (
            <button
              onClick={handleValidate}
              disabled={!file || validating}
              style={{
                width: '100%', padding: '11px', borderRadius: 8, cursor: file ? 'pointer' : 'not-allowed',
                background: file ? TEAL : t.bgDeep, border: `1px solid ${file ? TEAL : t.border}`,
                color: file ? '#fff' : t.textFaint, fontSize: 13, fontWeight: 700,
                opacity: validating ? 0.7 : 1, transition: 'all 0.15s',
              }}
            >
              {validating ? '⏳ Validating…' : '→ Validate File'}
            </button>
          )}

          {/* Error message */}
          {errMsg && (
            <div style={{
              marginTop: 12, padding: '10px 14px', borderRadius: 8,
              background: '#ef444415', border: '1px solid #ef444440',
              fontSize: 12, color: '#f87171',
            }}>
              ❌ {errMsg}
            </div>
          )}
        </div>
      </div>

      {/* ── Success state ── */}
      {result && (
        <div style={{
          marginTop: 24, padding: '20px 24px', borderRadius: 10,
          background: '#22c55e12', border: '1px solid #22c55e44',
        }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#22c55e', marginBottom: 8 }}>
            ✅ Import complete
          </div>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            {Object.entries(result.applied).filter(([, v]) => v > 0).map(([k, v]) => (
              <div key={k}>
                <span style={{ fontSize: 20, fontWeight: 800, color: '#22c55e' }}>{v}</span>
                <span style={{ fontSize: 11, color: t.textMuted, marginLeft: 4 }}>{k}</span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            {lastChanges && lastChanges.length > 0 && (
              <button
                onClick={() => downloadAuditLog(lastChanges)}
                style={{
                  padding: '6px 14px', borderRadius: 6, cursor: 'pointer',
                  background: TEAL + '20', border: `1px solid ${TEAL}55`,
                  color: TEAL, fontSize: 11, fontWeight: 700,
                }}
              >
                ⬇ Download change log
              </button>
            )}
            <button
              onClick={() => { setResult(null); setLastChanges(null) }}
              style={{
                padding: '6px 14px', borderRadius: 6, cursor: 'pointer',
                background: 'none', border: `1px solid ${t.border}`, color: t.textMuted, fontSize: 11,
              }}
            >
              Import another file
            </button>
          </div>
        </div>
      )}

      {/* ── Validation results ── */}
      {validation && !result && (
        <div style={{ marginTop: 24 }}>
          <div style={label({ color: TEAL })}>Validation Results</div>

          {/* Errors */}
          {validation.validation_errors.length > 0 && (
            <div style={{
              ...card({ marginBottom: 16, borderColor: '#ef444455', background: '#ef444408' }),
            }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#f87171', marginBottom: 10 }}>
                ❌ {validation.validation_errors.length} error{validation.validation_errors.length !== 1 ? 's' : ''} — fix these before importing
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 200, overflowY: 'auto' }}>
                {validation.validation_errors.map((e, i) => (
                  <div key={i} style={{
                    display: 'grid', gridTemplateColumns: '40px 80px 120px 1fr',
                    gap: 8, padding: '5px 8px', borderRadius: 4,
                    background: '#ef444410', fontSize: 11, alignItems: 'baseline',
                  }}>
                    <span style={{ color: t.textFaint, fontFamily: 'monospace' }}>r{e.row_num}</span>
                    <code style={{ color: '#fca5a5', fontFamily: 'monospace', fontSize: 10 }}>{e.id || '—'}</code>
                    <code style={{ color: '#f87171', fontFamily: 'monospace', fontSize: 10 }}>.{e.field}</code>
                    <span style={{ color: '#fecaca' }}>{e.message}{e.value ? ` (got: "${e.value}")` : ''}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Warnings */}
          {validation.warnings && validation.warnings.length > 0 && (
            <div style={{
              ...card({ marginBottom: 16, borderColor: '#f59e0b55', background: '#f59e0b08' }),
            }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#fbbf24', marginBottom: 8 }}>
                ⚠ {validation.warnings.length} notice{validation.warnings.length !== 1 ? 's' : ''} — import will still proceed
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 160, overflowY: 'auto' }}>
                {validation.warnings.map((w, i) => (
                  <div key={i} style={{
                    display: 'grid', gridTemplateColumns: '40px 80px 1fr',
                    gap: 8, padding: '4px 8px', borderRadius: 4,
                    background: '#f59e0b10', fontSize: 11, alignItems: 'baseline',
                  }}>
                    <span style={{ color: t.textFaint, fontFamily: 'monospace' }}>r{w.row_num}</span>
                    <code style={{ color: '#fde68a', fontFamily: 'monospace', fontSize: 10 }}>{w.id || '—'}</code>
                    <span style={{ color: '#fef3c7' }}>{w.message}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Summary strip */}
          <div style={{
            ...card({ marginBottom: 16, padding: '14px 18px' }),
            display: 'flex', alignItems: 'center', gap: 0, flexWrap: 'wrap',
          }}>
            {[
              { n: validation.summary.total_in_file, l: 'rows in file',  c: t.textMuted },
              { n: validation.summary.added,         l: 'to add',        c: '#22c55e' },
              { n: validation.summary.modified,      l: 'to modify',     c: '#f59e0b' },
              { n: validation.summary.unchanged,     l: 'unchanged',     c: t.textFaint },
              ...(validation.summary.deleted > 0
                ? [{ n: validation.summary.deleted, l: 'to delete', c: '#ef4444' }]
                : []),
              ...(validation.summary.kept_in_db > 0
                ? [{ n: validation.summary.kept_in_db, l: 'kept in DB', c: t.textFaint }]
                : []),
            ].map(({ n, l, c }, i, arr) => (
              <span key={l} style={{ display: 'flex', alignItems: 'center' }}>
                <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '0 16px' }}>
                  <span style={{ fontSize: 22, fontWeight: 800, color: c, lineHeight: 1 }}>{n}</span>
                  <span style={{ fontSize: 10, color: t.textFaint, marginTop: 2 }}>{l}</span>
                </span>
                {i < arr.length - 1 && (
                  <span style={{ color: t.border, fontSize: 18 }}>│</span>
                )}
              </span>
            ))}
            {validation.can_import && (
              <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, color: '#22c55e' }}>
                ✓ Ready to import
              </span>
            )}
          </div>

          {/* Change diff */}
          {validation.changes.length > 0 && (
            <div style={card({ padding: 0, overflow: 'hidden' })}>
              <div style={{
                padding: '10px 16px', borderBottom: `1px solid ${t.border}`,
                fontSize: 11, fontWeight: 700, color: t.textMuted,
                display: 'flex', justifyContent: 'space-between',
              }}>
                <span>Changes</span>
                <span style={{ fontWeight: 400, color: t.textFaint }}>
                  {validation.changes.length > DIFF_DISPLAY_LIMIT
                    ? `Showing first ${DIFF_DISPLAY_LIMIT} of ${validation.changes.length}`
                    : `${validation.changes.length} row${validation.changes.length !== 1 ? 's' : ''}`}
                </span>
              </div>
              <div style={{ maxHeight: 340, overflowY: 'auto' }}>
                {validation.changes.slice(0, DIFF_DISPLAY_LIMIT).map((c, i) => {
                  const borderColor = c.status === 'added' ? '#22c55e' : c.status === 'deleted' ? '#ef4444' : '#f59e0b'
                  const bg = c.status === 'added' ? '#22c55e08' : c.status === 'deleted' ? '#ef444408' : '#f59e0b08'
                  const badge = c.status === 'added' ? '+ NEW' : c.status === 'deleted' ? '− DEL' : '~ MOD'
                  const badgeColor = borderColor
                  return (
                    <div key={`${c.status}-${c.id}-${i}`} style={{
                      display: 'flex', alignItems: 'flex-start', gap: 10,
                      padding: '8px 16px', borderBottom: `1px solid ${t.border}`,
                      background: bg, borderLeft: `3px solid ${borderColor}`,
                    }}>
                      <span style={{
                        fontSize: 9, fontWeight: 800, padding: '2px 5px', borderRadius: 3, flexShrink: 0,
                        background: badgeColor + '25', color: badgeColor,
                        border: `1px solid ${badgeColor}44`, letterSpacing: '0.06em', marginTop: 1,
                        fontFamily: 'monospace',
                      }}>{badge}</span>
                      <code style={{ fontSize: 11, fontWeight: 700, color: t.text, flexShrink: 0, minWidth: 80 }}>
                        {c.id}
                      </code>
                      {c.status === 'modified' && c.changed_fields && c.prev_data && c.data && (
                        <div style={{ flex: 1, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {c.changed_fields.map(field => (
                            <span key={field} style={{
                              fontSize: 10, background: t.bgDeep, borderRadius: 4,
                              padding: '2px 7px', border: `1px solid ${t.border}`,
                            }}>
                              <span style={{ color: t.textFaint }}>{field}: </span>
                              <span style={{ color: '#fca5a5', textDecoration: 'line-through' }}>
                                {String(c.prev_data![field] ?? '—').slice(0, 40)}
                              </span>
                              <span style={{ color: t.textFaint }}> → </span>
                              <span style={{ color: '#86efac' }}>
                                {String(c.data![field] ?? '—').slice(0, 40)}
                              </span>
                            </span>
                          ))}
                        </div>
                      )}
                      {c.status === 'added' && c.data && (
                        <div style={{ flex: 1, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                          {Object.entries(c.data).filter(([k]) => k !== meta.pk && String(c.data![k])).slice(0, 5).map(([k, v]) => (
                            <span key={k} style={{ fontSize: 10, color: t.textFaint }}>
                              <span style={{ color: t.textMuted }}>{k}:</span> {String(v).slice(0, 30)}
                            </span>
                          ))}
                        </div>
                      )}
                      {c.status === 'deleted' && c.prev_data && (
                        <div style={{ flex: 1, fontSize: 10, color: t.textFaint }}>
                          {String(c.prev_data.name || c.prev_data.segment_id || '').slice(0, 60)}
                        </div>
                      )}
                    </div>
                  )
                })}
                {validation.changes.length > DIFF_DISPLAY_LIMIT && (
                  <div style={{ padding: '10px 16px', fontSize: 11, color: t.textFaint, textAlign: 'center' }}>
                    …and {validation.changes.length - DIFF_DISPLAY_LIMIT} more rows (all counted in summary above)
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Full Replace confirmation */}
          {mode === 'full_replace' && validation.can_import && (
            <div style={{
              ...card({ marginTop: 16, borderColor: '#ef444455', background: '#ef444408' }),
            }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#f87171', marginBottom: 8 }}>
                ⚠ Full Replace will permanently delete all {counts[table]} existing {table} records before importing.
              </div>
              <div style={{ fontSize: 11, color: t.textMuted, marginBottom: 10 }}>
                Type <strong style={{ color: '#f87171', fontFamily: 'monospace' }}>REPLACE</strong> to confirm:
              </div>
              <input
                value={confirmText}
                onChange={e => setConfirmText(e.target.value)}
                placeholder="REPLACE"
                style={{
                  background: t.bgDeep, border: `1px solid ${confirmText === 'REPLACE' ? '#ef4444' : t.border}`,
                  borderRadius: 6, padding: '7px 10px', color: '#f87171',
                  fontSize: 13, fontFamily: 'monospace', width: 140,
                }}
              />
            </div>
          )}

          {/* Apply button */}
          {validation.can_import && (
            <button
              onClick={handleImport}
              disabled={importing || (mode === 'full_replace' && confirmText !== 'REPLACE')}
              style={{
                marginTop: 16, width: '100%', padding: '12px', borderRadius: 8,
                cursor: (importing || (mode === 'full_replace' && confirmText !== 'REPLACE')) ? 'not-allowed' : 'pointer',
                background: mode === 'full_replace'
                  ? (confirmText === 'REPLACE' ? '#ef4444' : '#ef444440')
                  : '#22c55e',
                border: 'none', color: '#fff', fontSize: 14, fontWeight: 800,
                opacity: importing ? 0.7 : 1, transition: 'all 0.15s',
              }}
            >
              {importing
                ? '⏳ Applying…'
                : mode === 'full_replace'
                  ? `⚠ Replace all ${table} (${validation.summary.total_in_file} rows)`
                  : `✓ Apply Import — ${validation.summary.added} added, ${validation.summary.modified} modified`}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
