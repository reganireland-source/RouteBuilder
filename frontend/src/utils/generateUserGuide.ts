import jsPDF from 'jspdf'

const PAGE_W  = 210
const PAGE_H  = 297
const M       = 18
const COL     = PAGE_W - M * 2

// ── Palette ───────────────────────────────────────────────────────────────────
const NAVY:   [number,number,number] = [15,  30,  60]
const BLUE:   [number,number,number] = [37,  99, 235]
const LTBLUE: [number,number,number] = [219,234,254]
const WHITE:  [number,number,number] = [255,255,255]
const GREY1:  [number,number,number] = [30,  30,  45]
const GREY3:  [number,number,number] = [100,100,120]
const GREY5:  [number,number,number] = [180,185,200]
const GREEN:  [number,number,number] = [34, 197, 94]
const ORANGE: [number,number,number] = [249,115, 22]
const PURPLE: [number,number,number] = [139, 92,246]
const RED:    [number,number,number] = [239, 68, 68]

// ── Shared helpers ────────────────────────────────────────────────────────────

let _totalPages = 0

function footer(doc: jsPDF, page: number) {
  doc.setFontSize(6)
  doc.setTextColor(...GREY5)
  doc.text('INTERNATIONAL TELCO CONFIDENTIAL — RouteBuilder Platform Guide', M, PAGE_H - 7)
  doc.text(`${page} / ${_totalPages}`, PAGE_W - M, PAGE_H - 7, { align: 'right' })
  doc.setDrawColor(...GREY5)
  doc.setLineWidth(0.15)
  doc.line(M, PAGE_H - 10, PAGE_W - M, PAGE_H - 10)
}

function pageHeader(doc: jsPDF, title: string) {
  doc.setFillColor(...NAVY)
  doc.rect(0, 0, PAGE_W, 14, 'F')
  doc.setFontSize(7)
  doc.setTextColor(...GREY5)
  doc.text('INTERNATIONAL TELCO · ROUTEBUILDER', M, 9)
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
  doc.setFillColor(color[0] * 0.9, color[1] * 0.9, color[2] * 0.9)
  doc.roundedRect(x, y - 3.5, w, 5.5, 1.2, 1.2, 'F')
  doc.setFontSize(7)
  doc.setTextColor(...WHITE)
  doc.text(label, x + w / 2, y + 0.5, { align: 'center' })
  return x + w + 3
}

function constraintRow(
  doc: jsPDF,
  icon: string, name: string, badgeLabel: string,
  color: [number,number,number], desc: string,
  y: number, colW: number, xOff = 0
): number {
  const x = M + xOff
  doc.setFontSize(10)
  doc.setTextColor(...color)
  doc.text(icon, x, y + 2)
  doc.setFontSize(8.5)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...GREY1)
  doc.text(name, x + 7, y)
  badge(doc, badgeLabel, color, x + 7 + doc.getTextWidth(name) + 2, y)
  doc.setFont('helvetica', 'normal')
  const lines = doc.splitTextToSize(desc, colW - 9) as string[]
  doc.setFontSize(8)
  doc.setTextColor(...GREY3)
  doc.text(lines, x + 7, y + 5)
  return Math.max(14, lines.length * 3.8 + 7)
}

// ── Pages ─────────────────────────────────────────────────────────────────────

