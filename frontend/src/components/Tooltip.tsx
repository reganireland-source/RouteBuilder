/**
 * components/Tooltip.tsx — a small, subtle floating label for icon-only or
 * otherwise ambiguous controls.
 *
 * Native title="" attributes already cover most of the app (120+ of them)
 * and are left alone everywhere they already work — this component exists
 * for the places a native tooltip's slow, inconsistent, OS-styled popup
 * falls short: fast-moving chrome (the Controls menu, the Asset Filter bar)
 * that benefits from a quick, theme-matched hint, and a few places that
 * currently have no hint at all despite being icon-only.
 *
 * Deliberately restrained, per the brief this was built against ("subtle"):
 * a short hover-intent delay (350ms) before showing, so it never flickers on
 * a pointer just passing through, and an instant hide on mouseleave, so it's
 * never in the way of the next click. No arrow, no heavy chrome — a small
 * dark pill that fades and rises 2px into place (rb-anim-rise, see
 * index.html's motion-system comment).
 *
 * Positioned via a portal + getBoundingClientRect, the same pattern
 * RouteList.tsx's "Segment Breakdown" hover popup already uses, rather than
 * `position: absolute` inside the trigger's own DOM parent — that would clip
 * inside any menu/modal with `overflow: hidden`, which several of this
 * component's actual use sites (the Controls menu, the Asset Filter
 * dropdown) have.
 */
import { useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useTheme } from '../theme'

const SHOW_DELAY_MS = 350

interface Props {
  label: string
  children: ReactNode
  /** Which side of the trigger to prefer. Falls back to the other side if
   *  the preferred one would run off the top of the viewport. */
  side?: 'top' | 'bottom'
}

export function Tooltip({ label, children, side = 'top' }: Props) {
  const t = useTheme()
  const [pos, setPos] = useState<{ x: number; y: number; side: 'top' | 'bottom' } | null>(null)
  const wrapRef = useRef<HTMLSpanElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function show() {
    timerRef.current = setTimeout(() => {
      const el = wrapRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      // A tooltip that prefers "top" but has no room above (the trigger is
      // near the viewport's own top edge — e.g. the Controls button) flips
      // to below instead of rendering half off-screen.
      const actualSide: 'top' | 'bottom' = side === 'top' && rect.top < 40 ? 'bottom' : side
      setPos({
        x: rect.left + rect.width / 2,
        y: actualSide === 'top' ? rect.top - 8 : rect.bottom + 8,
        side: actualSide,
      })
    }, SHOW_DELAY_MS)
  }

  function hide() {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
    setPos(null)
  }

  return (
    <span
      ref={wrapRef}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      style={{ display: 'inline-flex', minWidth: 0 }}
    >
      {children}
      {pos && createPortal(
        <div
          role="tooltip"
          className="rb-anim-rise"
          style={{
            position: 'fixed', left: pos.x, top: pos.y,
            transform: `translate(-50%, ${pos.side === 'top' ? '-100%' : '0'})`,
            // Above ConfirmDialog's own 12500 (documented there as
            // "deliberately the highest in the app") — a tooltip has to sit
            // above whatever it's attached to, including a confirm prompt,
            // so that invariant now has one narrow, intentional exception;
            // see ConfirmDialog.tsx's own comment for the cross-reference.
            zIndex: 12600, pointerEvents: 'none',
            background: t.bgDeep, color: t.text,
            border: `1px solid ${t.border}`, borderRadius: 5,
            padding: '4px 8px', fontSize: 11, fontWeight: 600,
            whiteSpace: 'nowrap', boxShadow: '0 4px 14px rgba(0,0,0,0.35)',
          }}
        >
          {label}
        </div>,
        document.body,
      )}
    </span>
  )
}
