/**
 * ============================================================================
 *  ShipFullView.tsx — the ship "Full View" modal.
 * ============================================================================
 *
 * ShipTrackerDialog's list row answers "which ship, roughly where." Full View
 * answers "tell me everything about this ship" the same way Node/Segment
 * Full View do for the rest of the network — same shell, same card grid,
 * same breakpoints — built on fullViewChrome.tsx rather than inventing new
 * chrome for a third entity type.
 *
 * Simpler than Node/Segment Full View in two ways that are deliberate, not
 * missing features: it does not NAVIGATE (a ship has no "other side" to open
 * into — it opens once, directly on top of ShipTrackerDialog, at
 * Z_FULL_VIEW_BASE), and it is READ-ONLY (there is no staged-edit form here;
 * a ship's name/sprite are small enough fields that re-adding or editing
 * through ShipTrackerDialog is simpler than an in-place editor would be).
 *
 * `live` fields render a plain "No live signal yet" card instead of zeroed
 * coordinates when the backend's AIS cache has nothing for this MMSI —
 * never transmitted since the backend started, or MARITIME_AISSTREAM_API_KEY
 * isn't configured — see shiptracker/ais_client.py's module docstring.
 *
 * Mounted from: ShipTrackerDialog.tsx (clicking a ship row).
 * Backend: none directly — `ship` is passed in from ShipTrackerDialog's
 * already-fetched list, same as how a route card passes a segment into
 * SegmentFullView rather than this view re-fetching it.
 * ============================================================================
 */
import type { TrackedShip, TrackedShipLive } from '../types'
import {
  backdropClose, backdropStyle, dialogStyle, headerShell, scrollerStyle, rowStyle,
  Card, TextRow, Empty, closeBtnStyle, useEscapeKey, useFullViewLayout, LayoutContext,
  Z_FULL_VIEW_BASE,
} from './fullViewChrome'
import { useTheme } from '../theme'
import { shipFixAge } from '../utils/shipFixAge'
import { AisFeedLine, useAisFeed } from './AisFeedLine'

const NAV_STATUS_LABEL: Record<number, string> = {
  0: 'Under way using engine', 1: 'At anchor', 2: 'Not under command',
  3: 'Restricted manoeuvrability', 4: 'Constrained by draught', 5: 'Moored',
  6: 'Aground', 7: 'Engaged in fishing', 8: 'Under way sailing',
  15: 'Not defined',
}

export function ShipFullView({ ship, onClose, zIndex = Z_FULL_VIEW_BASE }: {
  ship: TrackedShip; onClose: () => void; zIndex?: number
}) {
  const t = useTheme()
  const layout = useFullViewLayout()
  const { phone } = layout
  useEscapeKey(onClose)

  const live = ship.live
  const hasFix = !!live && live.lat != null && live.lon != null
  const age = shipFixAge(live)
  const aisFeed = useAisFeed()
  let positionTitle = 'Position'
  if (hasFix) positionTitle = age?.stale ? 'Last Known Position' : 'Live Position'

  return (
    <LayoutContext.Provider value={layout}>
      <div
        role="presentation"
        onClick={backdropClose(onClose)}
        style={backdropStyle(phone, zIndex)}
        className="rb-anim-fade"
      >
        <div
          role="dialog" aria-modal="true" aria-label={ship.name}
          style={dialogStyle(t, phone, 760)}
          className="rb-anim-pop"
        >
          <div style={headerShell(t, phone)}>
            {/* headerShell is `display: block` on a phone (Node/Segment Full
                View lay out their own two lines); this header is one short
                line, so it keeps its own flex row and the × stays top-right. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%' }}>
            <img
              src={`/ships/${ship.sprite || 'generic'}.png`}
              alt="" width={64} height={40}
              style={{ imageRendering: 'pixelated', flexShrink: 0 }}
              onError={e => { (e.currentTarget as HTMLImageElement).src = '/ships/generic.png' }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: t.text }}>{ship.name}</div>
              <div style={{ fontSize: 11, color: t.textFaint }}>Cable repair ship — tracked via AIS</div>
            </div>
            <button onClick={onClose} title="Close" aria-label="Close" style={closeBtnStyle(t, phone)}>×</button>
            </div>
          </div>

          <div style={scrollerStyle(phone)}>
            <div style={rowStyle(phone)}>
              <Card t={t} title="Identity" grow>
                <TextRow t={t} label="Name" value={ship.name} />
                <TextRow t={t} label="MMSI" value={<span style={{ fontFamily: 'ui-monospace, monospace' }}>{ship.mmsi}</span>} />
                <TextRow t={t} label="IMO" value={ship.imo ? <span style={{ fontFamily: 'ui-monospace, monospace' }}>{ship.imo}</span> : <Empty t={t}>Not recorded</Empty>} />
                <TextRow t={t} label="Tracking since" value={new Date(ship.added_at).toLocaleString()} />
              </Card>

              <Card t={t} title={positionTitle} grow>
                <PingRows t={t} live={hasFix ? live : null} />
                {hasFix && <FixRows t={t} live={live!} />}
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${t.border}`, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <AisFeedLine feed={aisFeed} compact />
                  {!hasFix && (
                    <Empty t={t}>
                      aisstream.io's free feed only hears ships near its shore receivers, so a ship at sea or out of coverage stays silent until it comes in range. Its first ping will appear here, and is kept across restarts.
                    </Empty>
                  )}
                </div>
              </Card>
            </div>
          </div>
        </div>
      </div>
    </LayoutContext.Provider>
  )
}

/** "value, or a muted placeholder" — every live field is optional in AIS. */
function orEmpty(t: ReturnType<typeof useTheme>, v: string | null, placeholder = 'Unknown') {
  return v ?? <Empty t={t}>{placeholder}</Empty>
}

function FixRows({ t, live }: { t: ReturnType<typeof useTheme>; live: TrackedShipLive }) {
  const status = live.nav_status == null ? null : (NAV_STATUS_LABEL[live.nav_status] ?? `Code ${live.nav_status}`)
  return (
    <>
      <TextRow t={t} label="Speed" value={orEmpty(t, live.sog == null ? null : `${live.sog.toFixed(1)} kn`)} />
      <TextRow t={t} label="Course" value={orEmpty(t, live.cog == null ? null : `${live.cog.toFixed(0)}°`)} />
      <TextRow t={t} label="Heading" value={orEmpty(t, live.true_heading == null ? null : `${live.true_heading}°`, 'Not available')} />
      <TextRow t={t} label="Status" value={orEmpty(t, status)} />
    </>
  )
}

/** The two rows that always show, fix or not: when this ship was last heard
 *  and where. "Never" is a real answer, not a missing one. */
function PingRows({ t, live }: { t: ReturnType<typeof useTheme>; live: TrackedShipLive | null }) {
  const age = shipFixAge(live)
  const ping = live?.last_seen_utc
    ? <span style={{ color: age?.stale ? t.orange : t.green, fontWeight: 600 }}>{new Date(live.last_seen_utc).toLocaleString()}{age && ` (${age.label})`}</span>
    : <Empty t={t}>Never heard yet</Empty>
  const point = live && live.lat != null && live.lon != null
    ? <span style={{ fontFamily: 'ui-monospace, monospace' }}>{live.lat.toFixed(4)}, {live.lon.toFixed(4)}</span>
    : <Empty t={t}>None yet</Empty>
  return (
    <>
      <TextRow t={t} label="Last ping" value={ping} />
      <TextRow t={t} label="Last known point" value={point} />
    </>
  )
}