function drawCover(doc: jsPDF, pageNum: number) {
  doc.setFillColor(...NAVY)
  doc.rect(0, 0, PAGE_W, 100, 'F')
  doc.setFillColor(...BLUE)
  doc.rect(0, 98, PAGE_W, 3, 'F')

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
  doc.text('International Telco · Subsea Network Intelligence', M, 73)

  doc.setFontSize(13)
  doc.setTextColor(180, 210, 255)
  doc.setFont('helvetica', 'bold')
  const pitchLines = doc.splitTextToSize('The fastest way to design, price and sell a subsea route.', COL) as string[]
  doc.text(pitchLines, M, 87)
  doc.setFont('helvetica', 'normal')

  doc.setFontSize(8)
  doc.setTextColor(...GREY5)
  doc.text(new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' }), PAGE_W - M, 73, { align: 'right' })

  let y = 115
  doc.setFontSize(10)
  doc.setTextColor(...GREY1)
  doc.setFont('helvetica', 'bold')
  doc.text('What is RouteBuilder?', M, y)
  doc.setFont('helvetica', 'normal')
  y += 7
  y = bodyText(doc, `RouteBuilder is an intelligent route design platform — purpose-built to replace spreadsheets and tribal knowledge with a fast, visual, commercially-aware tool any sales or network engineer can use.\n\nWith RouteBuilder, any team member can identify optimal routes in seconds, assess commercial margin at a glance, validate diversity, apply geopolitical or technical constraints, and export a customer-ready straight-line diagram — all from one interface.`, y, COL, 9.5)

  y += 6
  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...GREY1)
  doc.text("Who It's For", M, y)
  doc.setFont('helvetica', 'normal')
  y += 7

  for (const [role, desc] of [
    ['Subsea Sales Specialists', 'Design routes, assess commercial margin and prepare customer-ready outputs — fast.'],
    ['Network Engineers',        'Validate path options, diversity requirements and capacity constraints with precision.'],
    ['Sales Engineers',          'Combine commercial and technical insight to build compelling, differentiated proposals.'],
  ]) {
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

  footer(doc, pageNum)
}

function drawFeatures(doc: jsPDF, nodeCount: number, segmentCount: number, _systemCount: number, pageNum: number) {
  pageHeader(doc, 'Key Features')
  let y = 24
  y = sectionTitle(doc, 'Core Capabilities', y)

  const features: [string, string, string][] = [
    ['🗺', 'PoP Route Builder',
      `Find optimal paths between any two nodes on our ${nodeCount}-node network. Configure wet, full, full-node or terrestrial diversity. Enforce via/avoid constraints on nodes, segments, cable systems or entire countries. Results appear in seconds.`],
    ['🤖', 'TSABuddy — AI Route Assistant',
      'Type in plain English: "Singapore to Tokyo with full diversity, avoiding China, sort by latency." TSABuddy extracts origin, destination, diversity type, country/system/node constraints, and sort preference — then triggers the search automatically. Powered by Claude AI.'],
    ['🌍', 'Country Constraints',
      'Avoid or require specific countries in Advanced Constraints. Must Avoid removes all landing nodes in a country from the route graph. Must Include requires at least one transit node per country. Fully understood by TSABuddy via natural language.'],
    ['🔵🟢', 'Diversity Pairs — Worker & Protect',
      'Diversity searches return matched Worker (blue) / Protect (green) pairs. Each pair is guaranteed to share no segments (or nodes) at the diversity level selected. Click ⇅ to flip roles — the full route data trades places so you control which path carries live traffic vs failover.'],
    ['🏙', 'City Pairs',
      'Explore city-to-city connectivity. See all viable system itineraries and key metrics without needing to know individual node IDs.'],
    ['💰', 'Margin Scoring',
      'Routes scored 1–10 for commercial margin based on ownership (owned, IRU, consortium, resell), weighted by segment distance. Green ≥7.5, amber ≥4.5, red below 4.5.'],
    ['📡', 'Capacity Dashboard',
      `Full-network capacity view across all ${segmentCount} segments — total and available Tbps with utilisation colour-coding. Instantly spot constraints.`],
    ['🔀', 'On-Net / Off-Net Classification',
      'Routes automatically classified as On-Net, Off-Net or Mixed. Mix percentage shown for blended routes — shapes the commercial narrative.'],
  ]

  for (const [icon, title, desc] of features) {
    if (y > PAGE_H - 30) break
    y = featureRow(doc, icon, title, desc, y)
  }

  footer(doc, pageNum)
}

function drawMoreFeatures(doc: jsPDF, nodeCount: number, segmentCount: number, systemCount: number, pageNum: number) {
  pageHeader(doc, 'Key Features (continued)')
  let y = 24

  const features: [string, string, string][] = [
    ['🌊', 'Cable System Viewer',
      `Toggle any of the ${systemCount} cable systems on the live map to explore coverage and topology.`],
    ['🔍', 'Node Search',
      `Find the nearest landing stations from any address or lat/lng. One-click Set Origin / Set Dest jumps straight into a route search.`],
    ['📌', 'Pinned Routes & SLD Export',
      'Pin up to 5 routes, then export a branded straight-line diagram PDF ready for customer presentations.'],
    ['🗄', 'Ref Data Management',
      'Full CRUD for nodes, segments, systems, capacity, outages and interconnect rules — all editable within the app.'],
    ['🚨', 'Live Outage Awareness',
      'Active segment outages shown on route cards with repair dates. Push outage routes to the bottom with one click.'],
    ['📱', 'Mobile-First Design',
      'Full feature parity on phones and tablets — bottom-drawer navigation, collapsible panels and touch-optimised controls.'],
  ]

  y = sectionTitle(doc, 'Additional Capabilities', y)
  for (const [icon, title, desc] of features) {
    y = featureRow(doc, icon, title, desc, y)
  }

  y += 4
  y = sectionTitle(doc, 'Network Coverage', y)

  for (const [num, label, desc] of [
    [String(nodeCount),    'Nodes',        `Cable landing stations, terrestrial PoPs and subsea branching units`],
    [String(segmentCount), 'Segments',     `Wet and backhaul segments across ${systemCount} cable systems`],
    [String(systemCount),  'Cable Systems','Owned, IRU, consortium and partner capacity'],
  ] as [string,string,string][]) {
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

  footer(doc, pageNum)
}

function drawArchitecture(doc: jsPDF, nodeCount: number, segmentCount: number, systemCount: number, pageNum: number) {
  pageHeader(doc, 'Technical Architecture')
  let y = 24

  y = sectionTitle(doc, 'System Architecture — Four Tiers', y)

  const tiers: [string, string, [number,number,number], string, string[]][] = [
    ['🌐 Frontend',
      `The entire interface — map, route cards, search form, dashboards — runs as a React application delivered via Vercel's global CDN. When you click "Find Routes" the browser sends the request to the backend and renders the results; it does not perform the route calculation itself.`,
      BLUE, 'React · TypeScript · Vite · Vercel',
      ['React 18', 'TypeScript', 'Vite', 'Leaflet Maps', 'Vercel CDN']],
    ['⚙️ Backend',
      'The intelligence engine. Models the cable network as a weighted graph, runs graph traversal to find all valid paths, applies diversity constraints, enforces hard rules (avoid/include), scores every route for RTD, availability, margin and capacity, and serves all data to the browser.',
      PURPLE, 'FastAPI · Python · NetworkX · Railway',
      ['FastAPI', 'Python 3.11', 'NetworkX', 'Pydantic', 'Railway']],
    ['🗄 Database',
      `All ${nodeCount} nodes, ${segmentCount} segments, ${systemCount} cable systems, capacity figures, outage records and interconnect rules live in a PostgreSQL database independent of the application. Survives redeployments. Every Ref Data edit writes through immediately and permanently.`,
      GREEN, 'PostgreSQL · Railway',
      ['PostgreSQL', 'Railway', 'Persistent']],
    ['🤖 AI Layer',
      "TSABuddy is powered by Claude (Anthropic). When you type a route request, the backend sends your text to Claude with a prompt defining all valid node IDs, segments, systems, countries and parameter options. Claude extracts a structured JSON — origin, destination, diversity, country/system/node constraints, pool strategy, sort order — which the backend validates and returns to pre-fill the search form.",
      ORANGE, 'Claude AI · Anthropic · TSABuddy',
      ['Claude AI', 'Anthropic', 'Structured NLP', 'JSON extraction']],
  ]

  for (const [title, desc, color, sub, badges] of tiers) {
    if (y > PAGE_H - 50) break
    const descLines = doc.splitTextToSize(desc, COL - 8) as string[]
    const cardH = descLines.length * 3.8 + 24
    doc.setFillColor(color[0], Math.min(255, color[1] + 180), Math.min(255, color[2] + 190))
    doc.setFillColor(248, 249, 255)
    doc.roundedRect(M, y, COL, cardH, 2, 2, 'F')
    doc.setFillColor(...color)
    doc.rect(M, y, 3, cardH, 'F')

    doc.setFontSize(10)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...GREY1)
    doc.text(title, M + 7, y + 7)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(...GREY3)
    doc.text(sub, M + 7, y + 12)

    doc.setFontSize(8.5)
    doc.setTextColor(...GREY3)
    doc.text(descLines, M + 7, y + 18)

    // badges
    let bx = M + 7
    for (const b of badges) {
      const bw = b.length * 1.8 + 6
      if (bx + bw > PAGE_W - M) break
      doc.setFillColor(color[0] * 0.85, color[1] * 0.85, color[2] * 0.85)
      doc.roundedRect(bx, y + cardH - 8, bw, 5, 1, 1, 'F')
      doc.setFontSize(6)
      doc.setTextColor(...WHITE)
      doc.text(b, bx + bw / 2, y + cardH - 4.5, { align: 'center' })
      bx += bw + 2
    }

    y += cardH + 6
  }

  footer(doc, pageNum)
}

function drawAlgorithm(doc: jsPDF, pageNum: number) {
  pageHeader(doc, 'Search Algorithm')
  let y = 24

  y = sectionTitle(doc, 'The Four-Stage Pipeline', y)

  const stages: [string, [number,number,number], string, string, string][] = [
    ['1', BLUE,   '🔍 Graph Search',
      'up to 500 routes',
      'NetworkX walks the cable network finding all valid shortest paths between the origin and destination. Branching units are traversed automatically.'],
    ['2', ORANGE, '⚖️  Apply Constraints',
      'hard exclusions',
      'Every active constraint (avoid/include nodes, segments, systems, countries; max wet/terrestrial hops) is applied as a permanent filter. Any path that breaks a constraint is removed and will not reappear.'],
    ['3', PURPLE, '🎯 Select Pool',
      '30 routes kept',
      'Default: top 3–4 routes from each of 6 dimensions (hops, distance, latency, margin, capacity, ownership), deduplicated. Optimise For: all 30 slots filled by one chosen metric.'],
    ['4', GREEN,  '📊 Sort & Display',
      '1–10 shown',
      'Pool sorted by the active sort button. Use − / + stepper to show 1–10 results (default 5). Outages can be pushed to the bottom separately.'],
  ]

  for (const [num, color, title, count, desc] of stages) {
    const lines = doc.splitTextToSize(desc, COL - 26) as string[]
    const cardH = lines.length * 3.8 + 14
    doc.setFillColor(248, 249, 255)
    doc.roundedRect(M, y, COL, cardH, 2, 2, 'F')
    doc.setFillColor(...color)
    doc.circle(M + 6, y + cardH / 2, 5, 'F')
    doc.setFontSize(9)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...WHITE)
    doc.text(num, M + 6, y + cardH / 2 + 3, { align: 'center' })

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(...GREY1)
    doc.text(title, M + 16, y + 7)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...GREY3)
    doc.text(lines, M + 16, y + 13)

    badge(doc, count, color, PAGE_W - M - (count.length * 2.2 + 8), y + 4)
    y += cardH + 4
  }

  y += 4
  doc.setFontSize(8.5)
  doc.setTextColor(...GREY3)
  doc.setFont('helvetica', 'italic')
  const note = 'Key distinction: Constraints (Step 2) are permanent exclusions — a route that breaks one will never appear. Pool selection (Step 3) and display sort (Step 4) are preferences — they control which valid routes you see, not which exist.'
  const noteLines = doc.splitTextToSize(note, COL) as string[]
  doc.setFillColor(235, 240, 255)
  doc.roundedRect(M, y - 3, COL, noteLines.length * 4 + 6, 2, 2, 'F')
  doc.setFontSize(8)
  doc.setTextColor(...BLUE)
  doc.text(noteLines, M + 3, y + 2)
  doc.setFont('helvetica', 'normal')
  y += noteLines.length * 4 + 10

  y = sectionTitle(doc, 'Optimise For — Pool Selection (Step 3)', y)
  const halfW = (COL - 4) / 2
  let col = 0
  let rowStartY = y
  for (const [icon, label, desc, dir] of [
    ['○', 'Hops',       'Fill 30 with fewest-hop routes',        '↑ fewest first'],
    ['↔', 'Distance',   'Fill 30 with shortest routes',           '↑ shortest first'],
    ['⚡', 'Latency',   'Fill 30 with lowest-latency routes',     '↑ lowest first'],
    ['$',  'Margin',    'Fill 30 with best commercial margin',    '↓ highest first'],
    ['◈',  'Capacity',  'Fill 30 with highest bottleneck Tbps',   '↓ most first'],
    ['◉',  'Ownership', 'Fill 30 with most on-net routes',        '↓ most on-net first'],
    ['🚢', 'No Outages','Exclude any route with an active outage','✓ all segments healthy'],
  ] as [string,string,string,string][]) {
    const xOff = col * (halfW + 4)
    doc.setFontSize(8.5)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...GREY1)
    doc.text(`${icon}  ${label}`, M + xOff, rowStartY)
    doc.setFont('helvetica', 'normal')
    const dlines = doc.splitTextToSize(desc, halfW - 30) as string[]
    doc.setFontSize(7.5)
    doc.setTextColor(...GREY3)
    doc.text(dlines, M + xOff, rowStartY + 4.5)
    doc.setFontSize(7)
    doc.setTextColor(...BLUE)
    doc.text(dir, M + xOff + halfW - 2, rowStartY + 2, { align: 'right' })
    doc.setDrawColor(...GREY5)
    doc.setLineWidth(0.1)
    doc.line(M + xOff, rowStartY + dlines.length * 3.5 + 6, M + xOff + halfW - 2, rowStartY + dlines.length * 3.5 + 6)
    if (col === 1) { rowStartY += dlines.length * 3.5 + 8; col = 0 }
    else col = 1
  }

  footer(doc, pageNum)
}

