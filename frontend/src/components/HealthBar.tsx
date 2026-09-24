/**
 * HealthBar — status strip of coloured dots showing the health of every runtime dependency.
 *
 * Renders six indicators (Frontend, Backend, Data, Database, LLM API, Maps) as small
 * green/red/yellow/grey dots with hover tooltips, plus a version line — build number,
 * short commit hash, branch and build timestamp (injected at build time via the
 * __BUILD_NUMBER__ / __BUILD_COMMIT__ / __BUILD_BRANCH__ / __BUILD_DIRTY__ /
 * __BUILD_DATE__ Vite defines in vite.config.ts) — with the full detail in a tooltip
 * since the footer strip is too narrow to show all of it inline at once.
 *
 * Props:
 *   - dataLoaded:   whether the parent has finished loading network data; used to colour
 *                   the "Data" dot while the first backend health check is still in flight.
 *   - mapsProvider: 'osm' (default) or 'google' — selects how the Maps check is performed.
 *
 * Mounted from: App.tsx (bottom of the desktop sidebar) and MobileLayout.tsx (bottom bar).
 *
 * Side effects / polling:
 *   - Calls api.getHealth() (GET /api/health) and api.getNlpHealth() (GET /api/health/nlp)
 *     on mount and every 30 seconds; results drive the Backend, Data, Database and LLM dots.
 *   - Maps check: for the free provider it fetches a single Esri basemap tile with a 5 s
 *     timeout — this replaced a check against CARTO's basemaps.cartocdn.com, which now
 *     gates its tiles behind an API key but still returns an HTTP 200 "API KEY REQUIRED"
 *     watermark tile, so that check falsely reported "OK" even when the map was unusable;
 *     for Google it polls window.google.maps for up to ~8 s and also verifies that a
 *     VITE_GMAPS_API_KEY was baked into the build.
 * All checks are best-effort; failures only change dot colours, never crash the app.
 */
import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { useTheme, type Theme } from '../theme'

type Status = 'checking' | 'ok' | 'error' | 'disabled'

interface Indicator {
  label: string
  status: Status
  detail?: string
}

// Themed, not hardcoded: this used to be a fixed Record<Status, string> of
// literal hex values (Catppuccin Mocha's own palette), so the dots stayed
// dark-theme-colored even after switching to Light or Dusk. "checking" maps
// to orange (the app's "in-progress" semantic per DESIGN.md) since theme.ts
// has no dedicated amber/yellow token.
function dotColor(t: Theme, status: Status): string {
  if (status === 'ok') return t.green
  if (status === 'error') return t.red
  if (status === 'checking') return t.orange
  return t.textFaintest
}

interface Props {
  dataLoaded: boolean
  mapsProvider?: 'osm' | 'google'
}

