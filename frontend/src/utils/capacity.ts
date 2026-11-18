/**
 * Capacity split for one segment: Total = Free + Reserved + Used (all Tbps).
 *
 * Free (available_capacity_t) is what routing and "can I sell this" views
 * use; Reserved is held back but not carrying traffic; Used is derived. Every
 * cable view goes through capacityParts() so the arithmetic, and the handling
 * of records saved before Reserved existed (no field → 0), live in one place.
 */
import type { SegmentCapacity } from '../types'

export interface CapacityParts {
  total: number
  free: number
  reserved: number
  used: number
  /** Share of Total, 0–1 each. */
  freePct: number
  reservedPct: number
  usedPct: number
  /** Used + Reserved as a share of Total — how much is spoken for. */
  committedPct: number
}

export function capacityParts(cap: SegmentCapacity): CapacityParts {
  const total = Math.max(0, cap.total_capacity_t)
  const free = Math.max(0, cap.available_capacity_t)
  const reserved = Math.max(0, cap.reserved_capacity_t ?? 0)
  const used = Math.max(0, total - free - reserved)
  const pct = (v: number) => (total > 0 ? v / total : 0)
  return {
    total, free, reserved, used,
    freePct: pct(free), reservedPct: pct(reserved), usedPct: pct(used),
    committedPct: pct(used + reserved),
  }
}

/** "12.5 T" — capacity figures as shown everywhere in the UI. */
export function formatTbps(v: number): string {
  return `${Math.round(v * 100) / 100} T`
}

/** User-facing reason a Total / Free / Reserved split is impossible, or null.
 *  Mirrors the backend's capacity_split_error (with the same float slack). */
export function capacitySplitError(total: number, free: number, reserved: number): string | null {
  if ([total, free, reserved].some(v => !Number.isFinite(v) || v < 0)) return 'Capacity figures must be zero or more.'
  if (free + reserved > total + 1e-9) return `Free (${free} T) + Reserved (${reserved} T) cannot exceed Total (${total} T).`
  return null
}
