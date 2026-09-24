/**
 * ============================================================================
 *  FutureNetworkBanner.tsx — "you are not looking at the live network" strip.
 * ============================================================================
 *
 * WHAT IT IS
 * A slim, permanently-visible bar that appears the moment ServiceDateSelector
 * is set to anything other than Current, and disappears the moment it goes
 * back. It says, in plain words, which network is on screen — "Viewing network
 * as at Q2 2027" — and carries a one-tap "Back to Current" that returns the
 * whole app to today.
 *
 * WHY IT EXISTS AT ALL
 * The selector at the top of the app is small, and a future view otherwise
 * looks EXACTLY like the live one: same map, same route results, same City
 * Pairs table, just with more cable on it. The failure mode this component
 * exists to prevent is somebody glancing at the screen, seeing a path across a
 * system that will not carry traffic for another two years, and quoting it to a
 * customer as though it were available today. A small control that was set
 * minutes ago is not enough to stop that; a strip across the top that cannot be
 * missed, cannot be dismissed, and names the quarter, is. It is an honesty
 * device, not decoration — which is also why there is no close button on it:
 * the only way to get rid of it is to actually go back to the live network,
 * which is precisely the action it is nudging towards.
 *
 * WHY IT RENDERS NOTHING IN THE DEFAULT STATE
 * isFutureView(value) is checked first and the component returns null when it
 * is false, so in the overwhelmingly common "Current" case this costs one
 * function call and produces no DOM, no layout and no paint. The default state
 * of the app must not pay for a warning it does not need.
 *
 * WHY ORANGE
 * Orange is the app's caution colour, and this is the same signal the selector
 * itself shows when a future choice is active, so the two read as one thing.
 * Red is deliberately not used: everywhere else in this app red means "error"
 * or "avoid this segment", and a planned network is neither broken nor to be
 * avoided — it just is not today's. The wash is painted over an opaque panel
 * colour rather than being left translucent, because the parent floats this
 * over the map and text over moving tiles is unreadable.
 *
 * LAYOUT IS THE PARENT'S JOB
 * This renders a width:100% block and positions nothing. App.tsx / MobileLayout
 * decide where it sits (over the map, under the header) and own the z-index and
 * any absolute positioning, because the two layouts put it in different places.
 * Taking a position here would fight whichever one it did not suit.
 *
 * PROPS
 *   • value   — the current ServiceDateChoice. Anything but 'current' shows it.
 *   • onReset — called by "Back to Current"; the parent sets the choice back.
 *
 * Mounted from: App.tsx and MobileLayout.tsx.
 * Backend endpoints: none.
 * ============================================================================
 */
import { useTheme } from '../theme'
import type { ServiceDateChoice } from '../utils/serviceDate'
import { describeChoice, isFutureView } from '../utils/serviceDate'

interface Props {
  value: ServiceDateChoice
  onReset: () => void
}

/**
 * The sentence the strip reads. "All planned" is not a date, so wording it as
 * "as at All planned" would be nonsense — it gets its own phrasing, and says
 * out loud that no date filter is being applied, since that is the one mode
 * where what is on screen may never all exist at the same moment.
 */
function bannerText(value: ServiceDateChoice): string {
  if (value.mode === 'all') return 'Viewing all planned systems — no service date filter'
  return `Viewing network as at ${describeChoice(value)}`
}

/**
 * The future-network warning strip. Renders null on the live network, which is
 * the default and the common case.
 */
export function FutureNetworkBanner({ value, onReset }: Props) {
  const t = useTheme()

  // First and cheapest: on today's network this component costs nothing.
  if (!isFutureView(value)) return null

  return (
    <div
      role="status"
      style={{
        // width only — the parent owns where this sits. See the header.
        width: '100%', boxSizing: 'border-box',
        // Opaque panel underneath, orange wash on top: legible over map tiles
        // in all three themes without hard-coding a colour.
        background: t.bgPanel,
        backgroundImage: `linear-gradient(${t.orange}22, ${t.orange}22)`,
        borderBottom: `1px solid ${t.orange}99`,
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '5px 10px',
      }}
    >
      <span aria-hidden="true" style={{ flexShrink: 0, fontSize: 12, lineHeight: 1 }}>⚠</span>
      <span style={{
        flex: 1, minWidth: 0,
        fontSize: 11, fontWeight: 700, color: t.orange,
        letterSpacing: '0.01em',
        // One line on a 390px phone: the quarter is the part that must survive,
        // and it sits at the end of the sentence, so clip the middle-free way —
        // ellipsis on overflow rather than wrapping the strip to two rows.
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {bannerText(value)}
      </span>
      <button
        type="button"
        onClick={onReset}
        style={{
          flexShrink: 0, cursor: 'pointer',
          padding: '3px 8px', borderRadius: 4,
          border: `1px solid ${t.orange}`,
          background: 'transparent', color: t.orange,
          fontSize: 10, fontWeight: 800, lineHeight: 1.4,
          whiteSpace: 'nowrap',
        }}
      >
        Back to Current
      </button>
    </div>
  )
}
