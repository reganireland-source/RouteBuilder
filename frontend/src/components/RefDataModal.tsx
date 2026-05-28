import { useState, useEffect } from 'react'
import type { AppConfig, CableNode, CableSegment, CableSystem, DisallowedPair, AllowedPair, InterconnectRule, SegmentCapacity, SegmentOutage } from '../types'
import { useTheme } from '../theme'
import { api } from '../api/client'
import { ProductCoveragePanel } from './ProductCoveragePanel'
import { BulkImportPanel } from './BulkImportPanel'

const OWNERSHIP_LABEL: Record<string, string> = {
  owned:                'Owned',
  consortium:           'Consortium',
  iru:                  'IRU',
  integrated_lit_lease: 'Int. Lit Lease',
  offnet_resell:        'Offnet Resell',
}

const DEFAULT_ONNET = ['owned', 'consortium', 'iru']

type DataTab = 'nodes' | 'segments' | 'systems' | 'capacity' | 'outages' | 'rules'
type Tab = DataTab | 'checks' | 'config' | 'coverage' | 'bulk'

interface CheckResult {
  name: string
  passed: boolean
  severity: string
  message: string
}

interface Props {
  nodes: CableNode[]
  segments: CableSegment[]
  systems: CableSystem[]
  capacity: SegmentCapacity[]
  outages: SegmentOutage[]
  rules: InterconnectRule[]
  config: AppConfig
  onDataChange: () => void
  onClose: () => void
}

