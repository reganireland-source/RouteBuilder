/**
 * components/GateMessage.tsx — the shared full-screen status message used by
 * every whole-app entry gate (OktaGate, EntraGate) while it's still deciding
 * whether to render <App/> at all.
 *
 * No ThemeContext here, deliberately: every gate that uses this renders
 * OUTSIDE it (see main.tsx — AuthGate wraps <App/> from outside even
 * AuthProvider/ThemeContext), so this can't read the active theme and
 * doesn't try to; the dark palette below is hard-coded to look reasonable
 * regardless of which theme the app itself is about to mount into.
 */
export function GateMessage({ title, body }: { title: string; body?: string }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#0b1220', color: '#e2e8f0', fontFamily: 'system-ui, sans-serif', padding: 24,
    }}>
      <div style={{ textAlign: 'center', maxWidth: 420 }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>{title}</div>
        {body && <div style={{ fontSize: 13, color: '#94a3b8', lineHeight: 1.6 }}>{body}</div>}
      </div>
    </div>
  )
}
