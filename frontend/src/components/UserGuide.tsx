import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useTheme } from '../theme'
import { api } from '../api/client'

import type { CableNode, CableSegment, CableSystem, FeatureRequest } from '../types'


const STEPS = [
  { title: 'Open RouteFinder', desc: 'Select the RouteBuilder top-level tab, then the RouteFinder sub-tab. TSABuddy appears at the top — use it for natural language, or configure the search manually below.' },
  { title: 'Select Origin & Destination', desc: 'Type a city or node name in the search boxes. The live combobox filters as you type — select the specific landing station or PoP you need. Use the ⇅ swap button between the two fields to flip origin and destination instantly.' },
  { title: 'Set Diversity', desc: 'Choose a diversity type if required. Wet isolates submarine segments only. Full means no shared segments end-to-end. Full-Node adds node isolation on top. Terrestrial variants isolate backhaul at the origin end, destination end, or both. Leave as None for a single best-path search.' },
  { title: 'Add Constraints (optional)', desc: 'Expand Advanced Constraints to force via or avoid on specific nodes, segments, cable systems or entire countries. Country constraints are a hard geopolitical filter — no landing node in an avoided country will appear on any result.' },
  { title: 'Search', desc: 'Press Find Routes. The animated button indicates the search is running. Results appear in seconds.' },
  { title: 'Review & Sort', desc: 'Route cards show the path, margin badge, on-net classification and capacity. Sort by Hops, Distance, RTD, Availability, Margin, Capacity or On-Net. Click any sort button to activate it; clicking the active button again flips the sort direction. Toggle "UP" to push outage-affected routes down. Use the − / + stepper to show 1–10 routes (default 5).' },
  { title: 'Flip, Pin & Export', desc: 'In a diversity pair, click ⇅ to swap Worker and Protect roles — the route data (path, stats, map colour) trades places completely. Pin up to 5 routes using 📍, then export a straight-line diagram. Click ⬡ SLD → choose a version label (Proposal / Draft / Final) → Export PDF for a branded diagram, or Export DrawIO for an editable DrawIO / Visio XML file.' },
]

const ROADMAP = [
  { icon: '📶', title: 'Real-Time Network Data',       desc: 'Network capacity from Inventory systems, outage feeds from TSM, and live latency data from NMS — removing the lag between network events and commercial decisions.', tag: 'In Planning', color: '#22c55e' },
  { icon: '💵', title: 'Quoting & Pricing Integration', desc: 'Bridge margin scores to actual pricing outputs, enabling indicative quotes directly from a route design.', tag: 'In Planning', color: '#f97316' },
  { icon: '🧠', title: 'AI-Driven Recommendations',    desc: 'TSABuddy evolves into a full commercial advisor — surfacing market intelligence and proactively optimising route recommendations.', tag: 'Future', color: '#3b82f6' },
  { icon: '🌐', title: 'Customer-Facing Portal',        desc: 'A self-serve experience for enterprise customers to explore the network, model routes and initiate enquiries independently.', tag: 'Future', color: '#3b82f6' },
]

interface Props {
  nodes: CableNode[]
  segments: CableSegment[]
  systems: CableSystem[]
}

