/**
 * SegmentFanDiagram — the "which way do the cables actually go?" picture at the
 * top of a node's Full View. Mounted from NodeFullView.tsx (which is itself
 * opened from NodeInfoPanel), it draws the node as a circular icon in the
 * middle of a square SVG and fires one spoke out of it per segment that touches
 * the node.
 *
 * Why a fan rather than a mini-map: a map of one node and its neighbours is
 * mostly empty ocean, and at any zoom that fits a 12,000 km Pacific crossing
 * the 20 km backhaul hop into the city is a single pixel. The fan keeps the one
 * thing a mini-map gives you that a table does not — the true compass bearing
 * each cable leaves on — and moves everything else (who is at the far end, how
 * far away it is) into readable text. So spoke DIRECTION is real data; spoke
 * LENGTH is not, and is deliberately uniform.
 *
 * All the arithmetic lives in utils/nodeFanout.ts (`layoutSpokes`), which
 * filters the segment list down to the ones touching this node, orders them
 * clockwise from north, and — where two cables leave within ~26° of each other
 * and their labels would collide — pushes the later label out to a further
 * "tier" without moving the line. This file is only the drawing: it scales
 * nodeFanout's unit-circle coordinates into pixels and picks the colours.
 *
 * The two segment media are drawn differently rather than just in different
 * colours, because "is this cable wet or on land?" is the first question asked
 * of this view and colour alone fails for colour-blind readers and in print:
 *   - wet (submarine) = an undulating sine-wave path in the theme's blue
 *   - terrestrial     = a straight solid line in the theme's warm orange
 * A CLS will usually show both; a PoP inland normally shows only terrestrial
 * spokes, which is correct and not an error state.
 *
 * Every colour comes from the active theme or from mapGeometry's NODE_STYLE
 * (the same table the Leaflet map styles its markers with, so the centre icon
 * matches the dot the user just clicked on the map) — nothing is hard-coded, so
 * the diagram reads in dark, dusk and light themes alike.
 */
import { useMemo, useState } from 'react'
import type { CableNode, CableSegment } from '../types'
import { useTheme } from '../theme'
import { NODE_STYLE, NODE_TYPE_LABEL } from '../mapGeometry'
import { layoutSpokes, type Spoke } from '../utils/nodeFanout'
import { nodeLabel } from '../utils/nodeLabel'

interface Props {
  node: CableNode
  /** May be the whole network's segment list — layoutSpokes filters it. */
  segments: CableSegment[]
  nodesById: Record<string, CableNode>
  /** When given, each spoke becomes a navigation control that jumps to the far node. */
  onSelectNode?: (nodeId: string) => void
  /** Square viewport in px; the SVG scales down responsively below this. */
  size?: number
}

/** Height reserved at the bottom of the viewBox for the wet/terrestrial key. */
const LEGEND_H = 46
/** Breathing room between the furthest label and the edge of the viewBox. */
const EDGE_PAD = 8
/** Roughly how wide a character of the 10px label font is, for truncation. */
const CHAR_W = 5.4

/**
 * Trim a label to the width we reserved for it. Truncating is preferable to
 * letting text run out of the viewBox: the full text is always available in
 * the spoke's <title> tooltip, and the 4-alpha code — the part that identifies
 * the site uniquely — is at the front, so it never gets cut.
 */
function truncate(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : `${text.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`
}

/**
 * Polyline path for a wet segment: a sine wave running along the bearing from
 * radius `r0` to radius `r1`. The amplitude is tapered to zero at both ends
 * (the `f` term) so the wave meets the node icon and its end dot cleanly
 * instead of arriving mid-crest and looking like a kink in the line.
 */
function wavyPath(
  cx: number, cy: number,
  ux: number, uy: number,
  r0: number, r1: number,
  amp: number, wavelength: number,
): string {
  const px = -uy // unit normal to the bearing — the direction the wave swings in
  const py = ux
  const steps = Math.max(12, Math.round((r1 - r0) / 1.5))
  const pts: string[] = []
  for (let i = 0; i <= steps; i++) {
    const f = i / steps
    const r = r0 + (r1 - r0) * f
    const taper = Math.sin(Math.PI * f)
    const off = Math.sin(((r - r0) / wavelength) * Math.PI * 2) * amp * taper
    pts.push(`${(cx + ux * r + px * off).toFixed(2)},${(cy + uy * r + py * off).toFixed(2)}`)
  }
  return `M ${pts.join(' L ')}`
}

