import jsPDF from 'jspdf'
import JSZip from 'jszip'
import type { PinnedRoute, CableNode, Project, ProjectCircuit } from '../types'

// ── Types ─────────────────────────────────────────────────────────────────────
type RGB = [number, number, number]

// ── Colour palette ────────────────────────────────────────────────────────────
const BLUE:      RGB = [0,   100, 190]
const GREEN:     RGB = [0,   140,  70]
const TEAL:      RGB = [0,   150, 170]
const LT_GRAY:   RGB = [238, 238, 238]
const MID_GRAY:  RGB = [170, 170, 170]
const DK_GRAY:   RGB = [55,   55,  55]
const WHITE:     RGB = [255, 255, 255]
const BLACK:     RGB = [20,   20,  20]

// ── Page dimensions (landscape A4) ────────────────────────────────────────────
const PW = 297
const PH = 210
const M  = 10    // outer margin

// ── Vertical layout landmarks ─────────────────────────────────────────────────
const TITLE_Y  = 7     // circuit label box top
const TITLE_H  = 12
const ZONE_Y   = TITLE_Y + TITLE_H + 2   // ≈ 21
const ZONE_H   = 7
const DIAG_Y   = ZONE_Y + ZONE_H + 1     // ≈ 29  diagram area starts
const LINE_Y   = DIAG_Y + 40             // ≈ 69  main path line
const DIAG_BOT = LINE_Y + 25             // ≈ 94  diagram area ends
const PNL_Y    = DIAG_BOT + 3            // ≈ 97  panel/table area starts
const PNL_H    = 55
const PNL_BOT  = PNL_Y + PNL_H          // ≈ 152
const LEG_Y    = PNL_BOT + 3            // ≈ 155
const LEG_H    = 12
const FTR_Y    = LEG_Y + LEG_H + 2      // ≈ 169

// ── Three panel columns ───────────────────────────────────────────────────────
const GAP    = 6
const COL_W  = (PW - M * 2 - GAP * 2) / 3   // ≈ 87.7
const COL_L  = M
const COL_C  = M + COL_W + GAP
const COL_R  = M + COL_W * 2 + GAP * 2

// ── Attribute table row heights ───────────────────────────────────────────────
const ROW_H        = 9.2
const LABEL_W_END  = 26   // label column in A/Z-End tables
const LABEL_W_SVC  = 35   // label column in service table

// ── Helpers ───────────────────────────────────────────────────────────────────

function hexToRgb(hex: string): RGB {
  const c = hex.replace('#', '')
  return [parseInt(c.slice(0,2),16), parseInt(c.slice(2,4),16), parseInt(c.slice(4,6),16)]
}

function setFill(doc: jsPDF, c: RGB) { doc.setFillColor(...c) }
function setStroke(doc: jsPDF, c: RGB, lw?: number) { doc.setDrawColor(...c); if (lw !== undefined) doc.setLineWidth(lw) }
function setColor(doc: jsPDF, c: RGB) { doc.setTextColor(...c) }

/** Clamp a string to maxLen characters */
function clamp(s: string | undefined, maxLen: number): string {
  if (!s) return '—'
  return s.length > maxLen ? s.slice(0, maxLen - 1) + '…' : s
}

// ── Draw one attribute row (teal label | light-gray value) ────────────────────
function attrRow(
  doc: jsPDF,
  x: number, y: number, w: number,
  labelW: number, label: string, value: string | undefined,
  rowH = ROW_H,
) {
  setFill(doc, TEAL)
  doc.rect(x, y, labelW, rowH, 'F')
  doc.setFontSize(6)
  setColor(doc, WHITE)
  doc.text(label, x + 2, y + rowH * 0.64)

  setFill(doc, LT_GRAY)
  doc.rect(x + labelW, y, w - labelW, rowH, 'F')
  doc.setFontSize(7)
  setColor(doc, DK_GRAY)
  doc.text(value || '—', x + labelW + 2.5, y + rowH * 0.67, { maxWidth: w - labelW - 4 })
}

// ── Node icon types ───────────────────────────────────────────────────────────
type IconType = 'pop' | 'cls' | 'mmr' | 'customer'

function iconTypeForNode(node: CableNode | undefined): IconType {
  if (!node) return 'pop'
  if (node.type === 'landing_station') return 'cls'
  if (node.type === 'branching_unit')  return 'mmr'
  // primary_pop / secondary_pop / extension_pop all use the pop icon
  return 'pop'
}

function drawNodeIcon(doc: jsPDF, cx: number, cy: number, type: IconType, sz = 5.5) {
  const r = sz / 2
  if (type === 'customer') {
    setFill(doc, WHITE); setStroke(doc, MID_GRAY, 0.4)
    doc.circle(cx, cy, r, 'FD')
    setStroke(doc, DK_GRAY, 0.3)
    doc.line(cx - r, cy, cx + r, cy)
    doc.line(cx, cy - r, cx, cy + r)
    doc.circle(cx, cy, r * 0.35, 'S')
  } else if (type === 'cls') {
    setFill(doc, WHITE); setStroke(doc, MID_GRAY, 0.4)
    doc.rect(cx - r, cy - r, sz, sz, 'FD')
    setStroke(doc, DK_GRAY, 0.3)
    doc.line(cx - r + 1.5, cy - r, cx - r + 1.5, cy + r)
    doc.line(cx - r, cy, cx + r, cy)
  } else if (type === 'mmr') {
    setFill(doc, WHITE); setStroke(doc, MID_GRAY, 0.4)
    doc.rect(cx - r, cy - r, sz, sz, 'FD')
    setFill(doc, DK_GRAY)
    const step = (sz - 2) / 2
    for (let row = 0; row < 3; row++)
      for (let col = 0; col < 3; col++)
        doc.circle(cx - r + 1 + col * step, cy - r + 1 + row * step, 0.45, 'F')
  } else {
    // POP: filled circle with ring
    setFill(doc, [220, 235, 255] as RGB); setStroke(doc, BLUE, 0.5)
    doc.circle(cx, cy, r, 'FD')
    doc.setFontSize(3.5); setColor(doc, BLUE)
    doc.text('●', cx, cy + 1.1, { align: 'center' })
  }
}

