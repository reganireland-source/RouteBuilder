import jsPDF from 'jspdf'

const PAGE_W = 210
const PAGE_H = 297
const M      = 18          // margin
const COL    = PAGE_W - M * 2  // usable width

// ── Colour palette ────────────────────────────────────────────────────────────
const NAVY:   [number,number,number] = [15,  30,  60]
const BLUE:   [number,number,number] = [37,  99, 235]
const LTBLUE: [number,number,number] = [219,234,254]
const WHITE:  [number,number,number] = [255,255,255]
const GREY1:  [number,number,number] = [30,  30,  45]
const GREY3:  [number,number,number] = [100,100,120]
const GREY5:  [number,number,number] = [180,185,200]
const GREEN:  [number,number,number] = [34, 197, 94]
const ORANGE: [number,number,number] = [249,115, 22]

function footer(doc: jsPDF, page: number, total: number) {
  doc.setFontSize(6)
  doc.setTextColor(...GREY5)
  doc.text('TELSTRA INTERNATIONAL CONFIDENTIAL — RouteBuilder Platform Guide', M, PAGE_H - 7)
  doc.text(`${page} / ${total}`, PAGE_W - M, PAGE_H - 7, { align: 'right' })
  doc.setDrawColor(...GREY5)
  doc.setLineWidth(0.15)
  doc.line(M, PAGE_H - 10, PAGE_W - M, PAGE_H - 10)
}

function pageHeader(doc: jsPDF, title: string) {
  doc.setFillColor(...NAVY)
  doc.rect(0, 0, PAGE_W, 14, 'F')
  doc.setFontSize(7)
  doc.setTextColor(...GREY5)
  doc.text('TELSTRA INTERNATIONAL · ROUTEBUILDER', M, 9)
  doc.setTextColor(...WHITE)
  doc.setFontSize(7)
  doc.text(title.toUpperCase(), PAGE_W - M, 9, { align: 'right' })
}

function sectionTitle(doc: jsPDF, text: string, y: number): number {
  doc.setFillColor(...LTBLUE)
  doc.rect(M, y, COL, 7, 'F')
  doc.setFontSize(9)
  doc.setTextColor(...BLUE)
  doc.text(text.toUpperCase(), M + 3, y + 5)
  return y + 11
}

function bodyText(doc: jsPDF, text: string, y: number, maxW = COL, size = 9): number {
  doc.setFontSize(size)
  doc.setTextColor(...GREY1)
  const lines = doc.splitTextToSize(text, maxW) as string[]
  doc.text(lines, M, y)
  return y + lines.length * (size * 0.4) + 2
}

function featureRow(doc: jsPDF, icon: string, title: string, desc: string, y: number): number {
  doc.setFontSize(12)
  doc.setTextColor(...BLUE)
  doc.text(icon, M, y + 1)
  doc.setFontSize(9)
  doc.setTextColor(...GREY1)
  doc.setFont('helvetica', 'bold')
  doc.text(title, M + 9, y)
  doc.setFont('helvetica', 'normal')
  const lines = doc.splitTextToSize(desc, COL - 10) as string[]
  doc.setFontSize(8.5)
  doc.setTextColor(...GREY3)
  doc.text(lines, M + 9, y + 4.5)
  const h = Math.max(12, lines.length * 3.8 + 6)
  doc.setDrawColor(...GREY5)
  doc.setLineWidth(0.1)
  doc.line(M + 9, y + h - 1, PAGE_W - M, y + h - 1)
  return y + h + 2
}

function step(doc: jsPDF, num: number, title: string, desc: string, y: number): number {
  // circle number
  doc.setFillColor(...BLUE)
  doc.circle(M + 4, y + 1.5, 4, 'F')
  doc.setFontSize(8)
  doc.setTextColor(...WHITE)
  doc.text(String(num), M + 4, y + 4, { align: 'center' })

  doc.setFontSize(9)
  doc.setTextColor(...GREY1)
  doc.setFont('helvetica', 'bold')
  doc.text(title, M + 12, y + 3)
  doc.setFont('helvetica', 'normal')
  const lines = doc.splitTextToSize(desc, COL - 14) as string[]
  doc.setFontSize(8.5)
  doc.setTextColor(...GREY3)
  doc.text(lines, M + 12, y + 8)
  const h = Math.max(14, lines.length * 3.8 + 10)
  return y + h + 3
}

