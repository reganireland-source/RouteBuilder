/**
 * ============================================================================
 *  fullViewChrome.tsx — the shared shell behind every "Full View" modal.
 * ============================================================================
 *
 * NodeFullView answers "tell me everything about this node" on a page of its
 * own; SegmentFullView does the same for a cable segment. They show completely
 * different things, but they are the SAME KIND OF SCREEN, and a user who has
 * learned one should not have to learn the other: the same centred dialog, the
 * same card grid, the same 108px label gutter that collapses on a phone, the
 * same × in the same corner with the same touch target.
 *
 * Everything in this file is that shared chrome, lifted out of NodeFullView so
 * there is exactly one implementation of it rather than two that drift. It is
 * deliberately all presentation — no data fetching, no domain knowledge of
 * nodes or segments. A new Full View should be able to import this file, supply
 * a header and a set of <Card>s, and look native immediately.
 *
 * THE RESPONSIVE MODEL is the one non-obvious part. Three matchMedia
 * breakpoints are read ONCE by the modal at the top and published on
 * LayoutContext, so leaf helpers (Row, EditField, SelectField) adapt without
 * every caller threading flags down through the tree:
 *
 *   PHONE_PX (600)     — near-fullscreen sheet, two-line header, tighter
 *                        padding, and a 40px × so it stays thumb-reachable.
 *   STACK_PX (480)     — field labels move ABOVE their value instead of sitting
 *                        in a fixed gutter, because a 108px gutter on a 430px
 *                        screen leaves about one word per line.
 *   LANDSCAPE_PX (1100)— at or above this the body lays out as two side-by-side
 *                        columns rather than one tall scroll.
 *
 * Between PHONE_PX and LANDSCAPE_PX nothing special happens: that is the plain
 * stacked desktop layout, and it is the fallback for anything unusual.
 * ============================================================================
 */
import { createContext, useContext, useEffect, useState } from 'react'
import { useTheme } from '../theme'

/** Shorthand for the active theme object, used pervasively as a `t` prop. */
export type T = ReturnType<typeof useTheme>

// ── Responsive breakpoints ────────────────────────────────────────────────
/** At or below this the dialog becomes a near-fullscreen sheet and the header
 *  splits into two lines so the close button can never wrap out of reach. */
export const PHONE_PX = 600
/** At or below this the fixed 108px label gutter costs more than it buys, and
 *  labels move above their value/input instead of beside it. */
export const STACK_PX = 480
/** At or above this the dialog lays out as two side-by-side columns — a
 *  landscape reading rather than one tall scroll. */
export const LANDSCAPE_PX = 1100

// ── Stacking order ────────────────────────────────────────────────────────
// Full Views open ON TOP of each other: a node's capacity list opens the
// segment view, and the segment view's endpoints open the node view back. So
// the layer cannot be a per-TYPE constant — whichever view was opened second
// has to be on top whichever type it is, or the newer dialog ends up behind
// the older one's backdrop and is unclickable. Each view therefore takes the
// layer it was given and hands `+ Z_FULL_VIEW_STEP` to anything it opens.
//
// The ladder starts ABOVE RouteList's Segment Breakdown tooltip (9999), not
// below it: the tooltip is a hover overlay anchored to the route card, and
// clicking its ⛶ used to open a Full View that the tooltip then floated on top
// of until the pointer happened to move. It ends below RefDataModal (11000) and
// ConfirmDialog (12500), so a confirm prompt is never trapped behind the dialog
// that raised it. That window is what caps the depth.
/** Layer of the first Full View in a stack — above the route tooltip at 9999. */
export const Z_FULL_VIEW_BASE = 10000
/** Added for each view opened on top of another. */
export const Z_FULL_VIEW_STEP = 40
/** How many views may stack before the top of the ladder would reach
 *  RefDataModal at 11000. Past this a view opens IN PLACE of the current one
 *  (the ⛶ is hidden) rather than above it. */
export const MAX_FULL_VIEW_DEPTH = 12

/** The layer a view opened from one at `z` should use, or null when the stack
 *  is already as deep as it may go. */
export function nextFullViewLayer(z: number): number | null {
  const next = z + Z_FULL_VIEW_STEP
  return next > Z_FULL_VIEW_BASE + Z_FULL_VIEW_STEP * MAX_FULL_VIEW_DEPTH ? null : next
}

