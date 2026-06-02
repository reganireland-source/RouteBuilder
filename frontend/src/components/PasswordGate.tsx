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
      position: 'relative',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      paddingBottom: 'max(5vh, 32px)',
      height: '100vh', fontFamily: 'system-ui, sans-serif',
      overflow: 'hidden', background: '#0d1830',
      boxSizing: 'border-box',
    }}>
      {/* Animated pixel art splash — fills viewport, scene visible above card */}
      <img
        src="/splash-animated.svg"
        alt=""
        style={{
          position: 'absolute', inset: 0,
          width: '100%', height: '100%',
          objectFit: 'cover', objectPosition: 'center top',
        }}
      />
      {/* Very light veil — just enough for text legibility */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'rgba(6, 8, 18, 0.22)',
      }}/>

      {/* Login card — frosted glass over the scene */}
      <div style={{
        position: 'relative', zIndex: 1,
        width: 340, maxWidth: 'calc(100vw - 40px)',
        padding: '36px 32px',
        background: 'rgba(20, 22, 42, 0.90)',
        backdropFilter: 'blur(18px)',
        WebkitBackdropFilter: 'blur(18px)',
        border: '1px solid rgba(89, 104, 165, 0.4)',
        borderRadius: 16,
        boxShadow: '0 20px 60px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.06)',
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
            background: 'rgba(14, 15, 30, 0.8)', color: '#cdd6f4',
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
