/**
 * KmlChopImport — replaces the scored review table (KmlBulkImport) entirely.
 *
 * WHY. Measured against a real branching cable (AJC, Australia-Japan Cable,
 * Y-shaped at Guam), the automatic pipeline — join by placemark, split only
 * where an existing segment graph proves a cut point — could not represent
 * it: the joined trunk never came within 30km of the Guam node, so no split
 * was ever found, and the whole thing landed as one 30%-confidence guess
 * against the wrong segment. The reviewer usually already knows the right
 * answer even when the geometry math cannot resolve it alone, so this tool
 * hands that judgement back: pick the system and which of its segments this
 * import covers, POST /api/kml/flatten re-chops the import into chains (see
 * backend/app/kml/flatten.py — the file's own fragment boundaries are not
 * trusted) and suggests cuts wherever the math CAN resolve it, then the map
 * (KmlChopMapLayer, mounted separately inside Map.tsx) is where the reviewer
 * clicks to place, move or remove cuts and this panel is where each
 * resulting stretch gets assigned — a declared segment, a brand-new one
 * created inline, or left unassigned.
 *
 * NO STAGED-CHANGES MODEL. Unlike Network Editor's PendingChange/Save-All,
 * one chop session is scoped to a single import action (confirmed with the
 * user): a new segment created mid-session is written immediately via
 * api.createSegment/createCapacity, and Commit at the end attaches whatever
 * is currently assigned. Closing the panel before committing simply drops
 * the in-progress chop — nothing was staged to lose beyond the session
 * itself.
 *
 * OWNS ITS DATA, DOESN'T OWN THE MAP. This component's own JSX is the side
 * panel only — the interactive map surface lives in KmlChopMapLayer, mounted
 * by App.tsx/Map.tsx the same conditional way EditorMapLayer is. Whenever
 * this panel's chains/cuts/assignments change, `onMapPropsChange` hands the
 * map layer's whole prop set up to the caller in one object, so the two
 * halves share one source of truth without this component needing to know
 * anything about Leaflet.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  CableNode, CableSegment, CableSystem, KmlChain, KmlChopCommitResponse,
  KmlFlattenResponse, ScmCable, SegmentCapacity,
} from '../types'
import { useTheme, type Theme } from '../theme'
import { api } from '../api/client'
import { PREVIEW_COLORS } from './KmlPreviewLayer'
import { haversineKm } from '../utils/editorGeo'
import { NewSegmentForm } from './NewSegmentForm'
// Type-only: erased at compile time, so importing KmlChopMapLayer's prop
// shape here never pulls react-leaflet into this component's bundle.
import type { KmlChopMapLayerProps } from './KmlChopMapLayer'

interface Props {
  segments: CableSegment[]
  systems: CableSystem[]
  nodes: CableNode[]
  onClose: () => void
  onDataChange?: () => void
  /** The whole prop set KmlChopMapLayer needs, or null while there is
   *  nothing to draw yet (before Flatten & Review, or after closing). */
  onMapPropsChange: (props: KmlChopMapLayerProps | null) => void
}

/** Unassigned/no colour yet. */
const UNASSIGNED_COLOR = '#6b7280'
const NEW_SEGMENT = '__new__'

type Assignments = Record<string, string>
type CutsByChain = Record<number, number[]>

function stretchKey(chainIndex: number, start: number): string {
  return `${chainIndex}:${start}`
}

/** First occurrence of each id wins — used to merge the system's own
 *  segments with any created earlier in this session without offering the
 *  same id twice in a dropdown. */
function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const item of items) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    out.push(item)
  }
  return out
}

/** [0, ...interior cuts, last] boundary indices, as {start, end} pairs. */
function stretchesFor(chain: KmlChain, cuts: number[]): { start: number; end: number }[] {
  const bounds = [0, ...cuts, chain.point_count - 1]
  const out: { start: number; end: number }[] = []
  for (let i = 0; i < bounds.length - 1; i++) out.push({ start: bounds[i], end: bounds[i + 1] })
  return out
}

/** Real on-file length of one stretch, summing haversine along its own
 *  points — what NewSegmentForm's suggestedLengthKm gets, so a segment
 *  created from a chopped stretch starts with the actual measured distance
 *  rather than a straight line between its two ends. */
