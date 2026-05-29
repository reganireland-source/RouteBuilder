import { useEffect, useRef, useState } from 'react'
import { useTheme } from '../theme'
import { api } from '../api/client'
import type { CableNode, EndpointConfig, InterfaceType, Project, ProjectCircuit, Route, SldConfig } from '../types'
import { DEFAULT_SLD_CONFIG } from '../types'

interface Props {
  nodes: CableNode[]
  onClose: () => void
  initialProject?: string | null
  pendingCircuit?: { route: Route; protectRoute?: Route; searchLabel: string }
  onRestorePins?: (circuits: import('../types').ProjectCircuit[]) => void
}

type ModalTab = 'list' | 'detail'
type DetailTab = 'info' | 'circuits' | 'sld'

const ACCESS_TYPES = ['X-Connect', 'Local Loop', 'Direct']
const ARRANGED_BY = ['Customer', 'Telstra']
const LL_ARRANGED_BY = ['Customer', 'Service Provider']
const SERVICE_TYPES = ['EPL', 'EVPL', 'IPT', 'IPVPN', 'GID', 'Wavelength', 'Dark Fibre']
const PROTECTION_TYPES = ['Unprotected (1+0)', 'Protected (1+1)', 'Dual (1+1 Shared)']

function newProject(): Project {
  return {
    id: `PRJ-${Date.now().toString(36).toUpperCase()}`,
    name: '',
    visibility: 'confidential',
    sld_config: { ...DEFAULT_SLD_CONFIG },
    circuits: [],
  }
}