/** Pixel geometry shared by every spoke, derived once by the parent. */
interface FanGeometry {
  cx: number
  cy: number
  /** Radius of the centre icon, where the spokes start. */
  nodeR: number
  /** Radius the spokes end at. */
  spokeR: number
  /** Radius a tier-0 label anchor sits at; tiers multiply it. */
  labelR: number
  /** Character budget for the far-node label before it is truncated. */
  maxChars: number
}

/**
 * Props that turn a spoke group into a real navigation control (or into inert
 * decoration when the far node is not loaded and there is nowhere to go).
 * Built here rather than inline so a reader can see the whole keyboard/mouse
 * contract in one place: SVG elements get none of this for free.
 */
function navProps(active: boolean, select: () => void, label: string) {
  if (!active) return {}
  return {
    onClick: select,
    onKeyDown: (e: React.KeyboardEvent<SVGGElement>) => {
      // Space scrolls the page by default, so it has to be swallowed.
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select() }
    },
    tabIndex: 0,
    role: 'button',
    'aria-label': label,
    // The default focus ring is a rect around the group's bounding box, which
    // spans mostly empty canvas and reads as a stray white box. The group's
    // onFocus already raises the same highlight hover uses (thicker stroke,
    // brighter label), so that is the focus indicator instead.
    style: { cursor: 'pointer' as const, outline: 'none' as const },
  }
}

/**
 * The two lines of text at the end of a spoke, plus the leader line a tiered
 * label needs. Split out from FanSpoke because label placement (which side the
 * text hangs off, how far out the tier pushed it) is its own small problem.
 */
function FanSpokeLabel({ spoke, geo, hot, color, far, distance }: {
  spoke: Spoke
  geo: FanGeometry
  hot: boolean
  color: string
  far: string
  distance: string
}) {
  const t = useTheme()
  const { cx, cy, spokeR, labelR, maxChars } = geo
  const left = spoke.side === 'left'
  const ex = cx + spoke.x * spokeR
  const ey = cy + spoke.y * spokeR
  const ax = cx + spoke.labelX * labelR
  const ay = cy + spoke.labelY * labelR
  const textX = ax + (left ? -6 : 6)

  return (
    <>
      {/* A tiered label no longer sits at the end of its own line, so it needs
          a leader or the reader cannot tell which spoke it belongs to. */}
      {spoke.tier > 0 && (
        <line
          x1={ex} y1={ey}
          x2={ax - (ex - cx) * 0.02} y2={ay - (ey - cy) * 0.02}
          stroke={hot ? color : t.textFaintest}
          strokeWidth={1}
          strokeDasharray="2 3"
        />
      )}
      <text x={textX} y={ay - 2} textAnchor={left ? 'end' : 'start'} fontSize={10}
            fontWeight={600} fill={hot ? color : t.text}>
        {truncate(far, maxChars)}
      </text>
      <text x={textX} y={ay + 10} textAnchor={left ? 'end' : 'start'} fontSize={9}
            fill={hot ? t.text : t.textMuted}>
        {`${distance} · ${spoke.compass}`}
      </text>
    </>
  )
}

/**
 * One spoke: the line, its end dot, its (possibly tiered) label and — when the
 * far node can be navigated to — the click/keyboard target wrapping all three.
 * Kept as its own component because a spoke is a self-contained control, and
 * inlining it left the parent's render doing far too much at once.
 */
