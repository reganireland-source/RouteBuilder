/**
 * components/AuthGate.tsx — picks the whole-app entry gate by VITE_AUTH_MODE.
 *
 * The ONE place this decision is made. main.tsx mounts <AuthGate> instead of
 * choosing between PasswordGate and OktaGate itself, so switching an
 * organisation from the shared-password model to Okta is a single env var
 * (VITE_AUTH_MODE=okta at build time) with zero changes to main.tsx or to
 * either gate. See docs/okta-setup.md.
 */
import { OKTA_MODE } from '../auth/okta'
import { PasswordGate } from './PasswordGate'
import { OktaGate } from './OktaGate'

export function AuthGate({ children }: { children: React.ReactNode }) {
  return OKTA_MODE ? <OktaGate>{children}</OktaGate> : <PasswordGate>{children}</PasswordGate>
}
