import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { useTheme } from '../theme'

type Status = 'checking' | 'ok' | 'error' | 'disabled'

interface Indicator {
  label: string
  status: Status
  detail?: string
}

const DOT_COLOR: Record<Status, string> = {
  ok:       '#a6e3a1',
  error:    '#f38ba8',
  checking: '#f9e2af',
  disabled: '#6c7086',
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
      fetch('https://a.basemaps.cartocdn.com/dark_all/3/4/3.png', { signal: ctrl.signal })
        .then(r => {
          if (!cancelled) {
            setMapsStatus(r.ok ? 'ok' : 'error')
            setMapsDetail(r.ok ? 'OpenStreetMap' : `HTTP ${r.status}`)
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
      <div style={{ display: 'flex', gap: 14 }}>
        {indicators.map(ind => (
          <div
            key={ind.label}
            title={ind.detail}
            style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'default' }}
          >
            <div style={{
              width: 8, height: 8, borderRadius: '50%',
              background: DOT_COLOR[ind.status],
              flexShrink: 0,
              boxShadow: ind.status === 'ok' ? `0 0 4px ${DOT_COLOR.ok}88` : undefined,
            }} />
            <span style={{ fontSize: 10, color: t.textFaint, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>
              {ind.label}
            </span>
          </div>
        ))}
      </div>
      <span style={{ fontSize: 10, color: t.textFaint, letterSpacing: '0.04em', opacity: 0.7 }}>
        Build <strong style={{ color: t.textMuted }}>{__BUILD_NUMBER__}</strong>
        <span style={{ margin: '0 5px', opacity: 0.4 }}>·</span>
        {__BUILD_DATE__}
      </span>
    </div>
  )
}
