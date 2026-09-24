/**
 * NodeInfoPanel — draggable floating detail card shown when a node is clicked on the map.
 *
 * Displays everything known about one CableNode: identity fields (ID, type, country,
 * city, coordinates, owner, trading name, street address, description), the owner's
 * logo when we have one in the local OWNER_LOGOS table, the cable systems that touch
 * the node (with per-system segment counts derived from the segments prop), an optional
 * "Product Coverage" traffic-light matrix (Backbone IPT/EPL/EVPL, Underlay GID/IP VPN
 * across 1G-400G port speeds, plus the Colocation category 1-5) driven by
 * node.capabilities, and an embedded OpenStreetMap iframe centred on the node.
 * Node types include CLS (Cable Landing Station), PoP tiers, branching units and
 * off-net nodes.
 *
 * The "⛶ Full View" button opens NodeFullView — the same information laid out on a
 * page of its own, plus the segment fan-out diagram, per-segment capacity, solution
 * notes, and (for admins) in-place editing. The coverage matrix and the owner-logo
 * table are shared modules so this card and Full View cannot disagree.
 *
 * Props:
 *   - node, segments, systems: the node to describe plus full datasets for cross-refs.
 *   - nodes, capacity:         passed straight through to Full View, which needs them to
 *                              name/navigate segment far ends and show per-segment capacity.
 *   - notes, noteCategories:   optional pre-fetched solution notes for Full View.
 *   - initialX / initialY:     the map click position; a useLayoutEffect measures the
 *                              panel and clamps it inside the viewport before making it
 *                              visible (flips left of the cursor if it would overflow).
 *   - onClose:                 close (×) handler.
 *   - onDataChange:            refetch hook, called after an admin edit in Full View.
 * The title bar is a drag handle — global mousemove/mouseup listeners let the user
 * reposition the panel anywhere on screen.
 *
 * Mounted from: App.tsx and MobileLayout.tsx when a map node is selected.
 * Backend endpoints: none of ours; only the openstreetmap.org embed iframe.
 * Note: CountryNodeDiagram.tsx has its own unrelated local component of the same name.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CableNode, CableSegment, CableSystem, SegmentCapacity, SolutionNote, NoteCategory } from '../types'
import { useTheme } from '../theme'
import { OWNER_LOGOS } from '../utils/ownerLogos'
import { ProductCoverageMatrix } from './ProductCoverageMatrix'
import { NodeFullView } from './NodeFullView'


interface Props {
  node: CableNode
  segments: CableSegment[]
  systems: CableSystem[]
  /** Every node — needed so Full View can name and navigate to the far end of
   *  each segment. */
  nodes: CableNode[]
  capacity: SegmentCapacity[]
  /** Pre-fetched notes, if the parent already has them; Full View fetches its
   *  own when these are omitted. */
  notes?: SolutionNote[]
  noteCategories?: NoteCategory[]
  initialX: number
  initialY: number
  onClose: () => void
  /** Called after an admin edit in Full View writes to the backend, so the app
   *  refetches and this card re-renders with the new values. */
  onDataChange?: () => void
}

