/**
 * ============================================================================
 *  ServiceDateSelector.tsx — the "Current vs Planned" network switch.
 * ============================================================================
 *
 * WHAT IT IS
 * One small control, sitting at the very top of the app above the mode tabs on
 * both desktop and phone, that answers a single question: WHICH NETWORK are we
 * looking at — the one that is live today, or the one that will exist at some
 * point in the future? Its answer is a `ServiceDateChoice` handed straight back
 * to the parent, which is what actually governs the map, route search, City
 * Pairs and Network Explorer. This file is the control and nothing else: it
 * owns no network state, filters nothing, and knows nothing about what a
 * service date means. All of that lives in utils/serviceDate.ts, which is the
 * only place quarters are derived, formatted or resolved to a date — this
 * component never does its own date maths.
 *
 * THE DEFAULT IS ALWAYS "CURRENT", AND IT IS NOT REMEMBERED
 * The parent holds the state in plain React state with no persistence, so a
 * reload always lands on today's live network. That is deliberate: a future
 * view that quietly survived a reload would be the easiest possible way for
 * someone to quote a cable that does not exist yet. Coming back to a fresh tab
 * should never be a lie, so "Current" is the only state the app can start in.
 *
 * WHY "PLANNED" IS CUMULATIVE, NOT "ONLY THE UNBUILT BITS"
 * Picking a quarter means "everything in service BY the end of that quarter" —
 * today's live cables PLUS whatever lands between now and then. It is NOT a
 * filter down to just the new builds. The question a user is actually asking
 * when they reach for this control is "what can I sell for delivery in Q2
 * 2027?", and the answer to that includes every cable that is already carrying
 * traffic today. A view of only the unbuilt systems would be a disconnected
 * scattering of fragments that no route could ever be found across, which is
 * useful to nobody. (The rule itself is implemented in serviceDate.ts and
 * mirrored in backend/app/rfs.py.)
 *
 * WHY THERE IS A "»" ROW AT THE BOTTOM OF THE PICKER
 * RFS dates more than a couple of years out are, to be blunt, aspirational.
 * A cable advertised for 2029-Q4 may slip by years, and offering the user a
 * date that far out would dress up a guess as a fact. So the picker offers the
 * next EIGHT quarters — roughly the horizon over which an RFS date is worth
 * filtering on — and then one final row, "»", meaning "include every planned
 * system, no date filter at all". It is honest in a way a distant date is not:
 * it says "here is everything anybody has announced" without pretending to know
 * when any of it arrives. It is styled as a visibly different KIND of answer
 * rather than a ninth quarter, because that is exactly what it is.
 *
 * WHY ORANGE, NEVER RED
 * Any future view is shown in the theme's orange — the app's caution colour —
 * on the control itself and in FutureNetworkBanner. Red is reserved everywhere
 * else in this app for "error" or "avoid this", and a planned network is
 * neither wrong nor dangerous; it just is not the live one. Orange says "pay
 * attention to what you are reading" without saying "something is broken".
 *
 * DESKTOP VS COMPACT
 *   • Normal: a two-segment control reading Current | Planned. "Current" is
 *     its own segment, so returning to today's network is one tap, and the
 *     popover holds only the quarters and the "»" row.
 *   • compact (the phone header, which already carries a logo, a search
 *     magnifier and a Controls button): a single icon-plus-label button, small
 *     enough to fit alongside those. Because there is no separate "Current"
 *     segment to tap in that form, the popover grows a leading "Current" row so
 *     the way back to the live network is still one tap. Both forms build their
 *     rows from the same option list, so the keyboard behaviour is identical.
 *
 * The popover is rendered in a portal and positioned as `fixed` against the
 * trigger's measured rect, clamped into the viewport. That is what keeps it on
 * screen at 390px, where the trigger sits close to the right-hand edge and an
 * ordinarily-positioned dropdown would hang off the side of the phone.
 *
 * Mounted from: App.tsx (desktop header) and MobileLayout.tsx (compact).
 * Backend endpoints: none.
 * ============================================================================
 */
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Theme } from '../theme'
import { useTheme } from '../theme'
import type { ServiceDateChoice } from '../utils/serviceDate'
import {
  CURRENT_CHOICE,
  describeChoice,
  formatQuarter,
  isFutureView,
  upcomingQuarters,
} from '../utils/serviceDate'

interface Props {
  value: ServiceDateChoice
  onChange: (next: ServiceDateChoice) => void
  /** Phone header: render tighter. */
  compact?: boolean
}