function drawConstraints(doc: jsPDF, pageNum: number) {
  pageHeader(doc, 'Advanced Constraints Reference')
  let y = 24

  y = sectionTitle(doc, 'Hard Constraints — Applied at Step 2 (permanent exclusions)', y)

  doc.setFontSize(8.5)
  doc.setTextColor(...GREY3)
  doc.setFont('helvetica', 'italic')
  doc.text('Every active constraint below is a hard gate — any path that breaks it is permanently removed and will not appear in results.', M, y)
  doc.setFont('helvetica', 'normal')
  y += 7

  const half = (COL - 6) / 2

  const constraints: [string, string, string, [number,number,number], string][] = [
    ['📍', 'Must Include Nodes',    'VIA',  GREEN,  'Route must pass through every selected node. Use for mandatory transit PoPs or landing stations.'],
    ['🚫', 'Must Avoid Nodes',      'SKIP', RED,    'Route may not transit any selected node. Use to exclude restricted or unavailable facilities.'],
    ['🔗', 'Must Include Segments', 'VIA',  GREEN,  'Route must traverse every selected cable segment — e.g. to lock in a preferred submarine section.'],
    ['✂️',  'Must Avoid Segments',  'SKIP', RED,    'Route may not use any selected segment — e.g. under maintenance or at outage risk.'],
    ['📡', 'Must Include Systems',  'VIA',  GREEN,  'Route must carry at least one segment from every selected cable system.'],
    ['🛑', 'Must Avoid Systems',    'SKIP', RED,    'Route may not use any segment from the selected systems — full system exclusion.'],
    ['🌍', 'Must Include Countries','VIA',  GREEN,  'Route must transit at least one non-BU landing node in each selected country. Use for geographic landing requirements.'],
    ['🌐', 'Must Avoid Countries',  'SKIP', RED,    'Route may not pass through any landing node in selected countries. Geopolitical, licensing or security exclusion. If an endpoint is in an avoided country, search returns no results.'],
    ['🌊', 'Max Wet Hops',          'LIMIT',ORANGE, 'Cap on submarine cable segments. Each subsea segment = 1 wet hop. Leave blank for no limit.'],
    ['⛰️', 'Max Terrestrial Hops', 'LIMIT',ORANGE, 'Cap on land cable segments. Each terrestrial segment = 1 land hop. Leave blank for no limit.'],
  ]

  let col = 0
  let rowTop = y
  let leftH = 0, rightH = 0

  for (const [icon, name, badgeLabel, color, desc] of constraints) {
    const xOff = col * (half + 6)
    const h = constraintRow(doc, icon, name, badgeLabel, color, desc, rowTop, half, xOff)
    if (col === 0) { leftH = h; col = 1 }
    else {
      rightH = h
      const rowH = Math.max(leftH, rightH)
      doc.setDrawColor(...GREY5)
      doc.setLineWidth(0.1)
      doc.line(M, rowTop + rowH, PAGE_W - M, rowTop + rowH)
      rowTop += rowH + 4
      col = 0; leftH = 0; rightH = 0
    }
  }
  if (col === 1) {
    rowTop += leftH + 4
  }

  y = rowTop + 6
  y = sectionTitle(doc, 'Country Constraints — How They Work', y)

  doc.setFontSize(8.5)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(...GREY3)
  const countryNote = `Country constraints operate at the graph level — before any path is computed. For Must Avoid Countries, every landing node (non-branching-unit) in the selected country is removed from the working graph. No path through that country can exist. If your origin or destination is itself in an avoided country, the search immediately returns no results — avoiding an impossible constraint silently.

Must Include Countries requires at least one intermediate node from the selected country to appear on each path. This is applied as a post-filter after graph search. Both constraints support multi-select and are understood by TSABuddy: "avoiding China and Taiwan" correctly produces must_avoid_countries: ["CN","TW"] — not a list of individual node IDs.`

  y = bodyText(doc, countryNote, y, COL, 8.5)

  footer(doc, pageNum)
}