export function HealthBar({ dataLoaded, mapsProvider }: Props) {
  const t = useTheme()
  const [backendStatus, setBackendStatus] = useState<Status>('checking')
  const [backendDetail, setBackendDetail] = useState<string>('')
  const [dataDetail,    setDataDetail]    = useState<string>('Loading…')
  const [dataStatus,    setDataStatus]    = useState<Status>('checking')
  const [nlpStatus,     setNlpStatus]     = useState<Status>('checking')
  const [nlpDetail,     setNlpDetail]     = useState<string>('')
  const [dbStatus,      setDbStatus]      = useState<Status>('checking')
  const [dbDetail,      setDbDetail]      = useState<string>('')
  const [mapsStatus,    setMapsStatus]    = useState<Status>('checking')
  const [mapsDetail,    setMapsDetail]    = useState<string>('Checking…')

  async function checkBackend() {
    setBackendStatus('checking')
    try {
      const h = await api.getHealth()
      setBackendStatus('ok')
      setBackendDetail(`${h.nodes} nodes · ${h.segments} segs · ${h.systems} systems`)
      setDataStatus('ok')
      setDataDetail(h.storage === 'postgres' ? 'PostgreSQL' : 'JSON files')
      setDbStatus(h.db_ok ? 'ok' : h.storage === 'json' ? 'disabled' : 'error')
      setDbDetail(h.db_detail ?? (h.storage === 'json' ? 'No DATABASE_URL' : ''))
    } catch {
      setBackendStatus('error')
      setBackendDetail('Unreachable')
      setDataStatus('error')
      setDataDetail('Unavailable')
      setDbStatus('error')
      setDbDetail('Backend unreachable')
    }
  }

  async function checkNlp() {
    try {
      const n = await api.getNlpHealth()
      setNlpStatus(n.status)
      setNlpDetail(n.status === 'ok' ? n.detail : n.status === 'disabled' ? 'Not configured' : n.detail)
    } catch {
      setNlpStatus('error')
      setNlpDetail('Unreachable')
    }
  }

  useEffect(() => {
    checkBackend()
    checkNlp()
    const interval = setInterval(() => { checkBackend(); checkNlp() }, 30_000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    setMapsStatus('checking')
    setMapsDetail('Checking…')
    let cancelled = false
    const provider = mapsProvider ?? 'osm'
    if (provider === 'google') {
      if (!import.meta.env.VITE_GMAPS_API_KEY) {
        setMapsStatus('error')
        setMapsDetail('No API key in build')
        return
      }
      let attempts = 0
      const poll = () => {
        if (cancelled) return
        if ((window as { google?: { maps?: unknown } }).google?.maps) {
          setMapsStatus('ok')
          setMapsDetail('Google Maps')
        } else if (attempts++ < 16) {
          setTimeout(poll, 500)
        } else {
          setMapsStatus('error')
          setMapsDetail('Script failed to load')
        }
      }
      setTimeout(poll, 300)
      return () => { cancelled = true }
    } else {
      const ctrl = new AbortController()
      const timeout = setTimeout(() => ctrl.abort(), 5000)
      fetch('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/3/2/4', { signal: ctrl.signal })
        .then(r => {
          if (!cancelled) {
            setMapsStatus(r.ok ? 'ok' : 'error')
            setMapsDetail(r.ok ? 'Free maps (Esri)' : `HTTP ${r.status}`)
          }
        })
        .catch(() => { if (!cancelled) { setMapsStatus('error'); setMapsDetail('Tile server unreachable') } })
        .finally(() => clearTimeout(timeout))
      return () => { cancelled = true; ctrl.abort() }
    }
  }, [mapsProvider])

  // While backend hasn't responded yet, mirror dataLoaded for the DATA dot
  const effectiveDataStatus: Status = backendStatus === 'checking'
    ? (dataLoaded ? 'ok' : 'checking')
    : dataStatus

  const indicators: Indicator[] = [
    {
      label:  'Frontend',
      status: 'ok',
      detail: 'App loaded',
    },
    {
      label:  'Backend',
      status: backendStatus,
      detail: backendStatus === 'checking' ? 'Checking…' : backendDetail,
    },
    {
      label:  'Data',
      status: effectiveDataStatus,
      detail: effectiveDataStatus === 'checking' ? 'Loading…' : dataDetail,
    },
    {
      label:  'Database',
      status: dbStatus,
      detail: dbStatus === 'checking' ? 'Checking…' : dbDetail,
    },
    {
      label:  'LLM API',
      status: nlpStatus,
      detail: nlpStatus === 'checking' ? 'Checking…' : nlpDetail,
    },
    {
      label:  'Maps',
      status: mapsStatus,
      detail: mapsDetail,
    },
  ]

  return (
    <div style={{
      padding: '6px 16px 8px',
      borderTop: `1px solid ${t.border}`,
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
      flexShrink: 0,
    }}>
      {/* Wraps: six indicators do not fit one line in either layout — the
          desktop sidebar is 440px and a phone is narrower still, so the last
          one or two were being clipped off the right edge. Two short rows is
          better than a truncated one. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', columnGap: 12, rowGap: 4 }}>
        {indicators.map(ind => (
          <div
            key={ind.label}
            title={ind.detail}
            style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'default' }}
          >
            <div style={{
              width: 8, height: 8, borderRadius: '50%',
              background: dotColor(t, ind.status),
              flexShrink: 0,
              boxShadow: ind.status === 'ok' ? `0 0 4px ${t.green}88` : undefined,
            }} />
            <span style={{ fontSize: 11, color: t.textFaint, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>
              {ind.label}
            </span>
          </div>
        ))}
      </div>
      <span
        style={{
          // t.textFaint is already the muted end of the reading hierarchy —
          // stacking a 0.7 opacity on top of it (as this used to) double-dims
          // it below WCAG AA. Build/commit/branch/date is exactly the
          // non-interactive smallprint the 10px floor exists for; it doesn't
          // also need a second dimming step.
          fontSize: 10, color: t.textFaint, letterSpacing: '0.04em',
          fontFamily: 'monospace', cursor: 'default',
          // Branch names are unbounded ("claude/cool-edison-NRUtx"), so this
          // line has to be allowed to wrap or it runs off the edge too.
          overflowWrap: 'anywhere',
        }}
        title={`Build ${__BUILD_NUMBER__}\nCommit ${__BUILD_COMMIT__}${__BUILD_DIRTY__ ? ' (uncommitted changes at build time)' : ''}\nBranch ${__BUILD_BRANCH__}\nBuilt ${__BUILD_DATE__} (local time)`}
      >
        Build <strong style={{ color: t.textMuted }}>{__BUILD_NUMBER__}</strong>
        <span style={{ margin: '0 5px', opacity: 0.4 }}>·</span>
        {__BUILD_COMMIT__}{__BUILD_DIRTY__ && <span style={{ color: t.orange }}>*</span>}
        <span style={{ margin: '0 5px', opacity: 0.4 }}>·</span>
        {__BUILD_BRANCH__}
        <span style={{ margin: '0 5px', opacity: 0.4 }}>·</span>
        {__BUILD_DATE__}
      </span>
    </div>
  )
}
