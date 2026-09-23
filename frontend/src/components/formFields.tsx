/**
 * formFields.tsx — shared tiny form primitives (same visual language as
 * RefDataModal), extracted from NetworkEditor.tsx so NewSegmentForm.tsx can
 * use the same inputs/buttons without duplicating or drifting from them.
 * Pure presentational components — no domain logic.
 */
import { useEffect, useId, useRef, useState } from 'react'
import { useTheme, type Theme } from '../theme'
import type { Ownership } from '../types'

export const OWNERSHIP_OPTS: { value: Ownership; label: string }[] = [
  { value: 'owned', label: 'Owned' },
  { value: 'consortium', label: 'Consortium' },
  { value: 'iru', label: 'IRU' },
  { value: 'integrated_lit_lease', label: 'Integrated Lit Lease' },
  { value: 'offnet_resell', label: 'Offnet Resell' },
]

export function useFieldStyles() {
  const t = useTheme()
  return {
    input: {
      background: t.bgInput, border: `1px solid ${t.border}`, borderRadius: 3,
      color: t.text, fontSize: 12, padding: '4px 7px', width: '100%',
      boxSizing: 'border-box' as const, fontFamily: 'inherit',
    },
    label: { fontSize: 10, color: t.textFaint, textTransform: 'uppercase' as const, letterSpacing: '0.05em' },
  }
}

export function LabeledInput({ label, value, onChange, placeholder, invalid }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; invalid?: boolean
}) {
  const t = useTheme()
  const s = useFieldStyles()
  const id = useId()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
      <label htmlFor={id} style={s.label}>{label}</label>
      <input
        id={id}
        style={{ ...s.input, border: `1px solid ${invalid ? t.red : t.border}` }}
        value={value} placeholder={placeholder} autoComplete="off"
        onChange={e => onChange(e.target.value)}
      />
    </div>
  )
}

export function LabeledSelect<T extends string>({ label, value, onChange, options }: {
  label: string; value: T; onChange: (v: T) => void; options: { value: T; label: string }[]
}) {
  const s = useFieldStyles()
  const id = useId()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
      <label htmlFor={id} style={s.label}>{label}</label>
      <select id={id} style={s.input} value={value} onChange={e => onChange(e.target.value as T)}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )
}

export interface TypeaheadOption { id: string; label: string }

/**
 * A themed, in-app replacement for the native `<input list>`/`<datalist>`
 * combo — that renders with the OS's own list-box chrome (a plain white
 * dropdown, unstyled, breaking the dark theme entirely), not this app's.
 * Same interaction shape as AssetSearch.tsx's own result list (mousedown-
 * not-click so the input's blur never tears the dropdown down before a click
 * lands, hover/keyboard share one `activeIdx`, click-outside closes) kept
 * generic here since AssetSearch's own list is tied to its ranked multi-kind
 * search rather than a plain filtered option list.
 *
 * DELIBERATELY REPORTS TWO THINGS SEPARATELY: `onChangeText` fires on every
 * keystroke (the box is not locked to the option list — think this is a
 * simple filter, not a strict enum), while `onPick` fires ONLY when a row is
 * actually chosen (click or Enter on the highlight) and hands back the real
 * `{id, label}` — the caller should treat "resolved" as "onPick fired since
 * the text last changed", not "the text happens to match something."
 */
export function Typeahead({
  value, onChangeText, onPick, options, placeholder, disabled, invalid, emptyText, id, ariaLabel,
}: {
  value: string
  onChangeText: (text: string) => void
  onPick: (option: TypeaheadOption) => void
  options: TypeaheadOption[]
  placeholder?: string
  disabled?: boolean
  invalid?: boolean
  emptyText?: string
  /** Pass this and pair it with a `<label htmlFor={id}>` at the call site
   *  when there's a visible label; use `ariaLabel` instead when the only
   *  hint is a placeholder (which screen readers can't rely on as a name). */
  id?: string
  ariaLabel?: string
}) {
  const t = useTheme()
  const s = useFieldStyles()
  const [open, setOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [])

  const q = value.trim().toLowerCase()
  const filtered = (q ? options.filter(o => o.label.toLowerCase().includes(q)) : options).slice(0, 50)

  function pick(o: TypeaheadOption) {
    onPick(o)
    setOpen(false)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActiveIdx(i => Math.min(i + 1, filtered.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter' && open && filtered[activeIdx]) { e.preventDefault(); pick(filtered[activeIdx]) }
    else if (e.key === 'Escape') { setOpen(false) }
  }

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <input
        id={id}
        aria-label={ariaLabel}
        value={value}
        onChange={e => { onChangeText(e.target.value); setOpen(true); setActiveIdx(0) }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        style={{ ...s.input, border: `1px solid ${invalid ? t.red : t.border}` }}
      />
      {open && !disabled && <TypeaheadDropdown filtered={filtered} activeIdx={activeIdx} onHover={setActiveIdx} onPick={pick} emptyText={emptyText} t={t} />}
    </div>
  )
}

function TypeaheadDropdown({ filtered, activeIdx, onHover, onPick, emptyText, t }: {
  filtered: TypeaheadOption[]; activeIdx: number
  onHover: (i: number) => void; onPick: (o: TypeaheadOption) => void
  emptyText?: string; t: Theme
}) {
  const panel: React.CSSProperties = {
    position: 'absolute', top: 'calc(100% + 3px)', left: 0, right: 0, zIndex: 1300,
    background: t.bgPanel, border: `1px solid ${t.border}`, borderRadius: 6,
    boxShadow: '0 8px 28px rgba(0,0,0,0.4)',
  }
  if (filtered.length === 0) {
    if (!emptyText) return null
    return <div style={{ ...panel, padding: '7px 9px', fontSize: 11, color: t.textFaint }}>{emptyText}</div>
  }
  return (
    <div style={{ ...panel, maxHeight: 240, overflowY: 'auto' }}>
      {filtered.map((o, i) => (
        <div
          key={o.id}
          // mousedown, not click: the input's blur would otherwise tear the
          // dropdown down before the click ever landed on a row.
          onMouseDown={e => { e.preventDefault(); onPick(o) }}
          onMouseEnter={() => onHover(i)}
          style={{
            padding: '6px 9px', fontSize: 11, color: t.text, cursor: 'pointer',
            background: i === activeIdx ? t.bgDeep : 'transparent',
            borderBottom: i < filtered.length - 1 ? `1px solid ${t.border}` : 'none',
          }}
        >{o.label}</div>
      ))}
    </div>
  )
}

export function actionBtn(t: ReturnType<typeof useTheme>, kind: 'primary' | 'danger' | 'ghost', disabled = false) {
  let bg: string = 'transparent'
  let color = '#fff'
  if (kind === 'primary') { bg = t.green; color = '#0b1f14' }
  else if (kind === 'danger') { bg = t.red }
  else { color = t.textMuted }
  return {
    flex: 1, padding: '8px 10px', borderRadius: 5, fontSize: 12, fontWeight: 700,
    cursor: disabled ? 'default' : 'pointer', fontFamily: 'inherit',
    border: kind === 'ghost' ? `1px solid ${t.border}` : 'none',
    background: disabled ? t.textFaintest : bg,
    color,
    opacity: disabled ? 0.6 : 1,
  } as const
}