function stretchLengthKm(chain: KmlChain, start: number, end: number): number {
  let total = 0
  for (let i = start; i < end; i++) {
    total += haversineKm(chain.coords[i] as [number, number], chain.coords[i + 1] as [number, number])
  }
  return total
}

/** Nearest existing (or session-created) node to a raw stretch endpoint —
 *  the starting point for "create a new segment here", always overridable. */
function nearestNode(lat: number, lng: number, nodes: CableNode[]): { node: CableNode; distKm: number } | null {
  let best: CableNode | null = null
  let bestD = Infinity
  for (const n of nodes) {
    const d = haversineKm([lat, lng], [n.lat, n.lng])
    if (d < bestD) { bestD = d; best = n }
  }
  return best ? { node: best, distKm: bestD } : null
}

const cell: React.CSSProperties = { padding: '6px 8px', fontSize: 11, verticalAlign: 'top' }

/** Source + system + declared-segments step, before anything is fetched. */
function SetupPanel({
  sourceMode, setSourceMode, fileRef, onPickFiles, pendingFileCount,
  scmQuery, setScmQuery, scmCables, scmMatch,
  systemId, setSystemId, systems,
  declaredIds, toggleDeclared, systemSegments,
  busy, onFlatten, canFlatten, t,
}: {
  sourceMode: 'upload' | 'sync'; setSourceMode: (m: 'upload' | 'sync') => void
  fileRef: React.RefObject<HTMLInputElement>; onPickFiles: (files: File[]) => void; pendingFileCount: number
  scmQuery: string; setScmQuery: (q: string) => void; scmCables: ScmCable[]; scmMatch: ScmCable | undefined
  systemId: string; setSystemId: (id: string) => void; systems: CableSystem[]
  declaredIds: Set<string>; toggleDeclared: (id: string) => void; systemSegments: CableSegment[]
  busy: boolean; onFlatten: () => void; canFlatten: boolean; t: Theme
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 14 }}>
      <div style={{ display: 'flex', gap: 6 }}>
        {(['upload', 'sync'] as const).map(m => (
          <button
            key={m}
            onClick={() => setSourceMode(m)}
            disabled={busy}
            style={{
              padding: '5px 11px', borderRadius: 5, fontSize: 11, fontWeight: 700, fontFamily: 'inherit',
              border: `1px solid ${sourceMode === m ? t.blue : t.border}`,
              background: sourceMode === m ? t.blue + '18' : 'transparent',
              color: sourceMode === m ? t.blue : t.textMuted,
              cursor: busy ? 'default' : 'pointer',
            }}
          >{m === 'upload' ? '⬆ Upload files' : '🔄 Sync from Submarine Cable Map'}</button>
        ))}
      </div>

      {sourceMode === 'upload' ? (
        <div key="upload-source">
          <input
            ref={fileRef} type="file" multiple
            accept=".kmz,.kml,application/vnd.google-earth.kmz,application/vnd.google-earth.kml+xml"
            style={{ display: 'none' }}
            onChange={e => { onPickFiles([...(e.target.files ?? [])]); e.target.value = '' }}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            style={{
              padding: '7px 13px', borderRadius: 6, fontSize: 12, fontWeight: 700, fontFamily: 'inherit',
              border: `1px solid ${t.blue}`, background: t.blue + '18', color: t.blue,
              cursor: busy ? 'default' : 'pointer',
            }}
          >⬆ Choose KMZ / KML files</button>
          {pendingFileCount > 0 && (
            <span style={{ marginLeft: 8, fontSize: 11, color: t.textMuted }}>{pendingFileCount} file{pendingFileCount === 1 ? '' : 's'} chosen</span>
          )}
        </div>
      ) : (
        <div key="sync-source">
          <input
            list="chop-scm-cable-options"
            value={scmQuery}
            onChange={e => setScmQuery(e.target.value)}
            placeholder={scmCables.length === 0 ? 'Loading cable list…' : 'Search submarine cable name…'}
            disabled={busy || scmCables.length === 0}
            style={{
              padding: '6px 8px', fontSize: 11, fontFamily: 'inherit', minWidth: 260,
              background: t.bgDeep, color: t.text, border: `1px solid ${t.border}`, borderRadius: 5,
            }}
          />
          <datalist id="chop-scm-cable-options">
            {scmCables.map(c => <option key={c.id} value={c.name} />)}
          </datalist>
          {scmQuery && !scmMatch && (
            <div style={{ fontSize: 10, color: t.textFaint, marginTop: 4 }}>Pick an exact name from the list.</div>
          )}
        </div>
      )}

      <div>
        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: t.textMuted, marginBottom: 4 }}>
          System
        </div>
        <select
          value={systemId}
          onChange={e => setSystemId(e.target.value)}
          disabled={busy}
          style={{
            width: '100%', padding: '6px 8px', fontSize: 12, fontFamily: 'inherit',
            background: t.bgDeep, color: t.text, border: `1px solid ${t.border}`, borderRadius: 5,
          }}
        >
          <option value="">— choose the system this import belongs to —</option>
          {[...systems].sort((a, b) => a.id.localeCompare(b.id)).map(s => (
            <option key={s.id} value={s.id}>{s.id} — {s.name}</option>
          ))}
        </select>
      </div>

      {systemId && (
        <div>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: t.textMuted, marginBottom: 4 }}>
            Segments this import covers
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 160, overflowY: 'auto', border: `1px solid ${t.border}`, borderRadius: 5, padding: 6 }}>
            {systemSegments.length === 0 && (
              <span style={{ fontSize: 11, color: t.textFaint }}>{systemId} has no segments yet.</span>
            )}
            {systemSegments.map(seg => (
              <label key={seg.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: t.text, cursor: 'pointer' }}>
                <input type="checkbox" checked={declaredIds.has(seg.id)} onChange={() => toggleDeclared(seg.id)} />
                {seg.id} <span style={{ color: t.textFaint }}>— {seg.name}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      <button
        onClick={onFlatten}
        disabled={busy || !canFlatten}
        style={{
          padding: '9px 14px', borderRadius: 6, fontSize: 12, fontWeight: 700, fontFamily: 'inherit',
          border: `1px solid ${canFlatten ? t.green : t.border}`,
          background: canFlatten ? t.green + '20' : 'transparent',
          color: canFlatten ? t.green : t.textFaint,
          cursor: busy || !canFlatten ? 'default' : 'pointer',
        }}
      >{busy ? 'Fetching…' : '🔀 Flatten & review'}</button>
    </div>
  )
}

