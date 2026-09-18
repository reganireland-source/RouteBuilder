/**
 * SegmentInfoPanel — draggable floating detail card shown when a cable segment
 * is clicked on the map. The segment counterpart of NodeInfoPanel, and
 * deliberately built to the same shape: same title-bar drag handle, same
 * viewport clamping, same "⛶ Full View" button opening the matching Full View.
 *
 * WHY IT EXISTS. Segments previously had no click handler at all. Hovering one
 * showed a tooltip that vanished the moment the cursor moved, so there was no
 * way to read a cable's details and then act on them, and no way whatsoever to
 * see them on a touch screen, which has no hover. Clicking did produce one
 * visible effect — the browser's focus ring around the <path>, which for a
 * diagonal cable is a large rectangle spanning its bounding box. That stray box
 * was the only feedback a click gave, and it looked like a bug because it was
 * one.
 *
 * The content mirrors the hover tooltip exactly — same fields, same order — so
 * that pinning a tooltip feels like the tooltip staying put rather than a
 * different card appearing. It then adds what a tooltip cannot: the far-end
 * node names as separate rows, a capacity bar, and the route into Full View.
 *
 * Mounted from: App.tsx and MobileLayout.tsx when a map segment is selected.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type {
  CableNode, CableSegment, CableSystem, KmlPathInfo, NoteCategory, SegmentCapacity, SegmentOutage, SolutionNote,
} from '../types'
import { useTheme } from '../theme'
import { SegmentFullView } from './SegmentFullView'

interface Props {
  segment: CableSegment
  nodes: CableNode[]
  segments: CableSegment[]
  systems: CableSystem[]
  capacity: SegmentCapacity[]
  outages?: SegmentOutage[]
  kmlPaths?: Record<string, KmlPathInfo>
  notes?: SolutionNote[]
  noteCategories?: NoteCategory[]
  /** The map click position; the card is clamped into the viewport from here. */
  initialX: number
  initialY: number
  onClose: () => void
  onDataChange?: () => void
}

/** Same labels the map tooltip uses, so the two cannot drift. */
const OWNERSHIP_LABEL: Record<string, string> = {
  owned:                'Owned',
  consortium:           'Consortium',
  iru:                  'IRU',
  integrated_lit_lease: 'Int. Lit Lease',
  offnet_resell:        'Offnet Resell',
}

/** "SGCS1 — Singapore", or just the code when the name adds nothing. */
function codeAndName(code: string, name: string | undefined): string {
  if (!name || name === code) return code
  return `${code} — ${name}`
}

/** Red under 20% free, amber under 50%, green above. */
function capacityColor(pct: number, t: ReturnType<typeof useTheme>): string {
  if (pct < 20) return t.red
  if (pct < 50) return t.orange
  return t.green
}

