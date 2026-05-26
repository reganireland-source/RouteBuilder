import { useState, useMemo, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
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
  prefill?: Partial<RouteRequest>
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

function toggleMulti(id: string, list: string[], setter: (v: string[]) => void) {
  setter(list.includes(id) ? list.filter(x => x !== id) : [...list, id])
}

const CONSTRAINT_DEFS = [
  {
    id: 'must_include_nodes',
    label: 'Must Include Nodes',
    description: 'The route must pass through every node selected here. Use this to ensure traffic visits a specific landing station or PoP on the way between origin and destination.',
  },
  {
    id: 'must_avoid_nodes',
    label: 'Must Avoid Nodes',
    description: 'The route will not pass through any selected node. Use this to exclude a facility that is unavailable, restricted, or otherwise not suitable for the route.',
  },
  {
    id: 'must_include_segments',
    label: 'Must Include Segments',
    description: 'The route must traverse every segment selected here. Use this to lock in a specific cable section — for example, a preferred submarine segment that must carry the traffic.',
  },
  {
    id: 'must_avoid_segments',
    label: 'Must Avoid Segments',
    description: 'The route will not traverse any selected segment. Use this to exclude a cable section that is under maintenance, congested, or otherwise at risk.',
  },
  {
    id: 'must_include_systems',
    label: 'Must Include Systems',
    description: 'At least one segment from every selected cable system must appear on the route. Use this to ensure the path rides a particular submarine cable system.',
  },
  {
    id: 'must_avoid_systems',
    label: 'Must Avoid Systems',
    description: 'No segments from any selected system will be used. Use this to route entirely clear of a cable system — for example, one affected by an outage or excluded by commercial policy.',
  },
  {
    id: 'max_hops',
    label: 'Max Hops',
    description: 'Limits how many cable segments the route may traverse. Each segment counts as one hop — so a route through 4 nodes has 3 hops. Wet hops cross ocean; terrestrial hops cross land. Leave a field blank to apply no limit for that type.',
  },
]

function FilteredMulti({ items, selected, onToggle, placeholder, listHeight = 130 }: {
  items: { id: string; primary: string; secondary?: string }[]
  selected: string[]
  onToggle: (id: string) => void
  placeholder: string
  listHeight?: number
}) {
  const t = useTheme()
  const [query, setQuery] = useState('')

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const base = q
      ? items.filter(it =>
          it.id.toLowerCase().includes(q) ||
          it.primary.toLowerCase().includes(q) ||
          (it.secondary ?? '').toLowerCase().includes(q)
        )
      : items
    return base.slice(0, 50)
  }, [query, items])

  const selectedItems = items.filter(it => selected.includes(it.id))

  return (
    <div style={{ border: `1px solid ${t.border}`, borderRadius: 4, background: t.bgInput, overflow: 'hidden' }}>
      {selectedItems.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '6px 8px', borderBottom: `1px solid ${t.border}` }}>
          {selectedItems.map(it => (
            <span
              key={it.id}
              onClick={() => onToggle(it.id)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '2px 6px', borderRadius: 10,
                background: t.blue + '22', border: `1px solid ${t.blue}44`,
                color: t.blue, fontSize: 11, cursor: 'pointer',
              }}
            >
              {it.primary} <span style={{ fontSize: 13, lineHeight: 1 }}>×</span>
            </span>
          ))}
        </div>
      )}
      <input
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder={placeholder}
        style={{
          width: '100%', padding: '5px 8px', border: 'none',
          borderBottom: `1px solid ${t.border}`, background: t.bgInput,
          color: t.text, fontSize: 12, boxSizing: 'border-box', outline: 'none',
        }}
      />
      <div style={{ maxHeight: listHeight, overflowY: 'auto' }}>
        {visible.length === 0
          ? <div style={{ padding: '8px 10px', fontSize: 12, color: t.textFaintest }}>No matches</div>
          : visible.map(it => {
              const isSelected = selected.includes(it.id)
              return (
                <div
                  key={it.id}
                  onClick={() => onToggle(it.id)}
                  style={{
                    padding: '5px 8px', cursor: 'pointer', fontSize: 12,
                    background: isSelected ? t.blue + '18' : 'transparent',
                    display: 'flex', alignItems: 'center', gap: 6,
                  }}
                >
                  <span style={{ color: isSelected ? t.blue : t.text, fontWeight: isSelected ? 600 : 400, flex: 1 }}>
                    {it.primary}
                  </span>
                  {it.secondary && (
                    <span style={{ color: t.textFaintest, fontSize: 10 }}>{it.secondary}</span>
                  )}
                </div>
              )
            })
        }
      </div>
    </div>
  )
}

