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

const Z_DIALOG = 11500
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
  const [ships, setShips] = useState<TrackedShip[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const [adding, setAdding] = useState(false)
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

  async function addShip() {
    const mmsi = addMmsi.trim()
    if (!mmsi) { setAddError('Enter an MMSI.'); return }
    setSaving(true); setAddError(null)
    try {
      const created = await api.createShip({ mmsi })
      setShips(prev => [...prev, created])
      setAdding(false); setAddMmsi('')
    } catch (e) { setAddError(String(e)) }
    finally { setSaving(false) }
  }

  async function removeShip(mmsi: string) {
    setSaving(true)
    try {
      await api.deleteShip(mmsi)
      setShips(prev => prev.filter(s => s.mmsi !== mmsi))
      setDelConfirm(null)
    } catch (e) { setError(String(e)) }
    finally { setSaving(false) }
  }

  const openShip = openMmsi ? ships.find(s => s.mmsi === openMmsi) ?? null : null

  return createPortal(
    <>
      <div
        role="presentation"
        onClick={e => { if (e.target === e.currentTarget) onClose() }}
        className="rb-anim-fade"
        style={{
          position: 'fixed', inset: 0, zIndex: Z_DIALOG,
          background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '0 24px',
        }}
      >
        <div
          role="dialog" aria-modal="true" aria-label="Ship Tracker"
          onClick={e => e.stopPropagation()}
          className="rb-anim-pop"
          style={{
            background: t.bgPanel, border: `1px solid ${t.border}`, borderRadius: 12,
            padding: 0, width: '100%', maxWidth: 560, maxHeight: '82vh',
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
            boxShadow: '0 24px 64px rgba(0,0,0,0.5)', fontFamily: 'system-ui, sans-serif',
          }}
        >
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px',
            background: t.bgDeep, borderBottom: `1px solid ${t.border}`,
          }}>
            <span style={{ fontSize: 18 }}>🚢</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: t.text }}>Ship Tracker</div>
              <div style={{ fontSize: 11, color: t.textFaint }}>Cable repair ships being tracked</div>
            </div>
            <button
              onClick={onToggleShipsOnMap}
              aria-pressed={shipsOnMap}
              title="Show tracked ships on the map at their live position, with a heading arrow"
              style={{
                padding: '6px 10px', borderRadius: 6, cursor: 'pointer',
                border: `1px solid ${shipsOnMap ? t.blue : t.border}`,
                background: shipsOnMap ? t.blue + '22' : 'transparent',
                color: shipsOnMap ? t.blue : t.textMuted,
                fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
              }}
            >{shipsOnMap ? '◉ On map' : '◎ Show on map'}</button>
            <button
              onClick={refresh} disabled={refreshing}
              title="Re-check the backend's cached AIS positions"
              style={{
                padding: '6px 10px', borderRadius: 6, cursor: refreshing ? 'default' : 'pointer',
                border: `1px solid ${t.border}`, background: 'transparent', color: t.textMuted,
                fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
              }}
            >{refreshing ? 'Refreshing…' : '↻ Refresh'}</button>
            <button
              onClick={onClose} aria-label="Close"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: t.textMuted, fontSize: 22, lineHeight: 1, padding: '0 2px' }}
            >×</button>
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

            {isAdmin && (
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${t.border}` }}>
                {!adding ? (
                  <button
                    onClick={() => setAdding(true)}
                    style={{
                      width: '100%', padding: '9px', borderRadius: 6, cursor: 'pointer',
                      border: `1px dashed ${t.border}`, background: 'transparent', color: t.textMuted,
                      fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
                    }}
                  >+ Track a ship by MMSI</button>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input
                        autoFocus
                        value={addMmsi}
                        onChange={e => setAddMmsi(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') void addShip() }}
                        placeholder="MMSI (e.g. 525300321)"
                        style={{
                          flex: 1, padding: '7px 9px', borderRadius: 5, fontSize: 12,
                          border: `1px solid ${t.border}`, background: t.bgInput, color: t.text, fontFamily: 'inherit',
                        }}
                      />
                      <button
                        onClick={() => void addShip()} disabled={saving}
                        style={{
                          padding: '7px 14px', borderRadius: 5, border: 'none', cursor: saving ? 'default' : 'pointer',
                          background: saving ? t.textFaintest : t.green, color: '#0b1f14', fontSize: 12, fontWeight: 700, fontFamily: 'inherit',
                        }}
                      >{saving ? 'Adding…' : 'Add'}</button>
                      <button
                        onClick={() => { setAdding(false); setAddMmsi(''); setAddError(null) }} disabled={saving}
                        style={{
                          padding: '7px 12px', borderRadius: 5, cursor: 'pointer',
                          border: `1px solid ${t.border}`, background: 'transparent', color: t.textMuted, fontSize: 12, fontFamily: 'inherit',
                        }}
                      >Cancel</button>
                    </div>
                    {addError && <div style={{ fontSize: 11, color: t.red }}>⚠ {addError}</div>}
                    <div style={{ fontSize: 10, color: t.textFaintest, lineHeight: 1.5 }}>
                      The name is looked up from AIS automatically if the ship is currently transmitting — otherwise it's stored as the bare MMSI and you can rename it later.
                    </div>
                  </div>
                )}
              </div>
            )}
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
  const live = ship.live
  const position = live && live.lat != null && live.lon != null
    ? `${live.lat.toFixed(2)}, ${live.lon.toFixed(2)}`
    : 'No live signal yet'
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
        </div>
        <div style={{ fontSize: 11, color: t.textFaint }}>
          MMSI {ship.mmsi} · <span style={{ color: live ? t.green : t.textFaintest }}>{position}</span>
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
