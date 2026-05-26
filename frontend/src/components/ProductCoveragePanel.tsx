import { useState } from 'react'
import type { CableNode, NodeCapabilities, PortSpeed } from '../types'
import { useTheme } from '../theme'
import { api } from '../api/client'

const ALL_SPEEDS: PortSpeed[] = ['1G', '10G', '100G', '400G']

const PRODUCT_MAX: Record<string, Set<PortSpeed>> = {
  ipt:   new Set(['1G', '10G', '100G', '400G']),
  epl:   new Set(['1G', '10G', '100G', '400G']),
  evpl:  new Set(['1G', '10G']),
  gid:   new Set(['1G', '10G', '100G', '400G']),
  ipvpn: new Set(['1G', '10G']),
}

const COLO_LABELS: Record<number, string> = {
  1: 'Cat 1 — Productized Partners Resell',
  2: 'Cat 2 — Productized Telstra Facilities',
  3: 'Cat 3 — Leased Partner Facilities',
  4: 'Cat 4 — Non-Productized Telstra / CLS',
  5: 'Cat 5 — Non-Productized Partner Resell',
}

type ProductKey = 'ipt' | 'epl' | 'evpl' | 'gid' | 'ipvpn'

interface DraftCaps {
  ipt:   Set<PortSpeed>
  epl:   Set<PortSpeed>
  evpl:  Set<PortSpeed>
  gid:   Set<PortSpeed>
  ipvpn: Set<PortSpeed>
  coloCategory: number | null
}

function capsToDraft(caps?: NodeCapabilities): DraftCaps {
  return {
    ipt:          new Set((caps?.backbone?.ipt   ?? []) as PortSpeed[]),
    epl:          new Set((caps?.backbone?.epl   ?? []) as PortSpeed[]),
    evpl:         new Set((caps?.backbone?.evpl  ?? []) as PortSpeed[]),
    gid:          new Set((caps?.underlay?.gid   ?? []) as PortSpeed[]),
    ipvpn:        new Set((caps?.underlay?.ipvpn ?? []) as PortSpeed[]),
    coloCategory: caps?.colocation?.category ?? null,
  }
}

function draftToCaps(d: DraftCaps): NodeCapabilities {
  const bb: NodeCapabilities['backbone'] = {}
  if (d.ipt.size)   bb.ipt   = ALL_SPEEDS.filter(s => d.ipt.has(s))
  if (d.epl.size)   bb.epl   = ALL_SPEEDS.filter(s => d.epl.has(s))
  if (d.evpl.size)  bb.evpl  = ALL_SPEEDS.filter(s => d.evpl.has(s))

  const ul: NodeCapabilities['underlay'] = {}
  if (d.gid.size)   ul.gid   = ALL_SPEEDS.filter(s => d.gid.has(s))
  if (d.ipvpn.size) ul.ipvpn = ALL_SPEEDS.filter(s => d.ipvpn.has(s))

  return {
    backbone:   Object.keys(bb).length ? bb : undefined,
    underlay:   Object.keys(ul).length ? ul : undefined,
    colocation: d.coloCategory ? { category: d.coloCategory as 1|2|3|4|5 } : undefined,
  }
}

function quickDots(caps?: NodeCapabilities) {
  const backboneActive = !!(caps?.backbone?.ipt?.length || caps?.backbone?.epl?.length || caps?.backbone?.evpl?.length)
  const underlayActive = !!(caps?.underlay?.gid?.length || caps?.underlay?.ipvpn?.length)
  const coloActive     = !!caps?.colocation
  return { backboneActive, underlayActive, coloActive }
}

interface Props {
  nodes: CableNode[]
  onDataChange: () => void
}

