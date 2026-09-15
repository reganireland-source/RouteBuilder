/**
 * SegmentPathDiagram — the stylised picture of ONE segment, drawn at the top of
 * the segment Full View.
 *
 * Why a schematic rather than a mini-map: the same reason SegmentFanDiagram is
 * a fan. A real map of one cable is mostly empty ocean, and at a zoom that fits
 * an 8,000 km Pacific crossing the waypoints that shape it are a pixel apart.
 * This draws the segment the way a network diagram would: both end nodes as the
 * same circular icons the map uses, the cable running between them, and every
 * waypoint marked on it in its true PROPORTIONAL position along the path.
 *
 * So what IS real data here:
 *   - the number of waypoints and where each falls along the run, spaced by
 *     cumulative great-circle distance, so a waypoint two thirds of the way
 *     along is drawn two thirds of the way along;
 *   - the compass bearing written above the line (the true initial bearing from
 *     the A-end to the Z-end, the same figure the fan diagram fans by);
 *   - the node type of each end, through the icon's colour and size.
 * And what is NOT: the horizontal length is always the width of the box. A
 * scale that fits both a 20 km backhaul hop and a Pacific crossing makes one of
 * them invisible, so the distance is written on the line instead of drawn.
 *
 * The two media are drawn DIFFERENTLY rather than just in different colours,
 * matching SegmentFanDiagram exactly so the two diagrams read as one language:
 *   - wet (submarine) = an undulating sine-wave path in the theme's blue
 *   - terrestrial     = a straight solid line in the theme's warm orange
 * Colour alone fails for colour-blind readers and in print, which is why the
 * shape carries the meaning too.
 *
 * Every colour comes from the active theme or from mapGeometry's NODE_STYLE —
 * the same table the Leaflet map styles its markers with — so the end icons
 * match the dots on the map and the whole thing reads in dark, dusk and light.
 *
 * Mounted from: SegmentFullView.tsx.
 */
import type { CableNode, CableSegment } from '../types'
import { useTheme } from '../theme'
import { NODE_STYLE } from '../mapGeometry'
import { initialBearing, compassPoint } from '../utils/nodeFanout'
import { haversineKm } from '../utils/editorGeo'
import { nodeLabel } from '../utils/nodeLabel'

interface Props {
  segment: CableSegment
  /** A-end node, or undefined when it isn't in the loaded dataset. */
  start?: CableNode
  /** Z-end node, or undefined when it isn't in the loaded dataset. */
  end?: CableNode
  /** When given, clicking an end icon navigates to that node. */
  onSelectNode?: (nodeId: string) => void
  /** Nominal width in px; the SVG scales down responsively below this. */
  width?: number
  /**
   * Use the narrow viewBox. On a phone the wide box renders at about half
   * scale and its labels come out at ~5px; the compact box renders close to
   * 1:1 there, so the text stays the size it was designed to be.
   */
  compact?: boolean
}

/**
 * viewBox units, not pixels: the SVG scales to fit its container, so what these
 * really set is the PROPORTION of the picture each thing takes up. The font
 * sizes are fixed in the same units, which means the ratio between the box's
 * width and its rendered width is exactly the factor the text shrinks by.
 *
 * That is why there are two geometries rather than one. In a 900px-wide
 * landscape card the wide box renders at roughly 1:1 and 11-unit text is 11px.
 * In a 350px-wide phone card that same box renders at 0.5:1 and the text comes
 * out at 5px — unreadable. The compact box is narrow enough to render close to
 * 1:1 on a phone, so the labels stay the same real size and the picture simply
 * carries fewer of them across its width.
 */
interface Geometry {
  vbW: number
  vbH: number
  /** Baseline the cable runs along. */
  lineY: number
  /** Centre of each end icon. Inset well in from the edge because the CAPTION
   *  is centred under the icon, so the icon's distance from the edge is half
   *  the width the caption gets. */
  inset: number
  /** Peak deflection of the wet sine wave. */
  waveAmp: number
  /** Distance between wave crests. */
  waveLen: number
}

const WIDE: Geometry   = { vbW: 680, vbH: 196, lineY: 84, inset: 72, waveAmp: 7, waveLen: 46 }
const COMPACT: Geometry = { vbW: 380, vbH: 186, lineY: 78, inset: 58, waveAmp: 6, waveLen: 30 }

/** Roughly how wide a character of the 11px label font is, for truncation. */
const CHAR_W = 5.9

