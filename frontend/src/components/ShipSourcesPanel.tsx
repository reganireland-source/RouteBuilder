/**
 * ShipSourcesPanel — which AIS providers ShipTracker uses and how they share
 * the work, shown inside ShipTrackerDialog (collapsed under the feed line).
 *
 * Modes (backend: shiptracker/hub.py):
 *   share    (default) planned around the ship count N: steady sources with
 *            an hourly limit (Marinesia) rotate through the ships, so each
 *            is checked every N hours; monthly-allowance sources (VesselAPI)
 *            add a check at the midpoint of a ship's rotation gap, where it
 *            removes the most staleness. Paid sources only fill gaps. The
 *            panel shows the plan and the next scheduled checks.
 *   fallback later sources only asked about ships earlier ones lost.
 *   always   every source asked about every ship; freshest fix wins.
 *
 * Each polled provider has per-hour and per-month call limits (its free tier
 * by default) that the backend never exceeds; monthly allowances lean towards
 * BUSY HOURS (default 04:00–20:00 SGT, ×1.5), when ships in Asia are most
 * likely under way. The panel shows usage per source and, in share mode, how
 * often each ship gets a fresh check.
 *
 * A source without its API key env var can be placed in the order but is
 * skipped until the key is set; keys never reach the browser.
 *
 * Backend: GET /api/ships/sources, PUT /api/config { ship_tracking }.
 */
import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { ShipBusyHours, ShipPollingPlan, ShipSource, ShipSourceLimits, ShipSourcesResponse, ShipTrackingSettings, TrackedShip } from '../types'
import { useTheme } from '../theme'

type T = ReturnType<typeof useTheme>
type Draft = ShipTrackingSettings
type SetDraft = (d: Draft) => void

const ROLE_LABEL: Record<ShipSource['role'], string> = {
  stream: 'Listening', rotation: 'Rotation', midpoint: 'Midpoints', primary: 'First', fallback: 'Fills gaps', always: 'Also used', unused: 'Not used',
}

const MODES: { id: Draft['mode']; title: string; blurb: (d: Draft) => string }[] = [
  { id: 'share', title: 'Planned rotation', blurb: () => 'Hourly sources rotate through the ships; monthly allowances add a check halfway between. Paid sources only fill gaps.' },
  { id: 'fallback', title: 'Only fill gaps', blurb: d => `Later sources only asked about ships the ones above haven't located in ${d.stale_minutes} min.` },
  { id: 'always', title: 'Always', blurb: () => 'Every source asked about every ship; the freshest position wins.' },
]

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const pad = (h: number) => `${String(h % 24).padStart(2, '0')}:00`

function zoneLabel(offset: number): string {
  if (offset === 8) return 'SGT'
  return `UTC${offset >= 0 ? '+' : '−'}${Math.abs(offset)}`
}

/** "in 3h", "in 40m" — for the next scheduled call. */
function untilLabel(iso: string | null): string | null {
  if (!iso) return null
  const mins = Math.round((Date.parse(iso) - Date.now()) / 60_000)
  if (!Number.isFinite(mins) || mins <= 0) return 'now'
  return mins < 60 ? `in ${mins}m` : `in ${Math.round(mins / 6) / 10}h`
}

/** Free sources first, keeping the existing relative order within each group. */
function freeFirst(order: string[], sources: ShipSource[]): string[] {
  const isFree = (id: string) => sources.find(s => s.id === id)?.free ?? false
  return [...order.filter(isFree), ...order.filter(id => !isFree(id))]
}

const isLimited = (l?: ShipSourceLimits) => !!l && (l.per_month !== null || l.per_hour !== null)

