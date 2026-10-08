/**
 * utils/outageImpact.ts — colour and labelling for SegmentOutage.service_impact.
 *
 * Three states an admin (or the AI Outage Parser) can classify a real outage
 * as, per the materiality the business actually cares about:
 *   - impacting          — customer traffic is down. Red, same as every
 *                           outage looked before this field existed.
 *   - partial_impacting  — degraded (e.g. one of several protected paths, or
 *                           reduced capacity), not a full outage. Orange.
 *   - non_impacting      — the fault is real but nothing customer-facing is
 *                           actually affected (e.g. spare/dark fibre, a
 *                           redundant leg with no traffic on it). Yellow.
 * `null`/`undefined` means "not yet classified" — every outage that predates
 * this field, and every AI-parsed row the model wasn't confident enough to
 * resolve on its own (see outage_parser.py's system prompt). Resolved to
 * `impacting` wherever it's DISPLAYED (resolveImpact/impactColor below), so
 * nothing already on the map changes colour the day this shipped; but the
 * distinction matters where the field is being EDITED (OutageParserModal's
 * review table, RefDataModal's outage form) — those places check for the
 * raw null themselves rather than calling resolveImpact, because a null
 * there means "an admin still needs to pick one," not "treat as impacting."
 *
 * Scope: real outages only (event_type === "outage"). Planned Events have no
 * service_impact — they're informational by nature and already get their
 * own, deliberately quieter amber treatment elsewhere.
 */
import type { Theme } from '../theme'
import type { ServiceImpact } from '../types'

/** Every valid ServiceImpact value, in worst-to-best order — see {@link worstImpact}. */
export const SERVICE_IMPACT_VALUES: ServiceImpact[] = ['impacting', 'partial_impacting', 'non_impacting']

/** Human-readable label for each ServiceImpact value, for badges/dropdowns/tooltips. */
export const SERVICE_IMPACT_LABEL: Record<ServiceImpact, string> = {
  impacting: 'Impacting',
  partial_impacting: 'Partial Impacting',
  non_impacting: 'Non-Impacting',
}

/** Narrows an arbitrary string (e.g. straight off an API response or an LLM's
 *  JSON) to a real ServiceImpact, or null if it isn't one — the single choke
 *  point every "is this a legit value" check in this file goes through. */
export function isServiceImpact(v: unknown): v is ServiceImpact {
  return typeof v === 'string' && (SERVICE_IMPACT_VALUES as string[]).includes(v)
}

/** The value to DISPLAY a possibly-unset service_impact as — null/undefined/
 *  anything unrecognised resolves to "impacting" (today's only behaviour,
 *  and the explicit choice for legacy data — see the file header). Never use
 *  this where the actual presence of a value matters (e.g. deciding whether
 *  an admin still needs to pick one); use isServiceImpact on the raw field
 *  for that instead. */
export function resolveImpact(raw: string | null | undefined): ServiceImpact {
  return isServiceImpact(raw) ? raw : 'impacting'
}

/** The theme colour a (possibly unset) service_impact should render as,
 *  everywhere outages are drawn: the outage map, the route-card badge, and
 *  the red/orange/yellow × marks over a selected outaged segment. */
export function impactColor(raw: string | null | undefined, t: Theme): string {
  const impact = resolveImpact(raw)
  if (impact === 'partial_impacting') return t.orange
  if (impact === 'non_impacting') return t.yellow
  return t.red
}

/** The single worst (most material) impact across several outages touching
 *  one route/node — e.g. RouteList's per-route OutageBadge, where a route
 *  can cross more than one outaged segment at once. Unset/unrecognised
 *  values count as "impacting" (the worst case), matching resolveImpact's
 *  own fallback — a route is never shown as LESS severe than it might be
 *  just because one of its outages hasn't been classified yet. */
export function worstImpact(raws: (string | null | undefined)[]): ServiceImpact {
  let worst: ServiceImpact = 'non_impacting'
  for (const raw of raws) {
    const impact = resolveImpact(raw)
    if (impact === 'impacting') return 'impacting'
    if (impact === 'partial_impacting') worst = 'partial_impacting'
  }
  return worst
}
