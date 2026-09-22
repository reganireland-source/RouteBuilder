/**
 * auth/entra.ts — thin wrapper around @azure/msal-browser.
 *
 * Everything Entra ID-specific in the frontend goes through this one file:
 * building the PublicClientApplication from VITE_ENTRA_* env vars, and
 * reading the signed-in account's claims for the UI-only admin/role check
 * (the REAL authorization decision is made server-side, in
 * backend/app/auth/entra.py — see that module's own docstring on why;
 * nothing read here is ever trusted on its own). Structurally this mirrors
 * auth/okta.ts closely on purpose — same singleton reasoning, same
 * sessionStorage hardening, same "UI hint only" caveat — but the two SDKs
 * differ enough that nothing below is shared code with it.
 *
 * WHY A SINGLETON. Same as okta-auth-js: MSAL's PublicClientApplication owns
 * the token cache — constructing a second one would start tracking a
 * separate in-memory state over the same sessionStorage keys. getMsal()
 * builds exactly one, lazily, the first time anything asks for it (in
 * practice EntraGate, on mount).
 *
 * WHY LAZY, NOT EAGER AT MODULE LOAD. Same reasoning as okta.ts: this module
 * is only ever imported from files reached when VITE_AUTH_MODE=entra
 * (EntraGate, AuthContext's entra branch) — an admin_key or okta-mode
 * build's bundle still contains this code (Vite can't prove the env var's
 * value is fixed across every possible deploy of the SAME build), but never
 * constructs a PublicClientApplication, so a deploy that never set
 * VITE_ENTRA_TENANT_ID/VITE_ENTRA_CLIENT_ID at all never throws on load —
 * only if and when something actually tries to use Entra.
 *
 * WHY getEntraAccessToken() IS SYNC BUT MSAL'S OWN TOKEN CALLS ARE NOT.
 * api/client.ts's token-source contract (setOidcAccessTokenSource) is a
 * plain synchronous `() => string | null`, because okta-auth-js's
 * getAccessToken() is itself synchronous (it reads an in-memory cache
 * okta-auth-js keeps current via its own background renewal timer). MSAL
 * has no equivalent background timer — acquiring or refreshing a token is
 * always async (acquireTokenSilent may itself make a network call). This
 * module bridges that gap with its OWN small cache: refreshEntraToken()
 * (called by EntraAuthProvider on login and on a periodic interval, well
 * inside a typical access token's lifetime) does the async acquisition and
 * stores the result; currentEntraAccessToken() just reads that cache
 * synchronously. The consequence worth knowing: a token can be up to one
 * refresh interval stale from this cache's point of view, though MSAL's own
 * internal cache (which acquireTokenSilent reads first) is still exactly as
 * fresh as it would be in any other MSAL integration.
 */
import {
  PublicClientApplication,
  type AccountInfo,
  type Configuration,
} from '@azure/msal-browser'
import { AUTH_MODE } from './mode'

/** True when this build is running in Entra ID mode. */
export const ENTRA_MODE = AUTH_MODE === 'entra'

/** The Entra App Role whose holders get admin/write access — mirrors the
 *  backend's ENTRA_ADMIN_ROLE. Used only to decide which UI to SHOW (the
 *  edit affordances); the backend re-checks this from the verified token on
 *  every write regardless of what the frontend thinks. */
export const ENTRA_ADMIN_ROLE = (import.meta.env.VITE_ENTRA_ADMIN_ROLE as string | undefined) ?? ''

let _msal: PublicClientApplication | null = null
let _initPromise: Promise<void> | null = null
let _cachedAccessToken: string | null = null

function requiredEnv(): { tenantId: string; clientId: string } {
  const tenantId = (import.meta.env.VITE_ENTRA_TENANT_ID as string | undefined) ?? ''
  const clientId = (import.meta.env.VITE_ENTRA_CLIENT_ID as string | undefined) ?? ''
  if (!tenantId || !clientId) {
    throw new Error(
      'VITE_AUTH_MODE=entra but VITE_ENTRA_TENANT_ID / VITE_ENTRA_CLIENT_ID are not set. ' +
      'See docs/entra-setup.md.'
    )
  }
  return { tenantId, clientId }
}

