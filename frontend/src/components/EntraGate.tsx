/**
 * ============================================================================
 * components/EntraGate.tsx — Entra ID sign-in gate (VITE_AUTH_MODE=entra)
 * ============================================================================
 *
 * The Entra ID equivalent of OktaGate — same tree position (see
 * AuthGate.tsx, which picks between all three gates), same "nothing renders
 * until there's a valid session" contract, same "this is real
 * authentication, the backend independently re-verifies every request"
 * caveat (see backend/app/auth/entra.py). The flow differs only in the SDK
 * calls MSAL needs versus okta-auth-js:
 *
 *  1. On mount, initialise MSAL and process handleRedirectPromise() — MSAL's
 *     equivalent of okta-auth-js's handleLoginRedirect(): if this load IS
 *     the browser coming back from Entra's login page, this resolves with
 *     the resulting account and marks it active.
 *  2. Otherwise, check for an existing cached account (a session from
 *     earlier this browser tab).
 *  3. If neither, immediately redirect to Entra ID's own hosted login page —
 *     same reasoning as OktaGate: an internal tool's whole point is that
 *     everyone reaching it already has a corporate Entra account, so the
 *     fastest path is the fewest clicks.
 *  4. Once an account exists (from either 1 or 2), refreshEntraToken() is
 *     awaited before rendering children — see auth/entra.ts's own docstring
 *     on why the access token needs an explicit async fetch here rather
 *     than being ambiently available the way okta-auth-js's is.
 *
 * WHAT "SIGN OUT" MEANS HERE: see EntraAdminBar-equivalent in App.tsx (the
 * shared SsoAdminBar), which calls useAuth().lock() — in entra mode that's
 * msal.logoutRedirect(), a full Entra sign-out, for the identical reason
 * OktaGate's sign-out is a full Okta sign-out: neither mode has an
 * "authenticated but deliberately not admin" state to merely drop back to.
 */
import { useEffect, useState } from 'react'
import { getMsal, refreshEntraToken } from '../auth/entra'
import { GateMessage } from './GateMessage'

/**
 * Local UI state machine for the gate's own render, not exported:
 *  - 'checking'      — initial state, resolving handleRedirectPromise()/cached accounts.
 *  - 'redirecting'   — no session found; loginRedirect() is about to navigate away.
 *  - 'authenticated' — an MSAL account exists and its token has been refreshed; render children.
 *  - 'error'         — something in the flow threw; `error` holds the message.
 */
type Status = 'checking' | 'redirecting' | 'authenticated' | 'error'

/**
 * Whole-app entry gate for VITE_AUTH_MODE=entra. See the file header above
 * for the full 4-step flow (redirect-promise handling, cached-account check,
 * loginRedirect, token refresh).
 *
 * @param children - The rest of the app tree, rendered only once `status`
 *   reaches 'authenticated'.
 * @returns `children` once authenticated; otherwise a <GateMessage> showing
 *   the current step ("Checking your session…", "Redirecting to sign-in…",
 *   or the caught error).
 */
export function EntraGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>('checking')
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    async function run() {
      try {
        const msal = await getMsal()
        const redirectResult = await msal.handleRedirectPromise()
        if (redirectResult?.account) {
          msal.setActiveAccount(redirectResult.account)
        }
        const accounts = msal.getAllAccounts()
        if (accounts.length > 0) {
          if (!msal.getActiveAccount()) msal.setActiveAccount(accounts[0])
          await refreshEntraToken()
          if (!alive) return
          setStatus('authenticated')
          return
        }
        if (!alive) return
        setStatus('redirecting')
        // Remember exactly where we were, restored automatically by MSAL on
        // the way back (it stores the current URL itself, same as
        // okta-auth-js's originalUri option does for OktaGate).
        await msal.loginRedirect({ scopes: ['openid', 'profile', 'email'] })
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
    return <GateMessage title="Sign-in error" body={error || 'Something went wrong starting the Entra ID sign-in flow.'} />
  }
  return (
    <GateMessage
      title={status === 'redirecting' ? 'Redirecting to sign-in…' : 'Checking your session…'}
    />
  )
}
