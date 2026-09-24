/**
 * components/AuthGate.tsx — picks the whole-app entry gate by VITE_AUTH_MODE.
 *
 * The ONE place this decision is made. main.tsx mounts <AuthGate> instead of
 * choosing between PasswordGate/OktaGate/EntraGate itself, so switching an
 * organisation onto Okta or Entra ID is a single env var (VITE_AUTH_MODE) at
 * build time with zero changes to main.tsx or to any gate. See
 * docs/okta-setup.md / docs/entra-setup.md.
 *
 * OktaGate/EntraGate are lazy-loaded, not imported at module top level, so
 * that an org running AUTH_MODE=admin_key (or the other SSO provider) never
 * bundles the unused one's SDK (@azure/msal-browser for Entra) and so that
 * enterprise IT can delete OktaGate.tsx/EntraGate.tsx + their backend
 * counterparts (auth/okta.py, auth/entra.py — already conditionally imported
 * in main.py, see its own comment) for a provider they will never run,
 * without touching this file.
 */
import { lazy, Suspense } from 'react'
import { AUTH_MODE } from '../auth/mode'
import { PasswordGate } from './PasswordGate'

const OktaGate = lazy(() => import('./OktaGate').then(m => ({ default: m.OktaGate })))
const EntraGate = lazy(() => import('./EntraGate').then(m => ({ default: m.EntraGate })))

export function AuthGate({ children }: { children: React.ReactNode }) {
  if (AUTH_MODE === 'okta') {
    return <Suspense fallback={null}><OktaGate>{children}</OktaGate></Suspense>
  }
  if (AUTH_MODE === 'entra') {
    return <Suspense fallback={null}><EntraGate>{children}</EntraGate></Suspense>
  }
  return <PasswordGate>{children}</PasswordGate>
}
