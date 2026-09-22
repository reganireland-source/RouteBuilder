/**
 * components/AuthGate.tsx — picks the whole-app entry gate by VITE_AUTH_MODE.
 *
 * The ONE place this decision is made. main.tsx mounts <AuthGate> instead of
 * choosing between PasswordGate/OktaGate/EntraGate itself, so switching an
 * organisation onto Okta or Entra ID is a single env var (VITE_AUTH_MODE) at
 * build time with zero changes to main.tsx or to any gate. See
 * docs/okta-setup.md / docs/entra-setup.md.
 */
import { AUTH_MODE } from '../auth/mode'
import { PasswordGate } from './PasswordGate'
import { OktaGate } from './OktaGate'
import { EntraGate } from './EntraGate'

export function AuthGate({ children }: { children: React.ReactNode }) {
  if (AUTH_MODE === 'okta') return <OktaGate>{children}</OktaGate>
  if (AUTH_MODE === 'entra') return <EntraGate>{children}</EntraGate>
  return <PasswordGate>{children}</PasswordGate>
}
