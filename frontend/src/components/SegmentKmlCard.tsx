/**
 * SegmentKmlCard — the surveyed route for one segment: what is on file, how it
 * compares to the stored figures, and (for admins) how to upload a new one.
 *
 * THE LENGTH COMPARISON IS THE POINT OF THIS CARD. A KML is measured along the
 * cable as actually laid, so it will not agree with the `length_km` the segment
 * carries — and that disagreement is useful. Routing deliberately keeps using
 * the stored value, so uploading a file never moves a route result; what it does
 * is turn every upload into a free check on a number that was previously
 * unfalsifiable. A 3% difference is slack and slope. A 40% difference means one
 * of the two is wrong, and now you can see it.
 *
 * The endpoint gaps are the other honest signal. A KML legitimately stops at the
 * beach manhole rather than inside the station, so a few km is normal; tens of
 * km usually means the file belongs to a different segment, and saying so here
 * is far cheaper than finding out from a map that looks subtly wrong.
 *
 * Split into three module-level pieces — details, upload, and the card holding
 * them — rather than one component with a branch down the middle. They are
 * genuinely separate concerns (one reads, one writes and is admin-only), and
 * keeping them apart is also what keeps each under the complexity ceiling.
 */
import { useRef, useState } from 'react'
import type { CableSegment, KmlPathInfo, KmlUploadResult } from '../types'
import type { T } from './fullViewChrome'
import { Card, Row } from './fullViewChrome'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'

interface Props {
  t: T
  segment: CableSegment
  /** What is already on file, from the network-wide simplified path fetch. */
  info?: KmlPathInfo
  /** Refetch hook so the map and this card pick up a new upload. */
  onUploaded?: () => void
}

/** Beyond this an endpoint is called out — see the module docstring. */
const ENDPOINT_WARN_KM = 10
/** Beyond this the surveyed and stored lengths are worth arguing about. */
const LENGTH_WARN_PCT = 15

/** How the map is drawing a cable that has no surveyed route on file. */
function approximationSource(waypointCount: number): string {
  if (waypointCount === 0) return 'endpoints as a straight line'
  return `${waypointCount} hand-placed waypoint${waypointCount === 1 ? '' : 's'}`
}

/** Percentage difference between the surveyed and stored lengths. */
function lengthDelta(kmlKm: number | null | undefined, storedKm: number): number | null {
  if (kmlKm == null || !storedKm) return null
  return ((kmlKm - storedKm) / storedKm) * 100
}

/** The read-only half: what is on file and how well it fits. */
function KmlDetails({ t, segment, info }: { t: T; segment: CableSegment; info: KmlPathInfo }) {
  const delta = lengthDelta(info.length_km, segment.length_km)
  const deltaLarge = delta != null && Math.abs(delta) > LENGTH_WARN_PCT
  const deltaSign = delta != null && delta >= 0 ? '+' : ''
  const gap = Math.max(info.a_end_gap_km ?? 0, info.z_end_gap_km ?? 0)
  const gapSuspect = gap > ENDPOINT_WARN_KM
  const note: React.CSSProperties = { fontSize: 11, color: t.orange, margin: '4px 0 8px', lineHeight: 1.5 }

  return (
    <>
      <Row t={t} label="On file">
        <span style={{ color: t.green, fontWeight: 700 }}>KMZ v{info.version}</span>
        <span style={{ color: t.textFaint }}> · {info.point_count.toLocaleString()} surveyed points</span>
      </Row>
      <Row t={t} label="Drawn at">
        {info.display_path.length} points
        <span style={{ color: t.textFaint }}> (simplified for the map; full detail on request)</span>
      </Row>
      <Row t={t} label="Length (surveyed)">
        {info.length_km != null ? `${info.length_km.toLocaleString()} km` : '—'}
        {delta != null && (
          <span style={{ color: deltaLarge ? t.orange : t.textFaint, marginLeft: 8 }}>
            {deltaSign}{delta.toFixed(1)}% vs stored {segment.length_km.toLocaleString()} km
          </span>
        )}
      </Row>
      {deltaLarge && (
        <div style={note}>
          The surveyed length and the stored length disagree by more than {LENGTH_WARN_PCT}%.
          Routing still uses the stored figure — nothing has changed — but one of
          the two is likely wrong.
        </div>
      )}
      <Row t={t} label="Endpoints">
        <span style={{ color: gapSuspect ? t.orange : t.text }}>
          A {info.a_end_gap_km?.toFixed(1) ?? '?'} km · Z {info.z_end_gap_km?.toFixed(1) ?? '?'} km from nodes
        </span>
      </Row>
      {gapSuspect && (
        <div style={note}>
          An end sits {gap.toFixed(0)} km from its node. A few km is normal — a KML
          often stops at the beach manhole rather than inside the station — but this
          far out usually means the file belongs to another segment.
        </div>
      )}
      {info.reversed && (
        <Row t={t} label="Direction">
          <span style={{ color: t.textFaint }}>File was drawn Z→A and was turned round on import</span>
        </Row>
      )}
      {info.point_markers > 0 && (
        <Row t={t} label="Placemarks">
          {info.point_markers} point{info.point_markers === 1 ? '' : 's'} stored
          <span style={{ color: t.textFaint }}> (BMH, repeaters — not drawn yet)</span>
        </Row>
      )}
      <div style={{ marginTop: 8 }}>
        <a href={api.kmlDownloadUrl(info.link_id)} style={{ fontSize: 11, color: t.blue, textDecoration: 'none' }}>
          ⬇ Download original file
        </a>
      </div>
    </>
  )
}