export function NodeInfoPanel({
  node, segments, systems, nodes, capacity, notes, noteCategories,
  initialX, initialY, onClose, onDataChange,
}: Props) {
  const t = useTheme()
  const [fullView, setFullView] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [pos, setPos] = useState({ x: initialX + 15, y: initialY - 80 })
  const dragging = useRef(false)
  const dragOffset = useRef({ x: 0, y: 0 })

  // After first render, measure the panel and clamp it fully within the viewport.
  // Panel stays hidden (visibility: hidden) until this runs to avoid a visible jump.
  useLayoutEffect(() => {
    const el = panelRef.current
    if (!el) return
    const W   = el.offsetWidth
    const H   = el.offsetHeight
    const PAD = 12
    const vw  = window.innerWidth
    const vh  = window.innerHeight

    // MARGIN, not just a gap: (initialX, initialY) is the node's own screen
    // position (a real map click, or Asset Search's fly-to target — see
    // handleGoToNode), and the panel is placed entirely to one side of it so
    // its own marker/pulse/label never end up under the card regardless of
    // how tall the card's content is. A plain vertical clamp to the viewport
    // (no horizontal separation guarantee) is what used to let a tall card
    // slide right back down over the node it describes.
    const MARGIN = 24
    let x: number
    if (initialX + MARGIN + W + PAD <= vw) {
      x = initialX + MARGIN // prefer right of the node
    } else if (initialX - MARGIN - W >= PAD) {
      x = initialX - MARGIN - W // else left of the node
    } else {
      // Neither side fully fits (a very narrow window) — pick whichever
      // side has more room, but still keep the margin so the card can never
      // slide back on top of the node itself.
      const roomRight = vw - initialX
      const roomLeft  = initialX
      x = roomRight >= roomLeft
        ? Math.min(initialX + MARGIN, vw - W - PAD)
        : Math.max(initialX - MARGIN - W, PAD)
    }

    // Prefer slightly above cursor; push up if it overflows the bottom
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

  const nodeSegments = segments.filter(s => s.start_node_id === node.id || s.end_node_id === node.id)
  const systemCounts = new Map<string, number>()
  for (const seg of nodeSegments) {
    systemCounts.set(seg.system_id, (systemCounts.get(seg.system_id) ?? 0) + 1)
  }
  const systemsById = Object.fromEntries(systems.map(s => [s.id, s]))

  const logoUrl = node.owner ? OWNER_LOGOS[node.owner] : undefined

  const typeLabel = node.type === 'landing_station' ? 'CLS (Landing Station)'
    : node.type === 'branching_unit' ? 'BU (Branching Unit)'
    : node.type === 'primary_pop' ? 'Primary PoP'
    : node.type === 'secondary_pop' ? 'Secondary PoP'
    : node.type === 'extension_pop' ? 'Extension PoP'
    : node.type === 'off_net' ? 'Off-Net Node'
    : node.type

  const delta = 0.01
  const bbox = `${node.lng - delta},${node.lat - delta},${node.lng + delta},${node.lat + delta}`
  const mapUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${node.lat},${node.lng}`

  const fields: [string, string | undefined][] = [
    ['ID',           node.id],
    ['Type',         typeLabel],
    ['Country',      node.country],
    ['City',         node.city],
    ['Lat / Lng',    `${node.lat}, ${node.lng}`],
    ['Owner',          node.owner],
    ['Trading Name',   node.trading_name],
    ['Street Address', node.street_address],
    ['Description',    node.description],
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
          <div style={{ fontSize: 13, fontWeight: 700, color: t.text }}>Node {node.name}</div>
          {(node.owner || node.trading_name) && (
            <div style={{ fontSize: 11, color: t.textFaint, marginTop: 2 }}>
              {[node.owner, node.trading_name].filter(Boolean).join(' · ')}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}
             onMouseDown={e => e.stopPropagation()}>
          {logoUrl && (
            <div style={{ background: '#fff', borderRadius: 5, padding: '3px 7px', display: 'flex', alignItems: 'center', height: 30 }}>
              <img src={logoUrl} alt={node.owner} style={{ height: 20, maxWidth: 72, objectFit: 'contain' }} />
            </div>
          )}
          <button
            onClick={onClose}
            title="Close"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: t.textFaint, fontSize: 18, lineHeight: 1, padding: '0 0 0 4px' }}
          >×</button>
        </div>
      </div>

      <div style={{ overflowY: 'auto', maxHeight: 'calc(100vh - 160px)' }}>
        {/* Full View — everything this card shows plus the segment fan-out,
            solution notes, per-segment capacity, and (for admins) editing. */}
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

        {/* Fields */}
        <div style={{ padding: '10px 12px', borderBottom: `1px solid ${t.border}` }}>
          {fields.filter(([, v]) => v).map(([label, value]) => (
            <div key={label} style={{ display: 'flex', gap: 8, padding: '3px 0', fontSize: 12 }}>
              <span style={{ width: 100, flexShrink: 0, color: t.textFaint, fontWeight: 600 }}>{label}</span>
              <span style={{ color: t.text, wordBreak: 'break-word' }}>{value}</span>
            </div>
          ))}
        </div>

        {/* Cable systems */}
        <div style={{ padding: '10px 12px', borderBottom: `1px solid ${t.border}` }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: t.textFaint, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
            Cable Systems ({systemCounts.size})
          </div>
          {systemCounts.size === 0 ? (
            <div style={{ fontSize: 12, color: t.textFaintest }}>No systems at this node</div>
          ) : (
            Array.from(systemCounts.entries()).map(([sysId, count]) => (
              <div key={sysId} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 12 }}>
                <span style={{ color: t.text }}>{systemsById[sysId]?.name ?? sysId}</span>
                <span style={{ color: t.textFaint }}>{count} segment{count !== 1 ? 's' : ''}</span>
              </div>
            ))
          )}
        </div>

        {/* Product Coverage — the same matrix the Full View shows, so the two
            can never disagree (ProductCoverageMatrix.tsx). */}
        {node.capabilities && (
          <div style={{ padding: '10px 12px 14px', borderBottom: `1px solid ${t.border}` }}>
            <ProductCoverageMatrix capabilities={node.capabilities} />
          </div>
        )}

        {fullView && (
          <NodeFullView
            nodeId={node.id}
            nodes={nodes}
            segments={segments}
            systems={systems}
            capacity={capacity}
            notes={notes}
            noteCategories={noteCategories}
            onClose={() => setFullView(false)}
            onDataChange={onDataChange}
          />
        )}

        {/* Map tile */}
        <iframe
          src={mapUrl}
          style={{ width: '100%', height: 250, border: 'none', display: 'block' }}
          title={`Map of ${node.name}`}
        />
      </div>
    </div>
  )
}