export function SegmentInfoPanel({
  segment, nodes, segments, systems, capacity, outages, notes, noteCategories, kmlPaths,
  initialX, initialY, onClose, onDataChange,
}: Props) {
  const t = useTheme()
  const [fullView, setFullView] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [pos, setPos] = useState({ x: initialX + 15, y: initialY - 80 })
  const dragging = useRef(false)
  const dragOffset = useRef({ x: 0, y: 0 })

  // Measure then clamp fully inside the viewport before showing, so the card
  // never flashes half off-screen. Identical to NodeInfoPanel's approach.
  useLayoutEffect(() => {
    const el = panelRef.current
    if (!el) return
    const W = el.offsetWidth
    const H = el.offsetHeight
    const PAD = 12
    const vw = window.innerWidth
    const vh = window.innerHeight

    let x = initialX + 15
    if (x + W + PAD > vw) x = initialX - W - 15
    x = Math.max(PAD, Math.min(x, vw - W - PAD))

    let y = initialY - 80
    y = Math.max(PAD, Math.min(y, vh - H - PAD))

    setPos({ x, y })
    setVisible(true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!dragging.current) return
      setPos({ x: e.clientX - dragOffset.current.x, y: e.clientY - dragOffset.current.y })
    }
    function onMouseUp() { dragging.current = false }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [])

  const nodesById = Object.fromEntries(nodes.map(n => [n.id, n]))
  const start = nodesById[segment.start_node_id]
  const end   = nodesById[segment.end_node_id]
  const system = systems.find(s => s.id === segment.system_id)
  const cap = capacity.find(c => c.segment_id === segment.id)
  const capPct = cap && cap.total_capacity_t > 0
    ? Math.round((cap.available_capacity_t / cap.total_capacity_t) * 100)
    : null

  // Only CURRENT outages, matching the map's own rule — a planned event must
  // never make a segment read as down.
  const segOutages = (outages ?? []).filter(
    o => o.segment_id === segment.id && o.event_type !== 'planned_event',
  )

  const fields: [string, string | undefined][] = [
    ['ID',        segment.id],
    ['System',    codeAndName(segment.system_id, system?.name)],
    ['Type',      segment.type === 'wet' ? 'Wet (submarine)' : 'Terrestrial'],
    ['Ownership', OWNERSHIP_LABEL[segment.ownership] ?? segment.ownership],
    ['A-End',     codeAndName(segment.start_node_id, start?.name)],
    ['Z-End',     codeAndName(segment.end_node_id, end?.name)],
    ['Length',    `${segment.length_km.toLocaleString()} km`],
    ['Latency',   segment.latency != null ? `${segment.latency} ms` : undefined],
    ['Cost',      segment.cost_weight != null ? String(segment.cost_weight) : undefined],
    ['Waypoints', segment.waypoints?.length ? `${segment.waypoints.length} hand-placed` : undefined],
  ]

  return (
    <div ref={panelRef} style={{
      position: 'fixed', left: pos.x, top: pos.y, width: 380, zIndex: 1500,
      background: t.bgPanel, border: `1px solid ${t.border}`, borderRadius: 8,
      boxShadow: '0 8px 32px rgba(0,0,0,0.5)', overflow: 'hidden',
      fontFamily: 'system-ui, sans-serif',
      visibility: visible ? 'visible' : 'hidden',
    }}>
      {/* Title bar / drag handle */}
      <div
        style={{
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
          padding: '10px 12px 8px', background: t.bgDeep, borderBottom: `1px solid ${t.border}`,
          cursor: 'grab', userSelect: 'none',
        }}
        onMouseDown={e => {
          dragging.current = true
          dragOffset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y }
        }}
      >
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: t.text }}>{segment.name}</div>
          <div style={{ fontSize: 11, color: t.textFaint, marginTop: 2 }}>
            {[segment.system_id, segment.type, OWNERSHIP_LABEL[segment.ownership] ?? segment.ownership]
              .filter(Boolean).join(' · ')}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}
             onMouseDown={e => e.stopPropagation()}>
          <button
            onClick={onClose}
            title="Close"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: t.textFaint, fontSize: 18, lineHeight: 1, padding: '0 0 0 4px' }}
          >×</button>
        </div>
      </div>

      <div style={{ overflowY: 'auto', maxHeight: 'calc(100vh - 160px)' }}>
        <div style={{ padding: '10px 12px 0' }}>
          <button
            onClick={() => setFullView(true)}
            style={{
              width: '100%', padding: '8px 12px', borderRadius: 6, cursor: 'pointer',
              border: `1px solid ${t.blue}`, background: t.blue + '18', color: t.blue,
              fontSize: 12, fontWeight: 700, fontFamily: 'inherit', letterSpacing: '0.02em',
            }}
          >⛶ Full View</button>
        </div>

        {/* Outage banner — stated before the fields, because a downed cable
            changes how you read everything below it. */}
        {segOutages.length > 0 && (
          <div style={{ margin: '10px 12px 0', padding: '7px 9px', borderRadius: 6, background: t.red + '1a', border: `1px solid ${t.red}55` }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: t.red }}>
              {segOutages.length === 1 ? 'Active outage' : `${segOutages.length} active outages`}
            </div>
            {segOutages.map(o => (
              <div key={o.fault_id} style={{ fontSize: 11, color: t.textMuted, marginTop: 2 }}>
                {o.fault_id}{o.fault_date ? ` · ${o.fault_date}` : ''}
              </div>
            ))}
          </div>
        )}

        {/* Fields */}
        <div style={{ padding: '10px 12px', borderBottom: `1px solid ${t.border}` }}>
          {fields.filter(([, v]) => v).map(([label, value]) => (
            <div key={label} style={{ display: 'flex', gap: 8, padding: '3px 0', fontSize: 12 }}>
              <span style={{ width: 100, flexShrink: 0, color: t.textFaint, fontWeight: 600 }}>{label}</span>
              <span style={{ color: t.text, wordBreak: 'break-word' }}>{value}</span>
            </div>
          ))}
        </div>

        {/* Capacity — the one number the hover tooltip already showed, given a
            bar here because "23% available" reads very differently at a glance
            from "0.8T of 3.5T". */}
        <div style={{ padding: '10px 12px 14px' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: t.textFaint, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
            Capacity
          </div>
          {cap && capPct !== null ? (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                <span style={{ color: t.text }}>{cap.available_capacity_t}T of {cap.total_capacity_t}T available</span>
                <span style={{ color: capacityColor(capPct, t), fontWeight: 700 }}>{capPct}%</span>
              </div>
              <div style={{ height: 6, borderRadius: 3, background: t.border, overflow: 'hidden' }}>
                <div style={{
                  width: `${Math.max(0, Math.min(100, capPct))}%`, height: '100%',
                  background: capacityColor(capPct, t),
                }} />
              </div>
            </>
          ) : (
            <div style={{ fontSize: 12, color: t.textFaintest }}>No capacity record for this segment</div>
          )}
        </div>

        {fullView && (
          <SegmentFullView
            segmentId={segment.id}
            nodes={nodes}
            segments={segments}
            systems={systems}
            capacity={capacity}
            outages={outages}
            kmlPaths={kmlPaths}
            notes={notes}
            noteCategories={noteCategories}
            onClose={() => setFullView(false)}
            onDataChange={onDataChange}
          />
        )}
      </div>
    </div>
  )
}
