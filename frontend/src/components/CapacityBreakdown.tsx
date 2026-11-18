/**
 * CapacityBreakdown — a segment's capacity as one stacked bar (Used, Reserved,
 * Free) with a legend of the figures and Total. Used wherever a single cable's
 * capacity is shown in full (Segment Full View, the segment info panel);
 * compact list rows use capacityParts() directly.
 */
import type { SegmentCapacity } from '../types'
import { capacityParts, formatTbps } from '../utils/capacity'
import { useTheme } from '../theme'

type T = ReturnType<typeof useTheme>

export function capacityColors(t: T) {
  return { used: t.blue, reserved: t.orange, free: t.green }
}

/** Reserved is hatched so it reads as "spoken for, not carrying traffic"
 *  even for someone who can't tell orange from the other colours. */
function hatch(color: string): string {
  return `repeating-linear-gradient(135deg, ${color} 0 4px, ${color}99 4px 7px)`
}

export function CapacityBar({ cap, height = 8 }: { cap: SegmentCapacity; height?: number }) {
  const t = useTheme()
  const p = capacityParts(cap)
  const c = capacityColors(t)
  if (p.total <= 0) return null
  const seg = (pct: number, background: string, label: string) => pct > 0 && (
    <div title={label} style={{ width: `${pct * 100}%`, height: '100%', background }} />
  )
  return (
    <div
      role="img"
      aria-label={`Used ${formatTbps(p.used)}, reserved ${formatTbps(p.reserved)}, free ${formatTbps(p.free)} of ${formatTbps(p.total)}`}
      style={{ display: 'flex', height, borderRadius: height / 2, overflow: 'hidden', background: t.bgDeep }}
    >
      {seg(p.usedPct, c.used, `Used ${formatTbps(p.used)}`)}
      {seg(p.reservedPct, hatch(c.reserved), `Reserved ${formatTbps(p.reserved)}`)}
      {seg(p.freePct, c.free, `Free ${formatTbps(p.free)}`)}
    </div>
  )
}

export function CapacityBreakdown({ cap }: { cap: SegmentCapacity }) {
  const t = useTheme()
  const p = capacityParts(cap)
  const c = capacityColors(t)
  const row = (label: string, value: number, pct: number, swatch: string | null, strong = false) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '3px 0' }}>
      {swatch ? <span aria-hidden style={{ width: 10, height: 10, borderRadius: 2, background: swatch, flexShrink: 0 }} />
        : <span aria-hidden style={{ width: 10, flexShrink: 0 }} />}
      <span style={{ color: strong ? t.text : t.textMuted, fontWeight: strong ? 700 : 500, flex: 1 }}>{label}</span>
      <span style={{ color: t.text, fontWeight: strong ? 700 : 600, fontVariantNumeric: 'tabular-nums' }}>{formatTbps(value)}</span>
      <span style={{ color: t.textFaint, fontVariantNumeric: 'tabular-nums', width: 40, textAlign: 'right' }}>
        {pct >= 0 ? `${Math.round(pct * 100)}%` : ''}
      </span>
    </div>
  )
  return (
    <div>
      {row('Free', p.free, p.freePct, c.free, true)}
      {row('Reserved', p.reserved, p.reservedPct, hatch(c.reserved))}
      {row('Used', p.used, p.usedPct, c.used)}
      <div style={{ borderTop: `1px solid ${t.borderSubtle}`, margin: '4px 0' }} />
      {row('Total', p.total, -1, null, true)}
      {p.total > 0 && <div style={{ marginTop: 8 }}><CapacityBar cap={cap} /></div>}
    </div>
  )
}
