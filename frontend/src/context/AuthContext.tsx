/**
 * ============================================================================
 * context/AuthContext.tsx — Admin-mode authentication state
 * ============================================================================
 *
 * RouteBuilder has TWO independent "locks", and it is important not to
 * confuse them:
 *
 *  1. PasswordGate (components/PasswordGate.tsx) — a client-side-only page
 *     password compared against a value baked into the JS bundle. It is
 *     OBFUSCATION ONLY (keeps casual visitors out); it provides no real
 *     security and grants no backend privileges.
 *
 *  2. Admin mode (THIS file) — real authorisation. The user enters an admin
 *     key which is verified AGAINST THE BACKEND via POST /api/auth/verify
 *     (the backend compares it to its ADMIN_KEY env var). Only on success is
 *     the key kept and handed to api/client.ts (setAdminToken), which then
 *     sends it as the `X-Admin-Token` header on every mutating request. The
 *     backend re-checks that header on each write endpoint, so a forged
 *     client cannot mutate data without the key.
 *
 * Behaviour details:
 *  - On mount it asks GET /api/auth/status whether the backend has an
 *    ADMIN_KEY configured at all. If not (open/dev mode), `authRequired` is
 *    false and EVERYONE is treated as admin (isAdmin = true).
 *  - The verified token is mirrored into sessionStorage ('rb_admin_token')
 *    so admin mode survives a refresh in the same tab, and restored into the
 *    api client on load. `lock()` clears all copies.
 *  - Consumers use the `useAuth()` hook: { isAdmin, authRequired, unlock, lock }.
 *    UI components use `isAdmin` to show/hide edit affordances (e.g.
 *    RefDataModal editing, project deletion) — but the actual enforcement is
 *    server-side via the header.
 *
 * Mounted once in main.tsx as <AuthProvider> wrapping the whole app.
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { setAdminToken as setClientToken, clearAdminToken as clearClientToken } from '../api/client'

// Same backend base URL logic as api/client.ts (empty string = same-origin dev proxy).
const BASE_URL = import.meta.env.VITE_API_URL ?? ''

/** Shape of the context value returned by useAuth(). */
interface AuthCtx {
  /** True when the user may see admin UI (either unlocked, or backend has no ADMIN_KEY set). */
  isAdmin: boolean
  /** True when the backend has an ADMIN_KEY configured, i.e. unlocking is actually needed. */
  authRequired: boolean
  /** Try a candidate admin key against POST /api/auth/verify; returns success. */
  unlock: (key: string) => Promise<boolean>
  /** Leave admin mode: clears the token from state, the api client and sessionStorage. */
  lock: () => void
}

// Default value only used if useAuth() is called outside the provider —
// deliberately permissive (isAdmin: true) to match open/dev mode.
const AuthContext = createContext<AuthCtx>({
  isAdmin: true,
  authRequired: false,
  unlock: async () => false,
  lock: () => {},
})

/** Provider wrapping the whole app (see main.tsx). Owns the admin token lifecycle. */
export function AuthProvider({ children }: { children: ReactNode }) {
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
    <AuthContext.Provider value={{ isAdmin, authRequired, unlock, lock }}>
      {children}
    </AuthContext.Provider>
  )
}

/** Hook giving any component access to { isAdmin, authRequired, unlock, lock }. */
export const useAuth = () => useContext(AuthContext)