function badge(doc: jsPDF, label: string, color: [number,number,number], x: number, y: number): number {
  const w = label.length * 2.2 + 6
  doc.setFillColor(color[0], color[1], color[2], 0.15)
  doc.setFillColor(color[0] * 0.9, color[1] * 0.9, color[2] * 0.9)
  doc.roundedRect(x, y - 3.5, w, 5.5, 1.2, 1.2, 'F')
  doc.setFontSize(7)
  doc.setTextColor(...WHITE)
  doc.text(label, x + w / 2, y + 0.5, { align: 'center' })
  return x + w + 3
}

// ── Pages ─────────────────────────────────────────────────────────────────────

function drawCover(doc: jsPDF) {
  // Full dark header
  doc.setFillColor(...NAVY)
  doc.rect(0, 0, PAGE_W, 100, 'F')

  // Blue accent bar
  doc.setFillColor(...BLUE)
  doc.rect(0, 98, PAGE_W, 3, 'F')

  // Logo area
  doc.setFontSize(28)
  doc.setTextColor(...WHITE)
  doc.setFont('helvetica', 'bold')
  doc.text('Route', M, 52)
  doc.setTextColor(100, 160, 255)
  doc.text('Builder', M + 48, 52)

  doc.setFontSize(11)
  doc.setTextColor(...GREY5)
  doc.setFont('helvetica', 'normal')
  doc.text('Platform Overview & User Guide', M, 63)

  doc.setFontSize(8)
  doc.setTextColor(80, 100, 140)
  doc.text('Telstra International · Subsea Network Intelligence', M, 73)

  // One-liner
  doc.setFontSize(13)
  doc.setTextColor(180, 210, 255)
  doc.setFont('helvetica', 'bold')
  const pitch = 'The fastest way to design, price and sell a subsea route.'
  const pitchLines = doc.splitTextToSize(pitch, COL) as string[]
  doc.text(pitchLines, M, 87)
  doc.setFont('helvetica', 'normal')

  // Date
  doc.setFontSize(8)
  doc.setTextColor(...GREY5)
  doc.text(
    new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' }),
    PAGE_W - M, 73, { align: 'right' }
  )

  // Intro body
  let y = 115
  doc.setFontSize(10)
  doc.setTextColor(...GREY1)
  doc.setFont('helvetica', 'bold')
  doc.text('What is RouteBuilder?', M, y)
  doc.setFont('helvetica', 'normal')
  y += 7

  const intro = `RouteBuilder is Telstra International's intelligent route design platform — purpose-built to replace ` +
    `spreadsheets and tribal knowledge with a fast, visual, commercially-aware tool that any sales or network engineer can use.\n\n` +
    `Before RouteBuilder, designing a subsea route meant consulting experienced staff, cross-referencing network diagrams, ` +
    `and manually calculating diversity options and commercial margins. It was slow, inconsistent, and unscalable. ` +
    `RouteBuilder changes that entirely.\n\n` +
    `With RouteBuilder, any team member can identify optimal routes in seconds, assess commercial margin at a glance, ` +
    `validate diversity requirements, check capacity, and export a customer-ready straight-line diagram — all from a single interface.`

  y = bodyText(doc, intro, y, COL, 9.5)

  // Who it's for
  y += 6
  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...GREY1)
  doc.text('Who It\'s For', M, y)
  doc.setFont('helvetica', 'normal')
  y += 7

  const users = [
    ['Subsea Sales Specialists', 'Design routes, assess commercial margin and prepare customer-ready outputs — fast.'],
    ['Network Engineers',        'Validate path options, diversity requirements and capacity constraints with precision.'],
    ['Sales Engineers',          'Combine commercial and technical insight to build compelling, differentiated proposals.'],
    ['Future: Enterprise Customers', 'A self-serve portal for sophisticated buyers to explore Telstra\'s network themselves.'],
  ]

  for (const [role, desc] of users) {
    doc.setFillColor(248, 249, 255)
    doc.rect(M, y - 3, COL, 12, 'F')
    doc.setFontSize(8.5)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...BLUE)
    doc.text(role, M + 3, y + 2)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(...GREY3)
    doc.setFontSize(8)
    doc.text(desc, M + 3, y + 6.5)
    y += 15
  }

  footer(doc, 1, 5)
}

