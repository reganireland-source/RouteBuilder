/**
 * HazardStatusPanel — the small card that says what the hazard layer is actually
 * showing you.
 *
 * This exists because of the one way this feature can mislead badly: an empty
 * map is indistinguishable from a working map with nothing on it. Neither feed
 * covers everywhere — bushfire.io serves Australia, North America and Europe
 * only, and USGS is worldwide but earthquakes only — so a clear map over Tokyo
 * means "no earthquake this week", NOT "nothing is wrong in Japan". If a source
 * is down or unconfigured it means even less than that.
 *
 * So the panel always states three things: how many hazards are loaded, how many
 * touch our own network, and what each source can and cannot speak for. It is
 * deliberately plain text rather than a status light, because "green" would
 * imply an all-clear this data cannot support.
 *
 * Mounted from: Map.tsx, alongside HazardLayer, whenever the layer is on.
 */
import { useState } from 'react'
import type { HazardFeed } from '../types'
import { useTheme } from '../theme'

interface Props {
  feed: HazardFeed | null
  loading: boolean
  error: string | null
  onRefresh: () => void
  /** Narrow viewport — the panel shrinks and starts collapsed. */
  narrow?: boolean
}

export function HazardStatusPanel({ feed, loading, error, onRefresh, narrow = false }: Props) {
  const t = useTheme()
  const [open, setOpen] = useState(!narrow)

  const relevant = feed ? feed.hazards.filter(h => h.affected.length > 0).length : 0
  const total = feed?.hazards.length ?? 0

  const shell: React.CSSProperties = {
    position: 'absolute',
    top: narrow ? 100 : 62,
    right: 12,
    zIndex: 1000,
    width: narrow ? 210 : 260,
    background: t.bgPanel,
    border: `1px solid ${feed?.degraded || error ? t.orange : t.border}`,
    borderRadius: 8,
    boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
    fontFamily: 'system-ui, sans-serif',
    overflow: 'hidden',
  }

  return (
    <div style={shell}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 7, width: '100%',
          padding: '7px 10px', background: 'transparent', border: 'none',
          cursor: 'pointer', textAlign: 'left', color: t.text,
        }}
      >
        <span style={{ fontSize: 13, lineHeight: 1 }}>⚠️</span>
        <span style={{ fontSize: 11, fontWeight: 700, flex: 1 }}>
          {loading && !feed ? 'Loading hazards…' : `${relevant} near network`}
        </span>
        <span style={{ fontSize: 10, color: t.textFaint }}>{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div style={{ padding: '0 10px 9px', fontSize: 10, color: t.textMuted, lineHeight: 1.5 }}>
          {error && (
            <div style={{ color: t.red, marginBottom: 6 }}>
              Could not load the hazard feed. {error}
            </div>
          )}

          {feed && (
            <>
              <div style={{ marginBottom: 6 }}>
                <strong style={{ color: t.text }}>{total}</strong> active,{' '}
                <strong style={{ color: relevant ? t.orange : t.text }}>{relevant}</strong> within range of a node or cable.
              </div>

              {feed.sources.map(s => (
                <div key={s.source} style={{ marginBottom: 5 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ color: s.ok ? t.green : t.orange, fontSize: 9 }}>{s.ok ? '●' : '○'}</span>
                    <span style={{ color: t.text, fontWeight: 600 }}>{s.label}</span>
                    {s.ok && <span style={{ color: t.textFaint }}>· {s.count}</span>}
                  </div>
                  <div style={{ color: s.ok ? t.textFaintest : t.orange, marginLeft: 14 }}>
                    {s.error ?? s.coverage}
                  </div>
                </div>
              ))}

              {/* Stated every time, not only when something is wrong. The gap in
                  coverage is a permanent property of these feeds, not an incident. */}
              <div style={{
                marginTop: 7, paddingTop: 6, borderTop: `1px solid ${t.border}`,
                color: t.textFaintest, fontStyle: 'italic',
              }}>
                An empty map is not an all-clear — it means these sources report nothing here.
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 7 }}>
                <button
                  onClick={onRefresh}
                  disabled={loading}
                  style={{
                    padding: '3px 8px', borderRadius: 4, fontSize: 10, fontFamily: 'inherit',
                    border: `1px solid ${t.border}`, background: 'transparent',
                    color: loading ? t.textFaintest : t.textMuted,
                    cursor: loading ? 'default' : 'pointer',
                  }}
                >
                  {loading ? 'Refreshing…' : 'Refresh'}
                </button>
                <span style={{ color: t.textFaintest }}>
                  {feed.fetched_at.slice(11, 16)} UTC
                </span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