export function UserGuide({ nodes, segments, systems }: Props) {
  const t = useTheme()
  const [page, setPage] = useState<1 | 2 | 3 | 4 | 5 | 6 | 7>(1)
  const [printAll, setPrintAll] = useState(false)
  const printRef = useRef<HTMLDivElement>(null)
  const [featureRequests, setFeatureRequests] = useState<FeatureRequest[]>([])
  const [reqForm, setReqForm] = useState({ title: '', description: '', category: '' })
  const [reqSubmitting, setReqSubmitting] = useState(false)
  const [reqDone, setReqDone] = useState(false)

  useEffect(() => {
    if (page === 6) {
      api.getFeatureRequests().then(setFeatureRequests).catch(() => {})
    }
  }, [page])

  useEffect(() => {
    if (!printAll) return
    const style = document.createElement('style')
    style.id = 'rb-print-style'
    style.textContent = `
      @media print {
        body > *:not(#rb-guide-print-portal) { display: none !important; }
        body { overflow: visible !important; }
        #rb-guide-print-portal {
          display: block !important;
          position: static !important;
          left: auto !important;
          top: auto !important;
          width: 100% !important;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }
        @page { margin: 12mm 10mm; size: A4; }
      }
    `
    document.head.appendChild(style)
    const afterPrint = () => {
      setPrintAll(false)
      document.getElementById('rb-print-style')?.remove()
    }
    window.addEventListener('afterprint', afterPrint)
    const timer = setTimeout(() => window.print(), 300)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('afterprint', afterPrint)
      document.getElementById('rb-print-style')?.remove()
    }
  }, [printAll])

  const handlePrint = () => setPrintAll(true)

  const nodeCount    = nodes.length
  const segmentCount = segments.length
  const systemCount  = systems.filter(s => s.id !== 'TERRESTRIAL').length

  const FEATURES = [
    { icon: '🗺', title: 'PoP Route Builder',
      desc: `Find optimal paths between any two nodes on our ${nodeCount}-node subsea network. Configure wet, full or terrestrial diversity, enforce via/avoid constraints on specific nodes, segments or cable systems, and see all viable paths ranked instantly. The live map uses colour and size to distinguish node types — large orange dots for CLS (Landing Stations), grading down through Primary, Secondary, Extension PoPs to small amber Branching Units.` },
    { icon: '🤖', title: 'TSABuddy — AI Route Assistant',
      desc: 'Type your request in plain English: "Singapore to Tokyo with full diversity, avoiding China, sort by latency." TSABuddy extracts origin, destination, diversity type, system/country/node constraints, and sort preference — then triggers the search automatically. Powered by Claude AI.' },
    { icon: '🏙', title: 'City Pairs',
      desc: 'Explore city-to-city connectivity across our subsea network. Type to search cities by name or country — the live combobox filters as you type. See all viable system itineraries and key metrics without needing to know individual node IDs.' },
    { icon: '🌍', title: 'Country Viewer',
      desc: `Select any country from the searchable list to instantly highlight every subsea cable system landing there and all backhaul routes connecting those stations. Each system is rendered in a distinct vivid colour; backhaul appears in teal. The map auto-centres on the country. Use the Subsea Only and Backhaul Only toggles to reduce clutter.` },
    { icon: '📊', title: 'Country Node Diagram',
      desc: 'Opened from Country Viewer via the "View Node Diagram" button. Renders a schematic of every node in the selected country and the cable systems connecting them — laid out on a clean grid with colour-coded connections and subsea stubs. Click any cable line to highlight that system on the main map. Useful for topology briefings and country deep-dives.' },
    { icon: '💰', title: 'Margin Scoring',
      desc: 'Every route is automatically scored for commercial margin (1–10) based on cable system ownership, weighted by segment distance. Sort routes by margin to surface the most commercially attractive options first.' },
    { icon: '📡', title: 'Capacity Dashboard',
      desc: `A full-network capacity view across all ${segmentCount} segments, showing total and available capacity in terabits with utilisation colour-coding. Instantly identify where capacity is constrained.` },
    { icon: '🔀', title: 'On-Net / Off-Net Classification',
      desc: 'Routes are automatically classified as On-Net, Off-Net or Mixed based on network ownership. The on-net percentage is shown for blended routes, shaping the commercial narrative.' },
    { icon: '🌍', title: 'Country Constraints',
      desc: 'Avoid or require specific countries in Advanced Constraints. "Must Avoid" removes every node in the selected countries from the graph — no landing station there will appear on any result. "Must Include" requires at least one transit node per selected country. Fully understood by TSABuddy via natural language.' },
    { icon: '🔵🟢', title: 'Diversity Pairs & Worker / Protect Flip',
      desc: 'Diversity searches return matched Worker (blue) / Protect (green) pairs. Click ⇅ on any pair to swap roles — the full route data trades places so Worker 1 carries the protect path and vice versa. Use this to define which circuit actually takes live traffic vs failover.' },
    { icon: '🔵', title: 'Manual Route Builder',
      desc: 'Build a route hop-by-hop on the live map. Tap any node as the origin, then pick each next hop from a scored candidate list showing latency, length and ownership. Undo any hop, then finish to pin the complete route — useful for modelling non-standard paths or checking specific cable combinations the auto-solver might not return.' },
    { icon: '🌊', title: 'Cable System Viewer',
      desc: `Toggle any of the ${systemCount} cable systems on the live map to explore coverage, topology and branching unit structure — ideal for network briefings and customer conversations.` },
    { icon: '🔍', title: 'Node Search',
      desc: `Enter a customer address or lat/lng coordinates to find the nearest landing stations and PoPs. Results show owner, trading name, node type and straight-line distance — with one-click Set Origin / Set Dest to jump straight into a route search.` },
    { icon: '📌', title: 'Pinned Routes & SLD Export',
      desc: 'Pin up to 5 routes for comparison, then export a straight-line diagram. Choose a version label (Proposal / Draft / Final) and export as PDF (branded, customer-ready cover page plus per-route diagrams with proportional segment layout) or DrawIO / Visio XML for collaborative editing.' },
    { icon: '🗄', title: 'Ref Data Management',
      desc: 'Full CRUD for nodes, segments, systems, capacity, outages, interconnect rules and solution notes. Nodes carry city, address and description fields. Verification status (Draft / Under Verification / Verified) is tracked per node and segment — click the status badge in any row to change it without opening the full edit form. Bulk CSV import/export includes all fields.' },
    { icon: '⇄', title: 'Node Handoff Rules',
      desc: 'Four rule types per node — Disallowed Pair, Allowed Pair, No Handoff, and Restricted Handoff Segments. "No Handoff" prevents a node from being used as a circuit endpoint (e.g. where anticompetitive restrictions apply at a CLS). "Restricted Handoff Segments" limits which physical segments may terminate at a node — only those explicitly listed are permitted. All rules are hard constraints that remove non-compliant paths before any result is returned.' },
    { icon: '📋', title: 'Solution Notes — Knowledge Repository',
      desc: 'Capture local expertise, site-specific guidance and operational context against any node or segment in the network. Notes are permanent reference data — raised once, visible on every route that includes that asset. Each note carries a category (Site Access, Handoff Notes, Customs/Regulatory, SLA/Protection, IRU/Lease Terms and more), a severity (Info / Warning / Critical), a title and free-text body. Click the 📋 button on any route card to open the Solution Notes overlay — a metro map view on the left with severity indicators, and all notes in route order on the right. Click "+ Add Note" on any node or segment to jump directly to the Ref Data form pre-filled for that asset.' },
    { icon: '🚨', title: 'Live Outage Awareness',
      desc: 'Active segment outages appear on route cards with repair date estimates. Push outage-affected routes to the bottom with one click — keeping viable options front and centre during a network incident.' },
    { icon: '📱', title: 'Mobile-First Design',
      desc: 'Full feature parity on phones and tablets — including Country Viewer, Manual Route Builder, City Pairs, Node Search and Outages. Demo routes, answer customer questions and build proposals from anywhere.' },
    { icon: '🎨', title: 'Theme Cycling',
      desc: 'Click the theme button in the top-right control bar to cycle through available colour themes. The theme applies globally — including map tiles, route cards, diagrams and all panels.' },
  ]

  const card = (style?: Record<string, unknown>): Record<string, unknown> => ({
    background: t.bgCard,
    border: `1px solid ${t.border}`,
    borderRadius: 10,
    padding: '16px 18px',
    ...style,
  })

  const sectionLabel: Record<string, unknown> = {
    fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
    color: t.blue, marginBottom: 14,
  }

  // ── Shared page helpers (used across normal + print-all rendering) ──────────
  const tier = (
    bg: string, border: string, icon: string,
    title: string, sub: string, badges: string[],
    detail: string,
  ) => (
    <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: 12, padding: '20px 22px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 12 }}>
        <span style={{ fontSize: 28, lineHeight: 1, flexShrink: 0 }}>{icon}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: '#fff', marginBottom: 3 }}>{title}</div>
          <div style={{ fontSize: 11, color: 'rgba(200,220,255,0.75)', lineHeight: 1.5 }}>{sub}</div>
        </div>
      </div>
      <p style={{ fontSize: 11, color: 'rgba(185,210,255,0.85)', lineHeight: 1.7, margin: '0 0 14px' }}>{detail}</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {badges.map(b => (
          <span key={b} style={{ fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 20, background: 'rgba(255,255,255,0.08)', color: 'rgba(210,230,255,0.9)', border: '1px solid rgba(255,255,255,0.12)', letterSpacing: '0.04em' }}>{b}</span>
        ))}
      </div>
    </div>
  )

  const flow = (num: string, color: string, title: string, steps: string[]) => (
    <div style={{ ...card() as React.CSSProperties, borderLeft: `4px solid ${color}`, paddingLeft: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <div style={{ width: 28, height: 28, borderRadius: '50%', flexShrink: 0, background: color + '22', border: `2px solid ${color}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, color }}>{num}</div>
        <div style={{ fontSize: 13, fontWeight: 700, color: t.text }}>{title}</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        {steps.map((s, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
              <div style={{ width: 20, height: 20, borderRadius: '50%', background: i === 0 ? color : t.bgDeep, border: `1px solid ${i === 0 ? color : t.border}`, fontSize: 9, fontWeight: 700, color: i === 0 ? '#fff' : t.textFaint, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{i + 1}</div>
              {i < steps.length - 1 && <div style={{ width: 1, height: 14, background: t.border, margin: '2px 0' }} />}
            </div>
            <div style={{ fontSize: 11, color: t.textMuted, lineHeight: 1.5, paddingBottom: i < steps.length - 1 ? 4 : 0 }}>{s}</div>
          </div>
        ))}
      </div>
    </div>
  )

  const pipeBox = (num: string, color: string, icon: string, title: string, desc: string, countLabel: string) => (
    <div style={{ flex: 1, minWidth: 0, background: color + '14', border: `2px solid ${color}`, borderRadius: 12, padding: '16px 12px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 6 }}>
      <div style={{ width: 26, height: 26, borderRadius: '50%', background: color, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, flexShrink: 0 }}>{num}</div>
      <div style={{ fontSize: 20 }}>{icon}</div>
      <div style={{ fontSize: 12, fontWeight: 800, color: t.text }}>{title}</div>
      <div style={{ fontSize: 10, color: t.textMuted, lineHeight: 1.5, flex: 1 }}>{desc}</div>
      <div style={{ fontSize: 16, fontWeight: 800, color, marginTop: 4 }}>{countLabel}</div>
    </div>
  )

  const algoArrow = <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', color: t.textFaint, fontSize: 20 }}>›</div>

  const constraintRowAlgo = (icon: string, name: string, badge: string, badgeColor: string, desc: string) => (
    <div style={{ ...card() as React.CSSProperties, display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 14px' }}>
      <span style={{ fontSize: 18, flexShrink: 0, lineHeight: 1.4 }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: t.text }}>{name}</span>
          <span style={{ fontSize: 9, fontWeight: 800, padding: '2px 6px', borderRadius: 4, background: badgeColor + '22', color: badgeColor, border: `1px solid ${badgeColor}55`, letterSpacing: '0.06em' }}>{badge}</span>
        </div>
        <div style={{ fontSize: 11, color: t.textMuted, lineHeight: 1.5 }}>{desc}</div>
      </div>
    </div>
  )

  const dimChip = (icon: string, label: string, sub: string) => (
    <div style={{ background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 8, padding: '10px 12px', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
      <span style={{ fontSize: 15, flexShrink: 0, marginTop: 1 }}>{icon}</span>
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: t.text }}>{label}</div>
        <div style={{ fontSize: 10, color: t.textMuted, lineHeight: 1.4 }}>{sub}</div>
      </div>
    </div>
  )

  const sortChip = (icon: string, key: string, dir: string, desc: string) => (
    <div style={{ background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 8, padding: '10px 12px', textAlign: 'center' }}>
      <div style={{ fontSize: 16, marginBottom: 4 }}>{icon}</div>
      <div style={{ fontSize: 11, fontWeight: 800, color: t.text, marginBottom: 2 }}>{key}</div>
      <div style={{ fontSize: 9, color: t.blue, fontWeight: 700, marginBottom: 5 }}>{dir}</div>
      <div style={{ fontSize: 10, color: t.textMuted, lineHeight: 1.4 }}>{desc}</div>
    </div>
  )

  const entityCard = (
    icon: string, name: string, color: string,
    fields: { field: string; type: string; desc: string }[],
  ) => (
    <div style={{ ...card() as React.CSSProperties, borderLeft: `4px solid ${color}`, paddingLeft: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <span style={{ fontSize: 20 }}>{icon}</span>
        <span style={{ fontSize: 13, fontWeight: 800, color: t.text }}>{name}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        {fields.map(({ field, type, desc }, i) => (
          <div key={field} style={{ display: 'grid', gridTemplateColumns: '110px 80px 1fr', gap: 8, padding: '6px 0', borderTop: i > 0 ? `1px solid ${t.border}` : 'none', alignItems: 'baseline' }}>
            <code style={{ fontSize: 10, fontWeight: 700, color, fontFamily: 'monospace' }}>{field}</code>
            <span style={{ fontSize: 9, color: t.textFaint, fontFamily: 'monospace' }}>{type}</span>
            <span style={{ fontSize: 10, color: t.textMuted, lineHeight: 1.5 }}>{desc}</span>
          </div>
        ))}
      </div>
    </div>
  )

  const todayTomorrowRow = (field: string, color: string, today: string, tomorrow: string) => (
    <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr 1fr', gap: 12, padding: '10px 12px', borderRadius: 6, background: t.bgCard, border: `1px solid ${t.border}`, alignItems: 'start' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{ width: 3, height: '100%', minHeight: 24, background: color, borderRadius: 2, flexShrink: 0 }} />
        <span style={{ fontSize: 11, fontWeight: 700, color: t.text }}>{field}</span>
      </div>
      <div>
        <div style={{ fontSize: 8, fontWeight: 800, letterSpacing: '0.08em', color: t.orange, marginBottom: 3 }}>TODAY</div>
        <div style={{ fontSize: 10, color: t.textMuted, lineHeight: 1.5 }}>{today}</div>
      </div>
      <div>
        <div style={{ fontSize: 8, fontWeight: 800, letterSpacing: '0.08em', color: t.green, marginBottom: 3 }}>TOMORROW</div>
        <div style={{ fontSize: 10, color: t.textMuted, lineHeight: 1.5 }}>{tomorrow}</div>
      </div>
    </div>
  )

  // ── Page switcher tabs ─────────────────────────────────────────────────────
  const pageTabs = (
    <div style={{
      display: 'flex', gap: 6, justifyContent: 'center',
      marginBottom: 32, paddingTop: 8,
    }}>
      {([
        [1, '📖 Product Overview'],
        [2, '🏗 Architecture'],
        [3, '🔍 Search Algorithm'],
        [4, '🗄 Data Model'],
        [5, '📁 Solution Projects'],
        [6, '📋 Feature Backlog'],
        [7, '🔒 IT & Enterprise'],
      ] as [1|2|3|4|5|6|7, string][]).map(([p, label]) => (
        <button
          key={p}
          onClick={() => setPage(p)}
          style={{
            padding: '8px 22px', borderRadius: 24, cursor: 'pointer',
            fontSize: 12, fontWeight: 700, letterSpacing: '0.02em',
            border: page === p ? `1px solid ${t.blue}` : `1px solid ${t.border}`,
            background: page === p ? t.blue : t.bgCard,
            color: page === p ? '#fff' : t.textMuted,
            transition: 'all 0.15s',
          }}
        >
          {label}
        </button>
      ))}
    </div>
  )


  // ── Architecture page ──────────────────────────────────────────────────────
  const arch = (
    <div style={{
      maxWidth: 860, margin: '0 auto', padding: '0 16px 60px',
      fontFamily: 'system-ui, sans-serif', color: t.text,
    }}>
      {!printAll && pageTabs}

        {/* ── Hero ── */}
        <div style={{
          background: 'linear-gradient(135deg, #070d1f 0%, #0f1e3c 50%, #1a1040 100%)',
          borderRadius: 12, padding: '44px 40px 40px', marginBottom: 28,
          position: 'relative', overflow: 'hidden',
        }}>
          <div style={{ position: 'absolute', right: -60, top: -60, width: 280, height: 280, borderRadius: '50%', background: 'rgba(99,102,241,0.06)' }} />
          <div style={{ position: 'absolute', left: -30, bottom: -40, width: 200, height: 200, borderRadius: '50%', background: 'rgba(59,130,246,0.05)' }} />
          <div style={{ position: 'relative' }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(147,197,253,0.7)', marginBottom: 10 }}>
              Technical Architecture
            </div>
            <div style={{ fontSize: 34, fontWeight: 800, color: '#fff', lineHeight: 1.1, marginBottom: 10 }}>
              How Route<span style={{ color: '#818cf8' }}>Builder</span> Works
            </div>
            <p style={{ fontSize: 13, color: 'rgba(160,190,240,0.85)', maxWidth: 560, lineHeight: 1.75, margin: 0 }}>
              RouteBuilder is a modern cloud-native application — a browser-based interface, a Python intelligence engine, a persistent database, and an AI layer — each doing what it does best, working together in real time.
            </p>
          </div>
        </div>

        {/* ── Architecture diagram ── */}
        <div style={{ marginBottom: 28 }}>
          <div style={sectionLabel}>System Architecture</div>

          {/* Diagram: three tiers connected with arrows */}
          <div style={{
            background: 'linear-gradient(160deg, #070d1f 0%, #0d1730 100%)',
            borderRadius: 12, padding: '28px 24px', border: '1px solid rgba(99,102,241,0.2)',
          }}>

            {/* Top tier: Browser */}
            <div style={{
              background: 'rgba(37,99,235,0.15)', border: '1px solid rgba(59,130,246,0.35)',
              borderRadius: 10, padding: '14px 20px',
              display: 'flex', alignItems: 'center', gap: 16,
            }}>
              <span style={{ fontSize: 26, flexShrink: 0 }}>🌐</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: '#93c5fd' }}>Your Browser</div>
                <div style={{ fontSize: 11, color: 'rgba(147,197,253,0.7)', marginTop: 2 }}>
                  The entire interface — map, route cards, search, dashboards — runs here as a React application, delivered globally via Vercel's CDN
                </div>
              </div>
              <div style={{
                fontSize: 9, fontWeight: 700, padding: '4px 10px', borderRadius: 20,
                background: 'rgba(37,99,235,0.3)', color: '#93c5fd',
                border: '1px solid rgba(59,130,246,0.4)', whiteSpace: 'nowrap',
              }}>React · Vercel</div>
            </div>

            {/* Arrow down */}
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, padding: '10px 0' }}>
              <div style={{ flex: 1, height: 1, background: 'rgba(99,102,241,0.2)', maxWidth: 100 }} />
              <div style={{ fontSize: 10, color: 'rgba(147,197,253,0.5)', fontWeight: 600, letterSpacing: '0.06em' }}>
                HTTPS · API calls
              </div>
              <div style={{ flex: 1, height: 1, background: 'rgba(99,102,241,0.2)', maxWidth: 100 }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 2 }}>
              <div style={{ fontSize: 16, color: 'rgba(99,102,241,0.6)' }}>⇅</div>
            </div>

            {/* Middle tier: Backend */}
            <div style={{
              background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.35)',
              borderRadius: 10, padding: '14px 20px', marginTop: 4,
              display: 'flex', alignItems: 'center', gap: 16,
            }}>
              <span style={{ fontSize: 26, flexShrink: 0 }}>⚙️</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: '#a5b4fc' }}>API Backend</div>
                <div style={{ fontSize: 11, color: 'rgba(165,180,252,0.7)', marginTop: 2 }}>
                  The intelligence engine — finds optimal routes through the network graph, enforces diversity and constraints, computes margin, latency and availability, serves all data to the browser
                </div>
              </div>
              <div style={{
                fontSize: 9, fontWeight: 700, padding: '4px 10px', borderRadius: 20,
                background: 'rgba(99,102,241,0.25)', color: '#a5b4fc',
                border: '1px solid rgba(99,102,241,0.4)', whiteSpace: 'nowrap',
              }}>FastAPI · Railway</div>
            </div>

            {/* Arrow split down to two */}
            <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 4px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 60 }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                  <div style={{ fontSize: 14, color: 'rgba(34,197,94,0.5)' }}>⇣</div>
                  <div style={{ fontSize: 9, color: 'rgba(34,197,94,0.5)', fontWeight: 600, letterSpacing: '0.05em' }}>reads / writes</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                  <div style={{ fontSize: 14, color: 'rgba(251,146,60,0.5)' }}>⇣</div>
                  <div style={{ fontSize: 9, color: 'rgba(251,146,60,0.5)', fontWeight: 600, letterSpacing: '0.05em' }}>NLP requests</div>
                </div>
              </div>
            </div>

            {/* Bottom tier: DB + AI side by side */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div style={{
                background: 'rgba(22,163,74,0.12)', border: '1px solid rgba(34,197,94,0.3)',
                borderRadius: 10, padding: '14px 16px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <span style={{ fontSize: 22 }}>🗄</span>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 800, color: '#86efac' }}>PostgreSQL Database</div>
                    <div style={{ fontSize: 9, fontWeight: 700, color: 'rgba(134,239,172,0.6)', marginTop: 1 }}>Railway · Persistent</div>
                  </div>
                </div>
                <div style={{ fontSize: 10, color: 'rgba(134,239,172,0.7)', lineHeight: 1.6 }}>
                  All network data lives here — nodes, segments, systems, capacity, outages. Survives redeployments. Every GUI edit writes through immediately.
                </div>
              </div>
              <div style={{
                background: 'rgba(234,88,12,0.12)', border: '1px solid rgba(251,146,60,0.3)',
                borderRadius: 10, padding: '14px 16px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <span style={{ fontSize: 22 }}>🤖</span>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 800, color: '#fdba74' }}>Claude AI / Azure OpenAI</div>
                    <div style={{ fontSize: 9, fontWeight: 700, color: 'rgba(253,186,116,0.6)', marginTop: 1 }}>Anthropic · Azure · TSABuddy</div>
                  </div>
                </div>
                <div style={{ fontSize: 10, color: 'rgba(253,186,116,0.7)', lineHeight: 1.6 }}>
                  Plain-English route requests are routed to Claude (Anthropic) by default, or to Azure OpenAI if preferred — both extract nodes, constraints, diversity preferences and sort order, then hand them back to the route engine.
                </div>
              </div>
            </div>

            {/* Map tiles note */}
            <div style={{
              marginTop: 12, padding: '10px 16px', borderRadius: 8,
              background: 'rgba(255,255,255,0.03)', border: '1px dashed rgba(255,255,255,0.1)',
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <span style={{ fontSize: 16 }}>🗺</span>
              <div style={{ fontSize: 10, color: 'rgba(180,200,255,0.5)', lineHeight: 1.5 }}>
                <strong style={{ color: 'rgba(180,200,255,0.7)' }}>Map tiles</strong> are fetched directly by the browser from CARTO's global tile servers — the backend never handles map imagery, keeping it fast.
              </div>
            </div>
          </div>
        </div>

        {/* ── Component deep-dives ── */}
        <div style={{ marginBottom: 28 }}>
          <div style={sectionLabel}>The Four Layers</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

            {tier(
              'linear-gradient(135deg, rgba(37,99,235,0.18) 0%, rgba(29,78,216,0.08) 100%)',
              'rgba(59,130,246,0.3)', '🌐',
              'Frontend — What You See',
              'React application · Deployed on Vercel',
              ['React 18', 'Vite', 'TypeScript', 'Leaflet Maps', 'Vercel CDN'],
              'Every screen you interact with — the map, the search form, route cards, the capacity dashboard, ref data tables — is a React application running entirely inside your browser. It\'s delivered from Vercel\'s global edge network, so it loads fast regardless of where you are. When you click "Find Routes", the browser sends a request to the backend and renders whatever comes back — it doesn\'t do the route calculation itself.',
            )}

            {tier(
              'linear-gradient(135deg, rgba(99,102,241,0.18) 0%, rgba(79,70,229,0.08) 100%)',
              'rgba(99,102,241,0.3)', '⚙️',
              'Backend — The Intelligence Engine',
              'FastAPI (Python) · Deployed on Railway',
              ['FastAPI', 'Python', 'NetworkX', 'Graph Algorithms', 'Railway'],
              'This is where the route-finding actually happens. The backend models the entire cable network as a mathematical graph — nodes connected by weighted edges — and uses graph traversal algorithms to discover all valid paths between any two points, respecting diversity constraints, via/avoid rules and ownership filters. It also calculates RTD, availability, margin scores and capacity at every step. All API calls from the browser flow through here.',
            )}

            {tier(
              'linear-gradient(135deg, rgba(22,163,74,0.18) 0%, rgba(21,128,61,0.08) 100%)',
              'rgba(34,197,94,0.3)', '🗄',
              'Database — Persistent Memory',
              'PostgreSQL · Hosted on Railway',
              ['PostgreSQL', 'Railway', 'Persistent', 'JSONB Storage'],
              `All reference data — the ${nodeCount} nodes, ${segmentCount} segments, ${systemCount} cable systems, capacity figures, outage records and interconnect rules — lives in a PostgreSQL database. Unlike a file on a server, this database is independent of the application itself. It survives redeployments, code updates and server restarts. Every edit made through the Ref Data panel writes directly and permanently to this store.`,
            )}

            {tier(
              'linear-gradient(135deg, rgba(234,88,12,0.18) 0%, rgba(194,65,12,0.08) 100%)',
              'rgba(251,146,60,0.3)', '🤖',
              'AI Layer — TSABuddy',
              'Claude (Anthropic) · Azure OpenAI · Natural Language Interface',
              ['Claude AI', 'Azure OpenAI', 'NLP', 'Structured Extraction', 'TSABuddy'],
              'TSABuddy supports multiple LLM backends — Claude (Anthropic) by default, or Azure OpenAI if preferred. When you type a plain-English route request, the backend sends your text to the configured provider with a structured prompt describing all valid node IDs, segments, systems, countries and parameter options. The model returns a JSON object with extracted values: origin, destination, diversity, constraints and sort preference. The backend validates that output and pre-fills the search form.',
            )}

          </div>
        </div>

        {/* ── Data flows ── */}
        <div style={{ marginBottom: 28 }}>
          <div style={sectionLabel}>How the Key Flows Work</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>

            {flow('A', t.blue, 'Searching for a Route', [
              'You enter an origin, destination and any constraints in the browser',
              'Browser sends the request to the FastAPI backend via HTTPS',
              'Backend loads the network graph and runs a modified Dijkstra / BFS traversal to find all valid paths',
              'Each result is scored for RTD, availability, margin and capacity',
              'Results are returned to the browser and rendered as route cards, with matching segments highlighted on the map',
            ])}

            {flow('B', '#a5b4fc', 'Using TSABuddy', [
              'You type a natural language request ("SIN to HKG on EAC, wet diversity")',
              'Browser sends the text to the backend\'s NLP endpoint',
              'Backend forwards it to Claude (Anthropic) or Azure OpenAI — whichever is configured — with a structured prompt defining all valid node IDs and parameter options',
              'The LLM returns a structured JSON with extracted route parameters',
              'Backend validates the output and returns it to the browser, which fills all form fields and triggers the search automatically',
            ])}

            {flow('C', '#86efac', 'Editing Reference Data', [
              'You add, update or delete a node, segment, system or outage via the Ref Data panel',
              'Browser calls the appropriate REST API endpoint on the backend (POST, PUT or DELETE)',
              'Backend validates the change and writes it to PostgreSQL',
              'The database update is immediate and permanent — visible to all users on next page load',
              'The change flows into route calculations on the next search, with no restart required',
            ])}

          </div>
        </div>

        {/* ── Tech stack ── */}
        <div style={{ marginBottom: 32 }}>
          <div style={sectionLabel}>Technology Stack</div>
          <div style={{ ...card() as React.CSSProperties }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
              {[
                { layer: 'Frontend', items: ['React 18', 'TypeScript', 'Vite', 'Leaflet / OpenStreetMap'] },
                { layer: 'Backend', items: ['Python 3.11', 'FastAPI', 'NetworkX', 'Pydantic'] },
                { layer: 'Database', items: ['PostgreSQL', 'psycopg2', 'JSONB storage'] },
                { layer: 'AI', items: ['Claude (Anthropic)', 'Azure OpenAI (alternative)', 'Structured NLP extraction'] },
                { layer: 'Hosting', items: ['Vercel (frontend)', 'Railway (backend + DB)'] },
                { layer: 'Map Tiles', items: ['CARTO (dark & light themes)'] },
              ].map(({ layer, items }) => (
                <div key={layer}>
                  <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: t.blue, marginBottom: 6 }}>{layer}</div>
                  {items.map(item => (
                    <div key={item} style={{
                      fontSize: 11, color: t.textMuted, padding: '3px 0',
                      borderBottom: `1px solid ${t.border}`, lineHeight: 1.4,
                    }}>{item}</div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Footer ── */}
        <div style={{ textAlign: 'center', padding: '20px 0 0', borderTop: `1px solid ${t.border}` }}>
          <div style={{ fontSize: 11, color: t.textFaint }}>International Telco · RouteBuilder · Architecture Overview</div>
        </div>
    </div>
  )
  if (page === 2 && !printAll) return arch

  // ── Page 3: Search Algorithm ──────────────────────────────────────────────
  const algo = (
    <div style={{
      maxWidth: 860, margin: '0 auto', padding: '0 16px 60px',
      fontFamily: 'system-ui, sans-serif', color: t.text,
    }}>
      {!printAll && pageTabs}

        {/* Hero */}
        <div style={{
          background: 'linear-gradient(135deg, #0f1e3c 0%, #1a3a6e 60%, #1d4ed8 100%)',
          borderRadius: 16, padding: '32px 36px', marginBottom: 28, color: '#fff',
        }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#93c5fd', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>ALGORITHM REFERENCE</div>
          <h1 style={{ margin: '0 0 12px', fontSize: 26, fontWeight: 900, lineHeight: 1.2 }}>How Routes Are Found & Ranked</h1>
          <p style={{ margin: 0, fontSize: 13, color: 'rgba(200,220,255,0.85)', lineHeight: 1.7, maxWidth: 580 }}>
            A four-stage pipeline turns your origin and destination into a ranked shortlist.
            Constraints are hard gates — applied before any route enters the pool.
            Pool filtering and display sorting are two separate, independent steps you control.
          </p>
        </div>

        {/* Pipeline */}
        <div style={{ ...card() as React.CSSProperties, marginBottom: 24, padding: '22px 20px' }}>
          <div style={sectionLabel as React.CSSProperties}>The Four-Stage Pipeline</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'stretch', marginBottom: 16 }}>
            {pipeBox('1', '#3b82f6', '🔍', 'Graph Search', 'NetworkX walks the cable network finding all valid shortest paths', 'up to 1 000')}
            {algoArrow}
            {pipeBox('2', '#f59e0b', '⚖️', 'Apply Constraints', 'Hard rules remove every path that breaks any active constraint', 'varies')}
            {algoArrow}
            {pipeBox('3', '#8b5cf6', '🎯', 'Select Pool', 'Best 50 chosen across 5 dimensions — or all 50 by one Optimise For metric', '50 kept')}
            {algoArrow}
            {pipeBox('4', '#10b981', '📊', 'Sort & Display', 'Pool sorted by chosen metric; use − / + stepper to show 1–10 results (default 5)', '1–10 shown')}
          </div>
          <div style={{
            padding: '12px 16px', borderRadius: 8,
            background: t.bgCard, border: `1px solid ${t.borderSubtle}`,
            fontSize: 11, color: t.textMuted, lineHeight: 1.65,
          }}>
            💡 <strong style={{ color: t.text }}>Key distinction:</strong> Constraints (Step 2) are permanent exclusions — a route that breaks one will never appear, even if it is shorter or cheaper. Pool selection (Step 3) and display sort (Step 4) are preferences — they control <em>which</em> valid routes you see, not which routes exist.
          </div>
        </div>

        {/* Constraints */}
        <div style={{ ...card() as React.CSSProperties, marginBottom: 24, padding: '22px 20px' }}>
          <div style={sectionLabel as React.CSSProperties}>Constraints — Step 2: Hard Rules</div>
          <p style={{ fontSize: 12, color: t.textMuted, lineHeight: 1.65, margin: '0 0 16px' }}>
            Set in <strong style={{ color: t.text }}>Advanced Constraints</strong>. Every active constraint is applied before routes enter the pool.
            A path that breaks any single constraint is removed entirely — it will not appear even if it is the shortest or best-margin route available.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {constraintRowAlgo('📍', 'Must Include Nodes', 'VIA', t.green, 'Route must pass through every selected node. Use for mandatory transit PoPs or landing stations.')}
            {constraintRowAlgo('🚫', 'Must Avoid Nodes', 'SKIP', t.red, 'Route may not transit any selected node. Use to exclude restricted or unavailable facilities.')}
            {constraintRowAlgo('🔗', 'Must Include Segments', 'VIA', t.green, 'Route must traverse every selected cable segment — e.g. to lock in a preferred submarine section.')}
            {constraintRowAlgo('✂️', 'Must Avoid Segments', 'SKIP', t.red, 'Route may not use any selected segment — e.g. segments under maintenance or at outage risk.')}
            {constraintRowAlgo('📡', 'Must Include Systems', 'VIA', t.green, 'Route must carry at least one segment from every selected cable system.')}
            {constraintRowAlgo('🛑', 'Must Avoid Systems', 'SKIP', t.red, 'Route may not use any segment from the selected systems — full system exclusion.')}
            {constraintRowAlgo('🌍', 'Must Include Countries', 'VIA', t.green, 'Route must transit at least one non-BU landing node in each selected country. Use for geographic landing requirements — e.g. "must land in Japan".')}
            {constraintRowAlgo('🌐', 'Must Avoid Countries', 'SKIP', t.red, 'Route may not pass through any landing node in selected countries. A hard geopolitical, licensing or security exclusion. If an endpoint is in an avoided country, the search returns no results.')}
            {constraintRowAlgo('🌊', 'Max Wet Hops', 'LIMIT', t.orange, 'Maximum submarine cable segments. Each subsea segment = 1 wet hop. Blank = no limit.')}
            {constraintRowAlgo('⛰️', 'Max Terrestrial Hops', 'LIMIT', t.orange, 'Maximum land cable segments. Each terrestrial segment = 1 land hop. Blank = no limit.')}
          </div>
          <div style={{ marginTop: 16, padding: '14px 16px', borderRadius: 8, background: t.bgDeep, border: `1px solid ${t.orange}33` }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: t.orange, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>Node-Level Structural Rules (Ref Data)</div>
            <p style={{ fontSize: 11, color: t.textMuted, lineHeight: 1.65, margin: '0 0 10px' }}>
              Beyond search-time constraints, <strong style={{ color: t.text }}>Interconnect Rules</strong> encode permanent structural restrictions about how specific nodes may be used.
              These are applied automatically on every route calculation — they cannot be overridden by a search.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {constraintRowAlgo('🚫', 'Disallowed Pair', 'BLOCK', t.red, 'Two named cable systems may not interconnect at this node. Prevents physically impossible or commercially prohibited connections.')}
              {constraintRowAlgo('✅', 'Allowed Pair', 'ALLOW', t.green, 'Only specifically listed system pairs may interconnect at this node — all other combinations are implicitly blocked.')}
              {constraintRowAlgo('🔒', 'No Handoff', 'ENDPOINT', t.red, 'This node cannot be the destination of any circuit. Use where anticompetitive restrictions or access agreements prevent the operator from terminating service at a CLS or PoP.')}
              {constraintRowAlgo('🔗', 'Restricted Handoff Segments', 'ENDPOINT', t.orange, 'Only specific physical segments (selected from a dropdown of all segments landing at this node) may be used as the final hop. Any other segment arriving at this node is blocked as an endpoint.')}
            </div>
          </div>
        </div>

        {/* Pool selection + Optimise For */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
          <div style={{ ...card() as React.CSSProperties, padding: '22px 20px' }}>
            <div style={sectionLabel as React.CSSProperties}>Default Weighting — Step 3 (Auto)</div>
            <p style={{ fontSize: 11, color: t.textMuted, lineHeight: 1.65, margin: '0 0 16px' }}>
              When no Optimise For is set, the pool is built by taking the top routes from each of 5 dimensions, deduplicating, and filling remaining slots by shortest distance. This ensures the pool always contains strong candidates across every metric.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {dimChip('○', 'Hops', 'fewest segments')}
              {dimChip('↔', 'Distance', 'shortest km')}
              {dimChip('⚡', 'Latency', 'lowest delay')}
              {dimChip('◉', 'Ownership', 'most on-net')}
              {dimChip('◈', 'Capacity', 'highest bottleneck')}
            </div>
          </div>

          <div style={{ ...card() as React.CSSProperties, padding: '22px 20px' }}>
            <div style={sectionLabel as React.CSSProperties}>Optimise For — Step 3 (Override)</div>
            <p style={{ fontSize: 11, color: t.textMuted, lineHeight: 1.65, margin: '0 0 14px' }}>
              Setting an Optimise For dimension replaces the multi-dimension pool entirely. All 50 slots are filled with the best routes for that single metric. Use when you have a clear commercial priority.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[
                ['○', 'Hops',      'Fill 50 with fewest-hop routes',       '↓ fewer is better'],
                ['↔', 'Distance',  'Fill 50 with shortest routes',          '↓ fewer km is better'],
                ['⚡', 'Latency',  'Fill 50 with lowest latency',           '↓ fewer ms is better'],
                ['◈', 'Capacity',  'Fill 50 with highest bottleneck Tbps',  '↑ more is better'],
                ['◉', 'Ownership', 'Fill 50 with most on-net routes',       '↑ more on-net is better'],
                ['🚢', 'No Outages', 'Exclude any route with active outage', '✓ all segments healthy'],
              ].map(([icon, label, desc, dir]) => (
                <div key={label} style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
                  borderRadius: 8, background: t.bgCard, border: `1px solid ${t.border}`,
                }}>
                  <span style={{ fontSize: 13, width: 16, textAlign: 'center', flexShrink: 0 }}>{icon}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: t.text, minWidth: 72 }}>{label}</span>
                  <span style={{ fontSize: 10, color: t.textMuted, flex: 1 }}>{desc}</span>
                  <span style={{ fontSize: 9, color: t.blue, fontWeight: 700, flexShrink: 0 }}>{dir}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Diversity reference */}
        <div style={{ ...card() as React.CSSProperties, padding: '22px 20px', marginBottom: 24 }}>
          <div style={sectionLabel as React.CSSProperties}>Diversity Types</div>
          <p style={{ fontSize: 12, color: t.textMuted, lineHeight: 1.65, margin: '0 0 14px' }}>
            When a diversity type is selected the backend finds matched Worker / Protect pairs. Each pair is guaranteed to share no segments (or nodes) at the level you chose.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
            {[
              { type: 'None',                  badge: 'NONE',     color: t.textFaint, desc: 'Single-path search. No diversity constraint applied.' },
              { type: 'Wet',                   badge: 'WET',      color: t.blue,      desc: 'No shared submarine segments. Terrestrial sections may overlap.' },
              { type: 'Full',                  badge: 'FULL',     color: t.blue,      desc: 'No shared segments of any type — submarine or terrestrial.' },
              { type: 'Full + Node Isolation', badge: 'FULL+',    color: '#8b5cf6',   desc: 'No shared segments AND no shared intermediate nodes.' },
              { type: 'Terrestrial — Origin',  badge: 'TERR-O',   color: t.orange,    desc: 'Different terrestrial segments at the origin end.' },
              { type: 'Terrestrial — Dest.',   badge: 'TERR-D',   color: t.orange,    desc: 'Different terrestrial segments at the destination end.' },
              { type: 'Terrestrial — Both',    badge: 'TERR-OD',  color: t.orange,    desc: 'Different terrestrial segments at both origin and destination.' },
            ].map(({ type, badge, color, desc }) => (
              <div key={type} style={{
                background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 8,
                padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{
                    fontSize: 9, fontWeight: 800, padding: '2px 7px', borderRadius: 4,
                    background: color + '22', color, border: `1px solid ${color}44`,
                    letterSpacing: '0.06em',
                  }}>{badge}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: t.text }}>{type}</span>
                </div>
                <div style={{ fontSize: 10, color: t.textMuted, lineHeight: 1.5 }}>{desc}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Sort reference */}
        <div style={{ ...card() as React.CSSProperties, padding: '22px 20px', marginBottom: 24 }}>
          <div style={sectionLabel as React.CSSProperties}>Display Sort — Step 4</div>
          <p style={{ fontSize: 12, color: t.textMuted, lineHeight: 1.65, margin: '0 0 16px' }}>
            Sort buttons reorder the routes shown from your 50-route pool. Click any button to activate it — the active sort is highlighted. Clicking the active button again <em>flips</em> the direction (e.g. fewest-first ↔ most-first).
            Sorting never removes routes — it only changes which are shown. Use the − / + stepper to control how many are displayed (default 5, up to 10). You can combine Optimise For (pool composition) with a different display sort.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
            {sortChip('⬡', 'HOPS',     '↑ fewest first',  'Fewest cable segment hops')}
            {sortChip('↔', 'DIST',     '↑ shortest first', 'Shortest total km')}
            {sortChip('⚡', 'RTD',      '↑ lowest first',  'Lowest round-trip delay')}
            {sortChip('🛡', 'AVAIL',   '↓ highest first', 'Best end-to-end availability')}
            {sortChip('$',  'MARGIN',  '↓ highest first', 'Best weighted margin score')}
            {sortChip('◈', 'CAPACITY', '↓ highest first', 'Highest bottleneck capacity')}
            {sortChip('◉', 'OWN',      '↑ most on-net',   'Highest on-net segment ratio')}
            {sortChip('🚢', 'UP',      '↓ outages last',  'Push routes under repair to bottom')}
          </div>
        </div>

        {/* Summary strip */}
        <div style={{
          padding: '16px 20px', borderRadius: 12,
          background: 'linear-gradient(135deg, #1a2744 0%, #1e3a5f 100%)',
          border: `1px solid ${t.blue}44`, marginBottom: 24,
          display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
        }}>
          {[
            { num: '1 000', label: 'routes found',         color: '#3b82f6' },
            { num: '·',     label: '',                     color: t.textFaint },
            { num: '50',    label: 'filtered by pool',     color: '#8b5cf6' },
            { num: '·',     label: '',                     color: t.textFaint },
            { num: '1–10',  label: 'shown · sorted by',   color: '#10b981' },
          ].map((s, i) => (
            <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: s.num === '·' ? 18 : 22, fontWeight: 800, color: s.color }}>{s.num}</span>
              {s.label && <span style={{ fontSize: 11, color: 'rgba(200,220,255,0.7)' }}>{s.label}</span>}
            </span>
          ))}
        </div>

        {/* Footer */}
        <div style={{ textAlign: 'center', padding: '20px 0 0', borderTop: `1px solid ${t.border}` }}>
          <div style={{ fontSize: 11, color: t.textFaint }}>International Telco · RouteBuilder · Search Algorithm Reference</div>
        </div>
    </div>
  )
  if (page === 3 && !printAll) return algo

  // ── Page 4: Data Model ────────────────────────────────────────────────────
  const dataModel = (
    <div style={{
      maxWidth: 860, margin: '0 auto', padding: '0 16px 60px',
      fontFamily: 'system-ui, sans-serif', color: t.text,
    }}>
      {!printAll && pageTabs}

        {/* Hero */}
        <div style={{
          background: 'linear-gradient(135deg, #0f1e3c 0%, #0d2640 60%, #0c3a3a 100%)',
          borderRadius: 16, padding: '32px 36px', marginBottom: 28, color: '#fff',
        }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#6ee7b7', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>DATA MODEL</div>
          <h1 style={{ margin: '0 0 12px', fontSize: 26, fontWeight: 900, lineHeight: 1.2 }}>The Network in Data</h1>
          <p style={{ margin: '0 0 16px', fontSize: 13, color: 'rgba(180,230,220,0.85)', lineHeight: 1.7, maxWidth: 580 }}>
            Every route calculation draws on a structured graph of {nodeCount} nodes, {segmentCount} segments and {systems.filter(s => s.id !== 'TERRESTRIAL').length} cable systems.
            Understanding the data model helps you build better constraints and interpret results with confidence.
          </p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {[
              { n: String(nodeCount),    l: 'Nodes' },
              { n: String(segmentCount), l: 'Segments' },
              { n: String(systems.filter(s => s.id !== 'TERRESTRIAL').length), l: 'Cable Systems' },
            ].map(({ n, l }) => (
              <div key={l} style={{
                background: 'rgba(255,255,255,0.07)', borderRadius: 8, padding: '8px 16px',
                border: '1px solid rgba(255,255,255,0.1)',
              }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: '#6ee7b7', lineHeight: 1 }}>{n}</div>
                <div style={{ fontSize: 10, color: 'rgba(180,230,220,0.7)', marginTop: 2 }}>{l}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Core entities */}
        <div style={{ marginBottom: 28 }}>
          <div style={sectionLabel}>Core Entities</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {entityCard('📍', 'Node', t.blue, [
              { field: 'id',                  type: 'string',  desc: 'Unique identifier (e.g. SIN3, HKG1). Used in route paths and all node-level constraints.' },
              { field: 'name',                type: 'string',  desc: 'Human-readable name of the landing station or PoP.' },
              { field: 'country',             type: 'ISO-2',   desc: 'Country code — used for country-level hard constraints (must_avoid / must_include).' },
              { field: 'type',                type: 'enum',    desc: 'landing_station | primary_pop | secondary_pop | extension_pop | branching_unit. Drives map icon size and colour (CLS largest/orange → BU smallest/amber). BUs are traversed but never shown as endpoints.' },
              { field: 'lat / lng',           type: 'float',   desc: 'Coordinates for map rendering and nearest-node distance lookups. Accepts "lat, lng" paste directly into either field.' },
              { field: 'owner / trading_name',type: 'string',  desc: 'Infrastructure owner (e.g. Telstra, Equinix, PLDT) and commercial trading name shown in node info panels and Node Search results.' },
              { field: 'city / street_address',type: 'string', desc: 'Physical location fields — shown in the node info panel and included in bulk CSV export.' },
              { field: 'verification_status', type: 'enum',    desc: 'draft | under_verification | verified. Colour-coded badge on every node row. Click the badge to change status directly without opening the edit form.' },
            ])}
            {entityCard('🔗', 'Segment', '#8b5cf6', [
              { field: 'id',                  type: 'string',  desc: 'Unique segment ID (e.g. EAC-2B2). Used in must_include / must_avoid segment constraints.' },
              { field: 'system_id',           type: 'string',  desc: 'Parent cable system. Links to system-level constraints and commercial margin scoring.' },
              { field: 'type',                type: 'enum',    desc: 'wet | terrestrial. Wet hops and terrestrial hops are counted separately for diversity and hop limits.' },
              { field: 'length_km',           type: 'float',   desc: 'Physical distance used as primary graph edge weight and to compute total route km.' },
              { field: 'latency',             type: 'float ms',desc: 'One-way propagation delay. Summed across all route segments to compute end-to-end RTD.' },
              { field: 'reliability',         type: 'float',   desc: 'Segment availability (0–1). Multiplied across the path for end-to-end availability score.' },
              { field: 'ownership',           type: 'enum',    desc: 'owned | iru | consortium | integrated_lit_lease | offnet_resell. Drives commercial margin scoring.' },
              { field: 'verification_status', type: 'enum',    desc: 'draft | under_verification | verified. Click the badge in any segment row to update status directly.' },
            ])}
            {entityCard('🌊', 'Cable System', t.green, [
              { field: 'id',     type: 'string', desc: 'System identifier (e.g. EAC, AAG, C2C). Used in must_include / must_avoid systems constraints.' },
              { field: 'name',   type: 'string', desc: 'Display name shown in route cards, system viewer and constraint pickers.' },
              { field: 'margin', type: 'float',  desc: 'Commercial margin score (1–10). Combined with per-segment ownership weight to rank route attractiveness.' },
            ])}
          </div>
        </div>

        {/* Supporting tables */}
        <div style={{ marginBottom: 28 }}>
          <div style={sectionLabel}>Supporting Data Tables</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[
              { icon: '◈', name: 'Capacity', color: t.blue,
                fields: 'segment_id · total_capacity_t · available_capacity_t',
                role: 'Powers the capacity dashboard. Available Tbps at the bottleneck segment sets the est. capacity shown on each route card.' },
              { icon: '🚨', name: 'Outages', color: t.red,
                fields: 'segment_id · fault_id · fault_date · estimated_repair_date · description',
                role: 'Flags affected segments on route cards with repair estimates. Drives the "UP" outage-push sort button.' },
              { icon: '⇄', name: 'Interconnect Rules', color: t.orange,
                fields: 'node_id · disallowed_pairs · allowed_pairs · no_handoff · allowed_handoff_segments',
                role: 'Four rule types per node: Disallowed Pair (two systems may not interconnect), Allowed Pair (only these systems may interconnect), No Handoff (node cannot be a circuit endpoint), Restricted Handoff Segments (only specific segments may terminate here). All are hard constraints applied before any route is returned.' },
              { icon: '📋', name: 'Solution Notes', color: '#89b4fa',
                fields: 'id · node_id | segment_id · category_id · title · text · severity · created_at',
                role: 'Persistent advisory notes raised against a specific node or segment — not project-specific. Captured once, visible on every route that includes that node or segment. Severity: Info / Warning / Critical.' },
              { icon: '🏷', name: 'Note Categories', color: '#a6e3a1',
                fields: 'id · label · applies_to (node|segment) · order',
                role: 'Configurable category taxonomy for Solution Notes. Separate category lists for nodes (e.g. Site Access, Handoff Notes, Customs/Regulatory) and segments (e.g. Landing Information, SLA/Protection, IRU/Lease Terms). Fully editable via Ref Data → Notes → Categories.' },
            ].map(({ icon, name, color, fields, role }) => (
              <div key={name} style={{
                ...card() as React.CSSProperties,
                display: 'grid', gridTemplateColumns: '140px 1fr 1fr', gap: 12,
                alignItems: 'start', padding: '12px 16px',
                borderLeft: `4px solid ${color}`,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 16 }}>{icon}</span>
                  <span style={{ fontSize: 11, fontWeight: 800, color: t.text }}>{name}</span>
                </div>
                <div style={{ fontSize: 10, color, fontFamily: 'monospace', lineHeight: 1.6 }}>{fields}</div>
                <div style={{ fontSize: 10, color: t.textMuted, lineHeight: 1.5 }}>{role}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Solution Notes deep-dive */}
        <div style={{ marginBottom: 28 }}>
          <div style={sectionLabel}>Solution Notes — Knowledge Repository</div>
          <p style={{ fontSize: 11, color: t.textMuted, lineHeight: 1.65, margin: '0 0 14px' }}>
            Solution Notes capture local expertise and operational context about specific nodes and segments — the kind of knowledge that lives in engineers' heads and gets lost when people move on. Notes are permanent reference data stored in the database, not linked to any project or circuit. They are raised once and automatically surfaced on every route that includes the relevant asset.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
            {[
              { title: 'Per-Node Note Categories', color: '#89b4fa', items: ['Site Access', 'Access Requirements', 'Meet Me Room', 'Colocation Terms', 'Equipment Notes', 'Backhaul Options', 'Commercial Guidance', 'Environmental Risk', 'Handoff Notes', 'Landing Party / CLS Op.', 'Power / Space', 'Competitor Presence', 'Floor / Rack', 'Legal / Import Duties', 'Other Operator Notes', 'SLA / Protection', 'Customs / Regulatory', 'Security Requirements', 'Monitoring / Alarms', 'Cross-Connect Info', 'Fibre Management', 'Key Contacts', 'Site Experts', 'Lead Time / Ordering', 'Lifespan Notes', 'Commissioning Notes', 'Cease / Exit Notes', 'Other'] },
              { title: 'Per-Segment Note Categories', color: '#a6e3a1', items: ['Fibre Pair Info', 'System Age / RFS', 'Landing Information', 'Ownership / Consortium', 'Route Notes', 'Commercial Terms', 'Capacity Notes', 'Restoration / Spares', 'Performance Notes', 'Regulatory / Licences', 'Fibre Operator', 'Burial / Route Protection', 'Maintenance Windows', 'Significant Faults', 'Known Issues', 'System Design', 'SLA / Protection', 'Diversity Notes', 'Latency Variance', 'IRU / Lease Terms', 'Repair History', 'Lifespan Notes', 'Cease / Exit Notes', 'Handback Conditions', 'Environmental Notes', 'Billing Notes', 'Other'] },
            ].map(({ title, color, items }) => (
              <div key={title} style={{ ...card() as React.CSSProperties, borderTop: `3px solid ${color}` }}>
                <div style={{ fontSize: 11, fontWeight: 700, color, marginBottom: 8 }}>{title}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {items.map(i => (
                    <span key={i} style={{ fontSize: 9, padding: '2px 6px', borderRadius: 10, background: color + '18', color, border: `1px solid ${color}33` }}>{i}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 10 }}>
            {[
              { sev: 'Info', color: '#89b4fa', desc: 'Background context, helpful tips, or general guidance that the architect should be aware of.' },
              { sev: 'Warning', color: '#fab387', desc: 'Something that requires attention — a process step, a restriction, or a cost/lead-time consideration.' },
              { sev: 'Critical', color: '#f38ba8', desc: 'A hard constraint or known issue that could block the deal — must be resolved before submission.' },
            ].map(({ sev, color, desc }) => (
              <div key={sev} style={{ ...card() as React.CSSProperties, borderLeft: `3px solid ${color}` }}>
                <div style={{ fontSize: 11, fontWeight: 700, color, marginBottom: 4 }}>{sev}</div>
                <div style={{ fontSize: 10, color: t.textMuted, lineHeight: 1.5 }}>{desc}</div>
              </div>
            ))}
          </div>
          <div style={{ ...card() as React.CSSProperties, background: t.bgDeep, padding: '14px 16px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: t.blue, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>Workflow</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[
                ['1', 'Add a note', 'Go to Ref Data → Notes → Add note. Select whether it applies to a node or segment, pick the target from the dropdown, choose a category and severity, enter a title and description.'],
                ['2', 'Or add from a route', 'Open any route\'s Solution Notes overlay (📋 button on the route card). Click "+ Add Note" next to any node or segment — the Ref Data form opens pre-filled with that asset selected.'],
                ['3', 'Check your route', 'After a route search, look for the 📋 button on each route card. A blue illuminated badge means notes exist for at least one node or segment on that route. Click to open the full overlay.'],
                ['4', 'Review in route order', 'The overlay shows a metro-map of the route on the left with colour-coded severity indicators, and all notes listed in sequence on the right. Long notes collapse to 160 characters — click "Show more" to expand.'],
              ].map(([num, title, desc]) => (
                <div key={num} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <div style={{ width: 20, height: 20, borderRadius: '50%', background: t.blue, color: '#fff', fontSize: 10, fontWeight: 800, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{num}</div>
                  <div>
                    <span style={{ fontSize: 11, fontWeight: 700, color: t.text }}>{title} — </span>
                    <span style={{ fontSize: 11, color: t.textMuted }}>{desc}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Today vs Tomorrow */}
        <div style={{ marginBottom: 28 }}>
          <div style={sectionLabel}>Today vs Tomorrow — Data Sources</div>
          <div style={{ marginBottom: 10, fontSize: 11, color: t.textMuted, lineHeight: 1.6 }}>
            RouteBuilder already delivers commercial value from static, manually-curated data.
            The roadmap connects each field to the live operational system that will replace it.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {/* column headers */}
            <div style={{
              display: 'grid', gridTemplateColumns: '140px 1fr 1fr',
              gap: 12, padding: '6px 12px',
            }}>
              <div />
              <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.1em', color: t.orange }}>TODAY — STATIC</div>
              <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.1em', color: t.green }}>TOMORROW — LIVE</div>
            </div>
            {todayTomorrowRow('Network Capacity', t.green,
              'Static table maintained manually — updated from network planning spreadsheets when capacity changes.',
              'Veritas inventory feed — total and available capacity per segment updated automatically as circuits are provisioned and released.')}
            {todayTomorrowRow('Segment Outages', t.red,
              'Manually entered in Ref Data by network ops team when a fault is raised or repaired.',
              'Telstra Service Management (TSM, powered by ServiceNow) — fault records pushed to RouteBuilder automatically on creation and status change.')}
            {todayTomorrowRow('Latency / RTD', t.blue,
              'Static values from completed engineering RTD tests — the current distance-based propagation estimate is a temporary placeholder.',
              'NMS (Network Management System) — measured round-trip delay per segment in real time, reflecting actual fibre path and amplifier latency.')}
            {todayTomorrowRow('Node & Segment IDs', '#8b5cf6',
              'Sourced primarily from the Global PoP List with supplementary engineering data — maintained in PostgreSQL and updated when topology changes.',
              'Network inventory database remains the source of truth; future integration auto-syncs new nodes and segments on commissioning.')}
            {todayTomorrowRow('Margin Scores', t.orange,
              'Manual commercial weights set by the commercial team — reviewed periodically.',
              'Pricing engine integration — margin auto-derived from live IRU/lease cost data and commercial agreements.')}
          </div>
        </div>

        {/* Pipeline */}
        <div style={{ marginBottom: 28 }}>
          <div style={sectionLabel}>How It All Comes Together</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[
              { icon: '🏗', color: t.blue,     title: 'Graph Build',            desc: 'On startup, the backend loads all Nodes and Segments from PostgreSQL and builds a weighted NetworkX graph. Edge weights incorporate length, latency, reliability and ownership.' },
              { icon: '⚖️', color: t.orange,   title: 'Constraint Resolution',  desc: 'When a search request arrives, must_include / must_avoid IDs (nodes, segments, systems, countries) are resolved against the live node and segment dataset.' },
              { icon: '◈',  color: t.green,    title: 'Capacity Overlay',        desc: 'Available capacity per segment is loaded from the Capacity table and applied as a secondary filter when sorting by capacity.' },
              { icon: '🚨', color: t.red,      title: 'Outage Flagging',         desc: 'Each path is checked against the Outages table. Affected routes receive an outage badge and can be pushed to the bottom of results by the UP sort.' },
              { icon: '$',  color: '#8b5cf6',  title: 'Margin Scoring',          desc: 'Each segment\'s ownership type and its parent system\'s margin score are combined to compute a weighted route margin (1–10) — the commercial attractiveness indicator.' },
            ].map(({ icon, color, title, desc }) => (
              <div key={title} style={{
                ...card() as React.CSSProperties,
                display: 'flex', gap: 12, alignItems: 'flex-start',
                padding: '12px 14px', borderLeft: `4px solid ${color}`,
              }}>
                <span style={{ fontSize: 18, flexShrink: 0, marginTop: 1 }}>{icon}</span>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: t.text, marginBottom: 4 }}>{title}</div>
                  <div style={{ fontSize: 11, color: t.textMuted, lineHeight: 1.6 }}>{desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div style={{ textAlign: 'center', padding: '20px 0 0', borderTop: `1px solid ${t.border}` }}>
          <div style={{ fontSize: 11, color: t.textFaint }}>International Telco · RouteBuilder · Data Model</div>
        </div>
    </div>
  )
  if (page === 4 && !printAll) return dataModel

  // ── Page 5: Customer Solution Projects ────────────────────────────────────
  const projectsGuide = (
    <div style={{
      maxWidth: 860, margin: '0 auto', padding: '0 16px 60px',
      fontFamily: 'system-ui, sans-serif', color: t.text,
    }}>
      {!printAll && pageTabs}

      {/* Hero */}
      <div style={{
        background: 'linear-gradient(135deg, #0c1a35 0%, #0e3052 60%, #0a4a6e 100%)',
        borderRadius: 16, padding: '40px 36px', marginBottom: 28, color: '#fff',
        position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', right: -50, top: -50, width: 240, height: 240, borderRadius: '50%', background: 'rgba(14,165,233,0.06)' }} />
        <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(125,211,252,0.8)', letterSpacing: '0.12em', textTransform: 'uppercase' as const, marginBottom: 8 }}>
          CUSTOMER SOLUTION PROJECTS
        </div>
        <h1 style={{ margin: '0 0 12px', fontSize: 28, fontWeight: 900, lineHeight: 1.1 }}>
          From Route Design to<br />Customer-Ready Delivery
        </h1>
        <p style={{ margin: '0 0 20px', fontSize: 13, color: 'rgba(186,230,255,0.85)', lineHeight: 1.7, maxWidth: 580 }}>
          Customer Solution Projects turn one or more route designs into a complete, enriched solution package — ready for a technical handoff, formal quotation, or straight-line diagram delivery to the customer.
        </p>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' as const }}>
          {[
            { icon: '📁', label: 'Project Management' },
            { icon: '📡', label: 'Circuit Enrichment' },
            { icon: '📄', label: 'Customer SLD Export' },
            { icon: '🔒', label: 'Confidential by Default' },
          ].map(({ icon, label }) => (
            <div key={label} style={{ background: 'rgba(255,255,255,0.07)', borderRadius: 8, padding: '7px 14px', border: '1px solid rgba(255,255,255,0.1)', fontSize: 11, color: 'rgba(210,240,255,0.9)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>{icon}</span>{label}
            </div>
          ))}
        </div>
      </div>

      {/* User Journey scenario */}
      <div style={{ marginBottom: 28 }}>
        <div style={sectionLabel as React.CSSProperties}>Example User Journey</div>
        <div style={{ background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 12, padding: '20px 22px', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#0ea5e9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15 }}>🏢</div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 800, color: t.text }}>Scenario: Nvidia Japan–Taiwan Protected EPL</div>
              <div style={{ fontSize: 10, color: t.textMuted }}>TSA receives a customer brief for a protected 100G EPL between Tokyo and Taipei</div>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 10 }}>
            {([
              { phase: 'Day 1 — Intake', color: '#8b5cf6', steps: [
                'Account Manager shares opportunity brief: Nvidia, 100G EPL, Tokyo ↔ Taipei, 1+1 protected, low latency priority.',
                'TSA opens RouteBuilder and clicks the Mode banner → "Open a Project" → creates "Nvidia_JP-TW_EPL" with the customer and opportunity details.',
                'Project mode activates. The mode banner shows the project name at the top of every session.',
              ]},
              { phase: 'Day 1 — Route Design', color: t.blue, steps: [
                'TSA searches PoP Route Builder: Origin = TYO-EQX (Equinix TY4), Destination = TPE-CHT (Chief Telecom LY).',
                'Enables Diversity mode and sorts by Latency. Two route cards appear — worker via EAC, protect via APG.',
                'Clicks "Add Pair" → enters circuit label "NWD_Nvidia_100G_EPL_JPN-TWN". Both routes are saved to the project and auto-pinned — worker as "(Worker)", protect as "(Protect)".',
              ]},
              { phase: 'Day 2 — Enrichment', color: '#0ea5e9', steps: [
                'TSA opens the Enrich panel on the worker circuit. The traffic-light dot is red — nothing filled yet.',
                'Fills in: Service Type = "Ethernet Private Line (EPL)", Bandwidth = "100G LAN PHY (OTU4 – Layer 1)", Protection = "Unprotected (1+0)" (worker leg), Frame Size = "9200 bytes", L1 = "MACSec Transparent, LLF Enable".',
                'For A-End: Customer Site = "Equinix TY4", Address = "1-9-5 Otemachi…", Access Type = "X-Connect", Supplier = "Equinix", Arranged By = "Nvidia".',
                'For Z-End: Customer Site = "Chief Telecom LY Building", Address = "No. 250 Yangguang St…", Access Type = "X-Connect", Supplier = "Chief Telecom", Arranged By = "Nvidia".',
                'Traffic light turns green. Repeats for the protect circuit.',
              ]},
              { phase: 'Day 2 — Delivery', color: '#10b981', steps: [
                'TSA clicks ⬡ SLD → selects "Proposal" version → "Export PDF".',
                'A2 landscape PDF is generated: cover page with customer and opportunity metadata, then one page per circuit showing the node diagram, A/Z-End panels, and the full service + endpoint tables.',
                'TSA also clicks "Export DrawIO" for the Network Design team to customise icons and annotations in DrawIO/Visio before final delivery.',
                'PDF is attached to the Salesforce opportunity and sent to the AM for customer review.',
              ]},
            ] as { phase: string; color: string; steps: string[] }[]).map(({ phase, color, steps }) => (
              <div key={phase} style={{ borderLeft: `3px solid ${color}`, paddingLeft: 14 }}>
                <div style={{ fontSize: 10, fontWeight: 800, color, textTransform: 'uppercase' as const, letterSpacing: '0.08em', marginBottom: 6 }}>{phase}</div>
                <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 5 }}>
                  {steps.map((s, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                      <span style={{ fontSize: 9, fontWeight: 700, color, background: color + '22', borderRadius: 3, padding: '1px 5px', flexShrink: 0, marginTop: 1 }}>{i + 1}</span>
                      <span style={{ fontSize: 11, color: t.textMuted, lineHeight: 1.6 }}>{s}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Two-tier concept */}
      <div style={{ marginBottom: 28 }}>
        <div style={sectionLabel as React.CSSProperties}>Two Levels of SLD Output</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          {[
            {
              icon: '⚡',
              title: 'Quick SLD',
              sub: 'Built from route data only',
              color: t.blue,
              bullets: [
                'Generated instantly from any pinned route — no project needed',
                'Shows cable systems, nodes, segment lengths and latency',
                'Proportional segment layout, RTD arrow, node icons',
                'One page per pinned circuit — cover page with route summary',
                'Use for internal design reviews and feasibility checks',
              ],
              tag: 'Always Available',
            },
            {
              icon: '🎯',
              title: 'Customer SLD',
              sub: 'Enriched, branded, customer-ready',
              color: '#0ea5e9',
              bullets: [
                'Requires a Customer Solution Project with enriched circuits',
                'Adds A-End / Z-End site info, access type and supplier details',
                'Shows service type, bandwidth, protection and L1 settings',
                'Cover page includes customer name, opportunity ID, account manager',
                'Export as PDF (for delivery) or DrawIO XML (for custom editing)',
              ],
              tag: 'Requires Project',
            },
          ].map(({ icon, title, sub, color, bullets, tag }) => (
            <div key={title} style={{ background: t.bgCard, border: `2px solid ${color}`, borderRadius: 12, padding: '20px 20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 22 }}>{icon}</span>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 800, color: t.text }}>{title}</div>
                    <div style={{ fontSize: 10, color: t.textMuted }}>{sub}</div>
                  </div>
                </div>
                <span style={{ fontSize: 9, fontWeight: 700, padding: '3px 8px', borderRadius: 10, background: color + '22', color, border: `1px solid ${color}55` }}>{tag}</span>
              </div>
              <ul style={{ margin: 0, paddingLeft: 16, listStyle: 'none', display: 'flex', flexDirection: 'column' as const, gap: 5 }}>
                {bullets.map((b, i) => (
                  <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 7, fontSize: 11, color: t.textMuted, lineHeight: 1.5 }}>
                    <span style={{ color, flexShrink: 0, marginTop: 1 }}>›</span>{b}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      {/* Workflow */}
      <div style={{ marginBottom: 28 }}>
        <div style={sectionLabel as React.CSSProperties}>Step-by-Step Workflow</div>
        <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 0, position: 'relative' as const }}>
          <div style={{ position: 'absolute' as const, left: 13, top: 28, bottom: 28, width: 2, background: `linear-gradient(to bottom, #8b5cf6, ${t.blue}, #0ea5e9, #10b981)`, borderRadius: 1 }} />
          {([
            { num: '1', color: '#8b5cf6', icon: '📁', title: 'Create or Open a Project',
              desc: 'Click the Mode banner at the top of the left panel → "Open a Project". Create a new project with the customer name, opportunity ID, and account manager details, or select an existing one. The mode banner will show the project name for the rest of your session.' },
            { num: '2', color: t.blue, icon: '🔍', title: 'Search & Identify Routes',
              desc: 'Use PoP Route Builder or City Pairs to find the best worker and (if protected) protect routes. Enable Diversity mode for 1+1 protection. Sort by Latency, Hops, or Ownership as required. Use constraints to force or avoid specific nodes, segments and systems.' },
            { num: '3', color: t.blue, icon: '📌', title: 'Add Routes to the Project',
              desc: 'Click the 📁 "Add to Project" button on any route card, or "📁 Add Pair" on a diverse pair card. Enter a circuit label (e.g. "NWD_Nvidia_100G_EPL_JPN-TWN"). Both worker and protect routes are saved as a single circuit and auto-pinned — worker as "(Worker)", protect as "(Protect)".' },
            { num: '4', color: '#0ea5e9', icon: '✏️', title: 'Enrich Each Circuit',
              desc: 'Click the Enrich button (●) on a pinned circuit card. The traffic-light dot shows Red (nothing filled), Amber (some fields), or Green (complete). Fill in: Service Type, Bandwidth, Protection, Frame Size, L1 Settings. For each end: Customer Site name and address, Access Type (X-Connect, Local Loop, or Direct), Supplier, Arranged By, Interface type, and endpoint Protection scheme.' },
            { num: '5', color: '#10b981', icon: '📄', title: 'Export the Customer SLD',
              desc: 'When all circuits are green (fully enriched), click ⬡ SLD in the route card toolbar. Choose a version label (Proposal / Draft / Final). Click "Export PDF" for a customer-ready PDF, or "Export DrawIO" for an editable DrawIO / Visio XML file. The PDF includes a cover page and one diagram page per circuit, with full endpoint and service details.' },
          ] as { num: string; color: string; icon: string; title: string; desc: string }[]).map(({ num, color, icon, title, desc }, i) => (
            <div key={num} style={{ display: 'flex', gap: 16, paddingBottom: i < 4 ? 20 : 0, paddingLeft: 4 }}>
              <div style={{ width: 26, height: 26, borderRadius: '50%', flexShrink: 0, background: color, border: `2px solid ${color}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: '#fff', zIndex: 1 }}>{num}</div>
              <div style={{ ...card() as React.CSSProperties, flex: 1, padding: '12px 14px', marginBottom: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                  <span style={{ fontSize: 15 }}>{icon}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: t.text }}>{title}</span>
                </div>
                <div style={{ fontSize: 11, color: t.textMuted, lineHeight: 1.6 }}>{desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Tips & best practices */}
      <div style={{ marginBottom: 28 }}>
        <div style={sectionLabel as React.CSSProperties}>Tips & Best Practices</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {([
            { icon: '🏷️', tip: 'Use consistent circuit label naming', detail: 'Follow the NWD format: NWD_<Customer>_<BW>_<ServiceType>_<AEnd>-<ZEnd>. This ensures the label flows cleanly into the SLD cover page and opportunity records.' },
            { icon: '🟢', tip: 'Aim for green before exporting', detail: 'The enrichment traffic light (Red/Amber/Green) on each pinned card tells you if the circuit is ready for customer delivery. Only circuits with all endpoint and service fields filled will show a complete Customer SLD.' },
            { icon: '🔄', tip: 'Projects persist between sessions', detail: 'Your project and all its circuits (including route snapshots) are saved to the database. Switch away and return anytime — circuits are auto-pinned when you re-enter project mode.' },
            { icon: '📋', tip: 'Export DrawIO for collaborative editing', detail: 'Use "Export DrawIO" when the network design team needs to annotate the SLD, adjust layouts, or add custom icons before final customer delivery. DrawIO files can also be opened in Visio.' },
            { icon: '⚡', tip: 'Use Quick SLD during feasibility', detail: 'Before a project is ready, use ⬡ SLD directly from the pin bar (without a project) for fast internal route diagrams during pre-sales or feasibility reviews.' },
            { icon: '🗂️', tip: 'One project per opportunity', detail: 'Create a separate project for each Salesforce opportunity. This keeps circuits, enrichment data, and SLD exports cleanly scoped to a single customer engagement.' },
          ] as { icon: string; tip: string; detail: string }[]).map(({ icon, tip, detail }) => (
            <div key={tip} style={{ background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 10, padding: '12px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6 }}>
                <span style={{ fontSize: 14 }}>{icon}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: t.text }}>{tip}</span>
              </div>
              <div style={{ fontSize: 10, color: t.textMuted, lineHeight: 1.5 }}>{detail}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Project data model */}
      <div style={{ marginBottom: 28 }}>
        <div style={sectionLabel as React.CSSProperties}>What a Project Contains</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: t.text, marginBottom: 10 }}>Project Fields</div>
            {[
              ['Customer Name',       'The end customer for the solution'],
              ['Opportunity ID',      'CRM/Salesforce opportunity reference'],
              ['Opportunity Name',    'Brief description of the deal'],
              ['Account Manager',     'The relationship owner for this customer'],
              ['Solution Architect',  'Technical owner composing the solution'],
              ['Date Prepared',       'Solution package date for the cover page'],
              ['Visibility',         'Confidential (default) or Public'],
            ].map(([field, desc]) => (
              <div key={field as string} style={{ display: 'grid', gridTemplateColumns: '150px 1fr', gap: 8, padding: '6px 0', borderTop: `1px solid ${t.border}`, alignItems: 'baseline' }}>
                <code style={{ fontSize: 10, fontWeight: 700, color: t.blue, fontFamily: 'monospace' }}>{field}</code>
                <span style={{ fontSize: 10, color: t.textMuted, lineHeight: 1.5 }}>{desc}</span>
              </div>
            ))}
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: t.text, marginBottom: 10 }}>Per-Circuit Fields</div>
            {[
              ['Service Type',   'EPL, EVPL, IPT, IPVPN, Wavelength…'],
              ['Bandwidth',      'Contracted bandwidth (e.g. 100G)'],
              ['Protection',     'Unprotected (1+0), Protected (1+1)…'],
              ['Frame Size',     'End-to-end MTU (e.g. 9200 bytes)'],
              ['L1 Settings',    'MACSec, LLF, OTN framing, etc.'],
              ['A-End / Z-End',  'Site, access type, supplier, interface'],
              ['Route Snapshot', 'Path captured at time of adding to project'],
            ].map(([field, desc]) => (
              <div key={field as string} style={{ display: 'grid', gridTemplateColumns: '150px 1fr', gap: 8, padding: '6px 0', borderTop: `1px solid ${t.border}`, alignItems: 'baseline' }}>
                <code style={{ fontSize: 10, fontWeight: 700, color: '#0ea5e9', fontFamily: 'monospace' }}>{field}</code>
                <span style={{ fontSize: 10, color: t.textMuted, lineHeight: 1.5 }}>{desc}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Endpoint enrichment */}
      <div style={{ marginBottom: 28 }}>
        <div style={sectionLabel as React.CSSProperties}>A-End / Z-End Technical Enrichment</div>
        <div style={{ ...card() as React.CSSProperties, padding: '20px 20px' }}>
          <p style={{ fontSize: 12, color: t.textMuted, lineHeight: 1.7, margin: '0 0 16px' }}>
            Each circuit endpoint captures the customer handoff details required to order and provision the physical access. These fields drive the A-End / Z-End information blocks on the Customer SLD.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
            {[
              { icon: '🔌', label: 'X-Connect',   desc: 'Cross-connect within a colocation facility. Records supplier and who arranges it (Customer or Telstra).' },
              { icon: '🏠', label: 'Local Loop',   desc: 'Last-mile access circuit to the customer premises. Records supplier and who is responsible for ordering.' },
              { icon: '⚡', label: 'Direct',       desc: 'Customer directly connected — no access component required.' },
              { icon: '🖥', label: 'Interface',    desc: 'Physical port type (e.g. 100GBase-LR4, SMF LC). Selected from the configurable interface reference table.' },
              { icon: '📍', label: 'Site Address', desc: 'Full customer premises address — appears on the SLD and used for local loop ordering.' },
              { icon: '🛡', label: 'Protection',   desc: 'End-point protection scheme — Unprotected (1+0), Protected (1+1), or Dual.' },
            ].map(({ icon, label, desc }) => (
              <div key={label} style={{ background: t.bgBase, borderRadius: 8, padding: '10px 12px', border: `1px solid ${t.border}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
                  <span style={{ fontSize: 14 }}>{icon}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: t.text }}>{label}</span>
                </div>
                <div style={{ fontSize: 10, color: t.textMuted, lineHeight: 1.5 }}>{desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* SLD config */}
      <div style={{ marginBottom: 28 }}>
        <div style={sectionLabel as React.CSSProperties}>SLD Display Configuration</div>
        <div style={{ ...card() as React.CSSProperties, padding: '18px 20px' }}>
          <p style={{ fontSize: 12, color: t.textMuted, lineHeight: 1.7, margin: '0 0 14px' }}>
            Each project has configurable SLD display settings. Defaults apply to all circuits; individual circuits can override these settings independently.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {[
              ['Round-Trip Delay',    'End-to-end RTD on diagram header'],
              ['Total Latency',       'One-way latency in summary bar'],
              ['Segment Latency',     'Per-segment latency labels'],
              ['Distance',           'Segment and total distances'],
              ['Ownership',          'Ownership badges on segments'],
              ['Availability',       'Segment and end-to-end availability'],
            ].map(([label, desc]) => (
              <div key={label as string} style={{ background: t.bgBase, borderRadius: 6, padding: '8px 10px', border: `1px solid ${t.border}` }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: t.green, marginBottom: 3 }}>{label}</div>
                <div style={{ fontSize: 10, color: t.textMuted, lineHeight: 1.4 }}>{desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div style={{ textAlign: 'center', padding: '20px 0 0', borderTop: `1px solid ${t.border}` }}>
        <div style={{ fontSize: 11, color: t.textFaint }}>International Telco · RouteBuilder · Customer Solution Projects</div>
      </div>
    </div>
  )
  if (page === 5 && !printAll) return projectsGuide

  // ── Page 6: Feature Backlog ────────────────────────────────────────────────

  const FEATURE_CATEGORIES = [
    'Route Search & Discovery',
    'Manual Route Builder',
    'Country Explorer',
    'Network Visualization',
    'Data Management',
    'Customer Solutions & SLD',
    'AI & Intelligence',
    'Integration & Data Feeds',
    'Reporting & Export',
    'UI/UX & Design',
  ]

  const COMPLETED_FEATURES: { title: string; category: string; desc: string }[] = [
    { title: 'PoP Route Builder',             category: 'Route Search & Discovery',  desc: 'Graph-based engine finding optimal paths between any two network nodes, ranked by latency, hops, margin or capacity.' },
    { title: 'Diversity Pairs — Worker/Protect',category: 'Route Search & Discovery', desc: '1+1 diversity search returning matched worker/protect pairs with full flip capability.' },
    { title: 'Country & Node Constraints',    category: 'Route Search & Discovery',  desc: 'Must-avoid and must-include filtering on nodes, segments, systems and countries — hard exclusions from the graph.' },
    { title: 'On-Net/Off-Net Classification', category: 'Route Search & Discovery',  desc: 'Automatic ownership classification of routes with on-net percentage badge on every result card.' },
    { title: 'Margin Scoring',                category: 'Route Search & Discovery',  desc: 'Weighted commercial margin score (1–10) on every route based on segment ownership and cable system margin weights.' },
    { title: 'Sequential Segment Breakdown',  category: 'Route Search & Discovery',  desc: 'Segment breakdown rows ordered A→B→C along the route direction, matching the actual path traversal.' },
    { title: 'TSABuddy AI Route Assistant',   category: 'AI & Intelligence',         desc: 'Natural language route design via Claude AI or Azure OpenAI — extracts nodes, diversity, constraints and sort preference.' },
    { title: 'Manual Route Builder',          category: 'Manual Route Builder',      desc: 'Expert hop-by-hop route construction on the live map with per-hop latency, distance and margin stats.' },
    { title: 'Node Code Search in RouteManual',category: 'Manual Route Builder',     desc: 'Search and display nodes by their canonical 4-char code (e.g. SGCH) throughout the manual builder interface.' },
    { title: 'Country Viewer',                category: 'Country Explorer',          desc: 'Highlight all cable systems and backhaul routes for any country on the live map with subsea/backhaul filter toggles.' },
    { title: 'Country Node Diagram',          category: 'Country Explorer',          desc: 'Schematic SVG topology diagram with orthogonal routing, colour-coded cables and 45° subsea stubs.' },
    { title: 'Node/Segment Info Panel',       category: 'Country Explorer',          desc: 'Click any node or segment in the diagram to open a detail panel with ID, type, ownership, latency and capacity.' },
    { title: 'City Pairs',                    category: 'Network Visualization',     desc: 'Fast subsea system itineraries between any two cities without a full route search.' },
    { title: 'Cable System Viewer',           category: 'Network Visualization',     desc: 'Toggle individual cable systems on the live map to inspect their routes and node coverage.' },
    { title: 'Node Search',                   category: 'Network Visualization',     desc: 'Find nodes by name, address or coordinates — with one-click set as origin or destination.' },
    { title: 'Segment Labels Toggle',         category: 'Network Visualization',     desc: 'Show segment IDs directly on the map for active and highlighted routes.' },
    { title: 'Capacity Dashboard',            category: 'Data Management',           desc: 'Full-network capacity view across all segments with utilisation colour-coding.' },
    { title: 'Live Outage Awareness',         category: 'Data Management',           desc: 'Active outage flagging on route cards with repair date estimates and outage-push sort.' },
    { title: 'Ref Data Management',           category: 'Data Management',           desc: 'Full CRUD for nodes, segments, systems, capacity, outages, interconnect rules and solution notes.' },
    { title: 'Bulk CSV Import/Export',        category: 'Data Management',           desc: 'Bulk import and export of all ref data entities via CSV including all fields.' },
    { title: 'Verification Status Badges',    category: 'Data Management',           desc: 'Draft / Under Verification / Verified status per node and segment — click badge to update inline.' },
    { title: 'Node Handoff Rules',            category: 'Data Management',           desc: 'Four hard-constraint rule types per node — Disallowed Pair, Allowed Pair, No Handoff, and Restricted Handoff Segments — applied as pre-filters before any route is returned.' },
    { title: 'Solution Notes — Knowledge Repository', category: 'Data Management',  desc: 'Permanent notes (site access, customs, SLA, IRU terms, handoff guidance, lifespan and more) attached to any node or segment, visible in a metro-map overlay on every route that includes that asset.' },
    { title: 'Customer Solution Projects',    category: 'Customer Solutions & SLD',  desc: 'Full project management for customer solutions — circuits, enrichment, SLD export in one workflow.' },
    { title: 'A-End/Z-End Circuit Enrichment',category: 'Customer Solutions & SLD', desc: 'Per-endpoint technical detail including access type, supplier, interface and protection scheme.' },
    { title: 'Quick SLD Export',              category: 'Reporting & Export',        desc: 'Instant branded straight-line diagram from any pinned routes — choose version label (Proposal / Draft / Final) then export as PDF or DrawIO / Visio XML.' },
    { title: 'Customer SLD Export',           category: 'Reporting & Export',        desc: 'Customer-ready enriched SLD PDF with cover page, A/Z-End panels and DrawIO XML export option.' },
    { title: 'Theme Cycling',                 category: 'UI/UX & Design',            desc: 'Cycle through available colour themes (dark, light, and variants) via the top-right control button — map tiles update automatically.' },
    { title: 'Dark / Light Theme',            category: 'UI/UX & Design',            desc: 'Full dark and light theme support throughout the entire application.' },
    { title: 'Mobile-First Design',           category: 'UI/UX & Design',            desc: 'Full feature parity on phones and tablets — demo routes and answer customer questions from anywhere.' },
    { title: 'White Node Diagram Panel',      category: 'UI/UX & Design',            desc: 'Clean all-white panel for the country node diagram — no dark bands, muted professional colour palette.' },
  ]

  const IN_DEV_FEATURES: { title: string; category: string; desc: string }[] = [
    { title: 'Feature Backlog & Requests', category: 'UI/UX & Design', desc: 'This page — product backlog visibility and user feature request submission.' },
  ]

  const BACKLOG_FEATURES: { title: string; category: string; desc: string }[] = [
    { title: 'Real-Time Capacity from Inventory',  category: 'Integration & Data Feeds', desc: 'Live capacity feed from Veritas inventory — total and available per segment updated as circuits are provisioned.' },
    { title: 'Automatic Outage Feed from TSM',     category: 'Integration & Data Feeds', desc: 'Fault records pushed automatically from Telstra Service Management (ServiceNow) on creation and status change.' },
    { title: 'Live Latency from NMS',              category: 'Integration & Data Feeds', desc: 'Real-time measured round-trip delay per segment from the Network Management System.' },
    { title: 'Salesforce / CRM Integration',       category: 'Integration & Data Feeds', desc: 'Sync opportunities and projects with Salesforce — auto-link route designs to Salesforce records.' },
    { title: 'Inventory Sync (Node/Segment IDs)',  category: 'Integration & Data Feeds', desc: 'Auto-sync new nodes and segments from the network inventory database on commissioning.' },
    { title: 'Quoting & Pricing Integration',      category: 'Customer Solutions & SLD', desc: 'Bridge margin scores to actual pricing outputs — indicative quotes directly from a route design.' },
    { title: 'AI-Driven Recommendations',          category: 'AI & Intelligence',         desc: 'TSABuddy evolves to proactively surface market intelligence and optimise route recommendations.' },
    { title: 'Customer-Facing Self-Serve Portal',  category: 'UI/UX & Design',            desc: 'Enterprise customers explore routes, model options and initiate enquiries independently.' },
    { title: 'Network Health Dashboard',           category: 'Network Visualization',     desc: 'Real-time health view across the network with fault, utilisation and latency indicators.' },
    { title: 'Visio VSDX Export',               category: 'Reporting & Export',        desc: 'Export enriched SLDs directly as Visio VSDX files in addition to DrawIO XML — for teams working primarily in Visio.' },
    { title: 'Route Versioning & History',         category: 'Customer Solutions & SLD',  desc: 'Track changes to routes and circuits over time — compare versions and restore previous designs.' },
    { title: 'Pricing Engine Integration',         category: 'Route Search & Discovery',  desc: 'Auto-derive margin from live IRU/lease cost data and commercial agreements.' },
  ]

  async function submitFeatureRequest() {
    if (!reqForm.title.trim() || !reqForm.category) return
    setReqSubmitting(true)
    try {
      const created = await api.createFeatureRequest(reqForm)
      setFeatureRequests(prev => [...prev, created])
      setReqForm({ title: '', description: '', category: '' })
      setReqDone(true)
      setTimeout(() => setReqDone(false), 4000)
    } catch { /* ignore */ }
    setReqSubmitting(false)
  }

  const statusColor = { backlog: t.textFaint, in_development: t.orange, completed: t.green }

  const featureCard = (title: string, category: string, desc: string, status: 'completed' | 'in_development' | 'backlog', extra?: string) => (
    <div key={title + extra} style={{
      background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 8,
      padding: '11px 13px', display: 'flex', flexDirection: 'column' as const, gap: 5,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: t.text, lineHeight: 1.3, flex: 1 }}>{title}</div>
        <span style={{
          fontSize: 8, fontWeight: 800, padding: '2px 6px', borderRadius: 3, flexShrink: 0,
          background: statusColor[status] + '22', color: statusColor[status],
          border: `1px solid ${statusColor[status]}44`, letterSpacing: '0.06em', textTransform: 'uppercase' as const,
        }}>{category}</span>
      </div>
      <div style={{ fontSize: 10, color: t.textMuted, lineHeight: 1.5 }}>{desc}</div>
    </div>
  )

  const backlogPage = (
    <div style={{
      maxWidth: 860, margin: '0 auto', padding: '0 16px 60px',
      fontFamily: 'system-ui, sans-serif', color: t.text,
    }}>
      {!printAll && pageTabs}

      {/* Hero */}
      <div style={{
        background: 'linear-gradient(135deg, #0c1a35 0%, #1a2e5a 60%, #1e3a6e 100%)',
        borderRadius: 12, padding: '36px 36px 32px', marginBottom: 28,
        position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', right: -40, top: -40, width: 200, height: 200, borderRadius: '50%', background: 'rgba(99,102,241,0.07)' }} />
        <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(147,197,253,0.8)', letterSpacing: '0.12em', textTransform: 'uppercase' as const, marginBottom: 8 }}>PRODUCT ROADMAP</div>
        <div style={{ fontSize: 30, fontWeight: 800, color: '#fff', lineHeight: 1.1, marginBottom: 10 }}>
          Feature Backlog
        </div>
        <p style={{ fontSize: 13, color: 'rgba(160,190,240,0.85)', maxWidth: 540, lineHeight: 1.7, margin: '0 0 20px' }}>
          Everything we have built, what is in progress, and what is planned next.
          Use the form below to submit a feature request — it will appear in the backlog immediately.
        </p>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' as const }}>
          {[
            { num: COMPLETED_FEATURES.length, label: 'Completed', color: t.green },
            { num: IN_DEV_FEATURES.length,    label: 'In Development', color: t.orange },
            { num: BACKLOG_FEATURES.length + featureRequests.length, label: 'In Backlog', color: '#6366f1' },
          ].map(({ num, label, color }) => (
            <div key={label} style={{ background: 'rgba(255,255,255,0.07)', borderRadius: 8, padding: '8px 16px', border: '1px solid rgba(255,255,255,0.1)' }}>
              <div style={{ fontSize: 22, fontWeight: 800, color, lineHeight: 1 }}>{num}</div>
              <div style={{ fontSize: 10, color: 'rgba(200,220,255,0.75)', marginTop: 2 }}>{label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── In Development ── */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ ...sectionLabel, color: t.orange } as React.CSSProperties}>
          In Development ({IN_DEV_FEATURES.length})
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 8 }}>
          {IN_DEV_FEATURES.map(f => featureCard(f.title, f.category, f.desc, 'in_development', 'dev'))}
        </div>
      </div>

      {/* ── Backlog ── */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ ...sectionLabel, color: '#6366f1' } as React.CSSProperties}>
          Backlog ({BACKLOG_FEATURES.length + featureRequests.length})
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 8 }}>
          {BACKLOG_FEATURES.map(f => featureCard(f.title, f.category, f.desc, 'backlog', 'bl'))}
          {featureRequests.map(r => featureCard(r.title, r.category, r.description, 'backlog', r.id))}
        </div>
      </div>

      {/* ── Request a Feature ── */}
      <div style={{ marginBottom: 28 }}>
        <div style={sectionLabel as React.CSSProperties}>Request a Feature</div>
        <div style={{
          ...card() as React.CSSProperties,
          borderLeft: `4px solid ${t.blue}`, paddingLeft: 16,
        }}>
          <p style={{ fontSize: 11, color: t.textMuted, lineHeight: 1.6, margin: '0 0 16px' }}>
            Have an idea? Tell us what you need. Submitted requests go straight to the backlog above.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 10 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <div style={{ fontSize: 9, fontWeight: 700, color: t.textFaint, letterSpacing: '0.08em', textTransform: 'uppercase' as const, marginBottom: 5 }}>Title *</div>
                <input
                  value={reqForm.title}
                  onChange={e => setReqForm(p => ({ ...p, title: e.target.value }))}
                  placeholder="e.g. Export route to CSV"
                  style={{
                    width: '100%', boxSizing: 'border-box' as const,
                    background: t.bgBase, border: `1px solid ${t.border}`, borderRadius: 6,
                    color: t.text, fontSize: 12, padding: '7px 10px', outline: 'none', fontFamily: 'inherit',
                  }}
                />
              </div>
              <div>
                <div style={{ fontSize: 9, fontWeight: 700, color: t.textFaint, letterSpacing: '0.08em', textTransform: 'uppercase' as const, marginBottom: 5 }}>Category *</div>
                <select
                  value={reqForm.category}
                  onChange={e => setReqForm(p => ({ ...p, category: e.target.value }))}
                  style={{
                    width: '100%', boxSizing: 'border-box' as const,
                    background: t.bgBase, border: `1px solid ${t.border}`, borderRadius: 6,
                    color: reqForm.category ? t.text : t.textFaint, fontSize: 12, padding: '7px 10px', fontFamily: 'inherit',
                  }}
                >
                  <option value="">Select a category…</option>
                  {FEATURE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div>
              <div style={{ fontSize: 9, fontWeight: 700, color: t.textFaint, letterSpacing: '0.08em', textTransform: 'uppercase' as const, marginBottom: 5 }}>Description</div>
              <textarea
                value={reqForm.description}
                onChange={e => setReqForm(p => ({ ...p, description: e.target.value }))}
                placeholder="What would this feature do? Who would use it and why?"
                rows={3}
                style={{
                  width: '100%', boxSizing: 'border-box' as const, resize: 'vertical' as const,
                  background: t.bgBase, border: `1px solid ${t.border}`, borderRadius: 6,
                  color: t.text, fontSize: 12, padding: '7px 10px', outline: 'none', fontFamily: 'inherit', lineHeight: 1.5,
                }}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button
                onClick={submitFeatureRequest}
                disabled={reqSubmitting || !reqForm.title.trim() || !reqForm.category}
                style={{
                  padding: '8px 20px', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 700,
                  background: (!reqForm.title.trim() || !reqForm.category) ? t.border : t.blue,
                  color: (!reqForm.title.trim() || !reqForm.category) ? t.textFaint : '#fff',
                  border: 'none', transition: 'all 0.15s', fontFamily: 'inherit',
                }}
              >
                {reqSubmitting ? 'Submitting…' : 'Submit Request'}
              </button>
              {reqDone && (
                <span style={{ fontSize: 11, color: t.green, fontWeight: 600 }}>
                  ✓ Request added to backlog
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Completed ── */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ ...sectionLabel, color: t.green } as React.CSSProperties}>
          Completed ({COMPLETED_FEATURES.length})
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 8 }}>
          {COMPLETED_FEATURES.map(f => featureCard(f.title, f.category, f.desc, 'completed', 'done'))}
        </div>
      </div>

      {/* Footer */}
      <div style={{ textAlign: 'center', padding: '20px 0 0', borderTop: `1px solid ${t.border}` }}>
        <div style={{ fontSize: 11, color: t.textFaint }}>International Telco · RouteBuilder · Feature Backlog</div>
      </div>
    </div>
  )
  if (page === 6 && !printAll) return backlogPage

  // ── Page 7: IT & Enterprise Readiness ─────────────────────────────────────
  const itPage = (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '0 16px 60px', fontFamily: 'system-ui, sans-serif', color: t.text }}>
      {!printAll && pageTabs}

      {/* Hero */}
      <div style={{
        background: 'linear-gradient(135deg, #0f1e3c 0%, #1e3a5f 60%, #1a4731 100%)',
        borderRadius: 12, padding: '44px 40px 40px', marginBottom: 28,
        position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', right: -40, top: -40, width: 220, height: 220, borderRadius: '50%', background: 'rgba(255,255,255,0.04)' }} />
        <div style={{ position: 'relative' }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(134,239,172,0.8)', marginBottom: 10 }}>
            Internal IT · Productionisation Guide
          </div>
          <div style={{ fontSize: 36, fontWeight: 800, color: '#fff', lineHeight: 1.1, marginBottom: 8 }}>
            Route<span style={{ color: '#4ade80' }}>Builder</span> <span style={{ color: 'rgba(255,255,255,0.6)', fontWeight: 400 }}>for IT Teams</span>
          </div>
          <p style={{ fontSize: 14, color: 'rgba(185,245,210,0.85)', lineHeight: 1.7, maxWidth: 620, margin: '0 0 24px' }}>
            Everything you need to take RouteBuilder from prototype to a production-grade enterprise application —
            architecture, dependencies, security posture, hosting options, auth integration, and compliance alignment.
          </p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {['React 18 + TypeScript', 'FastAPI (Python)', 'PostgreSQL', 'Railway / Vercel', 'ISO 27001 Aligned'].map(b => (
              <span key={b} style={{ fontSize: 11, fontWeight: 700, padding: '5px 12px', borderRadius: 20, background: 'rgba(255,255,255,0.1)', color: 'rgba(220,255,235,0.9)', border: '1px solid rgba(255,255,255,0.15)', letterSpacing: '0.04em' }}>{b}</span>
            ))}
          </div>
        </div>
      </div>

      {/* Package inventories */}
      <div style={{ marginBottom: 32 }}>
        <div style={sectionLabel as React.CSSProperties}>Software Bill of Materials</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

          {/* Frontend */}
          <div style={{ background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 10, padding: '18px 20px' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: t.text, marginBottom: 14 }}>Frontend (npm)</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${t.border}` }}>
                  <th style={{ textAlign: 'left', padding: '4px 6px', color: t.textFaint, fontWeight: 600 }}>Package</th>
                  <th style={{ textAlign: 'left', padding: '4px 6px', color: t.textFaint, fontWeight: 600 }}>Version</th>
                  <th style={{ textAlign: 'left', padding: '4px 6px', color: t.textFaint, fontWeight: 600 }}>Purpose</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['react', '18.x', 'UI framework'],
                  ['react-dom', '18.x', 'DOM renderer'],
                  ['typescript', '5.x', 'Type safety'],
                  ['vite', '5.x', 'Build tool / dev server'],
                  ['leaflet', '1.x', 'Interactive maps'],
                  ['react-leaflet', '4.x', 'React map bindings'],
                  ['@dnd-kit/core', '6.x', 'Drag-and-drop'],
                  ['file-saver', '2.x', 'Client-side file export'],
                  ['html2canvas', '1.x', 'PDF screenshot capture'],
                  ['jspdf', '2.x', 'PDF generation'],
                  ['papaparse', '5.x', 'CSV parsing'],
                ].map(([pkg, ver, purpose]) => (
                  <tr key={pkg} style={{ borderBottom: `1px solid ${t.border}22` }}>
                    <td style={{ padding: '5px 6px', fontFamily: 'monospace', color: t.blue }}>{pkg}</td>
                    <td style={{ padding: '5px 6px', color: t.textFaint }}>{ver}</td>
                    <td style={{ padding: '5px 6px', color: t.textMuted }}>{purpose}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Backend */}
          <div style={{ background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 10, padding: '18px 20px' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: t.text, marginBottom: 14 }}>Backend (Python / pip)</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${t.border}` }}>
                  <th style={{ textAlign: 'left', padding: '4px 6px', color: t.textFaint, fontWeight: 600 }}>Package</th>
                  <th style={{ textAlign: 'left', padding: '4px 6px', color: t.textFaint, fontWeight: 600 }}>Version</th>
                  <th style={{ textAlign: 'left', padding: '4px 6px', color: t.textFaint, fontWeight: 600 }}>Purpose</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['fastapi', '0.110+', 'REST API framework'],
                  ['uvicorn', '0.29+', 'ASGI server'],
                  ['pydantic', '2.x', 'Data validation / serialisation'],
                  ['psycopg2-binary', '2.9+', 'PostgreSQL driver'],
                  ['python-dotenv', '1.x', 'Env var loading'],
                  ['anthropic', '0.x (opt)', 'Claude LLM (NLP feature)'],
                  ['openai', '1.x (opt)', 'GPT-4o-mini (NLP alt)'],
                  ['networkx', '3.x', 'Graph routing algorithms'],
                  ['shapely', '2.x', 'Geospatial geometry'],
                  ['pyproj', '3.x', 'Coordinate transforms'],
                  ['python-multipart', '0.0.9+', 'File upload support'],
                ].map(([pkg, ver, purpose]) => (
                  <tr key={pkg} style={{ borderBottom: `1px solid ${t.border}22` }}>
                    <td style={{ padding: '5px 6px', fontFamily: 'monospace', color: '#a78bfa' }}>{pkg}</td>
                    <td style={{ padding: '5px 6px', color: t.textFaint }}>{ver}</td>
                    <td style={{ padding: '5px 6px', color: t.textMuted }}>{purpose}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* External services */}
      <div style={{ marginBottom: 32 }}>
        <div style={sectionLabel as React.CSSProperties}>External Service Dependencies</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
          {[
            { icon: '🗄', name: 'PostgreSQL', tier: 'Required', color: '#3b82f6', desc: 'Primary data store. Falls back to JSON files if DATABASE_URL is absent (dev only — not suitable for production multi-user use).' },
            { icon: '🤖', name: 'LLM API (Claude / GPT)', tier: 'Optional', color: '#8b5cf6', desc: 'Powers TSABuddy natural language search. Set NLP_ENABLED=true + one API key. Application is fully functional without it.' },
            { icon: '🔑', name: 'Microsoft Entra ID / Okta', tier: 'Recommended', color: '#f59e0b', desc: 'SSO / OIDC. Not yet wired in — implementation guide below. No auth exists today; add before production launch.' },
            { icon: '📦', name: 'CDN / Static Hosting', tier: 'Required', color: '#10b981', desc: 'Frontend build artefacts are static files. Serve via Vercel, S3+CloudFront, or Nginx. No server-side rendering required.' },
          ].map(svc => (
            <div key={svc.name} style={{ background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 10, padding: '16px 18px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <span style={{ fontSize: 20 }}>{svc.icon}</span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: t.text }}>{svc.name}</div>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: `${svc.color}22`, color: svc.color, border: `1px solid ${svc.color}44` }}>{svc.tier}</span>
                </div>
              </div>
              <p style={{ fontSize: 11, color: t.textMuted, lineHeight: 1.6, margin: 0 }}>{svc.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Security posture */}
      <div style={{ marginBottom: 32 }}>
        <div style={sectionLabel as React.CSSProperties}>Security Posture</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div style={{ background: '#1c1c2e', border: '1px solid #f38ba844', borderRadius: 10, padding: '18px 20px' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#f38ba8', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Current State (Prototype)</div>
            {[
              ['❌', 'No authentication — open access'],
              ['❌', 'No authorisation / RBAC'],
              ['❌', 'No audit logging'],
              ['⚠️', 'API keys in environment variables (insecure at rest)'],
              ['⚠️', 'No rate limiting on API endpoints'],
              ['⚠️', 'CORS allows all origins in dev mode'],
              ['✅', 'HTTPS enforced on Railway / Vercel'],
              ['✅', 'No PII in data model'],
              ['✅', 'Input validation via Pydantic on all endpoints'],
              ['✅', 'Dependencies updated — no known CVEs (as of build date)'],
            ].map(([icon, text]) => (
              <div key={text} style={{ display: 'flex', gap: 8, marginBottom: 6, fontSize: 11, color: t.textMuted, lineHeight: 1.5 }}>
                <span>{icon}</span><span>{text}</span>
              </div>
            ))}
          </div>
          <div style={{ background: '#0f2018', border: '1px solid #a6e3a144', borderRadius: 10, padding: '18px 20px' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#a6e3a1', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Target State (Production)</div>
            {[
              ['✅', 'SSO via Entra ID / Okta (OIDC)'],
              ['✅', 'Role-based access: Viewer / Editor / Admin'],
              ['✅', 'Immutable audit log (who changed what, when)'],
              ['✅', 'API keys stored in secrets manager (AWS Secrets Manager / Azure Key Vault)'],
              ['✅', 'Rate limiting + WAF on public endpoints'],
              ['✅', 'CORS locked to corporate domain only'],
              ['✅', 'Automated Dependabot / Snyk scanning in CI'],
              ['✅', 'Data classification label: Commercial Confidential'],
              ['✅', 'Penetration test prior to external exposure'],
              ['✅', 'Disaster recovery: DB snapshot + RTO < 4 h'],
            ].map(([icon, text]) => (
              <div key={text} style={{ display: 'flex', gap: 8, marginBottom: 6, fontSize: 11, color: t.textMuted, lineHeight: 1.5 }}>
                <span>{icon}</span><span>{text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Hosting options */}
      <div style={{ marginBottom: 32 }}>
        <div style={sectionLabel as React.CSSProperties}>Hosting Options</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          {[
            {
              icon: '🚀', label: 'Option A', title: 'Railway + Vercel', color: '#3b82f6',
              effort: 'Low', cost: '$20–$100/mo', time: '1–2 days',
              desc: 'Current setup. Railway hosts the FastAPI backend + Postgres; Vercel serves the static frontend. Zero-ops, auto-deploy on git push. Ideal for continued rapid iteration.',
              pros: ['Zero infrastructure management', 'Auto TLS, auto-scale', 'Deploy in minutes', 'Free tier for low traffic'],
              cons: ['Data leaves on-prem', 'Limited compliance controls', 'Vendor lock-in'],
            },
            {
              icon: '☁️', label: 'Option B (Recommended)', title: 'AWS (ECS + RDS)', color: '#f59e0b',
              effort: 'Medium', cost: '$150–$400/mo', time: '2–4 weeks',
              desc: 'Container on ECS Fargate + RDS PostgreSQL in your AWS account. Full control over VPC, IAM, KMS, CloudTrail. Supports enterprise security requirements and ISO 27001 evidence.',
              pros: ['Data stays in your AWS account', 'Full IAM / KMS / CloudTrail', 'WAF + Shield available', 'VPC isolation', 'SOC 2 / ISO 27001 AWS services'],
              cons: ['Requires AWS expertise', 'More setup time', 'Higher baseline cost'],
            },
            {
              icon: '🏢', label: 'Option C', title: 'On-Premises / Private Cloud', color: '#8b5cf6',
              effort: 'High', cost: 'Infra cost + ops', time: '4–8 weeks',
              desc: 'Deploy on internal Kubernetes or VM fleet. Maximum data sovereignty. Suitable if data classification prohibits any cloud hosting or if integrating with internal network inventory systems.',
              pros: ['Full data sovereignty', 'No external dependencies', 'Integrate with internal APIs', 'Custom network controls'],
              cons: ['Full ops burden on IT', 'Slower to iterate', 'Requires container expertise'],
            },
          ].map(opt => (
            <div key={opt.title} style={{ background: t.bgCard, border: `1px solid ${opt.color}44`, borderRadius: 10, padding: '18px 20px' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: opt.color, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>{opt.label}</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: t.text, marginBottom: 6 }}>{opt.icon} {opt.title}</div>
              <p style={{ fontSize: 11, color: t.textMuted, lineHeight: 1.6, margin: '0 0 12px' }}>{opt.desc}</p>
              <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                {[['Effort', opt.effort], ['Est. Cost', opt.cost], ['Setup', opt.time]].map(([k, v]) => (
                  <div key={k} style={{ background: `${opt.color}11`, border: `1px solid ${opt.color}33`, borderRadius: 6, padding: '4px 10px', fontSize: 10 }}>
                    <span style={{ color: t.textFaint }}>{k}: </span><span style={{ color: opt.color, fontWeight: 700 }}>{v}</span>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 10, color: t.textFaint, marginBottom: 4, fontWeight: 600 }}>PROS</div>
              {opt.pros.map(p => <div key={p} style={{ fontSize: 10, color: t.textMuted, marginBottom: 2 }}>✓ {p}</div>)}
              <div style={{ fontSize: 10, color: t.textFaint, marginBottom: 4, fontWeight: 600, marginTop: 8 }}>CONS</div>
              {opt.cons.map(c => <div key={c} style={{ fontSize: 10, color: t.textMuted, marginBottom: 2 }}>· {c}</div>)}
            </div>
          ))}
        </div>
      </div>

      {/* Auth integration */}
      <div style={{ marginBottom: 32 }}>
        <div style={sectionLabel as React.CSSProperties}>Authentication Integration Guide</div>
        <div style={{ background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 10, padding: '18px 20px', marginBottom: 12, fontSize: 11, color: t.textMuted, lineHeight: 1.7 }}>
          RouteBuilder currently has <strong style={{ color: t.text }}>no authentication</strong>. The recommended approach is OIDC/OAuth 2.0 via your existing identity provider.
          The frontend handles the auth flow and attaches a JWT Bearer token to every API request; the FastAPI backend validates it on each route.
          Both Entra ID and Okta use identical patterns — only the issuer URL differs.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {[
            {
              title: 'Microsoft Entra ID (Azure AD)', color: '#0078d4', icon: '🔷',
              steps: [
                'Register app in Azure Portal → App registrations → New registration',
                'Set Redirect URI: https://your-app.com/auth/callback',
                'Copy Application (client) ID + Directory (tenant) ID',
                'Add frontend env: VITE_AZURE_CLIENT_ID, VITE_AZURE_TENANT_ID',
                'Install: npm install @azure/msal-browser @azure/msal-react',
                'Wrap <App> in <MsalProvider> with PublicClientApplication config',
                'Use useMsalAuthentication() hook on protected routes',
                'Backend: validate JWT against https://login.microsoftonline.com/{tenant}/discovery/keys',
              ],
            },
            {
              title: 'Okta', color: '#007dc1', icon: '🔐',
              steps: [
                'Create Application in Okta Admin → Applications → Create App Integration',
                'Choose OIDC – Single-Page Application',
                'Set Sign-in redirect URI: https://your-app.com/login/callback',
                'Copy Client ID + Okta domain',
                'Add frontend env: VITE_OKTA_CLIENT_ID, VITE_OKTA_ISSUER',
                'Install: npm install @okta/okta-auth-js @okta/okta-react',
                'Wrap <App> in <Security> component with oktaAuth config',
                'Backend: validate JWT against https://{okta-domain}/oauth2/default/v1/keys',
              ],
            },
          ].map(idp => (
            <div key={idp.title} style={{ background: t.bgCard, border: `1px solid ${idp.color}44`, borderRadius: 10, padding: '18px 20px' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: t.text, marginBottom: 14 }}>{idp.icon} {idp.title}</div>
              {idp.steps.map((step, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, marginBottom: 8, fontSize: 11, color: t.textMuted, lineHeight: 1.5 }}>
                  <span style={{ width: 18, height: 18, borderRadius: '50%', background: `${idp.color}22`, color: idp.color, fontSize: 10, fontWeight: 700, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{i + 1}</span>
                  <span>{step}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* ISO 27001 */}
      <div style={{ marginBottom: 32 }}>
        <div style={sectionLabel as React.CSSProperties}>ISO 27001 Control Alignment</div>
        <div style={{ background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 10, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr style={{ background: t.bgDeep }}>
                {['Control Domain', 'Control', 'Current Status', 'Action Required'].map(h => (
                  <th key={h} style={{ padding: '10px 14px', textAlign: 'left', color: t.textFaint, fontWeight: 700, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                ['A.5 Policies', 'Information security policy', '⚠️ Partial', 'Add data classification policy covering RouteBuilder'],
                ['A.6 Org Controls', 'Roles and responsibilities', '⚠️ Partial', 'Define Owner, Admin, Editor, Viewer roles in RBAC'],
                ['A.8 Asset Mgmt', 'Inventory of assets', '✅ Done', 'SBOM captured in this guide — register in asset register'],
                ['A.9 Access Control', 'User access management', '❌ Missing', 'Implement SSO + RBAC (see Auth Integration above)'],
                ['A.9 Access Control', 'Privileged access', '❌ Missing', 'No admin accounts — add Admin role with audit trail'],
                ['A.10 Cryptography', 'Encryption in transit', '✅ Done', 'HTTPS enforced on all current hosting tiers'],
                ['A.10 Cryptography', 'Encryption at rest', '⚠️ Partial', 'Enable RDS/Postgres encrypted storage (AWS option)'],
                ['A.12 Operations', 'Monitoring & logging', '❌ Missing', 'Implement structured API logging + alerting'],
                ['A.12 Operations', 'Vulnerability management', '⚠️ Partial', 'Enable Dependabot + schedule quarterly pen test'],
                ['A.12 Operations', 'Backup & recovery', '⚠️ Partial', 'Enable automated DB snapshots, test restore procedure'],
                ['A.13 Comms Security', 'Network access controls', '⚠️ Partial', 'Lock CORS to corporate domains; add WAF in production'],
                ['A.14 Dev Security', 'Secure development', '✅ Done', 'Pydantic validation on all inputs; no raw SQL'],
                ['A.16 Incident Mgmt', 'Incident response', '❌ Missing', 'Register app in incident response runbook'],
                ['A.18 Compliance', 'Privacy & data protection', '✅ Done', 'No PII in data model (network topology only)'],
              ].map(([domain, ctrl, status, action], i) => (
                <tr key={i} style={{ borderTop: `1px solid ${t.border}` }}>
                  <td style={{ padding: '9px 14px', color: t.textFaint, fontWeight: 600 }}>{domain}</td>
                  <td style={{ padding: '9px 14px', color: t.textMuted }}>{ctrl}</td>
                  <td style={{ padding: '9px 14px', color: status.includes('✅') ? '#a6e3a1' : status.includes('❌') ? '#f38ba8' : '#f9e2af' }}>{status}</td>
                  <td style={{ padding: '9px 14px', color: t.textMuted, fontSize: 10 }}>{action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 6-step productionisation process */}
      <div style={{ marginBottom: 32 }}>
        <div style={sectionLabel as React.CSSProperties}>6-Step Productionisation Roadmap</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          {[
            { step: '01', title: 'Auth & Access Control', time: '1–2 weeks', color: '#f38ba8',
              items: ['Integrate Entra ID or Okta via OIDC', 'Implement Viewer / Editor / Admin roles', 'Lock API endpoints with JWT middleware', 'Audit existing user base'] },
            { step: '02', title: 'Hosting & Infrastructure', time: '1–2 weeks', color: '#f9e2af',
              items: ['Select hosting tier (Railway / AWS / On-prem)', 'Configure PostgreSQL with automated backups', 'Set up CI/CD pipeline (GitHub Actions)', 'Lock environment variables in secrets manager'] },
            { step: '03', title: 'Security Hardening', time: '1 week', color: '#fab387',
              items: ['Lock CORS to corporate domains', 'Add rate limiting to API', 'Enable Dependabot scanning', 'Review and rotate all API keys'] },
            { step: '04', title: 'Observability', time: '3–5 days', color: '#a6e3a1',
              items: ['Structured JSON logging on all API requests', 'Uptime monitoring (Uptime Robot / Datadog)', 'Error alerting to Slack / PagerDuty', 'DB slow-query monitoring'] },
            { step: '05', title: 'Testing & Validation', time: '1 week', color: '#89dceb',
              items: ['User acceptance testing with TSA team', 'Load test with k6 / Locust (target: 50 concurrent users)', 'Penetration test (internal or third party)', 'DR drill: restore from DB snapshot'] },
            { step: '06', title: 'Documentation & Handover', time: '3–5 days', color: '#b4befe',
              items: ['Register in asset inventory + CMDB', 'Runbook: startup, shutdown, disaster recovery', 'Onboarding guide for new editors', 'Schedule quarterly security review'] },
          ].map(s => (
            <div key={s.step} style={{ background: t.bgCard, border: `1px solid ${s.color}44`, borderRadius: 10, padding: '16px 18px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <div style={{ width: 32, height: 32, borderRadius: '50%', background: `${s.color}22`, border: `2px solid ${s.color}66`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, color: s.color, flexShrink: 0 }}>{s.step}</div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: t.text }}>{s.title}</div>
                  <div style={{ fontSize: 10, color: t.textFaint }}>Est. {s.time}</div>
                </div>
              </div>
              {s.items.map(item => (
                <div key={item} style={{ display: 'flex', gap: 7, marginBottom: 5, fontSize: 11, color: t.textMuted, lineHeight: 1.5 }}>
                  <span style={{ color: s.color, flexShrink: 0 }}>→</span><span>{item}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div style={{ textAlign: 'center', padding: '20px 0 0', borderTop: `1px solid ${t.border}` }}>
        <div style={{ fontSize: 11, color: t.textFaint }}>International Telco · RouteBuilder · IT &amp; Enterprise Readiness</div>
      </div>
    </div>
  )
  if (page === 7 && !printAll) return itPage

  // ── Page 1: Product Overview ───────────────────────────────────────────────
  const overview = (
    <div style={{
      maxWidth: 860, margin: '0 auto', padding: '0 16px 60px',
      fontFamily: 'system-ui, sans-serif', color: t.text,
    }}>
      {!printAll && pageTabs}

      {/* ── Hero ── */}
      <div style={{
        background: `linear-gradient(135deg, #0f1e3c 0%, #1a3a6e 60%, #1d4ed8 100%)`,
        borderRadius: 12, padding: '44px 40px 40px', marginBottom: 28,
        position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', right: -40, top: -40, width: 220, height: 220, borderRadius: '50%', background: 'rgba(255,255,255,0.04)' }} />
        <div style={{ position: 'absolute', right: 40, bottom: -60, width: 160, height: 160, borderRadius: '50%', background: 'rgba(255,255,255,0.03)' }} />

        <div style={{ position: 'relative' }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(147,197,253,0.8)', marginBottom: 10 }}>
            International Telco
          </div>
          <div style={{ fontSize: 36, fontWeight: 800, color: '#fff', lineHeight: 1.1, marginBottom: 8 }}>
            Route<span style={{ color: '#60a5fa' }}>Builder</span>
          </div>
          <div style={{ fontSize: 16, color: 'rgba(186,220,255,0.9)', fontWeight: 500, marginBottom: 20, maxWidth: 520, lineHeight: 1.5 }}>
            The fastest way to design, price and sell a subsea route.
          </div>
          <p style={{ fontSize: 13, color: 'rgba(160,190,240,0.85)', maxWidth: 560, lineHeight: 1.7, margin: 0 }}>
            RouteBuilder replaces spreadsheets and tribal knowledge with a fast, visual, commercially-aware platform.
            Any sales or network engineer can identify optimal routes in seconds, assess margin at a glance,
            validate diversity, and deliver a customer-ready straight-line diagram — all from one interface.
          </p>
          <button
            onClick={handlePrint}
            style={{
              marginTop: 24, padding: '10px 22px', borderRadius: 8,
              background: '#2563eb', border: '1px solid rgba(255,255,255,0.2)',
              color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer',
              letterSpacing: '0.02em',
            }}
          >
            ↓ Export as PDF
          </button>
        </div>
      </div>

      {/* ── Stats strip ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 28 }}>
        {[
          [String(nodeCount),    'Nodes',         'Landing stations, terrestrial PoPs & branching units'],
          [String(segmentCount), 'Segments',       `Wet & backhaul across ${systemCount} cable systems`],
          [String(systemCount),  'Cable Systems',  'Owned, consortium, IRU & partner capacity'],
        ].map(([num, label, sub]) => (
          <div key={label} style={{ ...card(), textAlign: 'center', padding: '18px 12px' }}>
            <div style={{ fontSize: 32, fontWeight: 800, color: t.blue, lineHeight: 1 }}>{num}</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: t.text, marginTop: 4 }}>{label}</div>
            <div style={{ fontSize: 10, color: t.textFaint, marginTop: 3, lineHeight: 1.4 }}>{sub}</div>
          </div>
        ))}
      </div>

      {/* ── Two primary modes ── */}
      <div style={{ marginBottom: 32 }}>
        <div style={sectionLabel}>Two Ways to Build a Route</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
          {/* RouteBuilder group */}
          <div style={{ background: t.bgCard, border: `2px solid ${t.blue}`, borderRadius: 12, padding: '20px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: `${t.blue}22`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={t.blue} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12h18M3 6l9-3 9 3M3 18l9 3 9-3"/></svg>
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 800, color: t.text }}>RouteBuilder</div>
                <div style={{ fontSize: 10, color: t.textMuted }}>Left panel top-level tab</div>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 10 }}>
              <div style={{ background: t.bgBase, borderRadius: 8, padding: '12px 14px', border: `1px solid ${t.blue}44` }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: t.blue, marginBottom: 4 }}>RouteFinder (automated)</div>
                <div style={{ fontSize: 11, color: t.textMuted, lineHeight: 1.6 }}>
                  The graph-based pathfinding engine. Describe a route — by nodes, systems, countries, or in plain English via TSABuddy — and the engine finds all viable paths ranked by your chosen metric. Supports diversity, constraints, and real-time capacity weighting. Best for exploring options quickly.
                </div>
              </div>
              <div style={{ background: t.bgBase, borderRadius: 8, padding: '12px 14px', border: `1px solid #f59e0b44` }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: '#f59e0b', marginBottom: 4 }}>RouteManual (DIY)</div>
                <div style={{ fontSize: 11, color: t.textMuted, lineHeight: 1.6 }}>
                  Expert manual mode. Click an origin node on the map, then pick each next hop one at a time from a list of directly-connected nodes — with per-hop stats (km, ms, margin, ownership) shown to guide your choice. Undo any step. When you reach your destination, double-click to finish and the assembled path becomes a standard route card with full statistics.
                </div>
              </div>
            </div>
          </div>

          {/* NetworkExplorer group */}
          <div style={{ background: t.bgCard, border: `2px solid ${t.border}`, borderRadius: 12, padding: '20px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: `${t.green}22`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={t.green} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 800, color: t.text }}>NetworkExplorer</div>
                <div style={{ fontSize: 10, color: t.textMuted }}>Left panel top-level tab — "look, don't build"</div>
              </div>
            </div>
            <div style={{ fontSize: 11, color: t.textMuted, lineHeight: 1.6, marginBottom: 10 }}>
              Exploratory tools for understanding the network — not for building routes. Use these to brief yourself on topology, capacity, and health before entering a design session.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 6 }}>
              {[
                { label: '🌍 Country Viewer', desc: 'All cables serving a country — subsea systems coloured by system, terrestrial backhaul overlaid.' },
                { label: '🏙 City Pairs', desc: 'Fast subsea system itineraries between two cities without a full route search.' },
                { label: '🌊 Subsea Systems', desc: 'Highlight one or more cable systems on the map to inspect their routes and node coverage.' },
                { label: '🔍 Node Search', desc: 'Find a specific node by name, pin it on the map, and use it as a jump-off for route searches.' },
              ].map(({ label, desc }) => (
                <div key={label} style={{ background: t.bgBase, borderRadius: 6, padding: '8px 10px', border: `1px solid ${t.border}` }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: t.text, marginBottom: 2 }}>{label}</div>
                  <div style={{ fontSize: 10, color: t.textMuted, lineHeight: 1.4 }}>{desc}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div style={{ background: `${t.blue}11`, border: `1px solid ${t.blue}33`, borderRadius: 8, padding: '10px 14px', fontSize: 11, color: t.textMuted, lineHeight: 1.6 }}>
          <strong style={{ color: t.blue }}>Tip:</strong> RouteFinder and RouteManual both produce the same output — a route card with full statistics that can be pinned, compared, added to a project, and exported as an SLD. The difference is how you get there: automated vs. expert-controlled.
        </div>
      </div>

      {/* ── Features ── */}
      <div style={{ marginBottom: 32 }}>
        <div style={sectionLabel}>Key Features</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 }}>
          {FEATURES.map(f => (
            <div key={f.title} style={card({ display: 'flex', flexDirection: 'column', gap: 8 })}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 22, lineHeight: 1 }}>{f.icon}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: t.text, lineHeight: 1.3 }}>{f.title}</span>
              </div>
              <p style={{ fontSize: 11, color: t.textMuted, lineHeight: 1.6, margin: 0 }}>{f.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── How to use ── */}
      <div style={{ marginBottom: 32 }}>
        <div style={sectionLabel}>Building Your First Route</div>
        <div style={{ ...card(), display: 'flex', flexDirection: 'column', gap: 0 }}>
          {STEPS.map((s, i) => (
            <div key={s.title} style={{
              display: 'flex', gap: 14, alignItems: 'flex-start',
              paddingBottom: i < STEPS.length - 1 ? 14 : 0,
              marginBottom: i < STEPS.length - 1 ? 14 : 0,
              borderBottom: i < STEPS.length - 1 ? `1px solid ${t.border}` : 'none',
            }}>
              <div style={{
                width: 26, height: 26, borderRadius: '50%', background: t.blue,
                color: '#fff', fontSize: 11, fontWeight: 800, flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {i + 1}
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: t.text, marginBottom: 3 }}>{s.title}</div>
                <div style={{ fontSize: 11, color: t.textMuted, lineHeight: 1.6 }}>{s.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── TSABuddy ── */}
      <div style={{ marginBottom: 32 }}>
        <div style={sectionLabel}>Using TSABuddy</div>
        <div style={{ ...card(), background: '#0f1e3c', border: '1px solid #1d4ed8' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <span style={{ fontSize: 22 }}>🤖</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>TSABuddy — Natural Language Route Design</div>
              <div style={{ fontSize: 11, color: 'rgba(160,190,255,0.8)', marginTop: 2 }}>
                Type a route request in plain English. TSABuddy configures all parameters and triggers the search automatically.
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {[
              { text: 'Singapore to Hong Kong with wet diversity', tag: 'Diversity' },
              { text: 'Sydney to Tokyo avoiding AAG, sort by latency', tag: 'Avoid system' },
              { text: 'Perth to Singapore via SIN3 on Indigo, full diversity', tag: 'Via node + system' },
              { text: 'Singapore to Tokyo avoiding China and Taiwan', tag: 'Country constraints' },
              { text: 'London to Singapore must land in India, full diversity', tag: 'Must include country' },
              { text: 'SIN3 to TKO1 on EAC, optimise for margin', tag: 'Pool selection' },
            ].map(({ text, tag }) => (
              <div key={text} style={{
                display: 'flex', alignItems: 'flex-start', gap: 10,
                background: 'rgba(255,255,255,0.05)', borderRadius: 6,
                padding: '7px 12px', borderLeft: '3px solid #3b82f6',
              }}>
                <div style={{ fontSize: 11, color: '#93c5fd', fontStyle: 'italic', flex: 1 }}>"{text}"</div>
                <div style={{
                  fontSize: 9, fontWeight: 700, color: '#60a5fa', flexShrink: 0,
                  background: 'rgba(59,130,246,0.15)', borderRadius: 4, padding: '2px 6px',
                  letterSpacing: '0.04em', whiteSpace: 'nowrap',
                }}>{tag}</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 12, fontSize: 10, color: 'rgba(147,197,253,0.7)', lineHeight: 1.5 }}>
            High and medium confidence results trigger an automatic search. Low confidence shows a "Search anyway" option with full parameter preview. Country constraints are expressed as ISO codes (e.g. CN, TW) — never as individual node IDs.
          </div>
        </div>
      </div>

      {/* ── Diversity Types ── */}
      <div style={{ marginBottom: 32 }}>
        <div style={sectionLabel}>Diversity Types</div>
        <div style={{ ...card() }}>
          <p style={{ fontSize: 11, color: t.textMuted, lineHeight: 1.7, margin: '0 0 14px' }}>
            Diversity ensures two routes share no common point of failure. Choose the level that matches your resilience requirement.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 8 }}>
            {[
              { type: 'None',                   color: t.textFaint, desc: 'Single best-path search. No diversity requirement — returns a ranked list of standalone routes.' },
              { type: 'Wet',                    color: t.blue,      desc: 'Routes must share no submarine cable segments. Terrestrial (backhaul) sections may be shared.' },
              { type: 'Full',                   color: t.blue,      desc: 'Routes share no segments of any type — submarine or terrestrial. The strongest practical standard for most circuits.' },
              { type: 'Full + Node Isolation',  color: '#8b5cf6',   desc: 'As Full, plus no intermediate transit nodes may be shared. The highest level of physical separation.' },
              { type: 'Terrestrial — Origin',   color: t.orange,    desc: 'Routes must use different terrestrial (backhaul) segments at the origin end. Submarine sections may overlap.' },
              { type: 'Terrestrial — Dest.',    color: t.orange,    desc: 'Routes must use different terrestrial segments at the destination end. Submarine sections may overlap.' },
              { type: 'Terrestrial — Both',     color: t.orange,    desc: 'Routes must use different terrestrial segments at both the origin and destination ends simultaneously.' },
            ].map(({ type, color, desc }) => (
              <div key={type} style={{ background: t.bgBase, borderRadius: 6, padding: '10px 12px', border: `1px solid ${t.border}` }}>
                <div style={{ fontSize: 10, fontWeight: 800, color, marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{type}</div>
                <div style={{ fontSize: 10, color: t.textMuted, lineHeight: 1.5 }}>{desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Worker / Protect Pairs ── */}
      <div style={{ marginBottom: 32 }}>
        <div style={sectionLabel}>Diversity Pairs — Worker & Protect</div>
        <div style={{ ...card(), background: '#0d1a2e', border: `1px solid ${t.blue}44` }}>
          <div style={{ display: 'flex', gap: 16, marginBottom: 14, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#93c5fd', marginBottom: 6 }}>🔵 Worker (blue)</div>
              <div style={{ fontSize: 11, color: 'rgba(160,190,255,0.8)', lineHeight: 1.6 }}>
                The primary circuit — carries live traffic under normal conditions. Shown in blue on the map and in the route card.
              </div>
            </div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#86efac', marginBottom: 6 }}>🟢 Protect (green)</div>
              <div style={{ fontSize: 11, color: 'rgba(160,240,190,0.8)', lineHeight: 1.6 }}>
                The failover circuit — stands by to take traffic if the worker fails. Shown in green. Guaranteed to share no segments (or nodes) with the worker, per your diversity setting.
              </div>
            </div>
          </div>
          <div style={{
            background: 'rgba(255,255,255,0.04)', borderRadius: 8, padding: '12px 14px',
            border: '1px solid rgba(255,255,255,0.08)',
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#f9e2af', marginBottom: 6 }}>⇅ Pair Flip</div>
            <div style={{ fontSize: 11, color: 'rgba(200,210,230,0.8)', lineHeight: 1.65 }}>
              Click ⇅ on any diversity pair to swap Worker and Protect roles. This is a full data swap — the map redraws each route under its new colour, the route stats update to reflect the new assignment, and the sort order recalculates using the new worker's metrics. Use this when you want a specific physical path to carry live traffic rather than act as failover — an important technical distinction for circuit provisioning.
            </div>
          </div>
          <div style={{ marginTop: 10, fontSize: 10, color: 'rgba(147,197,253,0.6)', lineHeight: 1.5 }}>
            The ⇅ button appears at the top of each pair card. An orange highlight indicates the pair is currently flipped. Flip state clears automatically when you run a new search.
          </div>
        </div>
      </div>

      {/* ── Country Viewer ── */}
      <div style={{ marginBottom: 32 }}>
        <div style={sectionLabel}>Using Country Viewer</div>
        <div style={{ ...card(), background: '#071a1a', border: `1px solid #0e7490` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <span style={{ fontSize: 22 }}>🌍</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>Country Viewer — Network at a Glance</div>
              <div style={{ fontSize: 11, color: 'rgba(160,220,230,0.8)', marginTop: 2 }}>
                Instantly see every cable system and backhaul route serving any country.
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[
              { step: '1', color: '#0e7490', title: 'Select a country', desc: 'Open the 🌍 Country Viewer tab and type in the search box. The list filters instantly by country name. Click any entry to activate.' },
              { step: '2', color: '#0e7490', title: 'Read the map', desc: 'Each subsea cable system landing in that country is highlighted in a distinct vivid colour. Terrestrial backhaul connecting those stations appears in deep teal. All other segments dim out.' },
              { step: '3', color: '#0e7490', title: 'Filter clutter', desc: 'Use the Subsea Only toggle (top-right) to hide backhaul and see only wet systems. Use Backhaul Only to focus on terrestrial routes. The toggles are mutually exclusive.' },
              { step: '4', color: '#0e7490', title: 'Read system + node counts', desc: 'The panel shows how many cable systems land in the country and how many PoPs / landing stations are present — useful for briefings.' },
              { step: '5', color: '#0e7490', title: 'Open the Node Diagram', desc: 'Click the "View Node Diagram" button (bottom-left of the map while Country Viewer is active) to open a schematic showing every node in the country and the cable systems interconnecting them. Each node is a labelled box; each cable system a colour-coded line with subsea stubs extending to the ocean. Click any line to highlight that system on the main map.' },
            ].map(({ step, color, title, desc }) => (
              <div key={step} style={{
                display: 'flex', gap: 12, alignItems: 'flex-start',
                background: 'rgba(255,255,255,0.03)', borderRadius: 7, padding: '10px 12px',
              }}>
                <div style={{
                  width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                  background: color + '33', border: `2px solid ${color}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 10, fontWeight: 800, color,
                }}>{step}</div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#cce8ec', marginBottom: 3 }}>{title}</div>
                  <div style={{ fontSize: 11, color: 'rgba(160,215,225,0.75)', lineHeight: 1.6 }}>{desc}</div>
                </div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 12, fontSize: 10, color: 'rgba(100,190,210,0.7)', lineHeight: 1.5 }}>
            Seg Labels are automatically enabled when Country Viewer is activated so you can read segment IDs directly on the highlighted routes.
          </div>
        </div>
      </div>

      {/* ── Country Node Diagram ── */}
      <div style={{ marginBottom: 32 }}>
        <div style={sectionLabel}>Country Node Diagram</div>
        <div style={{ ...card(), background: '#071624', border: `1px solid #1e4070` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <span style={{ fontSize: 22 }}>📊</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>Schematic Node Diagram — Topology at a Glance</div>
              <div style={{ fontSize: 11, color: 'rgba(160,210,255,0.8)', marginTop: 2 }}>
                Available in Country Viewer. Click "View Node Diagram" on the map to open.
              </div>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
            {[
              { icon: '⬡', label: 'Nodes as boxes', desc: 'Every landing station and PoP in the country is drawn as a labelled rectangle. Box colour reflects node type — orange for landing stations, blue for primary PoPs, etc.' },
              { icon: '━', label: 'Colour-coded cables', desc: 'Each cable system is assigned a distinct colour. Lines connect nodes that share a segment on that system, with orthogonal routing to keep the layout readable.' },
              { icon: '╮', label: 'Subsea stubs', desc: 'Where a cable continues outside the country (e.g. an onward submarine leg), a 45° diagonal stub extends from the edge node to indicate the outbound direction.' },
              { icon: '🖱', label: 'Click to highlight', desc: 'Click any cable line in the diagram to highlight that cable system on the main map — instantly cross-referencing the schematic with the geographic view.' },
            ].map(({ icon, label, desc }) => (
              <div key={label} style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 7, padding: '10px 12px', border: '1px solid rgba(255,255,255,0.08)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
                  <span style={{ fontSize: 14, color: '#60a5fa' }}>{icon}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#cce4ff' }}>{label}</span>
                </div>
                <div style={{ fontSize: 10, color: 'rgba(160,205,255,0.75)', lineHeight: 1.5 }}>{desc}</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 10, color: 'rgba(100,175,230,0.7)', lineHeight: 1.5 }}>
            The diagram scales to fit all nodes and is fully contained within the panel — no scrolling needed. It is regenerated each time you select a different country.
          </div>
        </div>
      </div>

      {/* ── UI Navigation ── */}
      <div style={{ marginBottom: 32 }}>
        <div style={sectionLabel}>Navigating the Interface</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
          {[
            {
              icon: '‹›',
              title: 'Panel Drawer Toggle',
              desc: 'The arrow button on the left edge of the map collapses the entire left + middle panel (960 px) to give you a full-screen map view. Click again to restore. Great for map presentations and screenshares.',
            },
            {
              icon: '🌊 / 🏗',
              title: 'Subsea Only & Backhaul Only',
              desc: 'Two filter toggles in the top-right control bar. Active only when Country Viewer is running. Subsea Only hides terrestrial routes; Backhaul Only hides subsea. Activating one clears the other.',
            },
            {
              icon: '🏷',
              title: 'Seg Labels Toggle',
              desc: 'Shows segment IDs directly on the map for active and highlighted routes. Automatically enabled when you switch to Country Viewer. Can be toggled manually via the top-right controls.',
            },
            {
              icon: '↔ 🏙 🌊 🌍 🔍 📖',
              title: 'Mode Tabs',
              desc: 'Two top-level tabs — RouteBuilder (RouteFinder + RouteManual sub-tabs) and NetworkExplorer (Country, City Pairs, Systems, Node Search). Each tab clears unrelated highlights so the map stays uncluttered.',
            },
            {
              icon: '🎨',
              title: 'Theme Cycling',
              desc: 'The theme button in the top-right control bar cycles through available colour themes (dark, light, and variants). The theme applies globally — map tiles change automatically to match.',
            },
          ].map(f => (
            <div key={f.title} style={card({ display: 'flex', flexDirection: 'column', gap: 8 })}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 18, lineHeight: 1, letterSpacing: '-0.02em' }}>{f.icon}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: t.text, lineHeight: 1.3 }}>{f.title}</span>
              </div>
              <p style={{ fontSize: 11, color: t.textMuted, lineHeight: 1.6, margin: 0 }}>{f.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Reading route cards ── */}
      <div style={{ marginBottom: 32 }}>
        <div style={sectionLabel}>Reading Route Cards</div>
        <div style={{ ...card() }}>
          <p style={{ fontSize: 11, color: t.textMuted, lineHeight: 1.7, margin: '0 0 14px' }}>
            Each result card contains everything you need to evaluate a route commercially and technically.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
            {[
              ['ON-NET / OFF-NET / MIXED', 'Ownership classification. Mixed shows the % of route on our infrastructure.'],
              ['MARGIN X.X', 'Weighted average commercial margin score. Green ≥7.5, amber ≥4.5, red below 4.5.'],
              ['⚠ Repair Date', 'One or more segments on this route have an active outage. Shows estimated repair date.'],
              ['Hops', 'Number of segments. Branching unit nodes are hidden from the path display for readability.'],
              ['RTD', 'Round-trip delay in milliseconds. Calculated from total route distance at fibre speed.'],
              ['Avail', 'End-to-end reliability as a percentage — product of all segment reliability scores.'],
              ['◈ Est. Capacity', 'Available terabits at the bottleneck segment — the limiting factor for the route.'],
            ].map(([badge, desc]) => (
              <div key={badge} style={{ background: t.bgBase, borderRadius: 6, padding: '10px 12px', border: `1px solid ${t.border}` }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: t.blue, marginBottom: 4, fontFamily: 'monospace' }}>{badge}</div>
                <div style={{ fontSize: 10, color: t.textMuted, lineHeight: 1.5 }}>{desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Roadmap ── */}
      <div style={{ marginBottom: 32 }}>
        <div style={sectionLabel}>Vision & Roadmap</div>
        <div style={{
          background: 'linear-gradient(135deg, #0f1e3c 0%, #1a3a6e 100%)',
          borderRadius: 10, padding: '24px 24px 20px', marginBottom: 14,
        }}>
          <p style={{ fontSize: 15, fontWeight: 700, color: '#fff', margin: '0 0 10px', lineHeight: 1.4 }}>
            RouteBuilder is the foundation for a fully integrated commercial network intelligence platform.
          </p>
          <p style={{ fontSize: 12, color: 'rgba(160,190,255,0.85)', margin: 0, lineHeight: 1.6 }}>
            The network knowledge that today lives in the heads of experienced staff will become a scalable,
            accessible, AI-augmented capability available to every person in the business — and, ultimately,
            to our customers themselves.
          </p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
          {ROADMAP.map(r => (
            <div key={r.title} style={{ ...card(), borderLeft: `4px solid ${r.color}`, paddingLeft: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 18 }}>{r.icon}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: t.text }}>{r.title}</span>
                </div>
                <span style={{
                  fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 10,
                  background: r.color + '22', color: r.color, border: `1px solid ${r.color}55`,
                  whiteSpace: 'nowrap', letterSpacing: '0.04em',
                }}>{r.tag}</span>
              </div>
              <p style={{ fontSize: 11, color: t.textMuted, lineHeight: 1.6, margin: 0 }}>{r.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Footer ── */}
      <div style={{ textAlign: 'center', padding: '20px 0 0', borderTop: `1px solid ${t.border}` }}>
        <div style={{ fontSize: 11, color: t.textFaint, marginBottom: 8 }}>International Telco · RouteBuilder</div>
        <button
          onClick={handlePrint}
          style={{
            padding: '9px 20px', borderRadius: 7,
            background: t.blue, border: 'none',
            color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer',
          }}
        >
          ↓ Export Guide as PDF
        </button>
      </div>
    </div>
  )
  // ── Print-all portal ──────────────────────────────────────────────────────
  if (printAll) {
    const printContent = (
      <div
        ref={printRef}
        id="rb-guide-print-portal"
        style={{
          background: t.bgBase,
          position: 'fixed', top: 0, left: '-200vw', width: '100vw',
          WebkitPrintColorAdjust: 'exact',
          printColorAdjust: 'exact',
        } as React.CSSProperties}
      >
        <div style={{ pageBreakAfter: 'always', breakAfter: 'page' }}>{overview}</div>
        <div style={{ pageBreakAfter: 'always', breakAfter: 'page' }}>{arch}</div>
        <div style={{ pageBreakAfter: 'always', breakAfter: 'page' }}>{algo}</div>
        <div style={{ pageBreakAfter: 'always', breakAfter: 'page' }}>{dataModel}</div>
        <div style={{ pageBreakAfter: 'always', breakAfter: 'page' }}>{projectsGuide}</div>
        <div>{itPage}</div>
      </div>
    )
    return createPortal(printContent, document.body)
  }

  return overview
}
