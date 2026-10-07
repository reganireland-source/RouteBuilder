/**
 * ============================================================================
 *  ShipTrackerDialog.tsx — "which cable repair ships are mobilised, and where
 *  are they right now."
 * ============================================================================
 *
 * Opened from the Controls menu (App.tsx, admin-gated row "🚢 Ship Tracker",
 * same wiring shape as Cable Import / KML Import). A straightforward list +
 * add-by-MMSI + remove dialog, modelled on two existing pieces rather than
 * inventing new chrome:
 *
 *   - The portal/overlay/Escape-to-close/z-index shell is ConfirmDialog.tsx's
 *     pattern (see that file's own z-index comment — this dialog sits at
 *     11500, below ConfirmDialog's 12500 so a destructive-remove confirm
 *     raised from inside it is never trapped behind it, and above
 *     RefDataModal's 11000 since this can be opened over the top of it).
 *   - The add/remove local-state shape (`adding`/`addVals`/`saving`/`error`/
 *     `delConfirm`) is RefDataModal.tsx's SolutionNotesPanel pattern: fetch
 *     once on mount, then splice the API response into local state directly
 *     rather than refetching the whole list after every write.
 *
 * WHY "Refresh" RE-FETCHES FROM OUR OWN BACKEND, NOT FROM aisstream.io
 * DIRECTLY: aisstream.io is a push feed with no "get current position" call
 * — the backend's AisStreamClient (shiptracker/ais_client.py) holds a
 * persistent connection and caches whatever it has received. GET /api/ships
 * always answers from that cache, so "Refresh" here is just "ask our backend
 * what it currently knows," not a live round trip to the AIS provider.
 *
 * Clicking a ship ROW (not just its sprite) opens ShipFullView — the same
 * "Full View" visual language as Node/Segment Full View, built on
 * fullViewChrome.tsx's shared shell. See ShipFullView.tsx.
 *
 * Mounted from: App.tsx's Controls menu.
 * Backend: GET/POST /api/ships, DELETE /api/ships/{mmsi}.
 * ============================================================================
 */
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTheme } from '../theme'
import { useAuth } from '../context/AuthContext'
import { api } from '../api/client'
import type { TrackedShip } from '../types'
import { ShipFullView } from './ShipFullView'
import { ConfirmDialog } from './ConfirmDialog'
import { shipFixAge } from '../utils/shipFixAge'
import { flagFromMmsi } from '../utils/mmsiFlag'
import { AisFeedLine, useAisFeed } from './AisFeedLine'
import { PHONE_PX, useMaxWidth } from './fullViewChrome'

const Z_DIALOG = 11500
/** Screen-reader-only text (the flag emoji itself is aria-hidden). */
const visuallyHidden = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' } as const
const MMSI_RE = /^\d{9}$/
/** A Full View opened from this dialog has to sit ABOVE it, not at
 *  fullViewChrome's Z_FULL_VIEW_BASE (10000), or it opens behind the list
 *  that raised it. Still below ConfirmDialog's 12500. */
const Z_FULL_VIEW_FROM_DIALOG = Z_DIALOG + 40