export function ProjectsModal({ nodes, onClose, initialProject, pendingCircuit, onRestorePins }: Props) {
  const t = useTheme()
  const [tab, setTab] = useState<ModalTab>('list')
  const [detailTab, setDetailTab] = useState<DetailTab>('info')
  const [projects, setProjects] = useState<Project[]>([])
  const [interfaces, setInterfaces] = useState<InterfaceType[]>([])
  const [selected, setSelected] = useState<Project | null>(null)
  const [editDraft, setEditDraft] = useState<Project | null>(null)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [editingCircuit, setEditingCircuit] = useState<ProjectCircuit | null>(null)
  const [circuitDraft, setCircuitDraft] = useState<ProjectCircuit | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [pendingTargetProject, setPendingTargetProject] = useState<Project | null>(null)
  const [pendingLabel, setPendingLabel] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    Promise.all([api.getProjects(), api.getInterfaces()]).then(([p, i]) => {
      setProjects(p)
      setInterfaces(i)
      if (initialProject) {
        const found = p.find(pr => pr.id === initialProject)
        if (found) { setSelected(found); setEditDraft(found); setTab('detail') }
      }
    }).catch(() => setErr('Failed to load projects'))
  }, [initialProject])

  const nodeMap = new Map(nodes.map(n => [n.id, n]))

  const s = {
    overlay: {
      position: 'fixed' as const, inset: 0, zIndex: 9000,
      background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center',
    },
    modal: {
      background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 12,
      width: 'min(95vw, 1080px)', maxHeight: '92vh', display: 'flex', flexDirection: 'column' as const,
      overflow: 'hidden', boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
    },
    header: {
      padding: '18px 24px', borderBottom: `1px solid ${t.border}`,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    },
    body: { flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' as const },
    tabBar: {
      display: 'flex', gap: 4, padding: '12px 24px 0',
      borderBottom: `1px solid ${t.border}`,
    },
    tab: (active: boolean) => ({
      padding: '7px 18px', borderRadius: '6px 6px 0 0', fontSize: 13, fontWeight: 600,
      cursor: 'pointer', border: `1px solid ${active ? t.border : 'transparent'}`,
      borderBottom: active ? `1px solid ${t.bgCard}` : `1px solid ${t.border}`,
      background: active ? t.bgCard : 'transparent',
      color: active ? t.blue : t.textMuted, marginBottom: -1,
      transition: 'all 0.15s',
    }),
    scroll: { flex: 1, overflowY: 'auto' as const, padding: '20px 24px' },
    card: {
      background: t.bgBase, border: `1px solid ${t.border}`, borderRadius: 8,
      padding: '14px 16px', marginBottom: 10, cursor: 'pointer',
      transition: 'border-color 0.15s',
    },
    label: { fontSize: 11, fontWeight: 600, color: t.textMuted, textTransform: 'uppercase' as const, marginBottom: 4 },
    input: {
      width: '100%', background: t.bgBase, border: `1px solid ${t.border}`,
      borderRadius: 6, padding: '7px 10px', color: t.text, fontSize: 13,
      outline: 'none', boxSizing: 'border-box' as const,
    },
    select: {
      width: '100%', background: t.bgBase, border: `1px solid ${t.border}`,
      borderRadius: 6, padding: '7px 10px', color: t.text, fontSize: 13,
      outline: 'none', boxSizing: 'border-box' as const,
    },
    row: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 14 },
    row3: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 14 },
    btn: (color: string, bg: string) => ({
      padding: '7px 16px', borderRadius: 6, fontSize: 13, fontWeight: 600,
      cursor: 'pointer', border: 'none', background: bg, color: color,
    }),
    sectionHead: {
      fontSize: 12, fontWeight: 700, color: t.textMuted,
      textTransform: 'uppercase' as const, letterSpacing: 1,
      borderBottom: `1px solid ${t.border}`, paddingBottom: 6, marginBottom: 14,
    },
  }

  // ── Save project changes ──────────────────────────────────────────────────
  async function saveProject() {
    if (!editDraft) return
    setSaving(true); setErr('')
    try {
      const updated = selected
        ? await api.updateProject(editDraft.id, editDraft)
        : await api.createProject(editDraft)
      setProjects(ps => selected ? ps.map(p => p.id === updated.id ? updated : p) : [...ps, updated])
      setSelected(updated); setEditDraft(updated)
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function deleteProject(id: string) {
    await api.deleteProject(id)
    setProjects(ps => ps.filter(p => p.id !== id))
    if (selected?.id === id) { setSelected(null); setEditDraft(null); setTab('list') }
    setConfirmDelete(null)
  }

  // ── Circuit save ──────────────────────────────────────────────────────────
  async function saveCircuit() {
    if (!circuitDraft || !selected) return
    setSaving(true); setErr('')
    try {
      const isNew = !selected.circuits.find(c => c.circuit_id === circuitDraft.circuit_id)
      const updated = isNew
        ? await api.addCircuit(selected.id, circuitDraft)
        : await api.updateCircuit(selected.id, circuitDraft.circuit_id, circuitDraft)
      setProjects(ps => ps.map(p => p.id === updated.id ? updated : p))
      setSelected(updated); setEditDraft(updated)
      setEditingCircuit(null); setCircuitDraft(null)
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function removeCircuit(circuitId: string) {
    if (!selected) return
    const updated = await api.removeCircuit(selected.id, circuitId)
    setProjects(ps => ps.map(p => p.id === updated.id ? updated : p))
    setSelected(updated); setEditDraft(updated)
  }

  async function saveSldConfig(cfg: SldConfig) {
    if (!selected) return
    const updated = await api.updateSldConfig(selected.id, cfg)
    setProjects(ps => ps.map(p => p.id === updated.id ? updated : p))
    setSelected(updated); setEditDraft(updated)
  }

  function openNewProject() {
    const p = newProject()
    setSelected(null); setEditDraft(p); setTab('detail'); setDetailTab('info')
  }

  function openProject(p: Project) {
    setSelected(p); setEditDraft({ ...p }); setTab('detail'); setDetailTab('info')
    if (onRestorePins && p.circuits.length > 0) onRestorePins(p.circuits)
  }

  function routeLabel(r: Route) {
    if (!r.nodes.length) return '—'
    const a = nodeMap.get(r.nodes[0])
    const z = nodeMap.get(r.nodes[r.nodes.length - 1])
    return `${a?.name ?? r.nodes[0]} → ${z?.name ?? r.nodes[r.nodes.length - 1]}`
  }

  function buildCircuitFromPending(p: typeof pendingCircuit, label?: string): ProjectCircuit {
    const r = p!.route as unknown as Route
    const id = `${r.nodes[0]}-${r.nodes[r.nodes.length - 1]}-${Date.now().toString(36)}`
    return {
      circuit_id: id,
      label: label?.trim() || undefined,
      search_label: p!.searchLabel,
      pin_color: '#94e2d5',
      order: 0,
      route_snapshot: r as unknown as import('../types').Route,
      protect_route_snapshot: p!.protectRoute as unknown as import('../types').Route | undefined,
      protect_search_label: p!.protectRoute ? p!.searchLabel + ' (Protect)' : undefined,
      a_end: {},
      z_end: {},
    }
  }

  function handleProjectClick(p: Project) {
    if (!pendingCircuit) { openProject(p); return }
    setPendingTargetProject(p)
    setPendingLabel('')
  }

  async function confirmAddToProject() {
    if (!pendingCircuit || !pendingTargetProject) return
    const circuit = buildCircuitFromPending(pendingCircuit, pendingLabel)
    setSaving(true); setErr('')
    try {
      const updated = await api.addCircuit(pendingTargetProject.id, circuit)
      setProjects(ps => ps.map(proj => proj.id === updated.id ? updated : proj))
      setSelected(updated); setEditDraft(updated); setTab('detail'); setDetailTab('circuits')
      setPendingTargetProject(null); setPendingLabel('')
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to add circuit')
    } finally {
      setSaving(false)
    }
  }

  // ── List view ─────────────────────────────────────────────────────────────
  function renderList() {
    return (
      <div style={s.scroll} ref={scrollRef}>
        {err && <div style={{ color: '#f38ba8', marginBottom: 12, fontSize: 13 }}>{err}</div>}
        {pendingCircuit && !pendingTargetProject && (
          <div style={{ padding: '12px 16px', borderRadius: 8, background: `${t.blue}18`, border: `1px solid ${t.blue}66`, marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: t.blue, marginBottom: 4 }}>Adding circuit to project</div>
            <div style={{ fontSize: 12, color: t.textMuted }}>
              {pendingCircuit.searchLabel}
              {pendingCircuit.protectRoute && <span style={{ color: '#f9e2af', marginLeft: 8 }}>+ Protect</span>}
            </div>
            <div style={{ fontSize: 12, color: t.textMuted, marginTop: 6 }}>Select a project below, or create a new one.</div>
          </div>
        )}
        {pendingTargetProject && (
          <div style={{ padding: '16px', borderRadius: 8, background: `${t.blue}18`, border: `1px solid ${t.blue}88`, marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: t.blue, marginBottom: 2 }}>
              Adding to: {pendingTargetProject.name}
            </div>
            <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 12 }}>
              {pendingCircuit?.searchLabel}
              {pendingCircuit?.protectRoute && <span style={{ color: '#f9e2af', marginLeft: 8 }}>+ Protect</span>}
            </div>
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: t.textMuted, textTransform: 'uppercase' as const, marginBottom: 5 }}>
                Circuit ID / Label <span style={{ fontWeight: 400, textTransform: 'none' as const }}>(optional — e.g. RFP-2025-001 or TOK-TPE-EPL-01)</span>
              </div>
              <input
                autoFocus
                style={s.input}
                placeholder="Leave blank to auto-name"
                value={pendingLabel}
                onChange={e => setPendingLabel(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') confirmAddToProject() }}
              />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button style={s.btn(t.bgCard, t.blue)} onClick={confirmAddToProject} disabled={saving}>
                {saving ? 'Adding…' : 'Add Circuit'}
              </button>
              <button style={s.btn(t.textMuted, 'transparent')} onClick={() => { setPendingTargetProject(null); setPendingLabel('') }}>
                Back
              </button>
            </div>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
          <button style={s.btn(t.bgCard, t.blue)} onClick={openNewProject}>+ New Project</button>
        </div>
        {projects.length === 0 && (
          <div style={{ textAlign: 'center', color: t.textMuted, fontSize: 14, padding: '40px 0' }}>
            No projects yet. Create one to start building customer solutions.
          </div>
        )}
        {!pendingTargetProject && projects.map(p => (
          <div key={p.id}
            style={{ ...s.card, borderColor: confirmDelete === p.id ? '#f38ba8' : pendingCircuit ? t.blue + '88' : t.border }}
            onClick={() => handleProjectClick(p)}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15, color: t.text, marginBottom: 3 }}>{p.name || '(Untitled)'}</div>
                <div style={{ fontSize: 12, color: t.textMuted }}>
                  {p.customer_name && <span style={{ marginRight: 12 }}>👤 {p.customer_name}</span>}
                  {p.opportunity_id && <span style={{ marginRight: 12 }}>🔑 {p.opportunity_id}</span>}
                  <span style={{ marginRight: 12 }}>📡 {p.circuits.length} circuit{p.circuits.length !== 1 ? 's' : ''}</span>
                  <span style={{
                    padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600,
                    background: p.visibility === 'confidential' ? 'rgba(243,139,168,0.15)' : 'rgba(166,227,161,0.15)',
                    color: p.visibility === 'confidential' ? '#f38ba8' : '#a6e3a1',
                  }}>{p.visibility}</span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }} onClick={e => e.stopPropagation()}>
                {confirmDelete === p.id ? (
                  <>
                    <button style={s.btn('#fff', '#f38ba8')} onClick={() => deleteProject(p.id)}>Confirm Delete</button>
                    <button style={s.btn(t.text, t.border)} onClick={() => setConfirmDelete(null)}>Cancel</button>
                  </>
                ) : (
                  <button style={{ ...s.btn(t.textMuted, 'transparent'), fontSize: 16 }}
                    onClick={() => setConfirmDelete(p.id)}>🗑</button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    )
  }

  // ── Info tab ──────────────────────────────────────────────────────────────
  function renderInfo() {
    if (!editDraft) return null
    const set = (k: keyof Project, v: string) => setEditDraft(d => d ? { ...d, [k]: v } : d)
    return (
      <div style={s.scroll}>
        <div style={s.sectionHead}>Project Details</div>
        <div style={s.row}>
          <div>
            <div style={s.label}>Project Name *</div>
            <input style={s.input} value={editDraft.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Nvidia Japan-Taiwan EPL" />
          </div>
          <div>
            <div style={s.label}>Project ID</div>
            <input style={{ ...s.input, color: t.textMuted }} value={editDraft.id} readOnly />
          </div>
        </div>
        <div style={s.row}>
          <div>
            <div style={s.label}>Customer Name</div>
            <input style={s.input} value={editDraft.customer_name ?? ''} onChange={e => set('customer_name', e.target.value)} placeholder="e.g. Nvidia" />
          </div>
          <div>
            <div style={s.label}>Opportunity ID</div>
            <input style={s.input} value={editDraft.opportunity_id ?? ''} onChange={e => set('opportunity_id', e.target.value)} placeholder="e.g. A-00136452" />
          </div>
        </div>
        <div style={s.row}>
          <div>
            <div style={s.label}>Opportunity Name</div>
            <input style={s.input} value={editDraft.opportunity_name ?? ''} onChange={e => set('opportunity_name', e.target.value)} placeholder="e.g. EPL JP&lt;&gt;TW via EAC" />
          </div>
          <div>
            <div style={s.label}>Date Prepared</div>
            <input style={s.input} type="date" value={editDraft.date_prepared ?? ''} onChange={e => set('date_prepared', e.target.value)} />
          </div>
        </div>
        <div style={s.row}>
          <div>
            <div style={s.label}>Account Manager</div>
            <input style={s.input} value={editDraft.account_manager ?? ''} onChange={e => set('account_manager', e.target.value)} placeholder="e.g. Emma May McGlone" />
          </div>
          <div>
            <div style={s.label}>Solution Architect</div>
            <input style={s.input} value={editDraft.solution_architect ?? ''} onChange={e => set('solution_architect', e.target.value)} placeholder="e.g. John Smith" />
          </div>
        </div>
        <div style={{ marginBottom: 20 }}>
          <div style={s.label}>Visibility</div>
          <div style={{ display: 'flex', gap: 10 }}>
            {(['confidential', 'public'] as const).map(v => (
              <button key={v}
                style={{
                  padding: '6px 18px', borderRadius: 6, fontSize: 13, fontWeight: 600,
                  cursor: 'pointer',
                  border: `2px solid ${editDraft.visibility === v ? t.blue : t.border}`,
                  background: editDraft.visibility === v ? `${t.blue}22` : 'transparent',
                  color: editDraft.visibility === v ? t.blue : t.textMuted,
                }}
                onClick={() => set('visibility', v)}>{v.charAt(0).toUpperCase() + v.slice(1)}</button>
            ))}
          </div>
        </div>
        {err && <div style={{ color: '#f38ba8', fontSize: 13, marginBottom: 10 }}>{err}</div>}
        <button style={s.btn(t.bgCard, t.blue)} onClick={saveProject} disabled={saving}>
          {saving ? 'Saving…' : selected ? 'Save Changes' : 'Create Project'}
        </button>
      </div>
    )
  }

  // ── Circuits tab ──────────────────────────────────────────────────────────
  function renderCircuits() {
    if (!selected) return <div style={{ ...s.scroll, color: t.textMuted, textAlign: 'center', paddingTop: 40 }}>Save the project first before adding circuits.</div>

    if (circuitDraft) return renderCircuitEditor()

    return (
      <div style={s.scroll}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        </div>
        {selected.circuits.length === 0 && (
          <div style={{ textAlign: 'center', color: t.textMuted, fontSize: 14, padding: '40px 0' }}>
            No circuits yet. Add routes from the route search screen using the "Add to Project" button.
          </div>
        )}
        {selected.circuits.map((c, idx) => (
          <div key={c.circuit_id} style={{ ...s.card, borderLeft: `4px solid ${c.pin_color}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: t.text, marginBottom: 4 }}>
                  {c.label || c.search_label || `Circuit ${idx + 1}`}
                </div>
                <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 6 }}>
                  {routeLabel(c.route_snapshot as unknown as Route)}
                  {c.protect_route_snapshot && (
                    <span style={{ marginLeft: 8, color: '#f9e2af', fontWeight: 600 }}>+ Protect</span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' as const, fontSize: 12, color: t.textMuted }}>
                  {c.service_type && <span>📋 {c.service_type}</span>}
                  {c.bandwidth && <span>⚡ {c.bandwidth}</span>}
                  {c.protection && <span>🛡 {c.protection}</span>}
                  {c.a_end.access_type && <span>A: {c.a_end.access_type}</span>}
                  {c.z_end.access_type && <span>Z: {c.z_end.access_type}</span>}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                <button style={s.btn(t.blue, 'transparent')} onClick={() => { setEditingCircuit(c); setCircuitDraft({ ...c }) }}>Edit</button>
                <button style={s.btn('#f38ba8', 'transparent')} onClick={() => removeCircuit(c.circuit_id)}>Remove</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    )
  }

  // ── Circuit editor ────────────────────────────────────────────────────────
  function renderCircuitEditor() {
    if (!circuitDraft) return null
    const setC = (k: keyof ProjectCircuit, v: unknown) => setCircuitDraft(d => d ? { ...d, [k]: v } : d)
    const setA = (k: keyof EndpointConfig, v: string) => setCircuitDraft(d => d ? { ...d, a_end: { ...d.a_end, [k]: v || undefined } } : d)
    const setZ = (k: keyof EndpointConfig, v: string) => setCircuitDraft(d => d ? { ...d, z_end: { ...d.z_end, [k]: v || undefined } } : d)

    const workerNodes = (circuitDraft.route_snapshot as unknown as Route)?.nodes ?? []
    const aNode = nodeMap.get(workerNodes[0])
    const zNode = nodeMap.get(workerNodes[workerNodes.length - 1])

    function EndBlock({ label, end, setter }: { label: string, end: EndpointConfig, setter: (k: keyof EndpointConfig, v: string) => void }) {
      return (
        <div style={{ flex: 1 }}>
          <div style={{ ...s.sectionHead, color: t.blue }}>{label}</div>
          <div style={{ marginBottom: 12 }}>
            <div style={s.label}>Customer Site Name</div>
            <input style={s.input} value={end.customer_site_name ?? ''} onChange={e => setter('customer_site_name', e.target.value)} placeholder="e.g. Equinix TY4" />
          </div>
          <div style={{ marginBottom: 12 }}>
            <div style={s.label}>Customer Site Address</div>
            <textarea style={{ ...s.input, height: 60, resize: 'vertical' as const }}
              value={end.customer_site_address ?? ''}
              onChange={e => setter('customer_site_address', e.target.value)}
              placeholder="Full site address" />
          </div>
          <div style={{ marginBottom: 12 }}>
            <div style={s.label}>Access Type</div>
            <select style={s.select} value={end.access_type ?? ''} onChange={e => setter('access_type', e.target.value)}>
              <option value="">— Select —</option>
              {ACCESS_TYPES.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          {(end.access_type === 'X-Connect' || !end.access_type) && (
            <>
              <div style={{ marginBottom: 12 }}>
                <div style={s.label}>X-Connect Supplier</div>
                <input style={s.input} value={end.cc_supplier ?? ''} onChange={e => setter('cc_supplier', e.target.value)} placeholder="e.g. Equinix" />
              </div>
              <div style={{ marginBottom: 12 }}>
                <div style={s.label}>Arranged By</div>
                <select style={s.select} value={end.cc_arranged_by ?? ''} onChange={e => setter('cc_arranged_by', e.target.value)}>
                  <option value="">— Select —</option>
                  {ARRANGED_BY.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>
            </>
          )}
          {end.access_type === 'Local Loop' && (
            <>
              <div style={{ marginBottom: 12 }}>
                <div style={s.label}>Local Loop Supplier</div>
                <input style={s.input} value={end.ll_supplier ?? ''} onChange={e => setter('ll_supplier', e.target.value)} />
              </div>
              <div style={{ marginBottom: 12 }}>
                <div style={s.label}>Arranged By</div>
                <select style={s.select} value={end.ll_arranged_by ?? ''} onChange={e => setter('ll_arranged_by', e.target.value)}>
                  <option value="">— Select —</option>
                  {LL_ARRANGED_BY.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>
            </>
          )}
          <div style={{ marginBottom: 12 }}>
            <div style={s.label}>Interface</div>
            <select style={s.select} value={end.interface_id ?? ''} onChange={e => setter('interface_id', e.target.value)}>
              <option value="">— Select —</option>
              {interfaces.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          </div>
          <div style={{ marginBottom: 12 }}>
            <div style={s.label}>Bandwidth</div>
            <input style={s.input} value={end.bandwidth ?? ''} onChange={e => setter('bandwidth', e.target.value)} placeholder="e.g. 100G LAN PHY (OTU4)" />
          </div>
          <div style={{ marginBottom: 12 }}>
            <div style={s.label}>Protection</div>
            <select style={s.select} value={end.protection ?? ''} onChange={e => setter('protection', e.target.value)}>
              <option value="">— Select —</option>
              {PROTECTION_TYPES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
        </div>
      )
    }

    return (
      <div style={s.scroll}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <button style={s.btn(t.textMuted, 'transparent')} onClick={() => { setEditingCircuit(null); setCircuitDraft(null) }}>← Back</button>
          <div style={{ fontWeight: 700, fontSize: 15, color: t.text }}>
            {editingCircuit ? 'Edit Circuit' : 'New Circuit'}
          </div>
        </div>

        <div style={s.sectionHead}>Circuit Details</div>
        <div style={s.row}>
          <div>
            <div style={s.label}>Circuit Label</div>
            <input style={s.input} value={circuitDraft.label ?? ''} onChange={e => setC('label', e.target.value || undefined)} placeholder="e.g. TOK TPE EPL 90147625" />
          </div>
          <div>
            <div style={s.label}>Service Type</div>
            <select style={s.select} value={circuitDraft.service_type ?? ''} onChange={e => setC('service_type', e.target.value || undefined)}>
              <option value="">— Select —</option>
              {SERVICE_TYPES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
        <div style={s.row3}>
          <div>
            <div style={s.label}>Bandwidth</div>
            <input style={s.input} value={circuitDraft.bandwidth ?? ''} onChange={e => setC('bandwidth', e.target.value || undefined)} placeholder="e.g. 100G" />
          </div>
          <div>
            <div style={s.label}>Protection</div>
            <select style={s.select} value={circuitDraft.protection ?? ''} onChange={e => setC('protection', e.target.value || undefined)}>
              <option value="">— Select —</option>
              {PROTECTION_TYPES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <div style={s.label}>Frame Size</div>
            <input style={s.input} value={circuitDraft.frame_size ?? ''} onChange={e => setC('frame_size', e.target.value || undefined)} placeholder="e.g. 9200 bytes" />
          </div>
        </div>
        <div style={{ marginBottom: 20 }}>
          <div style={s.label}>L1 Settings</div>
          <input style={s.input} value={circuitDraft.l1_settings ?? ''} onChange={e => setC('l1_settings', e.target.value || undefined)} placeholder="e.g. MACSec Transparent LLF Enable" />
        </div>

        {/* Route info */}
        <div style={{ ...s.card, marginBottom: 20, cursor: 'default' }}>
          <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 4 }}>Worker Route</div>
          <div style={{ fontSize: 13, color: t.text, fontWeight: 600 }}>
            {aNode?.name ?? '—'} → {zNode?.name ?? '—'}
          </div>
          {circuitDraft.protect_route_snapshot && (
            <div style={{ fontSize: 12, color: '#f9e2af', marginTop: 4 }}>+ Protect route included</div>
          )}
        </div>

        {/* Endpoint enrichment */}
        <div style={{ display: 'flex', gap: 24 }}>
          <EndBlock label={`A-End${aNode ? ` — ${aNode.country}` : ''}`} end={circuitDraft.a_end} setter={setA} />
          <EndBlock label={`Z-End${zNode ? ` — ${zNode.country}` : ''}`} end={circuitDraft.z_end} setter={setZ} />
        </div>

        {err && <div style={{ color: '#f38ba8', fontSize: 13, marginBottom: 10 }}>{err}</div>}
        <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
          <button style={s.btn(t.bgCard, t.blue)} onClick={saveCircuit} disabled={saving}>{saving ? 'Saving…' : 'Save Circuit'}</button>
          <button style={s.btn(t.textMuted, 'transparent')} onClick={() => { setEditingCircuit(null); setCircuitDraft(null) }}>Cancel</button>
        </div>
      </div>
    )
  }

  // ── SLD Config tab ────────────────────────────────────────────────────────
  function renderSldConfig() {
    if (!editDraft) return null
    const cfg = editDraft.sld_config
    const toggle = (k: keyof SldConfig) => {
      const updated = { ...cfg, [k]: !cfg[k] }
      setEditDraft(d => d ? { ...d, sld_config: updated } : d)
      if (selected) saveSldConfig(updated)
    }

    const items: { key: keyof SldConfig; label: string; desc: string }[] = [
      { key: 'show_rtd',              label: 'Round-Trip Delay',       desc: 'Show end-to-end RTD on diagram header' },
      { key: 'show_latency',          label: 'Total Latency',          desc: 'Show total one-way latency in summary bar' },
      { key: 'show_segment_latency',  label: 'Segment Latency',        desc: 'Show per-segment latency below each segment' },
      { key: 'show_distance',         label: 'Distance',               desc: 'Show segment and total distances' },
      { key: 'show_ownership',        label: 'Ownership',              desc: 'Show ownership badges on segments' },
      { key: 'show_reliability',      label: 'Availability',           desc: 'Show segment and end-to-end availability' },
    ]

    return (
      <div style={s.scroll}>
        <div style={s.sectionHead}>SLD Display Settings</div>
        <div style={{ fontSize: 13, color: t.textMuted, marginBottom: 20 }}>
          These settings control what information appears on generated SLD PDFs. Defaults apply to all circuits; individual circuits can override these.
        </div>
        {items.map(item => (
          <div key={item.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: `1px solid ${t.border}` }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: t.text }}>{item.label}</div>
              <div style={{ fontSize: 12, color: t.textMuted }}>{item.desc}</div>
            </div>
            <div
              onClick={() => toggle(item.key)}
              style={{
                width: 44, height: 24, borderRadius: 12, cursor: 'pointer',
                background: cfg[item.key] ? t.blue : t.border,
                position: 'relative', flexShrink: 0, transition: 'background 0.2s',
              }}>
              <div style={{
                width: 18, height: 18, borderRadius: 9, background: '#fff',
                position: 'absolute', top: 3, left: cfg[item.key] ? 23 : 3,
                transition: 'left 0.2s',
              }} />
            </div>
          </div>
        ))}
      </div>
    )
  }

  // ── Detail view ───────────────────────────────────────────────────────────
  function renderDetail() {
    const detailTabs: { id: DetailTab; label: string }[] = [
      { id: 'info', label: 'Project Info' },
      { id: 'circuits', label: `Circuits (${editDraft?.circuits?.length ?? 0})` },
      { id: 'sld', label: 'SLD Settings' },
    ]
    return (
      <>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 24px', borderBottom: `1px solid ${t.border}` }}>
          <button style={{ ...s.btn(t.textMuted, 'transparent'), fontSize: 13 }}
            onClick={() => { setTab('list'); setSelected(null); setEditDraft(null); setEditingCircuit(null); setCircuitDraft(null) }}>
            ← All Projects
          </button>
          <div style={{ fontWeight: 700, fontSize: 15, color: t.text }}>
            {editDraft?.name || '(New Project)'}
          </div>
          {selected && (
            <div style={{ fontSize: 12, color: t.textMuted, marginLeft: 4 }}>
              {selected.id}
            </div>
          )}
        </div>
        <div style={s.tabBar}>
          {detailTabs.map(dt => (
            <button key={dt.id} style={s.tab(detailTab === dt.id)} onClick={() => setDetailTab(dt.id)}>
              {dt.label}
            </button>
          ))}
        </div>
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {detailTab === 'info' && renderInfo()}
          {detailTab === 'circuits' && renderCircuits()}
          {detailTab === 'sld' && renderSldConfig()}
        </div>
      </>
    )
  }

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modal} onClick={e => e.stopPropagation()}>
        <div style={s.header}>
          <div style={{ fontWeight: 700, fontSize: 18, color: t.text }}>
            Customer Solution Projects
          </div>
          <button
            style={{ background: 'none', border: 'none', color: t.textMuted, fontSize: 22, cursor: 'pointer', padding: '0 4px' }}
            onClick={onClose}>×</button>
        </div>
        <div style={s.body}>
          {tab === 'list' ? renderList() : renderDetail()}
        </div>
      </div>
    </div>
  )
}
