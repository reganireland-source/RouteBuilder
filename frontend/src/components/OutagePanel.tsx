/**
 * OutagePanel — read-only list of network fault/event records, split into two
 * clearly separated sections:
 *   - "Active Outages" — CURRENT live faults (event_type !== 'planned_event',
 *     which also covers legacy rows with no event_type stored at all).
 *   - "Planned Events" — FUTURE scheduled network works (event_type ===
 *     'planned_event', e.g. a maintenance window) that MAY take a segment
 *     down later, but are not a live fault today.
 *
 * Each section renders its own card list with the existing outage card
 * layout/pattern: Active Outages keeps its original red accent; Planned
 * Events reuses the same layout with an amber/orange accent, a 🗓️ icon
 * instead of a status badge, and the planned_start–planned_end window (via
 * DateChip) instead of fault/repair dates. Active Outages cards are otherwise
 * unchanged — "OPEN" (red, no ETA) vs "REPAIRING" (amber, has an ETA), sorted
 * unresolved-first then newest fault date first.
 *
 * The Planned Events section always renders (with a "No planned events" note
 * when empty) so the separation between the two categories is always visible.
 * The original "all clear" empty-state is preserved, but now only fires when
 * BOTH sections have zero records — a single filter box searches across both.
 *
 * Props:
 *   - outages:  SegmentOutage records (already fetched by the parent) — a mix
 *     of 'outage' and 'planned_event' rows.
 *   - segments: all CableSegments, used to resolve each record's segment name/system.
 *   - systems:  all CableSystems, used to resolve human-readable system names.
 *
 * Mounted from: App.tsx (desktop sidebar, "Outages" mode) and MobileLayout.tsx (mobile tab).
 * Backend endpoints: none — purely presentational; the parent loads outage data
 * (e.g. via /api/outages) and passes it down. The small DateChip helper at the bottom
 * of this file renders the labelled date fields on each card (fault/repair dates for
 * outages, the planned window for planned events).
 */
import { useMemo, useState } from 'react'
import type { CableSegment, CableSystem, SegmentOutage } from '../types'
import { useTheme } from '../theme'

interface Props {
  outages: SegmentOutage[]
  segments: CableSegment[]
  systems: CableSystem[]
}

/** Shared shape after resolving each record's segment/system for display. */
interface Enriched extends SegmentOutage {
  seg?: CableSegment
  sys?: CableSystem
}

