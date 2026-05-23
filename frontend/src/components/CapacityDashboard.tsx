import { useMemo, useState } from 'react'
import type { CableSegment, SegmentCapacity } from '../types'
import { useTheme } from '../theme'

interface Props {
  segments: CableSegment[]
  capacity: SegmentCapacity[]
  onClose: () => void
}

function fmt(tb: number): string {
  return tb >= 1 ? `${tb.toFixed(1)} TB` : `${(tb * 1000).toFixed(0)} GB`
}

function pct(used: number, total: number): string {
  if (total === 0) return '—'
  return `${Math.round((used / total) * 100)}%`
}

function UtilBar({ used, total }: { used: number; total: number }) {
  const t = useTheme()
  const ratio = total > 0 ? Math.min(used / total, 1) : 0
  const color = ratio > 0.85 ? t.red : ratio > 0.6 ? t.orange : t.green
  return (
    <div style={{ width: 64, height: 6, borderRadius: 3, background: t.border, flexShrink: 0 }}>
      <div style={{ width: `${ratio * 100}%`, height: '100%', borderRadius: 3, background: color, transition: 'width 0.3s' }} />
    </div>
  )
}

interface EnrichedSeg {
  id:        string
  name:      string
  system_id: string
  type:      string
  total:     number
  avail:     number
  used:      number
  utilPct:   number
}

