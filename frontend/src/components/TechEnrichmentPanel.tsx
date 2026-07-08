/**
 * TechEnrichmentPanel — admin CRUD editor for the "tech lookup" reference tables.
 *
 * These seven lookup tables (service types, bandwidths, protections, frame sizes,
 * access types, arranged-by, L1 settings) populate the dropdown options used when
 * enriching a circuit with technical details elsewhere in the app. The panel shows
 * a left sidebar to pick the active table and a right-hand table of its entries,
 * with inline row editing, deletion (behind a confirm() prompt) and an "add row"
 * form. New entry IDs are slugified from the label (lowercase, dashes); display
 * order is a numeric "order" column, auto-suggested as max+10 for new rows.
 *
 * Props: none — the panel is fully self-contained and loads its own data.
 *
 * Mounted from: RefDataModal.tsx ("Tech Enrichment" tab of the reference-data
 * admin modal, which is opened from App.tsx).
 *
 * Backend endpoints (via api client):
 *   - GET    /api/tech-lookups/{table}        load entries for the active table
 *   - POST   /api/tech-lookups/{table}        create a new entry
 *   - PUT    /api/tech-lookups/{table}/{id}   save an inline edit
 *   - DELETE /api/tech-lookups/{table}/{id}   remove an entry
 */
import { useState, useEffect } from 'react'
import { useTheme } from '../theme'
import { api } from '../api/client'
import type { TechLookupItem, TechLookupTable } from '../types'
import { TECH_LOOKUP_LABELS } from '../types'

const TABLES: TechLookupTable[] = [
  'tech_service_types',
  'tech_bandwidths',
  'tech_protections',
  'tech_frame_sizes',
  'tech_access_types',
  'tech_arranged_by',
  'tech_l1_settings',
]