export function OutagePanel({ outages, segments, systems }: Props) {
  const t = useTheme()
  const [filter, setFilter] = useState('')

  const segById = useMemo(() => Object.fromEntries(segments.map(s => [s.id, s])), [segments])
  const sysById = useMemo(() => Object.fromEntries(systems.map(s => [s.id, s])), [systems])

  const enriched: Enriched[] = useMemo(() => outages.map(o => ({
    ...o,
    seg: segById[o.segment_id],
    sys: o.segment_id ? sysById[segById[o.segment_id]?.system_id ?? ''] : undefined,
  })), [outages, segById, sysById])

  const matchesFilter = (o: Enriched) =>
    !filter.trim() ||
    o.seg?.system_id?.toLowerCase().includes(filter.toLowerCase()) ||
    o.seg?.name?.toLowerCase().includes(filter.toLowerCase()) ||
    o.description?.toLowerCase().includes(filter.toLowerCase()) ||
    o.fault_id?.toLowerCase().includes(filter.toLowerCase())

  // Split into the two categories. Legacy rows with no event_type stored
  // default to 'outage' so existing data/behaviour is unaffected.
  const activeOutages   = enriched.filter(o => (o.event_type ?? 'outage') === 'outage')
  const plannedEvents    = enriched.filter(o => o.event_type === 'planned_event')

  const filteredOutages  = activeOutages.filter(matchesFilter)
  const filteredPlanned  = plannedEvents.filter(matchesFilter)

  // Sort: unresolved (no repair date) first, then by fault date desc
  const sortedOutages = [...filteredOutages].sort((a, b) => {
    const aOpen = !a.estimated_repair_date ? 0 : 1
    const bOpen = !b.estimated_repair_date ? 0 : 1
    if (aOpen !== bOpen) return aOpen - bOpen
    return b.fault_date.localeCompare(a.fault_date)
  })
  // Sort planned events by their window start (soonest first), falling back
  // to fault date (date logged) when a window isn't set yet.
  const sortedPlanned = [...filteredPlanned].sort((a, b) =>
    (a.planned_start ?? a.fault_date).localeCompare(b.planned_start ?? b.fault_date)
  )

  if (activeOutages.length === 0 && plannedEvents.length === 0) {
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
      {/* Filter — searches both sections */}
      <input
        placeholder="Filter by system, segment, fault ID…"
        value={filter}
        onChange={e => setFilter(e.target.value)}
        style={{
          width: '100%', background: t.bgBase, border: `1px solid ${t.border}`,
          borderRadius: 6, padding: '8px 10px', color: t.text, fontSize: 13,
          outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit', marginBottom: 14,
        }}
      />

      {/* ── Active Outages section ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: t.text }}>Active Outages</div>
        <div style={{
          fontSize: 11, fontWeight: 700, color: t.red,
          background: t.red + '22', padding: '2px 8px', borderRadius: 10,
        }}>
          {activeOutages.length} fault{activeOutages.length !== 1 ? 's' : ''}
        </div>
      </div>

      {sortedOutages.length === 0 && (
        <div style={{ fontSize: 12, color: t.textFaint, textAlign: 'center', padding: '12px 0' }}>
          {activeOutages.length === 0 ? 'No active outages' : 'No matches'}
        </div>
      )}

      {sortedOutages.map(o => {
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

      {/* ── Planned Events section — always shown, even when empty, so the two
          categories always read as clearly separate. ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '18px 0 10px', paddingTop: 14, borderTop: `1px solid ${t.border}` }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: t.text }}>🗓️ Planned Events</div>
        <div style={{
          fontSize: 11, fontWeight: 700, color: t.orange,
          background: t.orange + '22', padding: '2px 8px', borderRadius: 10,
        }}>
          {plannedEvents.length} event{plannedEvents.length !== 1 ? 's' : ''}
        </div>
      </div>

      {plannedEvents.length === 0 && (
        <div style={{
          padding: '14px 12px', borderRadius: 8, background: t.bgCard,
          border: `1px solid ${t.border}`, textAlign: 'center',
        }}>
          <div style={{ fontSize: 11, color: t.textFaint, fontStyle: 'italic' }}>No planned events</div>
        </div>
      )}

      {plannedEvents.length > 0 && sortedPlanned.length === 0 && (
        <div style={{ fontSize: 12, color: t.textFaint, textAlign: 'center', padding: '12px 0' }}>No matches</div>
      )}

      {sortedPlanned.map(o => {
        const system_id = o.seg?.system_id ?? '—'
        const sysName   = o.sys?.name ?? system_id
        const segName   = o.seg?.name ?? o.segment_id

        return (
          <div key={o.fault_id} style={{
            background: t.bgCard, border: `1px solid ${t.orange}55`,
            borderLeft: `3px solid ${t.orange}`,
            borderRadius: 8, padding: '10px 12px', marginBottom: 8,
          }}>
            {/* Top row: system + calendar badge */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: t.orange }}>
                {sysName}
              </span>
              <span style={{
                fontSize: 10, fontWeight: 700, letterSpacing: '0.05em',
                color: t.orange, background: t.orange + '22',
                padding: '2px 6px', borderRadius: 4,
              }}>
                🗓️ PLANNED
              </span>
            </div>

            {/* Segment name */}
            <div style={{ fontSize: 11, color: t.textMuted, marginBottom: 5 }}>{segName}</div>

            {/* Description */}
            {o.description && (
              <div style={{ fontSize: 11, color: t.text, lineHeight: 1.5, marginBottom: 6 }}>{o.description}</div>
            )}

            {/* Planned window */}
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' as const }}>
              <DateChip label="Date raised" value={o.fault_date} />
              {o.planned_start
                ? <DateChip label="Planned start" value={o.planned_start} highlight highlightColor={t.orange} />
                : <span style={{ fontSize: 10, color: t.textFaint, fontStyle: 'italic' }}>No window set</span>
              }
              {o.planned_end && <DateChip label="Planned end" value={o.planned_end} highlight highlightColor={t.orange} />}
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

function DateChip({ label, value, highlight, highlightColor }: { label: string; value: string; highlight?: boolean; highlightColor?: string }) {
  const t = useTheme()
  const display = value.slice(0, 10)   // YYYY-MM-DD
  return (
    <div>
      <div style={{ fontSize: 9, color: t.textFaint, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontSize: 11, fontWeight: highlight ? 700 : 400, color: highlight ? (highlightColor ?? '#c07a20') : t.textMuted }}>{display}</div>
    </div>
  )
}
