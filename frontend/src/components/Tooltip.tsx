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
 * a hover-intent delay (600ms — slower than a typical 300-350ms tooltip on
 * purpose, so it never fires on a pointer just passing through or briefly
 * resting mid-move) before showing, and an instant hide on mouseleave, so
 * it's never in the way of the next click. No arrow, no heavy chrome — a
 * small dark pill that fades into place (rb-anim-fade, see index.html's
 * motion-system comment — not rb-anim-rise, which also animates
 * `transform` and would fight this component's own positioning transform).
 *
 * Globally switchable off via the Controls menu (Appearance → Tooltips,
 * on by default) — see context/TooltipSettingsContext.tsx. `show()` simply
 * no-ops while disabled rather than every call site checking the setting
 * itself.
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
import { useTooltipSettings } from '../context/TooltipSettingsContext'

const SHOW_DELAY_MS = 600

interface Props {
  label: string
  children: ReactNode
  /** Which side of the trigger to prefer. Falls back to the other side if
   *  the preferred one would run off the top of the viewport. */
  side?: 'top' | 'bottom'
}

/** Where the tooltip pill is anchored horizontally: `left`/`right` are CSS
 *  positioning properties (mutually exclusive, only one is ever set), not a
 *  transform. That distinction matters here specifically: a `position:fixed`
 *  box's shrink-to-fit WIDTH is resolved from its layout position — `left`
 *  alone, near the viewport's right edge, leaves the browser thinking it
 *  only has a few px to grow into, and wraps the text into a column one
 *  word wide, since a `transform` is a purely visual, POST-layout shift
 *  that plays no part in that width calculation. Anchoring via `right`
 *  instead gives the box a real leftward budget to size itself against.
 *  `center` is the one case that still uses a transform (translateX(-50%))
 *  — safe there because the alignment decision below only picks `center`
 *  when there's confirmed room on both sides already. */
interface TooltipPos { top: number; side: 'top' | 'bottom'; left?: number; right?: number; centerX?: number }

/** The hard cap on how wide a tooltip pill is ever allowed to render
 *  (matches the CSS `maxWidth` below) — the fallback used for the alignment
 *  decision when a label is long enough to actually hit it and wrap. */
const MAX_TOOLTIP_WIDTH = 280

/** Estimate how wide THIS label will render, from its own character count —
 *  there's no rendered node to measure yet when the alignment decision is
 *  made, so this has to be a guess, but a per-label one is far closer than
 *  one constant across a "×" close button and a full sentence-length hint.
 *  ~6.3px/char is a reasonable average for this pill's 11px/600-weight
 *  Inter text; the +16 covers the pill's own horizontal padding. Erring
 *  wide (never narrow) is the safe direction — the failure mode of a too-
 *  wide estimate is switching to left/right-align a little earlier than it
 *  strictly needed to, not clipping off the viewport edge. */
function estimateTooltipWidth(label: string): number {
  return Math.min(MAX_TOOLTIP_WIDTH, label.length * 6.3 + 16)
}

export function Tooltip({ label, children, side = 'top' }: Props) {
  const t = useTheme()
  const { tooltipsEnabled } = useTooltipSettings()
  const [pos, setPos] = useState<TooltipPos | null>(null)
  const wrapRef = useRef<HTMLSpanElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function show() {
    if (!tooltipsEnabled) return
    timerRef.current = setTimeout(() => {
      // wrapRef itself is `display: contents` (see below) — it generates no
      // box of its own, so its OWN getBoundingClientRect() is always a zero
      // rect at (0,0). The actual rendered child is what needs measuring.
      const el = wrapRef.current?.firstElementChild as HTMLElement | null
      if (!el) return
      const rect = el.getBoundingClientRect()
      // A tooltip that prefers "top" but has no room above (the trigger is
      // near the viewport's own top edge — e.g. the Controls button) flips
      // to below instead of rendering half off-screen.
      const actualSide: 'top' | 'bottom' = side === 'top' && rect.top < 40 ? 'bottom' : side
      const top = actualSide === 'top' ? rect.top - 8 : rect.bottom + 8
      const center = rect.left + rect.width / 2
      const estWidth = estimateTooltipWidth(label)
      // See TooltipPos's own comment on why this picks left/right (real CSS
      // positioning, real layout width) over a transform-based shift.
      if (center + estWidth / 2 > window.innerWidth - 8) {
        setPos({ top, side: actualSide, right: window.innerWidth - rect.right })
      } else if (center - estWidth / 2 < 8) {
        setPos({ top, side: actualSide, left: rect.left })
      } else {
        setPos({ top, side: actualSide, centerX: center })
      }
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
      // `contents`: the wrapper takes no part in layout at all — its child
      // renders exactly as if this span weren't there — while still keeping
      // the DOM node these event handlers are attached to. That's what lets
      // Tooltip wrap ANYTHING (a 100%-width menu row, an inline icon button
      // in a flex row, ...) without fighting that element's own sizing.
      style={{ display: 'contents' }}
    >
      {children}
      {pos && createPortal(
        <div
          role="tooltip"
          // Plain opacity fade (rb-anim-fade), not rb-anim-rise: a CSS
          // animation owns the ENTIRE `transform` property for its whole
          // duration, not just the sub-part it sets, so a rise animation's
          // own translateY would silently clobber the positioning
          // translate below rather than combine with it.
          className="rb-anim-fade"
          style={{
            position: 'fixed', top: pos.top,
            ...(pos.left !== undefined ? { left: pos.left } : {}),
            ...(pos.right !== undefined ? { right: pos.right } : {}),
            ...(pos.centerX !== undefined ? { left: pos.centerX } : {}),
            transform: `translate(${pos.centerX !== undefined ? '-50%' : '0'}, ${pos.side === 'top' ? '-100%' : '0'})`,
            // Above ConfirmDialog's own 12500 (documented there as
            // "deliberately the highest in the app") — a tooltip has to sit
            // above whatever it's attached to, including a confirm prompt,
            // so that invariant now has one narrow, intentional exception;
            // see ConfirmDialog.tsx's own comment for the cross-reference.
            zIndex: 12600, pointerEvents: 'none',
            background: t.bgDeep, color: t.text,
            border: `1px solid ${t.border}`, borderRadius: 5,
            padding: '4px 8px', fontSize: 11, fontWeight: 600, lineHeight: 1.4,
            // `normal`, not `nowrap`: a maxWidth cap only actually caps
            // anything if long text is allowed to wrap onto a second line
            // instead of overflowing straight past the box.
            maxWidth: MAX_TOOLTIP_WIDTH, whiteSpace: 'normal', boxShadow: '0 4px 14px rgba(0,0,0,0.35)',
          }}
        >
          {label}
        </div>,
        document.body,
      )}
    </span>
  )
}
