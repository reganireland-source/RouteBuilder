/**
 * AisFeedLine — one line answering "is the ship feed working, or have the
 * ships just not been heard?", shown in ShipTrackerDialog and ShipFullView.
 *
 * aisstream.io's free feed is shore-receiver only and patchy, so "no position"
 * is usually silence, not a fault. Without this line the two look identical.
 * Reads GET /api/health/sources (in-memory backend state, no upstream call),
 * refreshed every 30 s like the bottom status bar.
 */
import { useEffect, useState } from 'react'
import { api, type SourceHealth } from '../api/client'
import { useTheme } from '../theme'

const UNREACHABLE: SourceHealth = { id: 'ais', label: 'Ship AIS', status: 'error', detail: 'Backend unreachable' }

function aisEntry(r: { sources: SourceHealth[] }): SourceHealth | null {
  return r.sources.find(s => s.id === 'ais') ?? null
}

/** `refreshToken`: bump it to re-read immediately (e.g. after sources change). */
export function useAisFeed(refreshToken = 0): SourceHealth | null {
  const [feed, setFeed] = useState<SourceHealth | null>(null)
  useEffect(() => {
    let cancelled = false
    const load = () => api.getSourceHealth()
      .then(r => { if (!cancelled) setFeed(aisEntry(r)) })
      .catch(() => { if (!cancelled) setFeed(UNREACHABLE) })
    load()
    const id = window.setInterval(load, 30_000)
    return () => { cancelled = true; window.clearInterval(id) }
  }, [refreshToken])
  return feed
}

/** Plain-language summary of the feed state. */
export function describeAisFeed(feed: SourceHealth | null): string {
  if (!feed) return 'Checking the AIS feed…'
  if (feed.status === 'disabled') return 'AIS feed not configured on the backend — no positions can arrive.'
  if (feed.status === 'error') return `AIS feed error: ${feed.detail}`
  if (feed.status === 'checking') return 'AIS feed connecting…'
  return `AIS feed working — ${feed.detail.replace(/^Connected · /, '')}.`
}

export function AisFeedLine({ feed, compact = false }: { feed: SourceHealth | null; compact?: boolean }) {
  const t = useTheme()
  const colour = { ok: t.green, error: t.red, checking: t.orange, disabled: t.textFaintest }[feed?.status ?? 'checking']
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7, fontSize: compact ? 11 : 12, color: t.textMuted, lineHeight: 1.5 }}>
      <span aria-hidden style={{
        width: 8, height: 8, borderRadius: '50%', background: colour, flexShrink: 0, marginTop: compact ? 4 : 5,
        boxShadow: feed?.status === 'ok' ? `0 0 4px ${t.green}88` : undefined,
      }} />
      <span>{describeAisFeed(feed)}</span>
    </div>
  )
}