function FilteredNodeMulti({ nodes, exclude, selected, onToggle, listHeight = 130 }: {
  nodes: CableNode[]
  exclude: string[]
  selected: string[]
  onToggle: (id: string) => void
  listHeight?: number
}) {
  const t = useTheme()
  const [query, setQuery] = useState('')

  const typeTag = (n: CableNode) => n.type === 'landing_station' ? 'CLS' : 'POP'

  const pool = nodes.filter(n => n.type !== 'branching_unit' && !exclude.includes(n.id))

  const visible: CableNode[] = useMemo(() => {
    const q = query.trim().toLowerCase()
    const base = q
      ? pool.filter(n =>
          n.id.toLowerCase().includes(q) ||
          n.name.toLowerCase().includes(q) ||
          countryName(n.country).toLowerCase().includes(q) ||
          n.country.toLowerCase().includes(q) ||
          (n.owner ?? '').toLowerCase().includes(q)
        )
      : pool
    return base.slice(0, 50)
  }, [query, pool])

  const selectedNodes = pool.filter(n => selected.includes(n.id))

  return (
    <div style={{ border: `1px solid ${t.border}`, borderRadius: 4, background: t.bgInput, overflow: 'hidden' }}>
      {selectedNodes.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '6px 8px', borderBottom: `1px solid ${t.border}` }}>
          {selectedNodes.map(n => (
            <span
              key={n.id}
              onClick={() => onToggle(n.id)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '2px 6px', borderRadius: 10,
                background: t.blue + '22', border: `1px solid ${t.blue}44`,
                color: t.blue, fontSize: 11, cursor: 'pointer',
              }}
            >
              {n.name} <span style={{ fontSize: 13, lineHeight: 1 }}>×</span>
            </span>
          ))}
        </div>
      )}
      <input
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Filter nodes…"
        style={{
          width: '100%', padding: '5px 8px', border: 'none',
          borderBottom: `1px solid ${t.border}`, background: t.bgInput,
          color: t.text, fontSize: 12, boxSizing: 'border-box', outline: 'none',
        }}
      />
      <div style={{ maxHeight: listHeight, overflowY: 'auto' }}>
        {visible.length === 0
          ? <div style={{ padding: '8px 10px', fontSize: 12, color: t.textFaintest }}>No nodes match</div>
          : visible.map(n => {
              const isSelected = selected.includes(n.id)
              return (
                <div
                  key={n.id}
                  onClick={() => onToggle(n.id)}
                  style={{
                    padding: '5px 8px', cursor: 'pointer', fontSize: 12,
                    background: isSelected ? t.blue + '18' : 'transparent',
                    display: 'flex', alignItems: 'center', gap: 6,
                  }}
                >
                  <span style={{
                    fontSize: 9, fontWeight: 700, padding: '1px 4px', borderRadius: 3, flexShrink: 0,
                    background: n.type === 'landing_station' ? t.blue + '22' : t.orange + '22',
                    color: n.type === 'landing_station' ? t.blue : t.orange,
                  }}>{typeTag(n)}</span>
                  <span style={{ color: isSelected ? t.blue : t.text, fontWeight: isSelected ? 600 : 400, flex: 1 }}>
                    {n.name}
                  </span>
                  <span style={{ color: t.textFaintest, fontSize: 10 }}>{n.id}</span>
                </div>
              )
            })
        }
      </div>
    </div>
  )
}

