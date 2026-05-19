import jsPDF from 'jspdf'
import type { PinnedRoute, CableNode } from '../types'

const PAGE_W = 297
const PAGE_H = 210
const MARGIN = 18
const USABLE_W = PAGE_W - MARGIN * 2

// ── Colour helpers ────────────────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const c = hex.replace('#', '')
  return [
    parseInt(c.substring(0, 2), 16),
    parseInt(c.substring(2, 4), 16),
    parseInt(c.substring(4, 6), 16),
  ]
}

// ── Layout constants ──────────────────────────────────────────────────────────

const LINE_Y      = 108   // cable line Y position
const LABEL_GAP   = 4     // gap between line and labels
const NODE_R      = 2.2   // node circle radius

// ── Per-page diagram ──────────────────────────────────────────────────────────

function drawRoute(doc: jsPDF, pinned: PinnedRoute, nodesById: Record<string, CableNode>, pageNum: number, total: number) {
  const route     = pinned.route
  const segs      = route.segments
  const totalKm   = route.total_length_km
  const pinRgb    = hexToRgb(pinned.color)
  const startNode = nodesById[route.nodes[0]]
  const endNode   = nodesById[route.nodes[route.nodes.length - 1]]

  // ── Header ──────────────────────────────────────────────────────────────────

  // Pin colour stripe
  doc.setFillColor(...pinRgb)
  doc.rect(MARGIN, 8, USABLE_W, 2.5, 'F')

  // Branding
  doc.setFontSize(7)
  doc.setTextColor(140, 140, 140)
  doc.text('TELSTRA INTERNATIONAL · ROUTEBUILDER', MARGIN, 17)
  doc.text(`Page ${pageNum} of ${total}  ·  ${new Date().toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })}`, PAGE_W - MARGIN, 17, { align: 'right' })

  // Route title
  doc.setFontSize(13)
  doc.setTextColor(20, 20, 20)
  const fromName = startNode?.name ?? route.nodes[0]
  const toName   = endNode?.name   ?? route.nodes[route.nodes.length - 1]
  doc.text(`${fromName}  →  ${toName}`, MARGIN, 27)

  // Subtitle: searchLabel if available
  if (pinned.searchLabel && pinned.searchLabel !== `${fromName} → ${toName}`) {
    doc.setFontSize(8)
    doc.setTextColor(120, 120, 120)
    doc.text(pinned.searchLabel, MARGIN, 33)
  }

  // ── Route summary bar ────────────────────────────────────────────────────────

  const summaryY = 41
  doc.setFillColor(245, 245, 248)
  doc.rect(MARGIN, summaryY - 4, USABLE_W, 12, 'F')
  doc.setDrawColor(210, 210, 220)
  doc.setLineWidth(0.2)
  doc.rect(MARGIN, summaryY - 4, USABLE_W, 12)

  const summaryItems = [
    ['Total Length',  `${totalKm.toLocaleString()} km`],
    ['Total Latency', `${route.total_latency?.toFixed(1) ?? '—'} ms`],
    ['Availability',  `${(route.end_to_end_reliability * 100).toFixed(3)}%`],
    ['Segments',      `${segs.length}`],
    ['Nodes',         `${route.nodes.length}`],
  ]
  const colW = USABLE_W / summaryItems.length
  summaryItems.forEach(([label, value], i) => {
    const x = MARGIN + i * colW + colW / 2
    doc.setFontSize(6)
    doc.setTextColor(120, 120, 120)
    doc.text(label.toUpperCase(), x, summaryY, { align: 'center' })
    doc.setFontSize(9)
    doc.setTextColor(20, 20, 20)
    doc.text(value, x, summaryY + 5.5, { align: 'center' })
  })

  // ── Compute node X positions (proportional to segment length) ────────────────

  interface NodePos { x: number; nodeId: string }
  const positions: NodePos[] = []
  positions.push({ x: MARGIN, nodeId: route.nodes[0] })

  let cum = 0
  for (const seg of segs) {
    cum += seg.length_km
    positions.push({ x: MARGIN + (cum / totalKm) * USABLE_W, nodeId: seg.end_node_id })
  }

  // ── Main cable line ──────────────────────────────────────────────────────────

  doc.setDrawColor(80, 80, 80)
  doc.setLineWidth(0.7)
  doc.line(MARGIN, LINE_Y, PAGE_W - MARGIN, LINE_Y)

  // ── Segment labels (below line) ──────────────────────────────────────────────

  segs.forEach((seg, i) => {
    const x1   = positions[i].x
    const x2   = positions[i + 1].x
    const midX = (x1 + x2) / 2
    const segW = x2 - x1

    // Tick marks at segment boundaries
    doc.setDrawColor(120, 120, 120)
    doc.setLineWidth(0.3)
    doc.line(x1, LINE_Y - 3, x1, LINE_Y + 3)

    // System ID
    const sysLabel = seg.system_id.length > 14 ? seg.system_id.substring(0, 13) + '…' : seg.system_id
    doc.setFontSize(segW > 30 ? 7 : 5.5)
    doc.setTextColor(40, 80, 160)
    doc.text(sysLabel, midX, LINE_Y + LABEL_GAP + 5, { align: 'center', maxWidth: segW - 2 })

    // Length + latency
    if (segW > 18) {
      doc.setFontSize(6)
      doc.setTextColor(70, 70, 70)
      doc.text(`${seg.length_km.toLocaleString()} km`, midX, LINE_Y + LABEL_GAP + 10.5, { align: 'center' })
      if (seg.latency != null) {
        doc.text(`${seg.latency.toFixed(1)} ms`, midX, LINE_Y + LABEL_GAP + 14.5, { align: 'center' })
      }
    }

    // Ownership badge for wide segments
    if (segW > 40 && seg.ownership !== 'consortium') {
      doc.setFontSize(5.5)
      doc.setTextColor(130, 80, 10)
      doc.text(seg.ownership.toUpperCase(), midX, LINE_Y + LABEL_GAP + 18.5, { align: 'center' })
    }

    // Segment type indicator (wet vs terrestrial) — dashed line for terrestrial
    if (seg.type === 'terrestrial') {
      doc.setLineDashPattern([1.5, 1.5], 0)
      doc.setDrawColor(160, 100, 40)
      doc.setLineWidth(0.9)
      doc.line(x1, LINE_Y, x2, LINE_Y)
      doc.setLineDashPattern([], 0)
      doc.setDrawColor(80, 80, 80)
      doc.setLineWidth(0.7)
    }
  })

  // Closing tick
  doc.setDrawColor(120, 120, 120)
  doc.setLineWidth(0.3)
  doc.line(PAGE_W - MARGIN, LINE_Y - 3, PAGE_W - MARGIN, LINE_Y + 3)

  // ── Node circles + labels (above line) ───────────────────────────────────────

  // Alternate label rows to reduce overlap on dense routes
  positions.forEach((np, i) => {
    const node     = nodesById[np.nodeId]
    const isCLS    = node?.type === 'landing_station'
    const isFirst  = i === 0
    const isLast   = i === positions.length - 1

    // Circle — filled for CLS, outline for POP
    if (isCLS) {
      doc.setFillColor(30, 100, 200)
      doc.circle(np.x, LINE_Y, NODE_R, 'F')
    } else {
      doc.setFillColor(255, 255, 255)
      doc.setDrawColor(120, 120, 180)
      doc.setLineWidth(0.5)
      doc.circle(np.x, LINE_Y, NODE_R - 0.4, 'FD')
    }

    // Label position: alternate rows for interior nodes to reduce overlap
    const row   = (i % 2 === 0 || isFirst || isLast) ? 0 : 1
    const baseY = LINE_Y - NODE_R - LABEL_GAP

    const nameY    = baseY - 3.5 - row * 6
    const countryY = nameY - 3.8

    const name    = node?.name    ?? np.nodeId
    const country = node?.country ?? ''

    // Node ID code (small, above name)
    doc.setFontSize(5.5)
    doc.setTextColor(140, 140, 160)
    doc.text(np.nodeId, np.x, countryY, { align: 'center' })

    // Node name
    doc.setFontSize(isCLS ? 7.5 : 6.5)
    doc.setTextColor(isCLS ? 20 : 60, isCLS ? 20 : 60, isCLS ? 20 : 80)
    const displayName = name.length > 18 ? name.substring(0, 17) + '…' : name
    doc.text(displayName, np.x, nameY, { align: 'center' })

    // Country pill for CLS nodes
    if (isCLS && country) {
      doc.setFontSize(5.5)
      doc.setTextColor(80, 120, 180)
      doc.text(country, np.x, nameY + 3.5, { align: 'center' })
    }
  })

  // ── Legend ───────────────────────────────────────────────────────────────────

  const legY = PAGE_H - 14
  doc.setFontSize(6)
  doc.setTextColor(120, 120, 120)

  // Wet segment
  doc.setDrawColor(80, 80, 80)
  doc.setLineWidth(0.7)
  doc.line(MARGIN, legY, MARGIN + 10, legY)
  doc.text('Wet segment', MARGIN + 12, legY + 1)

  // Terrestrial
  doc.setLineDashPattern([1.5, 1.5], 0)
  doc.setDrawColor(160, 100, 40)
  doc.line(MARGIN + 35, legY, MARGIN + 45, legY)
  doc.setLineDashPattern([], 0)
  doc.text('Terrestrial', MARGIN + 47, legY + 1)

  // CLS dot
  doc.setFillColor(30, 100, 200)
  doc.circle(MARGIN + 72, legY, 1.5, 'F')
  doc.setTextColor(120, 120, 120)
  doc.text('Landing Station (CLS)', MARGIN + 75, legY + 1)

  // POP dot
  doc.setFillColor(255, 255, 255)
  doc.setDrawColor(120, 120, 180)
  doc.setLineWidth(0.5)
  doc.circle(MARGIN + 115, legY, 1.5, 'FD')
  doc.text('Terrestrial POP', MARGIN + 118, legY + 1)

  // Confidentiality footer
  doc.setFontSize(5.5)
  doc.setTextColor(180, 180, 180)
  doc.text('TELSTRA INTERNATIONAL CONFIDENTIAL — Generated by RouteBuilder', PAGE_W / 2, PAGE_H - 5, { align: 'center' })
}

