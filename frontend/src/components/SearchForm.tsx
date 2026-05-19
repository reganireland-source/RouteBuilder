import { useState } from 'react'
import type { CableNode, CableSegment, DiversityType, RouteRequest } from '../types'

interface Props {
  nodes: CableNode[]
  segments: CableSegment[]
  onSearch: (req: RouteRequest) => void
  loading: boolean
}

const COUNTRY_NAMES: Record<string, string> = {
  AE: 'United Arab Emirates',
  AU: 'Australia',
  DE: 'Germany',
  DJ: 'Djibouti',
  GB: 'United Kingdom',
  GU: 'Guam',
  HK: 'Hong Kong',
  ID: 'Indonesia',
  IN: 'India',
  JP: 'Japan',
  KR: 'South Korea',
  MNL: 'Philippines',
  MY: 'Malaysia',
  NZ: 'New Zealand',
  PH: 'Philippines',
  SG: 'Singapore',
  TW: 'Taiwan',
  US: 'United States',
}

function countryName(code: string) {
  return COUNTRY_NAMES[code] ?? code
}

function groupByCountry(nodes: CableNode[]) {
  const map = new Map<string, CableNode[]>()
  for (const n of nodes) {
    const existing = map.get(n.country) ?? []
    existing.push(n)
    map.set(n.country, existing)
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => countryName(a).localeCompare(countryName(b)))
    .map(([code, group]) => ({
      code,
      label: countryName(code),
      nodes: group.sort((a, b) => a.name.localeCompare(b.name)),
    }))
}

const nodeLabel = (n: CableNode) =>
  `${n.name} (${n.id}) [${n.type === 'landing_station' ? 'CLS' : 'POP'}]`

export function SearchForm({ nodes, segments, onSearch, loading }: Props) {
  const [startNode, setStartNode] = useState('')
  const [endNode, setEndNode] = useState('')
  const [diversity, setDiversity] = useState<DiversityType>('none')
  const [mustInclude, setMustInclude] = useState<string[]>([])
  const [mustAvoidNodes, setMustAvoidNodes] = useState<string[]>([])
  const [mustAvoidSegs, setMustAvoidSegs] = useState<string[]>([])

  const groups = groupByCountry(nodes)

  function toggleMulti(id: string, list: string[], setter: (v: string[]) => void) {
    setter(list.includes(id) ? list.filter(x => x !== id) : [...list, id])
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!startNode || !endNode) return
    onSearch({
      start_node_id: startNode,
      end_node_id: endNode,
      must_include_nodes: mustInclude,
      must_avoid_nodes: mustAvoidNodes,
      must_avoid_segments: mustAvoidSegs,
      diversity,
    })
  }

  const selectStyle: React.CSSProperties = {
    width: '100%', padding: '6px 8px', borderRadius: 4,
    border: '1px solid #444', background: '#1e1e2e', color: '#cdd6f4',
    fontSize: 13,
  }

  const multiBoxStyle: React.CSSProperties = {
    maxHeight: 120, overflowY: 'auto', border: '1px solid #444',
    borderRadius: 4, padding: '4px 0', background: '#1e1e2e',
  }

  const multiItemStyle = (selected: boolean): React.CSSProperties => ({
    padding: '3px 8px 3px 16px', cursor: 'pointer', fontSize: 12,
    background: selected ? '#313244' : 'transparent',
    color: selected ? '#89b4fa' : '#cdd6f4',
  })

  const groupHeaderStyle: React.CSSProperties = {
    padding: '4px 8px 2px', fontSize: 10, fontWeight: 700,
    color: '#6c7086', textTransform: 'uppercase', letterSpacing: '0.06em',
    borderTop: '1px solid #313244', marginTop: 2,
  }

  const renderGroupedSelect = (placeholder: string, value: string, onChange: (v: string) => void) => (
    <select value={value} onChange={e => onChange(e.target.value)} style={selectStyle} required>
      <option value="">{placeholder}</option>
      {groups.map(g => (
        <optgroup key={g.code} label={g.label}>
          {g.nodes.map(n => (
            <option key={n.id} value={n.id}>{nodeLabel(n)}</option>
          ))}
        </optgroup>
      ))}
    </select>
  )

  const renderGroupedMulti = (
    exclude: string[],
    selected: string[],
    onToggle: (id: string) => void,
  ) => (
    <div style={multiBoxStyle}>
      {groups.map(g => {
        const visible = g.nodes.filter(n => !exclude.includes(n.id))
        if (visible.length === 0) return null
        return (
          <div key={g.code}>
            <div style={groupHeaderStyle}>{g.label}</div>
            {visible.map(n => (
              <div
                key={n.id}
                style={multiItemStyle(selected.includes(n.id))}
                onClick={() => onToggle(n.id)}
              >
                {nodeLabel(n)}
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <label style={labelStyle}>Origin</label>
        {renderGroupedSelect('Select origin...', startNode, setStartNode)}
      </div>

      <div>
        <label style={labelStyle}>Destination</label>
        {renderGroupedSelect('Select destination...', endNode, setEndNode)}
      </div>

      <div>
        <label style={labelStyle}>Diversity</label>
        <select value={diversity} onChange={e => setDiversity(e.target.value as DiversityType)} style={selectStyle}>
          <option value="none">None</option>
          <option value="wet">Wet segment diversity</option>
          <option value="terrestrial">Terrestrial diversity</option>
          <option value="full">Full diversity</option>
        </select>
      </div>

      <div>
        <label style={labelStyle}>Must Include Nodes</label>
        {renderGroupedMulti(
          [startNode, endNode],
          mustInclude,
          id => toggleMulti(id, mustInclude, setMustInclude),
        )}
      </div>

      <div>
        <label style={labelStyle}>Must Avoid Nodes</label>
        {renderGroupedMulti(
          [startNode, endNode],
          mustAvoidNodes,
          id => toggleMulti(id, mustAvoidNodes, setMustAvoidNodes),
        )}
      </div>

      <div>
        <label style={labelStyle}>Must Avoid Segments</label>
        <div style={multiBoxStyle}>
          {segments.map(s => (
            <div
              key={s.id}
              style={multiItemStyle(mustAvoidSegs.includes(s.id))}
              onClick={() => toggleMulti(s.id, mustAvoidSegs, setMustAvoidSegs)}
            >
              {s.name}
            </div>
          ))}
        </div>
      </div>

      <button
        type="submit"
        disabled={loading || !startNode || !endNode}
        style={{
          padding: '8px 16px', borderRadius: 4, border: 'none',
          background: loading ? '#444' : '#89b4fa', color: '#1e1e2e',
          fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer',
          fontSize: 14,
        }}
      >
        {loading ? 'Searching...' : 'Find Routes'}
      </button>
    </form>
  )
}

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 600,
  color: '#a6adc8', textTransform: 'uppercase', letterSpacing: '0.05em',
  marginBottom: 4,
}