/** Kind drives the row's styling, not its behaviour — see buildOptions. */
type OptionKind = 'current' | 'quarter' | 'all'

interface PickerOption {
  key: string
  kind: OptionKind
  label: string
  sublabel: string
  choice: ServiceDateChoice
}

/** Where the floating panel is drawn, in viewport coordinates. */
interface PopoverBox {
  left: number
  top: number
  maxHeight: number
}

/** Popover width. Clamped against the viewport so 390px phones never clip it. */
const POPOVER_WIDTH = 236

/**
 * The rows the popover offers, in order.
 *
 * The eight quarters come straight from upcomingQuarters() and are labelled by
 * formatQuarter() — this file deliberately derives neither. The "Current" row
 * exists ONLY in compact mode, where the trigger is a single button and there
 * is therefore no "Current" segment to tap; in the normal two-segment form it
 * would be a second control for a state the user can already see and reach.
 */
function buildOptions(compact: boolean): PickerOption[] {
  const rows: PickerOption[] = compact
    ? [{
        key: 'current',
        kind: 'current',
        label: 'Current',
        sublabel: 'Today’s live network',
        choice: CURRENT_CHOICE,
      }]
    : []

  for (const q of upcomingQuarters()) {
    rows.push({
      key: q,
      kind: 'quarter',
      label: formatQuarter(q),
      sublabel: 'In service by end of quarter',
      choice: { mode: 'planned', quarter: q },
    })
  }

  rows.push({
    key: 'all',
    kind: 'all',
    label: 'All planned',
    sublabel: 'Every announced system, no date filter',
    choice: { mode: 'all' },
  })
  return rows
}

/** Does this row describe the choice currently in force? */
function isChosen(option: PickerOption, value: ServiceDateChoice): boolean {
  if (option.choice.mode !== value.mode) return false
  if (option.choice.mode === 'planned' && value.mode === 'planned') {
    return option.choice.quarter === value.quarter
  }
  return true
}

/** The row the keyboard should land on when the list opens: whatever is in
 *  force, or the first row when the current choice is not in the list. */
function indexOfChoice(options: PickerOption[], value: ServiceDateChoice): number {
  return Math.max(options.findIndex(o => isChosen(o, value)), 0)
}

/** Screen position for the popover, clamped so it cannot leave the viewport. */
function popoverBox(rect: DOMRect, width: number): PopoverBox {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const rightMost = Math.max(8, vw - width - 8)
  return {
    // Prefer left-aligned with the trigger; slide left only as far as needed.
    left: Math.max(8, Math.min(rect.left, rightMost)),
    top: rect.bottom + 6,
    // Never taller than the room actually below the trigger: the list scrolls
    // instead of running off the bottom of a short phone screen.
    maxHeight: Math.max(160, vh - rect.bottom - 16),
  }
}

// ── Hooks: the listener plumbing, kept out of the component ─────────────────
// Each owns exactly one window/document listener and removes it again when the
// popover closes or the control unmounts, so nothing outlives the panel.

/**
 * Keep the popover pinned under the trigger for as long as it is open.
 *
 * It is portalled and positioned in viewport coordinates, so anything that
 * moves the trigger — a rotate, a phone address-bar collapse, a scroll of
 * whatever panel it sits in — would otherwise leave the two apart. Scroll is
 * listened for in the capture phase because the scroller is usually an inner
 * panel rather than the window itself. The first measurement is a LAYOUT
 * effect so the panel never paints in the wrong place and then visibly jumps.
 */
function usePopoverPlacement(
  open: boolean,
  width: number,
  triggerRef: React.RefObject<HTMLElement | null>,
  setBox: (b: PopoverBox) => void,
) {
  useLayoutEffect(() => {
    if (!open) return
    const rect = triggerRef.current?.getBoundingClientRect()
    if (rect) setBox(popoverBox(rect, width))
  }, [open, width, triggerRef, setBox])

  useEffect(() => {
    if (!open) return
    function place() {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (rect) setBox(popoverBox(rect, width))
    }
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, width, triggerRef, setBox])
}

/**
 * Close when a mousedown lands outside both the trigger and the panel. The
 * popover is portalled, so "outside" has to be tested against BOTH — testing
 * only the trigger's subtree would close the list on its own options.
 *
 * `close` is a fresh closure on each render, so the listener is re-bound each
 * time the control renders while open. That is a couple of addEventListener
 * calls on a control the user is actively operating, and it is worth paying to
 * never hold a stale closure.
 */
