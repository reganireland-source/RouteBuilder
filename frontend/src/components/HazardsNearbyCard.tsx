/**
 * HazardsNearbyCard — the hazard block inside a Node or Segment Full View.
 *
 * Renders NOTHING when there is nothing to report. That is deliberate and it is
 * the opposite of what the map's status panel does: the panel is the one place
 * that explains coverage, so a Full View showing "no hazards" would be claiming
 * an all-clear that these feeds cannot support — bushfire.io covers only
 * Australia, North America and Europe, and USGS only earthquakes. Silence here
 * means "nothing reported", and the panel is where you go to learn what that is
 * worth.
 *
 * Mounted from: NodeFullView.tsx and SegmentFullView.tsx.
 */
import type { Hazard } from '../types'
import { useTheme } from '../theme'
import { hazardDistanceKm } from '../context/HazardContext'
import { KIND_LABEL, SEVERITY_LABEL, severityColor } from './HazardLayer'
import { Card, Pill, type T } from './fullViewChrome'

interface Props {
  /** The hazards to list — already filtered to whatever is relevant to this asset. */
  hazards: Hazard[]
  /** Which kind of asset this card is attached to; passed through to hazardDistanceKm
   *  so it looks up the right proximity calculation. */
  kind: 'node' | 'segment'
  /** The node or segment's id, likewise passed through to hazardDistanceKm. */
  assetId: string
  /** Passed through to Card so it sits correctly in a Full View column. */
  grow?: boolean
}

/**
 * HazardsNearbyCard — see file header. Renders null (nothing at all, not even an
 * empty-state card) when `hazards` is empty, so a Full View with no hazards shows no
 * hazard section rather than a misleading "all clear".
 */
export function HazardsNearbyCard({ hazards, kind, assetId, grow = true }: Props) {
  const t = useTheme()
  if (hazards.length === 0) return null

  return (
    <Card t={t} title={`Hazards Nearby (${hazards.length})`} grow={grow}>
      {hazards.map(h => (
        <HazardRow key={h.id} t={t} hazard={h} kind={kind} assetId={assetId} />
      ))}
      <div style={{ fontSize: 11, color: t.textMuted, marginTop: 6, fontStyle: 'italic', lineHeight: 1.5 }}>
        Live third-party feeds — coverage is not worldwide. See the hazard panel on the map.
      </div>
    </Card>
  )
}

/** One hazard entry: severity pill, kind label, distance-to-asset (via
 *  hazardDistanceKm, when computable), title, clamped detail text and attribution/
 *  source link. */
function HazardRow({ t, hazard, kind, assetId }: {
  t: T; hazard: Hazard; kind: 'node' | 'segment'; assetId: string
}) {
  const color = severityColor(hazard.severity, t)
  const distance = hazardDistanceKm(hazard, kind, assetId)
  return (
    <div style={{
      borderLeft: `3px solid ${color}`, background: t.bgDeep, borderRadius: 4,
      padding: '6px 9px', marginBottom: 6,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <Pill color={color}>{SEVERITY_LABEL[hazard.severity]}</Pill>
        <span style={{ fontSize: 10, fontWeight: 700, color: t.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {KIND_LABEL[hazard.kind] ?? hazard.kind}
        </span>
        {distance !== null && (
          <span style={{ fontSize: 11, color: t.textMuted, marginLeft: 'auto', whiteSpace: 'nowrap' }}>
            {distance} km
          </span>
        )}
      </div>
      <div style={{ fontSize: 12, fontWeight: 600, color: t.text, marginTop: 3, wordBreak: 'break-word' }}>
        {hazard.title}
      </div>
      {hazard.detail && (
        <div style={{
          fontSize: 11, color: t.textMuted, marginTop: 3, lineHeight: 1.45,
          display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>
          {hazard.detail}
        </div>
      )}
      <div style={{ fontSize: 11, color: t.textMuted, marginTop: 4 }}>
        {hazard.attribution}
        {hazard.url && (
          <>
            {' · '}
            <a href={hazard.url} target="_blank" rel="noopener noreferrer" style={{ color: t.blue }}>source</a>
          </>
        )}
      </div>
    </div>
  )
}
