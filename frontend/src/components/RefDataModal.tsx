import { useState, useEffect, useRef } from 'react'
import type { AppConfig, CableNode, CableSegment, CableSystem, DisallowedPair, AllowedPair, AllowedHandoffSegment, InterconnectRule, NoteCategory, NoteSeverity, OnNet, SegmentCapacity, SegmentOutage, SolutionNote, VerificationStatus } from '../types'
import { useTheme, type Theme } from '../theme'
function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(() => window.innerWidth < 768)
  useEffect(() => {
    const fn = () => setMobile(window.innerWidth < 768)
    window.addEventListener('resize', fn)
    return () => window.removeEventListener('resize', fn)
  }, [])
  return mobile
}
import { api } from '../api/client'
import { ProductCoveragePanel } from './ProductCoveragePanel'
import { BulkImportPanel } from './BulkImportPanel'
import { TechEnrichmentPanel } from './TechEnrichmentPanel'

// ── Verification status components — module-level so React never remounts them
// on a parent re-render (which would swallow busy/error state mid-save).

const VERIF_COLOURS: Record<string, string> = {
  draft: '#ef4444',
  under_verification: '#f59e0b',
  verified: '#22c55e',
}
const VERIF_LABELS: Record<string, string> = {
  draft: 'Draft',
  under_verification: 'Under Verification',
  verified: 'Verified',
}

function OnNetBadge({ value }: { value?: OnNet }) {
  if (!value) return null
  const isOn = value === 'on_net'
  const style: React.CSSProperties = {
    display: 'inline-block', padding: '2px 7px', borderRadius: 10,
    fontSize: 10, fontWeight: 700, letterSpacing: '0.04em',
    background: isOn ? '#22c55e22' : '#94a3b822',
    color: isOn ? '#22c55e' : '#94a3b8',
    border: `1px solid ${isOn ? '#22c55e55' : '#94a3b855'}`,
    whiteSpace: 'nowrap',
  }
  return <span style={style}>{isOn ? 'On-Net' : 'Off-Net'}</span>
}

function VerifBadge({ status, onClick }: { status?: VerificationStatus; onClick?: () => void }) {
  const s = status ?? 'draft'
  const style: React.CSSProperties = {
    display: 'inline-block', padding: '2px 7px', borderRadius: 10,
    fontSize: 10, fontWeight: 700, letterSpacing: '0.04em',
    background: VERIF_COLOURS[s] + '22', color: VERIF_COLOURS[s],
    border: `1px solid ${VERIF_COLOURS[s]}55`,
    whiteSpace: 'nowrap',
    ...(onClick ? { cursor: 'pointer', userSelect: 'none' } : {}),
  }
  return onClick
    ? <button onClick={onClick} style={{ ...style, fontFamily: 'inherit' }}>{VERIF_LABELS[s]} ✎</button>
    : <span style={style}>{VERIF_LABELS[s]}</span>
}

function VerifPrompt({ onChoice, onDismiss, theme }: {
  onChoice: (status: VerificationStatus) => Promise<void>
  onDismiss: () => void
  theme: Theme
}) {
  const [busy, setBusy] = useState(false)
  const [promptError, setPromptError] = useState<string | null>(null)

  async function pick(status: VerificationStatus) {
    setBusy(true); setPromptError(null)
    try { await onChoice(status) }
    catch (e) { setPromptError(String(e)); setBusy(false) }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 11000,
      background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 12,
        padding: 28, width: 'min(94vw,380px)', boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
      }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: theme.text, marginBottom: 8 }}>Update verification status?</div>
        <div style={{ fontSize: 13, color: theme.textMuted, marginBottom: 20 }}>
          What's this record's verification state?
        </div>
        {promptError && (
          <div style={{ fontSize: 12, color: '#ef4444', background: '#ef444422', border: '1px solid #ef444444', borderRadius: 6, padding: '8px 10px', marginBottom: 14 }}>
            Save failed: {promptError}
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {([
            { status: 'verified'           as VerificationStatus, label: '✓ Verified — data confirmed correct',         bg: '#22c55e22', color: '#22c55e' },
            { status: 'under_verification' as VerificationStatus, label: '⏳ Under Verification — still being checked',  bg: '#f59e0b22', color: '#f59e0b' },
            { status: 'draft'              as VerificationStatus, label: 'Keep as Draft',                                bg: 'transparent', color: theme.textMuted },
          ] as const).map(({ status, label, bg, color }) => (
            <button key={status} disabled={busy} onClick={() => pick(status)} style={{
              padding: '9px 14px', borderRadius: 7,
              border: status === 'draft' ? `1px solid ${theme.border}` : 'none',
              cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.6 : 1,
              background: bg, color, fontWeight: 700, fontSize: 13, fontFamily: 'inherit', textAlign: 'left',
            }}>{busy ? '…' : label}</button>
          ))}
          <button onClick={onDismiss} style={{
            marginTop: 4, padding: '7px 14px', borderRadius: 7,
            border: `1px solid ${theme.border}`, cursor: 'pointer',
            background: 'transparent', color: theme.textFaint, fontSize: 12, fontFamily: 'inherit',
          }}>Cancel — keep current status</button>
        </div>
      </div>
    </div>
  )
}

// ── Stable module-level form components ──────────────────────────────────────
// These MUST live outside RefDataModal so React sees a stable component type
// on every render. Defining them inside the parent causes remount on each
// keystroke, which kills input focus.

function Field({ label, val, k, src, setSrc, readOnly = false, type = 'text', options, placeholder, pairedKey, pairedFirst, multiline }: {
  label: string; val?: unknown; k: string
  src: Record<string, unknown>; setSrc: (v: Record<string, unknown>) => void
  readOnly?: boolean; type?: string; options?: { value: string; label: string }[]
  placeholder?: string
  pairedKey?: string    // sibling field key for lat/lng pair paste
  pairedFirst?: boolean // true if this field holds the first value (lat) in the pair
  multiline?: boolean   // renders a full-width textarea spanning all columns
}) {
  const t = useTheme()
  const inputStyle: React.CSSProperties = {
    background: t.bgInput, border: `1px solid ${t.border}`, borderRadius: 3,
    color: t.text, fontSize: 12, padding: '3px 6px', width: '100%', boxSizing: 'border-box',
    fontFamily: 'inherit',
  }
  const roStyle: React.CSSProperties = { ...inputStyle, opacity: 0.45, cursor: 'not-allowed' }

  // Keep the raw string while the user is mid-typing (e.g. "-", "3.", "-0.")
  // Only store a parsed float once the string is unambiguously a complete number.
  const parseNum = (raw: string): string | number => {
    if (raw === '' || raw === '-' || raw === '.' || raw === '-.') return raw
    const f = parseFloat(raw)
    return isNaN(f) ? (src[k] as number ?? 0) : f
  }

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    if (type !== 'number' || !pairedKey) return
    const text = e.clipboardData.getData('text').trim()
    // Detect "lat, lng" or "lat lng" pair (e.g. copied from Google Maps)
    const parts = text.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean)
    if (parts.length >= 2) {
      const first = parseFloat(parts[0])
      const second = parseFloat(parts[1])
      if (!isNaN(first) && !isNaN(second)) {
        e.preventDefault()
        setSrc({
          ...src,
          [k]:         pairedFirst ? first  : second,
          [pairedKey]: pairedFirst ? second : first,
        })
      }
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, ...(multiline ? { gridColumn: '1 / -1' } : {}) }}>
      <label style={{ fontSize: 10, color: t.textFaint, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</label>
      {readOnly ? (
        <input style={roStyle} value={String(val ?? '')} readOnly autoComplete="off" />
      ) : multiline ? (
        <textarea
          style={{ ...inputStyle, resize: 'vertical', minHeight: 64, lineHeight: 1.5 }}
          rows={3}
          placeholder={placeholder}
          value={String(src[k] ?? '')}
          onChange={e => setSrc({ ...src, [k]: e.target.value })}
        />
      ) : options ? (
        <select style={inputStyle} value={String(src[k] ?? '')} onChange={e => setSrc({ ...src, [k]: e.target.value })}>
          {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : (
        <input
          style={inputStyle}
          type={type === 'number' ? 'text' : type}
          inputMode={type === 'number' ? 'decimal' : undefined}
          autoComplete="off"
          placeholder={placeholder}
          value={String(src[k] ?? '')}
          onChange={e => setSrc({ ...src, [k]: type === 'number' ? parseNum(e.target.value) : e.target.value })}
          onPaste={handlePaste}
        />
      )}
    </div>
  )
}

function NodeSearchField({ label, k, src, setSrc, nodes }: {
  label: string; k: string
  src: Record<string, unknown>; setSrc: (v: Record<string, unknown>) => void
  nodes: CableNode[]
}) {
  const t = useTheme()
  const inputStyle: React.CSSProperties = {
    background: t.bgInput, border: `1px solid ${t.border}`, borderRadius: 3,
    color: t.text, fontSize: 12, padding: '3px 6px', width: '100%', boxSizing: 'border-box',
    fontFamily: 'inherit',
  }
  const currentId = String(src[k] ?? '')
  const currentNode = nodes.find(n => n.id === currentId)
  const [query, setQuery] = useState(currentId)
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setQuery(currentId) }, [currentId])

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const q = query.trim().toLowerCase()
  const hits = nodes.filter(n =>
    q === '' || n.id.toLowerCase().includes(q) || n.name.toLowerCase().includes(q) ||
    (n.city ?? '').toLowerCase().includes(q) || (n.country ?? '').toLowerCase().includes(q) ||
    (n.trading_name ?? '').toLowerCase().includes(q)
  ).slice(0, 20)

  const isValid = !!currentNode
  const isEmpty = currentId === ''
  const borderColor = isEmpty ? t.border : isValid ? t.green : t.red

  return (
    <div ref={wrapRef} style={{ display: 'flex', flexDirection: 'column', gap: 2, position: 'relative' }}>
      <label style={{ fontSize: 10, color: t.textFaint, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</label>
      <input
        style={{ ...inputStyle, borderColor, paddingRight: isValid ? 22 : undefined }}
        value={query}
        placeholder="Search ID, name, city, country…"
        autoComplete="off"
        onChange={e => {
          setQuery(e.target.value)
          setOpen(true)
          if (e.target.value !== currentId) setSrc({ ...src, [k]: '' })
        }}
        onFocus={() => setOpen(true)}
      />
      {isValid && (
        <span style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(25%)', fontSize: 10, color: t.green, pointerEvents: 'none' }}>✓</span>
      )}
      {open && hits.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 9999,
          background: t.bgPanel, border: `1px solid ${t.border}`, borderRadius: 4,
          boxShadow: '0 4px 16px rgba(0,0,0,0.4)', maxHeight: 220, overflowY: 'auto',
        }}>
          {hits.map(n => (
            <div
              key={n.id}
              onMouseDown={e => {
                e.preventDefault()
                setSrc({ ...src, [k]: n.id })
                setQuery(n.id)
                setOpen(false)
              }}
              style={{
                padding: '5px 9px', cursor: 'pointer', fontSize: 12,
                borderBottom: `1px solid ${t.border}`,
                background: n.id === currentId ? `${t.blue}22` : 'transparent',
                display: 'flex', gap: 8, alignItems: 'baseline',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = `${t.blue}33`)}
              onMouseLeave={e => (e.currentTarget.style.background = n.id === currentId ? `${t.blue}22` : 'transparent')}
            >
              <code style={{ fontSize: 11, color: t.blue, flexShrink: 0 }}>{n.id}</code>
              <span style={{ color: t.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.name}</span>
              <span style={{ color: t.textFaint, fontSize: 10, flexShrink: 0 }}>{n.city ?? n.country}</span>
            </div>
          ))}
        </div>
      )}
      {!isEmpty && !isValid && (
        <span style={{ fontSize: 10, color: t.red, marginTop: 1 }}>No node with ID "{currentId || query}" found</span>
      )}
      {isValid && currentNode && (
        <span style={{ fontSize: 10, color: t.textFaint, marginTop: 1 }}>{currentNode.name} · {currentNode.country}</span>
      )}
    </div>
  )
}

function SegmentSearchField({ label, k, src, setSrc, segments }: {
  label: string; k: string
  src: Record<string, unknown>; setSrc: (v: Record<string, unknown>) => void
  segments: CableSegment[]
}) {
  const t = useTheme()
  const inputStyle: React.CSSProperties = {
    background: t.bgInput, border: `1px solid ${t.border}`, borderRadius: 3,
    color: t.text, fontSize: 12, padding: '3px 6px', width: '100%', boxSizing: 'border-box',
    fontFamily: 'inherit',
  }
  const currentId = String(src[k] ?? '')
  const currentSeg = segments.find(s => s.id === currentId)
  const [query, setQuery] = useState(currentId)
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setQuery(currentId) }, [currentId])

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const q = query.trim().toLowerCase()
  const hits = segments.filter(s =>
    q === '' || s.id.toLowerCase().includes(q) || s.name.toLowerCase().includes(q) ||
    s.system_id.toLowerCase().includes(q) ||
    s.start_node_id.toLowerCase().includes(q) || s.end_node_id.toLowerCase().includes(q)
  ).slice(0, 20)

  const isValid = !!currentSeg
  const isEmpty = currentId === ''
  const borderColor = isEmpty ? t.border : isValid ? t.green : t.red

  return (
    <div ref={wrapRef} style={{ display: 'flex', flexDirection: 'column', gap: 2, position: 'relative' }}>
      <label style={{ fontSize: 10, color: t.textFaint, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</label>
      <input
        style={{ ...inputStyle, borderColor, paddingRight: isValid ? 22 : undefined }}
        value={query}
        placeholder="Search ID, name, system or end nodes…"
        autoComplete="off"
        onChange={e => {
          setQuery(e.target.value)
          setOpen(true)
          if (e.target.value !== currentId) setSrc({ ...src, [k]: '' })
        }}
        onFocus={() => setOpen(true)}
      />
      {isValid && (
        <span style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(25%)', fontSize: 10, color: t.green, pointerEvents: 'none' }}>✓</span>
      )}
      {open && hits.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 9999,
          background: t.bgPanel, border: `1px solid ${t.border}`, borderRadius: 4,
          boxShadow: '0 4px 16px rgba(0,0,0,0.4)', maxHeight: 220, overflowY: 'auto',
        }}>
          {hits.map(s => (
            <div
              key={s.id}
              onMouseDown={e => {
                e.preventDefault()
                setSrc({ ...src, [k]: s.id })
                setQuery(s.id)
                setOpen(false)
              }}
              style={{
                padding: '5px 9px', cursor: 'pointer', fontSize: 12,
                borderBottom: `1px solid ${t.border}`,
                background: s.id === currentId ? `${t.green}22` : 'transparent',
                display: 'flex', gap: 8, alignItems: 'baseline',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = `${t.green}33`)}
              onMouseLeave={e => (e.currentTarget.style.background = s.id === currentId ? `${t.green}22` : 'transparent')}
            >
              <code style={{ fontSize: 11, color: t.green, flexShrink: 0 }}>{s.id}</code>
              <span style={{ color: t.textFaint, fontSize: 10, flexShrink: 0 }}>{s.system_id}</span>
              <span style={{ color: t.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
            </div>
          ))}
        </div>
      )}
      {!isEmpty && !isValid && (
        <span style={{ fontSize: 10, color: t.red, marginTop: 1 }}>No segment with ID "{currentId || query}" found</span>
      )}
      {isValid && currentSeg && (
        <span style={{ fontSize: 10, color: t.textFaint, marginTop: 1 }}>{currentSeg.system_id} · {currentSeg.name}</span>
      )}
    </div>
  )
}