function useDismissOnOutside(
  open: boolean,
  triggerRef: React.RefObject<HTMLElement | null>,
  popoverRef: React.RefObject<HTMLElement | null>,
  close: () => void,
) {
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      const target = e.target as Node
      if (triggerRef.current?.contains(target)) return
      if (popoverRef.current?.contains(target)) return
      close()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open, triggerRef, popoverRef, close])
}

/** Escape closes from anywhere, not only while the trigger holds focus — a
 *  popover you cannot dismiss because focus wandered is a trap. */
function useEscapeToClose(open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, close])
}

// ── The popover and its rows ────────────────────────────────────────────────

/** Row accent: green for "live now", orange for anything in the future. */
function accentFor(kind: OptionKind, t: Theme): string {
  return kind === 'current' ? t.green : t.orange
}

/** Row fill: the keyboard/hover row wins, then the visually-set-apart rows
 *  (Current and the "»" all-row), then nothing. */
function rowBackground(active: boolean, special: boolean, t: Theme): string {
  if (active) return t.bgDeep
  return special ? t.bgCard : 'transparent'
}

/** The leading glyph for a row. The "»" is the whole point of the all-row. */
function rowGlyph(kind: OptionKind): string {
  if (kind === 'current') return '●'
  if (kind === 'all') return '»'
  return '🗓'
}

interface RowProps {
  option: PickerOption
  id: string
  active: boolean
  selected: boolean
  onPick: () => void
  onHover: () => void
}

/**
 * One popover row. Split out so the selector itself stays well inside the
 * repo's cognitive-complexity cap, and so the three kinds of row are styled
 * from one place.
 *
 * The two non-quarter rows ("Current" at the top in compact mode, "»" at the
 * bottom always) are different KINDS of answer, so they get a divider, a
 * recessed fill, a heavier label and their own glyph. Nothing about them
 * should read as one more quarter in the list.
 */
function OptionRow({ option, id, active, selected, onPick, onHover }: RowProps) {
  const t = useTheme()
  const special = option.kind !== 'quarter'
  const accent = accentFor(option.kind, t)

  return (
    <div
      id={id}
      role="option"
      aria-selected={selected}
      // mousedown rather than click: the trigger's blur would otherwise pull
      // the popover down before a click ever landed, exactly as in AssetSearch.
      onMouseDown={e => { e.preventDefault(); onPick() }}
      onMouseEnter={onHover}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '7px 10px', cursor: 'pointer',
        background: rowBackground(active, special, t),
        borderTop: option.kind === 'all' ? `1px solid ${t.border}` : 'none',
        borderBottom: option.kind === 'current' ? `1px solid ${t.border}` : 'none',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          flexShrink: 0, width: 20, textAlign: 'center',
          // The "»" is set larger than the quarters' calendar glyph, so the
          // "everything, no date" row is spotted without being read.
          fontSize: option.kind === 'all' ? 16 : 11,
          fontWeight: 800, lineHeight: 1,
          color: accent,
        }}
      >
        {rowGlyph(option.kind)}
      </span>
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{
          display: 'block', fontSize: 13, color: t.text,
          fontWeight: special ? 700 : 600,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {option.label}
        </span>
        <span style={{
          display: 'block', fontSize: 10, color: t.textFaint, marginTop: 1,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {option.sublabel}
        </span>
      </span>
      {selected && (
        <span aria-hidden="true" style={{ flexShrink: 0, fontSize: 12, color: accent }}>✓</span>
      )}
    </div>
  )
}

interface PopoverProps {
  popoverRef: React.Ref<HTMLDivElement>
  listId: string
  box: PopoverBox
  width: number
  options: PickerOption[]
  activeIdx: number
  value: ServiceDateChoice
  optionId: (i: number) => string
  onPick: (o: PickerOption) => void
  onHover: (i: number) => void
}

/**
 * The floating option list. Its own component so ServiceDateSelector's body
 * stays orchestration — open/closed, keyboard, which trigger form to draw —
 * rather than also being the list's markup.
 */
function PickerPopover({
  popoverRef, listId, box, width, options, activeIdx, value, optionId, onPick, onHover,
}: PopoverProps) {
  const t = useTheme()
  return (
    <div
      ref={popoverRef}
      id={listId}
      role="listbox"
      aria-label="Network service date"
      style={{
        position: 'fixed', left: box.left, top: box.top, width, zIndex: 1400,
        background: t.bgPanel, border: `1px solid ${t.border}`, borderRadius: 6,
        maxHeight: box.maxHeight, overflowY: 'auto',
        boxShadow: '0 8px 28px rgba(0,0,0,0.35)',
      }}
    >
      {options.map((option, i) => (
        <OptionRow
          key={option.key}
          option={option}
          id={optionId(i)}
          active={i === activeIdx}
          selected={isChosen(option, value)}
          onPick={() => onPick(option)}
          onHover={() => onHover(i)}
        />
      ))}
    </div>
  )
}

// ── Keyboard ────────────────────────────────────────────────────────────────

interface KeyContext {
  open: boolean
  options: PickerOption[]
  activeIdx: number
  setActiveIdx: React.Dispatch<React.SetStateAction<number>>
  closeList: () => void
  openList: () => void
  pick: (o: PickerOption) => void
}

/**
 * The whole keyboard contract for an open list, as a key→action table rather
 * than an if/else chain: each key does exactly one thing, and reading the table
 * tells you the lot.
 *
 * Escape is deliberately NOT here — it is handled by a document listener
 * (useEscapeToClose) so it still closes the popover if focus has wandered.
 */
function openListActions(ctx: KeyContext): Record<string, () => void> {
  const { options, activeIdx, setActiveIdx, pick } = ctx
  return {
    ArrowDown: () => setActiveIdx(i => Math.min(i + 1, options.length - 1)),
    ArrowUp:   () => setActiveIdx(i => Math.max(i - 1, 0)),
    Home:      () => setActiveIdx(0),
    End:       () => setActiveIdx(options.length - 1),
    Enter:     () => pick(options[activeIdx] ?? options[0]),
  }
}

/**
 * Keydown on the trigger, whether or not the list is showing. Lives at module
 * scope, outside the component, so the component's own body stays small enough
 * for the repo's cognitive-complexity cap.
 */
function handleTriggerKey(e: React.KeyboardEvent, ctx: KeyContext) {
  if (!ctx.open) {
    // Closed: only the arrows open the list. Enter and Space are left alone so
    // the button's own click handler does the toggling rather than both firing.
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      ctx.openList()
    }
    return
  }
  // Tab closes the list and then moves focus as normal, so it is not prevented.
  if (e.key === 'Tab') { ctx.closeList(); return }
  const action = openListActions(ctx)[e.key]
  if (!action) return
  e.preventDefault()
  action()
}

