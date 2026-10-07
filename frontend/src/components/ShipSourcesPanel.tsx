/**
 * ShipSourcesPanel — which AIS providers ShipTracker uses, shown inside
 * ShipTrackerDialog (collapsed by default under the feed line).
 *
 * Every provider is listed with its live status, coverage and pricing note,
 * so it's obvious why a ship may not be located (e.g. aisstream.io has almost
 * no coverage in East Asia). Admins choose a preferred source and an optional
 * second one that runs either always (freshest fix wins) or only as a
 * fallback for ships the preferred source hasn't located recently, which
 * keeps paid per-call costs down. A provider can only be selected once its
 * API key env var is set on the backend; keys never reach the browser.
 *
 * Backend: GET /api/ships/sources, PUT /api/config { ship_tracking }.
 */
import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { ShipSource, ShipTrackingSettings } from '../types'
import { useTheme } from '../theme'

type T = ReturnType<typeof useTheme>

const ROLE_LABEL: Record<ShipSource['role'], string> = {
  preferred: 'Preferred', fallback: 'Fallback', always: 'Also used', unused: 'Not used',
}

export function ShipSourcesPanel({ isAdmin, onSaved }: { isAdmin: boolean; onSaved?: () => void }) {
  const t = useTheme()
  const [sources, setSources] = useState<ShipSource[] | null>(null)
  const [draft, setDraft] = useState<ShipTrackingSettings | null>(null)
  const [saved, setSaved] = useState<ShipTrackingSettings | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function load() {
    return api.getShipSources().then(r => { setSources(r.sources); setSaved(r.settings); setDraft(r.settings) })
  }

  useEffect(() => {
    api.getShipSources()
      .then(r => { setSources(r.sources); setSaved(r.settings); setDraft(r.settings) })
      .catch(e => setError(String(e)))
  }, [])

  async function save() {
    if (!draft) return
    setSaving(true); setError(null)
    try {
      await api.updateShipTracking(draft)
      await load()
      onSaved?.()
    } catch (e) { setError(String(e)) }
    finally { setSaving(false) }
  }

  if (!sources || !draft) {
    return <div style={{ fontSize: 11, color: error ? t.red : t.textFaint, padding: '4px 0' }}>{error ? `⚠ ${error}` : 'Loading sources…'}</div>
  }
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved)
  const selectable = sources.filter(s => s.configured)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 1, borderRadius: 6, overflow: 'hidden', border: `1px solid ${t.border}` }}>
        {sources.map(s => <SourceRow key={s.id} t={t} s={s} />)}
      </ul>

      {isAdmin ? (
        <SettingsForm t={t} draft={draft} setDraft={setDraft} sources={sources} selectable={selectable} />
      ) : (
        <div style={{ fontSize: 11, color: t.textFaint }}>Changing sources needs admin access.</div>
      )}

      {error && <div style={{ fontSize: 11, color: t.red }}>⚠ {error}</div>}
      {isAdmin && (
        <button
          onClick={() => void save()} disabled={!dirty || saving}
          style={{
            alignSelf: 'flex-start', padding: '7px 14px', borderRadius: 6, border: 'none',
            cursor: dirty && !saving ? 'pointer' : 'default',
            background: dirty && !saving ? t.blue : t.borderSubtle, color: '#0b1220',
            fontSize: 12, fontWeight: 700, fontFamily: 'inherit',
          }}
        >{saving ? 'Saving…' : 'Save source settings'}</button>
      )}
    </div>
  )
}

