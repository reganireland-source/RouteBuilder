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
}

export function HealthBar({ dataLoaded }: Props) {
  const t = useTheme()
  const [backendStatus, setBackendStatus] = useState<Status>('checking')
  const [backendDetail, setBackendDetail] = useState<string>('')
  const [dataDetail,    setDataDetail]    = useState<string>('Loading…')
  const [dataStatus,    setDataStatus]    = useState<Status>('checking')
  const [nlpStatus,     setNlpStatus]     = useState<Status>('checking')
  const [nlpDetail,     setNlpDetail]     = useState<string>('')

  async function checkBackend() {
    setBackendStatus('checking')
    try {
      const h = await api.getHealth()
      setBackendStatus('ok')
      setBackendDetail(`${h.nodes} nodes · ${h.segments} segs · ${h.systems} systems`)
      const storage = (h as unknown as Record<string, string>).storage ?? 'json'
      setDataStatus('ok')
      setDataDetail(storage === 'postgres' ? 'PostgreSQL' : 'JSON files')
    } catch {
      setBackendStatus('error')
      setBackendDetail('Unreachable')
      setDataStatus('error')
      setDataDetail('Unavailable')
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
      label:  'LLM API',
      status: nlpStatus,
      detail: nlpStatus === 'checking' ? 'Checking…' : nlpDetail,
    },
  ]

  return (
    <div style={{
      padding: '8px 16px',
      borderTop: `1px solid ${t.border}`,
      display: 'flex',
      gap: 14,
      flexShrink: 0,
    }}>
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
          <span style={{ fontSize: 10, color: t.textFaint, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {ind.label}
          </span>
        </div>
      ))}
    </div>
  )
}