// ── The two trigger forms ───────────────────────────────────────────────────

interface TriggerProps {
  value: ServiceDateChoice
  future: boolean
  open: boolean
  listId: string
  activeDescendant: string
  triggerRef: React.Ref<HTMLButtonElement>
  onToggle: () => void
  onKeyDown: (e: React.KeyboardEvent) => void
}

/**
 * Phone-header form: one icon-plus-label button, narrow enough to sit in a
 * header that is already carrying a logo, a search magnifier and a Controls
 * button at 390px. Its label is the answer itself ("Current", "Q2 2027",
 * "All planned") rather than the word "Planned", because in this form it is
 * the only thing on screen naming which network is showing.
 */
function CompactTrigger({
  value, future, open, listId, activeDescendant, triggerRef, onToggle, onKeyDown,
}: TriggerProps) {
  const t = useTheme()
  return (
    <button
      ref={triggerRef}
      type="button"
      onClick={onToggle}
      onKeyDown={onKeyDown}
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-controls={listId}
      aria-activedescendant={activeDescendant}
      aria-label={`Network service date: ${describeChoice(value)}`}
      style={{
        display: 'flex', alignItems: 'center', gap: 4,
        height: 30, padding: '0 7px', border: 'none', cursor: 'pointer',
        background: future ? t.orange + '22' : 'transparent',
        color: future ? t.orange : t.textMuted,
        fontSize: 11, fontWeight: 700, lineHeight: 1, maxWidth: 124,
      }}
    >
      <span aria-hidden="true" style={{ fontSize: 12 }}>🗓</span>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {describeChoice(value)}
      </span>
      <span aria-hidden="true" style={{ fontSize: 8, opacity: 0.8 }}>▾</span>
    </button>
  )
}

/**
 * Desktop form: two segments, Current | Planned. "Current" is its own segment,
 * so returning to the live network is always one tap and never needs the list
 * opened. The Planned segment is the popover trigger, and reads as the active
 * choice ("Q2 2027" / "All planned") in orange whenever a future network is in
 * force — the control has to be readable as an answer, not just as a menu.
 */