/** The access-token scope to request. Defaults to the conventional shape
 *  for a SPA calling its own custom API ("Expose an API" → a scope named
 *  access_as_user, granted to this app's own client id) — override with
 *  VITE_ENTRA_SCOPE only if your org named the exposed scope differently. */
function scope(): string {
  const { clientId } = requiredEnv()
  return (import.meta.env.VITE_ENTRA_SCOPE as string | undefined) || `api://${clientId}/access_as_user`
}

/** Build (once) and initialise the shared PublicClientApplication. MSAL
 *  requires the async initialize() call to complete before anything else
 *  touches the instance — callers await this rather than constructing
 *  PublicClientApplication directly. */
export async function getMsal(): Promise<PublicClientApplication> {
  if (_msal) {
    if (_initPromise) await _initPromise
    return _msal
  }
  const { tenantId, clientId } = requiredEnv()
  const config: Configuration = {
    auth: {
      clientId,
      authority: `https://login.microsoftonline.com/${tenantId}`,
      // Back to wherever this tab currently is, not a fixed path — same
      // reasoning as okta.ts's redirectUri: an SPA with no router, where
      // "the page you were on" IS the whole state.
      redirectUri: `${window.location.origin}/callback`,
    },
    cache: {
      // Same hardening as okta.ts's storageManager override, and the same
      // caveat: not an XSS defence (both storages are equally JS-readable),
      // just bounds a stolen token's usable window to the tab's lifetime.
      cacheLocation: 'sessionStorage',
    },
  }
  _msal = new PublicClientApplication(config)
  _initPromise = _msal.initialize()
  await _initPromise
  return _msal
}

/** The signed-in account, or null before a session exists / before getMsal()
 *  has ever been awaited. Prefers the account MSAL has marked active; falls
 *  back to the first cached account (the common case: exactly one). */
export async function currentEntraAccount(): Promise<AccountInfo | null> {
  const msal = await getMsal()
  return msal.getActiveAccount() ?? msal.getAllAccounts()[0] ?? null
}

/** Re-acquire an access token for the configured scope and cache it for
 *  currentEntraAccessToken() to read synchronously — see this module's own
 *  docstring on why that split exists. Called by EntraAuthProvider on login
 *  and on a periodic interval; a failure (e.g. the session genuinely expired
 *  and needs an interactive prompt) just leaves the cache as it was, which
 *  reads as "no token" once it's stale enough for the backend to reject —
 *  the safe direction to fail, matching every other credential path in this
 *  app failing closed rather than open. */
export async function refreshEntraToken(): Promise<void> {
  try {
    const msal = await getMsal()
    const account = await currentEntraAccount()
    if (!account) {
      _cachedAccessToken = null
      return
    }
    const result = await msal.acquireTokenSilent({ scopes: [scope()], account })
    _cachedAccessToken = result.accessToken
  } catch {
    _cachedAccessToken = null
  }
}

/** The cached access token JWT, or null — registered with api/client.ts via
 *  setOidcAccessTokenSource() so every request can read the most recently
 *  refreshed one. */
export function currentEntraAccessToken(): string | null {
  return _cachedAccessToken
}

/** True when the signed-in account's ID token `roles` claim (Entra App
 *  Roles — populated automatically once your IT assigns the role, no extra
 *  manifest step the way Okta's groups claim needs) contains
 *  ENTRA_ADMIN_ROLE. False whenever anything is missing or unavailable — a
 *  UI hint defaults to "hide the admin controls", never to "show them and
 *  let the backend sort it out". */
export function currentUserIsEntraAdmin(account: AccountInfo | null): boolean {
  if (!ENTRA_ADMIN_ROLE || !account) return false
  const roles = (account.idTokenClaims?.roles as string[] | undefined) ?? []
  return roles.includes(ENTRA_ADMIN_ROLE)
}

/** A display label for the signed-in account (email/name), or null. UI-only,
 *  same caveat as ENTRA_ADMIN_ROLE above. */
export function currentEntraUserLabel(account: AccountInfo | null): string | null {
  if (!account) return null
  return account.username || account.name || null
}
