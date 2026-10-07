/**
 * ShipSourcesPanel — which AIS providers ShipTracker uses, shown inside
 * ShipTrackerDialog (collapsed by default under the feed line).
 *
 * Sources run in PRIORITY ORDER, free ones first by default. In "fallback"
 * mode each later source is only asked about ships no earlier source has
 * located recently, so paid providers only fill gaps; in "always" mode every
 * source runs and the freshest fix wins. Polled providers have a monthly
 * call allowance (their free tier by default) that the backend paces across
 * the month so it is never exceeded; the meter shows how much is used.
 *
 * Every provider is listed with its live status, coverage and pricing note,
 * so it's obvious why a ship may not be located (e.g. aisstream.io has almost
 * no coverage in East Asia). A source without its API key env var can be
 * placed in the order but is skipped until the key is set; keys never reach
 * the browser.
 *
 * Backend: GET /api/ships/sources, PUT /api/config { ship_tracking }.
 */
import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { ShipSource, ShipTrackingSettings } from '../types'
import { useTheme } from '../theme'

type T = ReturnType<typeof useTheme>
type Draft = ShipTrackingSettings
type SetDraft = (d: Draft) => void

const ROLE_LABEL: Record<ShipSource['role'], string> = {
  primary: 'First', fallback: 'Fills gaps', always: 'Also used', unused: 'Not used',
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/** "in 3h", "in 40m", "now" — for the next paced call. */
function untilLabel(iso: string | null): string | null {
  if (!iso) return null
  const mins = Math.round((Date.parse(iso) - Date.now()) / 60_000)
  if (!Number.isFinite(mins) || mins <= 0) return 'next poll'
  return mins < 60 ? `in ${mins}m` : `in ${Math.round(mins / 60)}h`
}

/** Free sources first, keeping the existing relative order within each group. */
function freeFirst(order: string[], sources: ShipSource[]): string[] {
  const isFree = (id: string) => sources.find(s => s.id === id)?.free ?? false
  return [...order.filter(isFree), ...order.filter(id => !isFree(id))]
}

export function ShipSourcesPanel({ isAdmin, onSaved }: { isAdmin: boolean; onSaved?: () => void }) {
  const t = useTheme()
  const [sources, setSources] = useState<ShipSource[] | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saved, setSaved] = useState<Draft | null>(null)
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
  const byId = (id: string) => sources.find(s => s.id === id)
  const inUse = draft.order.map(byId).filter((s): s is ShipSource => !!s)
  const unused = sources.filter(s => !draft.order.includes(s.id))
  const canSave = dirty && !saving && draft.order.length > 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <SectionLabel t={t} text="In use · tried in this order" />
      <ol style={listStyle(t)}>
        {inUse.map((s, i) => (
          <SourceRow key={s.id} t={t} s={s} rank={i + 1} draft={draft} setDraft={isAdmin ? setDraft : undefined} />
        ))}
        {inUse.length === 0 && <li style={{ padding: '8px 10px', fontSize: 11, color: t.red, background: t.bgCard }}>Add at least one source.</li>}
      </ol>
      {isAdmin && draft.order.join() !== freeFirst(draft.order, sources).join() && (
        <button type="button" onClick={() => setDraft({ ...draft, order: freeFirst(draft.order, sources) })} style={linkButton(t)}>
          Put free sources first
        </button>
      )}

      {unused.length > 0 && <>
        <SectionLabel t={t} text="Not in use" />
        <ul style={listStyle(t)}>
          {unused.map(s => <SourceRow key={s.id} t={t} s={s} draft={draft} setDraft={isAdmin ? setDraft : undefined} />)}
        </ul>
      </>}

      {isAdmin ? (
        <SettingsForm t={t} draft={draft} setDraft={setDraft} inUse={inUse} />
      ) : (
        <div style={{ fontSize: 11, color: t.textFaint }}>Changing sources needs admin access.</div>
      )}

      {error && <div style={{ fontSize: 11, color: t.red }}>⚠ {error}</div>}
      {isAdmin && (
        <button
          onClick={() => void save()} disabled={!canSave}
          style={{
            alignSelf: 'flex-start', padding: '7px 14px', borderRadius: 6, border: 'none',
            cursor: canSave ? 'pointer' : 'default',
            background: canSave ? t.blue : t.borderSubtle, color: '#0b1220',
            fontSize: 12, fontWeight: 700, fontFamily: 'inherit',
          }}
        >{saving ? 'Saving…' : 'Save source settings'}</button>
      )}
    </div>
  )
}