/** The inline "no segment covers this stretch" flow: snap both ends to the
 *  nearest existing node (overridable), then host NewSegmentForm once both
 *  resolve to a real node. */
function NewSegmentInline({
  chain, start, end, nodes, segments, systems, onCreated, onCancel, busy, t,
}: {
  chain: KmlChain; start: number; end: number
  nodes: CableNode[]; segments: CableSegment[]; systems: CableSystem[]
  onCreated: (segment: CableSegment, capacity: SegmentCapacity) => void
  onCancel: () => void
  busy: boolean; t: Theme
}) {
  const aRaw = chain.coords[start]
  const zRaw = chain.coords[end]
  const aGuess = useMemo(() => nearestNode(aRaw[0], aRaw[1], nodes), [aRaw, nodes])
  const zGuess = useMemo(() => nearestNode(zRaw[0], zRaw[1], nodes), [zRaw, nodes])
  const [aQuery, setAQuery] = useState(aGuess ? `${aGuess.node.id} — ${aGuess.node.name}` : '')
  const [zQuery, setZQuery] = useState(zGuess ? `${zGuess.node.id} — ${zGuess.node.name}` : '')

  const aNode = nodes.find(n => `${n.id} — ${n.name}` === aQuery)
  const zNode = nodes.find(n => `${n.id} — ${n.name}` === zQuery)

  return (
    <div style={{ padding: 10, borderRadius: 6, border: `1px solid ${t.orange}55`, background: t.orange + '0d', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 11, color: t.textMuted }}>
        No existing segment covers this stretch. Confirm which node each end belongs to — the
        nearest one is pre-filled, with its distance from the actual on-file endpoint.
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 10, color: t.textFaint, marginBottom: 2 }}>
            Start {aGuess && <span>({aGuess.distKm.toFixed(0)} km from nearest)</span>}
          </div>
          <input
            list="chop-node-options" value={aQuery} onChange={e => setAQuery(e.target.value)}
            style={{ width: '100%', padding: '5px 7px', fontSize: 11, fontFamily: 'inherit', background: t.bgDeep, color: t.text, border: `1px solid ${aNode ? t.border : t.red}`, borderRadius: 4 }}
          />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 10, color: t.textFaint, marginBottom: 2 }}>
            End {zGuess && <span>({zGuess.distKm.toFixed(0)} km from nearest)</span>}
          </div>
          <input
            list="chop-node-options" value={zQuery} onChange={e => setZQuery(e.target.value)}
            style={{ width: '100%', padding: '5px 7px', fontSize: 11, fontFamily: 'inherit', background: t.bgDeep, color: t.text, border: `1px solid ${zNode ? t.border : t.red}`, borderRadius: 4 }}
          />
        </div>
      </div>
      <datalist id="chop-node-options">
        {nodes.map(n => <option key={n.id} value={`${n.id} — ${n.name}`} />)}
      </datalist>

      {aNode && zNode ? (
        <NewSegmentForm
          startNode={aNode} endNode={zNode} systems={systems} segments={segments}
          suggestedLengthKm={stretchLengthKm(chain, start, end)}
          onCancel={onCancel}
          onCreate={onCreated}
        />
      ) : (
        <button
          onClick={onCancel} disabled={busy}
          style={{ padding: '6px 11px', borderRadius: 5, fontSize: 11, fontFamily: 'inherit', border: `1px solid ${t.border}`, background: 'transparent', color: t.textMuted, cursor: 'pointer', alignSelf: 'flex-start' }}
        >Cancel</button>
      )}
    </div>
  )
}