// ── Draw the node diagram (top section of page) ───────────────────────────────
function drawDiagram(
  doc: jsPDF,
  route: ReturnType<typeof buildRouteView>,
  nodesById: Record<string, CableNode>,
  showDwdm: boolean,
  sldConfig?: { show_rtd?: boolean; show_distance?: boolean; show_segment_latency?: boolean },
) {
  const { nodes, segments, totalKm, totalLatency } = route

  // Customer-site dashed boxes at each end
  const boxW = 52
  const boxY = DIAG_Y + 2
  const boxH = DIAG_BOT - boxY - 2
  setFill(doc, [252, 252, 252] as RGB); setStroke(doc, MID_GRAY, 0.3)
  doc.setLineDashPattern([3, 2], 0)
  doc.rect(M, boxY, boxW, boxH, 'FD')
  doc.rect(PW - M - boxW, boxY, boxW, boxH, 'FD')
  doc.setLineDashPattern([], 0)

  // Customer site labels inside boxes
  doc.setFontSize(6); setColor(doc, MID_GRAY)
  doc.text('CUSTOMER SITE', M + boxW / 2, boxY + 4, { align: 'center' })
  doc.text('CUSTOMER SITE', PW - M - boxW / 2, boxY + 4, { align: 'center' })

  // Node X positions proportional to segment lengths
  const innerL = M + boxW + 3
  const innerR = PW - M - boxW - 3
  const innerW = innerR - innerL

  interface NodePos { x: number; nodeId: string }
  const positions: NodePos[] = []
  positions.push({ x: innerL, nodeId: nodes[0] })
  let cum = 0
  for (const seg of segments) {
    cum += seg.length_km
    positions.push({ x: innerL + (cum / totalKm) * innerW, nodeId: seg.end_node_id })
  }

  // RTD arrow + label
  if (sldConfig?.show_rtd !== false && totalLatency) {
    const rtd = (totalLatency * 2).toFixed(1)
    const arrowY = DIAG_Y + 8
    setStroke(doc, MID_GRAY, 0.3)
    doc.line(M + boxW + 1, arrowY, PW - M - boxW - 1, arrowY)
    // Arrow heads
    const ah = 1.5, al = 3
    doc.line(M + boxW + 1, arrowY, M + boxW + 1 + al, arrowY - ah)
    doc.line(M + boxW + 1, arrowY, M + boxW + 1 + al, arrowY + ah)
    doc.line(PW - M - boxW - 1, arrowY, PW - M - boxW - 1 - al, arrowY - ah)
    doc.line(PW - M - boxW - 1, arrowY, PW - M - boxW - 1 - al, arrowY + ah)
    doc.setFontSize(6.5); setColor(doc, MID_GRAY)
    doc.text(`RTD ~${rtd} ms`, PW / 2, arrowY - 1.5, { align: 'center' })
  }

  // Main path line (solid blue)
  setStroke(doc, BLUE, 1.0)
  doc.line(M + boxW, LINE_Y, PW - M - boxW, LINE_Y)

  // DWDM dashed line
  if (showDwdm) {
    setStroke(doc, BLUE, 0.5)
    doc.setLineDashPattern([4, 2], 0)
    doc.line(M + boxW, LINE_Y + 3.5, PW - M - boxW, LINE_Y + 3.5)
    doc.setLineDashPattern([], 0)
  }

  // Segment labels above line
  segments.forEach((seg, i) => {
    const x1  = positions[i].x
    const x2  = positions[i + 1].x
    const mid = (x1 + x2) / 2
    const segW = x2 - x1

    // Tick marks
    setStroke(doc, MID_GRAY, 0.3)
    doc.line(x1, LINE_Y - 4, x1, LINE_Y + 4)

    if (segW > 12) {
      doc.setFontSize(Math.min(6.5, Math.max(4.5, segW / 9)))
      setColor(doc, BLUE)
      doc.text(clamp(seg.system_id, 20), mid, LINE_Y - 6, { align: 'center', maxWidth: segW - 2 })
    }
    if (segW > 22 && sldConfig?.show_segment_latency !== false) {
      doc.setFontSize(5.5); setColor(doc, DK_GRAY)
      const parts: string[] = []
      if (sldConfig?.show_distance !== false) parts.push(`${seg.length_km.toLocaleString()} km`)
      if (seg.latency != null) parts.push(`${seg.latency.toFixed(1)} ms`)
      if (parts.length) doc.text(parts.join(' · '), mid, LINE_Y - 2, { align: 'center', maxWidth: segW - 2 })
    }

    // Terrestrial: dashed orange overlay
    if (seg.type === 'terrestrial') {
      setStroke(doc, [160, 100, 40] as RGB, 0.8)
      doc.setLineDashPattern([2, 2], 0)
      doc.line(x1, LINE_Y, x2, LINE_Y)
      doc.setLineDashPattern([], 0)
    }
  })

  // Closing tick
  setStroke(doc, MID_GRAY, 0.3)
  doc.line(PW - M - boxW, LINE_Y - 4, PW - M - boxW, LINE_Y + 4)

  // Node icons + labels
  positions.forEach((np, i) => {
    const node    = nodesById[np.nodeId]
    const isFirst = i === 0
    const isLast  = i === positions.length - 1

    // First/last nodes are in customer site boxes; inner nodes on line
    let iconX = np.x
    if (isFirst) iconX = M + boxW / 2
    if (isLast)  iconX = PW - M - boxW / 2

    const iconType: IconType = (isFirst || isLast) ? 'customer' : iconTypeForNode(node)
    drawNodeIcon(doc, iconX, LINE_Y, iconType)

    // Labels
    const row   = (!isFirst && !isLast && i % 2 === 0) ? 1 : 0
    const baseY = LINE_Y + 7.5 + row * 6

    doc.setFontSize(5.5); setColor(doc, MID_GRAY)
    doc.text(np.nodeId, iconX, baseY, { align: 'center' })
    doc.setFontSize(isFirst || isLast ? 6.5 : 6); setColor(doc, DK_GRAY)
    doc.text(clamp(node?.name, 18), iconX, baseY + 4, { align: 'center' })
    if (node?.country && !isFirst && !isLast) {
      doc.setFontSize(5); setColor(doc, MID_GRAY)
      doc.text(node.country, iconX, baseY + 7.5, { align: 'center' })
    }
  })
}

