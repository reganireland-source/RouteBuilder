/**
 * auth/okta.ts — thin wrapper around @okta/okta-auth-js.
 *
 * Everything Okta-specific in the frontend goes through this one file:
 * building the OktaAuth client from VITE_OKTA_* env vars, and reading the
 * current access token's claims for the UI-only admin/group check (the REAL
 * authorization decision is made server-side, in backend/app/auth/okta.py —
 * see that module's own docstring on why; nothing read here is ever trusted
 * on its own).
 *
 * WHY A SINGLETON. okta-auth-js's OktaAuth instance owns the token storage
 * and the background renewal timer — constructing a second one would start
 * a second renewal timer and could race the first over the same
 * localStorage keys. getOktaAuth() builds exactly one, lazily, the first
 * time anything asks for it (which in practice is OktaGate, on mount).
 *
 * WHY LAZY, NOT EAGER AT MODULE LOAD. This module is only ever imported
 * from files that are themselves only reached when VITE_AUTH_MODE=okta
 * (OktaGate, AuthContext's okta branch) — an admin_key-mode build's bundle
 * still contains this code (Vite doesn't know the env var's value is fixed
 * across every possible deploy of the SAME build), but never executes
 * `new OktaAuth(...)`, so a deploy that has not set VITE_OKTA_ISSUER/
 * VITE_OKTA_CLIENT_ID at all never throws on load — only if and when
 * something actually tries to use Okta.
 */
import { OktaAuth } from '@okta/okta-auth-js'

/** True when this build is running in Okta mode. Read once at module load —
 *  VITE_* vars are baked in at BUILD time, not runtime, so this can never
 *  change during the life of a loaded page. */
export const OKTA_MODE = (import.meta.env.VITE_AUTH_MODE as string | undefined) === 'okta'

/** The Okta group whose members get admin/write access — mirrors the
 *  backend's OKTA_ADMIN_GROUP. Used only to decide which UI to SHOW (the
 *  edit affordances); the backend re-checks this from the verified token on
 *  every write regardless of what the frontend thinks. */
export const OKTA_ADMIN_GROUP = (import.meta.env.VITE_OKTA_ADMIN_GROUP as string | undefined) ?? ''

let _oktaAuth: OktaAuth | null = null

/** Build (once) or return the shared OktaAuth client. Throws if
 *  VITE_OKTA_ISSUER/VITE_OKTA_CLIENT_ID are missing — callers (OktaGate)
 *  catch this and show a "not configured" screen rather than a blank one. */
export function getOktaAuth(): OktaAuth {
  if (_oktaAuth) return _oktaAuth
  const issuer = import.meta.env.VITE_OKTA_ISSUER as string | undefined
  const clientId = import.meta.env.VITE_OKTA_CLIENT_ID as string | undefined
  if (!issuer || !clientId) {
    throw new Error(
      'VITE_AUTH_MODE=okta but VITE_OKTA_ISSUER / VITE_OKTA_CLIENT_ID are not set. ' +
      'See docs/okta-setup.md.'
    )
  }
  _oktaAuth = new OktaAuth({
    issuer,
    clientId,
    // Back to wherever this tab currently is, not a fixed path — an SPA
    // with no router, where "the page you were on" IS the whole state
    // (which mode, which search, etc.), so redirecting to some other point
    // would silently discard it.
    redirectUri: `${window.location.origin}/callback`,
    scopes: ['openid', 'profile', 'email'],
    pkce: true,
    // Tokens in sessionStorage only, not the SDK's own default preference
    // order (localStorage first). Both are equally readable by any script
    // running on the page — this is not an XSS defence — but sessionStorage
    // clears when the tab closes instead of persisting indefinitely, which
    // shrinks how long a token would remain usable if it WAS ever
    // exfiltrated, and matches this being an internal tool where "sign in
    // again in a new tab" costs nothing. A true XSS-proof story (tokens
    // never reachable from JS at all) needs httpOnly cookies from a
    // same-origin backend-for-frontend, which is a bigger architectural
    // change than this app's separate SPA + API split supports today.
    storageManager: { token: { storageTypes: ['sessionStorage'] } },
  })
  return _oktaAuth
}

/** The signed-in user's claims from their ID token (email, name, ...), or
 *  null before a session exists. UI-only, same caveat as OKTA_ADMIN_GROUP
 *  above. */
export function currentOktaUser(): Record<string, unknown> | null {
  try {
    return getOktaAuth().getIdToken() ? (getOktaAuth().tokenManager.getTokensSync().idToken?.claims ?? null) : null
  } catch {
    return null
  }
}

/** True when the current access token's `groups` claim contains
 *  OKTA_ADMIN_GROUP. False (not thrown) whenever anything is missing or
 *  unavailable — a UI hint defaults to "hide the admin controls", never to
 *  "show them and let the backend sort it out". */
export function currentUserIsOktaAdmin(): boolean {
  if (!OKTA_ADMIN_GROUP) return false
  try {
    const claims = getOktaAuth().tokenManager.getTokensSync().accessToken?.claims
    const groups = (claims?.groups as string[] | undefined) ?? []
    return groups.includes(OKTA_ADMIN_GROUP)
  } catch {
    return false
  }
}

/** The raw access token JWT, or null — registered with api/client.ts via
 *  setOktaAccessTokenSource() so every request can read a fresh one. */
export function currentOktaAccessToken(): string | null {
  try {
    return getOktaAuth().getAccessToken() ?? null
  } catch {
    return null
  }
}