export function ProductCoveragePanel({ nodes, onDataChange }: Props) {
  const t = useTheme()
  const [filter, setFilter] = useState('')
  const [editId, setEditId] = useState<string | null>(null)
  const [draft, setDraft] = useState<DraftCaps | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const eligibleNodes = nodes
    .filter(n => n.type !== 'branching_unit')
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === 'landing_station' ? -1 : 1
      return a.id.localeCompare(b.id)
    })

  const filtered = filter.trim()
    ? eligibleNodes.filter(n =>
        n.id.toLowerCase().includes(filter.toLowerCase()) ||
        n.name.toLowerCase().includes(filter.toLowerCase()) ||
        (n.owner ?? '').toLowerCase().includes(filter.toLowerCase())
      )
    : eligibleNodes

  function openEdit(node: CableNode) {
    setEditId(node.id)
    setDraft(capsToDraft(node.capabilities))
    setError(null)
  }

  function closeEdit() { setEditId(null); setDraft(null); setError(null) }

  function toggleSpeed(productKey: ProductKey, speed: PortSpeed) {
    if (!draft) return
    const next = new Set(draft[productKey])
    if (next.has(speed)) next.delete(speed)
    else next.add(speed)
    setDraft({ ...draft, [productKey]: next })
  }

  function setColo(cat: number | null) {
    if (!draft) return
    setDraft({ ...draft, coloCategory: cat })
  }

  async function save(nodeId: string) {
    if (!draft) return
    setSaving(true); setError(null)
    try {
      await api.updateNode(nodeId, { capabilities: draftToCaps(draft) })
      onDataChange()
      closeEdit()
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }

  // ── Styles ───────────────────────────────────────────────────────────────────

  const speedChip = (active: boolean, applicable: boolean): React.CSSProperties => ({
    width: 34, padding: '3px 0', textAlign: 'center',
    fontSize: 9, fontWeight: 700, borderRadius: 3, cursor: applicable ? 'pointer' : 'default',
    letterSpacing: '0.04em',
    background: !applicable ? 'transparent'
      : active ? 'rgba(34,197,94,0.18)' : 'rgba(239,68,68,0.1)',
    color: !applicable ? '#1f2937'
      : active ? '#22c55e' : '#ef4444',
    border: !applicable ? 'none'
      : active ? '1px solid rgba(34,197,94,0.4)' : '1px solid rgba(239,68,68,0.25)',
    userSelect: 'none',
  })

  const catBtn = (selected: boolean): React.CSSProperties => ({
    fontSize: 10, fontWeight: 700, padding: '4px 10px', borderRadius: 4, cursor: 'pointer',
    background: selected ? 'rgba(34,197,94,0.15)' : t.bgDeep,
    color: selected ? '#22c55e' : t.textFaint,
    border: selected ? '1px solid rgba(34,197,94,0.35)' : `1px solid ${t.border}`,
    whiteSpace: 'nowrap',
  })

  const Dot = ({ active }: { active: boolean }) => (
    <div style={{
      width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
      background: active ? '#16a34a' : '#3f0f0f',
      border: `1px solid ${active ? '#22c55e' : '#7f1d1d'}`,
      boxShadow: active ? '0 0 4px rgba(34,197,94,0.55)' : 'none',
    }} />
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Filter */}
      <div style={{ padding: '10px 14px', borderBottom: `1px solid ${t.border}`, flexShrink: 0 }}>
        <input
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="Filter by node ID, name or owner…"
          style={{
            width: '100%', padding: '6px 10px', borderRadius: 4, boxSizing: 'border-box',
            border: `1px solid ${t.border}`, background: t.bgInput,
            color: t.text, fontSize: 12, outline: 'none', fontFamily: 'inherit',
          }}
        />
        <div style={{ fontSize: 10, color: t.textFaintest, marginTop: 6 }}>
          {filtered.length} nodes · {eligibleNodes.filter(n => n.capabilities).length} with coverage configured
        </div>
      </div>

      {/* Column headers */}
      <div style={{
        display: 'flex', alignItems: 'center', padding: '5px 14px',
        borderBottom: `1px solid ${t.border}`, background: t.bgDeep, flexShrink: 0,
      }}>
        <span style={{ width: 70, fontSize: 10, fontWeight: 700, color: t.textFaint, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Code</span>
        <span style={{ flex: 1, fontSize: 10, fontWeight: 700, color: t.textFaint, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Name</span>
        <span style={{ width: 80, fontSize: 10, fontWeight: 700, color: t.textFaint, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Owner</span>
        <span style={{ width: 90, fontSize: 10, fontWeight: 700, color: t.textFaint, textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'center' }}>Coverage</span>
        <span style={{ width: 48 }} />
      </div>

      {/* Node list */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {filtered.map(node => {
          const isEditing = editId === node.id
          const dots = quickDots(node.capabilities)
          const typeLabel = node.type === 'landing_station' ? 'CLS' : 'POP'

          return (
            <div key={node.id} style={{ borderBottom: `1px solid ${t.border}` }}>
              {/* Summary row */}
              <div style={{
                display: 'flex', alignItems: 'center', padding: '7px 14px', minHeight: 38,
                background: isEditing ? t.bgDeep : 'transparent',
              }}>
                <span style={{ width: 70, fontFamily: 'monospace', fontSize: 11, fontWeight: 700, color: t.blue, flexShrink: 0 }}>{node.id}</span>
                <span style={{ flex: 1, fontSize: 12, color: t.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {node.name}
                  <span style={{
                    marginLeft: 7, fontSize: 9, fontWeight: 700, padding: '1px 4px', borderRadius: 2,
                    background: t.bgDeep, color: t.textFaint, letterSpacing: '0.04em',
                  }}>{typeLabel}</span>
                </span>
                <span style={{ width: 80, fontSize: 11, color: t.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0 }}>{node.owner ?? '—'}</span>
                <div style={{ width: 90, display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  {node.capabilities ? (
                    <>
                      <Dot active={dots.backboneActive} />
                      <Dot active={dots.underlayActive} />
                      <Dot active={dots.coloActive} />
                    </>
                  ) : (
                    <span style={{ fontSize: 9, color: t.textFaintest, fontStyle: 'italic' }}>not set</span>
                  )}
                </div>
                <button
                  onClick={() => isEditing ? closeEdit() : openEdit(node)}
                  style={{
                    width: 48, fontSize: 10, fontWeight: 700, padding: '3px 0', borderRadius: 3,
                    border: `1px solid ${isEditing ? t.border : t.blue}`,
                    background: 'transparent', color: isEditing ? t.textFaint : t.blue,
                    cursor: 'pointer', flexShrink: 0,
                  }}
                >{isEditing ? 'Close' : 'Edit'}</button>
              </div>

              {/* Inline editor */}
              {isEditing && draft && (
                <div style={{ padding: '12px 14px 16px 84px', background: '#0d1520', borderTop: `1px solid ${t.border}` }}>
                  {error && (
                    <div style={{ fontSize: 11, color: t.red, marginBottom: 10, padding: '4px 8px', background: 'rgba(239,68,68,0.08)', borderRadius: 4, border: `1px solid ${t.red}` }}>
                      {error}
                    </div>
                  )}

                  {/* Speed toggle header */}
                  <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
                    <div style={{ width: 80, flexShrink: 0 }} />
                    <div style={{ display: 'flex', gap: 4 }}>
                      {ALL_SPEEDS.map(s => (
                        <span key={s} style={{ width: 34, textAlign: 'center', fontSize: 8, fontWeight: 700, color: '#4b5563', letterSpacing: '0.04em' }}>{s}</span>
                      ))}
                    </div>
                  </div>

                  {/* BACKBONE section */}
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#4b5563', marginBottom: 6 }}>Backbone</div>
                    {([['IPT', 'ipt'], ['EPL', 'epl'], ['EVPL', 'evpl']] as [string, ProductKey][]).map(([label, key]) => (
                      <div key={key} style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
                        <span style={{ width: 80, flexShrink: 0, fontSize: 10, fontWeight: 600, color: '#6b7280' }}>{label}</span>
                        <div style={{ display: 'flex', gap: 4 }}>
                          {ALL_SPEEDS.map(speed => {
                            const applicable = PRODUCT_MAX[key].has(speed)
                            const active = draft[key].has(speed)
                            return (
                              <div
                                key={speed}
                                style={speedChip(active, applicable)}
                                onClick={() => applicable && toggleSpeed(key, speed)}
                              >
                                {applicable ? speed : '—'}
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* UNDERLAY section */}
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#4b5563', marginBottom: 6 }}>Underlay</div>
                    {([['GID', 'gid'], ['IP VPN', 'ipvpn']] as [string, ProductKey][]).map(([label, key]) => (
                      <div key={key} style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
                        <span style={{ width: 80, flexShrink: 0, fontSize: 10, fontWeight: 600, color: '#6b7280' }}>{label}</span>
                        <div style={{ display: 'flex', gap: 4 }}>
                          {ALL_SPEEDS.map(speed => {
                            const applicable = PRODUCT_MAX[key].has(speed)
                            const active = draft[key].has(speed)
                            return (
                              <div
                                key={speed}
                                style={speedChip(active, applicable)}
                                onClick={() => applicable && toggleSpeed(key, speed)}
                              >
                                {applicable ? speed : '—'}
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* COLOCATION section */}
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#4b5563', marginBottom: 6 }}>Colocation</div>
                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                      <button style={catBtn(draft.coloCategory === null)} onClick={() => setColo(null)}>None</button>
                      {([1, 2, 3, 4, 5] as const).map(cat => (
                        <button key={cat} style={catBtn(draft.coloCategory === cat)} onClick={() => setColo(cat)}>
                          {COLO_LABELS[cat]}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={() => save(node.id)}
                      disabled={saving}
                      style={{
                        padding: '5px 16px', borderRadius: 4, fontSize: 11, fontWeight: 700,
                        border: 'none', background: saving ? t.borderSubtle : '#16a34a',
                        color: saving ? t.textFaint : '#fff', cursor: saving ? 'not-allowed' : 'pointer',
                      }}
                    >{saving ? 'Saving…' : 'Save'}</button>
                    <button
                      onClick={closeEdit}
                      style={{
                        padding: '5px 14px', borderRadius: 4, fontSize: 11, fontWeight: 700,
                        border: `1px solid ${t.border}`, background: 'transparent',
                        color: t.textMuted, cursor: 'pointer',
                      }}
                    >Cancel</button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
