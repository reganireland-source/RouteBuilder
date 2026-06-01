import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CableNode, CableSegment, CableSystem, PortSpeed } from '../types'
import { useTheme } from '../theme'

const ALL_SPEEDS: PortSpeed[] = ['1G', '10G', '100G', '400G']

// Column layout constants — keep header and product rows in sync
const DOT_SIZE  = 13   // px — dot diameter
const COL_W     = 32   // px — column width for header + dot cells
const LABEL_W   = 50   // px — product label column width

// Maximum speeds each product type is capable of (defines N/A vs red)
const PRODUCT_MAX: Record<string, Set<PortSpeed>> = {
  ipt:   new Set(['1G', '10G', '100G', '400G']),
  epl:   new Set(['1G', '10G', '100G', '400G']),
  evpl:  new Set(['1G', '10G']),
  gid:   new Set(['1G', '10G', '100G', '400G']),
  ipvpn: new Set(['1G', '10G']),
}

const COLO_LABELS: Record<number, string> = {
  1: 'Productized Partners Resell',
  2: 'Productized Telstra Facilities',
  3: 'Leased Partner Facilities',
  4: 'Non-Productized Telstra Facilities / CLS',
  5: 'Non-Productized Partner Resell',
}

// Per-category visual style
const CAT_STYLE = {
  backbone:   { bg: 'rgba(59,130,246,0.15)',  border: 'rgba(59,130,246,0.4)',  text: '#60a5fa',  dot: '#3b82f6' },
  underlay:   { bg: 'rgba(139,92,246,0.15)',  border: 'rgba(139,92,246,0.4)',  text: '#a78bfa',  dot: '#8b5cf6' },
  colocation: { bg: 'rgba(251,191,36,0.15)',  border: 'rgba(251,191,36,0.4)',  text: '#fbbf24',  dot: '#f59e0b' },
}

type DotState = 'green' | 'red' | 'na'

function Dot({ state }: { state: DotState }) {
  if (state === 'na') {
    return (
      <div style={{ width: DOT_SIZE, height: DOT_SIZE, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <div style={{ width: 6, height: 2, borderRadius: 1, background: 'rgba(255,255,255,0.1)' }} />
      </div>
    )
  }
  const green = state === 'green'
  return (
    <div style={{
      width: DOT_SIZE, height: DOT_SIZE, borderRadius: '50%', flexShrink: 0,
      background: green ? '#16a34a' : '#3f0f0f',
      border: `1px solid ${green ? '#22c55e' : '#7f1d1d'}`,
      boxShadow: green ? '0 0 7px rgba(34,197,94,0.65)' : '0 0 4px rgba(239,68,68,0.25)',
    }} />
  )
}

function CategoryBadge({ label, active, category }: { label: string; active: boolean; category: 'backbone' | 'underlay' | 'colocation' }) {
  const s = CAT_STYLE[category]
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '3px 9px 3px 6px', borderRadius: 5, marginBottom: 7,
      background: s.bg, border: `1px solid ${s.border}`,
    }}>
      <div style={{
        width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
        background: active ? s.dot : '#3f0f0f',
        border: `1px solid ${active ? s.dot : '#7f1d1d'}`,
        boxShadow: active ? `0 0 5px ${s.dot}99` : '0 0 3px rgba(239,68,68,0.2)',
      }} />
      <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.09em', textTransform: 'uppercase', color: active ? s.text : '#6b7280' }}>{label}</span>
    </div>
  )
}

// Speed column header row — must use same LABEL_W + DOT_SIZE + DOT_GAP as rows below
function SpeedHeader() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
      <div style={{ width: LABEL_W, flexShrink: 0 }} />
      <div style={{ display: 'flex' }}>
        {ALL_SPEEDS.map(s => (
          <span key={s} style={{
            width: COL_W, textAlign: 'center', flexShrink: 0,
            fontSize: 10, fontWeight: 700, color: '#6b7280', letterSpacing: '0.02em',
          }}>{s}</span>
        ))}
      </div>
    </div>
  )
}

