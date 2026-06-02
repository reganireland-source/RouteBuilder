import { useMemo, useState } from 'react'
import type { CableSegment, CableSystem, SegmentOutage } from '../types'
import { useTheme } from '../theme'

interface Props {
  outages: SegmentOutage[]
  segments: CableSegment[]
  systems: CableSystem[]
}

export function OutagePanel({ outages, segments, systems }: Props) {
  const t = useTheme()
  const [filter, setFilter] = useState('')

  const segById = useMemo(() => Object.fromEntries(segments.map(s => [s.id, s])), [segments])
  const sysById = useMemo(() => Object.fromEntries(systems.map(s => [s.id, s])), [systems])

  const enriched = useMemo(() => outages.map(o => ({
    ...o,
    seg: segById[o.segment_id],
    sys: o.segment_id ? sysById[segById[o.segment_id]?.system_id ?? ''] : undefined,
  })), [outages, segById, sysById])

  const filtered = filter.trim()
    ? enriched.filter(o =>
        o.seg?.system_id?.toLowerCase().includes(filter.toLowerCase()) ||
        o.seg?.name?.toLowerCase().includes(filter.toLowerCase()) ||
        o.description?.toLowerCase().includes(filter.toLowerCase()) ||
        o.fault_id?.toLowerCase().includes(filter.toLowerCase()))
    : enriched

  // Sort: unresolved (no repair date) first, then by fault date desc
  const sorted = [...filtered].sort((a, b) => {
    const aOpen = !a.estimated_repair_date ? 0 : 1
    const bOpen = !b.estimated_repair_date ? 0 : 1
    if (aOpen !== bOpen) return aOpen - bOpen
    return b.fault_date.localeCompare(a.fault_date)
  })

  if (outages.length === 0) {
    return (
      <div style={{ padding: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: t.text, marginBottom: 8 }}>Active Outages</div>
        <div style={{
          padding: '20px 16px', borderRadius: 8, background: t.bgCard,
          border: `1px solid ${t.border}`, textAlign: 'center',
        }}>
          <div style={{ fontSize: 22, marginBottom: 8 }}>✅</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: t.green }}>No active outages</div>
          <div style={{ fontSize: 11, color: t.textMuted, marginTop: 4 }}>All segments are operating normally.</div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ padding: '12px 14px 32px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: t.text }}>Active Outages</div>
        <div style={{
          fontSize: 11, fontWeight: 700, color: t.red,
          background: t.red + '22', padding: '2px 8px', borderRadius: 10,
        }}>
          {outages.length} fault{outages.length !== 1 ? 's' : ''}
        </div>
      </div>

      {/* Filter */}
      <input
        placeholder="Filter by system, segment, fault ID…"
        value={filter}
        onChange={e => setFilter(e.target.value)}
        style={{
          width: '100%', background: t.bgBase, border: `1px solid ${t.border}`,
          borderRadius: 6, padding: '8px 10px', color: t.text, fontSize: 13,
          outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit', marginBottom: 12,
        }}
      />

      {sorted.length === 0 && (
        <div style={{ fontSize: 12, color: t.textFaint, textAlign: 'center', padding: '12px 0' }}>No matches</div>
      )}

      {sorted.map(o => {
        const isOpen    = !o.estimated_repair_date
        const system_id = o.seg?.system_id ?? '—'
        const sysName   = o.sys?.name ?? system_id
        const segName   = o.seg?.name ?? o.segment_id

        return (
          <div key={o.fault_id} style={{
            background: t.bgCard, border: `1px solid ${isOpen ? t.red + '55' : t.border}`,
            borderLeft: `3px solid ${isOpen ? t.red : '#c07a20'}`,
            borderRadius: 8, padding: '10px 12px', marginBottom: 8,
          }}>
            {/* Top row: system + status badge */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: isOpen ? t.red : '#c07a20' }}>
                {sysName}
              </span>
              <span style={{
                fontSize: 10, fontWeight: 700, letterSpacing: '0.05em',
                color: isOpen ? t.red : '#c07a20',
                background: (isOpen ? t.red : '#c07a20') + '22',
                padding: '2px 6px', borderRadius: 4,
              }}>
                {isOpen ? 'OPEN' : 'REPAIRING'}
              </span>
            </div>

            {/* Segment name */}
            <div style={{ fontSize: 11, color: t.textMuted, marginBottom: 5 }}>{segName}</div>

            {/* Description */}
            {o.description && (
              <div style={{ fontSize: 11, color: t.text, lineHeight: 1.5, marginBottom: 6 }}>{o.description}</div>
            )}

            {/* Date row */}
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' as const }}>
              <DateChip label="Fault date" value={o.fault_date} />
              {o.repair_start && <DateChip label="Repair start" value={o.repair_start} />}
              {o.estimated_repair_date
                ? <DateChip label="Est. repair" value={o.estimated_repair_date} highlight />
                : <span style={{ fontSize: 10, color: t.textFaint, fontStyle: 'italic' }}>No ETA</span>
              }
            </div>

            {/* Fault ID */}
            <div style={{ fontSize: 9, color: t.textFaint, marginTop: 5, fontFamily: 'monospace' }}>
              {o.fault_id}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function DateChip({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  const t = useTheme()
  const display = value.slice(0, 10)   // YYYY-MM-DD
  return (
    <div>
      <div style={{ fontSize: 9, color: t.textFaint, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontSize: 11, fontWeight: highlight ? 700 : 400, color: highlight ? '#c07a20' : t.textMuted }}>{display}</div>
    </div>
  )
}
