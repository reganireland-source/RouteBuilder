/**
 * auth/mode.ts — which auth model this build is running, read once.
 *
 * The one place VITE_AUTH_MODE itself gets parsed. auth/okta.ts and
 * auth/entra.ts each derive their own boolean (OKTA_MODE / ENTRA_MODE) from
 * this rather than re-reading the env var themselves, so there is exactly
 * one definition of "anything other than exactly 'okta' or 'entra' means
 * admin_key" — a typo here (e.g. "Okta", "azure") must fall back to the
 * existing, already-understood shared-password model rather than silently
 * doing neither. Mirrors the backend's auth_mode() in
 * backend/app/auth/oidc.py exactly, including that fallback rule.
 *
 * Read once at module load — VITE_* vars are baked in at BUILD time, not
 * runtime, so this can never change during the life of a loaded page, which
 * is what makes branching between three different provider components
 * elsewhere (AuthGate, AuthProvider, AdminBar) safe despite each calling
 * its own hooks.
 */
export type AuthMode = 'admin_key' | 'okta' | 'entra'

const _raw = (import.meta.env.VITE_AUTH_MODE as string | undefined)?.trim().toLowerCase()

export const AUTH_MODE: AuthMode = _raw === 'okta' || _raw === 'entra' ? _raw : 'admin_key'
