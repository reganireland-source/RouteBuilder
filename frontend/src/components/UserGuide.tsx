import { useTheme } from '../theme'
import { generateUserGuidePDF } from '../utils/generateUserGuide'

const FEATURES = [
  {
    icon: '🗺',
    title: 'PoP Route Builder',
    desc: 'Find optimal paths between any two nodes on our 86-node subsea network. Configure wet, full or terrestrial diversity, enforce via/avoid constraints on specific nodes, segments or cable systems, and see all viable paths ranked instantly.',
  },
  {
    icon: '🤖',
    title: 'TSABuddy — AI Route Assistant',
    desc: 'Type your request in plain English: "Singapore to Hong Kong on EAC with wet diversity, sort by latency." TSABuddy interprets the request, fills all search parameters and triggers the search automatically. Powered by Claude AI.',
  },
  {
    icon: '🌏',
    title: 'City Pairs',
    desc: 'Explore city-to-city connectivity across our subsea network. See all viable system itineraries, intermediate cable landing stations, and key metrics — without needing to know individual node IDs.',
  },
  {
    icon: '💰',
    title: 'Margin Scoring',
    desc: 'Every route is automatically scored for commercial margin (1–10) based on cable system ownership, weighted by segment distance. Sort routes by margin to surface the most commercially attractive options first.',
  },
  {
    icon: '📡',
    title: 'Capacity Dashboard',
    desc: 'A full-network capacity view across all 148 segments, showing total and available capacity in terabits with utilisation colour-coding. Instantly identify where capacity is constrained.',
  },
  {
    icon: '🔀',
    title: 'On-Net / Off-Net Classification',
    desc: 'Routes are automatically classified as On-Net, Off-Net or Mixed based on network ownership. The on-net percentage is shown for blended routes, shaping the commercial narrative.',
  },
  {
    icon: '🛰',
    title: 'Cable System Viewer',
    desc: 'Toggle any of the 28 cable systems on the live map to explore coverage, topology and branching unit structure — ideal for network briefings and customer conversations.',
  },
  {
    icon: '🔍',
    title: 'Node Search',
    desc: 'Look up any of the 86 nodes in the network. View connections, cable systems and geographic position, then jump directly into a route search from any node.',
  },
  {
    icon: '📌',
    title: 'Pinned Routes & SLD Export',
    desc: 'Pin up to 5 routes for comparison, then export a professional branded straight-line diagram PDF — a cover page plus per-route diagrams with proportional segment layout — ready for customer delivery.',
  },
  {
    icon: '🗄',
    title: 'Ref Data Management',
    desc: 'Full CRUD for all network data: nodes, segments, systems, capacity, outages and interconnect rules. Margin scores, ownership classifications and node positions are all editable within the app.',
  },
  {
    icon: '🚨',
    title: 'Live Outage Awareness',
    desc: 'Active segment outages appear on route cards with repair date estimates. Push outage-affected routes to the bottom with one click — keeping viable options front and centre during a network incident.',
  },
  {
    icon: '📱',
    title: 'Mobile-First Design',
    desc: 'Full feature parity on phones and tablets. Demo routes, answer customer questions and build proposals from anywhere — in a meeting room, at a customer site, or in the field.',
  },
]

const STEPS = [
  { title: 'Open PoP Routes', desc: 'Select the PoP Routes tab. TSABuddy appears at the top — use it for natural language, or configure the search manually below.' },
  { title: 'Select Origin & Destination', desc: 'Type a city or node name in the search boxes. The live combobox filters as you type — select the specific landing station or PoP you need.' },
  { title: 'Set Diversity', desc: 'Choose Wet, Full, Terrestrial or Full-Node diversity if required. Leave as None for a single best-path search.' },
  { title: 'Add Constraints (optional)', desc: 'Expand Advanced Constraints to force via or avoid on specific nodes, segments or cable systems using multi-select dropdowns with live search.' },
  { title: 'Search', desc: 'Press Find Routes. The animated button indicates the search is running. Results appear in seconds.' },
  { title: 'Review & Sort', desc: 'Route cards show the path, margin badge, on-net classification and capacity. Sort by RTD, Availability, Margin ($), Capacity or On-Net. Toggle "UP" to push outage-affected routes down.' },
  { title: 'Pin & Export', desc: 'Pin up to 5 routes using 📍, then export a straight-line diagram PDF from the map controls for customer delivery.' },
]

const ROADMAP = [
  { icon: '📶', title: 'Real-Time Network Data',       desc: 'Live capacity, latency and outage feeds from NMS — removing the lag between network events and commercial decisions.', tag: 'In Planning', color: '#22c55e' },
  { icon: '💵', title: 'Quoting & Pricing Integration', desc: 'Bridge margin scores to actual pricing outputs, enabling indicative quotes directly from a route design.', tag: 'In Planning', color: '#f97316' },
  { icon: '🧠', title: 'AI-Driven Recommendations',    desc: 'TSABuddy evolves into a full commercial advisor — surfacing market intelligence and proactively optimising route recommendations.', tag: 'Future', color: '#3b82f6' },
  { icon: '🌐', title: 'Customer-Facing Portal',        desc: 'A self-serve experience for enterprise customers to explore the network, model routes and initiate enquiries independently.', tag: 'Future', color: '#3b82f6' },
]

export function UserGuide() {
  const t = useTheme()

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

  return (
    <div style={{
      maxWidth: 860, margin: '0 auto', padding: '0 16px 60px',
      fontFamily: 'system-ui, sans-serif', color: t.text,
    }}>

      {/* ── Hero ── */}
      <div style={{
        background: `linear-gradient(135deg, #0f1e3c 0%, #1a3a6e 60%, #1d4ed8 100%)`,
        borderRadius: 12, padding: '44px 40px 40px', marginBottom: 28,
        position: 'relative', overflow: 'hidden',
      }}>
        {/* decorative circles */}
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
            onClick={generateUserGuidePDF}
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
          ['86', 'Nodes', 'Landing stations, terrestrial PoPs & branching units'],
          ['148', 'Segments', 'Wet & backhaul across 28 cable systems'],
          ['28', 'Cable Systems', 'Owned, consortium, IRU & partner capacity'],
        ].map(([num, label, sub]) => (
          <div key={label} style={{ ...card(), textAlign: 'center', padding: '18px 12px' }}>
            <div style={{ fontSize: 32, fontWeight: 800, color: t.blue, lineHeight: 1 }}>{num}</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: t.text, marginTop: 4 }}>{label}</div>
            <div style={{ fontSize: 10, color: t.textFaint, marginTop: 3, lineHeight: 1.4 }}>{sub}</div>
          </div>
        ))}
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
              'Singapore to Hong Kong with wet diversity',
              'Sydney to Tokyo avoiding AAG, sort by latency',
              'Perth to Singapore via SIN3 on Indigo, full diversity',
              'SIN3 to TKO1 on EAC, sort by margin',
            ].map(ex => (
              <div key={ex} style={{
                fontSize: 11, color: '#93c5fd', fontStyle: 'italic',
                background: 'rgba(255,255,255,0.05)', borderRadius: 6,
                padding: '7px 12px', borderLeft: '3px solid #3b82f6',
              }}>
                "{ex}"
              </div>
            ))}
          </div>
          <div style={{ marginTop: 12, fontSize: 10, color: 'rgba(147,197,253,0.7)', lineHeight: 1.5 }}>
            High and medium confidence results trigger an automatic search. Low confidence shows a "Search anyway" option with full parameter preview.
          </div>
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
          onClick={generateUserGuidePDF}
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
}