function FanSpoke({ spoke, geo, hot, onHover, onSelectNode }: {
  spoke: Spoke
  geo: FanGeometry
  hot: boolean
  onHover: (segmentId: string | null) => void
  onSelectNode?: (nodeId: string) => void
}) {
  const t = useTheme()
  const { cx, cy, nodeR, spokeR } = geo

  const wet = spoke.segment.type === 'wet'
  const color = wet ? t.blue : t.orange
  const stroke = hot ? 3 : 2
  // Only offer navigation when the far node is actually loaded — a spoke to an
  // id we cannot resolve has nowhere to jump to.
  const canSelect = Boolean(onSelectNode && spoke.other)

  const ex = cx + spoke.x * spokeR
  const ey = cy + spoke.y * spokeR
  // Spokes start clear of the node icon so the icon stays a clean disc.
  const sx = cx + spoke.x * (nodeR + 4)
  const sy = cy + spoke.y * (nodeR + 4)

  const far = nodeLabel(spoke.other, spoke.otherId)
  const distance = spoke.other ? `${Math.round(spoke.distanceKm).toLocaleString()} km` : 'distance unknown'
  const medium = wet ? 'wet' : 'terrestrial'
  // Parallel segments of the same medium to the same node share one spoke, so
  // say how many rather than silently drawing one of them.
  const n = spoke.segments.length
  const parallel = n > 1 ? ` · ×${n}` : ''
  const tip = n > 1
    ? `${n} ${medium} segments → ${far} · ${distance} · ${spoke.compass} ${Math.round(spoke.bearing)}°\n` +
      spoke.segments.map(sg => sg.name).join('\n')
    : `${spoke.segment.name} (${medium}) → ${far} · ${distance} · ${spoke.compass} ${Math.round(spoke.bearing)}°`

  return (
    <g
      {...navProps(canSelect, () => onSelectNode?.(spoke.otherId), `Go to ${far}, ${distance} ${spoke.compass}`)}
      onMouseEnter={() => onHover(spoke.segment.id)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(spoke.segment.id)}
      onBlur={() => onHover(null)}
    >
      <title>{tip}</title>

      {/* Invisible fat stroke so the pointer/hit area is usable without
          thickening the line the reader sees. */}
      <line x1={cx} y1={cy} x2={ex} y2={ey} stroke="transparent" strokeWidth={16} />

      {wet ? (
        <path d={wavyPath(cx, cy, spoke.x, spoke.y, nodeR + 4, spokeR, 3.4, 13)} fill="none"
              stroke={color} strokeWidth={stroke} strokeLinecap="round" />
      ) : (
        <line x1={sx} y1={sy} x2={ex} y2={ey}
              stroke={color} strokeWidth={stroke} strokeLinecap="round" />
      )}

      <circle cx={ex} cy={ey} r={hot ? 4 : 3} fill={color} />

      <FanSpokeLabel spoke={spoke} geo={geo} hot={hot} color={color} far={far} distance={distance + parallel} />
    </g>
  )
}

/**
 * The wet/terrestrial key along the bottom edge. Two samples drawn exactly the
 * way the spokes are drawn — a wave and a straight line — so the key is a
 * sample of the real thing rather than a description of it.
 */
function FanKey({ size, cx }: { size: number; cx: number }) {
  const t = useTheme()
  const ky = size - 18
  const sample = 26
  const gap = 10
  const wetLabel = 'Wet (submarine)'
  const landLabel = 'Terrestrial'
  const wetW = sample + gap + wetLabel.length * CHAR_W
  const landW = sample + gap + landLabel.length * CHAR_W
  const startX = Math.max(12, cx - (wetW + 24 + landW) / 2)
  const landX = startX + wetW + 24
  return (
    <>
      <line x1={12} y1={size - LEGEND_H + 8} x2={size - 12} y2={size - LEGEND_H + 8}
            stroke={t.border} strokeWidth={1} />
      <path d={wavyPath(startX, ky - 4, 1, 0, 0, sample, 2.6, 11)} fill="none"
            stroke={t.blue} strokeWidth={2} strokeLinecap="round" />
      <text x={startX + sample + gap} y={ky} fontSize={9} fill={t.textMuted}>{wetLabel}</text>
      <line x1={landX} y1={ky - 4} x2={landX + sample} y2={ky - 4}
            stroke={t.orange} strokeWidth={2} strokeLinecap="round" />
      <text x={landX + sample + gap} y={ky} fontSize={9} fill={t.textMuted}>{landLabel}</text>
    </>
  )
}

/**
 * Draws `node` as a coloured disc at the centre of a square SVG, with one
 * navigable spoke per segment touching it (see the file header for the layout
 * and colour-encoding rules). Renders a "no segments" placeholder instead of an
 * empty ring when `layoutSpokes` returns nothing.
 */
