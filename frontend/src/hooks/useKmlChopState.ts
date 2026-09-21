/**
 * useKmlChopState — all the state and logic behind the Chop Import tool
 * (see components/KmlChopImport.tsx for the panels that render it), split
 * into its own light file for one reason: it has to be called UNCONDITIONALLY
 * from App.tsx's own body (React's rules of hooks — the panels that consume
 * it are mounted in two different places, the left and middle side columns,
 * so the state that ties them together has to live one level up, in the
 * common ancestor). That means this file's imports end up in the MAIN
 * bundle regardless of whether the KML tool is ever opened, unlike
 * KmlChopImport.tsx's actual UI (NewSegmentForm, the stretch table, ...),
 * which stays lazy-loaded. Keeping this file to state + api calls, with no
 * heavy component imports, is what keeps that cost small.
 *
 * PLOT FIRST, DECLARE LATER. Flattening needs only a source (an upload or a
 * sync) — no system, no segments — because a reviewer usually cannot say
 * what an import covers until they have seen its shape (confirmed with the
 * user after the first version required picking a system up front). System/
 * segment declaration is therefore a REFINEMENT available at any time after
 * flattening, not a gate before it: choosing or changing it calls
 * POST /api/kml/suggest-cuts (re-deriving the same chains from the already-
 * stored file bytes, never re-fetching) and MERGES the result in —
 * ADDING cut boundaries and filling in assignments only where a stretch has
 * none yet, never overwriting a cut or assignment the reviewer already made
 * by hand. See applySuggestions() below.
 *
 * NO STAGED-CHANGES MODEL. Unlike Network Editor's PendingChange/Save-All,
 * one chop session is scoped to a single import action (confirmed with the
 * user): a new segment created mid-session is written immediately via
 * api.createSegment/createCapacity, and Commit at the end attaches whatever
 * is currently assigned.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  CableNode, CableSegment, CableSystem, KmlChain, KmlChopCommitResponse,
  KmlFlattenResponse, ScmCable, SegmentCapacity,
} from '../types'
import { api } from '../api/client'
import { haversineKm } from '../utils/editorGeo'
// Type-only: erased at compile time, so importing KmlChopMapLayer's prop
// shape here never pulls react-leaflet into this hook's (unconditionally
// loaded) module.
import type { KmlChopMapLayerProps } from '../components/KmlChopMapLayer'

export const NEW_SEGMENT = '__new__'

/** Segment ids currently claiming each stretch. Almost always 0 or 1 entry —
 *  but occasionally 2: a real branch point is usually modelled with a
 *  branching-unit node, so the trunk stretch and each arm are genuinely
 *  separate segments with their own distinct geometry. Sometimes, though,
 *  a branch is NOT reconfigurable and isn't modelled with a BU at all —
 *  instead two whole segments are each defined end-to-end through the
 *  shared trunk, so the same on-file stretch legitimately becomes the
 *  geometry for both. commit() below just emits one cut per (stretch,
 *  segment) pair, so this needs no backend change: /commit-chop already
 *  treats every cut independently. */
export type Assignments = Record<string, string[]>
export type CutsByChain = Record<number, number[]>

export function stretchKey(chainIndex: number, start: number): string {
  return `${chainIndex}:${start}`
}

/** [0, ...interior cuts, last] boundary indices, as {start, end} pairs. */
export function stretchesFor(chain: KmlChain, cuts: number[]): { start: number; end: number }[] {
  const bounds = [0, ...cuts, chain.point_count - 1]
  const out: { start: number; end: number }[] = []
  for (let i = 0; i < bounds.length - 1; i++) out.push({ start: bounds[i], end: bounds[i + 1] })
  return out
}

/** Real on-file length of one stretch, summing haversine along its own
 *  points — what NewSegmentForm's suggestedLengthKm gets, so a segment
 *  created from a chopped stretch starts with the actual measured distance
 *  rather than a straight line between its two ends. */
export function stretchLengthKm(chain: KmlChain, start: number, end: number): number {
  let total = 0
  for (let i = start; i < end; i++) {
    total += haversineKm(chain.coords[i] as [number, number], chain.coords[i + 1] as [number, number])
  }
  return total
}