function drawFeatures(doc: jsPDF) {
  pageHeader(doc, 'Key Features')

  let y = 24
  y = sectionTitle(doc, 'Core Capabilities', y)

  const features: [string, string, string][] = [
    ['🗺', 'PoP Route Builder',
      'Find optimal paths between any two nodes on Telstra\'s 86-node subsea network. Configure diversity requirements (wet, full, terrestrial or full-node diversity), enforce via or avoid constraints on specific nodes, segments or cable systems, and see all viable paths ranked instantly.'],
    ['🤖', 'TSABuddy — AI Route Assistant',
      'Type your request in plain English: "Singapore to Hong Kong on EAC with wet diversity, sort by latency." TSABuddy interprets the request, configures all route parameters, triggers the search, and applies the right sort order — automatically. Powered by Claude AI.'],
    ['🌏', 'City Pairs',
      'Explore city-to-city connectivity across Telstra\'s subsea network. See all viable system itineraries, intermediate cable landing stations, and key metrics including latency, distance and reliability — without needing to know individual node IDs.'],
    ['💰', 'Margin Scoring',
      'Every route is automatically scored for commercial margin (1–10) based on the cable systems used and their ownership classification, weighted proportionally by segment distance. Backhaul is excluded. Sort routes by margin to surface the most commercially attractive options first — green (≥7.5), amber (4.5–7.5) or red (<4.5).'],
    ['📡', 'Capacity Dashboard',
      'A full-network capacity view across all 148 segments, showing total and available capacity in terabits, with utilisation colour-coding. Segmented between wet and backhaul segments. Instantly spot where capacity is constrained and factor it into route decisions.'],
    ['🔀', 'On-Net / Off-Net Classification',
      'Routes are automatically classified as On-Net, Off-Net or Mixed based on Telstra\'s network ownership profile. The mix percentage is shown for blended routes. This shapes the commercial narrative — on-net routes carry better margin and SLA quality.'],
    ['🛰', 'Cable System Viewer',
      'Toggle any of Telstra\'s 28 cable systems on the live map to explore coverage, topology and branching unit structure. Ideal for understanding the network before building a route or briefing a customer.'],
    ['🔍', 'Node Search',
      'Look up any of the 86 nodes in the network — cable landing stations, terrestrial PoPs or subsea branching units. View its connections, cable systems and geographic position, then jump directly into a route search from any node.'],
    ['📌', 'Pinned Routes & Straight-Line Diagram Export',
      'Pin up to 5 routes for side-by-side comparison. Export a professional, branded straight-line diagram PDF — cover page plus per-route pages with proportional segment layout, node labels and network metadata — ready for customer presentations.'],
    ['🗄', 'Ref Data Management',
      'Full CRUD for all network data: nodes, segments, systems, capacity, outages and interconnect rules. The entire network topology is editable from within the app, including capacity, margin scores, ownership classification and node positions.'],
  ]

  for (const [icon, title, desc] of features) {
    if (y > PAGE_H - 30) { break }
    y = featureRow(doc, icon, title, desc, y)
  }

  footer(doc, 2, 5)
}