/** One stretch's row: which chain, how big, and its assignment dropdown —
 *  or, when the user picked "new segment", the inline creation flow instead. */
function StretchRow({
  chain, start, end, value, options, conflict, creating,
  onAssign, onStartNew, onRemoveCut, nodes, segments, systems, onCreated, onCancelNew, busy, t,
}: {
  chain: KmlChain; start: number; end: number
  value: string; options: { id: string; label: string }[]; conflict: boolean; creating: boolean
  onAssign: (v: string) => void
  onStartNew: () => void
  onRemoveCut: (() => void) | null
  nodes: CableNode[]; segments: CableSegment[]; systems: CableSystem[]
  onCreated: (segment: CableSegment, capacity: SegmentCapacity) => void
  onCancelNew: () => void
  busy: boolean; t: Theme
}) {
  const pts = end - start + 1
  const km = stretchLengthKm(chain, start, end).toFixed(0)
  return (
    <tr style={{ borderBottom: `1px solid ${t.border}` }}>
      <td style={cell}>{chain.index}</td>
      <td style={cell}>
        <div style={{ color: t.text }}>{pts.toLocaleString()} pts · {km} km</div>
        <div style={{ color: t.textFaint, fontSize: 10 }}>
          {chain.coords[start][0].toFixed(2)}, {chain.coords[start][1].toFixed(2)} → {chain.coords[end][0].toFixed(2)}, {chain.coords[end][1].toFixed(2)}
        </div>
      </td>
      <td style={cell}>
        {creating ? (
          <NewSegmentInline
            chain={chain} start={start} end={end} nodes={nodes} segments={segments} systems={systems}
            onCreated={onCreated} onCancel={onCancelNew} busy={busy} t={t}
          />
        ) : (
          <select
            value={value}
            onChange={e => (e.target.value === NEW_SEGMENT ? onStartNew() : onAssign(e.target.value))}
            style={{
              width: '100%', padding: '4px 6px', fontSize: 11, fontFamily: 'inherit',
              background: t.bgDeep, color: t.text,
              border: `1px solid ${conflict ? t.orange : t.border}`, borderRadius: 4,
            }}
          >
            <option value="">— unassigned —</option>
            {options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
            <option value={NEW_SEGMENT}>＋ New segment…</option>
          </select>
        )}
        {conflict && !creating && (
          <div style={{ fontSize: 10, color: t.orange, marginTop: 2 }}>another stretch also claims this segment</div>
        )}
      </td>
      <td style={cell}>
        {onRemoveCut && (
          <button
            onClick={onRemoveCut}
            title="Remove the cut before this stretch, merging it into the previous one"
            style={{ padding: '3px 7px', borderRadius: 4, fontSize: 10, fontFamily: 'inherit', border: `1px solid ${t.border}`, background: 'transparent', color: t.textMuted, cursor: 'pointer' }}
          >⌫ merge up</button>
        )}
      </td>
    </tr>
  )
}

export function KmlChopImport({ segments, systems, nodes, onClose, onDataChange, onMapPropsChange }: Props) {
  const t = useTheme()
  const fileRef = useRef<HTMLInputElement>(null)

  const [sourceMode, setSourceMode] = useState<'upload' | 'sync'>('upload')
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [scmCables, setScmCables] = useState<ScmCable[]>([])
  const [scmQuery, setScmQuery] = useState('')
  const scmFetchStarted = useRef(false)

  const [systemId, setSystemId] = useState('')
  const [declaredIds, setDeclaredIds] = useState<Set<string>>(new Set())

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [flat, setFlat] = useState<KmlFlattenResponse | null>(null)
  const [cutsByChain, setCutsByChain] = useState<CutsByChain>({})
  const [assignments, setAssignments] = useState<Assignments>({})
  const [sessionSegments, setSessionSegments] = useState<CableSegment[]>([])
  const [creatingKey, setCreatingKey] = useState<string | null>(null)
  const [fitKey, setFitKey] = useState(0)
  const [result, setResult] = useState<KmlChopCommitResponse | null>(null)

  useEffect(() => {
    if (sourceMode !== 'sync' || scmFetchStarted.current) return
    scmFetchStarted.current = true
    api.searchScmCables('')
      .then(res => setScmCables(res.cables))
      .catch((e: unknown) => { scmFetchStarted.current = false; setError(e instanceof Error ? e.message : String(e)) })
  }, [sourceMode])

  const scmMatch = useMemo(
    () => scmCables.find(c => c.name.toLowerCase() === scmQuery.trim().toLowerCase()),
    [scmCables, scmQuery],
  )
  const systemSegments = useMemo(
    () => segments.filter(s => s.system_id === systemId).sort((a, b) => a.id.localeCompare(b.id)),
    [segments, systemId],
  )
  const allSegments = useMemo(() => [...segments, ...sessionSegments], [segments, sessionSegments])

  function toggleDeclared(id: string) {
    setDeclaredIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  // Default the declared set to every segment of the chosen system — the
  // common case is a whole-system sync/upload covering all of it.
  function chooseSystem(id: string) {
    setSystemId(id)
    setDeclaredIds(new Set(segments.filter(s => s.system_id === id).map(s => s.id)))
  }

  const canFlatten = systemId !== '' && declaredIds.size > 0
    && (sourceMode === 'upload' ? pendingFiles.length > 0 : scmMatch !== undefined)

  async function runFlatten() {
    setBusy(true); setError(null); setResult(null)
    try {
      const source = sourceMode === 'upload' ? { files: pendingFiles } : { cableId: scmMatch!.id }
      const res = await api.flattenKmlImport(source, systemId, [...declaredIds])
      setFlat(res)
      const cuts: CutsByChain = {}
      const assigns: Assignments = {}
      for (const chain of res.chains) {
        const idxs = new Set<number>()
        for (const sc of chain.suggested_cuts) {
          if (sc.start_idx > 0) idxs.add(sc.start_idx)
          if (sc.end_idx < chain.point_count - 1) idxs.add(sc.end_idx)
        }
        cuts[chain.index] = [...idxs].sort((a, b) => a - b)
        for (const sc of chain.suggested_cuts) assigns[stretchKey(chain.index, sc.start_idx)] = sc.segment_id
      }
      setCutsByChain(cuts)
      setAssignments(assigns)
      setFitKey(k => k + 1)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  function addCut(chainIndex: number, vertex: number) {
    setCutsByChain(prev => ({ ...prev, [chainIndex]: [...new Set([...(prev[chainIndex] ?? []), vertex])].sort((a, b) => a - b) }))
  }
  function removeCut(chainIndex: number, idx: number) {
    setCutsByChain(prev => ({ ...prev, [chainIndex]: (prev[chainIndex] ?? []).filter(i => i !== idx) }))
    setAssignments(prev => {
      const next = { ...prev }
      delete next[stretchKey(chainIndex, idx)]
      return next
    })
  }
  function moveCut(chainIndex: number, oldIdx: number, newIdx: number) {
    setCutsByChain(prev => ({
      ...prev,
      [chainIndex]: [...new Set((prev[chainIndex] ?? []).filter(i => i !== oldIdx).concat(newIdx))].sort((a, b) => a - b),
    }))
    setAssignments(prev => {
      const val = prev[stretchKey(chainIndex, oldIdx)]
      const next = { ...prev }
      delete next[stretchKey(chainIndex, oldIdx)]
      if (val) next[stretchKey(chainIndex, newIdx)] = val
      return next
    })
  }
  function assign(chainIndex: number, start: number, value: string) {
    setAssignments(prev => ({ ...prev, [stretchKey(chainIndex, start)]: value }))
  }

  const assignedIds = useMemo(() => [...new Set(Object.values(assignments).filter(Boolean))], [assignments])
  const palette = useMemo(() => {
    const map: Record<string, string> = {}
    assignedIds.forEach((id, i) => { map[id] = PREVIEW_COLORS[i % PREVIEW_COLORS.length] })
    return map
  }, [assignedIds])
  function colorForStretch(chainIndex: number, start: number): string {
    const segId = assignments[stretchKey(chainIndex, start)]
    return segId ? (palette[segId] ?? t.blue) : UNASSIGNED_COLOR
  }
  const conflicted = useMemo(() => {
    const counts = new Map<string, number>()
    for (const v of Object.values(assignments)) if (v) counts.set(v, (counts.get(v) ?? 0) + 1)
    return new Set([...counts.entries()].filter(([, n]) => n > 1).map(([id]) => id))
  }, [assignments])

  useEffect(() => {
    onMapPropsChange(flat ? {
      chains: flat.chains, cutsByChain, colorForStretch,
      onAddCut: addCut, onMoveCut: moveCut, onRemoveCut: removeCut, fitKey,
    } : null)
    return () => onMapPropsChange(null)
    // Only re-derive when the data driving the map actually changes — the
    // callbacks/colour function are fresh every render and would otherwise
    // force this effect (and the parent's re-render it triggers) every time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flat, cutsByChain, assignments, fitKey])

  async function createSegmentFor(chainIndex: number, start: number, segment: CableSegment, capacity: SegmentCapacity) {
    setBusy(true); setError(null)
    try {
      await api.createSegment(segment)
      await api.createCapacity(capacity)
      setSessionSegments(prev => [...prev, segment])
      assign(chainIndex, start, segment.id)
      setCreatingKey(null)
      onDataChange?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function commit() {
    if (!flat) return
    setBusy(true); setError(null)
    try {
      const cuts: { chain_index: number; start_idx: number; end_idx: number; segment_id: string }[] = []
      for (const chain of flat.chains) {
        for (const s of stretchesFor(chain, cutsByChain[chain.index] ?? [])) {
          const segId = assignments[stretchKey(chain.index, s.start)]
          if (segId && segId !== NEW_SEGMENT) cuts.push({ chain_index: chain.index, start_idx: s.start, end_idx: s.end, segment_id: segId })
        }
      }
      setResult(await api.commitKmlChop(flat.file_ids, flat.source, cuts))
      onDataChange?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const assignedCount = Object.values(assignments).filter(v => v && v !== NEW_SEGMENT).length

  return (
    <div style={{
      position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 11500,
      maxHeight: '52vh', display: 'flex', flexDirection: 'column',
      background: t.bgPanel, borderTop: `1px solid ${t.border}`,
      boxShadow: '0 -8px 48px rgba(0,0,0,0.5)', fontFamily: 'system-ui, sans-serif',
    }}>
      <div style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        padding: '10px 16px', background: t.bgDeep, borderBottom: `1px solid ${t.border}`,
      }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: t.text }}>Chop Import</div>
          <div style={{ fontSize: 11, color: t.textMuted, marginTop: 2 }}>
            {flat
              ? 'Click the map above to place cuts. Assign each stretch below, then Commit.'
              : 'Pick a system and the segments this import covers, then flatten it into re-chopped chains.'}
          </div>
        </div>
        <button onClick={onClose} title="Close"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: t.textFaint, fontSize: 20, lineHeight: 1 }}
        >×</button>
      </div>

      {error && (
        <div style={{ padding: '8px 16px', fontSize: 11, color: t.red, borderBottom: `1px solid ${t.border}` }}>{error}</div>
      )}
      {flat && flat.rejected.length > 0 && (
        <div style={{ padding: '8px 16px', fontSize: 11, color: t.orange, borderBottom: `1px solid ${t.border}` }}>
          {flat.rejected.map(r => <div key={r.filename}>{r.filename}: {r.reason}</div>)}
        </div>
      )}

      <div style={{ overflowY: 'auto', flex: 1 }}>
        {!flat ? (
          <SetupPanel
            sourceMode={sourceMode} setSourceMode={setSourceMode}
            fileRef={fileRef} onPickFiles={setPendingFiles} pendingFileCount={pendingFiles.length}
            scmQuery={scmQuery} setScmQuery={setScmQuery} scmCables={scmCables} scmMatch={scmMatch}
            systemId={systemId} setSystemId={chooseSystem} systems={systems}
            declaredIds={declaredIds} toggleDeclared={toggleDeclared} systemSegments={systemSegments}
            busy={busy} onFlatten={() => void runFlatten()} canFlatten={canFlatten} t={t}
          />
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ ...cell, fontSize: 9, fontWeight: 700, textTransform: 'uppercase', color: t.textMuted, textAlign: 'left', width: 40 }}>Chain</th>
                <th style={{ ...cell, fontSize: 9, fontWeight: 700, textTransform: 'uppercase', color: t.textMuted, textAlign: 'left' }}>Stretch</th>
                <th style={{ ...cell, fontSize: 9, fontWeight: 700, textTransform: 'uppercase', color: t.textMuted, textAlign: 'left' }}>Assign to</th>
                <th style={{ ...cell, width: 90 }} />
              </tr>
            </thead>
            <tbody>
              {flat.chains.flatMap(chain =>
                stretchesFor(chain, cutsByChain[chain.index] ?? []).map((s, i) => {
                  const key = stretchKey(chain.index, s.start)
                  const value = assignments[key] ?? ''
                  const options = dedupeById([...systemSegments, ...sessionSegments.filter(x => x.system_id === systemId)])
                    .map(x => ({ id: x.id, label: `${x.id} — ${x.name}` }))
                  return (
                    <StretchRow
                      key={key}
                      chain={chain} start={s.start} end={s.end}
                      value={value} options={options}
                      conflict={value !== '' && conflicted.has(value)}
                      creating={creatingKey === key}
                      onAssign={v => assign(chain.index, s.start, v)}
                      onStartNew={() => setCreatingKey(key)}
                      onRemoveCut={i > 0 ? () => removeCut(chain.index, s.start) : null}
                      nodes={nodes} segments={allSegments} systems={systems}
                      onCreated={(seg, cap) => void createSegmentFor(chain.index, s.start, seg, cap)}
                      onCancelNew={() => setCreatingKey(null)}
                      busy={busy} t={t}
                    />
                  )
                }),
              )}
            </tbody>
          </table>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderTop: `1px solid ${t.border}` }}>
        {flat && (
          <>
            <button
              onClick={() => { setFlat(null); setCutsByChain({}); setAssignments({}); setResult(null) }}
              disabled={busy}
              style={{ padding: '6px 11px', borderRadius: 5, fontSize: 11, fontFamily: 'inherit', border: `1px solid ${t.border}`, background: 'transparent', color: t.textMuted, cursor: 'pointer' }}
            >← Start over</button>
            <div style={{ flex: 1 }} />
            {conflicted.size > 0 && (
              <span style={{ fontSize: 11, color: t.orange }}>{conflicted.size} segment{conflicted.size === 1 ? '' : 's'} claimed twice</span>
            )}
            <button
              onClick={() => void commit()}
              disabled={busy || assignedCount === 0}
              style={{
                padding: '7px 14px', borderRadius: 6, fontSize: 12, fontWeight: 700, fontFamily: 'inherit',
                border: `1px solid ${assignedCount ? t.green : t.border}`,
                background: assignedCount ? t.green + '20' : 'transparent',
                color: assignedCount ? t.green : t.textFaint,
                cursor: busy || !assignedCount ? 'default' : 'pointer',
              }}
            >Commit {assignedCount} route{assignedCount === 1 ? '' : 's'}</button>
          </>
        )}
      </div>

      {result && (
        <div style={{ padding: '8px 16px', borderTop: `1px solid ${t.border}`, fontSize: 11 }}>
          <span style={{ color: t.green, fontWeight: 700 }}>Attached {result.summary.linked} route{result.summary.linked === 1 ? '' : 's'}.</span>
          {result.failed.map((f, i) => (
            <div key={i} style={{ color: t.red }}>{f.segment_id ?? '?'}: {f.reason}</div>
          ))}
        </div>
      )}
    </div>
  )
}