// ── Draw bottom panels + tables ───────────────────────────────────────────────
function drawPanels(
  doc: jsPDF,
  circuit: ProjectCircuit | undefined,
  pin: PinnedRoute,
  nodesById: Record<string, CableNode>,
  protectView?: RouteView,
) {
  const route      = pin.route
  const aEndNode   = nodesById[route.nodes[0]]
  const zEndNode   = nodesById[route.nodes[route.nodes.length - 1]]
  const aEnd       = circuit?.a_end
  const zEnd       = circuit?.z_end

  // ── A-End address panel (left column top) ─────────────────────────────────
  const addrH = 28
  setFill(doc, WHITE); setStroke(doc, MID_GRAY, 0.3)
  doc.rect(COL_L, PNL_Y, COL_W, addrH, 'FD')
  doc.setFontSize(7); setColor(doc, BLACK)
  doc.text(`A-End: ${aEndNode?.country ?? ''}`, COL_L + 3, PNL_Y + 6)
  doc.setFontSize(6.5)
  const aName = aEnd?.customer_site_name ?? aEndNode?.name ?? '—'
  doc.text(aName, COL_L + 3, PNL_Y + 11.5)
  if (aEnd?.customer_site_address) {
    doc.setFontSize(6); setColor(doc, DK_GRAY)
    const lines = doc.splitTextToSize(aEnd.customer_site_address, COL_W - 6)
    lines.slice(0, 3).forEach((line: string, i: number) =>
      doc.text(line, COL_L + 3, PNL_Y + 16 + i * 4))
  }

  // ── Z-End address panel (right column top) ────────────────────────────────
  setFill(doc, WHITE); setStroke(doc, MID_GRAY, 0.3)
  doc.rect(COL_R, PNL_Y, COL_W, addrH, 'FD')
  doc.setFontSize(7); setColor(doc, BLACK)
  doc.text(`Z-End: ${zEndNode?.country ?? ''}`, COL_R + 3, PNL_Y + 6)
  doc.setFontSize(6.5)
  const zName = zEnd?.customer_site_name ?? zEndNode?.name ?? '—'
  doc.text(zName, COL_R + 3, PNL_Y + 11.5)
  if (zEnd?.customer_site_address) {
    doc.setFontSize(6); setColor(doc, DK_GRAY)
    const lines = doc.splitTextToSize(zEnd.customer_site_address, COL_W - 6)
    lines.slice(0, 3).forEach((line: string, i: number) =>
      doc.text(line, COL_R + 3, PNL_Y + 16 + i * 4))
  }

  // ── Legend (center column top) ─────────────────────────────────────────────
  const legBoxY = PNL_Y + 3
  if (protectView) {
    setStroke(doc, BLUE, 1.0)
    doc.line(COL_C + 3, legBoxY + 3, COL_C + 18, legBoxY + 3)
    doc.setFontSize(6.5); setColor(doc, DK_GRAY)
    doc.text('Worker Path', COL_C + 20, legBoxY + 4.5)
    setStroke(doc, GREEN, 1.0)
    doc.line(COL_C + 3, legBoxY + 9, COL_C + 18, legBoxY + 9)
    doc.text('Protect Path', COL_C + 20, legBoxY + 10.5)
  } else {
    setStroke(doc, BLUE, 1.0)
    doc.line(COL_C + 3, legBoxY + 3, COL_C + 18, legBoxY + 3)
    doc.setFontSize(6.5); setColor(doc, DK_GRAY)
    doc.text('Main Path - Estimated RTD', COL_C + 20, legBoxY + 4.5)
    setStroke(doc, BLUE, 0.5); doc.setLineDashPattern([3, 2], 0)
    doc.line(COL_C + 3, legBoxY + 9, COL_C + 18, legBoxY + 9)
    doc.setLineDashPattern([], 0)
    doc.text('Dedicated DWDM Channel', COL_C + 20, legBoxY + 10.5)
  }

  // ── Service table (center column, below legend) ────────────────────────────
  const svcY = PNL_Y + addrH - ROW_H * 5
  const workerView = buildRouteView(pin.route)
  const rows: [string, string | undefined][] = protectView
    ? [
        ['SERVICE TYPE', circuit?.service_type],
        ['WORKER PATH',  `${workerView.systems.join(', ')}  ·  ${workerView.totalKm.toLocaleString()} km  ·  RTD ${workerView.totalLatency != null ? (workerView.totalLatency * 2).toFixed(1) : '—'} ms`],
        ['PROTECT PATH', `${protectView.systems.join(', ')}  ·  ${protectView.totalKm.toLocaleString()} km  ·  RTD ${protectView.totalLatency != null ? (protectView.totalLatency * 2).toFixed(1) : '—'} ms`],
        ['BANDWIDTH',    circuit?.bandwidth],
        ['PROTECTION',   circuit?.protection],
        ['FRAME SIZE',   circuit?.frame_size],
      ]
    : [
        ['SERVICE TYPE', circuit?.service_type],
        ['CABLE SYSTEM', workerView.systems.join(', ') || undefined],
        ['BANDWIDTH',    circuit?.bandwidth],
        ['PROTECTION',   circuit?.protection],
        ['FRAME SIZE',   circuit?.frame_size],
        ['L1 SETTINGS',  circuit?.l1_settings],
      ]
  rows.forEach(([label, value], i) => {
    attrRow(doc, COL_C, svcY + i * ROW_H, COL_W, LABEL_W_SVC, label, value)
  })

  // ── A-End attribute table (left column bottom) ─────────────────────────────
  const endY = PNL_Y + addrH + 2
  const endRows: [string, string | undefined][] = [
    ['ACCES TYPE', aEnd?.access_type],
    ['SUPPLIER',   aEnd?.cc_supplier ? `${aEnd.cc_supplier}${aEnd.cc_arranged_by ? ` (Arr. by ${aEnd.cc_arranged_by})` : ''}` : undefined],
    ['BANDWIDTH',  aEnd?.bandwidth],
    ['INTERFACE',  aEnd?.interface_id],
    ['PROTECTION', aEnd?.protection],
  ]
  endRows.forEach(([label, value], i) => {
    attrRow(doc, COL_L, endY + i * ROW_H, COL_W, LABEL_W_END, label, value)
  })

  // ── Z-End attribute table (right column bottom) ────────────────────────────
  const zEndRows: [string, string | undefined][] = [
    ['ACCES TYPE', zEnd?.access_type],
    ['SUPPLIER',   zEnd?.cc_supplier ? `${zEnd.cc_supplier}${zEnd.cc_arranged_by ? ` (Arr. by ${zEnd.cc_arranged_by})` : ''}` : undefined],
    ['BANDWIDTH',  zEnd?.bandwidth],
    ['INTERFACE',  zEnd?.interface_id],
    ['PROTECTION', zEnd?.protection],
  ]
  zEndRows.forEach(([label, value], i) => {
    attrRow(doc, COL_R, endY + i * ROW_H, COL_W, LABEL_W_END, label, value)
  })
}

// ── Node icon legend bar ──────────────────────────────────────────────────────
function drawLegendBar(doc: jsPDF) {
  setFill(doc, LT_GRAY)
  doc.rect(M, LEG_Y, PW - M * 2, LEG_H, 'F')

  const items: [IconType, string][] = [
    ['pop',      'Telecom POP'],
    ['cls',      'Cable Landing Station'],
    ['mmr',      'MMR Panel'],
    ['customer', 'Customer Router'],
  ]
  const spacing = (PW - M * 2) / items.length
  items.forEach(([type, label], i) => {
    const cx = M + spacing * i + spacing / 2 - 12
    const cy = LEG_Y + LEG_H / 2
    drawNodeIcon(doc, cx, cy, type, 5)
    doc.setFontSize(6.5); setColor(doc, DK_GRAY)
    doc.text(label, cx + 5, cy + 1.5)
  })
}

// ── Footer metadata bar ───────────────────────────────────────────────────────
function drawFooter(
  doc: jsPDF,
  project: Project | undefined,
  pageNum: number,
  totalPages: number,
  version: string | undefined,
) {
  const fH = PH - FTR_Y
  setFill(doc, WHITE); setStroke(doc, MID_GRAY, 0.3)
  doc.rect(M, FTR_Y, PW - M * 2, fH, 'FD')

  // Vertical dividers
  const col1 = M + (PW - M * 2) * 0.3
  const col2 = M + (PW - M * 2) * 0.6
  const col3 = M + (PW - M * 2) * 0.75
  setStroke(doc, MID_GRAY, 0.2)
  doc.line(col1, FTR_Y, col1, FTR_Y + fH)
  doc.line(col2, FTR_Y, col2, FTR_Y + fH)
  doc.line(col3, FTR_Y, col3, FTR_Y + fH)

  const row1 = FTR_Y + 4
  const row2 = FTR_Y + 9
  const row3 = FTR_Y + 14
  const row4 = FTR_Y + 19
  const boldFonts = 7
  const valFonts  = 6.5

  // Left cell
  doc.setFontSize(boldFonts); setColor(doc, BLACK)
  doc.text('Customer Name:', M + 2, row1)
  doc.setFontSize(valFonts);  setColor(doc, DK_GRAY)
  doc.text(project?.customer_name ?? '—', M + 2, row2)
  doc.setFontSize(boldFonts); setColor(doc, BLACK)
  doc.text('Account Manager:', M + 2, row3)
  doc.setFontSize(valFonts);  setColor(doc, DK_GRAY)
  doc.text(project?.account_manager ?? '—', M + 2, row4)

  // Second cell
  doc.setFontSize(boldFonts); setColor(doc, BLACK)
  doc.text('Opportunity ID:', col1 + 2, row1)
  doc.setFontSize(valFonts);  setColor(doc, DK_GRAY)
  doc.text(project?.opportunity_id ?? '—', col1 + 2, row2)
  doc.setFontSize(boldFonts); setColor(doc, BLACK)
  doc.text('Description:', col1 + 2, row3)
  doc.setFontSize(valFonts);  setColor(doc, DK_GRAY)
  doc.text(project?.opportunity_name ?? '—', col1 + 2, row4, { maxWidth: col2 - col1 - 4 })

  // Date + page cell
  const dateStr = new Date().toLocaleDateString('en-AU', { year: 'numeric', month: 'short', day: '2-digit' })
  doc.setFontSize(boldFonts); setColor(doc, BLACK); doc.text('Date', col2 + 2, row1)
  doc.setFontSize(valFonts);  setColor(doc, DK_GRAY); doc.text(dateStr, col2 + 2, row2)
  doc.setFontSize(boldFonts); setColor(doc, BLACK); doc.text('Page', col2 + 2, row3)
  doc.setFontSize(valFonts);  setColor(doc, DK_GRAY)
  doc.text(`${pageNum} / ${totalPages}${version ? ` · ${version}` : ''}`, col2 + 2, row4)

  // Confidential cell
  doc.setFontSize(6); setColor(doc, DK_GRAY)
  const confText = 'Commercial In Confidence\nThis document contains confidential information which may not be disclosed, reproduced or used except with express written consent.'
  const confLines = doc.splitTextToSize(confText, col3 - col2 - 4 + (PW - M - col3) - 4)
  confLines.slice(0, 4).forEach((line: string, i: number) =>
    doc.text(line, col3 + 2, row1 + i * 4))

  // Brand mark (text only for POC)
  doc.setFontSize(9); setColor(doc, BLUE)
  doc.text('International', PW - M - 2, FTR_Y + fH - 7, { align: 'right' })
  doc.setFontSize(7); setColor(doc, TEAL)
  doc.text('Telco RouteBuilder', PW - M - 2, FTR_Y + fH - 3, { align: 'right' })
}