function genId(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export function TechEnrichmentPanel() {
  const t = useTheme()
  const [activeTable, setActiveTable] = useState<TechLookupTable>('tech_service_types')
  const [items, setItems]             = useState<TechLookupItem[]>([])
  const [loading, setLoading]         = useState(false)
  const [saving, setSaving]           = useState(false)
  const [error, setError]             = useState<string | null>(null)

  // Inline edit state
  const [editingId, setEditingId]     = useState<string | null>(null)
  const [editLabel, setEditLabel]     = useState('')
  const [editDesc, setEditDesc]       = useState('')
  const [editOrder, setEditOrder]     = useState(0)

  // New row state
  const [adding, setAdding]           = useState(false)
  const [newLabel, setNewLabel]       = useState('')
  const [newDesc, setNewDesc]         = useState('')
  const [newOrder, setNewOrder]       = useState(0)

  useEffect(() => {
    load(activeTable)
  }, [activeTable])

  async function load(table: TechLookupTable) {
    setLoading(true)
    setError(null)
    setEditingId(null)
    setAdding(false)
    try {
      const data = await api.getTechLookup(table)
      setItems(data)
    } catch {
      setError('Failed to load')
    } finally {
      setLoading(false)
    }
  }

  function startEdit(item: TechLookupItem) {
    setEditingId(item.id)
    setEditLabel(item.label)
    setEditDesc(item.description ?? '')
    setEditOrder(item.order)
    setAdding(false)
  }

  async function saveEdit(id: string) {
    setSaving(true)
    try {
      const updated = await api.updateTechItem(activeTable, id, {
        label: editLabel, description: editDesc || undefined, order: editOrder,
      })
      setItems(prev => prev.map(i => i.id === id ? updated : i).sort((a, b) => a.order - b.order))
      setEditingId(null)
    } catch {
      setError('Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function deleteItem(id: string) {
    if (!confirm('Delete this entry?')) return
    setSaving(true)
    try {
      await api.deleteTechItem(activeTable, id)
      setItems(prev => prev.filter(i => i.id !== id))
    } catch {
      setError('Delete failed')
    } finally {
      setSaving(false)
    }
  }

  function startAdd() {
    const nextOrder = items.length > 0 ? Math.max(...items.map(i => i.order)) + 10 : 10
    setNewLabel('')
    setNewDesc('')
    setNewOrder(nextOrder)
    setAdding(true)
    setEditingId(null)
  }

  async function saveNew() {
    if (!newLabel.trim()) return
    setSaving(true)
    try {
      const item = await api.createTechItem(activeTable, {
        id: genId(newLabel), label: newLabel.trim(),
        description: newDesc.trim() || undefined, order: newOrder,
      })
      setItems(prev => [...prev, item].sort((a, b) => a.order - b.order))
      setAdding(false)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Create failed')
    } finally {
      setSaving(false)
    }
  }

  const inputStyle: React.CSSProperties = {
    background: t.bgBase, border: `1px solid ${t.border}`, borderRadius: 4,
    color: t.text, fontSize: 12, padding: '4px 7px', fontFamily: 'inherit', outline: 'none',
  }

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>

      {/* Left sidebar — table selector */}
      <div style={{
        width: 190, flexShrink: 0, borderRight: `1px solid ${t.border}`,
        overflowY: 'auto', padding: '12px 0',
      }}>
        <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: t.textFaint, padding: '0 14px 8px' }}>
          Lookup Tables
        </div>
        {TABLES.map(tbl => (
          <button
            key={tbl}
            onClick={() => setActiveTable(tbl)}
            style={{
              width: '100%', textAlign: 'left', padding: '8px 14px',
              border: 'none', cursor: 'pointer', fontFamily: 'inherit',
              background: activeTable === tbl ? `${t.blue}18` : 'transparent',
              color: activeTable === tbl ? t.blue : t.text,
              fontWeight: activeTable === tbl ? 700 : 400,
              fontSize: 12,
              borderLeft: activeTable === tbl ? `3px solid ${t.blue}` : '3px solid transparent',
            }}
          >
            {TECH_LOOKUP_LABELS[tbl]}
          </button>
        ))}
      </div>

      {/* Right — table content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Header */}
        <div style={{
          flexShrink: 0, padding: '12px 16px', borderBottom: `1px solid ${t.border}`,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: t.text }}>{TECH_LOOKUP_LABELS[activeTable]}</div>
            <div style={{ fontSize: 11, color: t.textFaint }}>{items.length} entries · used in circuit enrichment dropdowns</div>
          </div>
          <button
            onClick={startAdd}
            style={{
              marginLeft: 'auto', padding: '6px 14px', borderRadius: 5,
              border: 'none', background: t.blue, color: '#fff',
              fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
            }}
          >+ Add</button>
        </div>

        {error && (
          <div style={{ padding: '8px 16px', background: `${t.red}22`, color: t.red, fontSize: 12 }}>{error}</div>
        )}

        {/* Table */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading ? (
            <div style={{ padding: 24, color: t.textFaint, fontSize: 13 }}>Loading…</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${t.border}`, background: t.bgDeep }}>
                  <th style={{ padding: '7px 12px', textAlign: 'left', color: t.textMuted, fontWeight: 600, width: 50 }}>Order</th>
                  <th style={{ padding: '7px 12px', textAlign: 'left', color: t.textMuted, fontWeight: 600, width: 160 }}>Label</th>
                  <th style={{ padding: '7px 12px', textAlign: 'left', color: t.textMuted, fontWeight: 600 }}>Description</th>
                  <th style={{ padding: '7px 12px', textAlign: 'left', color: t.textMuted, fontWeight: 600, width: 55 }}>ID</th>
                  <th style={{ padding: '7px 12px', width: 80 }} />
                </tr>
              </thead>
              <tbody>
                {items.map(item => (
                  <tr
                    key={item.id}
                    style={{ borderBottom: `1px solid ${t.border}`, background: editingId === item.id ? `${t.blue}0a` : 'transparent' }}
                  >
                    {editingId === item.id ? (
                      <>
                        <td style={{ padding: '6px 12px' }}>
                          <input type="number" value={editOrder} onChange={e => setEditOrder(Number(e.target.value))}
                            style={{ ...inputStyle, width: 45 }} />
                        </td>
                        <td style={{ padding: '6px 12px' }}>
                          <input value={editLabel} onChange={e => setEditLabel(e.target.value)}
                            style={{ ...inputStyle, width: '100%' }} autoFocus />
                        </td>
                        <td style={{ padding: '6px 12px' }}>
                          <input value={editDesc} onChange={e => setEditDesc(e.target.value)}
                            style={{ ...inputStyle, width: '100%' }} placeholder="Optional description" />
                        </td>
                        <td style={{ padding: '6px 12px', color: t.textFaintest, fontFamily: 'monospace' }}>{item.id}</td>
                        <td style={{ padding: '6px 12px' }}>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button onClick={() => saveEdit(item.id)} disabled={saving}
                              style={{ padding: '3px 8px', borderRadius: 4, border: 'none', background: t.green, color: '#fff', cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>
                              ✓
                            </button>
                            <button onClick={() => setEditingId(null)}
                              style={{ padding: '3px 8px', borderRadius: 4, border: `1px solid ${t.border}`, background: 'transparent', color: t.textMuted, cursor: 'pointer', fontSize: 11 }}>
                              ✕
                            </button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td style={{ padding: '7px 12px', color: t.textFaintest }}>{item.order}</td>
                        <td style={{ padding: '7px 12px', color: t.text, fontWeight: 600 }}>{item.label}</td>
                        <td style={{ padding: '7px 12px', color: t.textMuted }}>{item.description ?? '—'}</td>
                        <td style={{ padding: '7px 12px', color: t.textFaintest, fontFamily: 'monospace', fontSize: 10 }}>{item.id}</td>
                        <td style={{ padding: '7px 12px' }}>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button onClick={() => startEdit(item)}
                              style={{ padding: '3px 8px', borderRadius: 4, border: `1px solid ${t.border}`, background: 'transparent', color: t.textMuted, cursor: 'pointer', fontSize: 11 }}>
                              Edit
                            </button>
                            <button onClick={() => deleteItem(item.id)} disabled={saving}
                              style={{ padding: '3px 8px', borderRadius: 4, border: `1px solid ${t.red}44`, background: 'transparent', color: t.red, cursor: 'pointer', fontSize: 11 }}>
                              ✕
                            </button>
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                ))}

                {/* New row */}
                {adding && (
                  <tr style={{ borderBottom: `1px solid ${t.border}`, background: `${t.green}0a` }}>
                    <td style={{ padding: '6px 12px' }}>
                      <input type="number" value={newOrder} onChange={e => setNewOrder(Number(e.target.value))}
                        style={{ ...inputStyle, width: 45 }} />
                    </td>
                    <td style={{ padding: '6px 12px' }}>
                      <input value={newLabel} onChange={e => setNewLabel(e.target.value)}
                        style={{ ...inputStyle, width: '100%' }} placeholder="Label *" autoFocus />
                    </td>
                    <td style={{ padding: '6px 12px' }}>
                      <input value={newDesc} onChange={e => setNewDesc(e.target.value)}
                        style={{ ...inputStyle, width: '100%' }} placeholder="Optional description" />
                    </td>
                    <td style={{ padding: '6px 12px', color: t.textFaintest, fontSize: 10, fontFamily: 'monospace' }}>
                      {newLabel ? genId(newLabel) : '—'}
                    </td>
                    <td style={{ padding: '6px 12px' }}>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button onClick={saveNew} disabled={!newLabel.trim() || saving}
                          style={{ padding: '3px 8px', borderRadius: 4, border: 'none', background: t.green, color: '#fff', cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>
                          ✓ Add
                        </button>
                        <button onClick={() => setAdding(false)}
                          style={{ padding: '3px 8px', borderRadius: 4, border: `1px solid ${t.border}`, background: 'transparent', color: t.textMuted, cursor: 'pointer', fontSize: 11 }}>
                          ✕
                        </button>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