export function ShipSourcesPanel({ isAdmin, ships = [], onSaved }: { isAdmin: boolean; ships?: TrackedShip[]; onSaved?: () => void }) {
  const t = useTheme()
  const [data, setData] = useState<ShipSourcesResponse | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function apply(r: ShipSourcesResponse) { setData(r); setDraft(r.settings) }

  useEffect(() => {
    api.getShipSources().then(apply).catch(e => setError(String(e)))
  }, [])

  async function save() {
    if (!draft) return
    setSaving(true); setError(null)
    try {
      await api.updateShipTracking(draft)
      apply(await api.getShipSources())
      onSaved?.()
    } catch (e) { setError(String(e)) }
    finally { setSaving(false) }
  }

  if (!data || !draft) {
    return <div style={{ fontSize: 11, color: error ? t.red : t.textFaint, padding: '4px 0' }}>{error ? `⚠ ${error}` : 'Loading sources…'}</div>
  }
  const { sources } = data
  const dirty = JSON.stringify(draft) !== JSON.stringify(data.settings)
  const byId = (id: string) => sources.find(s => s.id === id)
  const inUse = draft.order.map(byId).filter((s): s is ShipSource => !!s)
  const unused = sources.filter(s => !draft.order.includes(s.id))
  const canSave = dirty && !saving && draft.order.length > 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {data.settings.mode === 'share' && <PlanCard t={t} plan={data.plan} ships={ships} peak={data.settings.peak} busyNow={data.busy_now} dirty={dirty} />}

      <SectionLabel t={t} text={draft.mode === 'share' ? 'In use' : 'In use · tried in this order'} />
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

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })

/** Share mode: the plan for the current ship count and the next checks. */
function PlanCard({ t, plan, ships, peak, busyNow, dirty }: { t: T; plan: ShipPollingPlan | null; ships: TrackedShip[]; peak: ShipBusyHours; busyNow: boolean; dirty: boolean }) {
  const window = `${pad(peak.start_hour)}–${pad(peak.end_hour)} ${zoneLabel(peak.utc_offset)}`
  const nameOf = (mmsi: string) => ships.find(s => s.mmsi === mmsi)?.name || mmsi
  const n = plan?.ships ?? 0
  return (
    <div style={{ padding: '9px 11px', borderRadius: 6, border: `1px solid ${t.blue}55`, background: t.blue + '14', fontSize: 11, color: t.textMuted, lineHeight: 1.5 }}>
      <div style={{ color: t.text, fontWeight: 700, marginBottom: 2 }}>Polling plan · {n} ship{n === 1 ? '' : 's'}</div>
      <PlanSummary t={t} plan={plan} window={window} />
      {plan && plan.upcoming.length > 0 && (
        <ol style={{ listStyle: 'none', margin: '6px 0 0', padding: 0, display: 'grid', gridTemplateColumns: 'auto auto 1fr', columnGap: 10, rowGap: 1 }}>
          {plan.upcoming.map(e => (
            <li key={`${e.at}-${e.source}-${e.mmsi}`} style={{ display: 'contents' }}>
              <span style={{ fontVariantNumeric: 'tabular-nums', color: t.text }}>{timeFmt.format(new Date(e.at))}</span>
              <span style={{ color: e.kind === 'rotation' ? t.textMuted : t.green }}>{e.source}{e.kind === 'midpoint' ? ' · midpoint' : ''}</span>
              <span style={{ color: t.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nameOf(e.mmsi)}</span>
            </li>
          ))}
        </ol>
      )}
      <span style={{ display: 'block', marginTop: 4, color: busyNow ? t.green : t.textFaint, fontWeight: 600 }}>
        {busyNow ? '● Busy hours now' : '○ Quiet hours now'} ({window}){dirty ? ' · save to update the plan' : ''}
      </span>
    </div>
  )
}

function PlanSummary({ t, plan, window }: { t: T; plan: ShipPollingPlan | null; window: string }) {
  if (!plan || (!plan.rotation && plan.topups.length === 0)) {
    return <div>No free source with a key is in use yet, so nothing is polled on a free allowance.</div>
  }
  return (
    <div>
      {plan.rotation && (
        <div>
          <b style={{ color: t.text }}>{plan.rotation.sources.join(' + ')}</b> rotates through the ships: each one checked every <b style={{ color: t.text }}>{plan.rotation.hours_per_ship} h</b>.
        </div>
      )}
      {plan.topups.map(tp => tp.busy_hours_per_ship && (
        <div key={tp.label}>
          <b style={{ color: t.text }}>{tp.label}</b> {plan.rotation ? 'adds a check halfway between' : 'checks the longest-waiting ship'}, about every {tp.busy_hours_per_ship} h per ship in busy hours ({window}), {tp.quiet_hours_per_ship} h otherwise.
        </div>
      ))}
      {plan.gap_fillers.length > 0 && <div>{plan.gap_fillers.join(', ')}: only for ships nothing else has located.</div>}
    </div>
  )
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
      {active && s.kind === 'poll' && <Limits t={t} s={s} draft={draft} setDraft={setDraft} />}
    </li>
  )
}