export function ShipTrackerDialog({ onClose, shipsOnMap, onToggleShipsOnMap, onShipsChanged }: {
  onClose: () => void
  /** The "Ships on Map" overlay — same state as the Controls-menu toggle. */
  shipsOnMap: boolean
  onToggleShipsOnMap: () => void
  /** Lifts the list to App so the map layer reflects adds/removes at once,
   *  rather than waiting for its next poll. */
  onShipsChanged?: (ships: TrackedShip[]) => void
}) {
  const t = useTheme()
  const { isAdmin } = useAuth()
  const aisFeed = useAisFeed()
  const phone = useMaxWidth(PHONE_PX)
  const [ships, setShips] = useState<TrackedShip[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const [addMmsi, setAddMmsi] = useState('')
  const [saving, setSaving] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [delConfirm, setDelConfirm] = useState<string | null>(null)

  const [openMmsi, setOpenMmsi] = useState<string | null>(null)

  function load() {
    return api.getShips().then(s => { setShips(s); setError(null) }).catch(e => setError(String(e)))
  }

  useEffect(() => {
    api.getShips()
      .then(setShips)
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!loading) onShipsChanged?.(ships)
  }, [ships, loading, onShipsChanged])

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape' && !openMmsi) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, openMmsi])

  async function refresh() {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  /** An MMSI is exactly nine digits; returns an error message, or null. */
  function mmsiProblem(mmsi: string): string | null {
    if (!mmsi) return 'Enter an MMSI.'
    if (!MMSI_RE.test(mmsi)) return 'An MMSI is exactly 9 digits (e.g. 525300321).'
    return null
  }

  async function addShip() {
    const mmsi = addMmsi.trim()
    const problem = mmsiProblem(mmsi)
    if (problem) { setAddError(problem); return }
    if (ships.some(s => s.mmsi === mmsi)) { setAddError(`MMSI ${mmsi} is already tracked.`); return }
    setSaving(true); setAddError(null)
    try {
      const created = await api.createShip({ mmsi })
      setShips(prev => [...prev, created])
      setAddMmsi('')
    } catch (e) { setAddError(String(e)) }
    finally { setSaving(false) }
  }

  /** Remove by typed MMSI goes through the same confirm as a row's Remove. */
  function removeByMmsi() {
    const mmsi = addMmsi.trim()
    const problem = mmsiProblem(mmsi)
    if (problem) { setAddError(problem); return }
    if (!ships.some(s => s.mmsi === mmsi)) { setAddError(`MMSI ${mmsi} isn't being tracked.`); return }
    setAddError(null)
    setDelConfirm(mmsi)
  }

  async function removeShip(mmsi: string) {
    setSaving(true)
    try {
      await api.deleteShip(mmsi)
      setShips(prev => prev.filter(s => s.mmsi !== mmsi))
      setDelConfirm(null)
      if (addMmsi.trim() === mmsi) setAddMmsi('')
    } catch (e) { setError(String(e)) }
    finally { setSaving(false) }
  }

  const openShip = openMmsi ? ships.find(s => s.mmsi === openMmsi) ?? null : null

  const headerActions = (
    <HeaderActions t={t} phone={phone} shipsOnMap={shipsOnMap} onToggleShipsOnMap={onToggleShipsOnMap} refreshing={refreshing} onRefresh={refresh} />
  )

  return createPortal(
    <>
      <div
        role="presentation"
        onClick={e => { if (e.target === e.currentTarget) onClose() }}
        className="rb-anim-fade"
        style={{
          position: 'fixed', inset: 0, zIndex: Z_DIALOG,
          background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: phone ? '0 8px' : '0 24px',
        }}
      >
        <div
          role="dialog" aria-modal="true" aria-label="Ship Tracker"
          onClick={e => e.stopPropagation()}
          className="rb-anim-pop"
          style={{
            background: t.bgPanel, border: `1px solid ${t.border}`, borderRadius: 12,
            padding: 0, width: '100%', maxWidth: 560, maxHeight: phone ? '92vh' : '82vh',
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
            boxShadow: '0 24px 64px rgba(0,0,0,0.5)', fontFamily: 'system-ui, sans-serif',
          }}
        >
          <DialogHeader t={t} phone={phone} actions={headerActions} onClose={onClose} />

          <div style={{ padding: '8px 16px', borderBottom: `1px solid ${t.border}`, background: t.bgCard }}>
            <AisFeedLine feed={aisFeed} compact />
          </div>

          <div style={{ overflowY: 'auto', flex: 1, padding: 14 }}>
            {loading && <div style={{ fontSize: 12, color: t.textFaint, padding: '20px 4px' }}>Loading…</div>}
            {error && <div style={{ fontSize: 12, color: t.red, marginBottom: 10 }}>⚠ {error}</div>}

            {!loading && ships.length === 0 && (
              <div style={{ fontSize: 12, color: t.textFaintest, fontStyle: 'italic', padding: '20px 4px' }}>
                No ships tracked yet.
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {ships.map(ship => (
                <ShipRow
                  key={ship.mmsi} ship={ship} t={t} isAdmin={isAdmin}
                  onOpen={() => setOpenMmsi(ship.mmsi)}
                  onRemove={() => setDelConfirm(ship.mmsi)}
                />
              ))}
            </div>

            <MmsiPanel
              t={t} isAdmin={isAdmin} value={addMmsi} saving={saving} error={addError}
              onChange={v => { setAddMmsi(v); setAddError(null) }}
              onAdd={() => void addShip()}
              onRemove={removeByMmsi}
            />
          </div>
        </div>
      </div>

      {delConfirm && (
        <ConfirmDialog
          title="Stop tracking this ship?"
          body="This removes it from Ship Tracker. You can add it back later by MMSI."
          confirmLabel="Remove" danger
          onConfirm={() => void removeShip(delConfirm)}
          onCancel={() => setDelConfirm(null)}
        />
      )}

      {openShip && (
        <ShipFullView ship={openShip} onClose={() => setOpenMmsi(null)} zIndex={Z_FULL_VIEW_FROM_DIALOG} />
      )}
    </>,
    document.body,
  )
}

function ShipRow({ ship, t, isAdmin, onOpen, onRemove }: {
  ship: TrackedShip; t: ReturnType<typeof useTheme>; isAdmin: boolean
  onOpen: () => void; onRemove: () => void
}) {
  const { text: position, tone } = describeFix(ship)
  const flag = flagFromMmsi(ship.mmsi)
  const positionColor = { none: t.textFaintest, fresh: t.green, stale: t.orange }[tone]
  return (
    <div
      role="button" tabIndex={0}
      onClick={onOpen}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } }}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8,
        border: `1px solid ${t.border}`, background: t.bgCard, cursor: 'pointer',
      }}
    >
      <img
        src={`/ships/${ship.sprite || 'generic'}.png`}
        alt="" width={40} height={25}
        style={{ imageRendering: 'pixelated', flexShrink: 0 }}
        onError={e => { (e.currentTarget as HTMLImageElement).src = '/ships/generic.png' }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: t.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {ship.name}
          {flag && <span title={`Flag: ${flag.name}`} style={{ marginLeft: 6, fontWeight: 400 }}><span aria-hidden>{flag.emoji}</span><span style={visuallyHidden}>{flag.name}</span></span>}
        </div>
        <div style={{ fontSize: 11, color: t.textFaint }}>
          MMSI {ship.mmsi} · <span style={{ color: positionColor }}>{position}</span>
        </div>
      </div>
      {isAdmin && (
        <button
          onClick={e => { e.stopPropagation(); onRemove() }}
          title="Stop tracking"
          style={{
            padding: '5px 9px', borderRadius: 5, cursor: 'pointer',
            border: `1px solid ${t.red}66`, background: t.red + '18', color: t.red,
            fontSize: 11, fontWeight: 700, fontFamily: 'inherit', flexShrink: 0,
          }}
        >Remove</button>
      )}
    </div>
  )
}