function listStyle(t: T) {
  return { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column' as const, gap: 1, borderRadius: 6, overflow: 'hidden', border: `1px solid ${t.border}` }
}

function linkButton(t: T) {
  return { alignSelf: 'flex-start', marginTop: -6, padding: 0, border: 'none', background: 'none', color: t.blue, fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' } as const
}

function SectionLabel({ t, text }: { t: T; text: string }) {
  return <div style={{ fontSize: 10, fontWeight: 700, color: t.textFaint, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: -6 }}>{text}</div>
}

function SourceRow({ t, s, rank, draft, setDraft }: { t: T; s: ShipSource; rank?: number; draft: Draft; setDraft?: SetDraft }) {
  const dot = { ok: t.green, error: t.red, checking: t.orange, disabled: t.textFaintest }[s.status]
  const active = rank !== undefined
  return (
    <li style={{ padding: '8px 10px', background: active ? t.bgCardSelected : t.bgCard }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {active && <span style={{ fontSize: 11, fontWeight: 800, color: t.textMuted, fontVariantNumeric: 'tabular-nums', width: 12 }}>{rank}</span>}
        <span aria-hidden style={{ width: 8, height: 8, borderRadius: '50%', background: dot, flexShrink: 0 }} />
        <span style={{ fontSize: 12, fontWeight: 700, color: t.text }}>{s.label}</span>
        {s.free && <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.06em', color: t.green, border: `1px solid ${t.green}88`, borderRadius: 3, padding: '0 5px' }}>FREE</span>}
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
          {active && <RolePill t={t} role={s.role} />}
          {setDraft && <RowControls t={t} id={s.id} rank={rank} draft={draft} setDraft={setDraft} />}
        </span>
      </div>
      <div style={{ fontSize: 11, color: t.textMuted, marginTop: 3, paddingLeft: active ? 36 : 16, lineHeight: 1.45 }}>
        <span style={{ color: t.textFaint }}>{s.pricing}</span> · {s.coverage}
      </div>
      <div style={{ fontSize: 11, color: s.status === 'error' ? t.red : t.textFaint, marginTop: 2, paddingLeft: active ? 36 : 16, lineHeight: 1.45, overflowWrap: 'anywhere' }}>
        {s.configured ? s.detail : <>API key not set{active ? ' — skipped until' : ' — add'} <code style={{ fontSize: 10 }}>{s.env_key}</code>{active ? ' is set on the backend.' : ' on the backend to enable.'}</>}
      </div>
      {active && s.kind === 'poll' && <Allowance t={t} s={s} draft={draft} setDraft={setDraft} />}
    </li>
  )
}

function RolePill({ t, role }: { t: T; role: ShipSource['role'] }) {
  const first = role === 'primary'
  return (
    <span style={{
      fontSize: 9, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase',
      padding: '1px 6px', borderRadius: 3, flexShrink: 0,
      color: first ? t.blue : t.textMuted, border: `1px solid ${first ? t.blue + '88' : t.border}`,
    }}>{ROLE_LABEL[role]}</span>
  )
}

function RowControls({ t, id, rank, draft, setDraft }: { t: T; id: string; rank?: number; draft: Draft; setDraft: SetDraft }) {
  const btn = (disabled: boolean) => ({
    minWidth: 26, height: 24, padding: '0 6px', borderRadius: 4, border: `1px solid ${t.border}`,
    background: 'transparent', color: disabled ? t.textFaintest : t.textMuted, fontSize: 11, fontWeight: 700,
    cursor: disabled ? 'default' : 'pointer', fontFamily: 'inherit',
  })
  if (rank === undefined) {
    return <button type="button" style={btn(false)} onClick={() => setDraft({ ...draft, order: [...draft.order, id] })}>+ Use</button>
  }
  const i = rank - 1
  const move = (to: number) => {
    const order = [...draft.order]
    order.splice(to, 0, order.splice(i, 1)[0])
    setDraft({ ...draft, order })
  }
  const last = draft.order.length - 1
  return <>
    <button type="button" aria-label="Move up" title="Move up" disabled={i === 0} style={btn(i === 0)} onClick={() => move(i - 1)}>↑</button>
    <button type="button" aria-label="Move down" title="Move down" disabled={i === last} style={btn(i === last)} onClick={() => move(i + 1)}>↓</button>
    <button type="button" aria-label="Stop using" title="Stop using" style={btn(false)} onClick={() => setDraft({ ...draft, order: draft.order.filter(x => x !== id) })}>✕</button>
  </>
}

/** Monthly call allowance: usage meter, next paced call, and (admin) the limit. */
function Allowance({ t, s, draft, setDraft }: { t: T; s: ShipSource; draft: Draft; setDraft?: SetDraft }) {
  const budget = draft.budgets[s.id] ?? null
  const used = s.usage?.calls_this_month ?? 0
  const savedBudget = s.usage?.budget ?? null
  const pct = savedBudget ? Math.min(100, (used / savedBudget) * 100) : 0
  const next = savedBudget !== null && used < savedBudget ? untilLabel(s.usage?.next_call_utc ?? null) : null
  let meter = t.green
  if (pct >= 100) meter = t.red
  else if (pct > 80) meter = t.orange
  return (
    <div style={{ marginTop: 6, paddingLeft: 36, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      {savedBudget !== null ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '1 1 160px', minWidth: 0 }}>
          <div aria-hidden style={{ flex: 1, height: 4, borderRadius: 2, background: t.borderSubtle, overflow: 'hidden' }}>
            <div style={{ width: `${pct}%`, height: '100%', background: meter }} />
          </div>
          <span style={{ fontSize: 10, color: t.textFaint, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
            {used}/{savedBudget} calls this month{next ? ` · next ${next}` : ''}
          </span>
        </div>
      ) : (
        <span style={{ fontSize: 10, color: t.textFaint, flex: '1 1 160px' }}>{used} calls this month · no limit</span>
      )}
      {setDraft && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: t.textFaint }}>
          Limit / month
          <input
            type="number" min={1} placeholder="No limit" value={budget ?? ''}
            onChange={e => setDraft({ ...draft, budgets: { ...draft.budgets, [s.id]: e.target.value === '' ? null : Math.max(1, Math.round(Number(e.target.value)) || 1) } })}
            style={{ width: 84, padding: '3px 6px', borderRadius: 4, border: `1px solid ${t.border}`, background: t.bgInput, color: t.text, fontSize: 11, fontFamily: 'inherit' }}
          />
          {s.default_budget !== null && budget !== s.default_budget && (
            <button type="button" onClick={() => setDraft({ ...draft, budgets: { ...draft.budgets, [s.id]: s.default_budget } })} style={{ ...linkButton(t), marginTop: 0, fontSize: 10 }}>
              free tier ({s.default_budget})
            </button>
          )}
        </label>
      )}
    </div>
  )
}

function SettingsForm({ t, draft, setDraft, inUse }: { t: T; draft: Draft; setDraft: SetDraft; inUse: ShipSource[] }) {
  const label = { fontSize: 10, fontWeight: 700, color: t.textFaint, textTransform: 'uppercase' as const, letterSpacing: '0.06em' }
  const input = {
    width: '100%', padding: '6px 8px', borderRadius: 4, border: `1px solid ${t.border}`,
    background: t.bgInput, color: t.text, fontSize: 12, fontFamily: 'inherit',
  }
  const several = inUse.length > 1
  const hasPolled = inUse.some(s => s.kind === 'poll')
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
      {several && (
        <fieldset style={{ border: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4, gridColumn: '1 / -1' }}>
          <legend style={{ ...label, padding: 0, marginBottom: 4 }}>Later sources</legend>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {(['fallback', 'always'] as const).map(mode => {
              const on = draft.mode === mode
              return (
                <button
                  key={mode} type="button" aria-pressed={on}
                  onClick={() => setDraft({ ...draft, mode })}
                  style={{
                    flex: '1 1 180px', textAlign: 'left', padding: '7px 10px', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
                    border: `1px solid ${on ? t.blue : t.border}`, background: on ? t.blue + '22' : 'transparent',
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 700, color: on ? t.blue : t.text }}>{mode === 'fallback' ? 'Only fill gaps' : 'Always'}</div>
                  <div style={{ fontSize: 10, color: t.textFaint, marginTop: 2, lineHeight: 1.4 }}>
                    {mode === 'fallback'
                      ? `Asked only about ships the sources above haven't located in ${draft.stale_minutes} min — saves paid calls.`
                      : 'Every source runs; the freshest position wins.'}
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
            type="number" min={1} max={90} value={draft.poll_minutes}
            onChange={e => setDraft({ ...draft, poll_minutes: clamp(Number(e.target.value) || 1, 1, 90) })}
            style={input}
          />
        </label>
      )}
      {several && draft.mode === 'fallback' && (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={label}>Fill gaps after (minutes)</span>
          <input
            type="number" min={5} max={1440} value={draft.stale_minutes}
            onChange={e => setDraft({ ...draft, stale_minutes: clamp(Number(e.target.value) || 5, 5, 1440) })}
            style={input}
          />
        </label>
      )}
    </div>
  )
}