function RolePill({ t, role }: { t: T; role: ShipSource['role'] }) {
  const lead = role === 'primary' || role === 'rotation' || role === 'midpoint' || role === 'stream'
  return (
    <span style={{
      fontSize: 9, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase',
      padding: '1px 6px', borderRadius: 3, flexShrink: 0,
      color: lead ? t.blue : t.textMuted, border: `1px solid ${lead ? t.blue + '88' : t.border}`,
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

/** Usage against this source's limits, next scheduled call, and (admin) the limits. */
function Limits({ t, s, draft, setDraft }: { t: T; s: ShipSource; draft: Draft; setDraft?: SetDraft }) {
  const u = s.usage
  const lim = draft.limits[s.id] ?? { per_month: null, per_hour: null }
  const setLim = (patch: Partial<ShipSourceLimits>) => setDraft?.({ ...draft, limits: { ...draft.limits, [s.id]: { ...lim, ...patch } } })
  const isFreeTier = !!s.free_limits && lim.per_month === s.free_limits.per_month && lim.per_hour === s.free_limits.per_hour
  return (
    <div style={{ marginTop: 6, paddingLeft: 36, display: 'flex', flexDirection: 'column', gap: 6 }}>
      {u && <UsageLine t={t} u={u} />}
      {setDraft && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <LimitInput t={t} label="Max / hour" value={lim.per_hour} onChange={v => setLim({ per_hour: v })} />
          <LimitInput t={t} label="Max / month" value={lim.per_month} onChange={v => setLim({ per_month: v })} />
          {s.free_limits && !isFreeTier && (
            <button type="button" onClick={() => setLim({ ...s.free_limits! })} style={{ ...linkButton(t), marginTop: 0, fontSize: 10 }}>
              reset to free tier
            </button>
          )}
          {!isLimited(lim) && <span style={{ fontSize: 10, color: t.textFaint }}>No limits — treated as paid{draft.mode === 'share' ? ', fills gaps only' : ''}</span>}
        </div>
      )}
    </div>
  )
}

function UsageLine({ t, u }: { t: T; u: NonNullable<ShipSource['usage']> }) {
  const pct = u.per_month ? Math.min(100, (u.calls_this_month / u.per_month) * 100) : 0
  let meter = t.green
  if (pct >= 100) meter = t.red
  else if (pct > 80) meter = t.orange
  const next = untilLabel(u.next_call_utc)
  const callsWord = u.calls_this_month === 1 ? 'call' : 'calls'
  const parts = [
    u.per_month ? `${u.calls_this_month}/${u.per_month} this month` : `${u.calls_this_month} ${callsWord} this month`,
    u.per_hour ? `${u.calls_last_hour}/${u.per_hour} this hour` : null,
    next ? `next ${next}` : null,
  ].filter(Boolean)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
      {u.per_month !== null && (
        <div aria-hidden style={{ flex: '0 1 120px', height: 4, borderRadius: 2, background: t.borderSubtle, overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: meter }} />
        </div>
      )}
      <span style={{ fontSize: 10, color: t.textFaint, fontVariantNumeric: 'tabular-nums' }}>{parts.join(' · ')}</span>
    </div>
  )
}

function LimitInput({ t, label, value, onChange }: { t: T; label: string; value: number | null; onChange: (v: number | null) => void }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: t.textFaint }}>
      {label}
      <input
        type="number" min={1} placeholder="None" value={value ?? ''}
        onChange={e => onChange(e.target.value === '' ? null : Math.max(1, Math.round(Number(e.target.value)) || 1))}
        style={{ width: 76, padding: '3px 6px', borderRadius: 4, border: `1px solid ${t.border}`, background: t.bgInput, color: t.text, fontSize: 11, fontFamily: 'inherit' }}
      />
    </label>
  )
}

function fieldLabel(t: T) {
  return { fontSize: 10, fontWeight: 700, color: t.textFaint, textTransform: 'uppercase' as const, letterSpacing: '0.06em' }
}