/** Nearest existing (or session-created) node to a raw stretch endpoint —
 *  the starting point for "create a new segment here", always overridable. */
export function nearestNode(lat: number, lng: number, nodes: CableNode[]): { node: CableNode; distKm: number } | null {
  let best: CableNode | null = null
  let bestD = Infinity
  for (const n of nodes) {
    const d = haversineKm([lat, lng], [n.lat, n.lng])
    if (d < bestD) { bestD = d; best = n }
  }
  return best ? { node: best, distKm: bestD } : null
}

/** First occurrence of each id wins — used to merge the system's own
 *  segments with any created earlier in this session without offering the
 *  same id twice in a dropdown. */
export function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const item of items) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    out.push(item)
  }
  return out
}

/** Golden-angle hue spacing: the Nth colour is N * 137.508° around the hue
 *  wheel. A fixed palette (tried first, then a 6-colour one indexed by
 *  position within a chain) always runs out — once an import has more
 *  stretches than the palette has entries, two of them share a colour by
 *  the pigeonhole principle, full stop, regardless of how they're indexed.
 *  The golden angle is the standard fix: it has no small rational
 *  approximation, so consecutive multiples never land near each other and
 *  neither does any other pair for a very long time — it is how you
 *  generate "as many distinct colours as I turn out to need" without
 *  knowing the count in advance or ever repeating one. */
const GOLDEN_ANGLE_DEG = 137.508
function colorForIndex(i: number): string {
  const hue = (i * GOLDEN_ANGLE_DEG) % 360
  return `hsl(${hue.toFixed(1)}, 85%, 65%)`
}

/** Every CURRENTLY EXISTING stretch, across every chain, gets its own
 *  never-repeated colour — assigned by walking all chains in order and
 *  handing out the next golden-angle hue to each stretch in turn, so
 *  colour is a colour-per-slot rather than a colour-per-identity: it is
 *  recomputed from scratch whenever the chain or cut set changes (a fresh
 *  flatten, or a chop added/removed anywhere), which is the only way "no
 *  two colours are ever reused" can hold for whatever is on screen right
 *  now — an identity-stable scheme (hash or hold-position) always leaves
 *  a chance of reuse once enough stretches exist, however the hues are
 *  chosen. A stretch's own colour can therefore shift when an unrelated
 *  chain gets chopped; that is the trade this makes, not an oversight. */
function buildStretchColors(chains: KmlChain[], cutsByChain: CutsByChain): Map<string, string> {
  const colors = new Map<string, string>()
  let i = 0
  for (const chain of chains) {
    for (const { start } of stretchesFor(chain, cutsByChain[chain.index] ?? [])) {
      colors.set(stretchKey(chain.index, start), colorForIndex(i))
      i++
    }
  }
  return colors
}

/** The cut boundaries and assignments a fresh flatten (or a from-scratch
 *  suggest-cuts merge) implies, from each chain's own suggested_cuts alone —
 *  pulled out of runFlatten as a pure function so its two nested loops don't
 *  count against that function's own cognitive-complexity budget. */
function initialCutsAndAssignments(chains: KmlChain[]): { cuts: CutsByChain; assigns: Assignments } {
  const cuts: CutsByChain = {}
  const assigns: Assignments = {}
  for (const chain of chains) {
    const idxs = new Set<number>()
    for (const sc of chain.suggested_cuts) {
      if (sc.start_idx > 0) idxs.add(sc.start_idx)
      if (sc.end_idx < chain.point_count - 1) idxs.add(sc.end_idx)
    }
    cuts[chain.index] = [...idxs].sort((a, b) => a - b)
    for (const sc of chain.suggested_cuts) {
      const key = stretchKey(chain.index, sc.start_idx)
      assigns[key] = assigns[key] ? [...assigns[key], sc.segment_id] : [sc.segment_id]
    }
  }
  return { cuts, assigns }
}

