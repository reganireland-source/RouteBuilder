/**
 * formFields.tsx — shared tiny form primitives (same visual language as
 * RefDataModal), extracted from NetworkEditor.tsx so NewSegmentForm.tsx can
 * use the same inputs/buttons without duplicating or drifting from them.
 * Pure presentational components — no domain logic.
 */
import { useTheme } from '../theme'
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
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
      <label style={s.label}>{label}</label>
      <input
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
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
      <label style={s.label}>{label}</label>
      <select style={s.input} value={value} onChange={e => onChange(e.target.value as T)}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
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