// ── Draw one route band on a horizontal line (inner nodes only) ───────────────
function drawRouteOnLine(
  doc: jsPDF,
  route: RouteView,
  lineY: number,
  lineColor: RGB,
  innerL: number,
  innerR: number,
  nodesById: Record<string, CableNode>,
  sldConfig: { show_distance?: boolean; show_segment_latency?: boolean } | undefined,
  labelsAbove: boolean,
) {
  const { nodes, segments, totalKm } = route
  const innerW = innerR - innerL

  interface NodePos { x: number; nodeId: string }
  const positions: NodePos[] = []
  positions.push({ x: innerL, nodeId: nodes[0] })
  let cum = 0
  for (const seg of segments) {
    cum += seg.length_km
    positions.push({ x: innerL + (cum / totalKm) * innerW, nodeId: seg.end_node_id })
  }

  setStroke(doc, lineColor, 1.0)
  doc.line(innerL, lineY, innerR, lineY)

  segments.forEach((seg, i) => {
    const x1   = positions[i].x
    const x2   = positions[i + 1].x
    const mid  = (x1 + x2) / 2
    const segW = x2 - x1

    setStroke(doc, MID_GRAY, 0.3)
    doc.line(x1, lineY - 3, x1, lineY + 3)

    if (segW > 12) {
      doc.setFontSize(Math.min(6.5, Math.max(4.5, segW / 9)))
      setColor(doc, lineColor)
      const sysY = labelsAbove ? lineY - 6 : lineY + 9
      doc.text(clamp(seg.system_id, 20), mid, sysY, { align: 'center', maxWidth: segW - 2 })
    }
    if (segW > 22 && sldConfig?.show_segment_latency !== false) {
      doc.setFontSize(5.5); setColor(doc, DK_GRAY)
      const parts: string[] = []
      if (sldConfig?.show_distance !== false) parts.push(`${seg.length_km.toLocaleString()} km`)
      if (seg.latency != null) parts.push(`${seg.latency.toFixed(1)} ms`)
      const distY = labelsAbove ? lineY - 2 : lineY + 5
      if (parts.length) doc.text(parts.join(' · '), mid, distY, { align: 'center', maxWidth: segW - 2 })
    }

    if (seg.type === 'terrestrial') {
      setStroke(doc, [160, 100, 40] as RGB, 0.8)
      doc.setLineDashPattern([2, 2], 0)
      doc.line(x1, lineY, x2, lineY)
      doc.setLineDashPattern([], 0)
    }
  })

  setStroke(doc, MID_GRAY, 0.3)
  doc.line(innerR, lineY - 3, innerR, lineY + 3)

  // Inner node icons and labels (skip shared endpoints at index 0 and last)
  for (let i = 1; i < positions.length - 1; i++) {
    const np       = positions[i]
    const node     = nodesById[np.nodeId]
    const iconType = iconTypeForNode(node)
    drawNodeIcon(doc, np.x, lineY, iconType)

    const row   = (i % 2 === 0) ? 1 : 0
    const baseY = labelsAbove
      ? lineY + 5 + row * 5
      : lineY - 8 - row * 5

    doc.setFontSize(5.5); setColor(doc, MID_GRAY)
    doc.text(np.nodeId, np.x, baseY, { align: 'center' })
    doc.setFontSize(5.5); setColor(doc, DK_GRAY)
    doc.text(clamp(node?.name, 14), np.x, baseY + 3.5, { align: 'center' })
  }
}

// ── Draw the protected (diamond/lens) node diagram ────────────────────────────
function drawDiagramProtected(
  doc: jsPDF,
  worker: RouteView,
  protect: RouteView,
  nodesById: Record<string, CableNode>,
  sldConfig?: { show_rtd?: boolean; show_distance?: boolean; show_segment_latency?: boolean },
) {
  const Y_W = DIAG_Y + 10   // ≈ 39  Worker path line
  const Y_C = DIAG_Y + 33   // ≈ 62  Shared endpoint centre
  const Y_P = DIAG_Y + 55   // ≈ 84  Protect path line

  const boxW = 52
  const boxY = DIAG_Y + 2
  const boxH = DIAG_BOT - boxY - 2

  setFill(doc, [252, 252, 252] as RGB); setStroke(doc, MID_GRAY, 0.3)
  doc.setLineDashPattern([3, 2], 0)
  doc.rect(M, boxY, boxW, boxH, 'FD')
  doc.rect(PW - M - boxW, boxY, boxW, boxH, 'FD')
  doc.setLineDashPattern([], 0)

  doc.setFontSize(6); setColor(doc, MID_GRAY)
  doc.text('CUSTOMER SITE', M + boxW / 2, boxY + 4, { align: 'center' })
  doc.text('CUSTOMER SITE', PW - M - boxW / 2, boxY + 4, { align: 'center' })

  const innerL = M + boxW + 3   // ≈ 65
  const innerR = PW - M - boxW - 3  // ≈ 232
  const aX = M + boxW / 2       // A-End icon centre X ≈ 36
  const zX = PW - M - boxW / 2  // Z-End icon centre X ≈ 261

  // Diamond connecting lines
  setStroke(doc, BLUE, 0.8)
  doc.line(aX, Y_C, innerL, Y_W)
  doc.line(zX, Y_C, innerR, Y_W)
  setStroke(doc, GREEN, 0.8)
  doc.line(aX, Y_C, innerL, Y_P)
  doc.line(zX, Y_C, innerR, Y_P)

  // Endpoint customer icons at centre Y
  drawNodeIcon(doc, aX, Y_C, 'customer')
  drawNodeIcon(doc, zX, Y_C, 'customer')

  // Endpoint labels below the icons
  const aNode = nodesById[worker.nodes[0]]
  const zNode = nodesById[worker.nodes[worker.nodes.length - 1]]
  doc.setFontSize(5.5); setColor(doc, MID_GRAY)
  doc.text(worker.nodes[0], aX, Y_C + 6, { align: 'center' })
  doc.setFontSize(6); setColor(doc, DK_GRAY)
  doc.text(clamp(aNode?.name, 14), aX, Y_C + 10, { align: 'center' })
  doc.setFontSize(5.5); setColor(doc, MID_GRAY)
  doc.text(worker.nodes[worker.nodes.length - 1], zX, Y_C + 6, { align: 'center' })
  doc.setFontSize(6); setColor(doc, DK_GRAY)
  doc.text(clamp(zNode?.name, 14), zX, Y_C + 10, { align: 'center' })

  // Role badges inside customer boxes
  doc.setFontSize(6); setColor(doc, BLUE)
  doc.text('WORKER', M + 3, Y_W + 1)
  setColor(doc, GREEN)
  doc.text('PROTECT', M + 3, Y_P + 1)

  drawRouteOnLine(doc, worker,  Y_W, BLUE,  innerL, innerR, nodesById, sldConfig, true)
  drawRouteOnLine(doc, protect, Y_P, GREEN, innerL, innerR, nodesById, sldConfig, false)
}

