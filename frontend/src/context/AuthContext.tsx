/**
 * ============================================================================
 * context/AuthContext.tsx — Admin-mode authentication state
 * ============================================================================
 *
 * RouteBuilder has TWO independent "locks", and it is important not to
 * confuse them:
 *
 *  1. The whole-app entry gate (components/AuthGate.tsx) — PasswordGate's
 *     client-side-only page password (OBFUSCATION ONLY — see its own
 *     docstring) in admin_key mode, or a real Okta sign-in (OktaGate) in
 *     okta mode. Wrapped around <App/> in main.tsx, outside even THIS
 *     provider.
 *
 *  2. Admin mode (THIS file) — real authorisation, in both modes:
 *       admin_key — the user enters an admin key, verified AGAINST THE
 *       BACKEND via POST /api/auth/verify (compared to ADMIN_KEY). Only on
 *       success is the key kept and handed to api/client.ts
 *       (setAdminToken), sent as `X-Admin-Token` on every mutating request.
 *       okta — there is no separate "unlock" step: OktaGate already
 *       required a valid Okta session before App ever mounted. Whether
 *       THAT session also grants admin is decided by Okta group membership
 *       (see auth/okta.ts's currentUserIsOktaAdmin, mirroring the backend's
 *       OKTA_ADMIN_GROUP check in backend/app/auth/okta.py) and re-checked
 *       on every request server-side — what's read here is a UI hint only.
 *     Either way, the backend re-checks its own copy of the credential on
 *     each write endpoint, so a forged client cannot mutate data by lying
 *     about isAdmin.
 *
 * Consumers use the `useAuth()` hook: { isAdmin, authRequired, mode,
 * userLabel, unlock, lock }. UI components use `isAdmin` to show/hide edit
 * affordances (e.g. RefDataModal editing, project deletion) and `mode` /
 * `userLabel` to render mode-appropriate chrome (AdminBar in App.tsx) — but
 * the actual enforcement is always server-side.
 *
 * Mounted once in main.tsx as <AuthProvider> wrapping the whole app —
 * OUTSIDE AuthGate, so it is present even while that gate is still deciding
 * whether to render children at all.
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { setAdminToken as setClientToken, clearAdminToken as clearClientToken, setOktaAccessTokenSource } from '../api/client'
import { OKTA_MODE, currentOktaAccessToken, currentOktaUser, currentUserIsOktaAdmin, getOktaAuth } from '../auth/okta'

// Same backend base URL logic as api/client.ts (empty string = same-origin dev proxy).
const BASE_URL = import.meta.env.VITE_API_URL ?? ''

/** Shape of the context value returned by useAuth(). Identical across both
 *  auth modes, so every existing consumer keeps working unchanged. */
interface AuthCtx {
  /** True when the user may see admin UI (admin_key: unlocked, or no
   *  ADMIN_KEY set; okta: their Okta groups include OKTA_ADMIN_GROUP). */
  isAdmin: boolean
  /** True when SOME credential is required to reach admin (admin_key: an
   *  ADMIN_KEY is configured; okta: always true — there is no open mode). */
  authRequired: boolean
  /** Which auth model this build is running, so components can render
   *  mode-appropriate UI (AdminBar) without reading env vars themselves. */
  mode: 'admin_key' | 'okta'
  /** okta mode only: the signed-in user's email/name, or null. Always null
   *  in admin_key mode — there is no individual identity to show. */
  userLabel: string | null
  /** admin_key mode: try a candidate admin key against POST /api/auth/verify.
   *  okta mode: always a no-op returning false — see OktaAuthProvider. */
  unlock: (key: string) => Promise<boolean>
  /** admin_key mode: leave admin mode, clearing the token everywhere.
   *  okta mode: a full Okta sign-out (there is no "authenticated but not
   *  admin" state to merely drop back to — see OktaAuthProvider). */
  lock: () => void
}

// Default value only used if useAuth() is called outside the provider —
// deliberately permissive (isAdmin: true) to match open/dev mode.
const AuthContext = createContext<AuthCtx>({
  isAdmin: true,
  authRequired: false,
  mode: 'admin_key',
  userLabel: null,
  unlock: async () => false,
  lock: () => {},
})

/** admin_key mode's provider — unchanged behaviour from before AUTH_MODE
 *  existed at all. */
