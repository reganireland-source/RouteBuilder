/**
 * ============================================================================
 * components/PasswordGate.tsx — Client-side splash-screen password gate
 * ============================================================================
 *
 * Full-screen "enter password" splash shown before the app renders. Wrapped
 * around <App/> in main.tsx (outside even the AuthProvider).
 *
 * SECURITY NOTE — this gate is OBFUSCATION ONLY, not real security:
 *  - The expected password (VITE_APP_PASSWORD) is a build-time env var, so
 *    it ships in plain text inside the JS bundle and the comparison happens
 *    entirely in the browser. Anyone can read it from the source or set the
 *    'rb_auth' sessionStorage flag by hand.
 *  - It exists purely to keep casual/unintended visitors off the deployed
 *    demo. It grants NO backend privileges whatsoever.
 *  - Real write-protection is the separate admin mode (context/AuthContext),
 *    which verifies a key against the backend POST /api/auth/verify and
 *    sends it as the x-admin-token header on mutating requests.
 *
 * Behaviour:
 *  - If VITE_APP_PASSWORD is unset, the gate is transparent (open access).
 *  - A correct entry sets sessionStorage 'rb_auth' = 'ok', so the gate stays
 *    open for the rest of the browser-tab session (cleared on tab close).
 *  - Wrong entries trigger a shake animation and inline error message.
 *  - Visuals: animated subsea SVG scene (public/splash-animated.svg) with a
 *    gradient dissolve into a dark login card.
 */

import { useState } from 'react'

// Expected password, baked into the bundle at build time (undefined = gate disabled).
const CORRECT = import.meta.env.VITE_APP_PASSWORD as string | undefined
// sessionStorage flag marking this tab as already unlocked.
const SESSION_KEY = 'rb_auth'

/** Renders children when unlocked; otherwise the full-screen splash + password card. */
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
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      minHeight: '100vh', background: '#0d1830', fontFamily: 'system-ui, sans-serif',
    }}>
      {/* Animated scene — full screen width at natural 3:2 ratio.
          maxHeight caps it on wide desktop screens so the card stays visible
          without scrolling; overflow:hidden clips the ocean-floor title strip. */}
      <div style={{ position: 'relative', width: '100%', maxHeight: '62vh', overflow: 'hidden', flexShrink: 0 }}>
        <img
          src="/splash-animated.svg"
          alt=""
          style={{ display: 'block', width: '100%', height: 'auto' }}
        />
        {/* Gradient dissolve into the page background */}
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, height: 64,
          background: 'linear-gradient(transparent, #0d1830)',
          pointerEvents: 'none',
        }}/>
      </div>

      {/* Login card */}
      <div style={{
        width: 340, maxWidth: 'calc(100vw - 40px)',
        margin: '16px 0 max(4vh, 24px)',
        padding: '36px 32px',
        background: '#1a1a2e',
        border: '1px solid rgba(89, 104, 165, 0.45)',
        borderRadius: 16,
        boxShadow: '0 16px 48px rgba(0,0,0,0.6)',
        animation: shake ? 'shake 0.45s ease' : 'none',
        flexShrink: 0,
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
            background: '#0f0f1e', color: '#cdd6f4',
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