const OWNERSHIP_LABEL: Record<string, string> = {
  owned:                'Owned',
  consortium:           'Consortium',
  iru:                  'IRU',
  integrated_lit_lease: 'Int. Lit Lease',
  offnet_resell:        'Offnet Resell',
}

const DEFAULT_ONNET = ['owned', 'consortium', 'iru']

type DataTab = 'nodes' | 'segments' | 'systems' | 'capacity' | 'outages' | 'rules'
type Tab = DataTab | 'checks' | 'config' | 'coverage' | 'bulk' | 'tech' | 'notes'

interface CheckResult {
  name: string
  passed: boolean
  severity: string
  message: string
}

interface Props {
  nodes: CableNode[]
  segments: CableSegment[]
  systems: CableSystem[]
  capacity: SegmentCapacity[]
  outages: SegmentOutage[]
  rules: InterconnectRule[]
  config: AppConfig
  onDataChange: () => void
  onClose: () => void
  initialNoteFocus?: { kind: 'node' | 'segment'; id: string }
}

export function RefDataModal({ nodes, segments, systems, capacity, outages, rules, config, onDataChange, onClose, initialNoteFocus }: Props) {
  const t = useTheme()
  const isMobile = useIsMobile()
  const [tab, setTab] = useState<Tab>(initialNoteFocus ? 'notes' : 'nodes')
  const [editId, setEditId] = useState<string | null>(null)
  const [editValues, setEditValues] = useState<Record<string, unknown>>({})
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [addValues, setAddValues] = useState<Record<string, unknown>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [showRulesHelp, setShowRulesHelp] = useState(false)
  const [onNetOwnership, setOnNetOwnership] = useState<Set<string>>(() => new Set(config.on_net_ownership))
  const [capSegmentOpen, setCapSegmentOpen] = useState(false)

  function isOnNet(ownership: string) { return onNetOwnership.has(ownership) }

  async function toggleOnNet(ownership: string) {
    const next = new Set(onNetOwnership)
    if (next.has(ownership)) next.delete(ownership)
    else next.add(ownership)
    setOnNetOwnership(next)
    await api.updateConfig({ on_net_ownership: [...next] })
    onDataChange()
  }

  function resetState() {
    setEditId(null); setEditValues({})
    setDeleteConfirmId(null)
    setAdding(false); setAddValues({})
    setError(null); setFilter('')
  }

  function switchTab(next: Tab) { resetState(); setTab(next) }

  function startEdit(id: string, values: Record<string, unknown>) {
    setAdding(false); setDeleteConfirmId(null)
    setEditId(id); setEditValues({ ...values })
  }

  function startAdd(defaults: Record<string, unknown>) {
    setEditId(null); setDeleteConfirmId(null)
    setAdding(true); setAddValues({ ...defaults })
  }

  async function saveEdit(saveCall: () => Promise<unknown>, skipRefresh = false) {
    setSaving(true); setError(null)
    try { await saveCall(); if (!skipRefresh) onDataChange(); setEditId(null) }
    catch (e) { setError(String(e)) }
    finally { setSaving(false) }
  }

  async function saveAdd(saveCall: () => Promise<unknown>) {
    setSaving(true); setError(null)
    try { await saveCall(); onDataChange(); setAdding(false); setAddValues({}) }
    catch (e) { setError(String(e)) }
    finally { setSaving(false) }
  }

  async function confirmDelete(deleteCall: () => Promise<void>) {
    setSaving(true); setError(null)
    try { await deleteCall(); onDataChange(); setDeleteConfirmId(null) }
    catch (e) { setError(String(e)) }
    finally { setSaving(false) }
  }

  // ── Styles ──────────────────────────────────────────────────────────────────

  const modalBg: React.CSSProperties = {
    position: 'fixed', inset: 0, zIndex: 2000,
    background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center',
  }

  const modalBox: React.CSSProperties = isMobile ? {
    position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column',
    background: t.bgPanel, overflow: 'hidden',
    fontFamily: 'system-ui, sans-serif',
  } : {
    width: '92vw', height: '88vh', display: 'flex', flexDirection: 'column',
    background: t.bgPanel, borderRadius: 8, border: `1px solid ${t.border}`,
    boxShadow: '0 8px 40px rgba(0,0,0,0.5)', overflow: 'hidden',
    fontFamily: 'system-ui, sans-serif',
  }

  const colH = (flex: number): React.CSSProperties => ({
    flex, fontSize: 10, fontWeight: 700, color: t.textFaint,
    textTransform: 'uppercase', letterSpacing: '0.06em', padding: '0 6px',
  })

  const cell = (flex: number): React.CSSProperties => ({
    flex, fontSize: 12, color: t.text, padding: '0 6px',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  })

  const inputStyle: React.CSSProperties = {
    background: t.bgInput, border: `1px solid ${t.border}`, borderRadius: 3,
    color: t.text, fontSize: 12, padding: '3px 6px', width: '100%', boxSizing: 'border-box',
    fontFamily: 'inherit',
  }

  const actionBtn = (variant: 'edit' | 'delete' | 'confirm' | 'save' | 'cancel' | 'add'): React.CSSProperties => {
    const colors: Record<string, string> = {
      edit: t.blue, delete: t.textFaint, confirm: t.red, save: t.green, cancel: t.textFaint, add: t.blue,
    }
    return {
      padding: '3px 9px', borderRadius: 3, border: `1px solid ${colors[variant]}`,
      background: 'transparent', color: colors[variant],
      fontSize: 11, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
    }
  }

  const rowStyle = (isEditing: boolean): React.CSSProperties => ({
    borderBottom: `1px solid ${t.border}`,
    background: isEditing ? t.bgDeep : 'transparent',
  })

  const editFormRow: React.CSSProperties = {
    display: 'grid', gap: 8, padding: '10px 12px',
    gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
    borderBottom: `1px solid ${t.border}`, background: t.bgDeep,
  }

  function ActionsCell({ id, onEdit, onDelete }: { id: string; onEdit?: () => void; onDelete: () => void }) {
    return (
      <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end', padding: '0 6px', flexShrink: 0, minWidth: 140 }}>
        {deleteConfirmId === id ? (
          <>
            <button style={actionBtn('confirm')} disabled={saving} onClick={onDelete}>Confirm</button>
            <button style={actionBtn('cancel')} onClick={() => setDeleteConfirmId(null)}>Cancel</button>
          </>
        ) : (
          <>
            {onEdit && <button style={actionBtn('edit')} onClick={onEdit}>Edit</button>}
            <button style={actionBtn('delete')} onClick={() => { setEditId(null); setDeleteConfirmId(id) }}>Delete</button>
          </>
        )}
      </div>
    )
  }

  function SaveCancel({ onSave, onCancel, disabled, disabledReason }: { onSave: () => void; onCancel: () => void; disabled?: boolean; disabledReason?: string }) {
    return (
      <div style={{ display: 'flex', gap: 6, gridColumn: '1 / -1', marginTop: 4, alignItems: 'center' }}>
        <button style={{ ...actionBtn('save'), opacity: (saving || disabled) ? 0.45 : 1, cursor: (saving || disabled) ? 'not-allowed' : 'pointer' }} disabled={saving || disabled} onClick={onSave}>{saving ? 'Saving…' : 'Save'}</button>
        <button style={actionBtn('cancel')} onClick={onCancel}>Cancel</button>
        {disabled && disabledReason && <span style={{ fontSize: 11, color: t.red, marginLeft: 8 }}>{disabledReason}</span>}
        {error && <span style={{ fontSize: 11, color: t.red, marginLeft: 8 }}>{error}</span>}
      </div>
    )
  }

  // ── Mobile card component ────────────────────────────────────────────────────

  function MobileCard({ id, title, subtitle, fields, onEdit, onDelete, children }: {
    id: string
    title: React.ReactNode
    subtitle?: React.ReactNode
    fields?: { label: string; value: React.ReactNode }[]
    onEdit?: () => void
    onDelete: () => void
    children?: React.ReactNode
  }) {
    const isEditing = editId === id
    return (
      <div style={{
        margin: '0 12px 8px', borderRadius: 8,
        border: `1px solid ${isEditing ? t.blue : t.border}`,
        background: isEditing ? `${t.blue}08` : t.bgCard,
        overflow: 'hidden',
      }}>
        <div style={{ padding: '10px 12px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: fields?.length ? 6 : 0 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: t.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
              {subtitle && <div style={{ fontSize: 11, color: t.textMuted, marginTop: 1 }}>{subtitle}</div>}
            </div>
            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
              {deleteConfirmId === id ? (
                <>
                  <button style={{ ...actionBtn('confirm'), padding: '5px 10px' }} disabled={saving} onClick={onDelete}>Delete?</button>
                  <button style={{ ...actionBtn('cancel'), padding: '5px 10px' }} onClick={() => setDeleteConfirmId(null)}>Cancel</button>
                </>
              ) : (
                <>
                  {onEdit && <button style={{ ...actionBtn('edit'), padding: '5px 12px' }} onClick={onEdit}>{isEditing ? '✕' : 'Edit'}</button>}
                  {!isEditing && <button style={{ ...actionBtn('delete'), padding: '5px 10px' }} onClick={() => { setEditId(null); setDeleteConfirmId(id) }}>✕</button>}
                </>
              )}
            </div>
          </div>
          {fields && fields.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px' }}>
              {fields.map(f => (
                <div key={f.label}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: t.textFaintest, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{f.label}</div>
                  <div style={{ fontSize: 11, color: t.text }}>{f.value}</div>
                </div>
              ))}
            </div>
          )}
        </div>
        {children}
      </div>
    )
  }

  const typeOpts    = [
    { value: 'landing_station', label: 'CLS (Landing Station)' },
    { value: 'primary_pop',     label: 'Primary PoP' },
    { value: 'secondary_pop',   label: 'Secondary PoP' },
    { value: 'extension_pop',   label: 'Extension PoP' },
    { value: 'branching_unit',  label: 'BU (Branching Unit)' },
    { value: 'off_net',         label: 'Off-Net Node' },
  ]
  const onNetOpts = [
    { value: '',        label: '— Not set —' },
    { value: 'on_net',  label: 'On-Net' },
    { value: 'off_net', label: 'Off-Net' },
  ]
  const segTypeOpts = [{ value: 'wet', label: 'Wet' }, { value: 'terrestrial', label: 'Terrestrial' }]
  const ownerOpts   = [
    { value: 'owned',                label: 'Owned' },
    { value: 'consortium',           label: 'Consortium' },
    { value: 'iru',                  label: 'IRU' },
    { value: 'integrated_lit_lease', label: 'Integrated Lit Lease' },
    { value: 'offnet_resell',        label: 'Offnet Resell' },
  ]
  const systemOpts  = systems.map(s => ({ value: s.id, label: `${s.id} — ${s.name}` }))

  // ── Nodes tab ───────────────────────────────────────────────────────────────

  const [nodeVerifPending, setNodeVerifPending] = useState<string | null>(null)

  async function applyNodeVerif(id: string, status: VerificationStatus) {
    const date = status === 'verified' ? new Date().toISOString().slice(0, 10) : undefined
    await api.updateNode(id, { verification_status: status, last_verified_date: date })
    setNodeVerifPending(null)  // close dialog before triggering re-render
    onDataChange()
  }

  function NodeTab() {
    const q = filter.toLowerCase()
    const filtered = nodes.filter(n =>
      !filter || [n.id, n.name, n.country, n.type, n.owner ?? '', n.trading_name ?? '', n.city ?? '', n.street_address ?? '', n.description ?? ''].some(v => v.toLowerCase().includes(q))
    )
    const editForm = (n: CableNode) => (
      <div style={{ ...editFormRow }}>
        <Field label="Name"         k="name"         src={editValues} setSrc={setEditValues} />
        <Field label="Country"      k="country"      src={editValues} setSrc={setEditValues} />
        <Field label="Type"         k="type"         src={editValues} setSrc={setEditValues} options={typeOpts} />
        <Field label="On-Net Status" k="on_net"      src={editValues} setSrc={setEditValues} options={onNetOpts} />
        <Field label="Owner"        k="owner"        src={editValues} setSrc={setEditValues} />
        <Field label="Lat"          k="lat"          src={editValues} setSrc={setEditValues} type="number" pairedKey="lng" pairedFirst={true} />
        <Field label="Lng"          k="lng"          src={editValues} setSrc={setEditValues} type="number" pairedKey="lat" pairedFirst={false} />
        <Field label="Trading Name"   k="trading_name"   src={editValues} setSrc={setEditValues} />
        <Field label="City"           k="city"           src={editValues} setSrc={setEditValues} />
        <Field label="Street Address" k="street_address" src={editValues} setSrc={setEditValues} />
        <Field label="Description"    k="description"    src={editValues} setSrc={setEditValues} />
        <SaveCancel
          onSave={async () => { await saveEdit(() => api.updateNode(n.id, editValues as Partial<CableNode>)) }}
          onCancel={() => setEditId(null)}
        />
      </div>
    )
    const editDefaults = (n: CableNode) => ({ name: n.name, country: n.country, type: n.type, lat: n.lat, lng: n.lng, owner: n.owner ?? '', trading_name: n.trading_name ?? '', city: n.city ?? '', street_address: n.street_address ?? '', description: n.description ?? '', on_net: n.on_net ?? '' })
    return (
      <>
        {adding && (
          <div style={{ ...editFormRow, margin: isMobile ? '8px 12px' : undefined }}>
            <Field label="ID *"         k="id"           src={addValues} setSrc={setAddValues} />
            <Field label="Name *"       k="name"         src={addValues} setSrc={setAddValues} />
            <Field label="Country"      k="country"      src={addValues} setSrc={setAddValues} />
            <Field label="Type"         k="type"         src={addValues} setSrc={setAddValues} options={typeOpts} />
            <Field label="On-Net Status" k="on_net"      src={addValues} setSrc={setAddValues} options={onNetOpts} />
            <Field label="Owner"        k="owner"        src={addValues} setSrc={setAddValues} />
            <Field label="Lat"          k="lat"          src={addValues} setSrc={setAddValues} type="number" pairedKey="lng" pairedFirst={true} />
            <Field label="Lng"          k="lng"          src={addValues} setSrc={setAddValues} type="number" pairedKey="lat" pairedFirst={false} />
            <Field label="Trading Name"   k="trading_name"   src={addValues} setSrc={setAddValues} />
            <Field label="City"           k="city"           src={addValues} setSrc={setAddValues} />
            <Field label="Street Address" k="street_address" src={addValues} setSrc={setAddValues} />
            <Field label="Description"    k="description"    src={addValues} setSrc={setAddValues} />
            <SaveCancel
              onSave={() => saveAdd(() => api.createNode(addValues as unknown as CableNode))}
              onCancel={() => { setAdding(false); setAddValues({}) }}
            />
          </div>
        )}
        {isMobile ? (
          <div style={{ padding: '8px 0 32px' }}>
            {filtered.map(n => (
              <MobileCard key={n.id}
                id={n.id}
                title={n.name}
                subtitle={<><code style={{ fontSize: 10 }}>{n.id}</code> · {n.country} · {n.type === 'landing_station' ? 'CLS' : n.type === 'branching_unit' ? 'BU' : n.type === 'primary_pop' ? '1°PoP' : n.type === 'secondary_pop' ? '2°PoP' : n.type === 'off_net' ? 'Off-Net' : 'ExtPoP'}</>}
                fields={[
                  { label: 'On-Net', value: <OnNetBadge value={n.on_net} /> },
                  { label: 'City', value: n.city ?? '—' },
                  { label: 'Owner', value: n.owner ?? '—' },
                  { label: 'Trading Name', value: n.trading_name ?? '—' },
                  { label: 'Address', value: n.street_address ?? '—' },
                  { label: 'Lat', value: n.lat },
                  { label: 'Lng', value: n.lng },
                  { label: 'Status', value: <VerifBadge status={n.verification_status} onClick={() => setNodeVerifPending(n.id)} /> },
                ]}
                onEdit={() => editId === n.id ? setEditId(null) : startEdit(n.id, editDefaults(n))}
                onDelete={() => confirmDelete(() => api.deleteNode(n.id))}
              >
                {editId === n.id && editForm(n)}
              </MobileCard>
            ))}
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', padding: '6px 12px', borderBottom: `1px solid ${t.border}`, background: t.bgDeep }}>
              <div style={colH(1.5)}>ID</div><div style={colH(2)}>Name</div><div style={colH(1)}>Country</div>
              <div style={colH(1.5)}>City</div><div style={colH(1.5)}>Type</div><div style={colH(1)}>On-Net</div><div style={colH(2)}>Owner</div>
              <div style={colH(2)}>Trading Name</div><div style={colH(2)}>Description</div>
              <div style={colH(1)}>Lat</div><div style={colH(1)}>Lng</div>
              <div style={colH(1.5)}>Status</div>
              <div style={{ width: 140 }} />
            </div>
            {filtered.map(n => (
              <div key={n.id} style={rowStyle(editId === n.id)}>
                <div style={{ display: 'flex', alignItems: 'center', padding: '7px 12px', minHeight: 36 }}>
                  <div style={cell(1.5)}><code style={{ fontSize: 11 }}>{n.id}</code></div>
                  <div style={cell(2)}>{n.name}</div>
                  <div style={cell(1)}>{n.country}</div>
                  <div style={cell(1.5)}>{n.city ?? ''}</div>
                  <div style={cell(1.5)}>{n.type === 'landing_station' ? 'CLS' : n.type === 'branching_unit' ? 'BU' : n.type === 'primary_pop' ? '1°PoP' : n.type === 'secondary_pop' ? '2°PoP' : n.type === 'off_net' ? 'Off-Net' : 'ExtPoP'}</div>
                  <div style={cell(1)}><OnNetBadge value={n.on_net} /></div>
                  <div style={cell(2)}>{n.owner ?? ''}</div>
                  <div style={cell(2)}>{n.trading_name ?? ''}</div>
                  <div style={cell(2)}>{n.description ?? ''}</div>
                  <div style={cell(1)}>{n.lat}</div>
                  <div style={cell(1)}>{n.lng}</div>
                  <div style={cell(1.5)}><VerifBadge status={n.verification_status} onClick={() => setNodeVerifPending(n.id)} /></div>
                  <ActionsCell id={n.id}
                    onEdit={() => startEdit(n.id, editDefaults(n))}
                    onDelete={() => confirmDelete(() => api.deleteNode(n.id))}
                  />
                </div>
                {editId === n.id && editForm(n)}
              </div>
            ))}
          </>
        )}
        {nodeVerifPending && <VerifPrompt onChoice={status => applyNodeVerif(nodeVerifPending, status)} onDismiss={() => setNodeVerifPending(null)} theme={t} />}
      </>
    )
  }

  // ── Segments tab ─────────────────────────────────────────────────────────────

  const [segVerifPending, setSegVerifPending] = useState<string | null>(null)

  async function applySegVerif(id: string, status: VerificationStatus) {
    const date = status === 'verified' ? new Date().toISOString().slice(0, 10) : undefined
    await api.updateSegment(id, { verification_status: status, last_verified_date: date })
    setSegVerifPending(null)
    onDataChange()
  }

  function SegmentTab() {
    const sq = filter.toLowerCase()
    const filtered = segments.filter(s =>
      !filter || [s.id, s.name, s.system_id, s.start_node_id, s.end_node_id, s.type, s.ownership].some(v => (v ?? '').toLowerCase().includes(sq))
    )
    const segDefaults = { id: '', name: '', system_id: '', start_node_id: '', end_node_id: '', type: 'wet', length_km: 0, latency: 0, cost_weight: 1, reliability: 0.9999, ownership: 'consortium' }
    const nodesById = Object.fromEntries(nodes.map(n => [n.id, n]))

    const segEditForm = (s: CableSegment) => (
      <div style={{ ...editFormRow }}>
        <Field label="Name"         k="name"          src={editValues} setSrc={setEditValues} />
        <Field label="System"       k="system_id"     src={editValues} setSrc={setEditValues} options={systemOpts} />
        <NodeSearchField label="Start Node" k="start_node_id" src={editValues} setSrc={setEditValues} nodes={nodes} />
        <NodeSearchField label="End Node"   k="end_node_id"   src={editValues} setSrc={setEditValues} nodes={nodes} />
        <Field label="Type"         k="type"          src={editValues} setSrc={setEditValues} options={segTypeOpts} />
        <Field label="Length (km)"  k="length_km"     src={editValues} setSrc={setEditValues} type="number" />
        <Field label="Latency (ms)" k="latency"       src={editValues} setSrc={setEditValues} type="number" />
        <Field label="Cost Weight"  k="cost_weight"   src={editValues} setSrc={setEditValues} type="number" />
        <Field label="Reliability"  k="reliability"   src={editValues} setSrc={setEditValues} type="number" />
        <Field label="Ownership"    k="ownership"     src={editValues} setSrc={setEditValues} options={ownerOpts} />
        {/* Waypoints editor */}
        <div style={{ gridColumn: '1 / -1', marginTop: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <label style={{ fontSize: 10, color: t.textFaint, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Ocean Waypoints</label>
            <span style={{ fontSize: 10, color: t.textFaintest }}>Intermediate lat/lng points from start to end node</span>
          </div>
          {((editValues.waypoints as [number, number][]) ?? []).map(([wlat, wlng], wi) => (
            <div key={wi} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
              <span style={{ fontSize: 10, color: t.textFaint, width: 20, textAlign: 'right', flexShrink: 0 }}>{wi + 1}</span>
              <input type="text" inputMode="decimal" placeholder="Lat" value={String(wlat)} autoComplete="off" style={{ ...inputStyle, width: 90 }}
                onChange={e => { const wps = [...((editValues.waypoints as [number, number][]) ?? [])]; const v = parseFloat(e.target.value); if (!isNaN(v)) { wps[wi] = [v, wps[wi][1]]; setEditValues({ ...editValues, waypoints: wps }) } }}
                onPaste={e => {
                  const text = e.clipboardData.getData('text').trim()
                  const parts = text.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean)
                  if (parts.length >= 2) { const a = parseFloat(parts[0]); const b = parseFloat(parts[1]); if (!isNaN(a) && !isNaN(b)) { e.preventDefault(); const wps = [...((editValues.waypoints as [number, number][]) ?? [])]; wps[wi] = [a, b]; setEditValues({ ...editValues, waypoints: wps }) } }
                }} />
              <input type="text" inputMode="decimal" placeholder="Lng" value={String(wlng)} autoComplete="off" style={{ ...inputStyle, width: 90 }}
                onChange={e => { const wps = [...((editValues.waypoints as [number, number][]) ?? [])]; const v = parseFloat(e.target.value); if (!isNaN(v)) { wps[wi] = [wps[wi][0], v]; setEditValues({ ...editValues, waypoints: wps }) } }} />
              <button disabled={wi === 0} onClick={() => { const wps = [...((editValues.waypoints as [number, number][]) ?? [])]; [wps[wi - 1], wps[wi]] = [wps[wi], wps[wi - 1]]; setEditValues({ ...editValues, waypoints: wps }) }} style={{ fontSize: 11, padding: '2px 6px', borderRadius: 3, border: `1px solid ${t.border}`, background: 'transparent', color: t.textFaint, cursor: wi === 0 ? 'not-allowed' : 'pointer', opacity: wi === 0 ? 0.3 : 1 }}>↑</button>
              <button disabled={wi === ((editValues.waypoints as [number, number][]) ?? []).length - 1} onClick={() => { const wps = [...((editValues.waypoints as [number, number][]) ?? [])]; [wps[wi], wps[wi + 1]] = [wps[wi + 1], wps[wi]]; setEditValues({ ...editValues, waypoints: wps }) }} style={{ fontSize: 11, padding: '2px 6px', borderRadius: 3, border: `1px solid ${t.border}`, background: 'transparent', color: t.textFaint, cursor: wi === ((editValues.waypoints as [number, number][]) ?? []).length - 1 ? 'not-allowed' : 'pointer', opacity: wi === ((editValues.waypoints as [number, number][]) ?? []).length - 1 ? 0.3 : 1 }}>↓</button>
              <button onClick={() => { const wps = ((editValues.waypoints as [number, number][]) ?? []).filter((_, j) => j !== wi); setEditValues({ ...editValues, waypoints: wps }) }} style={{ fontSize: 11, padding: '2px 7px', borderRadius: 3, border: `1px solid ${t.red}44`, background: 'transparent', color: t.red, cursor: 'pointer' }}>×</button>
            </div>
          ))}
          <button onClick={() => { const wps = [...((editValues.waypoints as [number, number][]) ?? []), [0, 0] as [number, number]]; setEditValues({ ...editValues, waypoints: wps }) }} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 3, border: `1px solid ${t.blue}`, background: 'transparent', color: t.blue, cursor: 'pointer', marginTop: 2 }}>+ Add waypoint</button>
        </div>
        <SaveCancel
          onSave={async () => { const wps = (editValues.waypoints as [number, number][]) ?? []; await saveEdit(() => api.updateSegment(s.id, { ...editValues, waypoints: wps.length > 0 ? wps : null } as Partial<CableSegment>)) }}
          onCancel={() => setEditId(null)}
          disabled={!nodesById[String(editValues.start_node_id ?? '')] || !nodesById[String(editValues.end_node_id ?? '')]}
          disabledReason="Select valid start and end nodes before saving"
        />
      </div>
    )
    const segEditDefaults = (s: CableSegment) => ({ name: s.name, system_id: s.system_id, start_node_id: s.start_node_id, end_node_id: s.end_node_id, type: s.type, length_km: s.length_km, latency: s.latency, cost_weight: s.cost_weight, reliability: s.reliability, ownership: s.ownership, waypoints: s.waypoints ? JSON.parse(JSON.stringify(s.waypoints)) : [] })

    return (
      <>
        {adding && (
          <div style={{ ...editFormRow, margin: isMobile ? '8px 12px' : undefined }}>
            <Field label="ID *"         k="id"            src={addValues} setSrc={setAddValues} />
            <Field label="Name *"       k="name"          src={addValues} setSrc={setAddValues} />
            <Field label="System"       k="system_id"     src={addValues} setSrc={setAddValues} options={systemOpts} />
            <NodeSearchField label="Start Node" k="start_node_id" src={addValues} setSrc={setAddValues} nodes={nodes} />
            <NodeSearchField label="End Node"   k="end_node_id"   src={addValues} setSrc={setAddValues} nodes={nodes} />
            <Field label="Type"         k="type"          src={addValues} setSrc={setAddValues} options={segTypeOpts} />
            <Field label="Length (km)"  k="length_km"     src={addValues} setSrc={setAddValues} type="number" />
            <Field label="Latency (ms)" k="latency"       src={addValues} setSrc={setAddValues} type="number" />
            <Field label="Cost Weight"  k="cost_weight"   src={addValues} setSrc={setAddValues} type="number" />
            <Field label="Reliability"  k="reliability"   src={addValues} setSrc={setAddValues} type="number" />
            <Field label="Ownership"    k="ownership"     src={addValues} setSrc={setAddValues} options={ownerOpts} />
            <SaveCancel
              onSave={() => saveAdd(() => api.createSegment({ ...segDefaults, ...addValues } as CableSegment))}
              onCancel={() => { setAdding(false); setAddValues({}) }}
              disabled={!nodesById[String(addValues.start_node_id ?? '')] || !nodesById[String(addValues.end_node_id ?? '')]}
              disabledReason="Select valid start and end nodes before saving"
            />
          </div>
        )}
        {isMobile ? (
          <div style={{ padding: '8px 0 32px' }}>
            {filtered.map(s => (
              <MobileCard key={s.id}
                id={s.id}
                title={s.name}
                subtitle={<><code style={{ fontSize: 10 }}>{s.id}</code> · {s.system_id} · {s.type}</>}
                fields={[
                  { label: 'From', value: nodesById[s.start_node_id]?.name ?? s.start_node_id },
                  { label: 'To', value: nodesById[s.end_node_id]?.name ?? s.end_node_id },
                  { label: 'Length', value: `${s.length_km.toLocaleString()} km` },
                  { label: 'Latency', value: s.latency != null ? `${s.latency} ms` : '—' },
                  { label: 'Ownership', value: OWNERSHIP_LABEL[s.ownership] ?? s.ownership },
                  { label: 'Network', value: isOnNet(s.ownership) ? 'ON-NET' : 'OFF-NET' },
                  { label: 'Status', value: <VerifBadge status={s.verification_status} onClick={() => setSegVerifPending(s.id)} /> },
                ]}
                onEdit={() => editId === s.id ? setEditId(null) : startEdit(s.id, segEditDefaults(s))}
                onDelete={() => confirmDelete(() => api.deleteSegment(s.id))}
              >
                {editId === s.id && segEditForm(s)}
              </MobileCard>
            ))}
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', padding: '6px 12px', borderBottom: `1px solid ${t.border}`, background: t.bgDeep }}>
              <div style={colH(1.5)}>ID</div><div style={colH(2)}>Name</div><div style={colH(1)}>System</div>
              <div style={colH(1.5)}>Start Node</div><div style={colH(1.5)}>End Node</div>
              <div style={colH(0.8)}>Type</div><div style={colH(1)}>Length</div><div style={colH(0.8)}>Latency</div>
              <div style={colH(0.7)}>Cost</div><div style={colH(1)}>Ownership</div><div style={colH(0.8)}>Network</div>
              <div style={colH(1.5)}>Status</div>
              <div style={{ width: 140 }} />
            </div>
            {filtered.map(s => (
            <div key={s.id} style={rowStyle(editId === s.id)}>
              <div style={{ display: 'flex', alignItems: 'center', padding: '7px 12px', minHeight: 36 }}>
                <div style={cell(1.5)}><code style={{ fontSize: 11 }}>{s.id}</code></div>
                <div style={cell(2)}>{s.name}</div>
                <div style={cell(1)}>{s.system_id}</div>
                <div style={cell(1.5)}>{nodesById[s.start_node_id]?.name ?? s.start_node_id}</div>
                <div style={cell(1.5)}>{nodesById[s.end_node_id]?.name ?? s.end_node_id}</div>
                <div style={cell(0.8)}>{s.type}</div>
                <div style={cell(1)}>{s.length_km.toLocaleString()} km</div>
                <div style={cell(0.8)}>{s.latency} ms</div>
                <div style={cell(0.7)}>{s.cost_weight}</div>
                <div style={cell(1)}>{OWNERSHIP_LABEL[s.ownership] ?? s.ownership}</div>
                <div style={cell(0.8)}>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 3, letterSpacing: '0.04em', background: isOnNet(s.ownership) ? '#a6e3a122' : '#f9e2af22', color: isOnNet(s.ownership) ? '#a6e3a1' : '#f9e2af', border: `1px solid ${isOnNet(s.ownership) ? '#a6e3a144' : '#f9e2af44'}` }}>
                    {isOnNet(s.ownership) ? 'ON-NET' : 'OFF-NET'}
                  </span>
                </div>
                <div style={cell(1.5)}><VerifBadge status={s.verification_status} onClick={() => setSegVerifPending(s.id)} /></div>
                <ActionsCell id={s.id}
                  onEdit={() => startEdit(s.id, segEditDefaults(s))}
                  onDelete={() => confirmDelete(() => api.deleteSegment(s.id))}
                />
              </div>
              {editId === s.id && segEditForm(s)}
            </div>
            ))}
          </>
        )}
        {segVerifPending && <VerifPrompt onChoice={status => applySegVerif(segVerifPending, status)} onDismiss={() => setSegVerifPending(null)} theme={t} />}
      </>
    )
  }

  // ── Systems tab ──────────────────────────────────────────────────────────────

  function SystemTab() {
    const filtered = systems.filter(s =>
      !filter || s.name.toLowerCase().includes(filter.toLowerCase()) || s.id.toLowerCase().includes(filter.toLowerCase())
    )
    const sysEditForm = (s: CableSystem) => (
      <div style={{ ...editFormRow }}>
        <Field label="Name"          k="name"        src={editValues} setSrc={setEditValues} />
        <Field label="Description"   k="description" src={editValues} setSrc={setEditValues} />
        <Field label="Margin (1–10)" k="margin"      src={editValues} setSrc={setEditValues} type="number" />
        <SaveCancel onSave={() => saveEdit(() => api.updateSystem(s.id, editValues as Partial<CableSystem>))} onCancel={() => setEditId(null)} />
      </div>
    )
    return (
      <>
        {adding && (
          <div style={{ ...editFormRow, margin: isMobile ? '8px 12px' : undefined }}>
            <Field label="ID *"          k="id"          src={addValues} setSrc={setAddValues} />
            <Field label="Name *"        k="name"        src={addValues} setSrc={setAddValues} />
            <Field label="Description"   k="description" src={addValues} setSrc={setAddValues} />
            <Field label="Margin (1–10)" k="margin"      src={addValues} setSrc={setAddValues} type="number" />
            <SaveCancel onSave={() => saveAdd(() => api.createSystem(addValues as unknown as CableSystem))} onCancel={() => { setAdding(false); setAddValues({}) }} />
          </div>
        )}
        {isMobile ? (
          <div style={{ padding: '8px 0 32px' }}>
            {filtered.map(s => {
              const mc = s.margin == null ? t.textFaint : s.margin >= 7.5 ? t.green : s.margin >= 4.5 ? t.orange : t.red
              return (
                <MobileCard key={s.id} id={s.id}
                  title={s.name}
                  subtitle={<code style={{ fontSize: 10 }}>{s.id}</code>}
                  fields={[
                    { label: 'Description', value: s.description ?? '—' },
                    { label: 'Margin', value: <span style={{ color: mc, fontWeight: 700 }}>{s.margin != null ? s.margin.toFixed(1) : '—'}</span> },
                  ]}
                  onEdit={() => editId === s.id ? setEditId(null) : startEdit(s.id, { name: s.name, description: s.description, margin: s.margin })}
                  onDelete={() => confirmDelete(() => api.deleteSystem(s.id))}
                >
                  {editId === s.id && sysEditForm(s)}
                </MobileCard>
              )
            })}
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', padding: '6px 12px', borderBottom: `1px solid ${t.border}`, background: t.bgDeep }}>
              <div style={colH(1.5)}>ID</div><div style={colH(3)}>Name</div><div style={colH(4)}>Description</div><div style={colH(1)}>Margin</div>
              <div style={{ width: 140 }} />
            </div>
            {filtered.map(s => {
              const mc = s.margin == null ? t.textFaint : s.margin >= 7.5 ? t.green : s.margin >= 4.5 ? t.orange : t.red
              return (
                <div key={s.id} style={rowStyle(editId === s.id)}>
                  <div style={{ display: 'flex', alignItems: 'center', padding: '7px 12px', minHeight: 36 }}>
                    <div style={cell(1.5)}><code style={{ fontSize: 11 }}>{s.id}</code></div>
                    <div style={cell(3)}>{s.name}</div>
                    <div style={cell(4)}>{s.description}</div>
                    <div style={{ ...cell(1), fontWeight: 700, color: mc }}>{s.margin != null ? s.margin.toFixed(1) : '—'}</div>
                    <ActionsCell id={s.id} onEdit={() => startEdit(s.id, { name: s.name, description: s.description, margin: s.margin })} onDelete={() => confirmDelete(() => api.deleteSystem(s.id))} />
                  </div>
                  {editId === s.id && sysEditForm(s)}
                </div>
              )
            })}
          </>
        )}
      </>
    )
  }

  // ── Capacity tab ─────────────────────────────────────────────────────────────

  function CapacityTab() {
    const filtered = capacity.filter(c =>
      !filter || c.segment_id.toLowerCase().includes(filter.toLowerCase())
    )
    const capSaveVals = (vals: Record<string, unknown>) => ({
      total_capacity_t: parseFloat(String(vals.total_capacity_t)) || 0,
      available_capacity_t: parseFloat(String(vals.available_capacity_t)) || 0,
    })
    const capEditForm = (segId: string) => (
      <div style={{ ...editFormRow }}>
        <Field label="Total (T)"     k="total_capacity_t"     src={editValues} setSrc={setEditValues} type="decimal" placeholder="e.g. 4.5" />
        <Field label="Available (T)" k="available_capacity_t" src={editValues} setSrc={setEditValues} type="decimal" placeholder="e.g. 2.0" />
        <SaveCancel onSave={() => saveEdit(() => api.updateCapacity(segId, capSaveVals(editValues) as Partial<SegmentCapacity>))} onCancel={() => setEditId(null)} />
      </div>
    )
    const segSearchWidget = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, position: 'relative' }}>
        <label style={{ fontSize: 10, color: t.textFaint, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Segment ID *</label>
        <input style={inputStyle} placeholder="Type to filter segments…"
          value={String(addValues.segment_id ?? '')}
          onChange={e => { setAddValues({ ...addValues, segment_id: e.target.value }); setCapSegmentOpen(true) }}
          onFocus={() => setCapSegmentOpen(true)}
          onBlur={() => setTimeout(() => setCapSegmentOpen(false), 150)}
        />
        {capSegmentOpen && (() => {
          const q = String(addValues.segment_id ?? '').toLowerCase()
          const hits = q ? segments.filter(s => s.id.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)).slice(0, 12) : []
          return hits.length > 0 ? (
            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 300, background: t.bgDeep, border: `1px solid ${t.border}`, borderRadius: 4, maxHeight: 220, overflowY: 'auto', boxShadow: '0 6px 16px rgba(0,0,0,0.5)', marginTop: 2 }}>
              {hits.map(s => (
                <div key={s.id} onMouseDown={() => { setAddValues({ ...addValues, segment_id: s.id }); setCapSegmentOpen(false) }}
                  style={{ padding: '6px 10px', cursor: 'pointer', display: 'flex', gap: 10, alignItems: 'baseline', borderBottom: `1px solid ${t.border}` }}>
                  <code style={{ fontSize: 11, color: t.blue, flexShrink: 0 }}>{s.id}</code>
                  <span style={{ fontSize: 11, color: t.textFaint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
                </div>
              ))}
            </div>
          ) : null
        })()}
      </div>
    )
    return (
      <>
        {adding && (
          <div style={{ ...editFormRow, margin: isMobile ? '8px 12px' : undefined }}>
            {segSearchWidget}
            <Field label="Total (T)"     k="total_capacity_t"    src={addValues} setSrc={setAddValues} type="decimal" placeholder="e.g. 4.5" />
            <Field label="Available (T)" k="available_capacity_t" src={addValues} setSrc={setAddValues} type="decimal" placeholder="e.g. 2.0" />
            <SaveCancel
              onSave={() => saveAdd(() => api.createCapacity({ segment_id: String(addValues.segment_id ?? ''), ...capSaveVals(addValues) } as unknown as SegmentCapacity))}
              onCancel={() => { setAdding(false); setAddValues({}) }}
            />
          </div>
        )}
        {isMobile ? (
          <div style={{ padding: '8px 0 32px' }}>
            {filtered.map(c => {
              const pct = Math.round((c.available_capacity_t / c.total_capacity_t) * 100)
              const pctColor = pct < 20 ? t.red : pct < 50 ? t.orange : t.green
              return (
                <MobileCard key={c.segment_id} id={c.segment_id}
                  title={<code style={{ fontSize: 12 }}>{c.segment_id}</code>}
                  fields={[
                    { label: 'Total', value: `${c.total_capacity_t}T` },
                    { label: 'Available', value: `${c.available_capacity_t}T` },
                    { label: '% Free', value: <span style={{ color: pctColor, fontWeight: 700 }}>{pct}%</span> },
                  ]}
                  onEdit={() => editId === c.segment_id ? setEditId(null) : startEdit(c.segment_id, { total_capacity_t: c.total_capacity_t, available_capacity_t: c.available_capacity_t })}
                  onDelete={() => confirmDelete(() => api.deleteCapacity(c.segment_id))}
                >
                  {editId === c.segment_id && capEditForm(c.segment_id)}
                </MobileCard>
              )
            })}
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', padding: '6px 12px', borderBottom: `1px solid ${t.border}`, background: t.bgDeep }}>
              <div style={colH(3)}>Segment ID</div><div style={colH(1.5)}>Total (T)</div>
              <div style={colH(1.5)}>Available (T)</div><div style={colH(1.5)}>% Free</div>
              <div style={{ width: 140 }} />
            </div>
            {filtered.map(c => {
              const pct = Math.round((c.available_capacity_t / c.total_capacity_t) * 100)
              const pctColor = pct < 20 ? t.red : pct < 50 ? t.orange : t.green
              return (
                <div key={c.segment_id} style={rowStyle(editId === c.segment_id)}>
                  <div style={{ display: 'flex', alignItems: 'center', padding: '7px 12px', minHeight: 36 }}>
                    <div style={cell(3)}><code style={{ fontSize: 11 }}>{c.segment_id}</code></div>
                    <div style={cell(1.5)}>{c.total_capacity_t}T</div>
                    <div style={cell(1.5)}>{c.available_capacity_t}T</div>
                    <div style={{ ...cell(1.5), color: pctColor, fontWeight: 600 }}>{pct}%</div>
                    <ActionsCell id={c.segment_id}
                      onEdit={() => startEdit(c.segment_id, { total_capacity_t: c.total_capacity_t, available_capacity_t: c.available_capacity_t })}
                      onDelete={() => confirmDelete(() => api.deleteCapacity(c.segment_id))}
                    />
                  </div>
                  {editId === c.segment_id && capEditForm(c.segment_id)}
                </div>
              )
            })}
          </>
        )}
      </>
    )
  }

  // ── Outages tab ──────────────────────────────────────────────────────────────

  function OutagesTab() {
    const filtered = outages.filter(o =>
      !filter || o.segment_id.toLowerCase().includes(filter.toLowerCase()) ||
      o.fault_id.toLowerCase().includes(filter.toLowerCase())
    )
    const outageEditDefaults = (o: SegmentOutage) => ({ fault_id: o.fault_id, fault_date: o.fault_date, repair_start: o.repair_start ?? '', estimated_repair_date: o.estimated_repair_date ?? '', description: o.description })
    const outageEditForm = (o: SegmentOutage) => (
      <div style={{ ...editFormRow }}>
        <Field label="Fault ID"    k="fault_id"              src={editValues} setSrc={setEditValues} />
        <Field label="Fault Date"  k="fault_date"            src={editValues} setSrc={setEditValues} placeholder="YYYY-MM-DD" />
        <Field label="Repair Start" k="repair_start"         src={editValues} setSrc={setEditValues} placeholder="YYYY-MM-DD or TBC" />
        <Field label="ETA Repair"  k="estimated_repair_date" src={editValues} setSrc={setEditValues} placeholder="YYYY-MM-DD or TBC" />
        <Field label="Description" k="description"           src={editValues} setSrc={setEditValues} />
        <SaveCancel onSave={() => saveEdit(() => api.updateOutage(o.fault_id, editValues as Partial<SegmentOutage>))} onCancel={() => setEditId(null)} />
      </div>
    )
    return (
      <>
        {adding && (
          <div style={{ ...editFormRow, margin: isMobile ? '8px 12px' : undefined }}>
            <Field label="Segment ID *"   k="segment_id"            src={addValues} setSrc={setAddValues} />
            <Field label="Fault ID *"     k="fault_id"              src={addValues} setSrc={setAddValues} />
            <Field label="Fault Date *"   k="fault_date"            src={addValues} setSrc={setAddValues} placeholder="YYYY-MM-DD" />
            <Field label="Repair Start"   k="repair_start"          src={addValues} setSrc={setAddValues} placeholder="YYYY-MM-DD or TBC" />
            <Field label="ETA Repair"     k="estimated_repair_date" src={addValues} setSrc={setAddValues} placeholder="YYYY-MM-DD or TBC" />
            <Field label="Description *"  k="description"           src={addValues} setSrc={setAddValues} />
            <SaveCancel onSave={() => saveAdd(() => api.createOutage(addValues as unknown as SegmentOutage))} onCancel={() => { setAdding(false); setAddValues({}) }} />
          </div>
        )}
        {isMobile ? (
          <div style={{ padding: '8px 0 32px' }}>
            {filtered.map(o => (
              <MobileCard key={o.fault_id} id={o.fault_id}
                title={o.fault_id}
                subtitle={<><code style={{ fontSize: 10 }}>{o.segment_id}</code> · faulted {o.fault_date}</>}
                fields={[
                  { label: 'Repair Start', value: o.repair_start ?? '—' },
                  { label: 'ETA', value: <span style={{ color: o.estimated_repair_date === 'TBC' ? t.orange : t.text }}>{o.estimated_repair_date ?? '—'}</span> },
                  { label: 'Description', value: o.description },
                ]}
                onEdit={() => editId === o.fault_id ? setEditId(null) : startEdit(o.fault_id, outageEditDefaults(o))}
                onDelete={() => confirmDelete(() => api.deleteOutage(o.fault_id))}
              >
                {editId === o.fault_id && outageEditForm(o)}
              </MobileCard>
            ))}
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', padding: '6px 12px', borderBottom: `1px solid ${t.border}`, background: t.bgDeep }}>
              <div style={colH(2)}>Segment</div><div style={colH(2)}>Fault ID</div><div style={colH(2)}>Fault Date</div>
              <div style={colH(2)}>Repair Start</div><div style={colH(2)}>ETA</div><div style={colH(3)}>Description</div>
              <div style={{ width: 140 }} />
            </div>
            {filtered.map(o => (
              <div key={o.fault_id} style={rowStyle(editId === o.fault_id)}>
                <div style={{ display: 'flex', alignItems: 'center', padding: '7px 12px', minHeight: 36 }}>
                  <div style={cell(2)}><code style={{ fontSize: 11 }}>{o.segment_id}</code></div>
                  <div style={cell(2)}>{o.fault_id}</div>
                  <div style={cell(2)}>{o.fault_date}</div>
                  <div style={cell(2)}>{o.repair_start ?? '—'}</div>
                  <div style={{ ...cell(2), color: o.estimated_repair_date === 'TBC' ? t.orange : t.text }}>{o.estimated_repair_date ?? '—'}</div>
                  <div style={{ ...cell(3), fontSize: 11, color: t.textMuted }}>{o.description}</div>
                  <ActionsCell id={o.fault_id} onEdit={() => startEdit(o.fault_id, outageEditDefaults(o))} onDelete={() => confirmDelete(() => api.deleteOutage(o.fault_id))} />
                </div>
                {editId === o.fault_id && outageEditForm(o)}
              </div>
            ))}
          </>
        )}
      </>
    )
  }

  // ── Rules tab ────────────────────────────────────────────────────────────────

  type FlatRule =
    | { node_id: string; idx: number; pair: DisallowedPair | AllowedPair; kind: 'blacklist' | 'whitelist' }
    | { node_id: string; kind: 'no_handoff' }
    | { node_id: string; idx: number; segment: AllowedHandoffSegment; kind: 'handoff_segment' }

  function RulesTab() {
    function segmentOptsForNode(nodeId: string) {
      if (!nodeId) return []
      return segments
        .filter(s => s.start_node_id === nodeId || s.end_node_id === nodeId)
        .sort((a, b) => a.id.localeCompare(b.id))
        .map(s => ({ value: s.id, label: `${s.id} — ${s.name}` }))
    }

    const flat: FlatRule[] = rules.flatMap(r => [
      ...r.disallowed_pairs.map((pair, idx) => ({ node_id: r.node_id, idx, pair, kind: 'blacklist' as const })),
      ...(r.allowed_pairs ?? []).map((pair, idx) => ({ node_id: r.node_id, idx, pair, kind: 'whitelist' as const })),
      ...(r.no_handoff ? [{ node_id: r.node_id, kind: 'no_handoff' as const }] : []),
      ...(r.allowed_handoff_segments ?? []).map((segment, idx) => ({ node_id: r.node_id, idx, segment, kind: 'handoff_segment' as const })),
    ])

    const filtered = flat.filter(fp => {
      if (!filter) return true
      if (fp.node_id.toLowerCase().includes(filter.toLowerCase())) return true
      if (fp.kind === 'blacklist' || fp.kind === 'whitelist') {
        const p = (fp as { pair: DisallowedPair | AllowedPair }).pair
        return p.system_a.toLowerCase().includes(filter.toLowerCase()) || p.system_b.toLowerCase().includes(filter.toLowerCase())
      }
      if (fp.kind === 'handoff_segment') {
        return (fp as { segment: AllowedHandoffSegment }).segment.segment_id.toLowerCase().includes(filter.toLowerCase())
      }
      return false
    })

    function ruleKey(fp: FlatRule) {
      if (fp.kind === 'no_handoff') return `${fp.node_id}::no_handoff`
      return `${fp.node_id}::${fp.kind}::${(fp as { idx: number }).idx}`
    }

    const kindOpts = [
      { value: 'blacklist',       label: 'Blacklist — block this system pair' },
      { value: 'whitelist',       label: 'Whitelist — only allow this system pair' },
      { value: 'no_handoff',      label: 'No Handoff — node cannot be circuit endpoint' },
      { value: 'handoff_segment', label: 'Handoff Segment — restrict which segments can terminate here' },
    ]

    const addKind = (addValues.kind as string) || 'blacklist'
    const isPairKind   = addKind === 'blacklist' || addKind === 'whitelist'
    const isEditPairKind = (editValues.kind as string) === 'blacklist' || (editValues.kind as string) === 'whitelist'

    function typeBadge(kind: FlatRule['kind']) {
      const cfg: Record<FlatRule['kind'], { label: string; bg: string; color: string }> = {
        whitelist:       { label: 'Whitelist',   bg: 'rgba(166,227,161,0.15)', color: t.green },
        blacklist:       { label: 'Blacklist',   bg: 'rgba(243,139,168,0.15)', color: t.red },
        no_handoff:      { label: 'No Handoff',  bg: 'rgba(250,179,135,0.15)', color: t.orange },
        handoff_segment: { label: 'Handoff Seg', bg: 'rgba(137,180,250,0.15)', color: t.blue },
      }
      const { label, bg, color } = cfg[kind]
      return (
        <span style={{
          display: 'inline-block', fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 3,
          background: bg, color, letterSpacing: '0.04em', textTransform: 'uppercase', whiteSpace: 'nowrap',
        }}>
          {label}
        </span>
      )
    }

    async function savePairEdit(node_id: string, idx: number, kind: 'blacklist' | 'whitelist') {
      const rule = rules.find(r => r.node_id === node_id)!
      const newKind = editValues.kind as 'blacklist' | 'whitelist'
      const newPair = { system_a: String(editValues.system_a), system_b: String(editValues.system_b), reason: String(editValues.reason) }

      if (newKind === kind) {
        if (kind === 'blacklist') {
          await saveEdit(() => api.updateRule(node_id, { disallowed_pairs: rule.disallowed_pairs.map((p, i) => i === idx ? newPair : p) }))
        } else {
          await saveEdit(() => api.updateRule(node_id, { allowed_pairs: (rule.allowed_pairs ?? []).map((p, i) => i === idx ? newPair : p) }))
        }
      } else {
        const newDisallowed = kind === 'blacklist'
          ? rule.disallowed_pairs.filter((_, i) => i !== idx)
          : [...rule.disallowed_pairs, newPair]
        const newAllowed = kind === 'whitelist'
          ? (rule.allowed_pairs ?? []).filter((_, i) => i !== idx)
          : [...(rule.allowed_pairs ?? []), newPair]
        await saveEdit(() => api.updateRule(node_id, { disallowed_pairs: newDisallowed, allowed_pairs: newAllowed }))
      }
    }

    async function saveHandoffSegEdit(node_id: string, idx: number) {
      const rule = rules.find(r => r.node_id === node_id)!
      const updated = { segment_id: String(editValues.segment_id), reason: String(editValues.reason) }
      const newSegs = (rule.allowed_handoff_segments ?? []).map((s, i) => i === idx ? updated : s)
      await saveEdit(() => api.updateRule(node_id, { allowed_handoff_segments: newSegs }))
    }

    async function deleteRule(fp: FlatRule) {
      const rule = rules.find(r => r.node_id === fp.node_id)!

      if (fp.kind === 'no_handoff') {
        const remaining = rule.disallowed_pairs.length + (rule.allowed_pairs?.length ?? 0) + (rule.allowed_handoff_segments?.length ?? 0)
        if (remaining === 0) {
          await confirmDelete(() => api.deleteRule(fp.node_id))
        } else {
          await confirmDelete(() => api.updateRule(fp.node_id, { no_handoff: false }).then(() => {}))
        }
        return
      }

      if (fp.kind === 'handoff_segment') {
        const { idx } = fp as { idx: number }
        const newSegs = (rule.allowed_handoff_segments ?? []).filter((_, i) => i !== idx)
        const remaining = rule.disallowed_pairs.length + (rule.allowed_pairs?.length ?? 0) + (rule.no_handoff ? 1 : 0) + newSegs.length
        if (remaining === 0) {
          await confirmDelete(() => api.deleteRule(fp.node_id))
        } else {
          await confirmDelete(() => api.updateRule(fp.node_id, { allowed_handoff_segments: newSegs }).then(() => {}))
        }
        return
      }

      const { idx, kind } = fp as { idx: number; kind: 'blacklist' | 'whitelist' }
      const newDisallowed = kind === 'blacklist' ? rule.disallowed_pairs.filter((_, i) => i !== idx) : rule.disallowed_pairs
      const newAllowed    = kind === 'whitelist' ? (rule.allowed_pairs ?? []).filter((_, i) => i !== idx) : (rule.allowed_pairs ?? [])
      const remaining = newDisallowed.length + newAllowed.length + (rule.no_handoff ? 1 : 0) + (rule.allowed_handoff_segments?.length ?? 0)
      if (remaining === 0) {
        await confirmDelete(() => api.deleteRule(fp.node_id))
      } else {
        await confirmDelete(() => api.updateRule(fp.node_id, { disallowed_pairs: newDisallowed, allowed_pairs: newAllowed }).then(() => {}))
      }
    }

    async function addRule() {
      const { node_id, kind, system_a, system_b, reason, segment_id } = addValues as Record<string, string>
      const ruleKind = (kind || 'blacklist') as FlatRule['kind']
      const existing = rules.find(r => r.node_id === node_id)

      if (ruleKind === 'no_handoff') {
        if (existing) {
          await saveAdd(() => api.updateRule(node_id, { no_handoff: true }))
        } else {
          await saveAdd(() => api.createRule({ node_id, disallowed_pairs: [], allowed_pairs: [], no_handoff: true, allowed_handoff_segments: [] }))
        }
        return
      }

      if (ruleKind === 'handoff_segment') {
        const newSeg: AllowedHandoffSegment = { segment_id, reason: reason || 'Segment is allowed to terminate at this node' }
        if (existing) {
          await saveAdd(() => api.updateRule(node_id, { allowed_handoff_segments: [...(existing.allowed_handoff_segments ?? []), newSeg] }))
        } else {
          await saveAdd(() => api.createRule({ node_id, disallowed_pairs: [], allowed_pairs: [], no_handoff: false, allowed_handoff_segments: [newSeg] }))
        }
        return
      }

      const defaultReason = ruleKind === 'blacklist' ? 'Pair is not allowed' : 'Only this pair is allowed at this node'
      const newPair = { system_a, system_b, reason: reason || defaultReason }
      if (existing) {
        if (ruleKind === 'blacklist') {
          await saveAdd(() => api.updateRule(node_id, { disallowed_pairs: [...existing.disallowed_pairs, newPair] }))
        } else {
          await saveAdd(() => api.updateRule(node_id, { allowed_pairs: [...(existing.allowed_pairs ?? []), newPair] }))
        }
      } else {
        if (ruleKind === 'blacklist') {
          await saveAdd(() => api.createRule({ node_id, disallowed_pairs: [newPair], allowed_pairs: [] }))
        } else {
          await saveAdd(() => api.createRule({ node_id, disallowed_pairs: [], allowed_pairs: [newPair] }))
        }
      }
    }

    const blacklistCount      = rules.reduce((n, r) => n + r.disallowed_pairs.length, 0)
    const whitelistCount      = rules.reduce((n, r) => n + (r.allowed_pairs?.length ?? 0), 0)
    const noHandoffCount      = rules.filter(r => r.no_handoff).length
    const handoffSegCount     = rules.reduce((n, r) => n + (r.allowed_handoff_segments?.length ?? 0), 0)

    return (
      <>
        {showRulesHelp && (
          <div style={{ margin: '10px 12px', padding: '12px 14px', background: t.bgDeep, border: `1px solid ${t.border}`, borderRadius: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: t.text }}>How do Node Rules behave?</span>
              <button onClick={() => setShowRulesHelp(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: t.textFaint, fontSize: 16, padding: '0 4px', lineHeight: 1 }}>×</button>
            </div>
            <div style={{ fontSize: 11, color: t.textFaint, marginBottom: 10, lineHeight: 1.5 }}>
              Rules control how circuits may use a node. System pair rules apply at intermediate transit nodes. Handoff rules apply when the node is the circuit endpoint.
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${t.border}` }}>
                  <th style={{ textAlign: 'left', padding: '4px 8px', color: t.textFaint, fontWeight: 600 }}>Rule type</th>
                  <th style={{ textAlign: 'left', padding: '4px 8px', color: t.textFaint, fontWeight: 600 }}>Effect</th>
                </tr>
              </thead>
              <tbody>
                {([
                  { rule: 'Blacklist (pair)',      effect: 'Block a specific system pair from transiting together through this node', color: t.red },
                  { rule: 'Whitelist (pair)',      effect: 'For whitelisted systems, only explicitly listed transitions are permitted at this node', color: t.green },
                  { rule: 'No Handoff',            effect: 'This node cannot be the circuit endpoint — routes ending here are rejected', color: t.orange },
                  { rule: 'Handoff Segment',       effect: 'Only the listed segments may deliver a circuit to this node — all others are rejected', color: t.blue },
                ] as const).map(row => (
                  <tr key={row.rule} style={{ borderBottom: `1px solid ${t.borderSubtle}` }}>
                    <td style={{ padding: '5px 8px', color: t.text, fontSize: 11, fontWeight: 600 }}>{row.rule}</td>
                    <td style={{ padding: '5px 8px', color: row.color, fontSize: 11 }}>{row.effect}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {adding && (
          <div style={{ ...editFormRow, margin: isMobile ? '8px 12px' : undefined }}>
            <Field label="Node ID *"   k="node_id" src={addValues} setSrc={setAddValues} />
            <Field label="Rule Type *" k="kind"    src={addValues} setSrc={setAddValues} options={kindOpts} />
            {isPairKind && <>
              <Field label="System A *"  k="system_a"  src={addValues} setSrc={setAddValues} />
              <Field label="System B *"  k="system_b"  src={addValues} setSrc={setAddValues} />
              <Field label="Reason"      k="reason"    src={addValues} setSrc={setAddValues} />
            </>}
            {addKind === 'handoff_segment' && <>
              <Field label="Segment ID *" k="segment_id" src={addValues} setSrc={setAddValues}
                options={segmentOptsForNode(String(addValues.node_id || ''))} />
              <Field label="Reason"       k="reason"     src={addValues} setSrc={setAddValues} />
            </>}
            <SaveCancel onSave={addRule} onCancel={() => { setAdding(false); setAddValues({}) }} />
          </div>
        )}
        {isMobile ? (
          <div style={{ padding: '8px 0 32px' }}>
            {filtered.length === 0 && <div style={{ padding: '20px 16px', color: t.textFaintest, fontSize: 13 }}>No rules defined.</div>}
            {filtered.map(fp => {
              const key = ruleKey(fp)
              if (fp.kind === 'no_handoff') {
                return (
                  <MobileCard key={key} id={key}
                    title={<>{typeBadge(fp.kind)} <code style={{ fontSize: 11 }}>{fp.node_id}</code></>}
                    subtitle="Node cannot be used as circuit endpoint"
                    fields={[]}
                    onEdit={undefined}
                    onDelete={() => deleteRule(fp)}
                  />
                )
              }
              if (fp.kind === 'handoff_segment') {
                const segRule = fp as { node_id: string; idx: number; segment: AllowedHandoffSegment; kind: 'handoff_segment' }
                const ruleEditForm = (
                  <div style={{ ...editFormRow }}>
                    <Field label="Segment ID" k="segment_id" src={editValues} setSrc={setEditValues}
                      options={segmentOptsForNode(fp.node_id)} />
                    <Field label="Reason"     k="reason"     src={editValues} setSrc={setEditValues} />
                    <SaveCancel onSave={() => saveHandoffSegEdit(fp.node_id, segRule.idx)} onCancel={() => setEditId(null)} />
                  </div>
                )
                return (
                  <MobileCard key={key} id={key}
                    title={<>{typeBadge(fp.kind)} <code style={{ fontSize: 11 }}>{fp.node_id}</code></>}
                    subtitle={<><code style={{ fontSize: 11 }}>{segRule.segment.segment_id}</code></>}
                    fields={[{ label: 'Reason', value: segRule.segment.reason }]}
                    onEdit={() => editId === key ? setEditId(null) : startEdit(key, { segment_id: segRule.segment.segment_id, reason: segRule.segment.reason })}
                    onDelete={() => deleteRule(fp)}
                  >
                    {editId === key && ruleEditForm}
                  </MobileCard>
                )
              }
              const pairFp = fp as { node_id: string; idx: number; pair: DisallowedPair | AllowedPair; kind: 'blacklist' | 'whitelist' }
              const ruleEditForm = (
                <div style={{ ...editFormRow }}>
                  <Field label="Rule Type" k="kind"     src={editValues} setSrc={setEditValues} options={kindOpts.slice(0, 2)} />
                  {isEditPairKind && <>
                    <Field label="System A"  k="system_a" src={editValues} setSrc={setEditValues} />
                    <Field label="System B"  k="system_b" src={editValues} setSrc={setEditValues} />
                    <Field label="Reason"    k="reason"   src={editValues} setSrc={setEditValues} />
                  </>}
                  <SaveCancel onSave={() => savePairEdit(fp.node_id, pairFp.idx, pairFp.kind)} onCancel={() => setEditId(null)} />
                </div>
              )
              return (
                <MobileCard key={key} id={key}
                  title={<>{typeBadge(pairFp.kind)} <code style={{ fontSize: 11 }}>{fp.node_id}</code></>}
                  subtitle={<><code style={{ fontSize: 11 }}>{pairFp.pair.system_a}</code> ↔ <code style={{ fontSize: 11 }}>{pairFp.pair.system_b}</code></>}
                  fields={[{ label: 'Reason', value: pairFp.pair.reason }]}
                  onEdit={() => editId === key ? setEditId(null) : startEdit(key, { system_a: pairFp.pair.system_a, system_b: pairFp.pair.system_b, reason: pairFp.pair.reason, kind: pairFp.kind })}
                  onDelete={() => deleteRule(fp)}
                >
                  {editId === key && ruleEditForm}
                </MobileCard>
              )
            })}
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', padding: '6px 12px', borderBottom: `1px solid ${t.border}`, background: t.bgDeep, alignItems: 'center' }}>
              <div style={colH(1.2)}>Type</div><div style={colH(1.5)}>Node</div>
              <div style={colH(1.5)}>System A / Seg ID</div><div style={colH(1.5)}>System B</div>
              <div style={colH(4)}>Reason</div>
              <div style={{ width: 140, flexShrink: 0 }} />
              <button onClick={() => setShowRulesHelp(v => !v)} title="How do Node Rules behave?"
                style={{ background: 'none', border: `1px solid ${t.border}`, borderRadius: 3, cursor: 'pointer', color: showRulesHelp ? t.blue : t.textFaint, fontSize: 11, padding: '1px 7px', marginLeft: 4, flexShrink: 0 }}>ℹ</button>
            </div>
            {filtered.length === 0 && <div style={{ padding: '20px 16px', color: t.textFaintest, fontSize: 13 }}>No rules defined.</div>}
            {filtered.map(fp => {
              const key = ruleKey(fp)

              if (fp.kind === 'no_handoff') {
                return (
                  <div key={key} style={rowStyle(false)}>
                    <div style={{ display: 'flex', alignItems: 'center', padding: '7px 12px', minHeight: 36 }}>
                      <div style={cell(1.2)}>{typeBadge(fp.kind)}</div>
                      <div style={cell(1.5)}><code style={{ fontSize: 11 }}>{fp.node_id}</code></div>
                      <div style={{ ...cell(1.5), color: t.textFaintest, fontStyle: 'italic' }}>—</div>
                      <div style={{ ...cell(1.5), color: t.textFaintest, fontStyle: 'italic' }}>—</div>
                      <div style={{ ...cell(4), color: t.textMuted, fontStyle: 'italic' }}>Node cannot be used as circuit endpoint</div>
                      <ActionsCell id={key} onEdit={undefined} onDelete={() => deleteRule(fp)} />
                    </div>
                  </div>
                )
              }

              if (fp.kind === 'handoff_segment') {
                const segFp = fp as { node_id: string; idx: number; segment: AllowedHandoffSegment; kind: 'handoff_segment' }
                const isDefaultReason = segFp.segment.reason === 'Segment is allowed to terminate at this node'
                return (
                  <div key={key} style={rowStyle(editId === key)}>
                    <div style={{ display: 'flex', alignItems: 'center', padding: '7px 12px', minHeight: 36 }}>
                      <div style={cell(1.2)}>{typeBadge(fp.kind)}</div>
                      <div style={cell(1.5)}><code style={{ fontSize: 11 }}>{fp.node_id}</code></div>
                      <div style={cell(1.5)}><code style={{ fontSize: 11 }}>{segFp.segment.segment_id}</code></div>
                      <div style={{ ...cell(1.5), color: t.textFaintest, fontStyle: 'italic' }}>—</div>
                      <div style={{ ...cell(4), color: t.textMuted, fontStyle: isDefaultReason ? 'italic' : 'normal' }}>{segFp.segment.reason}</div>
                      <ActionsCell id={key}
                        onEdit={() => editId === key ? setEditId(null) : startEdit(key, { segment_id: segFp.segment.segment_id, reason: segFp.segment.reason })}
                        onDelete={() => deleteRule(fp)} />
                    </div>
                    {editId === key && (
                      <div style={{ ...editFormRow }}>
                        <Field label="Segment ID" k="segment_id" src={editValues} setSrc={setEditValues}
                          options={segmentOptsForNode(fp.node_id)} />
                        <Field label="Reason"     k="reason"     src={editValues} setSrc={setEditValues} />
                        <SaveCancel onSave={() => saveHandoffSegEdit(fp.node_id, segFp.idx)} onCancel={() => setEditId(null)} />
                      </div>
                    )}
                  </div>
                )
              }

              const pairFp = fp as { node_id: string; idx: number; pair: DisallowedPair | AllowedPair; kind: 'blacklist' | 'whitelist' }
              const isDefaultReason = pairFp.pair.reason === 'Pair is not allowed' || pairFp.pair.reason === 'Only this pair is allowed at this node'
              return (
                <div key={key} style={rowStyle(editId === key)}>
                  <div style={{ display: 'flex', alignItems: 'center', padding: '7px 12px', minHeight: 36 }}>
                    <div style={cell(1.2)}>{typeBadge(pairFp.kind)}</div>
                    <div style={cell(1.5)}><code style={{ fontSize: 11 }}>{fp.node_id}</code></div>
                    <div style={cell(1.5)}><code style={{ fontSize: 11 }}>{pairFp.pair.system_a}</code></div>
                    <div style={cell(1.5)}><code style={{ fontSize: 11 }}>{pairFp.pair.system_b}</code></div>
                    <div style={{ ...cell(4), color: t.textMuted, fontStyle: isDefaultReason ? 'italic' : 'normal' }}>{pairFp.pair.reason}</div>
                    <ActionsCell id={key}
                      onEdit={() => editId === key ? setEditId(null) : startEdit(key, { system_a: pairFp.pair.system_a, system_b: pairFp.pair.system_b, reason: pairFp.pair.reason, kind: pairFp.kind })}
                      onDelete={() => deleteRule(fp)} />
                  </div>
                  {editId === key && (
                    <div style={{ ...editFormRow }}>
                      <Field label="Rule Type" k="kind"     src={editValues} setSrc={setEditValues} options={kindOpts.slice(0, 2)} />
                      {isEditPairKind && <>
                        <Field label="System A"  k="system_a" src={editValues} setSrc={setEditValues} />
                        <Field label="System B"  k="system_b" src={editValues} setSrc={setEditValues} />
                        <Field label="Reason"    k="reason"   src={editValues} setSrc={setEditValues} />
                      </>}
                      <SaveCancel onSave={() => savePairEdit(fp.node_id, pairFp.idx, pairFp.kind)} onCancel={() => setEditId(null)} />
                    </div>
                  )}
                </div>
              )
            })}
          </>
        )}
        {flat.length > 0 && (
          <div style={{ padding: '8px 16px', fontSize: 11, color: t.textFaintest, borderTop: `1px solid ${t.borderSubtle}` }}>
            {rules.length} node rule{rules.length !== 1 ? 's' : ''}
            {blacklistCount > 0 && ` · ${blacklistCount} blacklist pair${blacklistCount !== 1 ? 's' : ''}`}
            {whitelistCount > 0 && ` · ${whitelistCount} whitelist pair${whitelistCount !== 1 ? 's' : ''}`}
            {noHandoffCount > 0 && ` · ${noHandoffCount} no-handoff node${noHandoffCount !== 1 ? 's' : ''}`}
            {handoffSegCount > 0 && ` · ${handoffSegCount} handoff segment${handoffSegCount !== 1 ? 's' : ''}`}
          </div>
        )}
      </>
    )
  }

  // ── Solution Notes panel ─────────────────────────────────────────────────────

  function SolutionNotesPanel({ nodes: panelNodes, segments: panelSegments, initialFocus }: { nodes: CableNode[]; segments: CableSegment[]; initialFocus?: { kind: 'node' | 'segment'; id: string } }) {
    const [notes, setNotes] = useState<SolutionNote[]>([])
    const [categories, setCategories] = useState<NoteCategory[]>([])
    const [loading, setLoading] = useState(true)
    const [subTab, setSubTab] = useState<'notes' | 'categories'>('notes')
    const [lFilter, setLFilter] = useState('')
    const [lEditId, setLEditId] = useState<string | null>(null)
    const [lEditVals, setLEditVals] = useState<Record<string, unknown>>({})
    const [lAdding, setLAdding] = useState(!!initialFocus)
    const [lAddVals, setLAddVals] = useState<Record<string, unknown>>(
      initialFocus ? { target_kind: initialFocus.kind, target_id: initialFocus.id } : {}
    )
    const [lSaving, setLSaving] = useState(false)
    const [lError, setLError] = useState<string | null>(null)
    const [lDelConfirm, setLDelConfirm] = useState<string | null>(null)

    useEffect(() => {
      Promise.all([api.getSolutionNotes(), api.getNoteCategories()])
        .then(([n, c]) => { setNotes(n); setCategories(c) })
        .finally(() => setLoading(false))
    }, [])

    const categoryById = Object.fromEntries(categories.map(c => [c.id, c]))
    const nodeById = Object.fromEntries(panelNodes.map(n => [n.id, n]))
    const segById  = Object.fromEntries(panelSegments.map(s => [s.id, s]))

    const SEVERITIES: { value: NoteSeverity; label: string }[] = [
      { value: 'info',     label: 'Info' },
      { value: 'warning',  label: 'Warning' },
      { value: 'critical', label: 'Critical' },
    ]
    const SEVERITY_COLORS: Record<NoteSeverity, string> = { info: t.blue, warning: t.orange, critical: t.red }

    const addTargetKind = String(lAddVals.target_kind || 'node')
    const addCatOpts = categories
      .filter(c => c.applies_to === addTargetKind)
      .sort((a, b) => a.order - b.order)
      .map(c => ({ value: c.id, label: c.label }))

    const editTargetKind = lEditId
      ? (notes.find(n => n.id === lEditId)?.node_id ? 'node' : 'segment')
      : 'node'
    const editCatOpts = categories
      .filter(c => c.applies_to === editTargetKind)
      .sort((a, b) => a.order - b.order)
      .map(c => ({ value: c.id, label: c.label }))

    async function saveNote() {
      setLSaving(true); setLError(null)
      try {
        const kind = String(lAddVals.target_kind || 'node')
        const newNote: SolutionNote = {
          id: '',
          node_id:    kind === 'node'    ? String(lAddVals.target_id || '') : undefined,
          segment_id: kind === 'segment' ? String(lAddVals.target_id || '') : undefined,
          category_id: String(lAddVals.category_id || ''),
          title: String(lAddVals.title || ''),
          text: String(lAddVals.text || ''),
          severity: (lAddVals.severity as NoteSeverity) || 'info',
        }
        const created = await api.createSolutionNote(newNote)
        setNotes(prev => [...prev, created])
        setLAdding(false); setLAddVals({})
      } catch (e) { setLError(String(e)) }
      finally { setLSaving(false) }
    }

    async function updateNote(id: string) {
      setLSaving(true); setLError(null)
      try {
        const updated = await api.updateSolutionNote(id, lEditVals as Partial<SolutionNote>)
        setNotes(prev => prev.map(n => n.id === id ? updated : n))
        setLEditId(null)
      } catch (e) { setLError(String(e)) }
      finally { setLSaving(false) }
    }

    async function deleteNote(id: string) {
      setLSaving(true); setLError(null)
      try {
        await api.deleteSolutionNote(id)
        setNotes(prev => prev.filter(n => n.id !== id))
        setLDelConfirm(null)
      } catch (e) { setLError(String(e)) }
      finally { setLSaving(false) }
    }

    async function saveCat() {
      setLSaving(true); setLError(null)
      try {
        const cat: NoteCategory = {
          id: String(lAddVals.id || '').replace(/\s+/g, '-').toLowerCase(),
          label: String(lAddVals.label || ''),
          applies_to: String(lAddVals.applies_to || 'node') as 'node' | 'segment',
          order: Number(lAddVals.order || 0),
        }
        const created = await api.createNoteCategory(cat)
        setCategories(prev => [...prev, created].sort((a, b) => a.applies_to.localeCompare(b.applies_to) || a.order - b.order))
        setLAdding(false); setLAddVals({})
      } catch (e) { setLError(String(e)) }
      finally { setLSaving(false) }
    }

    async function updateCat(id: string) {
      setLSaving(true); setLError(null)
      try {
        const updated = await api.updateNoteCategory(id, lEditVals as Partial<NoteCategory>)
        setCategories(prev => prev.map(c => c.id === id ? updated : c))
        setLEditId(null)
      } catch (e) { setLError(String(e)) }
      finally { setLSaving(false) }
    }

    async function deleteCat(id: string) {
      setLSaving(true); setLError(null)
      try {
        await api.deleteNoteCategory(id)
        setCategories(prev => prev.filter(c => c.id !== id))
        setLDelConfirm(null)
      } catch (e) { setLError(String(e)) }
      finally { setLSaving(false) }
    }

    const filteredNotes = notes.filter(n => {
      if (!lFilter) return true
      const q = lFilter.toLowerCase()
      return (n.node_id ?? '').toLowerCase().includes(q)
        || (n.segment_id ?? '').toLowerCase().includes(q)
        || n.title.toLowerCase().includes(q)
        || n.text.toLowerCase().includes(q)
        || (categoryById[n.category_id]?.label ?? '').toLowerCase().includes(q)
    })

    const filteredCats = categories.filter(c =>
      !lFilter || c.label.toLowerCase().includes(lFilter.toLowerCase()) || c.applies_to.includes(lFilter.toLowerCase())
    )

    function SeverityBadge({ sev }: { sev: string }) {
      const color = SEVERITY_COLORS[sev as NoteSeverity] ?? t.blue
      return (
        <span style={{
          fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
          letterSpacing: '0.05em', textTransform: 'uppercase' as const,
          background: color + '22', color, border: `1px solid ${color}55`,
          whiteSpace: 'nowrap' as const,
        }}>
          {sev}
        </span>
      )
    }

    function ActionBtns({ id, onEdit, onDelete }: { id: string; onEdit: () => void; onDelete: () => void }) {
      return (
        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
          {lDelConfirm === id ? (
            <>
              <button style={actionBtn('confirm')} disabled={lSaving} onClick={onDelete}>Confirm</button>
              <button style={actionBtn('cancel')} onClick={() => setLDelConfirm(null)}>Cancel</button>
            </>
          ) : (
            <>
              <button style={actionBtn('edit')} onClick={onEdit}>Edit</button>
              <button style={actionBtn('delete')} onClick={() => { setLEditId(null); setLDelConfirm(id) }}>Delete</button>
            </>
          )}
        </div>
      )
    }

    if (loading) {
      return <div style={{ padding: 20, color: t.textFaint, fontSize: 13 }}>Loading solution notes…</div>
    }

    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* Sub-tab bar */}
        <div style={{ display: 'flex', gap: 2, padding: '8px 12px 0', borderBottom: `1px solid ${t.border}`, flexShrink: 0 }}>
          {(['notes', 'categories'] as const).map(st => (
            <button key={st} onClick={() => { setSubTab(st); setLAdding(false); setLAddVals({}); setLFilter('') }}
              style={{
                padding: '5px 14px', borderRadius: '4px 4px 0 0', fontSize: 12, fontWeight: subTab === st ? 700 : 400,
                border: `1px solid ${subTab === st ? t.border : 'transparent'}`, borderBottom: 'none',
                background: subTab === st ? t.bgPanel : 'transparent',
                color: subTab === st ? t.text : t.textFaint, cursor: 'pointer',
              }}>
              {st === 'notes' ? `Notes (${notes.length})` : `Categories (${categories.length})`}
            </button>
          ))}
        </div>

        {/* Filter + Add bar */}
        <div style={{ display: 'flex', gap: 8, padding: '6px 12px', borderBottom: `1px solid ${t.border}`, flexShrink: 0 }}>
          <input
            placeholder={`Filter ${subTab}…`}
            value={lFilter} onChange={e => setLFilter(e.target.value)}
            style={{ ...inputStyle, flex: 1, padding: '5px 8px' }}
          />
          <button onClick={() => { setLAdding(v => !v); setLAddVals({}) }}
            style={{ ...actionBtn('add'), padding: '5px 12px', flexShrink: 0 }}>
            {lAdding ? 'Cancel' : `+ Add ${subTab === 'notes' ? 'note' : 'category'}`}
          </button>
        </div>

        {lError && (
          <div style={{ padding: '6px 12px', fontSize: 12, color: t.red, background: t.red + '11', borderBottom: `1px solid ${t.border}` }}>
            {lError}
          </div>
        )}

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {/* ── Notes sub-tab ── */}
          {subTab === 'notes' && (
            <>
              {lAdding && (
                <div style={{ ...editFormRow, margin: '8px 12px' }}>
                  <Field label="Target *" k="target_kind" src={lAddVals}
                    setSrc={v => setLAddVals({ ...v, target_id: '' })}
                    options={[{ value: 'node', label: 'Node' }, { value: 'segment', label: 'Segment' }]} />
                  {addTargetKind === 'node'
                    ? <NodeSearchField label="Node *" k="target_id" src={lAddVals} setSrc={setLAddVals} nodes={panelNodes} />
                    : <SegmentSearchField label="Segment *" k="target_id" src={lAddVals} setSrc={setLAddVals} segments={panelSegments} />
                  }
                  <Field label="Category *" k="category_id" src={lAddVals} setSrc={setLAddVals} options={addCatOpts} />
                  <Field label="Severity" k="severity" src={lAddVals} setSrc={setLAddVals}
                    options={SEVERITIES.map(s => ({ value: s.value, label: s.label }))} />
                  <Field label="Title *" k="title" src={lAddVals} setSrc={setLAddVals} />
                  <Field label="Notes *" k="text" src={lAddVals} setSrc={setLAddVals} multiline />
                  <SaveCancel onSave={saveNote} onCancel={() => { setLAdding(false); setLAddVals({}) }} disabled={lSaving} />
                </div>
              )}
              {!isMobile && (
                <div style={{ display: 'flex', padding: '6px 12px', borderBottom: `1px solid ${t.border}`, background: t.bgDeep }}>
                  <div style={colH(0.8)}>Sev</div>
                  <div style={colH(1)}>Target</div>
                  <div style={colH(2)}>Category</div>
                  <div style={colH(2)}>Title</div>
                  <div style={colH(4)}>Notes</div>
                  <div style={colH(1)}>Date</div>
                  <div style={{ width: 140, flexShrink: 0 }} />
                </div>
              )}
              {filteredNotes.length === 0 && (
                <div style={{ padding: '20px 16px', color: t.textFaintest, fontSize: 13 }}>No solution notes. Add one above.</div>
              )}
              {filteredNotes.map(note => {
                const targetId = note.node_id ?? note.segment_id ?? ''
                const targetKind = note.node_id ? 'node' : 'segment'
                const targetName = note.node_id
                  ? (nodeById[note.node_id]?.name ?? note.node_id)
                  : (segById[note.segment_id ?? '']?.name ?? note.segment_id ?? '')
                const catLabel = categoryById[note.category_id]?.label ?? note.category_id
                return (
                  <div key={note.id} style={rowStyle(lEditId === note.id)}>
                    <div style={{ display: 'flex', alignItems: 'center', padding: '7px 12px', minHeight: 36 }}>
                      {isMobile ? (
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', gap: 6, marginBottom: 3, flexWrap: 'wrap' }}>
                            <SeverityBadge sev={note.severity} />
                            <code style={{ fontSize: 11 }}>{targetId}</code>
                            <span style={{ fontSize: 10, color: t.textFaint }}>{catLabel}</span>
                          </div>
                          <div style={{ fontSize: 12, fontWeight: 600, color: t.text }}>{note.title}</div>
                          <div style={{ fontSize: 11, color: t.textMuted, marginTop: 2 }}>{note.text}</div>
                        </div>
                      ) : (
                        <>
                          <div style={cell(0.8)}><SeverityBadge sev={note.severity} /></div>
                          <div style={cell(1)}>
                            <span style={{ fontSize: 9, color: targetKind === 'node' ? t.blue : t.green, fontWeight: 700, marginRight: 3, textTransform: 'uppercase' }}>{targetKind}</span>
                            <code style={{ fontSize: 11 }}>{targetId}</code>
                            {targetName !== targetId && <span style={{ fontSize: 9, color: t.textFaint, marginLeft: 3 }}>{targetName}</span>}
                          </div>
                          <div style={{ ...cell(2), color: t.textMuted, fontSize: 11 }}>{catLabel}</div>
                          <div style={{ ...cell(2) }}>{note.title}</div>
                          <div style={{ ...cell(4), color: t.textMuted, fontSize: 11, whiteSpace: 'normal' }}>{note.text}</div>
                          <div style={{ ...cell(1), fontSize: 10, color: t.textFaintest }}>{note.created_at ?? '—'}</div>
                        </>
                      )}
                      <ActionBtns id={note.id}
                        onEdit={() => lEditId === note.id ? setLEditId(null) : (() => { setLEditId(note.id); setLEditVals({ category_id: note.category_id, title: note.title, text: note.text, severity: note.severity }) })()}
                        onDelete={() => deleteNote(note.id)} />
                    </div>
                    {lEditId === note.id && (
                      <div style={{ ...editFormRow }}>
                        <Field label="Category" k="category_id" src={lEditVals} setSrc={setLEditVals} options={editCatOpts} />
                        <Field label="Severity" k="severity" src={lEditVals} setSrc={setLEditVals}
                          options={SEVERITIES.map(s => ({ value: s.value, label: s.label }))} />
                        <Field label="Title" k="title" src={lEditVals} setSrc={setLEditVals} />
                        <Field label="Notes" k="text" src={lEditVals} setSrc={setLEditVals} multiline />
                        <SaveCancel onSave={() => updateNote(note.id)} onCancel={() => setLEditId(null)} disabled={lSaving} />
                      </div>
                    )}
                  </div>
                )
              })}
              <div style={{ padding: '6px 16px', fontSize: 11, color: t.textFaintest, borderTop: `1px solid ${t.borderSubtle}` }}>
                {notes.length} note{notes.length !== 1 ? 's' : ''}
                {' · '}
                {notes.filter(n => n.node_id).length} on nodes
                {' · '}
                {notes.filter(n => n.segment_id).length} on segments
              </div>
            </>
          )}

          {/* ── Categories sub-tab ── */}
          {subTab === 'categories' && (
            <>
              {lAdding && (
                <div style={{ ...editFormRow, margin: '8px 12px' }}>
                  <Field label="ID (slug) *" k="id" src={lAddVals} setSrc={setLAddVals} placeholder="e.g. node-custom" />
                  <Field label="Label *" k="label" src={lAddVals} setSrc={setLAddVals} />
                  <Field label="Applies To *" k="applies_to" src={lAddVals} setSrc={setLAddVals}
                    options={[{ value: 'node', label: 'Node' }, { value: 'segment', label: 'Segment' }]} />
                  <Field label="Order" k="order" src={lAddVals} setSrc={setLAddVals} type="number" />
                  <SaveCancel onSave={saveCat} onCancel={() => { setLAdding(false); setLAddVals({}) }} disabled={lSaving} />
                </div>
              )}
              {!isMobile && (
                <div style={{ display: 'flex', padding: '6px 12px', borderBottom: `1px solid ${t.border}`, background: t.bgDeep }}>
                  <div style={colH(2)}>ID</div>
                  <div style={colH(3)}>Label</div>
                  <div style={colH(1.5)}>Applies To</div>
                  <div style={colH(1)}>Order</div>
                  <div style={{ width: 140, flexShrink: 0 }} />
                </div>
              )}
              {filteredCats.length === 0 && (
                <div style={{ padding: '20px 16px', color: t.textFaintest, fontSize: 13 }}>No categories found.</div>
              )}
              {filteredCats.map(cat => (
                <div key={cat.id} style={rowStyle(lEditId === cat.id)}>
                  <div style={{ display: 'flex', alignItems: 'center', padding: '7px 12px', minHeight: 36 }}>
                    {isMobile ? (
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: t.text }}>{cat.label}</div>
                        <div style={{ fontSize: 10, color: t.textFaint }}>{cat.applies_to} · order {cat.order}</div>
                        <code style={{ fontSize: 10, color: t.textFaintest }}>{cat.id}</code>
                      </div>
                    ) : (
                      <>
                        <div style={cell(2)}><code style={{ fontSize: 11 }}>{cat.id}</code></div>
                        <div style={cell(3)}>{cat.label}</div>
                        <div style={cell(1.5)}>
                          <span style={{
                            fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
                            background: cat.applies_to === 'node' ? t.blue + '22' : t.green + '22',
                            color: cat.applies_to === 'node' ? t.blue : t.green,
                          }}>{cat.applies_to}</span>
                        </div>
                        <div style={{ ...cell(1), color: t.textFaint }}>{cat.order}</div>
                      </>
                    )}
                    <ActionBtns id={cat.id}
                      onEdit={() => lEditId === cat.id ? setLEditId(null) : (() => { setLEditId(cat.id); setLEditVals({ label: cat.label, applies_to: cat.applies_to, order: cat.order }) })()}
                      onDelete={() => deleteCat(cat.id)} />
                  </div>
                  {lEditId === cat.id && (
                    <div style={{ ...editFormRow }}>
                      <Field label="Label" k="label" src={lEditVals} setSrc={setLEditVals} />
                      <Field label="Applies To" k="applies_to" src={lEditVals} setSrc={setLEditVals}
                        options={[{ value: 'node', label: 'Node' }, { value: 'segment', label: 'Segment' }]} />
                      <Field label="Order" k="order" src={lEditVals} setSrc={setLEditVals} type="number" />
                      <SaveCancel onSave={() => updateCat(cat.id)} onCancel={() => setLEditId(null)} disabled={lSaving} />
                    </div>
                  )}
                </div>
              ))}
              <div style={{ padding: '6px 16px', fontSize: 11, color: t.textFaintest, borderTop: `1px solid ${t.borderSubtle}` }}>
                {categories.filter(c => c.applies_to === 'node').length} node categories
                {' · '}
                {categories.filter(c => c.applies_to === 'segment').length} segment categories
              </div>
            </>
          )}
        </div>
      </div>
    )
  }

  // ── Checks tab ────────────────────────────────────────────────────────────────

  const [checkResults, setCheckResults] = useState<CheckResult[] | null>(null)
  const [checkLoading, setCheckLoading] = useState(false)
  const [checkError, setCheckError] = useState<string | null>(null)
  const [reseedStatus, setReseedStatus] = useState<string | null>(null)
  const [reseedLoading, setReseedLoading] = useState(false)

  async function runChecks() {
    setCheckLoading(true); setCheckError(null)
    try {
      const res = await api.getChecks()
      setCheckResults(res.checks)
    } catch {
      setCheckError('Failed to reach backend — is it running?')
    } finally {
      setCheckLoading(false)
    }
  }

  useEffect(() => { if (tab === 'checks' && checkResults === null) runChecks() }, [tab])

  function ChecksTab() {
    const errors   = checkResults?.filter(c => !c.passed && c.severity === 'error')   ?? []
    const warnings = checkResults?.filter(c => !c.passed && c.severity === 'warning') ?? []
    const passed   = checkResults?.filter(c => c.passed) ?? []
    const allPassed = checkResults !== null && errors.length === 0

    const dot = (color: string) => (
      <div style={{ width: 9, height: 9, borderRadius: '50%', background: color, flexShrink: 0, marginTop: 2 }} />
    )

    const rowItem = (c: CheckResult) => (
      <div key={c.name} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '6px 0', borderBottom: `1px solid ${t.border}` }}>
        {dot(c.passed ? '#a6e3a1' : c.severity === 'warning' ? '#f9e2af' : '#f38ba8')}
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: t.text }}>{c.name}</div>
          {!c.passed && c.message && (
            <div style={{ fontSize: 11, color: t.textFaint, marginTop: 2, fontFamily: 'monospace', wordBreak: 'break-all' }}>
              {c.message}
            </div>
          )}
        </div>
      </div>
    )

    async function runReseed() {
      setReseedLoading(true); setReseedStatus(null)
      try {
        const r = await api.adminReseed()
        if (r.status === 'skipped') {
          setReseedStatus(`Skipped — ${r.reason}`)
        } else {
          const counts = r.reseeded!
          setReseedStatus(`Reseeded: ${counts.segments} segments · ${counts.nodes} nodes · ${counts.systems} systems · ${counts.capacity} capacity · ${counts.outages} outages · ${counts.rules} rules`)
          onDataChange()
        }
      } catch (e) {
        setReseedStatus(`Error: ${e}`)
      } finally {
        setReseedLoading(false)
      }
    }

    return (
      <div style={{ padding: '20px 24px', maxWidth: 680 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <button
            onClick={runChecks}
            disabled={checkLoading}
            style={{ padding: '6px 16px', borderRadius: 4, border: `1px solid ${t.blue}`, background: 'transparent', color: t.blue, fontWeight: 600, fontSize: 12, cursor: checkLoading ? 'not-allowed' : 'pointer' }}
          >
            {checkLoading ? 'Running…' : '↻ Re-run checks'}
          </button>
          {checkResults !== null && !checkLoading && (
            <span style={{ fontSize: 12, color: allPassed ? '#a6e3a1' : '#f38ba8', fontWeight: 600 }}>
              {allPassed ? `✓ All ${checkResults.length} checks passed` : `✗ ${errors.length} error${errors.length !== 1 ? 's' : ''}${warnings.length > 0 ? `, ${warnings.length} warning${warnings.length !== 1 ? 's' : ''}` : ''}`}
            </span>
          )}
          {checkError && <span style={{ fontSize: 12, color: t.red }}>{checkError}</span>}
        </div>

        <div style={{ marginBottom: 24, borderRadius: 6, border: `1px solid #f38ba8`, overflow: 'hidden' }}>
          <div style={{ background: '#f38ba822', padding: '8px 14px', borderBottom: '1px solid #f38ba8', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 14 }}>⚠️</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#f38ba8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Factory Reset — Destructive</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', background: t.bgDeep }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: t.text, marginBottom: 2 }}>Reseed from JSON</div>
              <div style={{ fontSize: 11, color: t.textFaint }}>
                Wipes all data in Postgres and replaces it with the bundled JSON files from the deployed build.
                <strong style={{ color: '#f38ba8' }}> Any changes made via the API (nodes, segments, systems, rules) will be permanently lost.</strong>
                {' '}Only use this to recover from a corrupted database or after a deliberate JSON baseline update.
              </div>
              {reseedStatus && (
                <div style={{ fontSize: 11, marginTop: 6, color: reseedStatus.startsWith('Error') ? t.red : t.green }}>
                  {reseedStatus}
                </div>
              )}
            </div>
            <button
              onClick={runReseed}
              disabled={reseedLoading}
              style={{ padding: '6px 14px', borderRadius: 4, border: `1px solid #f38ba8`, background: 'transparent', color: '#f38ba8', fontWeight: 600, fontSize: 12, cursor: reseedLoading ? 'not-allowed' : 'pointer', flexShrink: 0 }}
            >
              {reseedLoading ? 'Reseeding…' : '⟳ Reseed from JSON'}
            </button>
          </div>
        </div>

        {checkLoading && (
          <div style={{ color: t.textFaint, fontSize: 13 }}>Running integrity checks…</div>
        )}

        {checkResults !== null && !checkLoading && (
          <>
            {errors.length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#f38ba8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Errors — {errors.length}</div>
                {errors.map(rowItem)}
              </div>
            )}
            {warnings.length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#f9e2af', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Warnings — {warnings.length}</div>
                {warnings.map(rowItem)}
              </div>
            )}
            {passed.length > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: t.textFaint, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Passed — {passed.length}</div>
                {passed.map(rowItem)}
              </div>
            )}
          </>
        )}
      </div>
    )
  }

  // ── Config tab ───────────────────────────────────────────────────────────────

  function ConfigTab() {
    const allOwnership = [
      { value: 'owned',                label: 'Owned' },
      { value: 'consortium',           label: 'Consortium' },
      { value: 'iru',                  label: 'IRU' },
      { value: 'integrated_lit_lease', label: 'Integrated Lit Lease' },
      { value: 'offnet_resell',        label: 'Offnet Resell' },
    ]
    return (
      <div style={{ padding: '20px 24px', maxWidth: 480 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: t.text, marginBottom: 4 }}>Network Classification</div>
        <div style={{ fontSize: 11, color: t.textFaint, marginBottom: 16 }}>
          Controls which ownership types are treated as On-Net vs Off-Net throughout the app.
          Changes are saved to the backend and apply globally.
        </div>
        <div style={{ border: `1px solid ${t.border}`, borderRadius: 6, overflow: 'hidden' }}>
          {/* Header */}
          <div style={{ display: 'flex', padding: '6px 12px', background: t.bgDeep, borderBottom: `1px solid ${t.border}` }}>
            <div style={{ flex: 1, fontSize: 10, fontWeight: 700, color: t.textFaint, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Ownership Type</div>
            <div style={{ width: 110, fontSize: 10, fontWeight: 700, color: t.textFaint, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Network</div>
          </div>
          {allOwnership.map(({ value, label }) => {
            const onNet = isOnNet(value)
            return (
              <div key={value} style={{ display: 'flex', alignItems: 'center', padding: '10px 12px', borderBottom: `1px solid ${t.border}` }}>
                <div style={{ flex: 1, fontSize: 13, color: t.text }}>{label}</div>
                <div style={{ width: 110, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 3,
                    letterSpacing: '0.04em',
                    background: onNet ? '#a6e3a122' : '#f9e2af22',
                    color: onNet ? '#a6e3a1' : '#f9e2af',
                    border: `1px solid ${onNet ? '#a6e3a144' : '#f9e2af44'}`,
                  }}>
                    {onNet ? 'ON-NET' : 'OFF-NET'}
                  </span>
                  <button
                    onClick={() => toggleOnNet(value)}
                    title="Toggle On-Net / Off-Net"
                    style={{
                      fontSize: 11, padding: '2px 8px', borderRadius: 3, cursor: 'pointer',
                      border: `1px solid ${t.border}`, background: t.bgCard, color: t.textMuted,
                    }}
                  >
                    ⇄
                  </button>
                </div>
              </div>
            )
          })}
        </div>
        <button
          onClick={async () => {
            setOnNetOwnership(new Set(DEFAULT_ONNET))
            await api.updateConfig({ on_net_ownership: DEFAULT_ONNET })
            onDataChange()
          }}
          style={{ marginTop: 12, fontSize: 11, padding: '4px 10px', borderRadius: 4, cursor: 'pointer', border: `1px solid ${t.border}`, background: 'transparent', color: t.textMuted }}
        >
          Reset to defaults
        </button>
      </div>
    )
  }

  // ── Counts & add defaults ────────────────────────────────────────────────────

  const totalPairs = rules.reduce((n, r) => n + r.disallowed_pairs.length + (r.allowed_pairs?.length ?? 0), 0)
  const counts: Record<DataTab, number> = { nodes: nodes.length, segments: segments.length, systems: systems.length, capacity: capacity.length, outages: outages.length, rules: totalPairs }
  const addDefaults: Record<DataTab, Record<string, unknown>> = {
    nodes:    { id: '', name: '', country: '', type: 'landing_station', lat: 0, lng: 0, owner: 'Telstra', trading_name: '', description: '' },
    segments: { id: '', name: '', system_id: '', start_node_id: '', end_node_id: '', type: 'wet', length_km: 0, latency: 0, cost_weight: 1, reliability: 0.9999, ownership: 'consortium' },
    systems:  { id: '', name: '', description: '', margin: 8 },
    capacity: { segment_id: '', total_capacity_t: 1.0, available_capacity_t: 1.0 },
    outages:  { segment_id: '', fault_id: '', fault_date: '', repair_start: '', estimated_repair_date: 'TBC', description: '' },
    rules:    { node_id: '', kind: 'blacklist', system_a: '', system_b: '', reason: '' },
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div style={modalBg} onClick={onClose}>
      <div style={modalBox} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', padding: '14px 20px', borderBottom: `1px solid ${t.border}`, flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: t.text }}>Reference Data</div>
            <div style={{ fontSize: 11, color: t.textFaint }}>View and edit network reference data — changes persist immediately to the backend</div>
          </div>
          <button onClick={onClose} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: t.textFaint, fontSize: 20, lineHeight: 1, padding: '2px 6px' }}>×</button>
        </div>

        {/* Scrollable tab bar */}
        <div style={{ display: 'flex', overflowX: 'auto', borderBottom: `1px solid ${t.border}`, flexShrink: 0, background: t.bgDeep, scrollbarWidth: 'none' } as React.CSSProperties}>
          {([
            { id: 'nodes',    label: 'Nodes',      count: counts.nodes },
            { id: 'segments', label: 'Segments',   count: counts.segments },
            { id: 'systems',  label: 'Systems',    count: counts.systems },
            { id: 'capacity', label: 'Capacity',   count: counts.capacity },
            { id: 'coverage', label: '🟢 Coverage', count: null },
            { id: 'outages',  label: 'Outages',    count: counts.outages },
            { id: 'rules',    label: 'Rules',      count: counts.rules },
            { id: 'notes',    label: '📋 Notes',   count: null },
            { id: 'tech',     label: '🔧 Tech',    count: null },
            { id: 'config',   label: '⚙ Config',   count: null },
            { id: 'checks',   label: '⚡ Checks',  count: null },
            { id: 'bulk',     label: '🔄 Bulk',    count: null },
          ] as { id: Tab; label: string; count: number | null }[]).map(({ id: tb, label, count }) => {
            const active = tab === tb
            const color = tb === 'coverage' ? t.green : tb === 'bulk' ? '#0ea5e9' : tb === 'tech' ? '#a78bfa' : t.blue
            return (
              <button key={tb} onClick={() => switchTab(tb)} style={{
                flexShrink: 0, padding: isMobile ? '9px 12px' : '10px 14px',
                border: 'none', background: 'transparent', cursor: 'pointer',
                fontSize: isMobile ? 11 : 12, fontWeight: active ? 700 : 400,
                color: active ? color : t.textFaint, whiteSpace: 'nowrap',
                borderBottom: active ? `2px solid ${color}` : '2px solid transparent',
              }}>
                {label}{count != null && <span style={{ fontSize: 10, opacity: 0.7 }}> ({count})</span>}
              </button>
            )
          })}
        </div>

        {/* Filter + add bar — only for data tabs */}
        {tab !== 'checks' && tab !== 'config' && tab !== 'coverage' && tab !== 'bulk' && tab !== 'tech' && tab !== 'notes' && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: isMobile ? '8px 12px' : '6px 20px', borderBottom: `1px solid ${t.border}`, flexShrink: 0, background: t.bgPanel }}>
            <input
              placeholder={`Filter ${tab}…`}
              value={filter}
              onChange={e => setFilter(e.target.value)}
              style={{ ...inputStyle, flex: 1, padding: '5px 8px' }}
            />
            <button onClick={() => startAdd(addDefaults[tab as DataTab])} style={{ ...actionBtn('add'), padding: '5px 12px', flexShrink: 0 }}>
              + Add {tab === 'rules' ? 'pair' : tab.slice(0, -1)}
            </button>
          </div>
        )}

        {/* Table body */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {tab === 'nodes'    && NodeTab()}
          {tab === 'segments' && SegmentTab()}
          {tab === 'systems'  && SystemTab()}
          {tab === 'capacity' && CapacityTab()}
          {tab === 'outages'  && OutagesTab()}
          {tab === 'rules'    && RulesTab()}
          {tab === 'checks'   && ChecksTab()}
          {tab === 'config'   && ConfigTab()}
          {tab === 'coverage' && <ProductCoveragePanel nodes={nodes} onDataChange={onDataChange} />}
          {tab === 'tech'     && <TechEnrichmentPanel />}
          {tab === 'notes'    && <SolutionNotesPanel nodes={nodes} segments={segments} initialFocus={initialNoteFocus} />}
          {tab === 'bulk' && (
            <BulkImportPanel
              counts={{
                nodes:    nodes.length,
                segments: segments.length,
                systems:  systems.filter(s => s.id !== 'TERRESTRIAL').length,
                capacity: capacity.length,
                coverage: nodes.filter(n => n.capabilities).length,
              }}
              onDataChange={onDataChange}
            />
          )}
        </div>

      </div>
    </div>
  )
}