function AdminKeyAuthProvider({ children }: { children: ReactNode }) {
  const [authRequired, setAuthRequired] = useState(false)
  // Lazy initialiser: restore a token persisted by a previous unlock in this
  // tab, and immediately re-arm the api client with it so writes work after
  // a refresh without re-entering the key.
  const [adminToken, setAdminToken] = useState<string>(() => {
    const stored = sessionStorage.getItem('rb_admin_token') ?? ''
    if (stored) setClientToken(stored)
    return stored
  })

  // Ask the backend once whether admin auth is enforced at all.
  // Errors are swallowed: if the backend is unreachable we default to
  // authRequired=false (open mode) rather than blocking the UI.
  useEffect(() => {
    fetch(`${BASE_URL}/api/auth/status`)
      .then(r => r.json())
      .then(d => setAuthRequired(Boolean(d.auth_required)))
      .catch(() => {})
  }, [])

  // Verify a candidate key server-side. Only a 2xx from /api/auth/verify
  // makes us store the key (state + api client + sessionStorage); a wrong
  // key or a network failure returns false and stores nothing.
  const unlock = async (key: string): Promise<boolean> => {
    try {
      const res = await fetch(`${BASE_URL}/api/auth/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': key },
        body: '{}',
      })
      if (res.ok) {
        setAdminToken(key)
        setClientToken(key)
        sessionStorage.setItem('rb_admin_token', key)
        return true
      }
    } catch { /* network error */ }
    return false
  }

  // Drop admin mode everywhere the token is held.
  const lock = () => {
    setAdminToken('')
    clearClientToken()
    sessionStorage.removeItem('rb_admin_token')
  }

  // When ADMIN_KEY is not set on the backend, everyone is admin (open/dev mode)
  const isAdmin = !authRequired || Boolean(adminToken)

  return (
    <AuthContext.Provider value={{ isAdmin, authRequired, mode: 'admin_key', userLabel: null, unlock, lock }}>
      {children}
    </AuthContext.Provider>
  )
}

/** okta mode's provider. By the time this ever mounts, OktaGate has already
 *  guaranteed a valid Okta session exists — this only has to read WHO that
 *  session belongs to and whether they're in the admin group, and keep
 *  api/client.ts supplied with a fresh access token for every request. */
function OktaAuthProvider({ children }: { children: ReactNode }) {
  const [isAdmin, setIsAdmin] = useState(false)
  const [userLabel, setUserLabel] = useState<string | null>(null)

  useEffect(() => {
    // Registered once: api/client.ts calls this function fresh on every
    // request rather than being pushed a token, so it always sees whatever
    // okta-auth-js's background renewal most recently stored.
    setOktaAccessTokenSource(currentOktaAccessToken)

    function refresh() {
      setIsAdmin(currentUserIsOktaAdmin())
      const claims = currentOktaUser()
      const email = claims?.email as string | undefined
      const name = claims?.name as string | undefined
      setUserLabel(email ?? name ?? null)
    }
    refresh()

    // okta-auth-js emits an auth-state event on login, on a successful
    // background token renewal, and on expiration — subscribing keeps
    // isAdmin/userLabel correct through all of those without the user
    // doing anything (e.g. a group membership change taking effect on the
    // next silent renewal, not only on the next full page load).
    const oktaAuth = getOktaAuth()
    oktaAuth.authStateManager.subscribe(refresh)
    return () => oktaAuth.authStateManager.unsubscribe(refresh)
  }, [])

  // No passphrase to enter in okta mode — kept as a no-op (rather than
  // removed from AuthCtx) so every existing consumer keeps compiling and
  // running unchanged; AdminBar in App.tsx simply never shows the "Unlock"
  // control when mode === 'okta'.
  const unlock = async () => false

  // A full Okta sign-out (redirects away and back), not merely dropping to
  // read-only: okta mode has no "authenticated but deliberately not admin"
  // state to fall back to — isAdmin is decided entirely by Okta group
  // membership, not by anything this app lets you toggle.
  const lock = () => {
    void getOktaAuth().signOut()
  }

  return (
    <AuthContext.Provider value={{ isAdmin, authRequired: true, mode: 'okta', userLabel, unlock, lock }}>
      {children}
    </AuthContext.Provider>
  )
}

/** Provider wrapping the whole app (see main.tsx). Picks the admin_key or
 *  okta implementation ONCE — OKTA_MODE is a build-time constant (baked in
 *  from VITE_AUTH_MODE), so this choice can never change during the app's
 *  lifetime, which is what makes branching between two different provider
 *  components here safe despite each calling its own hooks. */
export function AuthProvider({ children }: { children: ReactNode }) {
  return OKTA_MODE
    ? <OktaAuthProvider>{children}</OktaAuthProvider>
    : <AdminKeyAuthProvider>{children}</AdminKeyAuthProvider>
}

/** Hook giving any component access to { isAdmin, authRequired, mode, userLabel, unlock, lock }. */
export const useAuth = () => useContext(AuthContext)
