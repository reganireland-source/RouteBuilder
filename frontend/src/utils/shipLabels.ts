/**
 * Display text for ShipTracker AIS fields, shared by the Ship Full View and
 * the map's ship hover card.
 */

/** Display names for TrackedShipLive.source (ids from backend shiptracker/hub.py). */
export const SOURCE_LABEL: Record<string, string> = {
  aisstream: 'aisstream.io',
  marinesia: 'Marinesia',
  vesselapi: 'VesselAPI',
  myshiptracking: 'MyShipTracking',
}

/** AIS navigational status codes (ITU-R M.1371). */
export const NAV_STATUS_LABEL: Record<number, string> = {
  0: 'Under way using engine', 1: 'At anchor', 2: 'Not under command',
  3: 'Restricted manoeuvrability', 4: 'Constrained by draught', 5: 'Moored',
  6: 'Aground', 7: 'Engaged in fishing', 8: 'Under way sailing',
  15: 'Not defined',
}

export function navStatusLabel(code: number | null | undefined): string | null {
  if (code == null) return null
  return NAV_STATUS_LABEL[code] ?? `Code ${code}`
}