export function RefDataModal({ nodes, segments, systems, capacity, outages, rules, config, onDataChange, onClose }: Props) {
  const t = useTheme()
  const [tab, setTab] = useState<Tab>('nodes')
  const [editId, setEditId] = useState<string | null>(null)
  const [editValues, setEditValues] = useState<Record<string, unknown>>({})
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [addValues, setAddValues] = useState<Record<string, unknown>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [showRulesHelp, setShowRulesHelp] = useState(false)
  const [onNetOwnership, setOnNetOwnership] = useState<Set<string>>(() => new Set(config.on_net_ownership))
  const [capSegmentOpen, setCapSegmentOpen] = useState(false)

  function isOnNet(ownership: string) { return onNetOwnership.has(ownership) }

  async function toggleOnNet(ownership: string) {
    const next = new Set(onNetOwnership)
    if (next.has(ownership)) next.delete(ownership)
    else next.add(ownership)
    setOnNetOwnership(next)
    await api.updateConfig({ on_net_ownership: [...next] })
    onDataChange()
  }

  function resetState() {
    setEditId(null); setEditValues({})
    setDeleteConfirmId(null)
    setAdding(false); setAddValues({})
    setError(null); setFilter('')
  }

  function switchTab(next: Tab) { resetState(); setTab(next) }

  function startEdit(id: string, values: Record<string, unknown>) {
    setAdding(false); setDeleteConfirmId(null)
    setEditId(id); setEditValues({ ...values })
  }

  function startAdd(defaults: Record<string, unknown>) {
    setEditId(null); setDeleteConfirmId(null)
    setAdding(true); setAddValues({ ...defaults })
  }

  async function saveEdit(saveCall: () => Promise<unknown>) {
    setSaving(true); setError(null)
    try { await saveCall(); onDataChange(); setEditId(null) }
    catch (e) { setError(String(e)) }
    finally { setSaving(false) }
  }

  async function saveAdd(saveCall: () => Promise<unknown>) {
    setSaving(true); setError(null)
    try { await saveCall(); onDataChange(); setAdding(false); setAddValues({}) }
    catch (e) { setError(String(e)) }
    finally { setSaving(false) }
  }

  async function confirmDelete(deleteCall: () => Promise<void>) {
    setSaving(true); setError(null)
    try { await deleteCall(); onDataChange(); setDeleteConfirmId(null) }
    catch (e) { setError(String(e)) }
    finally { setSaving(false) }
  }

  // ── Styles ──────────────────────────────────────────────────────────────────

  const modalBg: React.CSSProperties = {
    position: 'fixed', inset: 0, zIndex: 2000,
    background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center',
  }

  const modalBox: React.CSSProperties = {
    width: '92vw', height: '88vh', display: 'flex', flexDirection: 'column',
    background: t.bgPanel, borderRadius: 8, border: `1px solid ${t.border}`,
    boxShadow: '0 8px 40px rgba(0,0,0,0.5)', overflow: 'hidden',
    fontFamily: 'system-ui, sans-serif',
  }

  const colH = (flex: number): React.CSSProperties => ({
    flex, fontSize: 10, fontWeight: 700, color: t.textFaint,
    textTransform: 'uppercase', letterSpacing: '0.06em', padding: '0 6px',
  })

  const cell = (flex: number): React.CSSProperties => ({
    flex, fontSize: 12, color: t.text, padding: '0 6px',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  })

  const inputStyle: React.CSSProperties = {
    background: t.bgInput, border: `1px solid ${t.border}`, borderRadius: 3,
    color: t.text, fontSize: 12, padding: '3px 6px', width: '100%', boxSizing: 'border-box',
    fontFamily: 'inherit',
  }

  const selectStyle: React.CSSProperties = { ...inputStyle }

  const roStyle: React.CSSProperties = { ...inputStyle, opacity: 0.45, cursor: 'not-allowed' }

  const actionBtn = (variant: 'edit' | 'delete' | 'confirm' | 'save' | 'cancel' | 'add'): React.CSSProperties => {
    const colors: Record<string, string> = {
      edit: t.blue, delete: t.textFaint, confirm: t.red, save: t.green, cancel: t.textFaint, add: t.blue,
    }
    return {
      padding: '3px 9px', borderRadius: 3, border: `1px solid ${colors[variant]}`,
      background: 'transparent', color: colors[variant],
      fontSize: 11, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
    }
  }

  const rowStyle = (isEditing: boolean): React.CSSProperties => ({
    borderBottom: `1px solid ${t.border}`,
    background: isEditing ? t.bgDeep : 'transparent',
  })

  const editFormRow: React.CSSProperties = {
    display: 'grid', gap: 8, padding: '10px 12px',
    borderBottom: `1px solid ${t.border}`, background: t.bgDeep,
  }

  function Field({ label, val, k, src, setSrc, readOnly = false, type = 'text', options, placeholder }: {
    label: string; val?: unknown; k: string
    src: Record<string, unknown>; setSrc: (v: Record<string, unknown>) => void
    readOnly?: boolean; type?: string; options?: { value: string; label: string }[]; placeholder?: string
  }) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <label style={{ fontSize: 10, color: t.textFaint, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</label>
        {readOnly ? (
          <input style={roStyle} value={String(val ?? '')} readOnly />
        ) : options ? (
          <select style={selectStyle} value={String(src[k] ?? '')} onChange={e => setSrc({ ...src, [k]: e.target.value })}>
            {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        ) : (
          <input
            style={inputStyle}
            type={type === 'decimal' ? 'text' : type}
            inputMode={type === 'decimal' ? 'decimal' : undefined}
            step={type === 'number' ? 'any' : undefined}
            placeholder={placeholder}
            value={String(src[k] ?? '')}
            onChange={e => setSrc({ ...src, [k]: type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value })}
          />
        )}
      </div>
    )
  }

  function ActionsCell({ id, onEdit, onDelete }: { id: string; onEdit: () => void; onDelete: () => void }) {
    return (
      <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end', padding: '0 6px', flexShrink: 0 }}>
        {deleteConfirmId === id ? (
          <>
            <button style={actionBtn('confirm')} disabled={saving} onClick={onDelete}>Confirm</button>
            <button style={actionBtn('cancel')} onClick={() => setDeleteConfirmId(null)}>Cancel</button>
          </>
        ) : (
          <>
            <button style={actionBtn('edit')} onClick={onEdit}>Edit</button>
            <button style={actionBtn('delete')} onClick={() => { setEditId(null); setDeleteConfirmId(id) }}>Delete</button>
          </>
        )}
      </div>
    )
  }

  function SaveCancel({ onSave, onCancel }: { onSave: () => void; onCancel: () => void }) {
    return (
      <div style={{ display: 'flex', gap: 6, gridColumn: '1 / -1', marginTop: 4 }}>
        <button style={actionBtn('save')} disabled={saving} onClick={onSave}>{saving ? 'Saving…' : 'Save'}</button>
        <button style={actionBtn('cancel')} onClick={onCancel}>Cancel</button>
        {error && <span style={{ fontSize: 11, color: t.red, marginLeft: 8 }}>{error}</span>}
      </div>
    )
  }

  const typeOpts    = [{ value: 'landing_station', label: 'CLS (Landing Station)' }, { value: 'terrestrial_pop', label: 'POP (Terrestrial)' }, { value: 'branching_unit', label: 'BU (Branching Unit)' }]
  const segTypeOpts = [{ value: 'wet', label: 'Wet' }, { value: 'terrestrial', label: 'Terrestrial' }]
  const ownerOpts   = [
    { value: 'owned',                label: 'Owned' },
    { value: 'consortium',           label: 'Consortium' },
    { value: 'iru',                  label: 'IRU' },
    { value: 'integrated_lit_lease', label: 'Integrated Lit Lease' },
    { value: 'offnet_resell',        label: 'Offnet Resell' },
  ]
  const systemOpts  = systems.map(s => ({ value: s.id, label: `${s.id} — ${s.name}` }))

  // ── Nodes tab ───────────────────────────────────────────────────────────────

  function NodeTab() {
    const filtered = nodes.filter(n =>
      !filter || n.name.toLowerCase().includes(filter.toLowerCase()) || n.id.toLowerCase().includes(filter.toLowerCase())
    )
    return (
      <>
        {adding && (
          <div style={{ ...editFormRow, gridTemplateColumns: 'repeat(5, 1fr)' }}>
            <Field label="ID *"         k="id"           src={addValues} setSrc={setAddValues} />
            <Field label="Name *"       k="name"         src={addValues} setSrc={setAddValues} />
            <Field label="Country"      k="country"      src={addValues} setSrc={setAddValues} />
            <Field label="Type"         k="type"         src={addValues} setSrc={setAddValues} options={typeOpts} />
            <Field label="Owner"        k="owner"        src={addValues} setSrc={setAddValues} />
            <Field label="Lat"          k="lat"          src={addValues} setSrc={setAddValues} type="number" />
            <Field label="Lng"          k="lng"          src={addValues} setSrc={setAddValues} type="number" />
            <Field label="Trading Name" k="trading_name" src={addValues} setSrc={setAddValues} />
            <Field label="Description"  k="description"  src={addValues} setSrc={setAddValues} />
            <SaveCancel
              onSave={() => saveAdd(() => api.createNode(addValues as unknown as CableNode))}
              onCancel={() => { setAdding(false); setAddValues({}) }}
            />
          </div>
        )}
        <div style={{ display: 'flex', padding: '6px 12px', borderBottom: `1px solid ${t.border}`, background: t.bgDeep }}>
          <div style={colH(1.5)}>ID</div><div style={colH(2)}>Name</div><div style={colH(1)}>Country</div>
          <div style={colH(1.5)}>Type</div><div style={colH(2)}>Owner</div>
          <div style={colH(2)}>Trading Name</div><div style={colH(3)}>Description</div>
          <div style={colH(1)}>Lat</div><div style={colH(1)}>Lng</div>
          <div style={{ width: 140 }} />
        </div>
        {filtered.map(n => (
          <div key={n.id} style={rowStyle(editId === n.id)}>
            <div style={{ display: 'flex', alignItems: 'center', padding: '7px 12px', minHeight: 36 }}>
              <div style={cell(1.5)}><code style={{ fontSize: 11 }}>{n.id}</code></div>
              <div style={cell(2)}>{n.name}</div>
              <div style={cell(1)}>{n.country}</div>
              <div style={cell(1.5)}>{n.type === 'landing_station' ? 'CLS' : n.type === 'branching_unit' ? 'BU' : 'POP'}</div>
              <div style={cell(2)}>{n.owner ?? ''}</div>
              <div style={cell(2)}>{n.trading_name ?? ''}</div>
              <div style={cell(3)}>{n.description ?? ''}</div>
              <div style={cell(1)}>{n.lat}</div>
              <div style={cell(1)}>{n.lng}</div>
              <ActionsCell id={n.id}
                onEdit={() => startEdit(n.id, { name: n.name, country: n.country, type: n.type, lat: n.lat, lng: n.lng, owner: n.owner ?? '', trading_name: n.trading_name ?? '', description: n.description ?? '' })}
                onDelete={() => confirmDelete(() => api.deleteNode(n.id))}
              />
            </div>
            {editId === n.id && (
              <div style={{ ...editFormRow, gridTemplateColumns: 'repeat(4, 1fr)' }}>
                <Field label="Name"         k="name"         src={editValues} setSrc={setEditValues} />
                <Field label="Country"      k="country"      src={editValues} setSrc={setEditValues} />
                <Field label="Type"         k="type"         src={editValues} setSrc={setEditValues} options={typeOpts} />
                <Field label="Owner"        k="owner"        src={editValues} setSrc={setEditValues} />
                <Field label="Lat"          k="lat"          src={editValues} setSrc={setEditValues} type="number" />
                <Field label="Lng"          k="lng"          src={editValues} setSrc={setEditValues} type="number" />
                <Field label="Trading Name" k="trading_name" src={editValues} setSrc={setEditValues} />
                <Field label="Description"  k="description"  src={editValues} setSrc={setEditValues} />
                <SaveCancel
                  onSave={() => saveEdit(() => api.updateNode(n.id, editValues as Partial<CableNode>))}
                  onCancel={() => setEditId(null)}
                />
              </div>
            )}
          </div>
        ))}
      </>
    )
  }

  // ── Segments tab ─────────────────────────────────────────────────────────────

  function SegmentTab() {
    const filtered = segments.filter(s =>
      !filter || s.name.toLowerCase().includes(filter.toLowerCase()) ||
      s.id.toLowerCase().includes(filter.toLowerCase()) || s.system_id.toLowerCase().includes(filter.toLowerCase())
    )
    const segDefaults = { id: '', name: '', system_id: '', start_node_id: '', end_node_id: '', type: 'wet', length_km: 0, latency: 0, cost_weight: 1, reliability: 0.9999, ownership: 'consortium' }

    return (
      <>
        {adding && (
          <div style={{ ...editFormRow, gridTemplateColumns: 'repeat(6, 1fr)' }}>
            <Field label="ID *"         k="id"            src={addValues} setSrc={setAddValues} />
            <Field label="Name *"       k="name"          src={addValues} setSrc={setAddValues} />
            <Field label="System"       k="system_id"     src={addValues} setSrc={setAddValues} options={systemOpts} />
            <Field label="Start Node"   k="start_node_id" src={addValues} setSrc={setAddValues} />
            <Field label="End Node"     k="end_node_id"   src={addValues} setSrc={setAddValues} />
            <Field label="Type"         k="type"          src={addValues} setSrc={setAddValues} options={segTypeOpts} />
            <Field label="Length (km)"  k="length_km"     src={addValues} setSrc={setAddValues} type="number" />
            <Field label="Latency (ms)" k="latency"       src={addValues} setSrc={setAddValues} type="number" />
            <Field label="Cost Weight"  k="cost_weight"   src={addValues} setSrc={setAddValues} type="number" />
            <Field label="Reliability"  k="reliability"   src={addValues} setSrc={setAddValues} type="number" />
            <Field label="Ownership"    k="ownership"     src={addValues} setSrc={setAddValues} options={ownerOpts} />
            <SaveCancel
              onSave={() => saveAdd(() => api.createSegment({ ...segDefaults, ...addValues } as CableSegment))}
              onCancel={() => { setAdding(false); setAddValues({}) }}
            />
          </div>
        )}
        <div style={{ display: 'flex', padding: '6px 12px', borderBottom: `1px solid ${t.border}`, background: t.bgDeep }}>
          <div style={colH(1.5)}>ID</div><div style={colH(2)}>Name</div><div style={colH(1)}>System</div>
          <div style={colH(1.5)}>Start Node</div><div style={colH(1.5)}>End Node</div>
          <div style={colH(0.8)}>Type</div><div style={colH(1)}>Length</div><div style={colH(0.8)}>Latency</div>
          <div style={colH(0.7)}>Cost</div><div style={colH(1)}>Ownership</div><div style={colH(0.8)}>Network</div>
          <div style={{ width: 140 }} />
        </div>
        {(() => {
          const nodesById = Object.fromEntries(nodes.map(n => [n.id, n]))
          return filtered.map(s => (
          <div key={s.id} style={rowStyle(editId === s.id)}>
            <div style={{ display: 'flex', alignItems: 'center', padding: '7px 12px', minHeight: 36 }}>
              <div style={cell(1.5)}><code style={{ fontSize: 11 }}>{s.id}</code></div>
              <div style={cell(2)}>{s.name}</div>
              <div style={cell(1)}>{s.system_id}</div>
              <div style={cell(1.5)}>{nodesById[s.start_node_id]?.name ?? s.start_node_id}</div>
              <div style={cell(1.5)}>{nodesById[s.end_node_id]?.name ?? s.end_node_id}</div>
              <div style={cell(0.8)}>{s.type}</div>
              <div style={cell(1)}>{s.length_km.toLocaleString()} km</div>
              <div style={cell(0.8)}>{s.latency} ms</div>
              <div style={cell(0.7)}>{s.cost_weight}</div>
              <div style={cell(1)}>{OWNERSHIP_LABEL[s.ownership] ?? s.ownership}</div>
              <div style={cell(0.8)}>
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 3,
                  letterSpacing: '0.04em',
                  background: isOnNet(s.ownership) ? '#a6e3a122' : '#f9e2af22',
                  color: isOnNet(s.ownership) ? '#a6e3a1' : '#f9e2af',
                  border: `1px solid ${isOnNet(s.ownership) ? '#a6e3a144' : '#f9e2af44'}`,
                }}>
                  {isOnNet(s.ownership) ? 'ON-NET' : 'OFF-NET'}
                </span>
              </div>
              <ActionsCell id={s.id}
                onEdit={() => startEdit(s.id, { name: s.name, system_id: s.system_id, start_node_id: s.start_node_id, end_node_id: s.end_node_id, type: s.type, length_km: s.length_km, latency: s.latency, cost_weight: s.cost_weight, reliability: s.reliability, ownership: s.ownership, waypoints: s.waypoints ? JSON.parse(JSON.stringify(s.waypoints)) : [] })}
                onDelete={() => confirmDelete(() => api.deleteSegment(s.id))}
              />
            </div>
            {editId === s.id && (
              <div style={{ ...editFormRow, gridTemplateColumns: 'repeat(5, 1fr)' }}>
                <Field label="Name"         k="name"          src={editValues} setSrc={setEditValues} />
                <Field label="System"       k="system_id"     src={editValues} setSrc={setEditValues} options={systemOpts} />
                <Field label="Start Node"   k="start_node_id" src={editValues} setSrc={setEditValues} />
                <Field label="End Node"     k="end_node_id"   src={editValues} setSrc={setEditValues} />
                <Field label="Type"         k="type"          src={editValues} setSrc={setEditValues} options={segTypeOpts} />
                <Field label="Length (km)"  k="length_km"     src={editValues} setSrc={setEditValues} type="number" />
                <Field label="Latency (ms)" k="latency"       src={editValues} setSrc={setEditValues} type="number" />
                <Field label="Cost Weight"  k="cost_weight"   src={editValues} setSrc={setEditValues} type="number" />
                <Field label="Reliability"  k="reliability"   src={editValues} setSrc={setEditValues} type="number" />
                <Field label="Ownership"    k="ownership"     src={editValues} setSrc={setEditValues} options={ownerOpts} />
                {/* Waypoints editor */}
                <div style={{ gridColumn: '1 / -1', marginTop: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                    <label style={{ fontSize: 10, color: t.textFaint, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Ocean Waypoints
                    </label>
                    <span style={{ fontSize: 10, color: t.textFaintest }}>
                      Intermediate lat/lng points that keep wet segments in the ocean — ordered from start to end node
                    </span>
                  </div>
                  {((editValues.waypoints as [number, number][]) ?? []).map(([wlat, wlng], wi) => (
                    <div key={wi} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
                      <span style={{ fontSize: 10, color: t.textFaint, width: 20, textAlign: 'right', flexShrink: 0 }}>{wi + 1}</span>
                      <input
                        type="number" step="any" placeholder="Lat"
                        value={wlat}
                        style={{ ...inputStyle, width: 90 }}
                        onChange={e => {
                          const wps = [...((editValues.waypoints as [number, number][]) ?? [])]
                          wps[wi] = [parseFloat(e.target.value) || 0, wps[wi][1]]
                          setEditValues({ ...editValues, waypoints: wps })
                        }}
                      />
                      <input
                        type="number" step="any" placeholder="Lng"
                        value={wlng}
                        style={{ ...inputStyle, width: 90 }}
                        onChange={e => {
                          const wps = [...((editValues.waypoints as [number, number][]) ?? [])]
                          wps[wi] = [wps[wi][0], parseFloat(e.target.value) || 0]
                          setEditValues({ ...editValues, waypoints: wps })
                        }}
                      />
                      <button
                        title="Move up"
                        disabled={wi === 0}
                        onClick={() => {
                          const wps = [...((editValues.waypoints as [number, number][]) ?? [])]
                          ;[wps[wi - 1], wps[wi]] = [wps[wi], wps[wi - 1]]
                          setEditValues({ ...editValues, waypoints: wps })
                        }}
                        style={{ fontSize: 11, padding: '2px 6px', borderRadius: 3, border: `1px solid ${t.border}`, background: 'transparent', color: t.textFaint, cursor: wi === 0 ? 'not-allowed' : 'pointer', opacity: wi === 0 ? 0.3 : 1 }}
                      >↑</button>
                      <button
                        title="Move down"
                        disabled={wi === ((editValues.waypoints as [number, number][]) ?? []).length - 1}
                        onClick={() => {
                          const wps = [...((editValues.waypoints as [number, number][]) ?? [])]
                          ;[wps[wi], wps[wi + 1]] = [wps[wi + 1], wps[wi]]
                          setEditValues({ ...editValues, waypoints: wps })
                        }}
                        style={{ fontSize: 11, padding: '2px 6px', borderRadius: 3, border: `1px solid ${t.border}`, background: 'transparent', color: t.textFaint, cursor: wi === ((editValues.waypoints as [number, number][]) ?? []).length - 1 ? 'not-allowed' : 'pointer', opacity: wi === ((editValues.waypoints as [number, number][]) ?? []).length - 1 ? 0.3 : 1 }}
                      >↓</button>
                      <button
                        title="Remove waypoint"
                        onClick={() => {
                          const wps = ((editValues.waypoints as [number, number][]) ?? []).filter((_, j) => j !== wi)
                          setEditValues({ ...editValues, waypoints: wps })
                        }}
                        style={{ fontSize: 11, padding: '2px 7px', borderRadius: 3, border: `1px solid ${t.red}44`, background: 'transparent', color: t.red, cursor: 'pointer' }}
                      >×</button>
                    </div>
                  ))}
                  <button
                    onClick={() => {
                      const wps = [...((editValues.waypoints as [number, number][]) ?? []), [0, 0] as [number, number]]
                      setEditValues({ ...editValues, waypoints: wps })
                    }}
                    style={{ fontSize: 11, padding: '3px 10px', borderRadius: 3, border: `1px solid ${t.blue}`, background: 'transparent', color: t.blue, cursor: 'pointer', marginTop: 2 }}
                  >+ Add waypoint</button>
                </div>
                <SaveCancel
                  onSave={() => {
                    const wps = (editValues.waypoints as [number, number][]) ?? []
                    const payload = { ...editValues, waypoints: wps.length > 0 ? wps : null }
                    saveEdit(() => api.updateSegment(s.id, payload as Partial<CableSegment>))
                  }}
                  onCancel={() => setEditId(null)}
                />
              </div>
            )}
          </div>
        ))
        })()}
      </>
    )
  }

  // ── Systems tab ──────────────────────────────────────────────────────────────

  function SystemTab() {
    const filtered = systems.filter(s =>
      !filter || s.name.toLowerCase().includes(filter.toLowerCase()) || s.id.toLowerCase().includes(filter.toLowerCase())
    )
    return (
      <>
        {adding && (
          <div style={{ ...editFormRow, gridTemplateColumns: 'repeat(4, 1fr)' }}>
            <Field label="ID *"          k="id"          src={addValues} setSrc={setAddValues} />
            <Field label="Name *"        k="name"        src={addValues} setSrc={setAddValues} />
            <Field label="Description"   k="description" src={addValues} setSrc={setAddValues} />
            <Field label="Margin (1–10)" k="margin"      src={addValues} setSrc={setAddValues} type="number" />
            <SaveCancel
              onSave={() => saveAdd(() => api.createSystem(addValues as unknown as CableSystem))}
              onCancel={() => { setAdding(false); setAddValues({}) }}
            />
          </div>
        )}
        <div style={{ display: 'flex', padding: '6px 12px', borderBottom: `1px solid ${t.border}`, background: t.bgDeep }}>
          <div style={colH(1.5)}>ID</div><div style={colH(3)}>Name</div><div style={colH(4)}>Description</div><div style={colH(1)}>Margin</div>
          <div style={{ width: 140 }} />
        </div>
        {filtered.map(s => {
          const mc = s.margin == null ? t.textFaint : s.margin >= 7.5 ? t.green : s.margin >= 4.5 ? t.orange : t.red
          return (
            <div key={s.id} style={rowStyle(editId === s.id)}>
              <div style={{ display: 'flex', alignItems: 'center', padding: '7px 12px', minHeight: 36 }}>
                <div style={cell(1.5)}><code style={{ fontSize: 11 }}>{s.id}</code></div>
                <div style={cell(3)}>{s.name}</div>
                <div style={cell(4)}>{s.description}</div>
                <div style={{ ...cell(1), fontWeight: 700, color: mc }}>
                  {s.margin != null ? s.margin.toFixed(1) : '—'}
                </div>
                <ActionsCell id={s.id}
                  onEdit={() => startEdit(s.id, { name: s.name, description: s.description, margin: s.margin })}
                  onDelete={() => confirmDelete(() => api.deleteSystem(s.id))}
                />
              </div>
              {editId === s.id && (
                <div style={{ ...editFormRow, gridTemplateColumns: '1fr 2fr 1fr' }}>
                  <Field label="Name"        k="name"        src={editValues} setSrc={setEditValues} />
                  <Field label="Description" k="description" src={editValues} setSrc={setEditValues} />
                  <Field label="Margin (1–10)" k="margin"    src={editValues} setSrc={setEditValues} type="number" />
                  <SaveCancel
                    onSave={() => saveEdit(() => api.updateSystem(s.id, editValues as Partial<CableSystem>))}
                    onCancel={() => setEditId(null)}
                  />
                </div>
              )}
            </div>
          )
        })}
      </>
    )
  }

  // ── Capacity tab ─────────────────────────────────────────────────────────────

  function CapacityTab() {
    const filtered = capacity.filter(c =>
      !filter || c.segment_id.toLowerCase().includes(filter.toLowerCase())
    )
    return (
      <>
        {adding && (
          <div style={{ ...editFormRow, gridTemplateColumns: 'repeat(3, 1fr)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, position: 'relative' }}>
              <label style={{ fontSize: 10, color: t.textFaint, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Segment ID *</label>
              <input
                style={inputStyle}
                placeholder="Type to filter segments…"
                value={String(addValues.segment_id ?? '')}
                onChange={e => { setAddValues({ ...addValues, segment_id: e.target.value }); setCapSegmentOpen(true) }}
                onFocus={() => setCapSegmentOpen(true)}
                onBlur={() => setTimeout(() => setCapSegmentOpen(false), 150)}
              />
              {capSegmentOpen && (() => {
                const q = String(addValues.segment_id ?? '').toLowerCase()
                const hits = q ? segments.filter(s => s.id.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)).slice(0, 12) : []
                return hits.length > 0 ? (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 300, background: t.bgDeep, border: `1px solid ${t.border}`, borderRadius: 4, maxHeight: 220, overflowY: 'auto', boxShadow: '0 6px 16px rgba(0,0,0,0.5)', marginTop: 2 }}>
                    {hits.map(s => (
                      <div key={s.id} onMouseDown={() => { setAddValues({ ...addValues, segment_id: s.id }); setCapSegmentOpen(false) }}
                        style={{ padding: '6px 10px', cursor: 'pointer', display: 'flex', gap: 10, alignItems: 'baseline', borderBottom: `1px solid ${t.border}` }}>
                        <code style={{ fontSize: 11, color: t.blue, flexShrink: 0 }}>{s.id}</code>
                        <span style={{ fontSize: 11, color: t.textFaint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
                      </div>
                    ))}
                  </div>
                ) : null
              })()}
            </div>
            <Field label="Total (T)"     k="total_capacity_t"    src={addValues} setSrc={setAddValues} type="decimal" placeholder="e.g. 4.5" />
            <Field label="Available (T)" k="available_capacity_t" src={addValues} setSrc={setAddValues} type="decimal" placeholder="e.g. 2.0" />
            <SaveCancel
              onSave={() => {
                const vals = {
                  segment_id: String(addValues.segment_id ?? ''),
                  total_capacity_t: parseFloat(String(addValues.total_capacity_t)) || 0,
                  available_capacity_t: parseFloat(String(addValues.available_capacity_t)) || 0,
                }
                saveAdd(() => api.createCapacity(vals as unknown as SegmentCapacity))
              }}
              onCancel={() => { setAdding(false); setAddValues({}) }}
            />
          </div>
        )}
        <div style={{ display: 'flex', padding: '6px 12px', borderBottom: `1px solid ${t.border}`, background: t.bgDeep }}>
          <div style={colH(3)}>Segment ID</div><div style={colH(1.5)}>Total (T)</div>
          <div style={colH(1.5)}>Available (T)</div><div style={colH(1.5)}>% Free</div>
          <div style={{ width: 140 }} />
        </div>
        {filtered.map(c => {
          const pct = Math.round((c.available_capacity_t / c.total_capacity_t) * 100)
          const pctColor = pct < 20 ? t.red : pct < 50 ? t.orange : t.green
          return (
            <div key={c.segment_id} style={rowStyle(editId === c.segment_id)}>
              <div style={{ display: 'flex', alignItems: 'center', padding: '7px 12px', minHeight: 36 }}>
                <div style={cell(3)}><code style={{ fontSize: 11 }}>{c.segment_id}</code></div>
                <div style={cell(1.5)}>{c.total_capacity_t}T</div>
                <div style={cell(1.5)}>{c.available_capacity_t}T</div>
                <div style={{ ...cell(1.5), color: pctColor, fontWeight: 600 }}>{pct}%</div>
                <ActionsCell id={c.segment_id}
                  onEdit={() => startEdit(c.segment_id, { total_capacity_t: c.total_capacity_t, available_capacity_t: c.available_capacity_t })}
                  onDelete={() => confirmDelete(() => api.deleteCapacity(c.segment_id))}
                />
              </div>
              {editId === c.segment_id && (
                <div style={{ ...editFormRow, gridTemplateColumns: '1fr 1fr' }}>
                  <Field label="Total (T)"     k="total_capacity_t"     src={editValues} setSrc={setEditValues} type="decimal" placeholder="e.g. 4.5" />
                  <Field label="Available (T)" k="available_capacity_t" src={editValues} setSrc={setEditValues} type="decimal" placeholder="e.g. 2.0" />
                  <SaveCancel
                    onSave={() => {
                      const vals = {
                        total_capacity_t: parseFloat(String(editValues.total_capacity_t)) || 0,
                        available_capacity_t: parseFloat(String(editValues.available_capacity_t)) || 0,
                      }
                      saveEdit(() => api.updateCapacity(c.segment_id, vals as Partial<SegmentCapacity>))
                    }}
                    onCancel={() => setEditId(null)}
                  />
                </div>
              )}
            </div>
          )
        })}
      </>
    )
  }

  // ── Outages tab ──────────────────────────────────────────────────────────────

  function OutagesTab() {
    const filtered = outages.filter(o =>
      !filter || o.segment_id.toLowerCase().includes(filter.toLowerCase()) ||
      o.fault_id.toLowerCase().includes(filter.toLowerCase())
    )
    return (
      <>
        {adding && (
          <div style={{ ...editFormRow, gridTemplateColumns: 'repeat(3, 1fr)' }}>
            <Field label="Segment ID *"    k="segment_id"            src={addValues} setSrc={setAddValues} />
            <Field label="Fault ID *"      k="fault_id"              src={addValues} setSrc={setAddValues} />
            <Field label="Fault Date *"    k="fault_date"            src={addValues} setSrc={setAddValues} placeholder="YYYY-MM-DD" />
            <Field label="Repair Start"    k="repair_start"          src={addValues} setSrc={setAddValues} placeholder="YYYY-MM-DD or TBC" />
            <Field label="ETA Repair"      k="estimated_repair_date" src={addValues} setSrc={setAddValues} placeholder="YYYY-MM-DD or TBC" />
            <Field label="Description *"   k="description"           src={addValues} setSrc={setAddValues} />
            <SaveCancel
              onSave={() => saveAdd(() => api.createOutage(addValues as unknown as SegmentOutage))}
              onCancel={() => { setAdding(false); setAddValues({}) }}
            />
          </div>
        )}
        <div style={{ display: 'flex', padding: '6px 12px', borderBottom: `1px solid ${t.border}`, background: t.bgDeep }}>
          <div style={colH(2)}>Segment</div>
          <div style={colH(2)}>Fault ID</div>
          <div style={colH(2)}>Fault Date</div>
          <div style={colH(2)}>Repair Start</div>
          <div style={colH(2)}>ETA</div>
          <div style={colH(3)}>Description</div>
          <div style={{ width: 140 }} />
        </div>
        {filtered.map(o => (
          <div key={o.fault_id} style={rowStyle(editId === o.fault_id)}>
            <div style={{ display: 'flex', alignItems: 'center', padding: '7px 12px', minHeight: 36 }}>
              <div style={cell(2)}><code style={{ fontSize: 11 }}>{o.segment_id}</code></div>
              <div style={cell(2)}>{o.fault_id}</div>
              <div style={cell(2)}>{o.fault_date}</div>
              <div style={cell(2)}>{o.repair_start ?? '—'}</div>
              <div style={{ ...cell(2), color: o.estimated_repair_date === 'TBC' ? t.orange : t.text }}>
                {o.estimated_repair_date ?? '—'}
              </div>
              <div style={{ ...cell(3), fontSize: 11, color: t.textMuted }}>{o.description}</div>
              <ActionsCell id={o.fault_id}
                onEdit={() => startEdit(o.fault_id, {
                  fault_id: o.fault_id, fault_date: o.fault_date,
                  repair_start: o.repair_start ?? '', estimated_repair_date: o.estimated_repair_date ?? '',
                  description: o.description,
                })}
                onDelete={() => confirmDelete(() => api.deleteOutage(o.fault_id))}
              />
            </div>
            {editId === o.fault_id && (
              <div style={{ ...editFormRow, gridTemplateColumns: 'repeat(3, 1fr)' }}>
                <Field label="Fault ID"       k="fault_id"              src={editValues} setSrc={setEditValues} />
                <Field label="Fault Date"     k="fault_date"            src={editValues} setSrc={setEditValues} placeholder="YYYY-MM-DD" />
                <Field label="Repair Start"   k="repair_start"          src={editValues} setSrc={setEditValues} placeholder="YYYY-MM-DD or TBC" />
                <Field label="ETA Repair"     k="estimated_repair_date" src={editValues} setSrc={setEditValues} placeholder="YYYY-MM-DD or TBC" />
                <Field label="Description"    k="description"           src={editValues} setSrc={setEditValues} />
                <SaveCancel
                  onSave={() => saveEdit(() => api.updateOutage(o.fault_id, editValues as Partial<SegmentOutage>))}
                  onCancel={() => setEditId(null)}
                />
              </div>
            )}
          </div>
        ))}
      </>
    )
  }

  // ── Rules tab ────────────────────────────────────────────────────────────────

  type FlatPair = { node_id: string; idx: number; pair: DisallowedPair | AllowedPair; kind: 'blacklist' | 'whitelist' }

  function RulesTab() {
    const flat: FlatPair[] = rules.flatMap(r => [
      ...r.disallowed_pairs.map((pair, idx) => ({ node_id: r.node_id, idx, pair, kind: 'blacklist' as const })),
      ...(r.allowed_pairs ?? []).map((pair, idx) => ({ node_id: r.node_id, idx, pair, kind: 'whitelist' as const })),
    ])
    const filtered = flat.filter(fp =>
      !filter ||
      fp.node_id.toLowerCase().includes(filter.toLowerCase()) ||
      fp.pair.system_a.toLowerCase().includes(filter.toLowerCase()) ||
      fp.pair.system_b.toLowerCase().includes(filter.toLowerCase())
    )

    function pairKey(node_id: string, kind: string, idx: number) { return `${node_id}::${kind}::${idx}` }

    const kindOpts = [
      { value: 'blacklist', label: 'Blacklist — block this pair' },
      { value: 'whitelist', label: 'Whitelist — only allow this pair' },
    ]

    function typeBadge(kind: 'blacklist' | 'whitelist') {
      const wl = kind === 'whitelist'
      return (
        <span style={{
          display: 'inline-block', fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 3,
          background: wl ? 'rgba(166,227,161,0.15)' : 'rgba(243,139,168,0.15)',
          color: wl ? t.green : t.red,
          letterSpacing: '0.04em', textTransform: 'uppercase',
        }}>
          {wl ? 'Whitelist' : 'Blacklist'}
        </span>
      )
    }

    async function savePairEdit(node_id: string, idx: number, kind: 'blacklist' | 'whitelist') {
      const rule = rules.find(r => r.node_id === node_id)!
      const newKind = editValues.kind as 'blacklist' | 'whitelist'
      const newPair = { system_a: String(editValues.system_a), system_b: String(editValues.system_b), reason: String(editValues.reason) }

      if (newKind === kind) {
        if (kind === 'blacklist') {
          await saveEdit(() => api.updateRule(node_id, { disallowed_pairs: rule.disallowed_pairs.map((p, i) => i === idx ? newPair : p) }))
        } else {
          await saveEdit(() => api.updateRule(node_id, { allowed_pairs: (rule.allowed_pairs ?? []).map((p, i) => i === idx ? newPair : p) }))
        }
      } else {
        // Kind changed — move pair between lists
        const newDisallowed = kind === 'blacklist'
          ? rule.disallowed_pairs.filter((_, i) => i !== idx)
          : [...rule.disallowed_pairs, newPair]
        const newAllowed = kind === 'whitelist'
          ? (rule.allowed_pairs ?? []).filter((_, i) => i !== idx)
          : [...(rule.allowed_pairs ?? []), newPair]
        await saveEdit(() => api.updateRule(node_id, { disallowed_pairs: newDisallowed, allowed_pairs: newAllowed }))
      }
    }

    async function deletePair(node_id: string, idx: number, kind: 'blacklist' | 'whitelist') {
      const rule = rules.find(r => r.node_id === node_id)!
      const newDisallowed = kind === 'blacklist' ? rule.disallowed_pairs.filter((_, i) => i !== idx) : rule.disallowed_pairs
      const newAllowed    = kind === 'whitelist' ? (rule.allowed_pairs ?? []).filter((_, i) => i !== idx) : (rule.allowed_pairs ?? [])
      if (newDisallowed.length === 0 && newAllowed.length === 0) {
        await confirmDelete(() => api.deleteRule(node_id))
      } else {
        await confirmDelete(() => api.updateRule(node_id, { disallowed_pairs: newDisallowed, allowed_pairs: newAllowed }).then(() => {}))
      }
    }

    async function addPair() {
      const { node_id, system_a, system_b, reason, kind } = addValues as Record<string, string>
      const ruleKind = (kind || 'blacklist') as 'blacklist' | 'whitelist'
      const defaultReason = ruleKind === 'blacklist' ? 'Pair is not allowed' : 'Only this pair is allowed at this node'
      const newPair = { system_a, system_b, reason: reason || defaultReason }
      const existing = rules.find(r => r.node_id === node_id)
      if (existing) {
        if (ruleKind === 'blacklist') {
          await saveAdd(() => api.updateRule(node_id, { disallowed_pairs: [...existing.disallowed_pairs, newPair] }))
        } else {
          await saveAdd(() => api.updateRule(node_id, { allowed_pairs: [...(existing.allowed_pairs ?? []), newPair] }))
        }
      } else {
        if (ruleKind === 'blacklist') {
          await saveAdd(() => api.createRule({ node_id, disallowed_pairs: [newPair], allowed_pairs: [] }))
        } else {
          await saveAdd(() => api.createRule({ node_id, disallowed_pairs: [], allowed_pairs: [newPair] }))
        }
      }
    }

    const blacklistCount = rules.reduce((n, r) => n + r.disallowed_pairs.length, 0)
    const whitelistCount = rules.reduce((n, r) => n + (r.allowed_pairs?.length ?? 0), 0)

    return (
      <>
        {showRulesHelp && (
          <div style={{ margin: '10px 12px', padding: '12px 14px', background: t.bgDeep, border: `1px solid ${t.border}`, borderRadius: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: t.text }}>How do Node Rules behave?</span>
              <button onClick={() => setShowRulesHelp(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: t.textFaint, fontSize: 16, padding: '0 4px', lineHeight: 1 }}>×</button>
            </div>
            <div style={{ fontSize: 11, color: t.textFaint, marginBottom: 10, lineHeight: 1.5 }}>
              Rules control which cable systems can transit through a node together. Whitelist and blacklist rules are independent and can coexist on the same node.
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${t.border}` }}>
                  <th style={{ textAlign: 'left', padding: '4px 8px', color: t.textFaint, fontWeight: 600 }}>Scenario at node</th>
                  <th style={{ textAlign: 'left', padding: '4px 8px', color: t.textFaint, fontWeight: 600 }}>Result</th>
                  <th style={{ textAlign: 'left', padding: '4px 8px', color: t.textFaint, fontWeight: 600 }}>Why</th>
                </tr>
              </thead>
              <tbody>
                {([
                  { scenario: 'Whitelisted system → its whitelisted partner', result: '✓ Allowed', pass: true,  why: 'Explicitly permitted' },
                  { scenario: 'Whitelisted system → any other system',        result: '✗ Blocked', pass: false, why: 'System is whitelisted; unlisted transition rejected' },
                  { scenario: 'Blacklisted pair',                             result: '✗ Blocked', pass: false, why: 'Explicitly forbidden' },
                  { scenario: 'Any other combination',                        result: '✓ Allowed', pass: true,  why: 'No rule applies' },
                ] as const).map(row => (
                  <tr key={row.scenario} style={{ borderBottom: `1px solid ${t.borderSubtle}` }}>
                    <td style={{ padding: '5px 8px', color: t.text,      fontSize: 11 }}>{row.scenario}</td>
                    <td style={{ padding: '5px 8px', color: row.pass ? t.green : t.red, fontWeight: 700, fontSize: 11 }}>{row.result}</td>
                    <td style={{ padding: '5px 8px', color: t.textFaint, fontSize: 11 }}>{row.why}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ fontSize: 11, color: t.textFaint, marginTop: 8, lineHeight: 1.5 }}>
              <strong style={{ color: t.text }}>Example</strong> — GUM1 with BIFROST whitelist + PPC1↔AAG blacklist:&nbsp;
              BIFROST→BIFROST <span style={{ color: t.green }}>allowed</span> ·&nbsp;
              BIFROST→AJC <span style={{ color: t.red }}>blocked</span> ·&nbsp;
              PPC1→AAG <span style={{ color: t.red }}>blocked</span> ·&nbsp;
              PPC1→AJC <span style={{ color: t.green }}>allowed</span>
            </div>
          </div>
        )}
        {adding && (
          <div style={{ ...editFormRow, gridTemplateColumns: '1fr 1.2fr 1fr 1fr 2fr' }}>
            <Field label="Node ID *"   k="node_id"   src={addValues} setSrc={setAddValues} />
            <Field label="Rule Type *" k="kind"      src={addValues} setSrc={setAddValues} options={kindOpts} />
            <Field label="System A *"  k="system_a"  src={addValues} setSrc={setAddValues} />
            <Field label="System B *"  k="system_b"  src={addValues} setSrc={setAddValues} />
            <Field label="Reason"      k="reason"    src={addValues} setSrc={setAddValues} />
            <SaveCancel onSave={addPair} onCancel={() => { setAdding(false); setAddValues({}) }} />
          </div>
        )}
        <div style={{ display: 'flex', padding: '6px 12px', borderBottom: `1px solid ${t.border}`, background: t.bgDeep, alignItems: 'center' }}>
          <div style={colH(1)}>Type</div>
          <div style={colH(1.5)}>Node</div>
          <div style={colH(1.5)}>System A</div>
          <div style={colH(1.5)}>System B</div>
          <div style={colH(4)}>Reason</div>
          <div style={{ width: 140, flexShrink: 0 }} />
          <button
            onClick={() => setShowRulesHelp(v => !v)}
            title="How do Node Rules behave?"
            style={{ background: 'none', border: `1px solid ${t.border}`, borderRadius: 3, cursor: 'pointer', color: showRulesHelp ? t.blue : t.textFaint, fontSize: 11, padding: '1px 7px', marginLeft: 4, flexShrink: 0 }}
          >
            ℹ
          </button>
        </div>
        {filtered.length === 0 && (
          <div style={{ padding: '20px 16px', color: t.textFaintest, fontSize: 13 }}>No rules defined.</div>
        )}
        {filtered.map(({ node_id, idx, pair, kind }) => {
          const key = pairKey(node_id, kind, idx)
          const isDefaultReason = pair.reason === 'Pair is not allowed' || pair.reason === 'Only this pair is allowed at this node'
          return (
            <div key={key} style={rowStyle(editId === key)}>
              <div style={{ display: 'flex', alignItems: 'center', padding: '7px 12px', minHeight: 36 }}>
                <div style={cell(1)}>{typeBadge(kind)}</div>
                <div style={cell(1.5)}><code style={{ fontSize: 11 }}>{node_id}</code></div>
                <div style={cell(1.5)}><code style={{ fontSize: 11 }}>{pair.system_a}</code></div>
                <div style={cell(1.5)}><code style={{ fontSize: 11 }}>{pair.system_b}</code></div>
                <div style={{ ...cell(4), color: t.textMuted, fontStyle: isDefaultReason ? 'italic' : 'normal' }}>{pair.reason}</div>
                <ActionsCell
                  id={key}
                  onEdit={() => startEdit(key, { system_a: pair.system_a, system_b: pair.system_b, reason: pair.reason, kind })}
                  onDelete={() => deletePair(node_id, idx, kind)}
                />
              </div>
              {editId === key && (
                <div style={{ ...editFormRow, gridTemplateColumns: '1.2fr 1fr 1fr 3fr' }}>
                  <Field label="Rule Type" k="kind"     src={editValues} setSrc={setEditValues} options={kindOpts} />
                  <Field label="System A"  k="system_a" src={editValues} setSrc={setEditValues} />
                  <Field label="System B"  k="system_b" src={editValues} setSrc={setEditValues} />
                  <Field label="Reason"    k="reason"   src={editValues} setSrc={setEditValues} />
                  <SaveCancel
                    onSave={() => savePairEdit(node_id, idx, kind)}
                    onCancel={() => setEditId(null)}
                  />
                </div>
              )}
            </div>
          )
        })}
        {(blacklistCount + whitelistCount) > 0 && (
          <div style={{ padding: '8px 16px', fontSize: 11, color: t.textFaintest, borderTop: `1px solid ${t.borderSubtle}` }}>
            {rules.length} node rule{rules.length !== 1 ? 's' : ''} · {blacklistCount} blacklist pair{blacklistCount !== 1 ? 's' : ''} · {whitelistCount} whitelist pair{whitelistCount !== 1 ? 's' : ''}
          </div>
        )}
      </>
    )
  }

  // ── Checks tab ────────────────────────────────────────────────────────────────

  const [checkResults, setCheckResults] = useState<CheckResult[] | null>(null)
  const [checkLoading, setCheckLoading] = useState(false)
  const [checkError, setCheckError] = useState<string | null>(null)
  const [reseedStatus, setReseedStatus] = useState<string | null>(null)
  const [reseedLoading, setReseedLoading] = useState(false)

  async function runChecks() {
    setCheckLoading(true); setCheckError(null)
    try {
      const res = await api.getChecks()
      setCheckResults(res.checks)
    } catch {
      setCheckError('Failed to reach backend — is it running?')
    } finally {
      setCheckLoading(false)
    }
  }

  useEffect(() => { if (tab === 'checks' && checkResults === null) runChecks() }, [tab])

  function ChecksTab() {
    const errors   = checkResults?.filter(c => !c.passed && c.severity === 'error')   ?? []
    const warnings = checkResults?.filter(c => !c.passed && c.severity === 'warning') ?? []
    const passed   = checkResults?.filter(c => c.passed) ?? []
    const allPassed = checkResults !== null && errors.length === 0

    const dot = (color: string) => (
      <div style={{ width: 9, height: 9, borderRadius: '50%', background: color, flexShrink: 0, marginTop: 2 }} />
    )

    const rowItem = (c: CheckResult) => (
      <div key={c.name} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '6px 0', borderBottom: `1px solid ${t.border}` }}>
        {dot(c.passed ? '#a6e3a1' : c.severity === 'warning' ? '#f9e2af' : '#f38ba8')}
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: t.text }}>{c.name}</div>
          {!c.passed && c.message && (
            <div style={{ fontSize: 11, color: t.textFaint, marginTop: 2, fontFamily: 'monospace', wordBreak: 'break-all' }}>
              {c.message}
            </div>
          )}
        </div>
      </div>
    )

    async function runReseed() {
      setReseedLoading(true); setReseedStatus(null)
      try {
        const r = await api.adminReseed()
        if (r.status === 'skipped') {
          setReseedStatus(`Skipped — ${r.reason}`)
        } else {
          const counts = r.reseeded!
          setReseedStatus(`Reseeded: ${counts.segments} segments · ${counts.nodes} nodes · ${counts.systems} systems · ${counts.capacity} capacity · ${counts.outages} outages · ${counts.rules} rules`)
          onDataChange()
        }
      } catch (e) {
        setReseedStatus(`Error: ${e}`)
      } finally {
        setReseedLoading(false)
      }
    }

    return (
      <div style={{ padding: '20px 24px', maxWidth: 680 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <button
            onClick={runChecks}
            disabled={checkLoading}
            style={{ padding: '6px 16px', borderRadius: 4, border: `1px solid ${t.blue}`, background: 'transparent', color: t.blue, fontWeight: 600, fontSize: 12, cursor: checkLoading ? 'not-allowed' : 'pointer' }}
          >
            {checkLoading ? 'Running…' : '↻ Re-run checks'}
          </button>
          {checkResults !== null && !checkLoading && (
            <span style={{ fontSize: 12, color: allPassed ? '#a6e3a1' : '#f38ba8', fontWeight: 600 }}>
              {allPassed ? `✓ All ${checkResults.length} checks passed` : `✗ ${errors.length} error${errors.length !== 1 ? 's' : ''}${warnings.length > 0 ? `, ${warnings.length} warning${warnings.length !== 1 ? 's' : ''}` : ''}`}
            </span>
          )}
          {checkError && <span style={{ fontSize: 12, color: t.red }}>{checkError}</span>}
        </div>

        <div style={{ marginBottom: 24, borderRadius: 6, border: `1px solid #f38ba8`, overflow: 'hidden' }}>
          <div style={{ background: '#f38ba822', padding: '8px 14px', borderBottom: '1px solid #f38ba8', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 14 }}>⚠️</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#f38ba8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Factory Reset — Destructive</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', background: t.bgDeep }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: t.text, marginBottom: 2 }}>Reseed from JSON</div>
              <div style={{ fontSize: 11, color: t.textFaint }}>
                Wipes all data in Postgres and replaces it with the bundled JSON files from the deployed build.
                <strong style={{ color: '#f38ba8' }}> Any changes made via the API (nodes, segments, systems, rules) will be permanently lost.</strong>
                {' '}Only use this to recover from a corrupted database or after a deliberate JSON baseline update.
              </div>
              {reseedStatus && (
                <div style={{ fontSize: 11, marginTop: 6, color: reseedStatus.startsWith('Error') ? t.red : t.green }}>
                  {reseedStatus}
                </div>
              )}
            </div>
            <button
              onClick={runReseed}
              disabled={reseedLoading}
              style={{ padding: '6px 14px', borderRadius: 4, border: `1px solid #f38ba8`, background: 'transparent', color: '#f38ba8', fontWeight: 600, fontSize: 12, cursor: reseedLoading ? 'not-allowed' : 'pointer', flexShrink: 0 }}
            >
              {reseedLoading ? 'Reseeding…' : '⟳ Reseed from JSON'}
            </button>
          </div>
        </div>

        {checkLoading && (
          <div style={{ color: t.textFaint, fontSize: 13 }}>Running integrity checks…</div>
        )}

        {checkResults !== null && !checkLoading && (
          <>
            {errors.length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#f38ba8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Errors — {errors.length}</div>
                {errors.map(rowItem)}
              </div>
            )}
            {warnings.length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#f9e2af', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Warnings — {warnings.length}</div>
                {warnings.map(rowItem)}
              </div>
            )}
            {passed.length > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: t.textFaint, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Passed — {passed.length}</div>
                {passed.map(rowItem)}
              </div>
            )}
          </>
        )}
      </div>
    )
  }

  // ── Config tab ───────────────────────────────────────────────────────────────

  function ConfigTab() {
    const allOwnership = [
      { value: 'owned',                label: 'Owned' },
      { value: 'consortium',           label: 'Consortium' },
      { value: 'iru',                  label: 'IRU' },
      { value: 'integrated_lit_lease', label: 'Integrated Lit Lease' },
      { value: 'offnet_resell',        label: 'Offnet Resell' },
    ]
    return (
      <div style={{ padding: '20px 24px', maxWidth: 480 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: t.text, marginBottom: 4 }}>Network Classification</div>
        <div style={{ fontSize: 11, color: t.textFaint, marginBottom: 16 }}>
          Controls which ownership types are treated as On-Net vs Off-Net throughout the app.
          Changes are saved to the backend and apply globally.
        </div>
        <div style={{ border: `1px solid ${t.border}`, borderRadius: 6, overflow: 'hidden' }}>
          {/* Header */}
          <div style={{ display: 'flex', padding: '6px 12px', background: t.bgDeep, borderBottom: `1px solid ${t.border}` }}>
            <div style={{ flex: 1, fontSize: 10, fontWeight: 700, color: t.textFaint, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Ownership Type</div>
            <div style={{ width: 110, fontSize: 10, fontWeight: 700, color: t.textFaint, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Network</div>
          </div>
          {allOwnership.map(({ value, label }) => {
            const onNet = isOnNet(value)
            return (
              <div key={value} style={{ display: 'flex', alignItems: 'center', padding: '10px 12px', borderBottom: `1px solid ${t.border}` }}>
                <div style={{ flex: 1, fontSize: 13, color: t.text }}>{label}</div>
                <div style={{ width: 110, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 3,
                    letterSpacing: '0.04em',
                    background: onNet ? '#a6e3a122' : '#f9e2af22',
                    color: onNet ? '#a6e3a1' : '#f9e2af',
                    border: `1px solid ${onNet ? '#a6e3a144' : '#f9e2af44'}`,
                  }}>
                    {onNet ? 'ON-NET' : 'OFF-NET'}
                  </span>
                  <button
                    onClick={() => toggleOnNet(value)}
                    title="Toggle On-Net / Off-Net"
                    style={{
                      fontSize: 11, padding: '2px 8px', borderRadius: 3, cursor: 'pointer',
                      border: `1px solid ${t.border}`, background: t.bgCard, color: t.textMuted,
                    }}
                  >
                    ⇄
                  </button>
                </div>
              </div>
            )
          })}
        </div>
        <button
          onClick={async () => {
            setOnNetOwnership(new Set(DEFAULT_ONNET))
            await api.updateConfig({ on_net_ownership: DEFAULT_ONNET })
            onDataChange()
          }}
          style={{ marginTop: 12, fontSize: 11, padding: '4px 10px', borderRadius: 4, cursor: 'pointer', border: `1px solid ${t.border}`, background: 'transparent', color: t.textMuted }}
        >
          Reset to defaults
        </button>
      </div>
    )
  }

  // ── Counts & add defaults ────────────────────────────────────────────────────

  const totalPairs = rules.reduce((n, r) => n + r.disallowed_pairs.length + (r.allowed_pairs?.length ?? 0), 0)
  const counts: Record<DataTab, number> = { nodes: nodes.length, segments: segments.length, systems: systems.length, capacity: capacity.length, outages: outages.length, rules: totalPairs }
  const addDefaults: Record<DataTab, Record<string, unknown>> = {
    nodes:    { id: '', name: '', country: '', type: 'landing_station', lat: 0, lng: 0, owner: 'Telstra', trading_name: '', description: '' },
    segments: { id: '', name: '', system_id: '', start_node_id: '', end_node_id: '', type: 'wet', length_km: 0, latency: 0, cost_weight: 1, reliability: 0.9999, ownership: 'consortium' },
    systems:  { id: '', name: '', description: '', margin: 8 },
    capacity: { segment_id: '', total_capacity_t: 1.0, available_capacity_t: 1.0 },
    outages:  { segment_id: '', fault_id: '', fault_date: '', repair_start: '', estimated_repair_date: 'TBC', description: '' },
    rules:    { node_id: '', kind: 'blacklist', system_a: '', system_b: '', reason: '' },
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div style={modalBg} onClick={onClose}>
      <div style={modalBox} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', padding: '14px 20px', borderBottom: `1px solid ${t.border}`, flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: t.text }}>Reference Data</div>
            <div style={{ fontSize: 11, color: t.textFaint }}>View and edit network reference data — changes persist immediately to the backend</div>
          </div>
          <button onClick={onClose} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: t.textFaint, fontSize: 20, lineHeight: 1, padding: '2px 6px' }}>×</button>
        </div>

        {/* Tab bar + filter + add */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 20px', borderBottom: `1px solid ${t.border}`, flexShrink: 0, background: t.bgDeep }}>
          {(['nodes', 'segments', 'systems', 'capacity', 'outages', 'rules'] as DataTab[]).map(tb => (
            <button key={tb} onClick={() => switchTab(tb)} style={{
              padding: '10px 14px', border: 'none', background: 'transparent', cursor: 'pointer',
              fontSize: 12, fontWeight: tab === tb ? 700 : 400,
              color: tab === tb ? t.blue : t.textFaint,
              borderBottom: tab === tb ? `2px solid ${t.blue}` : '2px solid transparent',
              textTransform: 'capitalize',
            }}>
              {tb} <span style={{ fontSize: 10, opacity: 0.7 }}>({counts[tb]})</span>
            </button>
          ))}
          <button onClick={() => switchTab('checks')} style={{
            padding: '10px 14px', border: 'none', background: 'transparent', cursor: 'pointer',
            fontSize: 12, fontWeight: tab === 'checks' ? 700 : 400,
            color: tab === 'checks' ? t.blue : t.textFaint,
            borderBottom: tab === 'checks' ? `2px solid ${t.blue}` : '2px solid transparent',
          }}>
            ⚡ Checks
          </button>
          <button onClick={() => switchTab('config')} style={{
            padding: '10px 14px', border: 'none', background: 'transparent', cursor: 'pointer',
            fontSize: 12, fontWeight: tab === 'config' ? 700 : 400,
            color: tab === 'config' ? t.blue : t.textFaint,
            borderBottom: tab === 'config' ? `2px solid ${t.blue}` : '2px solid transparent',
          }}>
            ⚙ Config
          </button>
          <button onClick={() => switchTab('coverage')} style={{
            padding: '10px 14px', border: 'none', background: 'transparent', cursor: 'pointer',
            fontSize: 12, fontWeight: tab === 'coverage' ? 700 : 400,
            color: tab === 'coverage' ? t.green : t.textFaint,
            borderBottom: tab === 'coverage' ? `2px solid ${t.green}` : '2px solid transparent',
          }}>
            🟢 Product Coverage
          </button>
          <button onClick={() => switchTab('bulk')} style={{
            padding: '10px 14px', border: 'none', background: 'transparent', cursor: 'pointer',
            fontSize: 12, fontWeight: tab === 'bulk' ? 700 : 400,
            color: tab === 'bulk' ? '#0ea5e9' : t.textFaint,
            borderBottom: tab === 'bulk' ? '2px solid #0ea5e9' : '2px solid transparent',
          }}>
            🔄 Bulk Import
          </button>
          {tab !== 'checks' && tab !== 'config' && tab !== 'coverage' && tab !== 'bulk' && (
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                placeholder={`Filter ${tab}…`}
                value={filter}
                onChange={e => setFilter(e.target.value)}
                style={{ ...inputStyle, width: 180, padding: '5px 8px' }}
              />
              <button
                onClick={() => startAdd(addDefaults[tab as DataTab])}
                style={{ ...actionBtn('add'), padding: '5px 12px' }}
              >
                + Add {tab === 'rules' ? 'pair' : tab.slice(0, -1)}
              </button>
            </div>
          )}
        </div>

        {/* Table body */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {tab === 'nodes'    && <NodeTab />}
          {tab === 'segments' && <SegmentTab />}
          {tab === 'systems'  && <SystemTab />}
          {tab === 'capacity' && CapacityTab()}
          {tab === 'outages'  && <OutagesTab />}
          {tab === 'rules'    && <RulesTab />}
          {tab === 'checks'   && <ChecksTab />}
          {tab === 'config'   && <ConfigTab />}
          {tab === 'coverage' && <ProductCoveragePanel nodes={nodes} onDataChange={onDataChange} />}
          {tab === 'bulk' && (
            <BulkImportPanel
              counts={{
                nodes:    nodes.length,
                segments: segments.length,
                systems:  systems.filter(s => s.id !== 'TERRESTRIAL').length,
                capacity: capacity.length,
                coverage: nodes.filter(n => n.capabilities).length,
              }}
              onDataChange={onDataChange}
            />
          )}
        </div>

      </div>
    </div>
  )
}