/** "3 waypoints", "1 waypoint", or "direct path" when there are none. */
function waypointStat(count: number): string {
  if (count === 0) return 'direct path'
  return count === 1 ? '1 waypoint' : `${count} waypoints`
}

/** Trim to the width reserved for it; the full text is in the <title>. The
 *  4-alpha code that identifies the site is at the front, so it never gets cut. */
function truncate(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : `${text.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`
}

/**
 * A sine wave from x0 to x1 along `y`, tapered to zero amplitude at both ends
 * so it meets the end icons cleanly instead of arriving mid-crest and looking
 * like a kink in the cable.
 */
function wavyPath(x0: number, x1: number, y: number, amp: number, wavelength: number): string {
  const span = x1 - x0
  const steps = Math.max(24, Math.round(span / 2))
  const pts: string[] = []
  for (let i = 0; i <= steps; i++) {
    const f = i / steps
    const x = x0 + span * f
    const taper = Math.sin(Math.PI * f)
    const off = Math.sin((span * f / wavelength) * Math.PI * 2) * amp * taper
    pts.push(`${x.toFixed(2)},${(y + off).toFixed(2)}`)
  }
  return `M ${pts.join(' L ')}`
}

/**
 * Where each waypoint sits along the run, as a 0-1 fraction of the total
 * great-circle path length. Returns evenly-spaced fractions when an endpoint is
 * missing (no coordinates to measure against) — the count is still true even
 * when the spacing can't be.
 */
export function waypointFractions(
  waypoints: [number, number][],
  start?: CableNode,
  end?: CableNode,
): number[] {
  if (waypoints.length === 0) return []
  if (!start || !end) return waypoints.map((_, i) => (i + 1) / (waypoints.length + 1))

  const pts: [number, number][] = [
    [start.lat, start.lng], ...waypoints, [end.lat, end.lng],
  ]
  // Cumulative distance to each point, so hop i's fraction is cum[i] / total.
  const cum: number[] = [0]
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + haversineKm(pts[i - 1], pts[i]))
  }
  const total = cum[cum.length - 1]
  // A zero-length path (both ends at the same coordinates) would divide by
  // zero; fall back to even spacing, which is all that is left to say.
  if (total <= 0) return waypoints.map((_, i) => (i + 1) / (waypoints.length + 1))
  return waypoints.map((_, i) => cum[i + 1] / total)
}

/** One end of the cable: the map's own node icon, with a two-line caption. */
function EndNode({ node, fallbackId, cx, anchor, onSelect, t, g }: {
  node?: CableNode
  fallbackId: string
  cx: number
  anchor: 'start' | 'end'
  onSelect?: () => void
  t: ReturnType<typeof useTheme>
  g: Geometry
}) {
  const style = node ? NODE_STYLE[node.type] : undefined
  const r = (style?.radius ?? 5) * 1.5
  const label = nodeLabel(node, fallbackId)
  const sub = [node?.city, node?.country].filter(Boolean).join(', ')
  const active = Boolean(onSelect && node)
  // The caption is centred under the icon, so it has half the box's edge
  // clearance on each side to play with.
  const maxChars = Math.floor((g.inset * 2) / CHAR_W)

  const nav = active
    ? {
        onClick: onSelect,
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect?.() }
        },
        role: 'button' as const,
        tabIndex: 0,
        style: { cursor: 'pointer' },
      }
    : {}

  return (
    <g {...nav} aria-label={active ? `Open ${label}` : undefined}>
      <title>{sub ? `${label} — ${sub}` : label}</title>
      <circle
        cx={cx} cy={g.lineY} r={r}
        fill={style?.fill ?? t.textFaint}
        stroke={style?.color ?? t.border}
        strokeWidth={2}
      />
      <text
        x={cx} y={g.lineY + r + 16} textAnchor="middle"
        fontSize={11} fontWeight={700} fill={active ? t.blue : t.text}
      >
        {truncate(label, maxChars)}
      </text>
      {sub && (
        <text x={cx} y={g.lineY + r + 29} textAnchor="middle" fontSize={9} fill={t.textFaint}>
          {truncate(sub, maxChars)}
        </text>
      )}
      {/* A/Z marker above the icon — which way round the segment is stored. */}
      <text x={cx} y={g.lineY - r - 8} textAnchor="middle" fontSize={9} fontWeight={800} fill={t.textFaintest}>
        {anchor === 'start' ? 'A-END' : 'Z-END'}
      </text>
    </g>
  )
}

