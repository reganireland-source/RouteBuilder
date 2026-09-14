/**
 * ============================================================================
 *  ProductHistory.tsx — the "Product History" metro map (UserGuide page 9).
 * ============================================================================
 *
 * A stylised vertical timeline of how RouteBuilder was built, drawn as a metro
 * map: every capability *category* (architecture, data, algorithms, front end,
 * security, AI, docs) is a coloured LINE, and every shipped capability is a
 * STATION on that line. Reading top to bottom you travel forward through time;
 * reading left to right across the rails you see which parts of the product
 * were being worked on in the same month.
 *
 * Why a metro map rather than a plain list: the shape of the work is the point.
 * Months where four rails all have stations were sprints; months where only one
 * rail is busy were focused pushes. INTENSITY on each month drives how loudly
 * that band is drawn (see MonthBand), so periods of heavy iteration are visible
 * before you read a single word.
 *
 * The styling is deliberately 2D-pixel-game — chunky 4px borders, uppercase
 * monospace, hard-edged colours and `steps()` easing on every animation so
 * nothing tweens smoothly — to match the animated pixel splash screen
 * (public/splash-animated.svg) the app opens with.
 *
 * Content note: MILESTONES is a hand-curated reading of the project's real
 * history — the numbered migration ladder in backend/app/db.py (m001-m060,
 * which is the country-by-country network build) plus the git log. Dates are
 * month-accurate, not day-accurate, which is all a timeline at this altitude
 * needs.
 *
 * Mounted from: UserGuide.tsx (page 9, "🕹 Product History").
 * ============================================================================
 */
import { useState, useEffect } from 'react'
import { useTheme } from '../theme'

// ── Categories = the coloured lines of the metro map ────────────────────────
// `rail` is the column index each line occupies in the left-hand gutter; it is
// what makes parallel lines read as a metro map rather than a single spine.
interface Category {
  id: string
  label: string
  icon: string
  color: string
  rail: number
  blurb: string
}

const CATEGORIES: Category[] = [
  { id: 'arch',  label: 'Architecture', icon: '🏗', color: '#a78bfa', rail: 0, blurb: 'Platform shape — storage, migrations, modes, build plumbing.' },
  { id: 'data',  label: 'Network Data', icon: '🗄', color: '#22d3ee', rail: 1, blurb: 'The cable network itself — nodes, segments, capacity, geography.' },
  { id: 'algo',  label: 'Algorithms',   icon: '🧭', color: '#f59e0b', rail: 2, blurb: 'Pathfinding, diversity, scoring and route ranking.' },
  { id: 'ui',    label: 'Front End',    icon: '🎨', color: '#f472b6', rail: 3, blurb: 'Map, panels, interaction design and visual polish.' },
  { id: 'sec',   label: 'Security',     icon: '🛡', color: '#4ade80', rail: 4, blurb: 'Auth, hardening, static analysis and enterprise IT readiness.' },
  { id: 'ai',    label: 'AI',           icon: '🤖', color: '#60a5fa', rail: 5, blurb: 'Natural language search and model-assisted data entry.' },
  { id: 'docs',  label: 'Docs & Export',icon: '📄', color: '#94a3b8', rail: 6, blurb: 'Diagrams, PDFs, the in-app guide and handover material.' },
]

const CAT_BY_ID: Record<string, Category> = Object.fromEntries(CATEGORIES.map(c => [c.id, c]))

/**
 * For one month's list of stations, work out which rows each category's line
 * should be drawn bright on: every row from that category's first station to
 * its last. Without this a line with stations on rows 0 and 3 renders as two
 * disconnected dashes instead of one run of track.
 */
function railSpans(milestones: { cat: string }[]): Set<string>[] {
  const first: Record<string, number> = {}
  const last: Record<string, number> = {}
  milestones.forEach((m, i) => {
    if (first[m.cat] === undefined) first[m.cat] = i
    last[m.cat] = i
  })
  return milestones.map((_, i) => {
    const live = new Set<string>()
    for (const cat of Object.keys(first)) {
      if (i >= first[cat] && i <= last[cat]) live.add(cat)
    }
    return live
  })
}