function drawDiversity(doc: jsPDF, pageNum: number) {
  pageHeader(doc, 'Diversity Types & Worker / Protect Pairs')
  let y = 24

  y = sectionTitle(doc, 'Diversity Types', y)

  doc.setFontSize(8.5)
  doc.setTextColor(...GREY3)
  doc.text('Diversity ensures two routes share no common point of failure at the level selected.', M, y)
  y += 8

  const types: [string, string, [number,number,number], string][] = [
    ['NONE',    'None',                  GREY5,  'Single best-path search. No diversity constraint — returns a ranked list of standalone routes.'],
    ['WET',     'Wet',                   BLUE,   'Routes share no submarine cable segments. Terrestrial (backhaul) sections may overlap.'],
    ['FULL',    'Full',                  BLUE,   'Routes share no segments of any type — submarine or terrestrial. The strongest practical standard for most circuits.'],
    ['FULL+',   'Full + Node Isolation', PURPLE, 'As Full, plus no intermediate transit nodes may be shared. The highest level of physical separation available.'],
    ['TERR-O',  'Terrestrial — Origin',  ORANGE, 'Routes use different terrestrial segments at the origin end. Submarine sections may overlap.'],
    ['TERR-D',  'Terrestrial — Dest.',   ORANGE, 'Routes use different terrestrial segments at the destination end. Submarine sections may overlap.'],
    ['TERR-OD', 'Terrestrial — Both',    ORANGE, 'Routes use different terrestrial segments at both the origin and destination ends simultaneously.'],
  ]

  const half = (COL - 4) / 2
  let col = 0, rowTop = y

  for (const [badgeLabel, name, color, desc] of types) {
    const xOff = col * (half + 4)
    const x = M + xOff
    const descLines = doc.splitTextToSize(desc, half - 4) as string[]
    const cardH = descLines.length * 3.6 + 14

    doc.setFillColor(248, 249, 255)
    doc.roundedRect(x, rowTop, half, cardH, 1.5, 1.5, 'F')
    doc.setFillColor(...color)
    doc.roundedRect(x, rowTop, half, 6, 1.5, 1.5, 'F')
    doc.setFontSize(7.5)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...WHITE)
    doc.text(badgeLabel, x + 3, rowTop + 4.5)
    doc.setFontSize(8.5)
    doc.setTextColor(...GREY1)
    doc.setFont('helvetica', 'bold')
    doc.text(name, x + 3 + doc.getTextWidth(badgeLabel) + 4, rowTop + 4.5)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...GREY3)
    doc.text(descLines, x + 3, rowTop + 11)

    if (col === 0) { col = 1 }
    else { rowTop += cardH + 4; col = 0 }
  }
  if (col === 1) rowTop += 20

  y = rowTop + 6

  y = sectionTitle(doc, 'Diversity Pairs — Worker & Protect', y)

  const pairH = 52
  doc.setFillColor(15, 30, 60)
  doc.roundedRect(M, y, COL, pairH, 3, 3, 'F')

  // Worker column
  doc.setFillColor(37, 99, 235)
  doc.roundedRect(M + 4, y + 4, (COL - 12) / 2, pairH - 8, 2, 2, 'F')
  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...WHITE)
  doc.text('WORKER', M + 8, y + 12)
  doc.setFontSize(7.5)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(180, 210, 255)
  const wText = doc.splitTextToSize('Blue. Carries live traffic under normal conditions.', (COL - 12) / 2 - 8) as string[]
  doc.text(wText, M + 8, y + 18)

  // Protect column
  const p2x = M + (COL - 12) / 2 + 8
  doc.setFillColor(22, 120, 60)
  doc.roundedRect(p2x, y + 4, (COL - 12) / 2, pairH - 8, 2, 2, 'F')
  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...WHITE)
  doc.text('PROTECT', p2x + 4, y + 12)
  doc.setFontSize(7.5)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(180, 255, 210)
  const pText = doc.splitTextToSize('Green. Failover circuit — stands by if the worker fails. Guaranteed segment-disjoint per diversity setting.', (COL - 12) / 2 - 8) as string[]
  doc.text(pText, p2x + 4, y + 18)

  y += pairH + 8

  y = sectionTitle(doc, '⇅ Pair Flip — Swapping Worker & Protect Roles', y)

  const flipDesc = `Click ⇅ on any diversity pair card to swap Worker and Protect roles. This is a full data swap — the map redraws each route under its new colour, the route stats update to reflect the new assignment, and the sort order recalculates using the new worker's metrics.

Use the flip when you want a specific physical path to carry live traffic rather than act as failover. This is an important technical distinction for circuit provisioning: the Worker circuit is the one that actually carries customer traffic, so choosing which path is Worker defines the primary network engineering decision.

The ⇅ button appears at the top of each pair card. An orange highlight indicates the pair is currently flipped. Flip state clears automatically when you run a new search.`

  y = bodyText(doc, flipDesc, y, COL, 9)

  y += 6
  y = sectionTitle(doc, 'Display Sort — Step 4 Reference', y)

  const sortOpts: [string, string, string, string][] = [
    ['⬡', 'HOPS',     '↑ fewest first',    'Fewest cable segment hops end-to-end'],
    ['↔', 'DIST',     '↑ shortest first',   'Shortest total route kilometres'],
    ['⚡', 'RTD',     '↑ lowest first',     'Lowest round-trip propagation delay'],
    ['🛡', 'AVAIL',   '↓ highest first',    'Best end-to-end availability %'],
    ['$',  'MARGIN',  '↓ highest first',    'Best weighted commercial margin score'],
    ['◈',  'CAPACITY','↓ highest first',    'Highest available Tbps at bottleneck'],
    ['◉',  'OWN',     '↑ most on-net',      'Highest on-net segment ratio'],
    ['🚢', 'UP',      '↓ outages last',     'Push outage-affected routes to bottom'],
  ]

  const colW = COL / 4 - 2
  let sx = M, sy = y
  for (let i = 0; i < sortOpts.length; i++) {
    const [icon, key, dir, desc] = sortOpts[i]
    doc.setFillColor(248, 249, 255)
    doc.roundedRect(sx, sy, colW, 24, 1.5, 1.5, 'F')
    doc.setFontSize(12)
    doc.setTextColor(...BLUE)
    doc.text(icon, sx + colW / 2, sy + 8, { align: 'center' })
    doc.setFontSize(8.5)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...GREY1)
    doc.text(key, sx + colW / 2, sy + 14, { align: 'center' })
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(...BLUE)
    doc.text(dir, sx + colW / 2, sy + 18, { align: 'center' })
    doc.setFontSize(6.5)
    doc.setTextColor(...GREY3)
    const dl = doc.splitTextToSize(desc, colW - 4) as string[]
    doc.text(dl, sx + colW / 2, sy + 22, { align: 'center' })

    sx += colW + 2.5
    if ((i + 1) % 4 === 0) { sx = M; sy += 28 }
  }

  footer(doc, pageNum)
}

