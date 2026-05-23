import { useState, useMemo, useRef, useEffect } from 'react'
import type { CableNode, CableSegment, CableSystem, DiversityType, RouteRequest } from '../types'
import { useTheme } from '../theme'

interface Props {
  nodes: CableNode[]
  segments: CableSegment[]
  systems?: CableSystem[]
  onSearch: (req: RouteRequest) => void
  loading: boolean
  prefilledOrigin?: string
  prefilledDest?: string
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
    if (n.type === 'branching_unit') continue
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

const nodeLabel = (n: CableNode) => {
  const tag = n.type === 'landing_station' ? 'CLS' : n.type === 'branching_unit' ? 'BU' : 'POP'
  return `${n.name} (${n.id}) [${tag}]`
}

function NodeCombobox({ nodes, value, onChange, placeholder }: {
  nodes: CableNode[]
  value: string
  onChange: (id: string) => void
  placeholder: string
}) {
  const t = useTheme()
  const [query, setQuery]       = useState('')
  const [open, setOpen]         = useState(false)
  const [activeIdx, setActiveIdx] = useState(-1)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef     = useRef<HTMLInputElement>(null)
  const listRef      = useRef<HTMLDivElement>(null)

  const selectedNode = nodes.find(n => n.id === value)

  const filtered: CableNode[] = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return nodes
      .filter(n => n.type !== 'branching_unit')
      .filter(n =>
        n.id.toLowerCase().includes(q) ||
        n.name.toLowerCase().includes(q) ||
        countryName(n.country).toLowerCase().includes(q) ||
        n.country.toLowerCase().includes(q) ||
        (n.owner ?? '').toLowerCase().includes(q) ||
        (n.trading_name ?? '').toLowerCase().includes(q)
      )
      .slice(0, 25)
  }, [query, nodes])

  useEffect(() => { setActiveIdx(-1) }, [filtered])

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  function select(id: string) {
    onChange(id)
    setOpen(false)
    setQuery('')
    setActiveIdx(-1)
  }

  function clear() {
    onChange('')
    setQuery('')
    setOpen(false)
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { setOpen(false); setQuery(''); return }
    if (!open || filtered.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx((i: number) => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx((i: number) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && activeIdx >= 0) {
      e.preventDefault()
      select(filtered[activeIdx].id)
    }
  }

  const typeTag = (n: CableNode) =>
    n.type === 'landing_station' ? 'CLS' : n.type === 'terrestrial_pop' ? 'POP' : 'BU'

  const inputBase: React.CSSProperties = {
    width: '100%', padding: '6px 8px', borderRadius: 4,
    border: `1px solid ${t.border}`, background: t.bgInput, color: t.text,
    fontSize: 13, boxSizing: 'border-box',
  }

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      {selectedNode ? (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '6px 8px', borderRadius: 4,
          border: `1px solid ${t.blue}`, background: t.bgInput,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <span style={{ fontSize: 13, color: t.text, fontWeight: 500 }}>{selectedNode.name}</span>
            <span style={{ fontSize: 11, color: t.textFaint, marginLeft: 6 }}>
              {selectedNode.id} · {typeTag(selectedNode)} · {countryName(selectedNode.country)}
            </span>
          </div>
          <button
            type="button" onClick={clear}
            style={{
              flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer',
              color: t.textFaint, fontSize: 16, lineHeight: 1, padding: '0 2px',
            }}
          >×</button>
        </div>
      ) : (
        <input
          ref={inputRef}
          value={query}
          placeholder={placeholder}
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          style={inputBase}
          autoComplete="off"
        />
      )}

      {open && filtered.length > 0 && (
        <div
          ref={listRef}
          style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 1000,
            background: t.bgPanel, border: `1px solid ${t.border}`,
            borderRadius: 6, maxHeight: 240, overflowY: 'auto',
            boxShadow: '0 8px 28px rgba(0,0,0,0.35)',
          }}
        >
          {filtered.map((n, i) => (
            <div
              key={n.id}
              onMouseDown={() => select(n.id)}
              style={{
                padding: '8px 12px', cursor: 'pointer',
                background: i === activeIdx ? t.bgDeep : 'transparent',
                borderBottom: i < filtered.length - 1 ? `1px solid ${t.border}` : 'none',
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 500, color: t.text }}>{n.name}</div>
              <div style={{ fontSize: 11, color: t.textFaint, marginTop: 1 }}>
                <span style={{
                  display: 'inline-block', fontSize: 9, fontWeight: 700,
                  padding: '1px 4px', borderRadius: 3, marginRight: 5,
                  background: n.type === 'landing_station' ? t.blue + '22' : t.orange + '22',
                  color: n.type === 'landing_station' ? t.blue : t.orange,
                }}>{typeTag(n)}</span>
                {n.id} · {countryName(n.country)}{n.owner ? ` · ${n.owner}` : ''}
              </div>
            </div>
          ))}
        </div>
      )}

      {open && query.trim().length > 0 && filtered.length === 0 && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 1000,
          background: t.bgPanel, border: `1px solid ${t.border}`,
          borderRadius: 6, padding: '10px 12px',
          boxShadow: '0 8px 28px rgba(0,0,0,0.35)',
        }}>
          <span style={{ fontSize: 12, color: t.textFaint }}>No nodes match "{query}"</span>
        </div>
      )}
    </div>
  )
}

