import { useState, useRef, useEffect } from 'react'
import { api } from '../api/client'
import { useTheme } from '../theme'
import type { AppMode, CableNode, NlpParseResponse, NlpSortMode, RouteRequest } from '../types'

interface Props {
  nodes: CableNode[]
  onSearch: (req: RouteRequest) => void
  onSwitchMode: (mode: AppMode) => void
  onApplySort?: (mode: NlpSortMode) => void
  onPrefill?: (req: Partial<RouteRequest>) => void
}

function TSABuddyAvatar({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Antenna */}
      <line x1="16" y1="5" x2="16" y2="9" stroke="#60a5fa" strokeWidth="1.5" strokeLinecap="round"/>
      <circle cx="16" cy="3.5" r="2" fill="#60a5fa"/>
      {/* Head */}
      <rect x="4" y="9" width="24" height="17" rx="4" fill="#1e3a5f" stroke="#60a5fa" strokeWidth="1.5"/>
      {/* Ear bolts */}
      <rect x="1.5" y="14" width="2.5" height="5" rx="1" fill="#1e3a5f" stroke="#60a5fa" strokeWidth="1"/>
      <rect x="28" y="14" width="2.5" height="5" rx="1" fill="#1e3a5f" stroke="#60a5fa" strokeWidth="1"/>
      {/* Eyes */}
      <circle cx="11.5" cy="17" r="3.5" fill="#0ea5e9" opacity="0.9"/>
      <circle cx="20.5" cy="17" r="3.5" fill="#0ea5e9" opacity="0.9"/>
      <circle cx="12.5" cy="16" r="1.2" fill="white" opacity="0.85"/>
      <circle cx="21.5" cy="16" r="1.2" fill="white" opacity="0.85"/>
      {/* Mouth — segmented bar */}
      <rect x="9"  y="22.5" width="2.5" height="2" rx="0.5" fill="#60a5fa" opacity="0.7"/>
      <rect x="12.5" y="22.5" width="2.5" height="2" rx="0.5" fill="#60a5fa" opacity="0.9"/>
      <rect x="16"  y="22.5" width="2.5" height="2" rx="0.5" fill="#60a5fa" opacity="0.7"/>
      <rect x="19.5" y="22.5" width="2.5" height="2" rx="0.5" fill="#60a5fa" opacity="0.5"/>
    </svg>
  )
}

const CONFIDENCE_COLOR: Record<string, string> = {
  high:   '#22c55e',
  medium: '#f59e0b',
  low:    '#ef4444',
}

const EXAMPLES = [
  'Singapore to Hong Kong with wet diversity',
  'Sydney to Tokyo avoiding AAG',
  'Perth to Singapore via SIN3, sort by latency',
  'SIN3 to TKO1 on EAC, full diversity',
]