function drawMoreFeatures(doc: jsPDF) {
  pageHeader(doc, 'Key Features (continued)')

  let y = 24

  const features: [string, string, string][] = [
    ['🚨', 'Live Outage Awareness',
      'Active segment outages are displayed on route cards with repair date estimates. Push outage-affected routes to the bottom of the list with one click — keeping viable options front and centre during a network incident.'],
    ['📱', 'Mobile-First Design',
      'RouteBuilder works on phones and tablets. The mobile interface mirrors the full desktop feature set with a bottom-drawer navigation, collapsible panels and touch-optimised controls — so the team can demo routes and answer customer questions in any setting.'],
    ['🩺', 'System Health Monitor',
      'A persistent status bar shows the health of the backend API, live data, NLP service and LLM API connection — so users always know whether the platform is operating at full capability.'],
  ]

  y = sectionTitle(doc, 'Additional Capabilities', y)
  for (const [icon, title, desc] of features) {
    y = featureRow(doc, icon, title, desc, y)
  }

  y += 6
  y = sectionTitle(doc, 'Network Coverage', y)

  const stats: [string, string, string][] = [
    ['86',  'Nodes', 'Cable landing stations, terrestrial PoPs and subsea branching units across APAC, the Middle East, Europe and North America'],
    ['148', 'Segments', 'Wet and backhaul segments across 28 cable systems, with capacity, reliability and margin data for each'],
    ['28',  'Cable Systems', 'Including owned systems (AJC, Indigo, TGA), consortium (EAC, C2C, AAG, APG, SMW3/4) and partner capacity'],
  ]

  for (const [num, label, desc] of stats) {
    doc.setFontSize(22)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...BLUE)
    doc.text(num, M, y + 8)
    const numW = doc.getTextWidth(num)
    doc.setFontSize(9)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...GREY1)
    doc.text(label, M + numW + 3, y + 3)
    doc.setFont('helvetica', 'normal')
    const lines = doc.splitTextToSize(desc, COL - numW - 6) as string[]
    doc.setFontSize(8.5)
    doc.setTextColor(...GREY3)
    doc.text(lines, M + numW + 3, y + 8)
    y += Math.max(16, lines.length * 4 + 10)
  }

  y += 4
  y = sectionTitle(doc, 'Route Metrics Explained', y)

  const metrics: [string, string][] = [
    ['Hops',         'Number of segments in the route. Fewer hops generally means simpler operational management.'],
    ['RTD',          'Round-trip delay in milliseconds — a direct function of route distance and the speed of light in fibre (≈200,000 km/s).'],
    ['Availability', 'End-to-end reliability calculated as the product of individual segment reliability scores. Expressed as a percentage to 3 decimal places.'],
    ['Margin',       'Weighted average commercial margin score (1–10) across all wet segments, proportional to segment distance. Higher is better.'],
    ['Capacity',     'Estimated available capacity (in Tbps) at the bottleneck segment — the constraining link for the route.'],
  ]

  for (const [metric, desc] of metrics) {
    doc.setFontSize(8.5)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...BLUE)
    doc.text(metric + ':', M, y)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(...GREY3)
    const lines = doc.splitTextToSize(desc, COL - 30) as string[]
    doc.text(lines, M + 28, y)
    y += lines.length * 4 + 3
  }

  footer(doc, 3, 5)
}

function drawUserGuide(doc: jsPDF) {
  pageHeader(doc, 'User Guide')

  let y = 24

  y = sectionTitle(doc, 'Building Your First Route', y)

  const routeSteps: [string, string][] = [
    ['Open PoP Routes',          'Select the PoP Routes tab. TSABuddy appears at the top — you can use it or configure the search manually below.'],
    ['Select Origin & Destination', 'Type a city or node name in the Origin and Destination search boxes. The live-search combobox filters as you type. Select the specific landing station or PoP you need.'],
    ['Set Diversity (optional)',  'Choose a diversity type if required: Wet (segment-disjoint on wet segments), Full (full path diversity), or Terrestrial variants. Leave as None for a single best-path search.'],
    ['Apply Advanced Constraints (optional)', 'Expand Advanced Constraints to force the route via or to avoid specific nodes, segments or entire cable systems. Multi-select dropdowns with live search make this fast.'],
    ['Search',                   'Press Find Routes. The animated button indicates the search is running. Results appear in seconds, sorted by hops by default.'],
    ['Review Results',           'Each route card shows the path (hiding branching unit nodes for readability), key metrics, margin badge, on-net classification and capacity estimate. Click a card to highlight the route on the map.'],
    ['Sort & Filter',            'Use the sort bar to reorder by RTD, Availability, Margin ($), Capacity or On-Net ownership. Toggle "UP" to push routes with active outages to the bottom.'],
    ['Pin & Export',             'Pin up to 5 routes using the 📍 button. Once pinned, export a straight-line diagram PDF from the map controls. The PDF includes a cover page and per-route diagrams, ready for customer delivery.'],
  ]

  for (const [title, desc] of routeSteps) {
    if (y > PAGE_H - 28) break
    y = step(doc, routeSteps.indexOf([title, desc]) + 1, title, desc, y)
  }

  y = sectionTitle(doc, 'Using TSABuddy', y)

  doc.setFontSize(9)
  doc.setTextColor(...GREY3)
  doc.setFont('helvetica', 'italic')
  const tsaIntro = `TSABuddy understands natural language route requests and configures the full search automatically. ` +
    `High or medium confidence results trigger an automatic search. Low confidence shows a "Search anyway" option.`
  const tsaLines = doc.splitTextToSize(tsaIntro, COL) as string[]
  doc.text(tsaLines, M, y)
  doc.setFont('helvetica', 'normal')
  y += tsaLines.length * 4 + 5

  const examples = [
    'Singapore to Hong Kong with wet diversity',
    'Perth to Singapore via SIN3, sort by latency',
    'Sydney to Tokyo avoiding AAG',
    'SIN3 to TKO1 on EAC, full diversity',
  ]
  for (const ex of examples) {
    doc.setFontSize(8.5)
    doc.setTextColor(...BLUE)
    doc.text(`"${ex}"`, M + 4, y)
    y += 5.5
  }

  footer(doc, 4, 5)
}