function drawUserGuide(doc: jsPDF, pageNum: number) {
  pageHeader(doc, 'User Guide')
  let y = 24

  y = sectionTitle(doc, 'Building Your First Route', y)

  const routeSteps: [string, string][] = [
    ['Open PoP Routes',               'Select the PoP Routes tab. TSABuddy appears at the top — use it or configure the search manually below.'],
    ['Select Origin & Destination',   'Type a city or node name in the search boxes. The live combobox filters as you type. Use the ⇅ swap button between the two fields to flip origin and destination instantly.'],
    ['Set Diversity (optional)',       'Choose Wet, Full, Full-Node, or a Terrestrial variant. Wet = no shared submarine segments. Full = no shared segments end-to-end. Full-Node adds node isolation. Terrestrial variants isolate backhaul at origin, destination, or both ends. Leave as None for single-path.'],
    ['Add Constraints (optional)',     'Open Advanced Constraints to force via or avoid on nodes, segments, systems or entire countries. Country constraints are geopolitical hard filters — no landing node in an avoided country will appear on any result.'],
    ['Search',                         'Press Find Routes. Results appear in seconds.'],
    ['Review & Sort',                  'Route cards show the path, margin badge, on-net %, capacity and RTD. Sort by RTD, Availability, Margin, Capacity or On-Net. Toggle UP to push outage routes down. Use − / + stepper to show 1–10 results.'],
    ['Flip a Diversity Pair (optional)','Click ⇅ on any Worker / Protect pair to swap roles. The full route data — path, stats, map colour — trades places. Use this to define which physical path carries live traffic vs failover.'],
    ['Pin & Export',                   'Pin up to 5 routes with 📍. Export a straight-line diagram PDF from the map controls.'],
  ]

  for (let i = 0; i < routeSteps.length; i++) {
    if (y > PAGE_H - 28) break
    y = step(doc, i + 1, routeSteps[i][0], routeSteps[i][1], y)
  }

  y = sectionTitle(doc, 'Using TSABuddy', y)

  doc.setFontSize(9)
  doc.setTextColor(...GREY3)
  doc.setFont('helvetica', 'italic')
  const tsaIntro = 'TSABuddy understands natural language route requests and configures the full search automatically. High or medium confidence triggers an auto-search. Low confidence shows a "Search anyway" option with full parameter preview.'
  const tsaLines = doc.splitTextToSize(tsaIntro, COL) as string[]
  doc.text(tsaLines, M, y)
  doc.setFont('helvetica', 'normal')
  y += tsaLines.length * 4 + 5

  const examples: [string, string][] = [
    ['Singapore to Hong Kong with wet diversity',             'Diversity'],
    ['Sydney to Tokyo avoiding AAG, sort by latency',         'Avoid system'],
    ['Perth to Singapore via SIN3 on Indigo, full diversity', 'Via node + system'],
    ['Singapore to Tokyo avoiding China and Taiwan',          'Country constraints'],
    ['London to Singapore must land in India, full diversity','Must include country'],
    ['SIN3 to TKO1 on EAC, optimise for margin',             'Pool selection'],
  ]

  for (const [ex, tag] of examples) {
    doc.setFontSize(8.5)
    doc.setTextColor(...BLUE)
    doc.text(`"${ex}"`, M + 4, y)
    doc.setFontSize(7)
    doc.setTextColor(...GREY3)
    doc.text(`— ${tag}`, PAGE_W - M, y, { align: 'right' })
    y += 5.5
  }

  footer(doc, pageNum)
}