function fieldInput(t: T) {
  return {
    width: '100%', padding: '6px 8px', borderRadius: 4, border: `1px solid ${t.border}`,
    background: t.bgInput, color: t.text, fontSize: 12, fontFamily: 'inherit',
  }
}

function SettingsForm({ t, draft, setDraft, inUse }: { t: T; draft: Draft; setDraft: SetDraft; inUse: ShipSource[] }) {
  const label = fieldLabel(t)
  const input = fieldInput(t)
  const unlimitedPolled = inUse.some(s => s.kind === 'poll' && !isLimited(draft.limits[s.id]))
  const showStale = (draft.mode === 'fallback' && inUse.length > 1) || (draft.mode === 'share' && unlimitedPolled)
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
      <fieldset style={{ border: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4, gridColumn: '1 / -1' }}>
        <legend style={{ ...label, padding: 0, marginBottom: 4 }}>How sources share the work</legend>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {MODES.map(m => {
            const on = draft.mode === m.id
            return (
              <button
                key={m.id} type="button" aria-pressed={on}
                onClick={() => setDraft({ ...draft, mode: m.id })}
                style={{
                  flex: '1 1 150px', textAlign: 'left', padding: '7px 10px', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
                  border: `1px solid ${on ? t.blue : t.border}`, background: on ? t.blue + '22' : 'transparent',
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 700, color: on ? t.blue : t.text }}>{m.title}</div>
                <div style={{ fontSize: 10, color: t.textFaint, marginTop: 2, lineHeight: 1.4 }}>{m.blurb(draft)}</div>
              </button>
            )
          })}
        </div>
      </fieldset>
      <BusyHoursFields t={t} draft={draft} setDraft={setDraft} />
      {unlimitedPolled && (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={label}>Sources without limits: check every (min)</span>
          <input
            type="number" min={1} max={90} value={draft.poll_minutes}
            onChange={e => setDraft({ ...draft, poll_minutes: clamp(Number(e.target.value) || 1, 1, 90) })}
            style={input}
          />
        </label>
      )}
      {showStale && (
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

const HOURS = Array.from({ length: 24 }, (_, h) => h)
const OFFSETS = Array.from({ length: 27 }, (_, i) => i - 12)

/** Busy hours: start/end (local, whole hours), time zone, and the boost. */
function BusyHoursFields({ t, draft, setDraft }: { t: T; draft: Draft; setDraft: SetDraft }) {
  const label = fieldLabel(t)
  const input = fieldInput(t)
  const p = draft.peak
  const setPeak = (patch: Partial<ShipBusyHours>) => setDraft({ ...draft, peak: { ...p, ...patch } })
  return (
    <fieldset style={{ border: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4, gridColumn: '1 / -1' }}>
      <legend style={{ ...label, padding: 0, marginBottom: 4 }}>Busy hours — a bit more polling while ships are likely under way</legend>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(96px, 1fr))', gap: 8 }}>
        <select aria-label="Busy hours start" value={p.start_hour} onChange={e => setPeak({ start_hour: Number(e.target.value) })} style={input}>
          {HOURS.map(h => <option key={h} value={h}>From {pad(h)}</option>)}
        </select>
        <select aria-label="Busy hours end" value={p.end_hour % 24} onChange={e => setPeak({ end_hour: Number(e.target.value) || 24 })} style={input}>
          {HOURS.map(h => <option key={h} value={h}>To {pad(h)}</option>)}
        </select>
        <select aria-label="Busy hours time zone" value={p.utc_offset} onChange={e => setPeak({ utc_offset: Number(e.target.value) })} style={input}>
          {OFFSETS.map(o => <option key={o} value={o}>{o === 8 ? 'SGT (UTC+8)' : zoneLabel(o)}</option>)}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: t.textFaint }}>
          Boost ×
          <input
            type="number" min={1} max={4} step={0.1} value={p.weight} aria-label="Busy-hours boost"
            onChange={e => setPeak({ weight: clamp(Math.round((Number(e.target.value) || 1) * 10) / 10, 1, 4) })}
            style={{ ...input, width: 64 }}
          />
        </label>
      </div>
      <div style={{ fontSize: 10, color: t.textFaint, lineHeight: 1.4 }}>
        Monthly allowances are spent {p.weight}× faster in busy hours. Hourly free limits already run flat out, day and night.
      </div>
    </fieldset>
  )
}
