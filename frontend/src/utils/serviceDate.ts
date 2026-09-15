/**
 * utils/serviceDate.ts — "what is in service on a given date", client side.
 *
 * The browser mirror of backend/app/rfs.py. The backend already filters the
 * ROUTE GRAPH by a service date, but the map, City Pairs and Network Explorer
 * all draw straight from the reference data the client holds, so they need the
 * same answer locally. Keeping the rules in one small pure module means the two
 * implementations can be read side by side and checked against each other —
 * the failure mode to avoid is the map showing a cable the router refuses to
 * use, or the reverse.
 *
 * There are TWO constraints, and a segment must pass both to be usable:
 * RFS (is it built yet?) and EOL (has it been retired?). They are deliberate
 * mirrors of each other — see the EOL block below.
 *
 * THE RULES (identical to backend/app/rfs.py — change both together)
 *   • A segment is unavailable when its effective RFS date is AFTER the
 *     requested service date.
 *   • Effective date = the LATER of the segment's own RFS and its owning
 *     system's. A segment cannot be in service before the cable it belongs to,
 *     so the system acts as a floor.
 *   • `rfs_status: 'in_service'` contributes no constraint whatever its
 *     quarter says — it is already live.
 *   • "YYYY-Qn" resolves to the LAST day of that quarter. RFS promises service
 *     *by the end of* a quarter, so resolving earlier would over-promise.
 *   • A row that is not in service and whose quarter is missing or malformed is
 *     treated as NEVER in service. An unparseable RFS is a data problem, and
 *     showing a cable whose build date nobody knows is worse than showing one
 *     fewer.
 *   • A null service date means NO filtering at all — everything is shown.
 *     This is what the selector's "»" (all systems) option sends, on the basis
 *     that dates years out are not reliable enough to filter on.
 */
import type { CableSegment, CableSystem } from '../types'

/** Sorts before every real date — "already live". */
const ALREADY_IN_SERVICE = '0000-01-01'
/** Sorts after every real date — "never, as far as we know". */
const NEVER_IN_SERVICE = '9999-12-31'

const QUARTER_PATTERN = /^(\d{4})-Q([1-4])$/

/** Last day of the quarter, as an ISO date; null when unparseable. */
export function quarterEndDate(quarter: string | null | undefined): string | null {
  if (!quarter) return null
  const m = QUARTER_PATTERN.exec(quarter.trim())
  if (!m) return null
  const year = m[1]
  // Q1→31 Mar, Q2→30 Jun, Q3→30 Sep, Q4→31 Dec.
  const ends = ['03-31', '06-30', '09-30', '12-31']
  return `${year}-${ends[Number(m[2]) - 1]}`
}

/** One row's RFS date as a comparable ISO string. */
function rfsDate(status: string | null | undefined, quarter: string | null | undefined): string {
  if (status !== 'planned') return ALREADY_IN_SERVICE
  return quarterEndDate(quarter) ?? NEVER_IN_SERVICE
}

/**
 * The later of a segment's own RFS date and its owning system's — a segment
 * cannot be live before its cable.
 */
export function effectiveRfsDate(segment: CableSegment, system?: CableSystem): string {
  const segDate = rfsDate(segment.rfs_status, segment.rfs_quarter)
  if (!system) return segDate
  const sysDate = rfsDate(system.rfs_status, system.rfs_quarter)
  return segDate > sysDate ? segDate : sysDate
}

/** Is this segment in service on `serviceDate`? A null date means "no filter". */
export function isSegmentInServiceOn(
  segment: CableSegment,
  system: CableSystem | undefined,
  serviceDate: string | null,
): boolean {
  if (!serviceDate) return true
  return effectiveRfsDate(segment, system) <= serviceDate
}

/**
 * Filter a segment list to what is in service on a date. Returns the original
 * array when there is no date, so callers can use this unconditionally without
 * paying for a copy in the common "today's network" case.
 */
export function filterSegmentsInService(
  segments: CableSegment[],
  systemsById: Record<string, CableSystem>,
  serviceDate: string | null,
): CableSegment[] {
  if (!serviceDate) return segments
  // Both halves: not-yet-built and already-retired are equally unusable.
  return segments.filter(s => isSegmentUsableOn(s, systemsById[s.system_id], serviceDate))
}

// ── End of Life — the mirror of RFS ─────────────────────────────────────────
//
// RFS excludes cables that do not exist YET. EOL excludes cables that will be
// GONE by the date you are asking about. Every rule is the reverse:
//
//   • unusable when the effective EOL date is BEFORE the service date
//     (RFS: unusable when the effective RFS date is AFTER it)
//   • effective EOL is the EARLIER of the segment's own and its system's — a
//     segment cannot outlive the cable it belongs to, so the system is a
//     CEILING here where for RFS it is a floor
//   • a quarter still resolves to its LAST day: a cable retiring in 2027-Q2 is
//     usable through 30 June and gone from 1 July
//   • 'active' contributes no constraint — it never retires
//   • an 'eol' row with a missing or malformed quarter is treated as ALREADY
//     RETIRED, mirroring RFS's "planned with an unparseable quarter is never in
//     service". In both directions the rule is the same: if we cannot tell when
//     a cable is usable, we do not offer it.