// ── Helper: extract a compact route view ─────────────────────────────────────
interface RouteView {
  nodes:       string[]
  segments:    Array<{
    system_id: string; length_km: number; latency: number | null;
    end_node_id: string; type: string; start_node_id: string
  }>
  totalKm:     number
  totalLatency: number | null
  systems:     string[]
}

function buildRouteView(route: PinnedRoute['route']): RouteView {
  const systems = [...new Set(route.segments.map(s => s.system_id))]
  return {
    nodes:       route.nodes,
    segments:    route.segments.map(s => ({
      system_id:    s.system_id,
      length_km:    s.length_km,
      latency:      s.latency,
      end_node_id:  s.end_node_id,
      start_node_id: s.start_node_id,
      type:         s.type,
    })),
    totalKm:      route.total_length_km,
    totalLatency: route.total_latency ?? null,
    systems,
  }
}

// ── Draw a full circuit page ──────────────────────────────────────────────────
function drawCircuitPage(
  doc: jsPDF,
  pin: PinnedRoute,
  nodesById: Record<string, CableNode>,
  circuit: ProjectCircuit | undefined,
  project: Project | undefined,
  pageNum: number,
  totalPages: number,
  version: string | undefined,
  protectView?: RouteView,
) {
  // Strip "(Worker)" suffix for the title when it's a protected circuit
  const rawLabel = pin.circuitLabel ?? pin.searchLabel
  const label    = rawLabel.replace(/\s*\(Worker\)$/, '')

  // ── Circuit label box (top center) ─────────────────────────────────────────
  const boxW = 100
  const boxX = (PW - boxW) / 2
  setFill(doc, TEAL)
  doc.roundedRect(boxX, TITLE_Y, boxW, TITLE_H, 2, 2, 'F')
  doc.setFontSize(9); setColor(doc, WHITE)
  doc.text(clamp(label, 50), PW / 2, TITLE_Y + TITLE_H * 0.67, { align: 'center' })

  // ── Zone bar ────────────────────────────────────────────────────────────────
  setFill(doc, [230, 245, 248] as RGB); setStroke(doc, TEAL, 0.3)
  doc.rect(M, ZONE_Y, PW - M * 2, ZONE_H, 'FD')
  doc.setFontSize(6.5); setColor(doc, TEAL)
  doc.text('CUSTOMER SITE', M + 25, ZONE_Y + ZONE_H * 0.7, { align: 'center' })
  doc.text('INTERNATIONAL TELCO NETWORK', PW / 2, ZONE_Y + ZONE_H * 0.7, { align: 'center' })
  doc.text('CUSTOMER SITE', PW - M - 25, ZONE_Y + ZONE_H * 0.7, { align: 'center' })
  setStroke(doc, TEAL, 0.3)
  doc.line(M + 50, ZONE_Y, M + 50, ZONE_Y + ZONE_H)
  doc.line(PW - M - 50, ZONE_Y, PW - M - 50, ZONE_Y + ZONE_H)

  // ── Node diagram ────────────────────────────────────────────────────────────
  if (protectView) {
    drawDiagramProtected(doc, buildRouteView(pin.route), protectView, nodesById, project?.sld_config)
  } else {
    drawDiagram(doc, buildRouteView(pin.route), nodesById, false, project?.sld_config)
  }

  // ── Bottom panels + tables ──────────────────────────────────────────────────
  drawPanels(doc, circuit, pin, nodesById, protectView)

  // ── Legend bar ──────────────────────────────────────────────────────────────
  drawLegendBar(doc)

  // ── Footer ──────────────────────────────────────────────────────────────────
  drawFooter(doc, project, pageNum, totalPages, version)
}

// ── Cover page ────────────────────────────────────────────────────────────────
function drawCover(
  doc: jsPDF,
  pins: PinnedRoute[],
  nodesById: Record<string, CableNode>,
  project: Project | undefined,
  version: string | undefined,
) {
  // Header stripe
  setFill(doc, TEAL)
  doc.rect(0, 0, PW, 42, 'F')

  doc.setFontSize(20); setColor(doc, WHITE)
  doc.text('Straight Line Diagrams', M, 20)
  doc.setFontSize(9); setColor(doc, [200, 235, 240] as RGB)
  doc.text('International Telco · RouteBuilder', M, 29)
  if (version) {
    doc.setFontSize(8); setColor(doc, [255, 230, 130] as RGB)
    doc.text(version.toUpperCase(), M, 36)
  }

  // Date (top right)
  doc.setFontSize(8); setColor(doc, [200, 235, 240] as RGB)
  doc.text(
    new Date().toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
    PW - M, 29, { align: 'right' },
  )

  // Project metadata block
  if (project) {
    const metaY = 52
    const fields: [string, string | undefined][] = [
      ['Customer',       project.customer_name],
      ['Project',        project.name],
      ['Account Manager',project.account_manager],
      ['Opportunity ID', project.opportunity_id],
      ['Description',    project.opportunity_name],
    ]
    fields.forEach(([k, v], i) => {
      doc.setFontSize(7); setColor(doc, MID_GRAY)
      doc.text(k.toUpperCase(), M, metaY + i * 9)
      doc.setFontSize(9); setColor(doc, BLACK)
      doc.text(v || '—', M + 45, metaY + i * 9)
    })
  }

  // Circuit index table
  const tableY = project ? 100 : 55
  doc.setFontSize(7); setColor(doc, MID_GRAY)
  doc.text('CIRCUITS / ROUTES IN THIS DOCUMENT', M, tableY)

  const rowH = 10
  const cols = [8, 70, 50, 35, 30, 32]
  const total = cols.reduce((a, b) => a + b, 0)
  const usable = PW - M * 2
  const colXs = cols.map((_, i) => M + cols.slice(0, i).reduce((a, b) => a + b, 0) * (usable / total))

  const headers = ['', 'Route', 'Via', 'Length', 'Latency', 'Availability']
  headers.forEach((h, ci) => {
    doc.setFontSize(6.5); setColor(doc, DK_GRAY)
    doc.text(h, colXs[ci] + 2, tableY + 8)
  })
  setStroke(doc, MID_GRAY, 0.2)
  doc.line(M, tableY + 10, PW - M, tableY + 10)

  pins.forEach((pin, i) => {
    const r   = pin.route
    const y   = tableY + 10 + (i + 1) * rowH
    const rgb = hexToRgb(pin.color)
    const s   = nodesById[r.nodes[0]]?.name ?? r.nodes[0]
    const e   = nodesById[r.nodes[r.nodes.length - 1]]?.name ?? r.nodes[r.nodes.length - 1]
    const via = r.nodes.slice(1, -1).map(id => nodesById[id]?.name ?? id).join(' → ')

    if (i % 2 === 0) { setFill(doc, [248, 248, 252] as RGB); doc.rect(M, y - 6, usable, rowH, 'F') }

    setFill(doc, rgb)
    doc.rect(colXs[0] + 1, y - 4, 4, 5, 'F')

    doc.setFontSize(8); setColor(doc, BLACK)
    doc.text(pin.circuitLabel ?? `${s} → ${e}`, colXs[1] + 2, y)
    doc.setFontSize(6); setColor(doc, DK_GRAY)
    doc.text(clamp(via || '(direct)', 38), colXs[2] + 2, y)
    doc.text(`${r.total_length_km.toLocaleString()} km`, colXs[3] + 2, y)
    doc.text(`${r.total_latency?.toFixed(1) ?? '—'} ms`, colXs[4] + 2, y)
    doc.text(`${(r.end_to_end_reliability * 100).toFixed(3)}%`, colXs[5] + 2, y)

    setStroke(doc, MID_GRAY, 0.15)
    doc.line(M, y + 4, PW - M, y + 4)
  })

  // Footer
  doc.setFontSize(5.5); setColor(doc, MID_GRAY)
  doc.text('INTERNATIONAL TELCO CONFIDENTIAL — Generated by RouteBuilder', PW / 2, PH - 5, { align: 'center' })
}