function drawVision(doc: jsPDF) {
  pageHeader(doc, 'Vision & Roadmap')

  let y = 24

  // Vision statement
  doc.setFillColor(...NAVY)
  doc.rect(0, 24, PAGE_W, 44, 'F')
  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...WHITE)
  const visionLines = doc.splitTextToSize(
    'RouteBuilder is the foundation for a fully integrated commercial network intelligence platform.',
    COL
  ) as string[]
  doc.text(visionLines, M, 40)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(160, 190, 255)
  const visionSub = 'Where real-time network data, AI-driven recommendations and commercial pricing converge into a single, customer-ready interface.'
  const visionSubLines = doc.splitTextToSize(visionSub, COL) as string[]
  doc.text(visionSubLines, M, 54)
  y = 78

  y = sectionTitle(doc, 'Roadmap', y)

  const roadmap: [string, string, [number,number,number], string][] = [
    ['Real-Time Network Data',       'Connect RouteBuilder to live NMS feeds for real-time capacity, latency measurements and outage data — removing the lag between network events and commercial decision-making.', GREEN,  'In Planning'],
    ['Quoting & Pricing Integration','Bridge commercial margin scores to actual pricing outputs, enabling sales engineers to generate indicative quotes directly from a route design — cutting the time from enquiry to proposal.', ORANGE, 'In Planning'],
    ['AI-Driven Recommendations',   'TSABuddy evolves beyond route parsing into a full commercial advisor: surfacing market intelligence, flagging competitive alternatives and proactively suggesting route optimisations based on capacity trends.', BLUE,   'Future'],
    ['Customer-Facing Portal',       'A white-label or Telstra-branded self-serve experience for enterprise customers — letting sophisticated buyers explore the network, model routes and initiate enquiries without needing to engage the sales team first.', BLUE,   'Future'],
  ]

  for (const [title, desc, color, tag] of roadmap) {
    doc.setFillColor(248, 249, 255)
    const descLines = doc.splitTextToSize(desc, COL - 12) as string[]
    const cardH = descLines.length * 3.8 + 16
    doc.rect(M, y, COL, cardH, 'F')
    doc.setFillColor(...color)
    doc.rect(M, y, 3, cardH, 'F')

    doc.setFontSize(9)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...GREY1)
    doc.text(title, M + 7, y + 7)

    // Tag
    badge(doc, tag, color, PAGE_W - M - (tag.length * 2.2 + 8), y + 3)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.setTextColor(...GREY3)
    doc.text(descLines, M + 7, y + 12.5)
    y += cardH + 4
  }

  y += 4
  doc.setFontSize(9)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...GREY1)
  doc.text('The Ambition', M, y)
  doc.setFont('helvetica', 'normal')
  y += 6

  const ambition = `RouteBuilder began as a tool to replace spreadsheets. Its ambition is to become the commercial ` +
    `intelligence layer for Telstra International's subsea network — a platform where every route decision is faster, ` +
    `every customer interaction is better informed, and every commercial opportunity is visible the moment it arises.\n\n` +
    `The network knowledge that today lives in the heads of experienced staff will become a scalable, accessible, ` +
    `AI-augmented capability available to every person in the business.`

  y = bodyText(doc, ambition, y, COL, 9.5)

  footer(doc, 5, 5)
}

// ── Entry point ───────────────────────────────────────────────────────────────

export function generateUserGuidePDF() {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })

  drawCover(doc)
  doc.addPage(); drawFeatures(doc)
  doc.addPage(); drawMoreFeatures(doc)
  doc.addPage(); drawUserGuide(doc)
  doc.addPage(); drawVision(doc)

  doc.save(`RouteBuilder-Guide-${new Date().toISOString().slice(0, 10)}.pdf`)
}
