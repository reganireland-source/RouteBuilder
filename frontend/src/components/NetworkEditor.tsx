/**
 * NetworkEditor — left-panel UI for the admin-only "Network Editor" mode.
 *
 * Phase B (current): the Move sub-mode is functional — drag a node on the map
 * (EditorMapLayer.tsx) or click one to select it here and type an exact
 * lat/lng. Waypoints/Create/Delete sub-mode tabs are shown but disabled until
 * later phases (see /root/.claude/plans/soft-seeking-toast.md).
 *
 * The clutter filter reuses CountryViewer/SystemViewer verbatim, wired to the
 * exact same countryHighlight/selectedSystems state App.tsx already threads
 * into NetworkMap for Country Viewer / System Viewer — the live map dims
 * non-matching nodes/segments exactly like those modes already do.
 *
 * Mounted from: App.tsx, only when `mode === 'networkeditor' && isAdmin`.
 */
import { useState } from 'react'
import type { CableNode, CableSegment, CableSystem, CountryHighlight, SelectedSystem } from '../types'
import type { EditorState, EditorAction, EditorSubMode } from '../state/editorState'
import { useTheme } from '../theme'
import { CountryViewer } from './CountryViewer'
import { SystemViewer } from './SystemViewer'

interface Props {
  nodes: CableNode[]
  segments: CableSegment[]
  systems: CableSystem[]
  countryHighlight: CountryHighlight | null
  onCountrySelect: (h: CountryHighlight | null) => void
  selectedSystems: SelectedSystem[]
  onToggleSystem: (systemId: string) => void
  editorState: EditorState
  dispatchEditor: (action: EditorAction) => void
}

const SUBMODES: { id: EditorSubMode; label: string; icon: string; enabled: boolean }[] = [
  { id: 'move', label: 'Move', icon: '✥', enabled: true },
  { id: 'waypoints', label: 'Waypoints', icon: '〰', enabled: false },
  { id: 'create', label: 'Create', icon: '+', enabled: false },
  { id: 'delete', label: 'Delete', icon: '🗑', enabled: false },
]

export function NetworkEditor({ nodes, segments, systems, countryHighlight, onCountrySelect, selectedSystems, onToggleSystem, editorState, dispatchEditor }: Props) {
  const t = useTheme()
  const [filterOpen, setFilterOpen] = useState(false)

  const selectedNode = editorState.selection?.kind === 'node' ? nodes.find(n => n.id === editorState.selection!.id) ?? null : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{
        padding: '8px 10px', borderRadius: 6, fontSize: 11, lineHeight: 1.5,
        background: t.orange + '14', border: `1px solid ${t.orange}55`, color: t.textMuted,
      }}>
        ✎ <strong style={{ color: t.text }}>Network Editor</strong> — changes are staged locally
        and only written to the database when you click Save All (see the panel on the right).
      </div>

      {/* Interaction-mode strip */}
      <div style={{ display: 'flex', gap: 4 }}>
        {SUBMODES.map(m => (
          <button
            key={m.id}
            disabled={!m.enabled}
            onClick={() => dispatchEditor({ type: 'SET_SUBMODE', subMode: m.id })}
            title={m.enabled ? undefined : 'Coming in a later build phase'}
            style={{
              flex: 1, padding: '7px 4px', borderRadius: 5, fontSize: 11, fontWeight: 700,
              cursor: m.enabled ? 'pointer' : 'default',
              border: `1px solid ${editorState.subMode === m.id ? t.blue : t.border}`,
              background: editorState.subMode === m.id ? t.blue + '22' : 'transparent',
              color: !m.enabled ? t.textFaintest : editorState.subMode === m.id ? t.blue : t.textMuted,
              opacity: m.enabled ? 1 : 0.5,
            }}
          >
            {m.icon} {m.label}
          </button>
        ))}
      </div>

      {editorState.subMode === 'move' && (
        <div style={{ fontSize: 12, color: t.textFaint }}>
          Drag any node on the map to reposition it. Moving a physical site (CLS/PoP/off-net)
          asks for confirmation first — branching units move freely.
        </div>
      )}

      {selectedNode && editorState.subMode === 'move' && (
        <NodeLatLngForm key={selectedNode.id} node={selectedNode} dispatchEditor={dispatchEditor} />
      )}

      {/* Clutter filter — reuses the exact Country/System Viewer components and state. */}
      <div style={{ border: `1px solid ${t.border}`, borderRadius: 6, overflow: 'hidden' }}>
        <button
          onClick={() => setFilterOpen(o => !o)}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '8px 10px', background: t.bgCard, border: 'none', cursor: 'pointer',
            fontSize: 11, fontWeight: 700, color: t.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em',
          }}
        >
          Filter (reduce clutter while editing)
          <span style={{ color: t.textFaint }}>{filterOpen ? '▴' : '▾'}</span>
        </button>
        {filterOpen && (
          <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: t.textFaint, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>By country</div>
              <CountryViewer nodes={nodes} segments={segments} systems={systems} onSelect={onCountrySelect} />
            </div>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: t.textFaint, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>By system</div>
              <SystemViewer systems={systems} selected={selectedSystems} onToggle={onToggleSystem} />
            </div>
          </div>
        )}
        {!filterOpen && countryHighlight && (
          <div style={{ padding: '6px 10px', fontSize: 11, color: t.textFaint }}>
            Filtered to <strong style={{ color: t.textMuted }}>{countryHighlight.countryName}</strong>
          </div>
        )}
      </div>
    </div>
  )
}