// ── Cover page ────────────────────────────────────────────────────────────────

function drawCover(doc: jsPDF, pinnedRoutes: PinnedRoute[], nodesById: Record<string, CableNode>) {
  // Header stripe
  doc.setFillColor(30, 30, 50)
  doc.rect(0, 0, PAGE_W, 40, 'F')

  doc.setFontSize(22)
  doc.setTextColor(255, 255, 255)
  doc.text('Straight Line Diagrams', MARGIN, 24)

  doc.setFontSize(9)
  doc.setTextColor(160, 160, 200)
  doc.text('RouteBuilder · Telstra International', MARGIN, 33)

  // Date
  doc.setFontSize(8)
  doc.setTextColor(160, 160, 200)
  doc.text(
    new Date().toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
    PAGE_W - MARGIN, 33, { align: 'right' }
  )

  // Route summary table
  const tableY = 55
  doc.setFontSize(7)
  doc.setTextColor(80, 80, 80)
  doc.text('INCLUDED ROUTES', MARGIN, tableY)

  const rowH  = 11
  const cols  = [8, 70, 56, 40, 35, 35]    // relative col widths
  const totalColW = cols.reduce((a, b) => a + b, 0)
  const colXs = cols.map((_, i) => MARGIN + cols.slice(0, i).reduce((a, b) => a + b, 0) * (USABLE_W / totalColW))

  const headers = ['#', 'Route', 'Via', 'Length', 'Latency', 'Availability']
  headers.forEach((h, ci) => {
    doc.setFontSize(6.5)
    doc.setTextColor(100, 100, 100)
    doc.text(h, colXs[ci] + 2, tableY + 8)
  })
  doc.setDrawColor(200, 200, 210)
  doc.setLineWidth(0.2)
  doc.line(MARGIN, tableY + 10, PAGE_W - MARGIN, tableY + 10)

  pinnedRoutes.forEach((pinned, i) => {
    const route   = pinned.route
    const rowY    = tableY + 10 + (i + 1) * rowH
    const rgb     = hexToRgb(pinned.color)
    const start   = nodesById[route.nodes[0]]?.name ?? route.nodes[0]
    const end     = nodesById[route.nodes[route.nodes.length - 1]]?.name ?? route.nodes[route.nodes.length - 1]
    const via     = route.nodes.slice(1, -1).map(id => nodesById[id]?.name ?? id).join(' → ')

    // Alternating row background
    if (i % 2 === 0) {
      doc.setFillColor(248, 248, 252)
      doc.rect(MARGIN, rowY - 6, USABLE_W, rowH, 'F')
    }

    // Pin colour swatch
    doc.setFillColor(...rgb)
    doc.rect(colXs[0] + 1, rowY - 4.5, 4, 4.5, 'F')

    doc.setFontSize(8)
    doc.setTextColor(20, 20, 20)
    doc.text(`${start} → ${end}`, colXs[1] + 2, rowY)

    doc.setFontSize(6.5)
    doc.setTextColor(80, 80, 80)
    const viaText = via.length > 40 ? via.substring(0, 38) + '…' : (via || '—')
    doc.text(viaText, colXs[2] + 2, rowY)
    doc.text(`${route.total_length_km.toLocaleString()} km`, colXs[3] + 2, rowY)
    doc.text(`${route.total_latency?.toFixed(1) ?? '—'} ms`, colXs[4] + 2, rowY)
    doc.text(`${(route.end_to_end_reliability * 100).toFixed(3)}%`, colXs[5] + 2, rowY)

    doc.setDrawColor(220, 220, 230)
    doc.setLineWidth(0.15)
    doc.line(MARGIN, rowY + 4.5, PAGE_W - MARGIN, rowY + 4.5)
  })

  // Footer
  doc.setFontSize(5.5)
  doc.setTextColor(180, 180, 180)
  doc.text('TELSTRA INTERNATIONAL CONFIDENTIAL — Generated by RouteBuilder', PAGE_W / 2, PAGE_H - 5, { align: 'center' })
}

// ── Public entry point ────────────────────────────────────────────────────────

export function generateStraightLineDiagram(pinnedRoutes: PinnedRoute[], nodes: CableNode[]) {
  if (pinnedRoutes.length === 0) return

  const doc        = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const nodesById  = Object.fromEntries(nodes.map(n => [n.id, n]))
  const totalPages = pinnedRoutes.length + 1   // cover + one per route

  drawCover(doc, pinnedRoutes, nodesById)

  pinnedRoutes.forEach((pinned, i) => {
    doc.addPage()
    drawRoute(doc, pinned, nodesById, i + 2, totalPages)
  })

  doc.save(`RouteBuilder-SLD-${new Date().toISOString().slice(0, 10)}.pdf`)
}