function SourceRow({ t, s }: { t: T; s: ShipSource }) {
  const dot = { ok: t.green, error: t.red, checking: t.orange, disabled: t.textFaintest }[s.status]
  const active = s.role !== 'unused'
  return (
    <li style={{ padding: '8px 10px', background: active ? t.bgCardSelected : t.bgCard }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span aria-hidden style={{ width: 8, height: 8, borderRadius: '50%', background: dot, flexShrink: 0 }} />
        <span style={{ fontSize: 12, fontWeight: 700, color: t.text }}>{s.label}</span>
        <span style={{ fontSize: 10, color: t.textFaint }}>{s.pricing}</span>
        <span style={{
          marginLeft: 'auto', fontSize: 9, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase',
          padding: '1px 6px', borderRadius: 3, flexShrink: 0,
          color: s.role === 'preferred' ? t.blue : t.textMuted,
          border: `1px solid ${s.role === 'preferred' ? t.blue + '88' : t.border}`,
        }}>{ROLE_LABEL[s.role]}</span>
      </div>
      <div style={{ fontSize: 11, color: t.textMuted, marginTop: 3, paddingLeft: 16, lineHeight: 1.45 }}>{s.coverage}</div>
      <div style={{ fontSize: 11, color: s.status === 'error' ? t.red : t.textFaint, marginTop: 2, paddingLeft: 16, lineHeight: 1.45, overflowWrap: 'anywhere' }}>
        {s.configured ? s.detail : <>API key not set — add <code style={{ fontSize: 10 }}>{s.env_key}</code> on the backend to enable.</>}
      </div>
    </li>
  )
}

function SettingsForm({ t, draft, setDraft, sources, selectable }: {
  t: T; draft: ShipTrackingSettings; setDraft: (d: ShipTrackingSettings) => void
  sources: ShipSource[]; selectable: ShipSource[]
}) {
  const label = { fontSize: 10, fontWeight: 700, color: t.textFaint, textTransform: 'uppercase' as const, letterSpacing: '0.06em' }
  const select = {
    width: '100%', padding: '6px 8px', borderRadius: 4, border: `1px solid ${t.border}`,
    background: t.bgInput, color: t.text, fontSize: 12, fontFamily: 'inherit',
  }
  const nameOf = (id: string) => sources.find(s => s.id === id)?.label ?? id
  const hasPolled = [draft.preferred, draft.secondary].some(id => sources.find(s => s.id === id)?.kind === 'poll')
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={label}>Preferred source</span>
        <select value={draft.preferred} onChange={e => setDraft({ ...draft, preferred: e.target.value, secondary: draft.secondary === e.target.value ? null : draft.secondary })} style={select}>
          {selectable.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          {!selectable.some(s => s.id === draft.preferred) && <option value={draft.preferred}>{nameOf(draft.preferred)} (no key)</option>}
        </select>
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={label}>Second source</span>
        <select value={draft.secondary ?? ''} onChange={e => setDraft({ ...draft, secondary: e.target.value || null })} style={select}>
          <option value="">None</option>
          {selectable.filter(s => s.id !== draft.preferred).map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </label>
      {draft.secondary && (
        <fieldset style={{ border: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4, gridColumn: '1 / -1' }}>
          <legend style={{ ...label, padding: 0, marginBottom: 4 }}>Use second source</legend>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {(['fallback', 'always'] as const).map(mode => {
              const on = draft.secondary_mode === mode
              return (
                <button
                  key={mode} type="button" aria-pressed={on}
                  onClick={() => setDraft({ ...draft, secondary_mode: mode })}
                  style={{
                    flex: '1 1 180px', textAlign: 'left', padding: '7px 10px', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
                    border: `1px solid ${on ? t.blue : t.border}`, background: on ? t.blue + '22' : 'transparent',
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 700, color: on ? t.blue : t.text }}>{mode === 'fallback' ? 'Only as fallback' : 'Always'}</div>
                  <div style={{ fontSize: 10, color: t.textFaint, marginTop: 2, lineHeight: 1.4 }}>
                    {mode === 'fallback'
                      ? `Asked only about ships ${nameOf(draft.preferred)} hasn't located in ${draft.stale_minutes} min — fewer paid calls.`
                      : 'Both run continuously; the freshest position wins.'}
                  </div>
                </button>
              )
            })}
          </div>
        </fieldset>
      )}
      {hasPolled && (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={label}>Poll every (minutes)</span>
          <input
            type="number" min={1} max={60} value={draft.poll_minutes}
            onChange={e => setDraft({ ...draft, poll_minutes: Math.max(1, Math.min(60, Number(e.target.value) || 1)) })}
            style={select}
          />
        </label>
      )}
      {draft.secondary && draft.secondary_mode === 'fallback' && (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={label}>Fall back after (minutes)</span>
          <input
            type="number" min={5} max={1440} value={draft.stale_minutes}
            onChange={e => setDraft({ ...draft, stale_minutes: Math.max(5, Math.min(1440, Number(e.target.value) || 5)) })}
            style={select}
          />
        </label>
      )}
    </div>
  )
}