export function SearchForm({ nodes, segments, systems = [], onSearch, loading, prefilledOrigin = '', prefilledDest = '' }: Props) {
  const t = useTheme()
  const [startNode, setStartNode] = useState(prefilledOrigin)
  const [endNode, setEndNode] = useState(prefilledDest)
  const [diversity, setDiversity] = useState<DiversityType>('none')
  const [mustIncludeNodes, setMustIncludeNodes] = useState<string[]>([])
  const [mustAvoidNodes, setMustAvoidNodes] = useState<string[]>([])
  const [mustAvoidSegs, setMustAvoidSegs] = useState<string[]>([])
  const [mustIncludeSegs, setMustIncludeSegs] = useState<string[]>([])
  const [mustIncludeSystems, setMustIncludeSystems] = useState<string[]>([])
  const [mustAvoidSystems, setMustAvoidSystems] = useState<string[]>([])
  const [advancedOpen, setAdvancedOpen] = useState(false)

  // Unique system IDs from segments (preserves order of first appearance)
  const segmentSystemIds = [...new Set(segments.map(s => s.system_id))]
  const systemOptions = segmentSystemIds.map(id => {
    const sys = systems.find(s => s.id === id)
    return { id, name: sys?.name ?? id }
  }).sort((a, b) => a.id.localeCompare(b.id))

  const groups = groupByCountry(nodes)  // still used by renderGroupedMulti

  function toggleMulti(id: string, list: string[], setter: (v: string[]) => void) {
    setter(list.includes(id) ? list.filter(x => x !== id) : [...list, id])
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!startNode || !endNode) return
    onSearch({
      start_node_id: startNode,
      end_node_id: endNode,
      must_include_nodes: mustIncludeNodes,
      must_avoid_nodes: mustAvoidNodes,
      must_avoid_segments: mustAvoidSegs,
      must_include_segments: mustIncludeSegs,
      must_include_systems: mustIncludeSystems,
      must_avoid_systems: mustAvoidSystems,
      diversity,
    })
  }

  const selectStyle: React.CSSProperties = {
    width: '100%', padding: '6px 8px', borderRadius: 4,
    border: `1px solid ${t.border}`, background: t.bgInput, color: t.text,
    fontSize: 13,
  }

  const multiBoxStyle: React.CSSProperties = {
    maxHeight: 110, overflowY: 'auto', border: `1px solid ${t.border}`,
    borderRadius: 4, padding: '4px 0', background: t.bgInput,
  }

  const multiItemStyle = (selected: boolean): React.CSSProperties => ({
    padding: '3px 8px 3px 16px', cursor: 'pointer', fontSize: 12,
    background: selected ? t.bgDeep : 'transparent',
    color: selected ? t.blue : t.text,
  })

  const groupHeaderStyle: React.CSSProperties = {
    padding: '4px 8px 2px', fontSize: 10, fontWeight: 700,
    color: t.textFaint, textTransform: 'uppercase', letterSpacing: '0.06em',
    borderTop: `1px solid ${t.border}`, marginTop: 2,
  }

  const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: 11, fontWeight: 600,
    color: t.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em',
    marginBottom: 4,
  }

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
              <div key={n.id} style={multiItemStyle(selected.includes(n.id))} onClick={() => onToggle(n.id)}>
                {nodeLabel(n)}
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )

  const advancedCount = mustIncludeNodes.length + mustAvoidNodes.length + mustAvoidSegs.length + mustIncludeSegs.length + mustIncludeSystems.length + mustAvoidSystems.length

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <label style={labelStyle}>Origin</label>
        <NodeCombobox nodes={nodes} value={startNode} onChange={setStartNode} placeholder="Search city, code, country, owner…" />
      </div>

      <div>
        <label style={labelStyle}>Destination</label>
        <NodeCombobox nodes={nodes} value={endNode} onChange={setEndNode} placeholder="Search city, code, country, owner…" />
      </div>

      <div>
        <label style={labelStyle}>Diversity</label>
        <select value={diversity} onChange={e => setDiversity(e.target.value as DiversityType)} style={selectStyle}>
          <option value="none">None</option>
          <option value="terrestrial_origin">Terrestrial Diversity — Origin End Only</option>
          <option value="terrestrial_destination">Terrestrial Diversity — Destination End Only</option>
          <option value="terrestrial_both">Terrestrial Diversity — Both Ends</option>
          <option value="wet">Wet Diversity</option>
          <option value="full">Full Diversity — Segments Only</option>
          <option value="full_nodes">Full Diversity — Segments and Nodes</option>
        </select>
      </div>

      {/* Advanced Constraints */}
      <div style={{ borderRadius: 6, border: `1px solid ${t.border}`, overflow: 'hidden' }}>
        <button
          type="button"
          onClick={() => setAdvancedOpen(o => !o)}
          style={{
            width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '8px 10px', background: t.bgDeep, border: 'none', cursor: 'pointer',
            color: t.textMuted, fontSize: 11, fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: '0.06em',
          }}
        >
          <span>Advanced Constraints</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {advancedCount > 0 && (
              <span style={{
                fontSize: 10, fontWeight: 700, color: t.blue,
                background: t.bgActiveSort, borderRadius: 10,
                padding: '1px 6px',
              }}>
                {advancedCount}
              </span>
            )}
            <span style={{ fontSize: 10, color: t.textFaint, transition: 'transform 0.2s', display: 'inline-block', transform: advancedOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}>▾</span>
          </span>
        </button>

        {advancedOpen && (
          <div style={{ padding: '10px', display: 'flex', flexDirection: 'column', gap: 10, borderTop: `1px solid ${t.border}` }}>
            <div>
              <label style={labelStyle}>Must Include Nodes</label>
              {renderGroupedMulti([startNode, endNode], mustIncludeNodes, id => toggleMulti(id, mustIncludeNodes, setMustIncludeNodes))}
            </div>

            <div>
              <label style={labelStyle}>Must Avoid Nodes</label>
              {renderGroupedMulti([startNode, endNode], mustAvoidNodes, id => toggleMulti(id, mustAvoidNodes, setMustAvoidNodes))}
            </div>

            <div>
              <label style={labelStyle}>Must Avoid Segments</label>
              <div style={multiBoxStyle}>
                {segments.map(s => (
                  <div key={s.id} style={multiItemStyle(mustAvoidSegs.includes(s.id))} onClick={() => toggleMulti(s.id, mustAvoidSegs, setMustAvoidSegs)}>
                    {s.name}
                  </div>
                ))}
              </div>
            </div>

            <div>
              <label style={labelStyle}>Must Include Segments</label>
              <div style={multiBoxStyle}>
                {segments.map(s => (
                  <div key={s.id} style={multiItemStyle(mustIncludeSegs.includes(s.id))} onClick={() => toggleMulti(s.id, mustIncludeSegs, setMustIncludeSegs)}>
                    {s.name}
                  </div>
                ))}
              </div>
            </div>

            <div>
              <label style={labelStyle}>Must Include System <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(≥1 segment)</span></label>
              <div style={multiBoxStyle}>
                {systemOptions.map(s => (
                  <div key={s.id} style={multiItemStyle(mustIncludeSystems.includes(s.id))} onClick={() => toggleMulti(s.id, mustIncludeSystems, setMustIncludeSystems)}>
                    <strong>{s.id}</strong> — {s.name}
                  </div>
                ))}
              </div>
            </div>

            <div>
              <label style={labelStyle}>Must Avoid System</label>
              <div style={multiBoxStyle}>
                {systemOptions.map(s => (
                  <div key={s.id} style={multiItemStyle(mustAvoidSystems.includes(s.id))} onClick={() => toggleMulti(s.id, mustAvoidSystems, setMustAvoidSystems)}>
                    <strong>{s.id}</strong> — {s.name}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      <button
        type="submit"
        disabled={loading || !startNode || !endNode}
        style={{
          padding: '8px 16px', borderRadius: 4, border: 'none',
          background: loading ? t.borderSubtle : t.blue,
          color: loading ? t.textFaint : t.bgBase,
          fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer',
          fontSize: 14,
        }}
      >
        {loading ? 'Searching...' : 'Find Routes'}
      </button>
    </form>
  )
}