function drawVision(doc: jsPDF, pageNum: number) {
  pageHeader(doc, 'Vision & Roadmap')
  let y = 24

  doc.setFillColor(...NAVY)
  doc.rect(0, 24, PAGE_W, 44, 'F')
  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...WHITE)
  const vLines = doc.splitTextToSize('RouteBuilder is the foundation for a fully integrated commercial network intelligence platform.', COL) as string[]
  doc.text(vLines, M, 40)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(160, 190, 255)
  const vSubLines = doc.splitTextToSize('Where real-time network data, AI-driven recommendations and commercial pricing converge into a single, customer-ready interface.', COL) as string[]
  doc.text(vSubLines, M, 54)
  y = 78

  y = sectionTitle(doc, 'Roadmap', y)

  for (const [title, desc, color, tag] of [
    ['Real-Time Network Data',        'Connect RouteBuilder to live NMS feeds for real-time capacity, latency and outage data — removing the lag between network events and commercial decisions.',                                    GREEN,  'In Planning'],
    ['Quoting & Pricing Integration', 'Bridge margin scores to actual pricing outputs, enabling indicative quotes directly from a route design.',                                                                                    ORANGE, 'In Planning'],
    ['AI-Driven Recommendations',     'TSABuddy evolves into a full commercial advisor — surfacing market intelligence and proactively optimising route recommendations.',                                                           BLUE,   'Future'],
    ['Customer-Facing Portal',        'A self-serve experience for enterprise customers to explore the network, model routes and initiate enquiries independently.',                                                                 BLUE,   'Future'],
  ] as [string, string, [number,number,number], string][]) {
    const dLines = doc.splitTextToSize(desc, COL - 12) as string[]
    const cardH = dLines.length * 3.8 + 16
    doc.setFillColor(248, 249, 255)
    doc.rect(M, y, COL, cardH, 'F')
    doc.setFillColor(...color)
    doc.rect(M, y, 3, cardH, 'F')
    doc.setFontSize(9)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...GREY1)
    doc.text(title, M + 7, y + 7)
    badge(doc, tag, color, PAGE_W - M - (tag.length * 2.2 + 8), y + 3)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.setTextColor(...GREY3)
    doc.text(dLines, M + 7, y + 12.5)
    y += cardH + 4
  }

  y += 4
  doc.setFontSize(9)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...GREY1)
  doc.text('The Ambition', M, y)
  doc.setFont('helvetica', 'normal')
  y += 6

  y = bodyText(doc, `RouteBuilder began as a tool to replace spreadsheets. Its ambition is to become the commercial intelligence layer for the subsea network — a platform where every route decision is faster, every customer interaction is better informed, and every commercial opportunity is visible the moment it arises.\n\nThe network knowledge that today lives in the heads of experienced staff will become a scalable, accessible, AI-augmented capability available to every person in the business.`, y, COL, 9.5)

  footer(doc, pageNum)
}

// ── Entry point ───────────────────────────────────────────────────────────────

export function generateUserGuidePDF(nodeCount = 0, segmentCount = 0, systemCount = 0) {
  _totalPages = 9
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })

  drawCover(doc, 1)
  doc.addPage(); drawFeatures(doc, nodeCount, segmentCount, systemCount, 2)
  doc.addPage(); drawMoreFeatures(doc, nodeCount, segmentCount, systemCount, 3)
  doc.addPage(); drawArchitecture(doc, nodeCount, segmentCount, systemCount, 4)
  doc.addPage(); drawAlgorithm(doc, 5)
  doc.addPage(); drawConstraints(doc, 6)
  doc.addPage(); drawDiversity(doc, 7)
  doc.addPage(); drawUserGuide(doc, 8)
  doc.addPage(); drawVision(doc, 9)

  doc.save(`RouteBuilder-Guide-${new Date().toISOString().slice(0, 10)}.pdf`)
}