/** Typed lat/lng precision override for the node currently selected on the
 *  map — the alternative to dragging. Local text state so the fields don't
 *  fight the user's keystrokes while they're mid-edit; committed on blur/Enter. */
function NodeLatLngForm({ node, dispatchEditor }: { node: CableNode; dispatchEditor: (action: EditorAction) => void }) {
  const t = useTheme()
  const [lat, setLat] = useState(String(node.lat))
  const [lng, setLng] = useState(String(node.lng))

  function commit() {
    const parsedLat = parseFloat(lat)
    const parsedLng = parseFloat(lng)
    if (Number.isNaN(parsedLat) || Number.isNaN(parsedLng)) { setLat(String(node.lat)); setLng(String(node.lng)); return }
    if (parsedLat === node.lat && parsedLng === node.lng) return
    const physicalSite = node.type !== 'branching_unit'
    if (physicalSite && !window.confirm(`"${node.name}" is a physical site — really move it?`)) {
      setLat(String(node.lat)); setLng(String(node.lng)); return
    }
    dispatchEditor({ type: 'MOVE_NODE', nodeId: node.id, lat: parsedLat, lng: parsedLng, fromLat: node.lat, fromLng: node.lng })
  }

  return (
    <div style={{ padding: 10, borderRadius: 6, border: `1px solid ${t.blue}55`, background: t.blue + '10', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: t.text }}>{node.name} <span style={{ color: t.textFaint, fontWeight: 400 }}>({node.id})</span></div>
      <div style={{ display: 'flex', gap: 6 }}>
        <label style={{ flex: 1, fontSize: 10, color: t.textFaint }}>
          Lat
          <input
            value={lat} onChange={e => setLat(e.target.value)}
            onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
            style={{ width: '100%', marginTop: 2, padding: '5px 7px', borderRadius: 4, border: `1px solid ${t.border}`, background: t.bgInput, color: t.text, fontSize: 12, fontFamily: 'inherit' }}
          />
        </label>
        <label style={{ flex: 1, fontSize: 10, color: t.textFaint }}>
          Lng
          <input
            value={lng} onChange={e => setLng(e.target.value)}
            onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
            style={{ width: '100%', marginTop: 2, padding: '5px 7px', borderRadius: 4, border: `1px solid ${t.border}`, background: t.bgInput, color: t.text, fontSize: 12, fontFamily: 'inherit' }}
          />
        </label>
      </div>
    </div>
  )
}