export function SegmentPathDiagram({ segment, start, end, onSelectNode, width = 680, compact = false }: Props) {
  const t = useTheme()
  const g = compact ? COMPACT : WIDE
  const isWet = segment.type === 'wet'
  const lineColor = isWet ? t.blue : t.orange

  const x0 = g.inset
  const x1 = g.vbW - g.inset
  const waypoints = segment.waypoints ?? []
  const fractions = waypointFractions(waypoints, start, end)

  const bearing = start && end
    ? initialBearing([start.lat, start.lng], [end.lat, end.lng])
    : null

  const path = isWet
    ? wavyPath(x0, x1, g.lineY, g.waveAmp, g.waveLen)
    : `M ${x0},${g.lineY} L ${x1},${g.lineY}`

  const stats = [
    `${segment.length_km.toLocaleString()} km`,
    `${segment.latency} ms`,
    waypointStat(waypoints.length),
  ].join('   ·   ')

  return (
    <svg
      viewBox={`0 0 ${g.vbW} ${g.vbH}`}
      style={{ width: '100%', maxWidth: width, height: 'auto', display: 'block' }}
      role="img"
      aria-label={`${isWet ? 'Submarine' : 'Terrestrial'} segment ${segment.id}, ${segment.length_km} km, ${waypoints.length} waypoints`}
    >
      {/* Bearing, centred above the cable. Drawn before the line so the
          waypoint markers can never be overlapped by it. */}
      {bearing !== null && (
        <text x={g.vbW / 2} y={g.lineY - 30} textAnchor="middle" fontSize={10} fontWeight={700} fill={t.textFaint}>
          {`${compassPoint(bearing)}  ${Math.round(bearing)}°  →`}
        </text>
      )}

      {/* The cable itself. A soft halo underneath lifts it off the card
          background in every theme without needing a per-theme colour. */}
      <path d={path} fill="none" stroke={lineColor} strokeOpacity={0.22} strokeWidth={7} strokeLinecap="round" />
      <path d={path} fill="none" stroke={lineColor} strokeWidth={2.4} strokeLinecap="round" />

      {/* Waypoints, in proportional position. Diamonds rather than circles so
          they are never mistaken for the round node icons at the ends. */}
      {fractions.map((f, i) => {
        const x = x0 + (x1 - x0) * f
        const [wlat, wlng] = waypoints[i]
        return (
          <g key={`${wlat},${wlng},${i}`}>
            <title>{`Waypoint ${i + 1}: ${wlat.toFixed(4)}, ${wlng.toFixed(4)}`}</title>
            <rect
              x={x - 3.6} y={g.lineY - 3.6} width={7.2} height={7.2}
              transform={`rotate(45 ${x} ${g.lineY})`}
              fill={t.bgPanel} stroke={lineColor} strokeWidth={1.6}
            />
          </g>
        )
      })}

      <EndNode node={start} fallbackId={segment.start_node_id} cx={x0} anchor="start" t={t} g={g}
        onSelect={onSelectNode && start ? () => onSelectNode(start.id) : undefined} />
      <EndNode node={end} fallbackId={segment.end_node_id} cx={x1} anchor="end" t={t} g={g}
        onSelect={onSelectNode && end ? () => onSelectNode(end.id) : undefined} />

      {/* Stats line, and the medium key beneath it. */}
      <text x={g.vbW / 2} y={g.vbH - 34} textAnchor="middle" fontSize={11} fontWeight={600} fill={t.textMuted}>
        {stats}
      </text>
      <MediumKey isWet={isWet} t={t} g={g} />
    </svg>
  )
}

/** The wet/terrestrial key. Only the segment's OWN medium is drawn — this
 *  diagram shows one cable, so a two-row legend would be answering a question
 *  nobody asked. The sample is the real shape, not a colour swatch. */
function MediumKey({ isWet, t, g }: { isWet: boolean; t: ReturnType<typeof useTheme>; g: Geometry }) {
  const color = isWet ? t.blue : t.orange
  const y = g.vbH - 12
  const sampleX = g.vbW / 2 - 62
  const d = isWet
    ? wavyPath(sampleX, sampleX + 36, y - 3, 3, 18)
    : `M ${sampleX},${y - 3} L ${sampleX + 36},${y - 3}`
  return (
    <g>
      <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" />
      <text x={sampleX + 44} y={y} fontSize={10} fontWeight={700} fill={color} letterSpacing="0.05em">
        {isWet ? 'WET (SUBMARINE)' : 'TERRESTRIAL'}
      </text>
    </g>
  )
}