export default function NlpChat({ nodes, onSearch, onSwitchMode, onApplySort, onPrefill }: Props) {
  const t = useTheme()
  const [input, setInput]           = useState('')
  const [loading, setLoading]       = useState(false)
  const [result, setResult]         = useState<NlpParseResponse | null>(null)
  const [error, setError]           = useState<string | null>(null)
  const [expanded, setExpanded]     = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const nodesById = Object.fromEntries(nodes.map(n => [n.id, n]))

  useEffect(() => {
    if (expanded) inputRef.current?.focus()
  }, [expanded])

  async function handleSubmit() {
    const text = input.trim()
    if (!text || loading) return
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const res = await api.parseNlp(text)
      setResult(res)

      // Auto-search if confidence is high or medium and we have endpoints
      if ((res.confidence === 'high' || res.confidence === 'medium') && res.start_node_id && res.end_node_id) {
        onSwitchMode('routebuilder')
        const req: RouteRequest = {
          start_node_id:          res.start_node_id,
          end_node_id:            res.end_node_id,
          must_include_nodes:     res.must_include_nodes,
          must_avoid_nodes:       res.must_avoid_nodes,
          must_include_segments:  res.must_include_segments,
          must_avoid_segments:    res.must_avoid_segments,
          must_include_systems:   res.must_include_systems,
          must_avoid_systems:     res.must_avoid_systems,
          diversity:              res.diversity,
        }
        onPrefill?.({...req})
        onSearch(req)
        if (res.sort_mode && onApplySort) {
          onApplySort(res.sort_mode)
        }
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.startsWith('404')) {
        setError('TSABuddy is not enabled on the backend — set NLP_ENABLED=true in your Railway environment variables')
      } else if (msg.startsWith('503')) {
        setError('TSABuddy has no LLM provider configured — set ANTHROPIC_API_KEY (or OPENAI_API_KEY) in Railway')
      } else if (msg.startsWith('500')) {
        const detail = msg.slice(4).trim()
        setError(detail ? `TSABuddy server error: ${detail}` : 'TSABuddy server error — check Railway logs for details')
      } else {
        setError(`TSABuddy error: ${msg}`)
      }
    } finally {
      setLoading(false)
    }
  }

  const borderColor = t.border
  const panelBg = t.bgCard

  return (
    <div style={{
      borderTop: `1px solid ${borderColor}`,
      background: panelBg,
      flexShrink: 0,
      minWidth: 0,
      overflow: 'hidden',
    }}>
      {/* Header — always visible */}
      <button
        onClick={() => setExpanded(v => !v)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 8,
          padding: '7px 12px', background: 'none', border: 'none',
          cursor: 'pointer', color: t.text,
        }}
      >
        <TSABuddyAvatar size={22} />
        <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.03em', flex: 1, textAlign: 'left' }}>
          TSABuddy
        </span>
        <span style={{ fontSize: 10, color: t.textFaint }}>
          {expanded ? '▲' : '▼'}
        </span>
      </button>

      {/* Expandable body */}
      {expanded && (
        <div style={{ padding: '0 10px 10px' }}>

          {/* Example prompts */}
          {!result && !loading && (
            <div style={{ marginBottom: 8, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {EXAMPLES.map(ex => (
                <button
                  key={ex}
                  onClick={() => { setInput(ex); inputRef.current?.focus() }}
                  style={{
                    fontSize: 9, padding: '2px 6px', borderRadius: 10,
                    border: `1px solid ${borderColor}`, background: 'none',
                    color: t.textFaint, cursor: 'pointer', lineHeight: 1.4,
                  }}
                >
                  {ex}
                </button>
              ))}
            </div>
          )}

          {/* Input row */}
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSubmit() }}
              placeholder="Ask me to build a route…"
              style={{
                flex: 1, fontSize: 12, padding: '6px 8px', borderRadius: 6,
                border: `1px solid ${borderColor}`, background: t.bgBase,
                color: t.text, outline: 'none',
              }}
            />
            <button
              onClick={handleSubmit}
              disabled={loading || !input.trim()}
              style={{
                padding: '6px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                border: 'none', cursor: loading ? 'wait' : 'pointer',
                background: loading ? t.border : t.blue,
                color: '#fff', opacity: !input.trim() ? 0.4 : 1,
                transition: 'opacity 0.15s',
              }}
            >
              {loading ? '…' : '→'}
            </button>
          </div>

          {/* Error */}
          {error && (
            <p style={{ fontSize: 11, color: t.red, marginTop: 8, lineHeight: 1.4 }}>{error}</p>
          )}

          {/* Result */}
          {result && (
            <div style={{ marginTop: 10 }}>
              {/* Explanation + confidence */}
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginBottom: 6 }}>
                <TSABuddyAvatar size={18} />
                <p style={{ fontSize: 11, color: t.text, lineHeight: 1.5, flex: 1, margin: 0, minWidth: 0, wordBreak: 'break-word' }}>
                  {result.explanation}
                </p>
              </div>

              {/* Confidence + sort badge row */}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
                <span style={{
                  fontSize: 10, padding: '1px 7px', borderRadius: 10,
                  background: CONFIDENCE_COLOR[result.confidence] + '22',
                  color: CONFIDENCE_COLOR[result.confidence], fontWeight: 600,
                }}>
                  {result.confidence} confidence
                </span>
                {result.sort_mode && (
                  <span style={{
                    fontSize: 10, padding: '1px 7px', borderRadius: 10,
                    background: t.blue + '22', color: t.blue, fontWeight: 600,
                  }}>
                    sort: {result.sort_mode}
                  </span>
                )}
              </div>

              {/* Parsed params summary */}
              <div style={{
                fontSize: 10, color: t.textMuted, lineHeight: 1.6,
                background: t.bgBase, borderRadius: 6, padding: '6px 8px',
              }}>
                {result.start_node_id && (
                  <div><span style={{ color: t.textFaint }}>From: </span>
                    <strong>{nodesById[result.start_node_id]?.name ?? result.start_node_id}</strong>
                    <span style={{ color: t.textFaintest }}> ({result.start_node_id})</span>
                  </div>
                )}
                {result.end_node_id && (
                  <div><span style={{ color: t.textFaint }}>To: </span>
                    <strong>{nodesById[result.end_node_id]?.name ?? result.end_node_id}</strong>
                    <span style={{ color: t.textFaintest }}> ({result.end_node_id})</span>
                  </div>
                )}
                {result.diversity !== 'none' && (
                  <div><span style={{ color: t.textFaint }}>Diversity: </span>{result.diversity}</div>
                )}
                {result.must_include_nodes.length > 0 && (
                  <div><span style={{ color: t.textFaint }}>Via: </span>{result.must_include_nodes.join(', ')}</div>
                )}
                {result.must_avoid_nodes.length > 0 && (
                  <div><span style={{ color: t.textFaint }}>Avoid nodes: </span>{result.must_avoid_nodes.join(', ')}</div>
                )}
                {result.must_avoid_segments.length > 0 && (
                  <div><span style={{ color: t.textFaint }}>Avoid segs: </span>{result.must_avoid_segments.join(', ')}</div>
                )}
                {result.must_include_systems.length > 0 && (
                  <div><span style={{ color: t.textFaint }}>Must use: </span>{result.must_include_systems.join(', ')}</div>
                )}
                {result.must_avoid_systems.length > 0 && (
                  <div><span style={{ color: t.textFaint }}>Avoid systems: </span>{result.must_avoid_systems.join(', ')}</div>
                )}
              </div>

              {/* Ambiguities */}
              {result.ambiguities.length > 0 && (
                <div style={{ marginTop: 6 }}>
                  {result.ambiguities.map((a, i) => (
                    <div key={i} style={{ fontSize: 10, color: t.orange, lineHeight: 1.5, wordBreak: 'break-word' }}>⚠ {a}</div>
                  ))}
                </div>
              )}

              {/* Manual trigger when confidence is low */}
              {result.confidence === 'low' && result.start_node_id && result.end_node_id && (
                <button
                  onClick={() => {
                    onSwitchMode('routebuilder')
                    const req: RouteRequest = {
                      start_node_id:          result.start_node_id!,
                      end_node_id:            result.end_node_id!,
                      must_include_nodes:     result.must_include_nodes,
                      must_avoid_nodes:       result.must_avoid_nodes,
                      must_include_segments:  result.must_include_segments,
                      must_avoid_segments:    result.must_avoid_segments,
                      must_include_systems:   result.must_include_systems,
                      must_avoid_systems:     result.must_avoid_systems,
                      diversity:              result.diversity,
                    }
                    onPrefill?.({...req})
                    onSearch(req)
                    if (result.sort_mode && onApplySort) onApplySort(result.sort_mode)
                  }}
                  style={{
                    marginTop: 8, width: '100%', padding: '5px', borderRadius: 6,
                    border: `1px solid ${borderColor}`, background: 'none',
                    color: t.textMuted, fontSize: 11, cursor: 'pointer', fontWeight: 600,
                  }}
                >
                  Search anyway →
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