/** Sorts after every real date — "never retires". */
const NEVER_RETIRES = '9999-12-31'
/** Sorts before every real date — "already gone". */
const ALREADY_RETIRED = '0000-01-01'

/** One row's EOL date as a comparable ISO string. */
function eolDate(status: string | null | undefined, quarter: string | null | undefined): string {
  if (status !== 'eol') return NEVER_RETIRES
  return quarterEndDate(quarter) ?? ALREADY_RETIRED
}

/**
 * The EARLIER of a segment's own EOL and its owning system's — a segment dies
 * with its cable, whichever goes first.
 */
export function effectiveEolDate(segment: CableSegment, system?: CableSystem): string {
  const segDate = eolDate(segment.eol_status, segment.eol_quarter)
  if (!system) return segDate
  const sysDate = eolDate(system.eol_status, system.eol_quarter)
  return segDate < sysDate ? segDate : sysDate
}

/** Has this segment been retired by `serviceDate`? Null date means "no filter". */
export function isSegmentRetiredOn(
  segment: CableSegment,
  system: CableSystem | undefined,
  serviceDate: string | null,
): boolean {
  if (!serviceDate) return false
  return effectiveEolDate(segment, system) < serviceDate
}

/**
 * The single usability test: built by this date AND not yet retired. Every
 * surface should ask this rather than either half on its own.
 */
export function isSegmentUsableOn(
  segment: CableSegment,
  system: CableSystem | undefined,
  serviceDate: string | null,
): boolean {
  return isSegmentInServiceOn(segment, system, serviceDate)
    && !isSegmentRetiredOn(segment, system, serviceDate)
}

// ── Quarter helpers for the selector ────────────────────────────────────────

/** Today as an ISO date. Isolated so tests can reason about it. */
export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10)
}

/** The calendar quarter a date falls in, as "YYYY-Qn". */
export function quarterOf(d: Date = new Date()): string {
  return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`
}

/**
 * The next `count` quarters AFTER the one we are currently in — the choices
 * the Planned picker offers. The current quarter is deliberately excluded:
 * that is what "Current" already means, so offering it again would be two
 * controls for one state.
 */
export function upcomingQuarters(count = 8, now: Date = new Date()): string[] {
  // Count quarters since year 0 so the wrap into the next year is arithmetic
  // rather than a branch — the branching version tripped the linter and was
  // harder to read besides.
  const startIndex = now.getUTCFullYear() * 4 + Math.floor(now.getUTCMonth() / 3)
  const out: string[] = []
  for (let i = 1; i <= count; i++) {
    const idx = startIndex + i
    out.push(`${Math.floor(idx / 4)}-Q${(idx % 4) + 1}`)
  }
  return out
}

/** "2027-Q2" → "Q2 2027", for display. */
export function formatQuarter(quarter: string): string {
  const m = QUARTER_PATTERN.exec(quarter)
  return m ? `Q${m[2]} ${m[1]}` : quarter
}

// ── The selector's state ────────────────────────────────────────────────────

/**
 * What the Current/Planned selector is set to.
 *   current — today's network. The default, and what a reload returns to.
 *   planned — everything in service by the END of the chosen quarter. This is
 *             CUMULATIVE: today's live cables plus whatever lands by then, not
 *             "only the unbuilt ones" — the question being asked is "what can I
 *             sell for delivery in that quarter?".
 *   all     — no date filter at all. Offered because RFS dates more than a
 *             couple of years out are not reliable enough to filter on, so
 *             "show me everything planned" is more honest than a date.
 */
export type ServiceDateChoice =
  | { mode: 'current' }
  | { mode: 'planned'; quarter: string }
  | { mode: 'all' }

export const CURRENT_CHOICE: ServiceDateChoice = { mode: 'current' }

/**
 * Resolve a choice to the ISO date the rest of the app filters on, or null for
 * "no filtering". This is the single place the three modes become one value,
 * so the map, the route request and every viewer cannot disagree.
 */
export function resolveServiceDate(choice: ServiceDateChoice, now: Date = new Date()): string | null {
  if (choice.mode === 'all') return null
  if (choice.mode === 'current') return todayIso(now)
  return quarterEndDate(choice.quarter) ?? todayIso(now)
}

/** Short label for the selector and the banner. */
export function describeChoice(choice: ServiceDateChoice): string {
  if (choice.mode === 'current') return 'Current'
  if (choice.mode === 'all') return 'All planned'
  return formatQuarter(choice.quarter)
}

/** True when the user is looking at anything other than today's network. */
export function isFutureView(choice: ServiceDateChoice): boolean {
  return choice.mode !== 'current'
}
