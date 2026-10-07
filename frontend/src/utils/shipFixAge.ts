import type { TrackedShipLive } from '../types'

/** A fix older than this is "last known", not live: aisstream.io's free feed
 *  is shore-receiver only, so a ship can go unheard for hours. */
export const SHIP_FIX_STALE_MS = 2 * 60 * 60 * 1000

export interface FixAge {
  /** "just now", "12m ago", "6h ago", "3d ago" */
  label: string
  stale: boolean
}

/** How old a ship's position is, or null if it has none / an unparseable time. */
export function shipFixAge(live: TrackedShipLive | null | undefined, now = Date.now()): FixAge | null {
  if (!live?.last_seen_utc) return null
  const at = Date.parse(live.last_seen_utc)
  if (Number.isNaN(at)) return null
  const ms = Math.max(0, now - at)
  const mins = Math.floor(ms / 60_000)
  let label: string
  if (mins < 1) label = 'just now'
  else if (mins < 60) label = `${mins}m ago`
  else if (mins < 48 * 60) label = `${Math.floor(mins / 60)}h ago`
  else label = `${Math.floor(mins / 1440)}d ago`
  return { label, stale: ms > SHIP_FIX_STALE_MS }
}