export function CapacityDashboard({ segments, capacity, onClose }: Props) {
  const t = useTheme()

  const enriched: EnrichedSeg[] = useMemo(() => {
    const segById = Object.fromEntries(segments.map(s => [s.id, s]))
    const result: EnrichedSeg[] = []
    for (const c of capacity) {
      const seg = segById[c.segment_id]
      if (!seg) continue
      result.push({
        id:        c.segment_id,
        name:      seg.name,
        system_id: seg.system_id,
        type:      seg.type,
        total:     c.total_capacity_t,
        avail:     c.available_capacity_t,
        used:      c.total_capacity_t - c.available_capacity_t,
        utilPct:   c.total_capacity_t > 0
          ? (c.total_capacity_t - c.available_capacity_t) / c.total_capacity_t
          : 0,
      })
    }
    return result
  }, [segments, capacity])

  const wetSegs  = enriched.filter((e: EnrichedSeg) => e.type === 'wet')
  const terrSegs = enriched.filter((e: EnrichedSeg) => e.type === 'terrestrial')

  const totalCap      = enriched.reduce((s: number, e: EnrichedSeg) => s + e.total, 0)
  const totalAvail    = enriched.reduce((s: number, e: EnrichedSeg) => s + e.avail, 0)
  const totalUsed     = totalCap - totalAvail

  const wetCap        = wetSegs.reduce((s: number, e: EnrichedSeg) => s + e.total, 0)
  const wetAvail      = wetSegs.reduce((s: number, e: EnrichedSeg) => s + e.avail, 0)

  const terrCap       = terrSegs.reduce((s: number, e: EnrichedSeg) => s + e.total, 0)
  const terrAvail     = terrSegs.reduce((s: number, e: EnrichedSeg) => s + e.avail, 0)

  const [tableFilter, setTableFilter] = useState<'wet' | 'terrestrial'>('wet')

  const filtered      = tableFilter === 'wet' ? wetSegs : terrSegs
  const topSpare      = [...filtered].sort((a, b) => b.avail - a.avail).slice(0, 15)
  const topCongested  = [...filtered].sort((a, b) => a.avail - b.avail).slice(0, 15)

  const networkUtil   = totalCap > 0 ? Math.round((totalUsed / totalCap) * 100) : 0

  // ── Styles ────────────────────────────────────────────────────────────────
  const statCard = (_accent: string): React.CSSProperties => ({
    flex: 1, minWidth: 130, padding: '14px 16px', borderRadius: 8,
    background: t.bgCard, border: `1px solid ${t.border}`,
    display: 'flex', flexDirection: 'column', gap: 4,
  })

  const bigNum: React.CSSProperties = {
    fontSize: 26, fontWeight: 800, lineHeight: 1.1, color: t.text,
  }

  const subLabel: React.CSSProperties = {
    fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
    letterSpacing: '0.07em', color: t.textFaint,
  }

  const sectionHead: React.CSSProperties = {
    fontSize: 12, fontWeight: 700, textTransform: 'uppercase',
    letterSpacing: '0.07em', color: t.textMuted, marginBottom: 10,
    paddingBottom: 6, borderBottom: `1px solid ${t.border}`,
  }

  const th: React.CSSProperties = {
    fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
    letterSpacing: '0.05em', color: t.textFaint,
    padding: '6px 10px', textAlign: 'left', whiteSpace: 'nowrap',
  }

  const td: React.CSSProperties = {
    fontSize: 12, color: t.text, padding: '7px 10px',
    borderTop: `1px solid ${t.border}`,
  }

  function SegTable({ rows, label }: { rows: typeof topSpare; label: string }) {
    return (
      <div style={{ marginBottom: 32 }}>
        <p style={sectionHead}>{label}</p>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>#</th>
                <th style={th}>Segment</th>
                <th style={th}>System</th>
                <th style={th}>Type</th>
                <th style={{ ...th, textAlign: 'right' }}>Available</th>
                <th style={{ ...th, textAlign: 'right' }}>Total</th>
                <th style={{ ...th, textAlign: 'right' }}>Used %</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id} style={{ background: i % 2 === 0 ? 'transparent' : t.bgDeep + '55' }}>
                  <td style={{ ...td, color: t.textFaintest, fontVariantNumeric: 'tabular-nums' }}>{i + 1}</td>
                  <td style={{ ...td, maxWidth: 220 }}>
                    <div style={{ fontWeight: 500 }}>{r.name}</div>
                    <div style={{ fontSize: 10, color: t.textFaint }}>{r.id}</div>
                  </td>
                  <td style={{ ...td, color: t.textMuted }}>{r.system_id}</td>
                  <td style={td}>
                    <span style={{
                      fontSize: 10, padding: '1px 6px', borderRadius: 10, fontWeight: 600,
                      background: r.type === 'wet' ? t.blue + '22' : t.orange + '22',
                      color: r.type === 'wet' ? t.blue : t.orange,
                    }}>
                      {r.type}
                    </span>
                  </td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                    {fmt(r.avail)}
                  </td>
                  <td style={{ ...td, textAlign: 'right', color: t.textMuted, fontVariantNumeric: 'tabular-nums' }}>
                    {fmt(r.total)}
                  </td>
                  <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums',
                    color: r.utilPct > 0.85 ? t.red : r.utilPct > 0.6 ? t.orange : t.green
                  }}>
                    {pct(r.used, r.total)}
                  </td>
                  <td style={{ ...td, paddingRight: 16 }}>
                    <UtilBar used={r.used} total={r.total} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 2000,
        background: 'rgba(0,0,0,0.55)', display: 'flex',
        alignItems: 'flex-start', justifyContent: 'center',
        padding: '24px 16px', overflowY: 'auto',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 980,
          background: t.bgPanel, borderRadius: 12,
          border: `1px solid ${t.border}`,
          boxShadow: '0 24px 80px rgba(0,0,0,0.5)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '18px 24px', borderBottom: `1px solid ${t.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: t.text, margin: 0 }}>
              📊 Network Capacity Dashboard
            </h2>
            <p style={{ fontSize: 11, color: t.textFaint, margin: '3px 0 0' }}>
              {enriched.length} segments with capacity data
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 20, color: t.textFaint, lineHeight: 1, padding: 4,
            }}
          >
            ×
          </button>
        </div>

        <div style={{ padding: '24px', overflowY: 'auto' }}>

          {/* ── Headline stats ───────────────────────────────────────────── */}
          <p style={{ ...sectionHead, marginBottom: 14 }}>Headline Figures</p>

          {/* Network utilisation summary */}
          <div style={{
            padding: '14px 20px', borderRadius: 8, marginBottom: 16,
            background: networkUtil > 85 ? t.red + '11' : networkUtil > 60 ? t.orange + '11' : t.green + '11',
            border: `1px solid ${networkUtil > 85 ? t.red : networkUtil > 60 ? t.orange : t.green}44`,
            display: 'flex', alignItems: 'center', gap: 16,
          }}>
            <div style={{ fontSize: 40, fontWeight: 900, color: networkUtil > 85 ? t.red : networkUtil > 60 ? t.orange : t.green }}>
              {networkUtil}%
            </div>
            <div>
              <div style={{ fontWeight: 700, color: t.text, fontSize: 14 }}>Overall Network Utilisation</div>
              <div style={{ fontSize: 12, color: t.textMuted }}>
                {fmt(totalUsed)} used of {fmt(totalCap)} total · {fmt(totalAvail)} spare
              </div>
            </div>
          </div>

          {/* 3-column stat cards */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 32 }}>
            <div style={statCard(t.blue)}>
              <span style={subLabel}>Total Capacity</span>
              <span style={bigNum}>{fmt(totalCap)}</span>
              <span style={{ fontSize: 11, color: t.textFaint }}>{enriched.length} segments</span>
            </div>
            <div style={statCard(t.blue)}>
              <span style={subLabel}>Wet Capacity</span>
              <span style={bigNum}>{fmt(wetCap)}</span>
              <span style={{ fontSize: 11, color: t.textFaint }}>{wetSegs.length} submarine segments</span>
            </div>
            <div style={statCard(t.orange)}>
              <span style={subLabel}>Terrestrial Capacity</span>
              <span style={bigNum}>{fmt(terrCap)}</span>
              <span style={{ fontSize: 11, color: t.textFaint }}>{terrSegs.length} terrestrial segments</span>
            </div>
            <div style={statCard(t.green)}>
              <span style={subLabel}>Total Spare</span>
              <span style={{ ...bigNum, color: t.green }}>{fmt(totalAvail)}</span>
              <span style={{ fontSize: 11, color: t.textFaint }}>{pct(totalAvail, totalCap)} of total</span>
            </div>
            <div style={statCard(t.green)}>
              <span style={subLabel}>Wet Spare</span>
              <span style={{ ...bigNum, color: t.green }}>{fmt(wetAvail)}</span>
              <span style={{ fontSize: 11, color: t.textFaint }}>{pct(wetAvail, wetCap)} of wet total</span>
            </div>
            <div style={statCard(t.green)}>
              <span style={subLabel}>Terrestrial Spare</span>
              <span style={{ ...bigNum, color: t.green }}>{fmt(terrAvail)}</span>
              <span style={{ fontSize: 11, color: t.textFaint }}>{pct(terrAvail, terrCap)} of terrestrial total</span>
            </div>
          </div>

          {/* ── Tables ───────────────────────────────────────────────────── */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18 }}>
            <span style={{ fontSize: 11, color: t.textFaint, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Show:
            </span>
            {(['wet', 'terrestrial'] as const).map(opt => (
              <button
                key={opt}
                onClick={() => setTableFilter(opt)}
                style={{
                  padding: '4px 12px', borderRadius: 20, border: 'none', cursor: 'pointer',
                  fontSize: 12, fontWeight: 700,
                  background: tableFilter === opt
                    ? (opt === 'wet' ? t.blue : t.orange)
                    : t.bgCard,
                  color: tableFilter === opt ? '#fff' : t.textMuted,
                  border: `1px solid ${tableFilter === opt ? (opt === 'wet' ? t.blue : t.orange) : t.border}`,
                  transition: 'all 0.15s',
                }}
              >
                {opt === 'wet' ? '🌊 Wet' : '🏔 Backhaul'}
              </button>
            ))}
            <span style={{ fontSize: 11, color: t.textFaintest, marginLeft: 4 }}>
              ({filtered.length} segments)
            </span>
          </div>
          <SegTable rows={topSpare}     label="Top 15 Segments — Most Spare Capacity" />
          <SegTable rows={topCongested} label="Top 15 Segments — Most Congested" />

        </div>
      </div>
    </div>
  )
}