function HopStepper({ label, icon, value, onChange }: {
  label: string
  icon: string
  value: number | ''
  onChange: (v: number | '') => void
}) {
  const t = useTheme()
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 20 }}>
      <div style={{ fontSize: 36, lineHeight: 1, marginTop: 4 }}>{icon}</div>
      <div>
        <div style={{
          fontSize: 11, fontWeight: 700, color: t.textMuted,
          textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12,
        }}>{label}</div>
        <div style={{
          display: 'flex', alignItems: 'center',
          border: `1px solid ${t.border}`, borderRadius: 6, overflow: 'hidden',
          width: 'fit-content',
        }}>
          <button
            type="button"
            onClick={() => onChange(value === '' || (value as number) <= 1 ? '' : (value as number) - 1)}
            style={{
              width: 38, height: 38, background: t.bgDeep, border: 'none',
              cursor: 'pointer', color: t.text, fontSize: 22,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >−</button>
          <div style={{ width: 1, height: 38, background: t.border, flexShrink: 0 }} />
          <input
            type="number"
            min={1}
            value={value}
            onChange={e => {
              const raw = e.target.value
              if (raw === '') { onChange(''); return }
              const n = parseInt(raw, 10)
              if (!isNaN(n) && n >= 1) onChange(n)
            }}
            placeholder="∞"
            style={{
              width: 80, height: 38, textAlign: 'center',
              background: t.bgInput, border: 'none',
              color: value === '' ? t.textFaint : t.text,
              fontSize: 18, fontWeight: 700, outline: 'none', padding: 0,
            }}
          />
          <div style={{ width: 1, height: 38, background: t.border, flexShrink: 0 }} />
          <button
            type="button"
            onClick={() => onChange(value === '' ? 1 : (value as number) + 1)}
            style={{
              width: 38, height: 38, background: t.bgDeep, border: 'none',
              cursor: 'pointer', color: t.text, fontSize: 22,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >+</button>
        </div>
        <div style={{ marginTop: 8, fontSize: 12, color: t.textFaint }}>
          {value === '' ? 'No limit applied' : `Maximum ${value} hop${value === 1 ? '' : 's'}`}
        </div>
      </div>
    </div>
  )
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

function AdvancedConstraintsModal({
  open, onClose,
  nodes, segments, systemOptions,
  startNode, endNode,
  mustIncludeNodes, setMustIncludeNodes,
  mustAvoidNodes, setMustAvoidNodes,
  mustAvoidSegs, setMustAvoidSegs,
  mustIncludeSegs, setMustIncludeSegs,
  mustIncludeSystems, setMustIncludeSystems,
  mustAvoidSystems, setMustAvoidSystems,
  maxWetHops, setMaxWetHops,
  maxTerrestrialHops, setMaxTerrestrialHops,
  activeTab, setActiveTab,
  onClearAll,
}: {
  open: boolean
  onClose: () => void
  nodes: CableNode[]
  segments: CableSegment[]
  systemOptions: { id: string; name: string }[]
  startNode: string
  endNode: string
  mustIncludeNodes: string[]
  setMustIncludeNodes: (v: string[]) => void
  mustAvoidNodes: string[]
  setMustAvoidNodes: (v: string[]) => void
  mustAvoidSegs: string[]
  setMustAvoidSegs: (v: string[]) => void
  mustIncludeSegs: string[]
  setMustIncludeSegs: (v: string[]) => void
  mustIncludeSystems: string[]
  setMustIncludeSystems: (v: string[]) => void
  mustAvoidSystems: string[]
  setMustAvoidSystems: (v: string[]) => void
  maxWetHops: number | ''
  setMaxWetHops: (v: number | '') => void
  maxTerrestrialHops: number | ''
  setMaxTerrestrialHops: (v: number | '') => void
  activeTab: string
  setActiveTab: (v: string) => void
  onClearAll: () => void
}) {
  const t = useTheme()

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const totalCount =
    mustIncludeNodes.length + mustAvoidNodes.length +
    mustAvoidSegs.length + mustIncludeSegs.length +
    mustIncludeSystems.length + mustAvoidSystems.length +
    (maxWetHops !== '' ? 1 : 0) + (maxTerrestrialHops !== '' ? 1 : 0)

  function getChips(id: string): { chips: string[]; hasValue: boolean } {
    switch (id) {
      case 'must_include_nodes':
        return { chips: mustIncludeNodes.map(nid => nodes.find(n => n.id === nid)?.name ?? nid), hasValue: mustIncludeNodes.length > 0 }
      case 'must_avoid_nodes':
        return { chips: mustAvoidNodes.map(nid => nodes.find(n => n.id === nid)?.name ?? nid), hasValue: mustAvoidNodes.length > 0 }
      case 'must_include_segments':
        return { chips: mustIncludeSegs.map(sid => segments.find(s => s.id === sid)?.name ?? sid), hasValue: mustIncludeSegs.length > 0 }
      case 'must_avoid_segments':
        return { chips: mustAvoidSegs.map(sid => segments.find(s => s.id === sid)?.name ?? sid), hasValue: mustAvoidSegs.length > 0 }
      case 'must_include_systems':
        return { chips: mustIncludeSystems.map(sid => systemOptions.find(s => s.id === sid)?.name ?? sid), hasValue: mustIncludeSystems.length > 0 }
      case 'must_avoid_systems':
        return { chips: mustAvoidSystems.map(sid => systemOptions.find(s => s.id === sid)?.name ?? sid), hasValue: mustAvoidSystems.length > 0 }
      case 'max_hops': {
        const chips: string[] = []
        if (maxWetHops !== '') chips.push(`🌊 Wet: ${maxWetHops}`)
        if (maxTerrestrialHops !== '') chips.push(`⛰️ Land: ${maxTerrestrialHops}`)
        return { chips, hasValue: chips.length > 0 }
      }
      default: return { chips: [], hasValue: false }
    }
  }

  function clearConstraint(id: string) {
    switch (id) {
      case 'must_include_nodes': setMustIncludeNodes([]); break
      case 'must_avoid_nodes': setMustAvoidNodes([]); break
      case 'must_include_segments': setMustIncludeSegs([]); break
      case 'must_avoid_segments': setMustAvoidSegs([]); break
      case 'must_include_systems': setMustIncludeSystems([]); break
      case 'must_avoid_systems': setMustAvoidSystems([]); break
      case 'max_hops': setMaxWetHops(''); setMaxTerrestrialHops(''); break
    }
  }

  const activeDef = CONSTRAINT_DEFS.find(d => d.id === activeTab) ?? CONSTRAINT_DEFS[0]
  const LIST_H = 300

  function renderPanel() {
    switch (activeTab) {
      case 'must_include_nodes':
        return <FilteredNodeMulti nodes={nodes} exclude={[startNode, endNode]} selected={mustIncludeNodes} onToggle={id => toggleMulti(id, mustIncludeNodes, setMustIncludeNodes)} listHeight={LIST_H} />
      case 'must_avoid_nodes':
        return <FilteredNodeMulti nodes={nodes} exclude={[startNode, endNode]} selected={mustAvoidNodes} onToggle={id => toggleMulti(id, mustAvoidNodes, setMustAvoidNodes)} listHeight={LIST_H} />
      case 'must_include_segments':
        return <FilteredMulti items={segments.map(s => ({ id: s.id, primary: s.name, secondary: s.id }))} selected={mustIncludeSegs} onToggle={id => toggleMulti(id, mustIncludeSegs, setMustIncludeSegs)} placeholder="Filter segments…" listHeight={LIST_H} />
      case 'must_avoid_segments':
        return <FilteredMulti items={segments.map(s => ({ id: s.id, primary: s.name, secondary: s.id }))} selected={mustAvoidSegs} onToggle={id => toggleMulti(id, mustAvoidSegs, setMustAvoidSegs)} placeholder="Filter segments…" listHeight={LIST_H} />
      case 'must_include_systems':
        return <FilteredMulti items={systemOptions.map(s => ({ id: s.id, primary: s.id, secondary: s.name }))} selected={mustIncludeSystems} onToggle={id => toggleMulti(id, mustIncludeSystems, setMustIncludeSystems)} placeholder="Filter systems…" listHeight={LIST_H} />
      case 'must_avoid_systems':
        return <FilteredMulti items={systemOptions.map(s => ({ id: s.id, primary: s.id, secondary: s.name }))} selected={mustAvoidSystems} onToggle={id => toggleMulti(id, mustAvoidSystems, setMustAvoidSystems)} placeholder="Filter systems…" listHeight={LIST_H} />
      case 'max_hops':
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
            <HopStepper label="Max Wet Hops" icon="🌊" value={maxWetHops} onChange={setMaxWetHops} />
            <div style={{ height: 1, background: t.border }} />
            <HopStepper label="Max Terrestrial Hops" icon="⛰️" value={maxTerrestrialHops} onChange={setMaxTerrestrialHops} />
          </div>
        )
      default: return null
    }
  }

  if (!open) return null

  return createPortal(
    <>
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, zIndex: 1999, background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(2px)' }}
      />
      <div style={{
        position: 'fixed', zIndex: 2000,
        top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)',
        width: 780, maxWidth: 'calc(100vw - 40px)',
        height: 560, maxHeight: 'calc(100vh - 80px)',
        background: t.bgPanel,
        border: `1px solid ${t.border}`,
        borderRadius: 10,
        boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        fontFamily: 'system-ui, sans-serif',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 18px',
          borderBottom: `1px solid ${t.border}`,
          background: t.bgDeep,
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 800, color: t.text, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              Advanced Constraints
            </span>
            {totalCount > 0 && (
              <span style={{
                fontSize: 10, fontWeight: 700,
                background: t.blue + '22', color: t.blue,
                borderRadius: 10, padding: '2px 8px',
              }}>{totalCount} active</span>
            )}
          </div>
          <button
            type="button" onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: t.textFaint, fontSize: 20, lineHeight: 1, padding: '0 4px' }}
          >×</button>
        </div>

        {/* Body */}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {/* Sidebar */}
          <div style={{
            width: 210, flexShrink: 0,
            borderRight: `1px solid ${t.border}`,
            display: 'flex', flexDirection: 'column',
            background: t.bgDeep,
          }}>
            <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0' }}>
              {CONSTRAINT_DEFS.map(def => {
                const isActive = activeTab === def.id
                const { chips, hasValue } = getChips(def.id)
                return (
                  <div
                    key={def.id}
                    onClick={() => setActiveTab(def.id)}
                    style={{
                      padding: '9px 12px',
                      cursor: 'pointer',
                      background: isActive ? t.blue + '18' : 'transparent',
                      borderLeft: `3px solid ${isActive ? t.blue : 'transparent'}`,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {hasValue && (
                        <div style={{ width: 6, height: 6, borderRadius: '50%', background: t.blue, flexShrink: 0 }} />
                      )}
                      <span style={{
                        flex: 1, fontSize: 12, fontWeight: 600,
                        color: isActive ? t.text : hasValue ? t.textMuted : t.textFaint,
                      }}>
                        {def.label}
                      </span>
                      {hasValue && (
                        <button
                          type="button"
                          onClick={e => { e.stopPropagation(); clearConstraint(def.id) }}
                          style={{
                            background: 'none', border: 'none', cursor: 'pointer',
                            color: t.textFaint, fontSize: 14, lineHeight: 1,
                            padding: '0 2px', flexShrink: 0,
                          }}
                        >×</button>
                      )}
                    </div>
                    {chips.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 5, paddingLeft: 12 }}>
                        {chips.slice(0, 3).map((chip, i) => (
                          <span key={i} style={{
                            fontSize: 9, padding: '1px 5px', borderRadius: 8,
                            background: t.blue + '1a', color: t.blue,
                            fontWeight: 600, maxWidth: 155,
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            display: 'inline-block',
                          }}>{chip}</span>
                        ))}
                        {chips.length > 3 && (
                          <span style={{ fontSize: 9, color: t.textFaint, alignSelf: 'center' }}>
                            +{chips.length - 3}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Clear All */}
            <div style={{ padding: '10px 12px', borderTop: `1px solid ${t.border}`, flexShrink: 0 }}>
              <button
                type="button"
                onClick={onClearAll}
                disabled={totalCount === 0}
                style={{
                  width: '100%', padding: '7px', borderRadius: 4,
                  border: `1px solid ${totalCount > 0 ? t.red + '55' : 'transparent'}`,
                  background: totalCount > 0 ? t.red + '10' : 'transparent',
                  color: totalCount > 0 ? t.red : t.textFaintest,
                  fontSize: 11, fontWeight: 700,
                  cursor: totalCount > 0 ? 'pointer' : 'default',
                  letterSpacing: '0.04em', textTransform: 'uppercase',
                }}
              >Clear All</button>
            </div>
          </div>

          {/* Content panel */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
            {/* Description */}
            <div style={{ padding: '16px 20px 14px', borderBottom: `1px solid ${t.border}`, flexShrink: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: t.text, marginBottom: 6 }}>
                {activeDef.label}
              </div>
              <div style={{ fontSize: 12, color: t.textMuted, lineHeight: 1.65 }}>
                {activeDef.description}
              </div>
            </div>

            {/* Parameter input */}
            <div style={{ flex: 1, padding: '16px 20px', overflowY: 'auto' }}>
              {renderPanel()}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
          padding: '10px 18px',
          borderTop: `1px solid ${t.border}`,
          background: t.bgDeep,
          flexShrink: 0,
          gap: 10,
        }}>
          {totalCount > 0 && (
            <span style={{ fontSize: 11, color: t.textFaint, marginRight: 'auto' }}>
              <span style={{ color: t.blue, fontWeight: 600 }}>{totalCount}</span> constraint{totalCount !== 1 ? 's' : ''} active
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '7px 24px', borderRadius: 6,
              border: `1px solid ${t.blue}`,
              background: t.blue,
              color: '#0f172a',
              fontSize: 13, fontWeight: 700,
              cursor: 'pointer',
              letterSpacing: '0.02em',
            }}
          >Apply</button>
        </div>
      </div>
    </>,
    document.body
  )
}

export function SearchForm({ nodes, segments, systems = [], onSearch, loading, prefilledOrigin = '', prefilledDest = '', prefill }: Props) {
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
  const [maxWetHops, setMaxWetHops] = useState<number | ''>('')
  const [maxTerrestrialHops, setMaxTerrestrialHops] = useState<number | ''>('')
  const [modalOpen, setModalOpen] = useState(false)
  const [activeConstraintTab, setActiveConstraintTab] = useState('must_include_nodes')

  // Sync external prefill (from TSABuddy) — new object reference = new fill
  useEffect(() => {
    if (!prefill) return
    if (prefill.start_node_id)     setStartNode(prefill.start_node_id)
    if (prefill.end_node_id)       setEndNode(prefill.end_node_id)
    if (prefill.diversity)         setDiversity(prefill.diversity)
    if (prefill.must_include_nodes)    setMustIncludeNodes(prefill.must_include_nodes)
    if (prefill.must_avoid_nodes)      setMustAvoidNodes(prefill.must_avoid_nodes)
    if (prefill.must_include_segments) setMustIncludeSegs(prefill.must_include_segments)
    if (prefill.must_avoid_segments)   setMustAvoidSegs(prefill.must_avoid_segments)
    if (prefill.must_include_systems)  setMustIncludeSystems(prefill.must_include_systems)
    if (prefill.must_avoid_systems)    setMustAvoidSystems(prefill.must_avoid_systems)
    if (prefill.max_wet_hops != null)         setMaxWetHops(prefill.max_wet_hops)
    if (prefill.max_terrestrial_hops != null) setMaxTerrestrialHops(prefill.max_terrestrial_hops)
    const hasAdvanced = (
      (prefill.must_include_nodes?.length    ?? 0) > 0 ||
      (prefill.must_avoid_nodes?.length      ?? 0) > 0 ||
      (prefill.must_include_segments?.length ?? 0) > 0 ||
      (prefill.must_avoid_segments?.length   ?? 0) > 0 ||
      (prefill.must_include_systems?.length  ?? 0) > 0 ||
      (prefill.must_avoid_systems?.length    ?? 0) > 0 ||
      prefill.max_wet_hops != null ||
      prefill.max_terrestrial_hops != null
    )
    if (hasAdvanced) setModalOpen(true)
  }, [prefill])

  // Sync origin/dest set from map node clicks
  useEffect(() => { if (prefilledOrigin) setStartNode(prefilledOrigin) }, [prefilledOrigin])
  useEffect(() => { if (prefilledDest)   setEndNode(prefilledDest)   }, [prefilledDest])

  const segmentSystemIds = [...new Set(segments.map(s => s.system_id))]
  const systemOptions = segmentSystemIds.map(id => {
    const sys = systems.find(s => s.id === id)
    return { id, name: sys?.name ?? id }
  }).sort((a, b) => a.id.localeCompare(b.id))

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
      max_wet_hops: maxWetHops === '' ? undefined : maxWetHops as number,
      max_terrestrial_hops: maxTerrestrialHops === '' ? undefined : maxTerrestrialHops as number,
    })
  }

  function clearAllConstraints() {
    setMustIncludeNodes([])
    setMustAvoidNodes([])
    setMustAvoidSegs([])
    setMustIncludeSegs([])
    setMustIncludeSystems([])
    setMustAvoidSystems([])
    setMaxWetHops('')
    setMaxTerrestrialHops('')
    setActiveConstraintTab('must_include_nodes')
  }

  const selectStyle: React.CSSProperties = {
    width: '100%', padding: '6px 8px', borderRadius: 4,
    border: `1px solid ${t.border}`, background: t.bgInput, color: t.text,
    fontSize: 13,
  }

  const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: 11, fontWeight: 600,
    color: t.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em',
    marginBottom: 4,
  }

  const advancedCount =
    mustIncludeNodes.length + mustAvoidNodes.length +
    mustAvoidSegs.length + mustIncludeSegs.length +
    mustIncludeSystems.length + mustAvoidSystems.length +
    (maxWetHops !== '' ? 1 : 0) + (maxTerrestrialHops !== '' ? 1 : 0)

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

      {/* Advanced Constraints button */}
      <button
        type="button"
        onClick={() => setModalOpen(true)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '8px 12px', borderRadius: 6,
          border: `1px solid ${advancedCount > 0 ? t.blue + '66' : t.border}`,
          background: advancedCount > 0 ? t.blue + '0d' : t.bgDeep,
          cursor: 'pointer',
          color: advancedCount > 0 ? t.blue : t.textMuted,
          fontSize: 11, fontWeight: 700,
          textTransform: 'uppercase', letterSpacing: '0.06em',
        }}
      >
        <span>Advanced Constraints</span>
        {advancedCount > 0 && (
          <span style={{
            fontSize: 10, fontWeight: 700,
            background: t.blue + '22', color: t.blue,
            borderRadius: 10, padding: '1px 7px',
          }}>{advancedCount}</span>
        )}
      </button>

      <AdvancedConstraintsModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        nodes={nodes}
        segments={segments}
        systemOptions={systemOptions}
        startNode={startNode}
        endNode={endNode}
        mustIncludeNodes={mustIncludeNodes}
        setMustIncludeNodes={setMustIncludeNodes}
        mustAvoidNodes={mustAvoidNodes}
        setMustAvoidNodes={setMustAvoidNodes}
        mustAvoidSegs={mustAvoidSegs}
        setMustAvoidSegs={setMustAvoidSegs}
        mustIncludeSegs={mustIncludeSegs}
        setMustIncludeSegs={setMustIncludeSegs}
        mustIncludeSystems={mustIncludeSystems}
        setMustIncludeSystems={setMustIncludeSystems}
        mustAvoidSystems={mustAvoidSystems}
        setMustAvoidSystems={setMustAvoidSystems}
        maxWetHops={maxWetHops}
        setMaxWetHops={setMaxWetHops}
        maxTerrestrialHops={maxTerrestrialHops}
        setMaxTerrestrialHops={setMaxTerrestrialHops}
        activeTab={activeConstraintTab}
        setActiveTab={setActiveConstraintTab}
        onClearAll={clearAllConstraints}
      />

      <style>{`
        @keyframes sea-sweep {
          0%   { background-position: 0% 50% }
          100% { background-position: 100% 50% }
        }
      `}</style>

      <button
        type="submit"
        disabled={loading || !startNode || !endNode}
        style={{
          padding: '8px 16px', borderRadius: 4, border: 'none',
          fontWeight: 600, fontSize: 14,
          cursor: loading ? 'not-allowed' : (!startNode || !endNode) ? 'not-allowed' : 'pointer',
          color: (!startNode && !loading) || (!endNode && !loading) ? t.textFaint : '#e0f2fe',
          background: loading
            ? 'linear-gradient(90deg, #1e3a8a, #1d4ed8, #0ea5e9, #bae6fd, #e0f2fe, #bae6fd, #0ea5e9, #1d4ed8, #1e3a8a)'
            : (!startNode || !endNode)
              ? t.borderSubtle
              : t.blue,
          backgroundSize: loading ? '300% 100%' : '100% 100%',
          animation: loading ? 'sea-sweep 1.6s ease-in-out infinite alternate' : 'none',
          transition: 'background 0.3s',
        }}
      >
        {loading ? '🌊 Searching…' : 'Find Routes'}
      </button>
    </form>
  )
}
