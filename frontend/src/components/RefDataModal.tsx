import { useState } from 'react'
import type { CableNode, CableSegment, CableSystem, SegmentCapacity } from '../types'
import { useTheme } from '../theme'
import { api } from '../api/client'

type Tab = 'nodes' | 'segments' | 'systems' | 'capacity'

interface Props {
  nodes: CableNode[]
  segments: CableSegment[]
  systems: CableSystem[]
  capacity: SegmentCapacity[]
  onDataChange: () => void
  onClose: () => void
}

export function RefDataModal({ nodes, segments, systems, capacity, onDataChange, onClose }: Props) {
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

  function Field({ label, val, k, src, setSrc, readOnly = false, type = 'text', options }: {
    label: string; val?: unknown; k: string
    src: Record<string, unknown>; setSrc: (v: Record<string, unknown>) => void
    readOnly?: boolean; type?: string; options?: { value: string; label: string }[]
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
          <input style={inputStyle} type={type} step={type === 'number' ? 'any' : undefined}
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

  const typeOpts    = [{ value: 'landing_station', label: 'CLS (Landing Station)' }, { value: 'terrestrial_pop', label: 'POP (Terrestrial)' }]
  const segTypeOpts = [{ value: 'wet', label: 'Wet' }, { value: 'terrestrial', label: 'Terrestrial' }]
  const ownerOpts   = [{ value: 'owned', label: 'Owned' }, { value: 'iru', label: 'IRU' }, { value: 'consortium', label: 'Consortium' }]
  const systemOpts  = systems.map(s => ({ value: s.id, label: `${s.id} — ${s.name}` }))

  // ── Nodes tab ───────────────────────────────────────────────────────────────

  function NodeTab() {
    const filtered = nodes.filter(n =>
      !filter || n.name.toLowerCase().includes(filter.toLowerCase()) || n.id.toLowerCase().includes(filter.toLowerCase())
    )
    return (
      <>
        {adding && (
          <div style={{ ...editFormRow, gridTemplateColumns: 'repeat(6, 1fr)' }}>
            <Field label="ID *"      k="id"      src={addValues} setSrc={setAddValues} />
            <Field label="Name *"    k="name"    src={addValues} setSrc={setAddValues} />
            <Field label="Country"   k="country" src={addValues} setSrc={setAddValues} />
            <Field label="Type"      k="type"    src={addValues} setSrc={setAddValues} options={typeOpts} />
            <Field label="Lat"       k="lat"     src={addValues} setSrc={setAddValues} type="number" />
            <Field label="Lng"       k="lng"     src={addValues} setSrc={setAddValues} type="number" />
            <SaveCancel
              onSave={() => saveAdd(() => api.createNode(addValues as unknown as CableNode))}
              onCancel={() => { setAdding(false); setAddValues({}) }}
            />
          </div>
        )}
        <div style={{ display: 'flex', padding: '6px 12px', borderBottom: `1px solid ${t.border}`, background: t.bgDeep }}>
          <div style={colH(2)}>ID</div><div style={colH(3)}>Name</div><div style={colH(1)}>Country</div>
          <div style={colH(2)}>Type</div><div style={colH(1.5)}>Lat</div><div style={colH(1.5)}>Lng</div>
          <div style={{ width: 140 }} />
        </div>
        {filtered.map(n => (
          <div key={n.id} style={rowStyle(editId === n.id)}>
            <div style={{ display: 'flex', alignItems: 'center', padding: '7px 12px', minHeight: 36 }}>
              <div style={cell(2)}><code style={{ fontSize: 11 }}>{n.id}</code></div>
              <div style={cell(3)}>{n.name}</div>
              <div style={cell(1)}>{n.country}</div>
              <div style={cell(2)}>{n.type === 'landing_station' ? 'CLS' : 'POP'}</div>
              <div style={cell(1.5)}>{n.lat}</div>
              <div style={cell(1.5)}>{n.lng}</div>
              <ActionsCell id={n.id}
                onEdit={() => startEdit(n.id, { name: n.name, country: n.country, type: n.type, lat: n.lat, lng: n.lng })}
                onDelete={() => confirmDelete(() => api.deleteNode(n.id))}
              />
            </div>
            {editId === n.id && (
              <div style={{ ...editFormRow, gridTemplateColumns: 'repeat(5, 1fr)' }}>
                <Field label="Name"    k="name"    src={editValues} setSrc={setEditValues} />
                <Field label="Country" k="country" src={editValues} setSrc={setEditValues} />
                <Field label="Type"    k="type"    src={editValues} setSrc={setEditValues} options={typeOpts} />
                <Field label="Lat"     k="lat"     src={editValues} setSrc={setEditValues} type="number" />
                <Field label="Lng"     k="lng"     src={editValues} setSrc={setEditValues} type="number" />
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
          <div style={colH(2)}>ID</div><div style={colH(3)}>Name</div><div style={colH(1.5)}>System</div>
          <div style={colH(1)}>Type</div><div style={colH(1.5)}>Length</div><div style={colH(1)}>Latency</div>
          <div style={colH(1)}>Cost</div><div style={colH(1.5)}>Ownership</div>
          <div style={{ width: 140 }} />
        </div>
        {filtered.map(s => (
          <div key={s.id} style={rowStyle(editId === s.id)}>
            <div style={{ display: 'flex', alignItems: 'center', padding: '7px 12px', minHeight: 36 }}>
              <div style={cell(2)}><code style={{ fontSize: 11 }}>{s.id}</code></div>
              <div style={cell(3)}>{s.name}</div>
              <div style={cell(1.5)}>{s.system_id}</div>
              <div style={cell(1)}>{s.type}</div>
              <div style={cell(1.5)}>{s.length_km.toLocaleString()} km</div>
              <div style={cell(1)}>{s.latency} ms</div>
              <div style={cell(1)}>{s.cost_weight}</div>
              <div style={cell(1.5)}>{s.ownership}</div>
              <ActionsCell id={s.id}
                onEdit={() => startEdit(s.id, { name: s.name, system_id: s.system_id, start_node_id: s.start_node_id, end_node_id: s.end_node_id, type: s.type, length_km: s.length_km, latency: s.latency, cost_weight: s.cost_weight, reliability: s.reliability, ownership: s.ownership })}
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
                <SaveCancel
                  onSave={() => saveEdit(() => api.updateSegment(s.id, editValues as Partial<CableSegment>))}
                  onCancel={() => setEditId(null)}
                />
              </div>
            )}
          </div>
        ))}
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
          <div style={{ ...editFormRow, gridTemplateColumns: 'repeat(3, 1fr)' }}>
            <Field label="ID *"          k="id"          src={addValues} setSrc={setAddValues} />
            <Field label="Name *"        k="name"        src={addValues} setSrc={setAddValues} />
            <Field label="Description"   k="description" src={addValues} setSrc={setAddValues} />
            <SaveCancel
              onSave={() => saveAdd(() => api.createSystem(addValues as unknown as CableSystem))}
              onCancel={() => { setAdding(false); setAddValues({}) }}
            />
          </div>
        )}
        <div style={{ display: 'flex', padding: '6px 12px', borderBottom: `1px solid ${t.border}`, background: t.bgDeep }}>
          <div style={colH(1.5)}>ID</div><div style={colH(3)}>Name</div><div style={colH(5)}>Description</div>
          <div style={{ width: 140 }} />
        </div>
        {filtered.map(s => (
          <div key={s.id} style={rowStyle(editId === s.id)}>
            <div style={{ display: 'flex', alignItems: 'center', padding: '7px 12px', minHeight: 36 }}>
              <div style={cell(1.5)}><code style={{ fontSize: 11 }}>{s.id}</code></div>
              <div style={cell(3)}>{s.name}</div>
              <div style={cell(5)}>{s.description}</div>
              <ActionsCell id={s.id}
                onEdit={() => startEdit(s.id, { name: s.name, description: s.description })}
                onDelete={() => confirmDelete(() => api.deleteSystem(s.id))}
              />
            </div>
            {editId === s.id && (
              <div style={{ ...editFormRow, gridTemplateColumns: '1fr 2fr' }}>
                <Field label="Name"        k="name"        src={editValues} setSrc={setEditValues} />
                <Field label="Description" k="description" src={editValues} setSrc={setEditValues} />
                <SaveCancel
                  onSave={() => saveEdit(() => api.updateSystem(s.id, editValues as Partial<CableSystem>))}
                  onCancel={() => setEditId(null)}
                />
              </div>
            )}
          </div>
        ))}
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
            <Field label="Segment ID *"  k="segment_id"          src={addValues} setSrc={setAddValues} />
            <Field label="Total (T)"     k="total_capacity_t"    src={addValues} setSrc={setAddValues} type="number" />
            <Field label="Available (T)" k="available_capacity_t" src={addValues} setSrc={setAddValues} type="number" />
            <SaveCancel
              onSave={() => saveAdd(() => api.createCapacity(addValues as unknown as SegmentCapacity))}
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
                  <Field label="Total (T)"     k="total_capacity_t"     src={editValues} setSrc={setEditValues} type="number" />
                  <Field label="Available (T)" k="available_capacity_t" src={editValues} setSrc={setEditValues} type="number" />
                  <SaveCancel
                    onSave={() => saveEdit(() => api.updateCapacity(c.segment_id, editValues as Partial<SegmentCapacity>))}
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

  // ── Counts & add defaults ────────────────────────────────────────────────────

  const counts: Record<Tab, number> = { nodes: nodes.length, segments: segments.length, systems: systems.length, capacity: capacity.length }
  const addDefaults: Record<Tab, Record<string, unknown>> = {
    nodes:    { id: '', name: '', country: '', type: 'landing_station', lat: 0, lng: 0 },
    segments: { id: '', name: '', system_id: '', start_node_id: '', end_node_id: '', type: 'wet', length_km: 0, latency: 0, cost_weight: 1, reliability: 0.9999, ownership: 'consortium' },
    systems:  { id: '', name: '', description: '' },
    capacity: { segment_id: '', total_capacity_t: 1.0, available_capacity_t: 1.0 },
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
          {(['nodes', 'segments', 'systems', 'capacity'] as Tab[]).map(tb => (
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
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              placeholder={`Filter ${tab}…`}
              value={filter}
              onChange={e => setFilter(e.target.value)}
              style={{ ...inputStyle, width: 180, padding: '5px 8px' }}
            />
            <button
              onClick={() => startAdd(addDefaults[tab])}
              style={{ ...actionBtn('add'), padding: '5px 12px' }}
            >
              + Add {tab.slice(0, -1)}
            </button>
          </div>
        </div>

        {/* Table body */}
        <div style={{ flex: 1, overflowY: 'auto', fontFamily: 'system-ui, sans-serif' }}>
          {tab === 'nodes'    && <NodeTab />}
          {tab === 'segments' && <SegmentTab />}
          {tab === 'systems'  && <SystemTab />}
          {tab === 'capacity' && <CapacityTab />}
        </div>

      </div>
    </div>
  )
}
