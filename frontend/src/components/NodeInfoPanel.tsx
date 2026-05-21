import { useEffect, useRef, useState } from 'react'
import type { CableNode, CableSegment, CableSystem } from '../types'
import { useTheme } from '../theme'

const OWNER_LOGOS: Record<string, string> = {
  'Telstra':        'https://logo.clearbit.com/telstra.com',
  'Equinix':        'https://logo.clearbit.com/equinix.com',
  'PCCW':           'https://logo.clearbit.com/pccw.com',
  'DRT':            'https://logo.clearbit.com/digitalrealty.com',
  'Digital Realty': 'https://logo.clearbit.com/digitalrealty.com',
  'NTT':            'https://logo.clearbit.com/ntt.com',
  'Zayo':           'https://logo.clearbit.com/zayo.com',
  'Lumen':          'https://logo.clearbit.com/lumen.com',
  'Verizon':        'https://logo.clearbit.com/verizon.com',
  'AT&T':           'https://logo.clearbit.com/att.com',
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
  const [logoFailed, setLogoFailed] = useState(false)

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
          {logoUrl && !logoFailed && (
            <div style={{ background: '#fff', borderRadius: 5, padding: '3px 7px', display: 'flex', alignItems: 'center', height: 30 }}>
              <img
                src={logoUrl}
                alt={node.owner}
                onError={() => setLogoFailed(true)}
                style={{ height: 20, maxWidth: 68, objectFit: 'contain' }}
              />
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
