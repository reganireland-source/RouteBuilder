/**
 * ============================================================================
 * components/OktaGate.tsx — Okta sign-in gate (VITE_AUTH_MODE=okta)
 * ============================================================================
 *
 * The Okta-mode equivalent of PasswordGate: sits in the exact same tree
 * position (see AuthGate.tsx, which picks between the two), wrapping <App/>
 * from outside even AuthProvider. Nothing renders — not the map, not a
 * route search, nothing — until the visitor has a valid Okta session. This
 * is REAL authentication, unlike PasswordGate's client-side obfuscation:
 * every subsequent API call carries the resulting access token, and the
 * backend independently verifies it on every request (see
 * backend/app/auth/okta.py) — nothing here is trusted on its own.
 *
 * FLOW:
 *  1. On mount, check whether this load IS the redirect back from Okta (the
 *     URL carries ?code=...&state=...) and if so, exchange it for tokens.
 *     handleLoginRedirect() also restores the URL the visitor was on before
 *     being sent to Okta, so a deep link or an in-progress search survives
 *     the round trip.
 *  2. Otherwise, check for an existing valid session (a token already in
 *     storage from earlier this browser).
 *  3. If neither, immediately redirect the browser to Okta's own hosted
 *     login page. There is no "click here to sign in" screen for the
 *     common case — an internal tool's whole point is that everyone
 *     reaching it already has a corporate Okta account, so the fastest
 *     path is the fewest clicks. A brief message covers the redirect's own
 *     latency.
 *
 * WHAT "SIGN OUT" MEANS HERE: see AdminBar in App.tsx, which calls
 * useAuth().lock() — in okta mode that's a full Okta sign-out (redirects
 * away and back), not merely dropping back to read-only, because okta mode
 * has no "authenticated but deliberately not admin" state to drop back TO.
 */
import { useEffect, useState } from 'react'
import { getOktaAuth } from '../auth/okta'
import { GateMessage } from './GateMessage'

type Status = 'checking' | 'redirecting' | 'authenticated' | 'error'

export function OktaGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>('checking')
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    async function run() {
      try {
        const oktaAuth = getOktaAuth()
        if (oktaAuth.isLoginRedirect()) {
          await oktaAuth.handleLoginRedirect()
        }
        const authenticated = await oktaAuth.isAuthenticated()
        if (!alive) return
        if (authenticated) {
          setStatus('authenticated')
          return
        }
        setStatus('redirecting')
        // Remember exactly where we were, restored by handleLoginRedirect()
        // above on the way back — okta-auth-js stores this itself via the
        // options passed to signInWithRedirect().
        await oktaAuth.signInWithRedirect({ originalUri: window.location.href })
      } catch (e) {
        if (!alive) return
        setError(e instanceof Error ? e.message : String(e))
        setStatus('error')
      }
    }
    void run()
    return () => { alive = false }
  }, [])

  if (status === 'authenticated') return <>{children}</>
  if (status === 'error') {
    return <GateMessage title="Sign-in error" body={error || 'Something went wrong starting the Okta sign-in flow.'} />
  }
  return (
    <GateMessage
      title={status === 'redirecting' ? 'Redirecting to sign-in…' : 'Checking your session…'}
    />
  )
}