// ── Public: generate PDF for ad-hoc pinned routes ─────────────────────────────
export function generateStraightLineDiagram(
  pinnedRoutes: PinnedRoute[],
  nodes: CableNode[],
  version?: string,
) {
  if (pinnedRoutes.length === 0) return
  const doc       = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const nodesById = Object.fromEntries(nodes.map(n => [n.id, n]))
  const total     = pinnedRoutes.length + 1

  drawCover(doc, pinnedRoutes, nodesById, undefined, version)
  pinnedRoutes.forEach((pin, i) => {
    doc.addPage()
    drawCircuitPage(doc, pin, nodesById, undefined, undefined, i + 2, total, version)
  })

  const slug = version ? `-${version.replace(/\s+/g, '-')}` : ''
  doc.save(`SLD-${new Date().toISOString().slice(0, 10)}${slug}.pdf`)
}

// ── Public: generate PDF from a Project ──────────────────────────────────────
export function generateSldFromProject(
  project: Project,
  pinnedRoutes: PinnedRoute[],
  nodes: CableNode[],
  version?: string,
) {
  if (pinnedRoutes.length === 0) return
  const doc       = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const nodesById = Object.fromEntries(nodes.map(n => [n.id, n]))

  // Deduplicate: protected circuits have two pins (Worker + Protect) with the same circuitId.
  // We want one page per circuit, using the worker pin (always added first).
  const seen = new Set<string>()
  const circuitPins: PinnedRoute[] = []
  for (const pin of pinnedRoutes) {
    const key = pin.circuitId ?? pin.pinId
    if (seen.has(key)) continue
    seen.add(key)
    circuitPins.push(pin)
  }

  const total = circuitPins.length + 1
  drawCover(doc, circuitPins, nodesById, project, version)

  circuitPins.forEach((pin, i) => {
    doc.addPage()
    const circuit     = project.circuits.find(c => c.circuit_id === pin.circuitId)
    const protectView = circuit?.protect_route_snapshot
      ? buildRouteView(circuit.protect_route_snapshot)
      : undefined
    drawCircuitPage(doc, pin, nodesById, circuit, project, i + 2, total, version, protectView)
  })

  const safeName = (project.name ?? 'Project').replace(/[^a-z0-9]/gi, '-').slice(0, 30)
  const slug     = version ? `-${version.replace(/\s+/g, '-')}` : ''
  doc.save(`SLD-${safeName}-${new Date().toISOString().slice(0, 10)}${slug}.pdf`)
}

// ── Public: generate DrawIO XML ───────────────────────────────────────────────

function escXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function generateDrawioXml(
  pinnedRoutes: PinnedRoute[],
  nodes: CableNode[],
  project?: Project,
): string {
  const nodesById = Object.fromEntries(nodes.map(n => [n.id, n]))
  let id = 10
  const cells: string[] = []

  const PAGE_DX = 900   // X offset between circuit pages
  const NODE_W  = 90
  const NODE_H  = 36
  const LINE_Y_DIO = 80
  const USABLE_W_DIO = 720

  pinnedRoutes.forEach((pin, pi) => {
    const offsetX = pi * PAGE_DX
    const route   = pin.route
    const circuit = project?.circuits.find(c => c.circuit_id === pin.circuitId)
    const label   = escXml(pin.circuitLabel ?? pin.searchLabel)
    const rv      = buildRouteView(route)

    // Circuit title box
    cells.push(`<mxCell id="${id++}" value="${label}" style="rounded=1;fillColor=#009ab0;fontColor=#ffffff;strokeColor=none;fontSize=11;fontStyle=1;align=center;" vertex="1" parent="1"><mxGeometry x="${offsetX + 240}" y="10" width="220" height="28" as="geometry"/></mxCell>`)

    // Node X positions
    interface DioNode { x: number; nodeId: string }
    const positions: DioNode[] = []
    positions.push({ x: offsetX + 40, nodeId: route.nodes[0] })
    let cum = 0
    for (const seg of rv.segments) {
      cum += seg.length_km
      positions.push({ x: offsetX + 40 + (cum / rv.totalKm) * USABLE_W_DIO, nodeId: seg.end_node_id })
    }

    // Main path polyline
    const pathPts = positions.map(p => `${p.x},${LINE_Y_DIO}`).join(';')
    cells.push(`<mxCell id="${id++}" value="" style="edgeStyle=none;exitX=1;exitY=0.5;entryX=0;entryY=0.5;strokeColor=#0064be;strokeWidth=2;" edge="1" parent="1" source="${id + 1000}" target="${id + 1001}"><mxGeometry relative="1" as="geometry"><Array as="points">${pathPts}</Array></mxGeometry></mxCell>`)

    // Segment labels
    rv.segments.forEach((seg, si) => {
      const x1  = positions[si].x
      const x2  = positions[si + 1].x
      const mid = (x1 + x2) / 2
      cells.push(`<mxCell id="${id++}" value="${escXml(seg.system_id)}&#xa;${seg.length_km.toLocaleString()} km · ${seg.latency ?? '?'} ms" style="text;align=center;fontSize=8;fontColor=#0064be;" vertex="1" parent="1"><mxGeometry x="${mid - 50}" y="${LINE_Y_DIO - 30}" width="100" height="24" as="geometry"/></mxCell>`)
    })

    // Node boxes
    positions.forEach((np, ni) => {
      const node   = nodesById[np.nodeId]
      const isEnd  = ni === 0 || ni === positions.length - 1
      const nodeName = escXml(node?.name ?? np.nodeId)
      const nodeId_  = escXml(np.nodeId)
      const style  = isEnd
        ? 'shape=mxgraph.cisco.routers.generic_router;fillColor=#dae8fc;strokeColor=#6c8ebf;'
        : node?.type === 'landing_station'
          ? 'shape=mxgraph.network.server;fillColor=#f5f5f5;strokeColor=#666666;'
          : 'ellipse;fillColor=#dae8fc;strokeColor=#0064be;'
      cells.push(`<mxCell id="${id++}" value="${nodeName}&#xa;&lt;font style='font-size:8px;color:#888'&gt;${nodeId_}&lt;/font&gt;" style="${style}fontSize=9;align=center;" vertex="1" parent="1"><mxGeometry x="${np.x - NODE_W / 2}" y="${LINE_Y_DIO - NODE_H / 2}" width="${NODE_W}" height="${NODE_H}" as="geometry"/></mxCell>`)
    })

    // A/Z end info boxes
    const aEnd    = circuit?.a_end
    const zEnd    = circuit?.z_end
    const aEndNode = nodesById[route.nodes[0]]
    const zEndNode = nodesById[route.nodes[route.nodes.length - 1]]
    cells.push(`<mxCell id="${id++}" value="&lt;b&gt;A-End: ${escXml(aEndNode?.country ?? '')}&lt;/b&gt;&#xa;${escXml(aEnd?.customer_site_name ?? aEndNode?.name ?? '')}&#xa;${escXml(aEnd?.customer_site_address ?? '')}" style="text;align=left;fontSize=8;whiteSpace=wrap;" vertex="1" parent="1"><mxGeometry x="${offsetX + 10}" y="${LINE_Y_DIO + 60}" width="160" height="60" as="geometry"/></mxCell>`)
    cells.push(`<mxCell id="${id++}" value="&lt;b&gt;Z-End: ${escXml(zEndNode?.country ?? '')}&lt;/b&gt;&#xa;${escXml(zEnd?.customer_site_name ?? zEndNode?.name ?? '')}&#xa;${escXml(zEnd?.customer_site_address ?? '')}" style="text;align=left;fontSize=8;whiteSpace=wrap;" vertex="1" parent="1"><mxGeometry x="${offsetX + PAGE_DX - 170}" y="${LINE_Y_DIO + 60}" width="160" height="60" as="geometry"/></mxCell>`)

    // Service table (center)
    const svcRows = [
      ['SERVICE TYPE', circuit?.service_type ?? ''],
      ['BANDWIDTH',    circuit?.bandwidth ?? ''],
      ['PROTECTION',   circuit?.protection ?? ''],
    ]
    svcRows.forEach(([k, v], ri) => {
      const sx = offsetX + PAGE_DX / 2 - 120
      cells.push(`<mxCell id="${id++}" value="${escXml(k)}" style="fillColor=#009ab0;fontColor=#ffffff;fontSize=7;fontStyle=1;align=center;" vertex="1" parent="1"><mxGeometry x="${sx}" y="${LINE_Y_DIO + 60 + ri * 20}" width="80" height="18" as="geometry"/></mxCell>`)
      cells.push(`<mxCell id="${id++}" value="${escXml(v)}" style="fillColor=#eeeeee;fontSize=8;" vertex="1" parent="1"><mxGeometry x="${sx + 80}" y="${LINE_Y_DIO + 60 + ri * 20}" width="160" height="18" as="geometry"/></mxCell>`)
    })
  })

  return `<?xml version="1.0" encoding="UTF-8"?>
<mxfile>
  <diagram name="SLD">
    <mxGraphModel dx="1422" dy="762" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1169" pageHeight="827" math="0" shadow="0">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
        ${cells.join('\n        ')}
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`
}

