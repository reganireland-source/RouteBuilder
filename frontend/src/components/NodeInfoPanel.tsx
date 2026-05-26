import { useEffect, useRef, useState } from 'react'
import type { CableNode, CableSegment, CableSystem, PortSpeed } from '../types'
import { useTheme } from '../theme'

const ALL_SPEEDS: PortSpeed[] = ['1G', '10G', '100G', '400G']

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

type DotState = 'green' | 'red' | 'na'

function Dot({ state }: { state: DotState }) {
  if (state === 'na') {
    return (
      <div style={{ width: 11, height: 11, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 5, height: 1.5, borderRadius: 1, background: 'rgba(255,255,255,0.08)' }} />
      </div>
    )
  }
  const green = state === 'green'
  return (
    <div style={{
      width: 11, height: 11, borderRadius: '50%', flexShrink: 0,
      background: green ? '#16a34a' : '#3f0f0f',
      border: `1px solid ${green ? '#22c55e' : '#7f1d1d'}`,
      boxShadow: green ? '0 0 6px rgba(34,197,94,0.6)' : '0 0 4px rgba(239,68,68,0.25)',
    }} />
  )
}

function CategoryIndicator({ active }: { active: boolean }) {
  return (
    <div style={{
      width: 7, height: 7, borderRadius: '50%', flexShrink: 0, marginTop: 1,
      background: active ? '#16a34a' : '#3f0f0f',
      border: `1px solid ${active ? '#22c55e' : '#7f1d1d'}`,
      boxShadow: active ? '0 0 5px rgba(34,197,94,0.7)' : '0 0 3px rgba(239,68,68,0.2)',
    }} />
  )
}

function ProductMatrixRow({ label, productKey, available }: { label: string; productKey: string; available?: PortSpeed[] }) {
  const maxSpeeds = PRODUCT_MAX[productKey]
  const availSet = new Set(available ?? [])
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
      <span style={{ width: 52, flexShrink: 0, fontSize: 10, fontWeight: 600, color: '#6b7280' }}>{label}</span>
      <div style={{ display: 'flex', gap: 10 }}>
        {ALL_SPEEDS.map(speed => {
          const applicable = maxSpeeds.has(speed)
          const state: DotState = !applicable ? 'na' : availSet.has(speed) ? 'green' : 'red'
          return <Dot key={speed} state={state} />
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
  const [pos, setPos] = useState({
    x: Math.min(initialX + 15, window.innerWidth - 395),
    y: Math.max(initialY - 80, 10),
  })
  const dragging = useRef(false)
  const dragOffset = useRef({ x: 0, y: 0 })

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
    : 'POP (Terrestrial)'

  const delta = 0.01
  const bbox = `${node.lng - delta},${node.lat - delta},${node.lng + delta},${node.lat + delta}`
  const mapUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${node.lat},${node.lng}`

  const fields: [string, string | undefined][] = [
    ['ID',           node.id],
    ['Type',         typeLabel],
    ['Country',      node.country],
    ['Lat / Lng',    `${node.lat}, ${node.lng}`],
    ['Owner',        node.owner],
    ['Trading Name', node.trading_name],
    ['Description',  node.description],
  ]

  return (
    <div style={{
      position: 'fixed', left: pos.x, top: pos.y, width: 380, zIndex: 1500,
      background: t.bgPanel, border: `1px solid ${t.border}`, borderRadius: 8,
      boxShadow: '0 8px 32px rgba(0,0,0,0.5)', overflow: 'hidden',
      fontFamily: 'system-ui, sans-serif',
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
            <div style={{ padding: '10px 12px', borderBottom: `1px solid ${t.border}` }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: t.textFaint, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
                Product Coverage
              </div>

              {/* Speed column headers */}
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6, paddingLeft: 29 }}>
                <div style={{ width: 52, flexShrink: 0 }} />
                <div style={{ display: 'flex', gap: 10 }}>
                  {ALL_SPEEDS.map(s => (
                    <span key={s} style={{ width: 11, fontSize: 7.5, fontWeight: 700, color: '#4b5563', textAlign: 'center', letterSpacing: '0.02em' }}>{s}</span>
                  ))}
                </div>
              </div>

              {/* BACKBONE */}
              <div style={{ marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <CategoryIndicator active={backboneActive} />
                  <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: backboneActive ? '#22c55e' : '#4b5563' }}>Backbone</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingLeft: 13 }}>
                  <ProductMatrixRow label="IPT"  productKey="ipt"  available={bb?.ipt  as PortSpeed[]} />
                  <ProductMatrixRow label="EPL"  productKey="epl"  available={bb?.epl  as PortSpeed[]} />
                  <ProductMatrixRow label="EVPL" productKey="evpl" available={bb?.evpl as PortSpeed[]} />
                </div>
              </div>

              {/* UNDERLAY */}
              <div style={{ marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <CategoryIndicator active={underlayActive} />
                  <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: underlayActive ? '#22c55e' : '#4b5563' }}>Underlay</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingLeft: 13 }}>
                  <ProductMatrixRow label="GID"    productKey="gid"   available={ul?.gid   as PortSpeed[]} />
                  <ProductMatrixRow label="IP VPN" productKey="ipvpn" available={ul?.ipvpn as PortSpeed[]} />
                </div>
              </div>

              {/* COLOCATION */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <CategoryIndicator active={coloActive} />
                  <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: coloActive ? '#22c55e' : '#4b5563' }}>Colocation</span>
                </div>
                <div style={{ paddingLeft: 13 }}>
                  {coloActive ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <span style={{
                        fontSize: 9, fontWeight: 800, padding: '2px 6px', borderRadius: 3, flexShrink: 0,
                        background: 'rgba(34,197,94,0.1)', color: '#22c55e',
                        border: '1px solid rgba(34,197,94,0.25)', letterSpacing: '0.04em',
                      }}>Cat {co!.category}</span>
                      <span style={{ fontSize: 10, color: t.textMuted, lineHeight: 1.3 }}>
                        {COLO_LABELS[co!.category]}
                      </span>
                    </div>
                  ) : (
                    <span style={{ fontSize: 10, color: '#4b5563', fontStyle: 'italic' }}>Not configured</span>
                  )}
                </div>
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