// ── Milestones ──────────────────────────────────────────────────────────────
interface Milestone {
  cat: string
  icon: string
  title: string
  detail: string
  /** Rendered as a "★" station — the month's headline capability. */
  major?: boolean
}

interface Month {
  key: string
  label: string
  sub: string
  /** 1 = quiet, 2 = steady, 3 = sprint, 4 = peak. Drives the intensity bar. */
  intensity: 1 | 2 | 3 | 4
  era: string
  milestones: Milestone[]
}

const MONTHS: Month[] = [
  {
    key: '2026-02', label: 'FEB', sub: '2026', intensity: 2, era: 'Genesis',
    milestones: [
      { cat: 'arch', icon: '⚡', title: 'FastAPI + React foundation', detail: 'A Python/FastAPI backend behind a Vite + React + TypeScript front end, with Leaflet for the map. The split that everything since has been built on.', major: true },
      { cat: 'arch', icon: '🧱', title: 'JSONB document store', detail: 'Postgres used as a document store rather than a relational schema, so the network model could keep changing shape without an ALTER TABLE for every idea. A JSON-file fallback mode runs the whole app with no database at all.' },
      { cat: 'algo', icon: '🧭', title: 'The graph and the pathfinder', detail: 'Nodes and segments loaded into an in-memory graph; k-shortest-paths search over it. The engine every route in the product still comes out of.', major: true },
    ],
  },
  {
    key: '2026-03', label: 'MAR', sub: '2026', intensity: 2, era: 'Genesis',
    milestones: [
      { cat: 'data', icon: '🗺', title: 'The network data model', detail: 'Cable systems, nodes (landing stations, PoPs, branching units), segments and per-segment capacity — the four tables the entire product reads from.', major: true },
      { cat: 'arch', icon: '🪜', title: 'The migration ladder', detail: 'Numbered, run-once migrations (m001, m002, …) so real edits to live topology could ship safely and in order. It would eventually reach m060.' },
      { cat: 'data', icon: '🇵🇭', title: 'Philippines & Hong Kong built out', detail: 'The first two markets modelled properly — cable-specific landing stations, terrestrial backhaul, capacity. m003 through m012.' },
    ],
  },
  {
    key: '2026-04', label: 'APR', sub: '2026', intensity: 3, era: 'Diversity Sprint',
    milestones: [
      { cat: 'algo', icon: '🔀', title: 'The diversity engine', detail: 'Wet, Full, Full-Node and the terrestrial variants — worker/protect pairs that provably share nothing, which is the reason the product exists.', major: true },
      { cat: 'algo', icon: '📊', title: 'Route scoring', detail: 'Latency, distance, availability, hop count and a commercial margin score, all sortable, so a route can be argued for on more than one axis.' },
      { cat: 'data', icon: '🇸🇬', title: 'Singapore built out', detail: 'Every Singapore landing station and PoP, plus 21 terrestrial segments. m013 through m029.' },
      { cat: 'ui',   icon: '〰', title: 'Curved cables on the map', detail: 'Catmull-Rom spline smoothing over waypoints, and Pacific-normalised longitudes so cables cross the antimeridian without wrapping the map.' },
    ],
  },
  {
    key: '2026-05', label: 'MAY', sub: '2026', intensity: 3, era: 'APAC Sprint',
    milestones: [
      { cat: 'data', icon: '🌏', title: 'Japan, Korea and Taiwan', detail: 'The rest of North Asia — new landing stations, re-landed wet systems, terrestrial backhaul, the RNAL system added and APCN2 retired. m033 through m052.', major: true },
      { cat: 'data', icon: '🧭', title: 'Cables stop crossing land', detail: 'A geography pass adding waypoints to every subsea segment that clipped a coastline, so the drawn route matches the real one. m053.' },
      { cat: 'docs', icon: '📐', title: 'Straight-line diagram export', detail: 'Pin up to five routes and export a branded SLD as PDF, or as DrawIO/Visio XML that stays editable.', major: true },
      { cat: 'arch', icon: '📁', title: 'Solution Projects', detail: 'Saved designs with their own notes and categories, so a piece of work survives the browser session. m054 through m056.' },
    ],
  },
  {
    key: '2026-06', label: 'JUN', sub: '2026', intensity: 2, era: 'Data Integrity',
    milestones: [
      { cat: 'data', icon: '🔧', title: 'The last land crossings', detail: 'Five stubborn segments re-routed through the Sulu Sea, Taiwan Strait and Korea Strait, then the Malay Peninsula, Arabian and Mediterranean corridors. m057 through m059.' },
      { cat: 'arch', icon: '💾', title: 'Postgres → JSON dump', detail: 'An admin endpoint that writes live database state back to the seed files, so the JSON snapshot could never drift behind sixty migrations again.' },
      { cat: 'ui',   icon: '🗺', title: 'Switchable basemaps', detail: 'An admin toggle between Google Maps and OSM tiles, with a live status light in the health bar when a tile source stops answering.' },
    ],
  },
  {
    key: '2026-07', label: 'JUL', sub: '2026', intensity: 4, era: 'Hardening Sprint',
    milestones: [
      { cat: 'sec',  icon: '🛡', title: 'Enterprise security uplift', detail: 'Fail-closed auth, a content security policy, a rate limiter, a request body cap and an access log — written to pass an enterprise IT review, not to look secure.', major: true },
      { cat: 'sec',  icon: '🅰', title: 'Security A, Reliability A', detail: 'A full SonarQube remediation: every bug and vulnerability closed, Docker hardened, 41 accessibility findings fixed, and each accepted exclusion written down with its reasoning so IT inherits the argument.', major: true },
      { cat: 'ai',   icon: '👁', title: 'AI Outage Parser', detail: 'Paste a screenshot of an outage notice and a vision model turns it into structured fault records — including a live token counter while it thinks.', major: true },
      { cat: 'data', icon: '📅', title: 'Planned Events', detail: 'Scheduled maintenance modelled alongside faults, with its own map overlay and viewer.' },
      { cat: 'docs', icon: '📝', title: 'The great comment pass', detail: 'Verbose plain-English headers across every module, plus a developer guide — so the codebase could be handed to someone else.' },
      { cat: 'ui',   icon: '🏛', title: 'RouteSuite portal', detail: 'A pixel world-map landing page tying RouteBuilder to the wider suite.' },
    ],
  },
  {
    key: '2026-08', label: 'AUG', sub: '2026', intensity: 1, era: 'Consolidation',
    milestones: [
      { cat: 'algo', icon: '⚠', title: 'Events reach the results', detail: 'Planned events surface on route cards with a lighter treatment than hard faults, so a maintenance window reads differently to an outage.' },
      { cat: 'docs', icon: '📘', title: 'The guide catches up', detail: 'The in-app guide and its PDF export rewritten around everything the previous month had shipped.' },
    ],
  },
  {
    key: '2026-09', label: 'SEP', sub: '2026', intensity: 4, era: 'The Visual Era',
    milestones: [
      { cat: 'ui',   icon: '🛰', title: 'Readable basemaps', detail: 'CARTO started gating its tiles behind an API key — and served a watermarked image with an HTTP 200, which fooled the health check. Moved to Esri, which also renders East Asian place names in English.' },
      { cat: 'ui',   icon: '✨', title: 'Routes that glow', detail: 'A selected route pulses at 1 Hz; hovering a row in the segment breakdown spotlights that segment on the map in orange-red. Finding the route you are reading about stopped being work.', major: true },
      { cat: 'data', icon: '🛣', title: 'Australian backhaul on real highways', detail: 'Waypoints added to the long cross-country terrestrial hauls so they follow the Eyre, Stuart and Nullarbor corridors instead of cutting across the Bight.' },
      { cat: 'data', icon: '📆', title: 'Ready For Service dates', detail: 'Every system and segment now carries an RFS status and quarter, backfilled to in-service — the data model groundwork for routing over a future network.' },
      { cat: 'arch', icon: '🕹', title: 'Visual Network Editor', detail: 'A dedicated admin mode where topology is edited on the map: drag a node, drag a cable path into shape, click two nodes to create a segment. Every change is staged locally with undo/redo and written only when you press Save All.', major: true },
      { cat: 'ui',   icon: '🚦', title: 'Traffic-light saves', detail: 'The editor narrates every write as it happens — queued, in flight, saved, failed — with a progress bar and an expandable log, because a batch of waypoint writes is slow enough to need it.' },
    ],
  },
]