// ── Public: generate Visio .vsdx ─────────────────────────────────────────────

// Visio uses EMU-like units: 1 inch = 914400 EMU, but Visio XML uses inches directly.
// Shape coordinates are in inches (floating point).

function escVml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export async function generateVisioVsdx(
  pinnedRoutes: PinnedRoute[],
  nodes: CableNode[],
  project?: Project,
): Promise<void> {
  const nodesById = Object.fromEntries(nodes.map(n => [n.id, n]))

  // Page dimensions (landscape A4-ish, in inches)
  const PAGE_W    = 16.54
  const PAGE_H    = 11.69
  const MARGIN    = 0.5
  const LINE_Y    = 3.5      // Y of the cable path line
  const NODE_W    = 1.2
  const NODE_H    = 0.45
  const USABLE_W  = PAGE_W - 2 * MARGIN - NODE_W

  // Build one page per circuit
  const pageXmls: string[] = []

  pinnedRoutes.forEach((pin, pi) => {
    const route   = pin.route
    const circuit = project?.circuits.find(c => c.circuit_id === pin.circuitId)
    const rv      = buildRouteView(route)
    const label   = escVml(pin.circuitLabel ?? pin.searchLabel ?? `Circuit ${pi + 1}`)

    let shapeId = 1
    const shapes: string[] = []

    const mkShape = (id: number, x: number, y: number, w: number, h: number,
      style: string, text: string, extras = '') =>
      `<Shape ID="${id}" Type="Shape" ${extras}>
        <Cell N="PinX" V="${(x + w / 2).toFixed(4)}"/>
        <Cell N="PinY" V="${(PAGE_H - y - h / 2).toFixed(4)}"/>
        <Cell N="Width" V="${w.toFixed(4)}"/>
        <Cell N="Height" V="${h.toFixed(4)}"/>
        ${style}
        <Text><cp IX="0"/>${escVml(text)}</Text>
      </Shape>`

    // Title banner
    shapes.push(mkShape(shapeId++, MARGIN, 0.2, PAGE_W - 2 * MARGIN, 0.4,
      `<Cell N="FillForegnd" V="RGB(0,154,176)"/>
       <Cell N="FillBkgnd" V="RGB(0,154,176)"/>
       <Cell N="LineColor" V="RGB(0,154,176)"/>
       <Cell N="CharColor" V="RGB(255,255,255)"/>
       <Cell N="CharSize" V="0.14"/>
       <Cell N="CharStyle" V="1"/>`,
      label))

    // Node X positions (in inches from left margin)
    interface VNode { x: number; nodeId: string }
    const positions: VNode[] = []
    positions.push({ x: MARGIN + NODE_W / 2, nodeId: route.nodes[0] })
    let cum = 0
    for (const seg of rv.segments) {
      cum += seg.length_km
      positions.push({
        x: MARGIN + NODE_W / 2 + (cum / rv.totalKm) * USABLE_W,
        nodeId: seg.end_node_id,
      })
    }

    // Cable path polyline
    shapes.push(
      `<Shape ID="${shapeId++}" Type="Shape">
        <Cell N="PinX" V="${((positions[0].x + positions[positions.length - 1].x) / 2).toFixed(4)}"/>
        <Cell N="PinY" V="${(PAGE_H - LINE_Y).toFixed(4)}"/>
        <Cell N="Width" V="${(positions[positions.length - 1].x - positions[0].x).toFixed(4)}"/>
        <Cell N="Height" V="0"/>
        <Cell N="LineColor" V="RGB(0,100,190)"/>
        <Cell N="LineWeight" V="0.03"/>
        <Geom IX="0">
          ${positions.map((p, i) => i === 0
            ? `<MoveTo IX="1"><Cell N="X" V="${p.x.toFixed(4)}"/><Cell N="Y" V="${(PAGE_H - LINE_Y).toFixed(4)}"/></MoveTo>`
            : `<LineTo IX="${i + 1}"><Cell N="X" V="${p.x.toFixed(4)}"/><Cell N="Y" V="${(PAGE_H - LINE_Y).toFixed(4)}"/></LineTo>`
          ).join('\n          ')}
        </Geom>
      </Shape>`)

    // Segment labels above the line
    rv.segments.forEach((seg, si) => {
      const x1  = positions[si].x
      const x2  = positions[si + 1].x
      const mid = (x1 + x2) / 2
      const w   = Math.max(x2 - x1 - 0.1, 0.6)
      const txt = `${seg.system_id}\n${(seg.length_km ?? 0).toLocaleString()} km · ${seg.latency ?? '?'} ms`
      shapes.push(mkShape(shapeId++, mid - w / 2, LINE_Y - 0.7, w, 0.55,
        `<Cell N="FillPattern" V="0"/>
         <Cell N="LinePattern" V="0"/>
         <Cell N="CharSize" V="0.09"/>
         <Cell N="CharColor" V="RGB(0,100,190)"/>
         <Cell N="VerticalAlign" V="1"/>`,
        txt))
    })

    // Node boxes
    positions.forEach((np, ni) => {
      const node    = nodesById[np.nodeId]
      const isEnd   = ni === 0 || ni === positions.length - 1
      const name    = node?.name ?? np.nodeId
      const country = node?.country ?? ''
      const fillR   = isEnd ? 'RGB(218,232,252)' : 'RGB(240,240,240)'
      const lineR   = isEnd ? 'RGB(108,142,191)' : 'RGB(150,150,150)'
      shapes.push(mkShape(shapeId++, np.x - NODE_W / 2, LINE_Y - NODE_H / 2, NODE_W, NODE_H,
        `<Cell N="FillForegnd" V="${fillR}"/>
         <Cell N="FillBkgnd" V="${fillR}"/>
         <Cell N="LineColor" V="${lineR}"/>
         <Cell N="LineWeight" V="${isEnd ? '0.02' : '0.01'}"/>
         <Cell N="CharSize" V="0.1"/>
         <Cell N="VerticalAlign" V="1"/>`,
        `${name}\n${country}`))
    })

    // A-end / Z-end info boxes
    const aEnd = circuit?.a_end
    const zEnd = circuit?.z_end
    const aNode = nodesById[route.nodes[0]]
    const zNode = nodesById[route.nodes[route.nodes.length - 1]]
    const aText = `A-End: ${aNode?.country ?? ''}\n${aEnd?.customer_site_name ?? aNode?.name ?? ''}\n${aEnd?.customer_site_address ?? ''}`
    const zText = `Z-End: ${zNode?.country ?? ''}\n${zEnd?.customer_site_name ?? zNode?.name ?? ''}\n${zEnd?.customer_site_address ?? ''}`
    shapes.push(mkShape(shapeId++, MARGIN, LINE_Y + 0.6, 2.0, 0.9,
      `<Cell N="FillPattern" V="0"/><Cell N="LinePattern" V="0"/><Cell N="CharSize" V="0.1"/>`, aText))
    shapes.push(mkShape(shapeId++, PAGE_W - MARGIN - 2.0, LINE_Y + 0.6, 2.0, 0.9,
      `<Cell N="FillPattern" V="0"/><Cell N="LinePattern" V="0"/><Cell N="CharSize" V="0.1"/>`, zText))

    // Service table
    const svcRows: [string, string][] = [
      ['SERVICE TYPE', circuit?.service_type ?? ''],
      ['BANDWIDTH',    circuit?.bandwidth ?? ''],
      ['PROTECTION',   circuit?.protection ?? ''],
    ]
    const tblX = PAGE_W / 2 - 1.5
    svcRows.forEach(([k, v], ri) => {
      shapes.push(mkShape(shapeId++, tblX, LINE_Y + 0.6 + ri * 0.28, 1.2, 0.26,
        `<Cell N="FillForegnd" V="RGB(0,154,176)"/><Cell N="FillBkgnd" V="RGB(0,154,176)"/>
         <Cell N="LineColor" V="RGB(0,154,176)"/><Cell N="CharColor" V="RGB(255,255,255)"/>
         <Cell N="CharSize" V="0.09"/><Cell N="CharStyle" V="1"/>`, k))
      shapes.push(mkShape(shapeId++, tblX + 1.2, LINE_Y + 0.6 + ri * 0.28, 1.8, 0.26,
        `<Cell N="FillForegnd" V="RGB(238,238,238)"/><Cell N="FillBkgnd" V="RGB(238,238,238)"/>
         <Cell N="LineColor" V="RGB(200,200,200)"/><Cell N="CharSize" V="0.09"/>`, v))
    })

    pageXmls.push(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<PageContents xmlns="http://schemas.microsoft.com/office/visio/2012/main"
              xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
              xml:space="preserve">
  <Shapes>
    ${shapes.join('\n    ')}
  </Shapes>
</PageContents>`)
  })

  // Assemble .vsdx ZIP
  const zip = new JSZip()

  zip.file('[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/visio/document.xml" ContentType="application/vnd.ms-visio.drawing.main+xml"/>
  ${pageXmls.map((_, i) => `<Override PartName="/visio/pages/page${i + 1}.xml" ContentType="application/vnd.ms-visio.page+xml"/>`).join('\n  ')}
  <Override PartName="/visio/pages/pages.xml" ContentType="application/vnd.ms-visio.pages+xml"/>
</Types>`)

  zip.file('_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/document" Target="visio/document.xml"/>
</Relationships>`)

  zip.file('visio/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<VisioDocument xmlns="http://schemas.microsoft.com/office/visio/2012/main"
               xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
               xml:space="preserve">
  <DocumentProperties>
    <Subject>Subsea Circuit SLD</Subject>
    <Creator>RouteBuilder</Creator>
  </DocumentProperties>
  <DocumentSheet/>
  <Pages r:id="rId1"/>
</VisioDocument>`)

  zip.file('visio/_rels/document.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/pages" Target="pages/pages.xml"/>
</Relationships>`)

  const pagesIndex = pageXmls.map((_, i) =>
    `<Page ID="${i}" NameU="Page-${i + 1}" Name="${escVml(pinnedRoutes[i]?.circuitLabel ?? pinnedRoutes[i]?.searchLabel ?? `Page ${i + 1}`)}" ViewScale="1" ViewCenterX="8.27" ViewCenterY="5.845">
      <PageSheet/>
      <PageProps>
        <Cell N="PageWidth" V="${PAGE_W}"/>
        <Cell N="PageHeight" V="${PAGE_H}"/>
        <Cell N="PageScale" V="1"/>
        <Cell N="DrawingScale" V="1"/>
        <Cell N="DrawingSizeType" V="0"/>
        <Cell N="DrawingScaleType" V="0"/>
        <Cell N="InhibitSnap" V="0"/>
        <Cell N="PageLockReplace" V="0" F="0"/>
        <Cell N="PageLockDuplicate" V="0" F="0"/>
        <Cell N="UIVisibility" V="0"/>
        <Cell N="ShdwType" V="0"/>
        <Cell N="ShdwOffsetX" V="0.1181102362204724"/>
        <Cell N="ShdwOffsetY" V="-0.1181102362204724"/>
        <Cell N="PageShapeSplit" V="1"/>
        <Cell N="PrintPageOrientation" V="2"/>
      </PageProps>
      <Rel r:id="rId${i + 1}"/>
    </Page>`).join('\n    ')

  zip.file('visio/pages/pages.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Pages xmlns="http://schemas.microsoft.com/office/visio/2012/main"
       xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
       xml:space="preserve">
    ${pagesIndex}
</Pages>`)

  zip.file('visio/pages/_rels/pages.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${pageXmls.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.microsoft.com/visio/2010/relationships/page" Target="page${i + 1}.xml"/>`).join('\n  ')}
</Relationships>`)

  pageXmls.forEach((xml, i) => {
    zip.file(`visio/pages/page${i + 1}.xml`, xml)
    zip.file(`visio/pages/_rels/page${i + 1}.xml.rels`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`)
  })

  const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.ms-visio.drawing' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `SLD-${new Date().toISOString().slice(0, 10)}.vsdx`
  a.click()
  URL.revokeObjectURL(url)
}
