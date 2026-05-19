import { useState } from 'react'
import type { CableSystem, SelectedSystem } from '../types'
import { useTheme } from '../theme'

interface Props {
  systems: CableSystem[]
  selected: SelectedSystem[]
  onToggle: (systemId: string) => void
}

export function SystemViewer({ systems, selected, onToggle }: Props) {
  const t = useTheme()
  const [query, setQuery] = useState('')

  const displaySystems = systems.filter(s => s.id !== 'TERRESTRIAL')
  const filtered = displaySystems.filter(s =>
    query === '' ||
    s.name.toLowerCase().includes(query.toLowerCase()) ||
    s.id.toLowerCase().includes(query.toLowerCase())
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

      {/* Selected chips */}
      {selected.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: t.textFaint, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>
            Selected ({selected.length}/5)
          </div>
          {selected.map(ss => {
            const sys = systems.find(s => s.id === ss.systemId)
            return (
              <div key={ss.systemId} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '6px 8px', borderRadius: 5,
                background: t.bgBase, border: `1px solid ${ss.color}`,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: ss.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 12, fontWeight: 600, color: t.text }}>{sys?.name ?? ss.systemId}</span>
                  <span style={{ fontSize: 10, color: t.textFaint }}>{ss.systemId}</span>
                </div>
                <button
                  onClick={() => onToggle(ss.systemId)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: t.textFaint, fontSize: 16, padding: '0 2px', lineHeight: 1 }}
                >×</button>
              </div>
            )
          })}
        </div>
      )}

      {/* Search */}
      <input
        type="text"
        placeholder="Search cable systems…"
        value={query}
        onChange={e => setQuery(e.target.value)}
        style={{
          width: '100%', padding: '6px 8px', borderRadius: 4, boxSizing: 'border-box',
          border: `1px solid ${t.border}`, background: t.bgInput, color: t.text,
          fontSize: 13, outline: 'none',
        }}
      />

      {/* List */}
      <div style={{ border: `1px solid ${t.border}`, borderRadius: 4, background: t.bgInput, overflow: 'hidden' }}>
        {filtered.map((sys, i) => {
          const selectedEntry = selected.find(s => s.systemId === sys.id)
          const isSelected = !!selectedEntry
          const isDisabled = !isSelected && selected.length >= 5
          return (
            <div
              key={sys.id}
              onClick={() => !isDisabled && onToggle(sys.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '8px 10px', cursor: isDisabled ? 'not-allowed' : 'pointer',
                borderBottom: i < filtered.length - 1 ? `1px solid ${t.border}` : 'none',
                background: isSelected ? t.bgDeep : 'transparent',
                opacity: isDisabled ? 0.35 : 1,
                transition: 'background 0.1s',
              }}
            >
              <div style={{
                width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
                background: isSelected ? selectedEntry!.color : 'transparent',
                border: `2px solid ${isSelected ? selectedEntry!.color : t.borderSubtle}`,
                transition: 'all 0.15s',
              }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: isSelected ? 600 : 400, color: isSelected ? t.text : t.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {sys.name}
                </div>
                <div style={{ fontSize: 10, color: t.textFaint }}>{sys.id}</div>
              </div>
            </div>
          )
        })}
        {filtered.length === 0 && (
          <div style={{ padding: '14px 10px', fontSize: 12, color: t.textFaint, textAlign: 'center' }}>
            No systems match "{query}"
          </div>
        )}
      </div>

      {selected.length === 0 && (
        <p style={{ fontSize: 12, color: t.textFaintest, margin: 0 }}>
          Select up to 5 systems to highlight their segments on the map.
        </p>
      )}
    </div>
  )
}