const RAIL_W = 20            // px between adjacent metro lines
const GUTTER = CATEGORIES.length * RAIL_W + 14
const ROW_H = 78             // px per station row — also the rail segment length

// On a phone the seven-lane gutter would eat half the width and leave the
// station titles wrapping two words to a line, so below this width the map
// collapses to a single spine that takes the colour of each station's line.
// The month bands and intensity meters are unchanged — only the gutter gives.
const NARROW_PX = 620

function useNarrow() {
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < NARROW_PX,
  )
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${NARROW_PX - 1}px)`)
    const onChange = () => setNarrow(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return narrow
}

/** Chunky pixel-game border: a hard 3px edge with a 1px inner highlight. */
function pixelBorder(color: string) {
  return { border: `3px solid ${color}`, borderRadius: 0, boxShadow: `inset 0 0 0 1px ${color}33` }
}

// ── The animated pixel starfield behind the whole page ──────────────────────
// Fixed positions (not random) so the field is identical on every render and
// doesn't twitch when React re-renders a station.
const STARS = Array.from({ length: 54 }, (_, i) => ({
  x: (i * 37) % 100,
  y: (i * 61) % 100,
  d: 1.2 + ((i * 7) % 5) * 0.4,
  s: i % 5 === 0 ? 3 : 2,
}))

function Starfield() {
  return (
    <div aria-hidden style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', opacity: 0.3 }}>
      {STARS.map((s, i) => (
        <span key={i} style={{
          position: 'absolute', left: `${s.x}%`, top: `${s.y}%`,
          width: s.s, height: s.s, background: '#cdd6f4',
          animation: `rb-ph-twinkle ${s.d}s steps(2, end) infinite`,
          animationDelay: `${(i % 7) * 0.3}s`,
        }} />
      ))}
    </div>
  )
}

// ── One month's header band ─────────────────────────────────────────────────
// The intensity bar is the "how hard was this month" signal: a 4-cell pixel
// meter, filled cells coloured by level, and at level 4 the whole band pulses.
function MonthBand({ month, t }: { month: Month; t: ReturnType<typeof useTheme> }) {
  const intensityColor = month.intensity >= 4 ? '#f43f5e' : month.intensity === 3 ? '#f59e0b' : month.intensity === 2 ? '#38bdf8' : t.textFaint
  const intensityWord = month.intensity >= 4 ? 'PEAK SPRINT' : month.intensity === 3 ? 'SPRINT' : month.intensity === 2 ? 'STEADY BUILD' : 'QUIET MONTH'

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '9px 12px', margin: '34px 0 16px',
      background: `${intensityColor}14`,
      ...pixelBorder(intensityColor),
      animation: month.intensity >= 4 ? 'rb-ph-band 1.4s steps(2, end) infinite' : undefined,
      position: 'relative', zIndex: 1,
    }}>
      <div style={{
        fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 22, fontWeight: 800,
        color: intensityColor, letterSpacing: '0.08em', lineHeight: 1,
      }}>{month.label}</div>
      <div style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11, color: t.textFaint, letterSpacing: '0.1em' }}>{month.sub}</div>

      <div style={{ width: 3, alignSelf: 'stretch', background: `${intensityColor}55` }} />

      <div style={{ flex: 1, fontSize: 12, fontWeight: 700, color: t.text, letterSpacing: '0.04em' }}>{month.era}</div>

      {/* 4-cell pixel intensity meter */}
      <div style={{ display: 'flex', gap: 3 }} title={`${intensityWord} — ${month.milestones.length} capabilities shipped`}>
        {[1, 2, 3, 4].map(n => (
          <span key={n} style={{
            width: 12, height: 14,
            background: n <= month.intensity ? intensityColor : 'transparent',
            border: `2px solid ${n <= month.intensity ? intensityColor : `${intensityColor}44`}`,
            animation: n <= month.intensity && month.intensity >= 4 ? `rb-ph-meter 0.9s steps(2, end) infinite` : undefined,
            animationDelay: `${n * 0.12}s`,
          }} />
        ))}
      </div>
      <div style={{
        fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 9, fontWeight: 800,
        color: intensityColor, letterSpacing: '0.12em', minWidth: 86, textAlign: 'right',
      }}>{intensityWord}</div>
    </div>
  )
}

// ── One station on the map ──────────────────────────────────────────────────
function Station({ ms, live, open, onToggle, narrow, t }: {
  ms: Milestone
  /** Category ids whose line is "in service" on this row — see railSpans. */
  live: Set<string>
  open: boolean; onToggle: () => void; narrow: boolean; t: ReturnType<typeof useTheme>
}) {
  const cat = CAT_BY_ID[ms.cat]
  const gutter = narrow ? 34 : GUTTER
  const x = narrow ? 10 : cat.rail * RAIL_W + 10

  return (
    <div style={{ position: 'relative', minHeight: narrow ? 96 : ROW_H, paddingLeft: gutter }}>
      {/* Rails: every category has a lane in the gutter. A lane is drawn bright
          on every row between that category's first and last station in the
          month (so the line is one continuous run, like a real metro line) and
          ghosted elsewhere, which keeps the lanes visible without implying a
          service that isn't there. Narrow layouts get one spine instead, taking
          the colour of whichever line this station is on. */}
      {narrow ? (
        <span aria-hidden style={{
          position: 'absolute', top: 0, bottom: 0, left: 10, width: 3, marginLeft: -1,
          background: cat.color,
        }} />
      ) : CATEGORIES.map(c => (
        <span key={c.id} aria-hidden style={{
          position: 'absolute', top: 0, bottom: 0, left: c.rail * RAIL_W + 10,
          width: 3, marginLeft: -1,
          background: live.has(c.id) ? c.color : `${c.color}1c`,
        }} />
      ))}

      {/* The station marker itself — a square (pixel) interchange for major
          milestones, a plain dot otherwise. */}
      <button
        onClick={onToggle}
        title={`${cat.label} — ${ms.title}`}
        style={{
          position: 'absolute', left: x, top: 16, transform: 'translateX(-50%)',
          width: ms.major ? 17 : 13, height: ms.major ? 17 : 13,
          padding: 0, cursor: 'pointer',
          background: open ? cat.color : t.bgDeep,
          border: `3px solid ${cat.color}`,
          borderRadius: ms.major ? 0 : '50%',
          boxShadow: ms.major ? `0 0 0 3px ${cat.color}33` : undefined,
          animation: ms.major ? 'rb-ph-pop 1.8s steps(2, end) infinite' : undefined,
          zIndex: 2,
        }}
      />

      {/* Elbow from the station out to its card */}
      <span aria-hidden style={{
        position: 'absolute', left: x, top: 23, width: gutter - x - 8, height: 3,
        background: `linear-gradient(90deg, ${cat.color}, ${cat.color}22)`,
      }} />

      <button
        onClick={onToggle}
        style={{
          display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer',
          background: open ? `${cat.color}12` : 'transparent',
          border: `3px solid ${open ? cat.color : 'transparent'}`,
          borderRadius: 0, padding: open ? '9px 12px' : '9px 12px',
          fontFamily: 'inherit', color: 'inherit',
          transition: 'background 0.12s steps(2, end)',
        }}
      >
        {/* Narrow: the line name drops onto its own row above the title, so the
            title gets the full width instead of two words per line. */}
        {narrow && (
          <div style={{
            fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 9, fontWeight: 700,
            letterSpacing: '0.1em', color: cat.color, opacity: 0.85, marginBottom: 3,
          }}>{cat.icon} {cat.label.toUpperCase()}</div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 4, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 17, lineHeight: 1, filter: 'saturate(1.3)' }}>{ms.icon}</span>
          <span style={{ fontSize: 14, fontWeight: 800, color: t.text, letterSpacing: '-0.01em' }}>{ms.title}</span>
          {ms.major && (
            <span style={{
              fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 8, fontWeight: 800,
              letterSpacing: '0.12em', color: cat.color, border: `2px solid ${cat.color}`,
              padding: '1px 4px',
            }}>★ MAJOR</span>
          )}
          {!narrow && <>
            <span style={{ flex: 1 }} />
            <span style={{
              fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 9, fontWeight: 700,
              letterSpacing: '0.1em', color: cat.color, opacity: 0.85, whiteSpace: 'nowrap',
            }}>{cat.icon} {cat.label.toUpperCase()}</span>
          </>}
        </div>
        {/* Collapsed: exactly one line, clipped with an ellipsis rather than a
            max-height cut (which sliced descenders in half). */}
        <div style={open
          ? { fontSize: 12, lineHeight: 1.6, color: t.textMuted }
          : {
              fontSize: 12, lineHeight: 1.6, color: t.textFaint,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }
        }>{ms.detail}</div>
        {!open && (
          <div style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 9, color: t.textFaintest, letterSpacing: '0.1em', marginTop: 3 }}>
            ▸ PRESS TO READ
          </div>
        )}
      </button>
    </div>
  )
}

// ── The legend: the metro map's line key ────────────────────────────────────
function Legend({ t }: { t: ReturnType<typeof useTheme> }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(168px, 1fr))', gap: 8,
      marginBottom: 10, position: 'relative', zIndex: 1,
    }}>
      {CATEGORIES.map(c => (
        <div key={c.id} title={c.blurb} style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '7px 9px',
          background: `${c.color}0e`, ...pixelBorder(`${c.color}88`),
        }}>
          <span style={{ width: 4, height: 20, background: c.color }} />
          <span style={{ fontSize: 13 }}>{c.icon}</span>
          <span style={{
            fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 9.5, fontWeight: 800,
            letterSpacing: '0.09em', color: t.text,
          }}>{c.label.toUpperCase()}</span>
        </div>
      ))}
    </div>
  )
}

interface Props {
  /** Rendered for the print/PDF version: no animation, everything expanded. */
  printMode?: boolean
}

export function ProductHistory({ printMode = false }: Props) {
  const t = useTheme()
  const narrow = useNarrow()
  const [open, setOpen] = useState<string | null>(null)
  const [filter, setFilter] = useState<string | null>(null)

  const total = MONTHS.reduce((n, m) => n + m.milestones.length, 0)
  const majors = MONTHS.reduce((n, m) => n + m.milestones.filter(x => x.major).length, 0)

  const visibleMonths = MONTHS.map(m => ({
    ...m,
    milestones: filter ? m.milestones.filter(x => x.cat === filter) : m.milestones,
  })).filter(m => m.milestones.length > 0)

  return (
    <div style={{
      maxWidth: 880, margin: '0 auto', padding: '0 16px 70px',
      fontFamily: 'system-ui, sans-serif', color: t.text, position: 'relative',
    }}>
      {/* All animation is steps()-eased so nothing tweens smoothly — the whole
          page should feel like it is running at 8 frames per second. */}
      {!printMode && <style>{`
        @keyframes rb-ph-twinkle { 0%, 100% { opacity: 0.15 } 50% { opacity: 1 } }
        @keyframes rb-ph-band    { 0%, 100% { filter: brightness(1) } 50% { filter: brightness(1.35) } }
        @keyframes rb-ph-meter   { 0%, 100% { opacity: 1 } 50% { opacity: 0.45 } }
        @keyframes rb-ph-pop     { 0%, 100% { transform: translateX(-50%) scale(1) } 50% { transform: translateX(-50%) scale(1.22) } }
        @keyframes rb-ph-train   { 0% { top: -10px } 100% { top: 100% } }
        @keyframes rb-ph-blink   { 0%, 100% { opacity: 1 } 50% { opacity: 0.25 } }
      `}</style>}

      {!printMode && <Starfield />}

      {/* ── Title card ──────────────────────────────────────────────────── */}
      <div style={{
        position: 'relative', zIndex: 1, marginBottom: 18, padding: '18px 20px',
        background: t.bgDeep, ...pixelBorder(t.blue),
      }}>
        <div style={{
          fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 9, fontWeight: 800,
          letterSpacing: '0.22em', color: t.blue, marginBottom: 7,
        }}>▚▚ ROUTEBUILDER ▚▚</div>
        <h2 style={{
          margin: '0 0 8px', fontSize: 30, fontWeight: 800, letterSpacing: '-0.02em',
          color: t.text, lineHeight: 1.1,
        }}>Product History</h2>
        <p style={{ margin: 0, fontSize: 13, color: t.textMuted, lineHeight: 1.65, maxWidth: 640 }}>
          Every capability the platform has shipped, drawn as a metro map. Each coloured line is a
          part of the product; each station is something that went live. Where several lines have
          stations in the same month, that month was a sprint.
        </p>

        {/* Pixel score strip */}
        <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
          {[
            ['STATIONS', String(total), t.blue],
            ['★ MAJOR', String(majors), '#f59e0b'],
            ['MONTHS', String(MONTHS.length), '#4ade80'],
            ['LINES', String(CATEGORIES.length), '#f472b6'],
          ].map(([k, v, c]) => (
            <div key={k} style={{ padding: '5px 10px', background: `${c}12`, ...pixelBorder(c) }}>
              <span style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 8.5, fontWeight: 800, letterSpacing: '0.14em', color: t.textFaint }}>{k} </span>
              <span style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 14, fontWeight: 800, color: c }}>{v}</span>
            </div>
          ))}
        </div>
      </div>

      <Legend t={t} />

      {/* Line filter — click a line to ride only that one down the map. */}
      {!printMode && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6, position: 'relative', zIndex: 1 }}>
          <button
            onClick={() => setFilter(null)}
            style={filterBtn(filter === null ? t.blue : t.border, filter === null, t)}
          >ALL LINES</button>
          {CATEGORIES.map(c => (
            <button
              key={c.id}
              onClick={() => setFilter(f => f === c.id ? null : c.id)}
              style={filterBtn(c.color, filter === c.id, t)}
            >{c.icon} {c.label.toUpperCase()}</button>
          ))}
        </div>
      )}

      {/* ── The map ─────────────────────────────────────────────────────── */}
      <div style={{ position: 'relative', zIndex: 1 }}>
        {visibleMonths.map(month => (
          <div key={month.key}>
            <MonthBand month={month} t={t} />
            <div style={{ position: 'relative' }}>
              {/* A pixel "train" running down the busiest line of the month —
                  pure decoration, and the reason the page feels alive. */}
              {!printMode && month.intensity >= 3 && (
                <span aria-hidden style={{
                  position: 'absolute', left: 9, width: 5, height: 10, background: '#fcd34d',
                  animation: `rb-ph-train ${month.milestones.length * 1.6}s steps(${month.milestones.length * 8}, end) infinite`,
                  zIndex: 3, pointerEvents: 'none',
                }} />
              )}
              {(() => {
                const spans = railSpans(month.milestones)
                return month.milestones.map((ms, i) => {
                  const id = `${month.key}-${i}`
                  return (
                    <Station
                      key={id}
                      ms={ms}
                      live={spans[i]}
                      open={printMode || open === id}
                      onToggle={() => setOpen(o => o === id ? null : id)}
                      narrow={narrow && !printMode}
                      t={t}
                    />
                  )
                })
              })()}
            </div>
          </div>
        ))}
      </div>

      {/* ── End of line ─────────────────────────────────────────────────── */}
      <div style={{
        marginTop: 30, padding: '16px 18px', textAlign: 'center',
        background: `${t.green}0e`, ...pixelBorder(t.green), position: 'relative', zIndex: 1,
      }}>
        <div style={{
          fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11, fontWeight: 800,
          letterSpacing: '0.16em', color: t.green, marginBottom: 6,
          animation: printMode ? undefined : 'rb-ph-blink 1.6s steps(2, end) infinite',
        }}>▶ END OF LINE — TO BE CONTINUED</div>
        <div style={{ fontSize: 12, color: t.textMuted, lineHeight: 1.6 }}>
          What comes next lives on the <strong style={{ color: t.text }}>Product Overview</strong> roadmap
          and the <strong style={{ color: t.text }}>Feature Backlog</strong> page — where you can add your own.
        </div>
      </div>
    </div>
  )
}

function filterBtn(color: string, active: boolean, t: ReturnType<typeof useTheme>) {
  return {
    padding: '5px 9px', cursor: 'pointer',
    fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 9, fontWeight: 800, letterSpacing: '0.1em',
    background: active ? `${color}22` : 'transparent',
    border: `2px solid ${active ? color : t.border}`,
    borderRadius: 0,
    color: active ? color : t.textFaint,
  } as const
}