/** The write half. Admin-only; every upload is a new version, never a replace. */
function KmlUpload({ t, segment, info, onUploaded }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<KmlUploadResult | null>(null)

  let label = '⬆ Upload KMZ / KML'
  if (busy) label = 'Uploading…'
  else if (info) label = '⬆ Upload new version'

  async function upload(file: File) {
    setBusy(true); setError(null); setResult(null)
    try {
      setResult(await api.uploadKml(segment.id, file))
      onUploaded?.()
    } catch (e) {
      // A multi-path file comes back as a 409 carrying its candidates. Showing
      // that message is the point — picking one silently would attach a
      // neighbouring cable's route and look entirely plausible on the map.
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${t.border}` }}>
      <input
        ref={fileRef}
        type="file"
        accept=".kmz,.kml,application/vnd.google-earth.kmz,application/vnd.google-earth.kml+xml"
        style={{ display: 'none' }}
        onChange={e => {
          const f = e.target.files?.[0]
          if (f) void upload(f)
          e.target.value = ''   // so re-picking the same file still fires
        }}
      />
      <button
        onClick={() => fileRef.current?.click()}
        disabled={busy}
        style={{
          padding: '7px 12px', borderRadius: 6, fontSize: 12, fontWeight: 700,
          fontFamily: 'inherit', cursor: busy ? 'default' : 'pointer',
          border: `1px solid ${t.blue}`, background: t.blue + '18', color: t.blue,
        }}
      >{label}</button>
      {info && (
        <div style={{ fontSize: 10, color: t.textFaint, marginTop: 5 }}>
          Uploading keeps v{info.version}; nothing is overwritten.
        </div>
      )}
      {error && <div style={{ fontSize: 11, color: t.red, marginTop: 8, lineHeight: 1.5 }}>{error}</div>}
      {result && (
        <div style={{ fontSize: 11, color: t.green, marginTop: 8, lineHeight: 1.5 }}>
          Attached as v{result.version} — {result.point_count.toLocaleString()} points,
          {' '}{result.length_km?.toLocaleString()} km
          {result.reversed && ' (turned round to run A→Z)'}
          {result.needs_review && (
            <span style={{ color: t.orange }}>
              {' '}· endpoints are further from the nodes than expected, worth a check
            </span>
          )}
        </div>
      )}
    </div>
  )
}

export function SegmentKmlCard({ t, segment, info, onUploaded }: Props) {
  const { isAdmin } = useAuth()
  return (
    <Card key="kml" t={t} title="Surveyed Route (KML)" grow>
      {info ? (
        <KmlDetails t={t} segment={segment} info={info} />
      ) : (
        <div style={{ fontSize: 12, color: t.textMuted, lineHeight: 1.6 }}>
          No surveyed route on file. The map draws this cable from its{' '}
          {approximationSource(segment.waypoints?.length ?? 0)}, which is an
          approximation for display, not a record of where the cable was laid.
        </div>
      )}
      {isAdmin && <KmlUpload t={t} segment={segment} info={info} onUploaded={onUploaded} />}
    </Card>
  )
}