/** Shape copied from ProductHistory.tsx's `useNarrow`, parameterised by width. */
export function useMaxWidth(px: number): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && window.innerWidth <= px,
  )
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${px}px)`)
    const onChange = () => setMatches(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [px])
  return matches
}

export interface Layout {
  /** Near-fullscreen sheet, two-line header, tighter padding. */
  phone: boolean
  /** Two side-by-side columns instead of stacked rows. */
  landscape: boolean
  /** Field labels sit above their value rather than in a 108px gutter. */
  stackLabels: boolean
}

/** Publishes the current Layout (see `useFullViewLayout`) to every descendant so
 *  leaf helpers (Row, EditField, SelectField, ...) can adapt without the caller
 *  threading phone/landscape/stackLabels flags down through props by hand. */
export const LayoutContext = createContext<Layout>({ phone: false, landscape: false, stackLabels: false })

/** Reads the Layout published by the nearest `LayoutContext.Provider`. */
export function useLayout(): Layout {
  return useContext(LayoutContext)
}

/** Read all three breakpoints in one call — what a Full View does at the top of
 *  its render before publishing them on LayoutContext. */
export function useFullViewLayout(): Layout {
  const phone = useMaxWidth(PHONE_PX)
  const stackLabels = useMaxWidth(STACK_PX)
  const landscape = !useMaxWidth(LANDSCAPE_PX - 1)
  return { phone, landscape, stackLabels }
}

/** Escape handling, lifted out of the component so the modal body reads as
 *  layout. Deliberately re-subscribed on every render (no dep array) so the
 *  handler always closes over the latest navigation/editing state. */
export function useEscapeKey(onEscape: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onEscape() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
}

/** Click-outside-to-close, as a handler factory so the modal body stays flat. */
export function backdropClose(onClose: () => void) {
  return (e: React.MouseEvent) => { if (e.target === e.currentTarget) onClose() }
}

// ── Layout primitives ─────────────────────────────────────────────────────

/** One row of cards: side by side when there's room, stacked on a phone. */
export function rowStyle(phone: boolean) {
  return { display: 'flex', gap: phone ? 12 : 16, flexWrap: 'wrap', alignItems: 'flex-start' } as const
}

/**
 * One column of a landscape layout. Each card goes in its OWN ROW rather than
 * straight into the column, because a Card carries `flex: 1 1 320px` for the
 * side-by-side case and in a flex COLUMN that grows its HEIGHT — short cards
 * stretched to fill the column and left a page of empty space under their last
 * line. Inside a row the same flex sizes width, which is what it is for.
 */
export function FullViewColumn({ children, gap = 16 }: { children: React.ReactNode[]; gap?: number }) {
  // NOTE FOR CALLERS: this takes an ARRAY LITERAL as its single child, e.g.
  // <FullViewColumn>{[identityCard, endpointsCard]}</FullViewColumn>. React
  // validates that array for keys when the JSX is created — in the CALLER,
  // before this component runs — so keying the wrappers below does not satisfy
  // it. Each card element must carry its own `key` where it is defined.
  return (
    <div style={{ flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', gap }}>
      {children.map((card, i) => (
        // Index keys on the wrappers: a fixed, ordered list of literal cards
        // that never reorders, so the index IS the identity.
        <div key={i} style={{ display: 'flex', alignItems: 'flex-start' }}>{card}</div>
      ))}
    </div>
  )
}

/** The scrolling body beneath the header. `flex: 1; minHeight: 0` is what stops
 *  a tall card from pushing the dialog past its maxHeight instead of scrolling. */
export function scrollerStyle(phone: boolean): React.CSSProperties {
  return {
    overflowY: 'auto', WebkitOverflowScrolling: 'touch', flex: 1, minHeight: 0,
    padding: phone ? 10 : 16,
  }
}

/** Near-fullscreen sheet on a phone (a 6px inset from the backdrop's padding),
 *  a centred `maxW` dialog everywhere else. */
export function dialogStyle(t: T, phone: boolean, maxW = 1180) {
  return {
    background: t.bgPanel, border: `1px solid ${t.border}`, borderRadius: phone ? 8 : 12,
    width: phone ? '100%' : `min(${maxW}px, 96vw)`, maxWidth: '100%',
    height: phone ? '100%' : 'auto', maxHeight: phone ? '100%' : '92vh',
    display: 'flex', flexDirection: 'column',
    boxShadow: '0 24px 64px rgba(0,0,0,0.5)', overflow: 'hidden',
    fontFamily: 'system-ui, sans-serif',
  } as const
}

/** The fixed backdrop a Full View renders into. `zIndex` is a parameter because
 *  one Full View can be opened from inside another and has to sit above it. */
export function backdropStyle(phone: boolean, zIndex: number): React.CSSProperties {
  return {
    position: 'fixed', inset: 0, zIndex,
    background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: phone ? 6 : 16,
  }
}

/** The dialog's header container: a wrapping flex row on desktop, or a `block`
 *  container on a phone so `SegmentHeader`/`NodeHeader`-style callers can lay
 *  out their own two explicit lines (title+× on top, actions below) instead of
 *  leaving it to flex-wrap, which is how the × ends up off the bottom edge. */
export function headerShell(t: T, phone: boolean) {
  return {
    display: phone ? 'block' : 'flex',
    alignItems: 'center',
    gap: 12,
    flexWrap: 'wrap',
    padding: phone ? '10px 12px' : '13px 16px',
    background: t.bgDeep,
    borderBottom: `1px solid ${t.border}`,
  } as const
}

/** Cards sit in `rowStyle` rows. `grow` lets a card take the slack in its row;
 *  a card without it is sized by its content (a fixed-aspect diagram, say,
 *  which looks wrong stretched). */
export function Card({ t, title, children, pad = 12, grow = false }: {
  t: T; title: string | null; children: React.ReactNode; pad?: number; grow?: boolean
}) {
  return (
    <div style={{
      background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 8, overflow: 'hidden',
      flex: grow ? '1 1 320px' : '0 0 auto', minWidth: 0,
    }}>
      {title && (
        <div style={{
          padding: '8px 12px', background: t.bgDeep, borderBottom: `1px solid ${t.border}`,
          fontSize: 10, fontWeight: 700, color: t.textFaint, textTransform: 'uppercase', letterSpacing: '0.06em',
        }}>{title}</div>
      )}
      <div style={{ padding: pad }}>{children}</div>
    </div>
  )
}

/** One labelled line: a fixed-width label beside (or, once stacked, above) its
 *  value. The building block `TextRow` and every edit field are made from. */
export function Row({ t, label, children }: { t: T; label: string; children: React.ReactNode }) {
  const { stackLabels } = useLayout()
  return (
    <div style={{
      display: 'flex', flexDirection: stackLabels ? 'column' : 'row',
      gap: stackLabels ? 1 : 8, padding: '3px 0', fontSize: 12,
    }}>
      <span style={fieldLabelStyle(t, stackLabels)}>{label}</span>
      {children}
    </div>
  )
}

/** A Row whose value is plain text — by far the most common case. */
export function TextRow({ t, label, value }: { t: T; label: string; value: React.ReactNode }) {
  return (
    <Row t={t} label={label}>
      <span style={{ color: t.text, wordBreak: 'break-word' }}>{value}</span>
    </Row>
  )
}

/** Small italic muted line for "there is nothing here" states inside a card
 *  (as opposed to `NotFound`, which is for a whole missing entity). */
export function Empty({ t, children }: { t: T; children: React.ReactNode }) {
  return <div style={{ fontSize: 12, color: t.textFaintest, fontStyle: 'italic' }}>{children}</div>
}

/** The "this field could not be resolved" / "nothing here" line inside a card. */
export function NotFound({ t, what, id }: { t: T; what: string; id: string }) {
  return (
    <div style={{ padding: 28, color: t.textMuted, fontSize: 13 }}>
      No {what} with id <strong style={{ color: t.text }}>{id}</strong> is loaded.
    </div>
  )
}

// ── Form controls ─────────────────────────────────────────────────────────

/** A labelled text input for a Full View edit form. `value`/`onChange` are
 *  always plain strings — even for numeric fields — so a half-typed value
 *  never collapses to NaN; the caller parses on save. */
export function EditField({ t, label, value, onChange, mono = false, type }: {
  t: T; label: string; value: string; onChange: (v: string) => void
  mono?: boolean
  /** Passed through to the input; 'number' also gets a decimal soft keyboard. */
  type?: 'text' | 'number'
}) {
  const { stackLabels } = useLayout()
  return (
    <label style={fieldStyle(stackLabels)}>
      <span style={fieldLabelStyle(t, stackLabels)}>{label}</span>
      <input
        value={value}
        // Held as text even for numbers: a half-typed "-" or "3." must survive
        // keystroke to keystroke rather than collapsing to NaN mid-edit. The
        // inputMode still summons the right keyboard on a phone.
        inputMode={type === 'number' ? 'decimal' : undefined}
        onChange={e => onChange(e.target.value)}
        style={{ ...inputStyle(t, stackLabels), fontFamily: mono ? 'ui-monospace, monospace' : 'inherit' }}
      />
    </label>
  )
}

/** A labelled `<select>` for a Full View edit form. `options` is a list of
 *  `[value, displayLabel]` pairs, rendered in the order given. */
export function SelectField({ t, label, value, options, onChange }: {
  t: T; label: string; value: string; options: [string, string][]; onChange: (v: string) => void
}) {
  const { stackLabels } = useLayout()
  return (
    <label style={fieldStyle(stackLabels)}>
      <span style={fieldLabelStyle(t, stackLabels)}>{label}</span>
      <select value={value} onChange={e => onChange(e.target.value)} style={inputStyle(t, stackLabels)}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  )
}

/** The read-only "this is the identifier" row every edit form opens with. */
export function ReadOnlyIdField({ t, label, id }: { t: T; label: string; id: string }) {
  return (
    <Row t={t} label={label}>
      <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, color: t.textMuted }}>
        {id} <span style={{ color: t.textFaintest }}>(not editable)</span>
      </span>
    </Row>
  )
}

/** Error line + Save/Cancel pair + the "this writes straight through" caveat —
 *  the identical footer both edit forms end with. */
export function EditFormFooter({ t, error, saving, onSave, onCancel }: {
  t: T; error: string | null; saving: boolean; onSave: () => void; onCancel: () => void
}) {
  return (
    <>
      {error && <div style={{ fontSize: 11, color: t.red, lineHeight: 1.5 }}>⚠ {error}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
        <button onClick={onSave} disabled={saving} style={saveBtnStyle(t, saving)}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        <button onClick={onCancel} disabled={saving} style={iconBtn(t)}>Cancel</button>
      </div>
      <div style={{ fontSize: 10, color: t.textFaintest, lineHeight: 1.5 }}>
        Saves immediately to the database — this is not staged like the Network Editor.
      </div>
    </>
  )
}

// ── Style helpers ─────────────────────────────────────────────────────────

/** Label beside the value on a laptop; above it once the 108px gutter would
 *  squeeze the value down to a word a line. */
export function fieldLabelStyle(t: T, stacked: boolean) {
  return {
    width: stacked ? 'auto' : 108, flexShrink: 0,
    color: t.textFaint, fontWeight: 600,
  } as const
}

/** Layout for one `EditField`/`SelectField` label+control pair: a row on
 *  desktop, a column (label above control) once labels are stacked. */
export function fieldStyle(stacked: boolean) {
  return {
    display: 'flex', flexDirection: stacked ? 'column' : 'row',
    alignItems: stacked ? 'stretch' : 'center',
    gap: stacked ? 2 : 8, fontSize: 12,
  } as const
}

export function inputStyle(t: T, stacked = false) {
  return {
    // Stacked, the label is a block above and `align-items: stretch` already
    // gives the control the full width — growing it would grow its HEIGHT.
    flex: stacked ? '0 0 auto' : 1, minWidth: 0,
    padding: stacked ? '8px 9px' : '5px 7px', borderRadius: 4,
    border: `1px solid ${t.border}`, background: t.bgInput, color: t.text,
    fontSize: stacked ? 14 : 12, fontFamily: 'inherit',
  } as const
}

/** The primary "Save changes" button used by `EditFormFooter`; greyed out and
 *  inert while `saving` is true rather than removed, so the layout doesn't jump. */
export function saveBtnStyle(t: T, saving: boolean) {
  return {
    flex: 1, padding: '8px 12px', borderRadius: 6, border: 'none',
    cursor: saving ? 'default' : 'pointer',
    background: saving ? t.textFaintest : t.green, color: '#0b1f14',
    fontSize: 12, fontWeight: 700, fontFamily: 'inherit',
  } as const
}

/** Small outlined button used for secondary actions (Back, Edit, Cancel,
 *  navigation links). `color` tints border/background/text together to signal
 *  emphasis (e.g. `t.blue` for "Edit", `t.red` for a destructive action); left
 *  undefined it renders as a neutral outline. */
export function iconBtn(t: T, color?: string) {
  return {
    padding: '6px 11px', borderRadius: 6, cursor: 'pointer',
    border: `1px solid ${color ?? t.border}`,
    background: color ? color + '18' : 'transparent',
    color: color ?? t.textMuted,
    fontSize: 12, fontWeight: 700, fontFamily: 'inherit', whiteSpace: 'nowrap',
  } as const
}

/** The × never wraps out of reach, and on a phone it carries a 40px target. */
export function closeBtnStyle(t: T, phone: boolean) {
  return {
    background: 'none', border: 'none', cursor: 'pointer', color: t.textMuted,
    lineHeight: 1, flexShrink: 0,
    fontSize: phone ? 26 : 22,
    padding: phone ? 0 : '0 2px',
    width: phone ? 40 : undefined,
    height: phone ? 40 : undefined,
    display: phone ? 'flex' : undefined,
    alignItems: 'center',
    justifyContent: 'center',
  } as const
}

/** A small uppercase pill — the RFS/EOL, ON-NET and medium badges. */
export function Pill({ color, children, title }: {
  color: string; children: React.ReactNode; title?: string
}) {
  return (
    <span title={title} style={{
      fontSize: 9, fontWeight: 800, letterSpacing: '0.06em', padding: '1px 5px', borderRadius: 3,
      textTransform: 'uppercase', color, background: color + '18',
      border: `1px solid ${color}66`, whiteSpace: 'nowrap',
    }}>{children}</span>
  )
}

/** Amber past 75% used, red past 90% — the shared utilisation-bar palette. */
export function utilisationColor(pct: number, t: T): string {
  if (pct >= 0.9) return t.red
  if (pct >= 0.75) return t.orange
  return t.green
}