export function SegmentFanDiagram({ node, segments, nodesById, onSelectNode, size = 420 }: Props) {
  const t = useTheme()
  const [hovered, setHovered] = useState<string | null>(null)

  const spokes = useMemo(
    () => layoutSpokes(node, segments, nodesById),
    [node, segments, nodesById],
  )

  const style = NODE_STYLE[node.type] ?? NODE_STYLE.off_net

  // ── Geometry ───────────────────────────────────────────────────────────────
  // The centre sits above the mid-line because the legend eats the bottom strip.
  const cx = size / 2
  const cy = (size - LEGEND_H) / 2
  const nodeR = Math.round(size * 0.057)

  // Labels are the thing that overflows, not the lines, so the label radius is
  // derived from how much horizontal room is left after reserving a text
  // column on each side — and then divided by the deepest tier in play, since
  // nodeFanout multiplies a tiered label's radius by up to 1 + tier * 0.22.
  const textW = Math.max(96, size * 0.27)
  const maxTierFactor = spokes.reduce((m, s) => Math.max(m, Math.hypot(s.labelX, s.labelY)), 1)
  const labelR = Math.max(
    nodeR + 30,
    Math.min(size * 0.2, (size / 2 - textW - EDGE_PAD) / maxTierFactor),
  )
  const spokeR = Math.max(nodeR + 12, Math.min(size * 0.17, labelR - 16))
  const geo: FanGeometry = { cx, cy, nodeR, spokeR, labelR, maxChars: Math.floor(textW / CHAR_W) }

  const svgStyle = { width: '100%', height: 'auto', maxWidth: size, display: 'block' } as const

  // A node with nothing attached is a real and reportable state (a site that
  // exists in reference data but has no cable on it yet), so say so in words
  // rather than drawing a lone circle the reader has to interpret.
  if (spokes.length === 0) {
    return (
      <svg viewBox={`0 0 ${size} ${size}`} style={svgStyle} role="img"
           aria-label={`${nodeLabel(node)} has no segments`}>
        <rect x={0} y={0} width={size} height={size} fill={t.bgDeep} rx={8} />
        <text x={cx} y={size / 2 - 8} textAnchor="middle" fontSize={13} fill={t.textMuted}>
          No segments at this node
        </text>
        <text x={cx} y={size / 2 + 12} textAnchor="middle" fontSize={11} fill={t.textFaint}>
          {nodeLabel(node)}
        </text>
      </svg>
    )
  }

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      style={svgStyle}
      role="img"
      aria-label={`Compass fan of the ${spokes.length} segment${spokes.length === 1 ? '' : 's'} at ${nodeLabel(node)}`}
    >
      <rect x={0} y={0} width={size} height={size} fill={t.bgDeep} rx={8} />

      {/* Node type caption, parked in the corner where no label can reach. */}
      <text x={12} y={20} fontSize={10} fill={t.textFaint}>
        {NODE_TYPE_LABEL[node.type] ?? node.type}
      </text>

      {/* Compass ring: without it "the spokes are at true bearings" is a claim
          the picture never backs up. Faintest colour — it is a reference grid,
          not content. */}
      <circle cx={cx} cy={cy} r={spokeR} fill="none" stroke={t.textFaintest}
              strokeWidth={1} strokeDasharray="2 4" />
      {([['N', 0, -1], ['E', 1, 0], ['S', 0, 1], ['W', -1, 0]] as const).map(([mark, ux, uy]) => (
        <text
          key={mark}
          x={cx + ux * (spokeR + 11)}
          y={cy + uy * (spokeR + 11) + 3.5}
          textAnchor="middle"
          fontSize={9}
          fill={t.textFaintest}
        >
          {mark}
        </text>
      ))}

      {spokes.map(spoke => (
        <FanSpoke
          key={spoke.segment.id}
          spoke={spoke}
          geo={geo}
          hot={hovered === spoke.segment.id}
          onHover={setHovered}
          onSelectNode={onSelectNode}
        />
      ))}

      {/* ── Centre icon ──────────────────────────────────────────────────────
          The disc is filled with the card background rather than the node
          colour so the 4-alpha code inside it stays legible in every theme;
          the type is carried by the ring and a translucent tint instead. */}
      <circle cx={cx} cy={cy} r={nodeR} fill={t.bgCard} stroke={style.color} strokeWidth={3} />
      <circle cx={cx} cy={cy} r={nodeR - 3} fill={style.fill} opacity={0.18} />
      <text x={cx} y={cy + 4} textAnchor="middle" fontSize={11} fontWeight={700} fill={t.text}>
        {node.id}
      </text>

      <FanKey size={size} cx={cx} />
    </svg>
  )
}