interface Options {
  segments: CableSegment[]
  systems: CableSystem[]
  nodes: CableNode[]
  onDataChange?: () => void
  /** The whole prop set KmlChopMapLayer needs, or null while there is
   *  nothing to draw yet. */
  onMapPropsChange: (props: KmlChopMapLayerProps | null) => void
}

export function useKmlChopState({ segments, systems, nodes, onDataChange, onMapPropsChange }: Options) {
  const [sourceMode, setSourceMode] = useState<'upload' | 'sync'>('upload')
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [scmCables, setScmCables] = useState<ScmCable[]>([])
  const [scmQuery, setScmQuery] = useState('')
  const [scmSelectedId, setScmSelectedId] = useState<string | null>(null)
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

  const systemSegments = useMemo(
    () => segments.filter(s => s.system_id === systemId).sort((a, b) => a.id.localeCompare(b.id)),
    [segments, systemId],
  )
  const allSegments = useMemo(() => [...segments, ...sessionSegments], [segments, sessionSegments])

  const canFlatten = sourceMode === 'upload' ? pendingFiles.length > 0 : scmSelectedId !== null

  async function runFlatten() {
    setBusy(true); setError(null); setResult(null)
    try {
      const source = sourceMode === 'upload' ? { files: pendingFiles } : { cableId: scmSelectedId! }
      // Passed through even when unset (both are optional on the backend
      // now) — covers the case where the reviewer happened to pick a system
      // before flattening; suggest_cuts() runs the same either way.
      const res = await api.flattenKmlImport(source, systemId || undefined, [...declaredIds])
      setFlat(res)
      const { cuts, assigns } = initialCutsAndAssignments(res.chains)
      setCutsByChain(cuts)
      setAssignments(assigns)
      setFitKey(k => k + 1)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  /** Re-suggest cuts once the reviewer has picked (or changed) the system/
   *  segments an already-flattened import covers. ADDS cut boundaries and
   *  fills in assignments only where a stretch has none yet — never
   *  overwrites a cut or assignment already made by hand, so declaring the
   *  system late (or changing your mind about it) can only ever help. */
  async function applySuggestions(sysId: string, ids: Set<string>) {
    if (!flat || !sysId || ids.size === 0) return
    try {
      const res = await api.suggestKmlCuts(flat.file_ids, sysId, [...ids])
      const pointCounts = new Map(flat.chains.map(c => [c.index, c.point_count]))
      setCutsByChain(prev => {
        const next = { ...prev }
        for (const c of res.chains) {
          const total = pointCounts.get(c.index)
          if (total == null) continue
          const idxs = new Set(next[c.index] ?? [])
          for (const sc of c.suggested_cuts) {
            if (sc.start_idx > 0) idxs.add(sc.start_idx)
            if (sc.end_idx < total - 1) idxs.add(sc.end_idx)
          }
          next[c.index] = [...idxs].sort((a, b) => a - b)
        }
        return next
      })
      setAssignments(prev => {
        const next = { ...prev }
        for (const c of res.chains) {
          for (const sc of c.suggested_cuts) {
            const key = stretchKey(c.index, sc.start_idx)
            // Only fill a stretch that has NO assignment yet — never touch
            // one the reviewer already set by hand, single or multi.
            if (!next[key] || next[key].length === 0) next[key] = [sc.segment_id]
          }
        }
        return next
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  // Default the declared set to every segment of the chosen system — the
  // common case is a whole-system sync/upload covering all of it.
  function chooseSystem(id: string) {
    setSystemId(id)
    const next = new Set(segments.filter(s => s.system_id === id).map(s => s.id))
    setDeclaredIds(next)
    void applySuggestions(id, next)
  }
  function toggleDeclared(id: string) {
    const next = new Set(declaredIds)
    if (next.has(id)) next.delete(id); else next.add(id)
    setDeclaredIds(next)
    void applySuggestions(systemId, next)
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
      if (val && val.length > 0) next[stretchKey(chainIndex, newIdx)] = val
      return next
    })
  }
  function addAssignment(chainIndex: number, start: number, segmentId: string) {
    const key = stretchKey(chainIndex, start)
    setAssignments(prev => {
      const cur = prev[key] ?? []
      if (cur.includes(segmentId)) return prev
      return { ...prev, [key]: [...cur, segmentId] }
    })
  }
  function removeAssignment(chainIndex: number, start: number, segmentId: string) {
    const key = stretchKey(chainIndex, start)
    setAssignments(prev => ({ ...prev, [key]: (prev[key] ?? []).filter(id => id !== segmentId) }))
  }

  // Segment ids claimed by more than one STRETCH (not more than one slot
  // within the same stretch — that's the Y-branch case, task #27, and gets
  // no flag at all). This is the mirror: one segment built from several
  // stretches, because a real gap or an unmodelled branch left it with no
  // single continuous chain either. NOT an error — commit() below sends one
  // cut per (stretch, segment) pair and the backend joins them nose-to-tail
  // into one geometry — but worth a heads-up before committing, since it is
  // less common than a straight one-stretch-one-segment assignment.
  const multiStretch = useMemo(() => {
    const counts = new Map<string, number>()
    for (const ids of Object.values(assignments)) for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1)
    return new Set([...counts.entries()].filter(([, n]) => n > 1).map(([id]) => id))
  }, [assignments])

  const stretchColors = useMemo(
    () => (flat ? buildStretchColors(flat.chains, cutsByChain) : new Map<string, string>()),
    [flat, cutsByChain],
  )
  const colorForStretch = useCallback(
    (chainIndex: number, start: number) => stretchColors.get(stretchKey(chainIndex, start)) ?? '#888888',
    [stretchColors],
  )

  useEffect(() => {
    onMapPropsChange(flat ? {
      chains: flat.chains, cutsByChain, colorForStretch,
      onAddCut: addCut, onMoveCut: moveCut, onRemoveCut: removeCut, fitKey,
    } : null)
    return () => onMapPropsChange(null)
    // Only re-derive when the data driving the map actually changes — the
    // callbacks are fresh every render and would otherwise force this effect
    // (and the parent's re-render it triggers) every time. colorForStretch
    // is stable across renders where stretchColors itself hasn't changed
    // (same dependency, so it moves in lockstep), so it's safe to leave out.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flat, cutsByChain, fitKey])

  async function createSegmentFor(chainIndex: number, start: number, segment: CableSegment, capacity: SegmentCapacity) {
    setBusy(true); setError(null)
    try {
      await api.createSegment(segment)
      await api.createCapacity(capacity)
      setSessionSegments(prev => [...prev, segment])
      addAssignment(chainIndex, start, segment.id)
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
          const segIds = assignments[stretchKey(chain.index, s.start)] ?? []
          // A stretch with more than one id here is the deliberate
          // unmodelled-branch case — one cut per (stretch, segment) pair,
          // each attaching the identical coordinate range independently.
          for (const segId of segIds) {
            if (segId && segId !== NEW_SEGMENT) cuts.push({ chain_index: chain.index, start_idx: s.start, end_idx: s.end, segment_id: segId })
          }
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

  function startOver() {
    setFlat(null); setCutsByChain({}); setAssignments({}); setResult(null)
    setSystemId(''); setDeclaredIds(new Set())
  }

  const assignedCount = Object.values(assignments)
    .reduce((n, ids) => n + ids.filter(id => id && id !== NEW_SEGMENT).length, 0)

  return {
    nodes, systems, segments, allSegments, sessionSegments,
    sourceMode, setSourceMode, pendingFiles, setPendingFiles,
    scmCables, scmQuery, setScmQuery, scmSelectedId, setScmSelectedId,
    systemId, chooseSystem, declaredIds, toggleDeclared, systemSegments,
    busy, error, canFlatten, runFlatten: () => void runFlatten(),
    flat, cutsByChain, assignments, creatingKey, setCreatingKey, colorForStretch,
    addAssignment, removeAssignment, removeCut,
    createSegmentFor: (chainIndex: number, start: number, seg: CableSegment, cap: SegmentCapacity) =>
      void createSegmentFor(chainIndex, start, seg, cap),
    multiStretch, assignedCount, commit: () => void commit(), result, startOver,
  }
}

export type KmlChopState = ReturnType<typeof useKmlChopState>
