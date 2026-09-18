/**
 * ProductCoverageMatrix.tsx — the read-only traffic-light view of one node's
 * product coverage.
 *
 * Extracted verbatim from NodeInfoPanel, which used to own it privately, so
 * that the node Full View can show the same matrix without a second copy
 * drifting out of step with it. Both now render this.
 *
 * How to read it: one row per product, one column per port speed.
 *   green dot  — the node offers that product at that speed
 *   red dot    — the product exists at that speed, but not here
 *   grey dash  — the product does not come in that speed at all
 * EVPL and IP VPN top out at 10G (see PRODUCT_MAX), so their 100G and 400G
 * cells are always dashes — that is correct, not missing data.
 *
 * Colocation is not a speed matrix: it is a single category 1-5, shown as a
 * chip plus the category's plain-English meaning.
 *
 * The editable counterpart is ProductCoveragePanel.tsx (Reference Data →
 * Coverage), which writes `capabilities` back via api.updateNode.
 *
 * Mounted from: NodeInfoPanel.tsx (the floating node card) and
 * NodeFullView.tsx (the node Full View modal).
 */
import type { NodeCapabilities, PortSpeed } from '../types'
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

export const COLO_LABELS: Record<number, string> = {
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

/** na = the product doesn't come in this speed; green = offered here; red = it
 *  exists at this speed but this node doesn't have it. */
function dotState(applicable: boolean, offered: boolean): DotState {
  if (!applicable) return 'na'
  return offered ? 'green' : 'red'
}

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

// Speed column header row — must use same LABEL_W + DOT_SIZE + COL_W as rows below
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
          const state: DotState = dotState(applicable, availSet.has(speed))
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

interface Props {
  capabilities: NodeCapabilities
  /** Section heading; pass null to render the matrix bare inside your own panel. */
  heading?: string | null
}

export function ProductCoverageMatrix({ capabilities, heading = 'Product Coverage' }: Props) {
  const t = useTheme()
  const bb = capabilities.backbone
  const ul = capabilities.underlay
  const co = capabilities.colocation
  const backboneActive = !!(bb?.ipt?.length || bb?.epl?.length || bb?.evpl?.length)
  const underlayActive = !!(ul?.gid?.length || ul?.ipvpn?.length)
  const coloActive     = !!co

  return (
    <div>
      {heading && (
        <div style={{ fontSize: 10, fontWeight: 700, color: t.textFaint, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>
          {heading}
        </div>
      )}

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
              {/* An out-of-range category (the backend does not constrain it to
                  1-5) would otherwise render as blank text next to the chip. */}
              {COLO_LABELS[co!.category] ?? 'Unrecognised category'}
            </span>
          </div>
        ) : (
          <span style={{ fontSize: 10, color: '#4b5563', fontStyle: 'italic' }}>Not configured</span>
        )}
      </div>
    </div>
  )
}