/** Add or remove a ship by typing its MMSI. Always shown — not hidden for
 *  viewers — so the capability is discoverable; when locked it explains that
 *  admin access is needed instead of silently not being there. The backend
 *  enforces the same rule regardless (auth_guard gates POST/DELETE). */
function MmsiPanel({ t, isAdmin, value, saving, error, onChange, onAdd, onRemove }: {
  t: ReturnType<typeof useTheme>; isAdmin: boolean; value: string; saving: boolean; error: string | null
  onChange: (v: string) => void; onAdd: () => void; onRemove: () => void
}) {
  const disabled = !isAdmin || saving
  const btn = (bg: string, fg: string, border = 'none') => ({
    padding: '7px 12px', borderRadius: 5, border, cursor: disabled ? 'default' : 'pointer',
    background: disabled ? t.bgDeep : bg, color: disabled ? t.textFaintest : fg,
    fontSize: 12, fontWeight: 700, fontFamily: 'inherit', whiteSpace: 'nowrap' as const,
  })
  return (
    <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${t.border}`, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: t.textFaint, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        Add or remove by MMSI
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={value}
          disabled={!isAdmin}
          inputMode="numeric"
          maxLength={9}
          aria-label="MMSI"
          onChange={e => onChange(e.target.value.replace(/\D/g, ''))}
          onKeyDown={e => { if (e.key === 'Enter' && !disabled) onAdd() }}
          placeholder="9-digit MMSI, e.g. 525300321"
          style={{
            flex: 1, minWidth: 0, padding: '7px 9px', borderRadius: 5, fontSize: 12,
            border: `1px solid ${error ? t.red : t.border}`, background: t.bgInput, color: t.text,
            fontFamily: 'ui-monospace, monospace', opacity: isAdmin ? 1 : 0.6,
          }}
        />
        <button onClick={onAdd} disabled={disabled} style={btn(t.green, '#0b1f14')}>
          {saving ? 'Working…' : '+ Add'}
        </button>
        <button onClick={onRemove} disabled={disabled} style={btn(t.red + '18', t.red, `1px solid ${disabled ? t.border : t.red + '66'}`)}>
          − Remove
        </button>
      </div>
      {error && <div style={{ fontSize: 11, color: t.red }}>⚠ {error}</div>}
      <div style={{ fontSize: 10, color: t.textFaintest, lineHeight: 1.5 }}>
        {isAdmin
          ? "Adding looks the ship's name up from AIS if it's transmitting right now; otherwise it's stored under its MMSI. Find a ship's MMSI on its vessel-tracker page."
          : '🔒 Adding or removing ships needs admin access — unlock admin mode first.'}
      </div>
    </div>
  )
}

/** The list row's one-line position summary and how to colour it. */
function describeFix(ship: TrackedShip): { text: string; tone: 'none' | 'fresh' | 'stale' } {
  const live = ship.live
  if (!live || live.lat == null || live.lon == null) return { text: 'Not heard yet', tone: 'none' }
  const coords = `${live.lat.toFixed(2)}, ${live.lon.toFixed(2)}`
  const age = shipFixAge(live)
  if (!age) return { text: coords, tone: 'fresh' }
  if (age.stale) return { text: `Last known ${coords} · ${age.label}`, tone: 'stale' }
  return { text: `${coords} · ${age.label}`, tone: 'fresh' }
}

/** "Show on map" + "Refresh": inline beside the title on desktop, a
 *  full-width row of their own on a phone. */
function HeaderActions({ t, phone, shipsOnMap, onToggleShipsOnMap, refreshing, onRefresh }: {
  t: ReturnType<typeof useTheme>; phone: boolean; shipsOnMap: boolean; onToggleShipsOnMap: () => void
  refreshing: boolean; onRefresh: () => void
}) {
  const base = {
    flex: phone ? 1 : undefined, minHeight: phone ? 38 : undefined,
    padding: '6px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600, fontFamily: 'inherit', whiteSpace: 'nowrap' as const,
  }
  return (
    <>
      <button
        onClick={onToggleShipsOnMap}
        aria-pressed={shipsOnMap}
        title="Show tracked ships on the map at their live position, with a heading arrow"
        style={{
          ...base, cursor: 'pointer',
          border: `1px solid ${shipsOnMap ? t.blue : t.border}`,
          background: shipsOnMap ? t.blue + '22' : 'transparent',
          color: shipsOnMap ? t.blue : t.textMuted,
        }}
      >{shipsOnMap ? '◉ On map' : '◎ Show on map'}</button>
      <button
        onClick={onRefresh} disabled={refreshing}
        title="Re-check the backend's cached AIS positions"
        style={{ ...base, cursor: refreshing ? 'default' : 'pointer', border: `1px solid ${t.border}`, background: 'transparent', color: t.textMuted }}
      >{refreshing ? 'Refreshing…' : '↻ Refresh'}</button>
    </>
  )
}

function DialogHeader({ t, phone, actions, onClose }: {
  t: ReturnType<typeof useTheme>; phone: boolean; actions: React.ReactNode; onClose: () => void
}) {
  return (
    <div style={{ padding: phone ? '12px 12px 10px' : '14px 16px', background: t.bgDeep, borderBottom: `1px solid ${t.border}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 18 }}>🚢</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: t.text }}>Ship Tracker</div>
          <div style={{ fontSize: 11, color: t.textFaint }}>Cable repair ships being tracked</div>
        </div>
        {!phone && actions}
        <button
          onClick={onClose} aria-label="Close"
          style={{
            background: 'none', border: 'none', cursor: 'pointer', color: t.textMuted, fontSize: phone ? 26 : 22, lineHeight: 1,
            padding: phone ? 0 : '0 2px', width: phone ? 40 : undefined, height: phone ? 40 : undefined, flexShrink: 0,
          }}
        >×</button>
      </div>
      {/* On a phone the two actions get their own row, full width, so the
          title never has to wrap a word per line beside them. */}
      {phone && <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>{actions}</div>}
    </div>
  )
}