function ProductMatrixRow({ label, productKey, available }: { label: string; productKey: string; available?: PortSpeed[] }) {
  const maxSpeeds = PRODUCT_MAX[productKey]
  const availSet = new Set(available ?? [])
  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      <span style={{ width: LABEL_W, flexShrink: 0, fontSize: 11, fontWeight: 600, color: '#9ca3af' }}>{label}</span>
      <div style={{ display: 'flex' }}>
        {ALL_SPEEDS.map(speed => {
          const applicable = maxSpeeds.has(speed)
          const state: DotState = !applicable ? 'na' : availSet.has(speed) ? 'green' : 'red'
          return (
            <div key={speed} style={{ width: COL_W, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
              <Dot state={state} />
            </div>
          )
        })}
      </div>
    </div>
  )
}


const OWNER_LOGOS: Record<string, string> = {
  'Telstra':        '/logos/telstra.svg',
  'Equinix':        '/logos/equinix.svg',
  'PCCW':           '/logos/pccw.svg',
  'DRT':            '/logos/digitalrealty.svg',
  'Digital Realty': '/logos/digitalrealty.svg',
  'NTT':            '/logos/ntt.svg',
}

interface Props {
  node: CableNode
  segments: CableSegment[]
  systems: CableSystem[]
  initialX: number
  initialY: number
  onClose: () => void
}

export function NodeInfoPanel({ node, segments, systems, initialX, initialY, onClose }: Props) {
  const t = useTheme()
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

    // Prefer right of cursor; flip left if it would overflow the right edge
    let x = initialX + 15
    if (x + W + PAD > vw) x = initialX - W - 15
    x = Math.max(PAD, Math.min(x, vw - W - PAD))

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
    : node.type

  const delta = 0.01
  const bbox = `${node.lng - delta},${node.lat - delta},${node.lng + delta},${node.lat + delta}`
  const mapUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${node.lat},${node.lng}`

  const fields: [string, string | undefined][] = [
    ['ID',           node.id],
    ['Type',         typeLabel],
    ['Country',      node.country],
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
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: t.textFaint, fontSize: 18, lineHeight: 1, padding: '0 0 0 4px' }}
          >×</button>
        </div>
      </div>

      <div style={{ overflowY: 'auto', maxHeight: 'calc(100vh - 160px)' }}>
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

        {/* Product Coverage — traffic light matrix */}
        {node.capabilities && (() => {
          const cap = node.capabilities
          const bb = cap.backbone
          const ul = cap.underlay
          const co = cap.colocation
          const backboneActive = !!(bb?.ipt?.length || bb?.epl?.length || bb?.evpl?.length)
          const underlayActive = !!(ul?.gid?.length || ul?.ipvpn?.length)
          const coloActive     = !!co
          return (
            <div style={{ padding: '10px 12px 14px', borderBottom: `1px solid ${t.border}` }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: t.textFaint, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>
                Product Coverage
              </div>

              {/* BACKBONE */}
              <div style={{ marginBottom: 10 }}>
                <CategoryBadge label="Backbone" active={backboneActive} category="backbone" />
                <SpeedHeader />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <ProductMatrixRow label="IPT"  productKey="ipt"  available={bb?.ipt  as PortSpeed[]} />
                  <ProductMatrixRow label="EPL"  productKey="epl"  available={bb?.epl  as PortSpeed[]} />
                  <ProductMatrixRow label="EVPL" productKey="evpl" available={bb?.evpl as PortSpeed[]} />
                </div>
              </div>

              {/* UNDERLAY */}
              <div style={{ marginBottom: 10 }}>
                <CategoryBadge label="Underlay" active={underlayActive} category="underlay" />
                <SpeedHeader />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <ProductMatrixRow label="GID"    productKey="gid"   available={ul?.gid   as PortSpeed[]} />
                  <ProductMatrixRow label="IP VPN" productKey="ipvpn" available={ul?.ipvpn as PortSpeed[]} />
                </div>
              </div>

              {/* COLOCATION */}
              <div>
                <CategoryBadge label="Colocation" active={coloActive} category="colocation" />
                {coloActive ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 2 }}>
                    <span style={{
                      fontSize: 10, fontWeight: 800, padding: '3px 8px', borderRadius: 4, flexShrink: 0,
                      background: CAT_STYLE.colocation.bg, color: CAT_STYLE.colocation.text,
                      border: `1px solid ${CAT_STYLE.colocation.border}`, letterSpacing: '0.04em',
                    }}>Cat {co!.category}</span>
                    <span style={{ fontSize: 11, color: t.textMuted, lineHeight: 1.3 }}>
                      {COLO_LABELS[co!.category]}
                    </span>
                  </div>
                ) : (
                  <span style={{ fontSize: 10, color: '#4b5563', fontStyle: 'italic' }}>Not configured</span>
                )}
              </div>
            </div>
          )
        })()}

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
