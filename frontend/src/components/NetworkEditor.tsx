/**
 * NetworkEditor — left-panel UI for the admin-only "Network Editor" mode.
 *
 * Phase A (current): a shell that reuses CountryViewer/SystemViewer as a
 * "reduce clutter while editing" filter — wired to the exact same
 * countryHighlight/selectedSystems state App.tsx already threads into
 * NetworkMap for Country Viewer / System Viewer, so the live map dims
 * exactly like it already does in those modes. No editing tools yet.
 *
 * Later phases add: an interaction-mode strip (Move / Waypoints / Create /
 * Delete), the pending-changes list + undo/redo (EditorPendingPanel), and
 * the new-node/new-segment forms — see /root/.claude/plans/soft-seeking-toast.md.
 *
 * Mounted from: App.tsx, only when `mode === 'networkeditor' && isAdmin`.
 */
import { useState } from 'react'
import type { CableNode, CableSegment, CableSystem, CountryHighlight, SelectedSystem } from '../types'
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
}

export function NetworkEditor({ nodes, segments, systems, countryHighlight, onCountrySelect, selectedSystems, onToggleSystem }: Props) {
  const t = useTheme()
  const [filterOpen, setFilterOpen] = useState(true)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{
        padding: '8px 10px', borderRadius: 6, fontSize: 11, lineHeight: 1.5,
        background: t.orange + '14', border: `1px solid ${t.orange}55`, color: t.textMuted,
      }}>
        ✎ <strong style={{ color: t.text }}>Network Editor</strong> — move nodes, edit segment
        paths and create segments/capacity directly on the map. Changes are staged locally
        and only written to the database when you click Save All.
      </div>

      {/* Clutter filter — reuses the exact Country/System Viewer components and state,
          so the map dims non-matching nodes/segments exactly like those modes already do. */}
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
      </div>

      <p style={{ fontSize: 12, color: t.textFaintest, marginTop: 4 }}>
        Editing tools (move / waypoints / create / delete) are coming in the next build phase.
        {countryHighlight && <> Currently filtered to <strong style={{ color: t.textMuted }}>{countryHighlight.countryName}</strong>.</>}
      </p>
    </div>
  )
}
