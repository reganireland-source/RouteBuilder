import { useState } from 'react'
import { useTheme } from '../theme'
import { generateUserGuidePDF } from '../utils/generateUserGuide'
import type { CableNode, CableSegment, CableSystem } from '../types'


const STEPS = [
  { title: 'Open PoP Routes', desc: 'Select the ↔ Pop Routes tab. TSABuddy appears at the top — use it for natural language, or configure the search manually below.' },
  { title: 'Select Origin & Destination', desc: 'Type a city or node name in the search boxes. The live combobox filters as you type — select the specific landing station or PoP you need. Use the ⇅ swap button between the two fields to flip origin and destination instantly.' },
  { title: 'Set Diversity', desc: 'Choose a diversity type if required. Wet isolates submarine segments only. Full means no shared segments end-to-end. Full-Node adds node isolation on top. Terrestrial variants isolate backhaul at the origin end, destination end, or both. Leave as None for a single best-path search.' },
  { title: 'Add Constraints (optional)', desc: 'Expand Advanced Constraints to force via or avoid on specific nodes, segments, cable systems or entire countries. Country constraints are a hard geopolitical filter — no landing node in an avoided country will appear on any result.' },
  { title: 'Search', desc: 'Press Find Routes. The animated button indicates the search is running. Results appear in seconds.' },
  { title: 'Review & Sort', desc: 'Route cards show the path, margin badge, on-net classification and capacity. Sort by RTD, Availability, Margin, Capacity or On-Net. Toggle "UP" to push outage-affected routes down. Use the − / + stepper to show 1–10 routes (default 5).' },
  { title: 'Flip, Pin & Export', desc: 'In a diversity pair, click ⇅ to swap Worker and Protect roles — the route data (path, stats, map colour) trades places completely. Pin up to 5 routes using 📍, then export a straight-line diagram PDF.' },
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
  const [page, setPage] = useState<1 | 2 | 3 | 4>(1)

  const nodeCount    = nodes.length
  const segmentCount = segments.length
  const systemCount  = systems.filter(s => s.id !== 'TERRESTRIAL').length

  const FEATURES = [
    { icon: '🗺', title: 'PoP Route Builder',
      desc: `Find optimal paths between any two nodes on our ${nodeCount}-node subsea network. Configure wet, full or terrestrial diversity, enforce via/avoid constraints on specific nodes, segments or cable systems, and see all viable paths ranked instantly.` },
    { icon: '🤖', title: 'TSABuddy — AI Route Assistant',
      desc: 'Type your request in plain English: "Singapore to Tokyo with full diversity, avoiding China, sort by latency." TSABuddy extracts origin, destination, diversity type, system/country/node constraints, and sort preference — then triggers the search automatically. Powered by Claude AI.' },
    { icon: '🏙', title: 'City Pairs',
      desc: 'Explore city-to-city connectivity across our subsea network. Type to search cities by name or country — the live combobox filters as you type. See all viable system itineraries and key metrics without needing to know individual node IDs.' },
    { icon: '🌍', title: 'Country Viewer',
      desc: `Select any country from the searchable list to instantly highlight every subsea cable system landing there and all backhaul routes connecting those stations. Each system is rendered in a distinct vivid colour; backhaul appears in teal. The map auto-centres on the country. Use the Subsea Only and Backhaul Only toggles to reduce clutter.` },
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
    { icon: '🌊', title: 'Cable System Viewer',
      desc: `Toggle any of the ${systemCount} cable systems on the live map to explore coverage, topology and branching unit structure — ideal for network briefings and customer conversations.` },
    { icon: '🔍', title: 'Node Search',
      desc: `Enter a customer address or lat/lng coordinates to find the nearest landing stations and PoPs. Results show owner logo, trading name, node type and straight-line distance — with one-click Set Origin / Set Dest to jump straight into a route search.` },
    { icon: '📌', title: 'Pinned Routes & SLD Export',
      desc: 'Pin up to 5 routes for comparison, then export a professional branded straight-line diagram PDF — a cover page plus per-route diagrams with proportional segment layout — ready for customer delivery.' },
    { icon: '🗄', title: 'Ref Data Management',
      desc: 'Full CRUD for all network data: nodes, segments, systems, capacity, outages and interconnect rules. Margin scores, ownership classifications and node positions are all editable within the app.' },
    { icon: '🚨', title: 'Live Outage Awareness',
      desc: 'Active segment outages appear on route cards with repair date estimates. Push outage-affected routes to the bottom with one click — keeping viable options front and centre during a network incident.' },
    { icon: '📱', title: 'Mobile-First Design',
      desc: 'Full feature parity on phones and tablets. Demo routes, answer customer questions and build proposals from anywhere — in a meeting room, at a customer site, or in the field.' },
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
      ] as [1|2|3|4, string][]).map(([p, label]) => (
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
  if (page === 2) {
    const tier = (
      bg: string, border: string, icon: string,
      title: string, sub: string, badges: string[],
      detail: string,
    ) => (
      <div style={{
        background: bg, border: `1px solid ${border}`,
        borderRadius: 12, padding: '20px 22px',
      }}>
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
            <span key={b} style={{
              fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 20,
              background: 'rgba(255,255,255,0.08)', color: 'rgba(210,230,255,0.9)',
              border: '1px solid rgba(255,255,255,0.12)', letterSpacing: '0.04em',
            }}>{b}</span>
          ))}
        </div>
      </div>
    )

    const flow = (num: string, color: string, title: string, steps: string[]) => (
      <div style={{ ...card() as React.CSSProperties, borderLeft: `4px solid ${color}`, paddingLeft: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <div style={{
            width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
            background: color + '22', border: `2px solid ${color}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 12, fontWeight: 800, color,
          }}>{num}</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: t.text }}>{title}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {steps.map((s, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                <div style={{
                  width: 20, height: 20, borderRadius: '50%',
                  background: i === 0 ? color : t.bgDeep,
                  border: `1px solid ${i === 0 ? color : t.border}`,
                  fontSize: 9, fontWeight: 700,
                  color: i === 0 ? '#fff' : t.textFaint,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>{i + 1}</div>
                {i < steps.length - 1 && (
                  <div style={{ width: 1, height: 14, background: t.border, margin: '2px 0' }} />
                )}
              </div>
              <div style={{
                fontSize: 11, color: t.textMuted, lineHeight: 1.5,
                paddingBottom: i < steps.length - 1 ? 4 : 0,
              }}>{s}</div>
            </div>
          ))}
        </div>
      </div>
    )

    return (
      <div style={{
        maxWidth: 860, margin: '0 auto', padding: '0 16px 60px',
        fontFamily: 'system-ui, sans-serif', color: t.text,
      }}>
        {pageTabs}

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
  }

  // ── Page 3: Search Algorithm ──────────────────────────────────────────────
  if (page === 3) {
    const pipeBox = (
      num: string, color: string, icon: string,
      title: string, desc: string, countLabel: string,
    ) => (
      <div style={{
        flex: 1, minWidth: 0,
        background: color + '14', border: `2px solid ${color}`,
        borderRadius: 12, padding: '16px 12px',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        textAlign: 'center', gap: 6,
      }}>
        <div style={{
          width: 26, height: 26, borderRadius: '50%', background: color, color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 11, fontWeight: 800, flexShrink: 0,
        }}>{num}</div>
        <div style={{ fontSize: 20 }}>{icon}</div>
        <div style={{ fontSize: 12, fontWeight: 800, color: t.text }}>{title}</div>
        <div style={{ fontSize: 10, color: t.textMuted, lineHeight: 1.5, flex: 1 }}>{desc}</div>
        <div style={{ fontSize: 16, fontWeight: 800, color, marginTop: 4 }}>{countLabel}</div>
      </div>
    )

    const arrow = (
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', color: t.textFaint, fontSize: 20 }}>›</div>
    )

    const constraintRow = (
      icon: string, name: string, badge: string, badgeColor: string, desc: string,
    ) => (
      <div style={{
        ...card() as React.CSSProperties,
        display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 14px',
      }}>
        <span style={{ fontSize: 18, flexShrink: 0, lineHeight: 1.4 }}>{icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: t.text }}>{name}</span>
            <span style={{
              fontSize: 9, fontWeight: 800, padding: '2px 6px', borderRadius: 4,
              background: badgeColor + '22', color: badgeColor,
              border: `1px solid ${badgeColor}55`, letterSpacing: '0.06em',
            }}>{badge}</span>
          </div>
          <div style={{ fontSize: 11, color: t.textMuted, lineHeight: 1.5 }}>{desc}</div>
        </div>
      </div>
    )

    const dimChip = (icon: string, label: string, sub: string) => (
      <div style={{
        background: t.bgCard, border: `1px solid ${t.border}`,
        borderRadius: 8, padding: '10px 12px',
        display: 'flex', alignItems: 'flex-start', gap: 8,
      }}>
        <span style={{ fontSize: 15, flexShrink: 0, marginTop: 1 }}>{icon}</span>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: t.text }}>{label}</div>
          <div style={{ fontSize: 10, color: t.textMuted, lineHeight: 1.4 }}>{sub}</div>
        </div>
      </div>
    )

    const sortChip = (icon: string, key: string, dir: string, desc: string) => (
      <div style={{
        background: t.bgCard, border: `1px solid ${t.border}`,
        borderRadius: 8, padding: '10px 12px', textAlign: 'center',
      }}>
        <div style={{ fontSize: 16, marginBottom: 4 }}>{icon}</div>
        <div style={{ fontSize: 11, fontWeight: 800, color: t.text, marginBottom: 2 }}>{key}</div>
        <div style={{ fontSize: 9, color: t.blue, fontWeight: 700, marginBottom: 5 }}>{dir}</div>
        <div style={{ fontSize: 10, color: t.textMuted, lineHeight: 1.4 }}>{desc}</div>
      </div>
    )

    return (
      <div style={{
        maxWidth: 860, margin: '0 auto', padding: '0 16px 60px',
        fontFamily: 'system-ui, sans-serif', color: t.text,
      }}>
        {pageTabs}

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
            {pipeBox('1', '#3b82f6', '🔍', 'Graph Search', 'NetworkX walks the cable network finding all valid shortest paths', 'up to 500')}
            {arrow}
            {pipeBox('2', '#f59e0b', '⚖️', 'Apply Constraints', 'Hard rules remove every path that breaks any active constraint', 'varies')}
            {arrow}
            {pipeBox('3', '#8b5cf6', '🎯', 'Select Pool', 'Best 30 chosen across 6 dimensions — or all 30 by one Optimise For metric', '30 kept')}
            {arrow}
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
            {constraintRow('📍', 'Must Include Nodes', 'VIA', t.green, 'Route must pass through every selected node. Use for mandatory transit PoPs or landing stations.')}
            {constraintRow('🚫', 'Must Avoid Nodes', 'SKIP', t.red, 'Route may not transit any selected node. Use to exclude restricted or unavailable facilities.')}
            {constraintRow('🔗', 'Must Include Segments', 'VIA', t.green, 'Route must traverse every selected cable segment — e.g. to lock in a preferred submarine section.')}
            {constraintRow('✂️', 'Must Avoid Segments', 'SKIP', t.red, 'Route may not use any selected segment — e.g. segments under maintenance or at outage risk.')}
            {constraintRow('📡', 'Must Include Systems', 'VIA', t.green, 'Route must carry at least one segment from every selected cable system.')}
            {constraintRow('🛑', 'Must Avoid Systems', 'SKIP', t.red, 'Route may not use any segment from the selected systems — full system exclusion.')}
            {constraintRow('🌍', 'Must Include Countries', 'VIA', t.green, 'Route must transit at least one non-BU landing node in each selected country. Use for geographic landing requirements — e.g. "must land in Japan".')}
            {constraintRow('🌐', 'Must Avoid Countries', 'SKIP', t.red, 'Route may not pass through any landing node in selected countries. A hard geopolitical, licensing or security exclusion. If an endpoint is in an avoided country, the search returns no results.')}
            {constraintRow('🌊', 'Max Wet Hops', 'LIMIT', t.orange, 'Maximum submarine cable segments. Each subsea segment = 1 wet hop. Blank = no limit.')}
            {constraintRow('⛰️', 'Max Terrestrial Hops', 'LIMIT', t.orange, 'Maximum land cable segments. Each terrestrial segment = 1 land hop. Blank = no limit.')}
          </div>
        </div>

        {/* Pool selection + Optimise For */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
          <div style={{ ...card() as React.CSSProperties, padding: '22px 20px' }}>
            <div style={sectionLabel as React.CSSProperties}>Default Weighting — Step 3 (Auto)</div>
            <p style={{ fontSize: 11, color: t.textMuted, lineHeight: 1.65, margin: '0 0 16px' }}>
              When no Optimise For is set, the pool is built by taking the top 3–4 routes from each of 6 dimensions, deduplicating, and filling remaining slots with the lowest-cost routes. This ensures the pool always contains strong candidates across every metric.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {dimChip('○', 'Hops', 'fewest segments')}
              {dimChip('↔', 'Distance', 'shortest km')}
              {dimChip('⚡', 'Latency', 'lowest delay')}
              {dimChip('$', 'Margin', 'best cost weight')}
              {dimChip('◉', 'Ownership', 'most on-net')}
              {dimChip('◈', 'Capacity', 'highest bottleneck')}
            </div>
          </div>

          <div style={{ ...card() as React.CSSProperties, padding: '22px 20px' }}>
            <div style={sectionLabel as React.CSSProperties}>Optimise For — Step 3 (Override)</div>
            <p style={{ fontSize: 11, color: t.textMuted, lineHeight: 1.65, margin: '0 0 14px' }}>
              Setting an Optimise For dimension replaces the multi-dimension pool entirely. All 30 slots are filled with the best routes for that single metric. Use when you have a clear commercial priority.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[
                ['○', 'Hops',      'Fill 30 with fewest-hop routes',       '↓ fewer is better'],
                ['↔', 'Distance',  'Fill 30 with shortest routes',          '↓ fewer km is better'],
                ['⚡', 'Latency',  'Fill 30 with lowest latency',           '↓ fewer ms is better'],
                ['$', 'Margin',    'Fill 30 with best commercial margin',   '↑ higher is better'],
                ['◈', 'Capacity',  'Fill 30 with highest bottleneck Tbps',  '↑ more is better'],
                ['◉', 'Ownership', 'Fill 30 with most on-net routes',       '↑ more on-net is better'],
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
            Sort buttons reorder the top 5 shown from your 30-route pool. Clicking an active button toggles it off, returning to pool order.
            Sorting never removes routes — it only changes <em>which</em> 5 are displayed. You can combine Optimise For (pool composition) with a different sort (display order).
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
            { num: '500',  label: 'routes found',         color: '#3b82f6' },
            { num: '·',    label: '',                     color: t.textFaint },
            { num: '30',   label: 'filtered by pool',     color: '#8b5cf6' },
            { num: '·',    label: '',                     color: t.textFaint },
            { num: '1–10', label: 'shown · sorted by',   color: '#10b981' },
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
  }

  // ── Page 4: Data Model ────────────────────────────────────────────────────
  if (page === 4) {
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
            <div key={field} style={{
              display: 'grid', gridTemplateColumns: '110px 80px 1fr',
              gap: 8, padding: '6px 0',
              borderTop: i > 0 ? `1px solid ${t.border}` : 'none',
              alignItems: 'baseline',
            }}>
              <code style={{ fontSize: 10, fontWeight: 700, color, fontFamily: 'monospace' }}>{field}</code>
              <span style={{ fontSize: 9, color: t.textFaint, fontFamily: 'monospace' }}>{type}</span>
              <span style={{ fontSize: 10, color: t.textMuted, lineHeight: 1.5 }}>{desc}</span>
            </div>
          ))}
        </div>
      </div>
    )

    const todayTomorrowRow = (
      field: string, color: string,
      today: string, tomorrow: string,
    ) => (
      <div style={{
        display: 'grid', gridTemplateColumns: '140px 1fr 1fr',
        gap: 12, padding: '10px 12px',
        borderRadius: 6, background: t.bgCard, border: `1px solid ${t.border}`,
        alignItems: 'start',
      }}>
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

    return (
      <div style={{
        maxWidth: 860, margin: '0 auto', padding: '0 16px 60px',
        fontFamily: 'system-ui, sans-serif', color: t.text,
      }}>
        {pageTabs}

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
              { field: 'id',        type: 'string',    desc: 'Unique identifier (e.g. SIN3, HKG1). Used in route paths and all node-level constraints.' },
              { field: 'name',      type: 'string',    desc: 'Human-readable name of the landing station or PoP.' },
              { field: 'country',   type: 'ISO-2',     desc: 'Country code — used for country-level hard constraints (must_avoid / must_include).' },
              { field: 'type',      type: 'enum',      desc: 'landing_station | terrestrial_pop | branching_unit. BUs are graph-traversed but never shown as endpoints.' },
              { field: 'lat / lng', type: 'float',     desc: 'Coordinates for map rendering and nearest-node distance lookups.' },
            ])}
            {entityCard('🔗', 'Segment', '#8b5cf6', [
              { field: 'id',          type: 'string',  desc: 'Unique segment ID (e.g. EAC-2B2). Used in must_include / must_avoid segment constraints.' },
              { field: 'system_id',   type: 'string',  desc: 'Parent cable system. Links to system-level constraints and commercial margin scoring.' },
              { field: 'type',        type: 'enum',    desc: 'wet | terrestrial. Wet hops and terrestrial hops are counted separately for diversity and hop limits.' },
              { field: 'length_km',   type: 'float',   desc: 'Physical distance used as primary graph edge weight and to compute total route km.' },
              { field: 'latency',     type: 'float ms',desc: 'One-way propagation delay. Summed across all route segments to compute end-to-end RTD.' },
              { field: 'reliability', type: 'float',   desc: 'Segment availability (0–1). Multiplied across the path for end-to-end availability score.' },
              { field: 'ownership',   type: 'enum',    desc: 'owned | iru | consortium | integrated_lit_lease | offnet_resell. Drives commercial margin scoring.' },
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
                fields: 'node_id · disallowed_pairs · allowed_pairs',
                role: 'Defines which cable systems may or may not connect at a given node — a hard structural constraint applied during graph validation.' },
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
              'Inventory systems feed — total and available capacity per segment updated automatically as circuits are provisioned and released.')}
            {todayTomorrowRow('Segment Outages', t.red,
              'Manually entered in Ref Data by network ops team when a fault is raised or repaired.',
              'TSM (Trouble & Service Management) — fault records pushed to RouteBuilder automatically on creation and status change.')}
            {todayTomorrowRow('Latency / RTD', t.blue,
              'Fixed values derived from segment length using speed-of-light propagation estimates.',
              'NMS (Network Management System) — measured round-trip delay per segment in real time, reflecting actual fibre path and amplifier latency.')}
            {todayTomorrowRow('Node & Segment IDs', '#8b5cf6',
              'Maintained in PostgreSQL by engineering team — updated when new systems land or topology changes.',
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
  }

  // ── Page 1: Product Overview ───────────────────────────────────────────────
  return (
    <div style={{
      maxWidth: 860, margin: '0 auto', padding: '0 16px 60px',
      fontFamily: 'system-ui, sans-serif', color: t.text,
    }}>
      {pageTabs}

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
            onClick={() => generateUserGuidePDF(nodeCount, segmentCount, systemCount)}
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
              desc: 'The six vertical tabs on the left panel: Pop Routes, City Pairs, Subsea Systems, Country Viewer, Node Search, and Guide. Each tab clears unrelated highlights so the map stays uncluttered.',
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
          onClick={() => generateUserGuidePDF(nodeCount, segmentCount, systemCount)}
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
