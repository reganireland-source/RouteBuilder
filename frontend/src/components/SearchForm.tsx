import { useState } from 'react'
import type { CableNode, CableSegment, DiversityType, RouteRequest } from '../types'

interface Props {
  nodes: CableNode[]
  segments: CableSegment[]
  onSearch: (req: RouteRequest) => void
  loading: boolean
}

export function SearchForm({ nodes, segments, onSearch, loading }: Props) {
  const [startNode, setStartNode] = useState('')
  const [endNode, setEndNode] = useState('')
  const [diversity, setDiversity] = useState<DiversityType>('none')
  const [mustInclude, setMustInclude] = useState<string[]>([])
  const [mustAvoidNodes, setMustAvoidNodes] = useState<string[]>([])
  const [mustAvoidSegs, setMustAvoidSegs] = useState<string[]>([])

  const clsNodes = [...nodes].filter(n => n.type === 'cls').sort((a, b) => a.name.localeCompare(b.name))
  const popNodes = [...nodes].filter(n => n.type === 'pop').sort((a, b) => a.name.localeCompare(b.name))
  const sortedNodes = [...clsNodes, ...popNodes]

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
    padding: '3px 8px', cursor: 'pointer', fontSize: 12,
    background: selected ? '#313244' : 'transparent',
    color: selected ? '#89b4fa' : '#cdd6f4',
  })

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <label style={labelStyle}>Origin</label>
        <select value={startNode} onChange={e => setStartNode(e.target.value)} style={selectStyle} required>
          <option value="">Select origin...</option>
          <optgroup label="Cable Landing Stations (CLS)">
            {clsNodes.map(n => <option key={n.id} value={n.id}>{n.name} ({n.id})</option>)}
          </optgroup>
          <optgroup label="Points of Presence (PoP)">
            {popNodes.map(n => <option key={n.id} value={n.id}>{n.name} ({n.id})</option>)}
          </optgroup>
        </select>
      </div>

      <div>
        <label style={labelStyle}>Destination</label>
        <select value={endNode} onChange={e => setEndNode(e.target.value)} style={selectStyle} required>
          <option value="">Select destination...</option>
          <optgroup label="Cable Landing Stations (CLS)">
            {clsNodes.map(n => <option key={n.id} value={n.id}>{n.name} ({n.id})</option>)}
          </optgroup>
          <optgroup label="Points of Presence (PoP)">
            {popNodes.map(n => <option key={n.id} value={n.id}>{n.name} ({n.id})</option>)}
          </optgroup>
        </select>
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
        <div style={multiBoxStyle}>
          {sortedNodes
            .filter(n => n.id !== startNode && n.id !== endNode)
            .map(n => (
              <div
                key={n.id}
                style={multiItemStyle(mustInclude.includes(n.id))}
                onClick={() => toggleMulti(n.id, mustInclude, setMustInclude)}
              >
                <span style={{ color: n.type === 'cls' ? '#89b4fa' : '#cba6f7', fontSize: 9, marginRight: 4 }}>
                  {n.type.toUpperCase()}
                </span>
                {n.name} ({n.id})
              </div>
            ))}
        </div>
      </div>

      <div>
        <label style={labelStyle}>Must Avoid Nodes</label>
        <div style={multiBoxStyle}>
          {sortedNodes
            .filter(n => n.id !== startNode && n.id !== endNode)
            .map(n => (
              <div
                key={n.id}
                style={multiItemStyle(mustAvoidNodes.includes(n.id))}
                onClick={() => toggleMulti(n.id, mustAvoidNodes, setMustAvoidNodes)}
              >
                <span style={{ color: n.type === 'cls' ? '#89b4fa' : '#cba6f7', fontSize: 9, marginRight: 4 }}>
                  {n.type.toUpperCase()}
                </span>
                {n.name} ({n.id})
              </div>
            ))}
        </div>
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
