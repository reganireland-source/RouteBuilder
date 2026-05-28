import { useState } from 'react'

const CORRECT = import.meta.env.VITE_APP_PASSWORD as string | undefined
const SESSION_KEY = 'rb_auth'

export function PasswordGate({ children }: { children: React.ReactNode }) {
  const [authed, setAuthed] = useState(() => {
    if (!CORRECT) return true // no password set → open access
    return sessionStorage.getItem(SESSION_KEY) === 'ok'
  })
  const [value, setValue] = useState('')
  const [shake, setShake] = useState(false)
  const [wrong, setWrong] = useState(false)

  if (authed) return <>{children}</>

  function attempt() {
    if (value === CORRECT) {
      sessionStorage.setItem(SESSION_KEY, 'ok')
      setAuthed(true)
    } else {
      setWrong(true)
      setShake(true)
      setValue('')
      setTimeout(() => setShake(false), 500)
    }
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '100vh', background: '#1e1e2e', fontFamily: 'system-ui, sans-serif',
    }}>
      <div style={{
        width: 340, padding: '36px 32px',
        background: '#2a2a3d', border: '1px solid #45475a',
        borderRadius: 16, boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
        animation: shake ? 'shake 0.45s ease' : 'none',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <img src="/favicon.svg" alt="" style={{ width: 28, height: 28 }} />
          <span style={{ fontSize: 18, fontWeight: 700, color: '#cdd6f4' }}>RouteBuilder</span>
        </div>
        <p style={{ fontSize: 12, color: '#7f849c', marginBottom: 24 }}>
          International Telco · Subsea Circuit Design
        </p>

        <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#a6adc8', marginBottom: 6, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          Password
        </label>
        <input
          type="password"
          value={value}
          autoFocus
          onChange={e => { setValue(e.target.value); setWrong(false) }}
          onKeyDown={e => { if (e.key === 'Enter') attempt() }}
          placeholder="Enter access password"
          style={{
            width: '100%', padding: '10px 12px', borderRadius: 8,
            border: `1px solid ${wrong ? '#f38ba8' : '#45475a'}`,
            background: '#1e1e2e', color: '#cdd6f4',
            fontSize: 14, outline: 'none',
            boxSizing: 'border-box',
            transition: 'border-color 0.15s',
          }}
        />
        {wrong && (
          <p style={{ fontSize: 11, color: '#f38ba8', marginTop: 6 }}>Incorrect password.</p>
        )}

        <button
          onClick={attempt}
          style={{
            marginTop: 18, width: '100%', padding: '11px 0',
            borderRadius: 8, border: 'none',
            background: '#89b4fa', color: '#1e1e2e',
            fontSize: 14, fontWeight: 700, cursor: 'pointer',
            transition: 'opacity 0.15s',
          }}
          onMouseOver={e => (e.currentTarget.style.opacity = '0.85')}
          onMouseOut={e => (e.currentTarget.style.opacity = '1')}
        >
          Enter
        </button>
      </div>

      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          20%       { transform: translateX(-8px); }
          40%       { transform: translateX(8px); }
          60%       { transform: translateX(-5px); }
          80%       { transform: translateX(5px); }
        }
      `}</style>
    </div>
  )
}