function SegmentedTrigger({
  value, future, open, listId, activeDescendant, triggerRef, onToggle, onKeyDown, onCurrent,
}: TriggerProps & { onCurrent: () => void }) {
  const t = useTheme()
  return (
    <>
      <button
        type="button"
        onClick={onCurrent}
        aria-pressed={!future}
        title="Today’s live network"
        style={{
          height: 26, padding: '0 10px', border: 'none', cursor: 'pointer',
          background: future ? 'transparent' : t.bgActiveSort,
          color: future ? t.textFaint : t.text,
          fontSize: 11, fontWeight: 700, lineHeight: 1,
        }}
      >
        Current
      </button>
      <span
        aria-hidden="true"
        style={{ width: 1, alignSelf: 'stretch', background: t.border, flexShrink: 0 }}
      />
      <button
        ref={triggerRef}
        type="button"
        onClick={onToggle}
        onKeyDown={onKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={activeDescendant}
        title="Show the network as it will be at a future quarter"
        style={{
          display: 'flex', alignItems: 'center', gap: 5,
          height: 26, padding: '0 10px', border: 'none', cursor: 'pointer',
          background: future ? t.orange + '22' : 'transparent',
          color: future ? t.orange : t.textMuted,
          fontSize: 11, fontWeight: 700, lineHeight: 1, maxWidth: 170,
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {future ? describeChoice(value) : 'Planned'}
        </span>
        <span aria-hidden="true" style={{ fontSize: 8, opacity: 0.8 }}>▾</span>
      </button>
    </>
  )
}

// ── The control itself ──────────────────────────────────────────────────────

/**
 * The Current/Planned control.
 *
 * It owns only whether the popover is open and which row the keyboard is on;
 * the choice itself belongs to the parent, which is what lets one selector
 * govern the map, the route request and every viewer at once.
 */
export function ServiceDateSelector({ value, onChange, compact = false }: Props) {
  const t = useTheme()
  const [open, setOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(0)
  const [box, setBox] = useState<PopoverBox>({ left: 0, top: 0, maxHeight: 320 })

  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  const uid = useId()
  const listId = `service-date-list-${uid}`
  const optionId = (i: number) => `service-date-opt-${uid}-${i}`

  // Rebuilt every render on purpose: the list is ten short rows, and memoising
  // it would mean caching "which quarters come next", which goes stale at a
  // quarter boundary in a long-lived tab.
  const options = buildOptions(compact)
  const future = isFutureView(value)
  // 374 = a 390px phone less the 8px gutter the clamp keeps on each side.
  const width = compact ? Math.min(POPOVER_WIDTH, 374) : POPOVER_WIDTH

  function closeList() { setOpen(false) }

  /** Open with the keyboard already sitting on whatever is in force. */
  function openList() {
    setActiveIdx(indexOfChoice(options, value))
    setOpen(true)
  }

  function pick(option: PickerOption) {
    onChange(option.choice)
    setOpen(false)
    // Focus goes back where it came from, so a keyboard user is not dumped at
    // the top of the document by a panel that has just vanished.
    triggerRef.current?.focus()
  }

  usePopoverPlacement(open, width, triggerRef, setBox)
  useDismissOnOutside(open, triggerRef, popoverRef, closeList)
  useEscapeToClose(open, () => { setOpen(false); triggerRef.current?.focus() })

  const keyCtx: KeyContext = { open, options, activeIdx, setActiveIdx, closeList, openList, pick }

  const triggerProps: TriggerProps = {
    value, future, open, listId,
    // aria-activedescendant and aria-controls only mean anything while the
    // list exists; '' leaves the attribute empty rather than pointing at an
    // element that is not in the document.
    activeDescendant: open ? optionId(activeIdx) : '',
    triggerRef,
    // Setting the highlight on the way out as well as the way in costs nothing
    // and keeps this a single expression.
    onToggle: () => { setActiveIdx(indexOfChoice(options, value)); setOpen(o => !o) },
    onKeyDown: e => handleTriggerKey(e, keyCtx),
  }

  const shell: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', flexShrink: 0,
    border: `1px solid ${future ? t.orange + '88' : t.border}`,
    borderRadius: 5, overflow: 'hidden',
    background: t.bgInput,
  }

  return (
    <div style={shell}>
      {compact
        ? <CompactTrigger {...triggerProps} />
        : <SegmentedTrigger {...triggerProps} onCurrent={() => { setOpen(false); onChange(CURRENT_CHOICE) }} />}
      {open && createPortal(
        <PickerPopover
          popoverRef={popoverRef} listId={listId} box={box} width={width}
          options={options} activeIdx={activeIdx} value={value}
          optionId={optionId} onPick={pick} onHover={setActiveIdx}
        />,
        document.body,
      )}
    </div>
  )
}
