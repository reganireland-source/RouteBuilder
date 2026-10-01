/**
 * ConfirmDialog — themed replacement for window.confirm().
 *
 * The browser's native confirm box is jarring (it's chrome, not the app — it
 * shows the raw hostname, ignores the theme, and blocks the whole tab), so
 * anywhere the editor needs a yes/no it renders this instead: same visual
 * language as App.tsx's "Discard route?" dialog, portalled to document.body
 * so it sits above the map and every panel.
 *
 * Its z-index (12500) is deliberately the highest static layer in the app —
 * higher than RefDataModal (11000) and OutageParserModal (12100) — because a
 * confirm is always asked *on behalf of* whatever is already on top, so it
 * must never be covered by it (it silently was, until a Tech-Enrichment
 * delete surfaced it). The one narrow exception is Tooltip.tsx (12600):
 * a tooltip has to be able to sit above whatever it's attached to, including
 * a confirm prompt's own buttons, and it's transient/pointer-events:none, so
 * it can never trap focus or block this dialog's own interaction the way a
 * competing static layer would.
 *
 * Behaviour parity with the native dialog: Enter confirms, Escape cancels,
 * and the confirm button takes focus on mount so it's keyboard-driveable.
 *
 * NOTE for callers replacing window.confirm: this is ASYNC — the caller
 * returns immediately and the answer arrives via onConfirm/onCancel. Any
 * "undo the optimistic change" work (e.g. snapping a dragged marker back)
 * has to live in onCancel rather than running inline after the call.
 */
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'
import { useTheme } from '../theme'

interface Props {
  title: string
  body: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** Red confirm button for destructive actions; blue otherwise. */
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({ title, body, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false, onConfirm, onCancel }: Props) {
  const t = useTheme()
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    confirmRef.current?.focus()
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); onCancel() }
      if (e.key === 'Enter')  { e.preventDefault(); onConfirm() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onConfirm, onCancel])

  return createPortal(
    <div
      role="presentation"
      onClick={onCancel}
      className="rb-anim-fade"
      style={{
        position: 'fixed', inset: 0, zIndex: 12500,
        background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '0 24px',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={e => e.stopPropagation()}
        className="rb-anim-pop"
        style={{
          background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 12,
          padding: '24px 22px', width: '100%', maxWidth: 420, boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 700, color: t.text, marginBottom: 10 }}>{title}</div>
        <div style={{ fontSize: 13, color: t.textMuted, marginBottom: 22, lineHeight: 1.6 }}>{body}</div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            ref={confirmRef}
            onClick={onConfirm}
            style={{
              flex: 1, padding: '10px', borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: 'pointer',
              border: 'none', background: danger ? t.red : t.blue, color: danger ? '#fff' : '#0b1220',
              fontFamily: 'inherit',
            }}
          >{confirmLabel}</button>
          <button
            onClick={onCancel}
            style={{
              flex: 1, padding: '10px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer',
              border: `1px solid ${t.border}`, background: 'transparent', color: t.textMuted, fontFamily: 'inherit',
            }}
          >{cancelLabel}</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
