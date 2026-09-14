/**
 * ============================================================================
 * state/editorState.ts — Network Editor staged-changes state
 * ============================================================================
 *
 * Everything a Network Editor session does to nodes/segments/capacity is
 * staged locally first (a `PendingChange[]` list) and only written to the
 * backend on an explicit Save All — see NetworkEditor.tsx / EditorPendingPanel.tsx.
 * This file is the pure, framework-free core: the PendingChange shape, the
 * reducer, and applyPendingChanges (the selector that folds staged edits on
 * top of the real fetched data for rendering). No React, no API calls here —
 * saveAll() in networkEditorSave.ts is the only place that touches api.*.
 *
 * Design notes:
 *  - Every PendingChange carries a full-value SNAPSHOT (a whole [lat,lng], a
 *    whole waypoints array, a whole draft node/segment), never a delta. That's
 *    what makes "discard just this one item" and "undo pops exactly one list
 *    entry" both safe, order-independent operations — removing any single
 *    entry can never corrupt another entry's data.
 *  - Dragging a brand-new (not yet saved) node mutates that same `new-node`
 *    entry's draft lat/lng in place rather than pushing a `move-node` entry —
 *    there's no persisted "from" to diff against, and it keeps "I created and
 *    positioned this node" as one undo step, not N.
 *  - The pending list doubles as the undo stack: undo pops the most recent
 *    entry onto a redo stack; redo pushes it back. A fresh change clears redo.
 */
import type { CableNode, CableSegment, SegmentCapacity } from '../types'

// ── PendingChange ────────────────────────────────────────────────────────────

interface PendingBase {
  changeId: string
  ts: number
  /** Set after a failed Save-All attempt; cleared if the item is edited again. */
  lastError?: string
}

export type PendingChange =
  | (PendingBase & { kind: 'move-node'; nodeId: string; from: [number, number]; to: [number, number] })
  | (PendingBase & { kind: 'new-node'; tempId: string; draft: CableNode })
  | (PendingBase & { kind: 'delete-node'; nodeId: string; snapshot: CableNode; cascadeSegmentIds: string[] })
  | (PendingBase & { kind: 'edit-waypoints'; segmentId: string; from: [number, number][] | null; to: [number, number][] })
  | (PendingBase & { kind: 'new-segment'; tempId: string; draft: CableSegment; capacityDraft: SegmentCapacity })
  | (PendingBase & { kind: 'delete-segment'; segmentId: string; snapshot: CableSegment; capacitySnapshot?: SegmentCapacity; viaNodeCascade?: string })

export type EditorSubMode = 'move' | 'waypoints' | 'create' | 'delete'

export type EditorSelection = { kind: 'node' | 'segment'; id: string } | null

let changeCounter = 0
function nextChangeId(): string {
  changeCounter += 1
  return `chg-${Date.now()}-${changeCounter}`
}

// ── EditorState + reducer ────────────────────────────────────────────────────

export interface EditorState {
  pending: PendingChange[]
  redoStack: PendingChange[]
  selection: EditorSelection
  subMode: EditorSubMode
  saveInFlight: boolean
}

export const initialEditorState: EditorState = {
  pending: [],
  redoStack: [],
  selection: null,
  subMode: 'move',
  saveInFlight: false,
}

export type EditorAction =
  | { type: 'MOVE_NODE'; nodeId: string; lat: number; lng: number; fromLat: number; fromLng: number }
  | { type: 'ADD_CHANGE'; change: Omit<PendingChange, 'changeId' | 'ts'> }
  | { type: 'UNDO' }
  | { type: 'REDO' }
  | { type: 'DISCARD_ONE'; changeId: string }
  | { type: 'DISCARD_ALL' }
  | { type: 'SELECT'; selection: EditorSelection }
  | { type: 'SET_SUBMODE'; subMode: EditorSubMode }
  | { type: 'SAVE_START' }
  | { type: 'SAVE_RESULT'; succeededChangeIds: string[]; errors: { changeId: string; message: string }[] }

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'MOVE_NODE': {
      const { nodeId, lat, lng, fromLat, fromLng } = action
      // Still-unsaved new node: reposition its own draft in place, no new undo step.
      const draftIdx = state.pending.findIndex(c => c.kind === 'new-node' && c.tempId === nodeId)
      if (draftIdx !== -1) {
        const pending = [...state.pending]
        const entry = pending[draftIdx]
        if (entry.kind === 'new-node') {
          pending[draftIdx] = { ...entry, draft: { ...entry.draft, lat, lng } }
        }
        return { ...state, pending }
      }
      const change: PendingChange = {
        changeId: nextChangeId(), ts: Date.now(),
        kind: 'move-node', nodeId, from: [fromLat, fromLng], to: [lat, lng],
      }
      return { ...state, pending: [...state.pending, change], redoStack: [] }
    }
    case 'ADD_CHANGE': {
      const change = { ...action.change, changeId: nextChangeId(), ts: Date.now() } as PendingChange
      return { ...state, pending: [...state.pending, change], redoStack: [] }
    }
    case 'UNDO': {
      if (state.pending.length === 0) return state
      const popped = state.pending[state.pending.length - 1]
      return { ...state, pending: state.pending.slice(0, -1), redoStack: [...state.redoStack, popped] }
    }
    case 'REDO': {
      if (state.redoStack.length === 0) return state
      const popped = state.redoStack[state.redoStack.length - 1]
      return { ...state, redoStack: state.redoStack.slice(0, -1), pending: [...state.pending, popped] }
    }
    case 'DISCARD_ONE':
      return {
        ...state,
        pending: state.pending.filter(c => c.changeId !== action.changeId),
        redoStack: state.redoStack.filter(c => c.changeId !== action.changeId),
      }
    case 'DISCARD_ALL':
      return { ...state, pending: [], redoStack: [] }
    case 'SELECT':
      return { ...state, selection: action.selection }
    case 'SET_SUBMODE':
      return { ...state, subMode: action.subMode, selection: null }
    case 'SAVE_START':
      return { ...state, saveInFlight: true }
    case 'SAVE_RESULT': {
      const errByChangeId = Object.fromEntries(action.errors.map(e => [e.changeId, e.message]))
      const pending = state.pending
        .filter(c => !action.succeededChangeIds.includes(c.changeId))
        .map(c => (errByChangeId[c.changeId] ? { ...c, lastError: errByChangeId[c.changeId] } : c))
      return { ...state, pending, saveInFlight: false }
    }
    default:
      return state
  }
}

// ── Derived "what does the map actually show right now" ─────────────────────

/** Folds `pending` (in order, oldest→newest) onto the real fetched data, so
 *  the map always renders "base data + staged edits" from one source of
 *  truth rather than two parallel mutable arrays. Pure — safe to call every
 *  render (App.tsx should still useMemo it, since node/segment arrays are
 *  large enough that re-deriving on every keystroke elsewhere is wasteful). */
export function applyPendingChanges(
  baseNodes: CableNode[],
  baseSegments: CableSegment[],
  baseCapacity: SegmentCapacity[],
  pending: PendingChange[],
): { nodes: CableNode[]; segments: CableSegment[]; capacity: SegmentCapacity[] } {
  let nodes = baseNodes
  let segments = baseSegments
  let capacity = baseCapacity

  for (const change of pending) {
    switch (change.kind) {
      case 'move-node':
        nodes = nodes.map(n => (n.id === change.nodeId ? { ...n, lat: change.to[0], lng: change.to[1] } : n))
        break
      case 'new-node':
        nodes = nodes.some(n => n.id === change.draft.id)
          ? nodes.map(n => (n.id === change.draft.id ? change.draft : n))
          : [...nodes, change.draft]
        break
      case 'delete-node':
        nodes = nodes.filter(n => n.id !== change.nodeId)
        break
      case 'edit-waypoints':
        segments = segments.map(s => (s.id === change.segmentId ? { ...s, waypoints: change.to } : s))
        break
      case 'new-segment':
        segments = segments.some(s => s.id === change.draft.id)
          ? segments.map(s => (s.id === change.draft.id ? change.draft : s))
          : [...segments, change.draft]
        capacity = capacity.some(c => c.segment_id === change.capacityDraft.segment_id)
          ? capacity.map(c => (c.segment_id === change.capacityDraft.segment_id ? change.capacityDraft : c))
          : [...capacity, change.capacityDraft]
        break
      case 'delete-segment':
        segments = segments.filter(s => s.id !== change.segmentId)
        capacity = capacity.filter(c => c.segment_id !== change.segmentId)
        break
    }
  }

  return { nodes, segments, capacity }
}

/** Node ids and segment ids touched by at least one pending change — drives
 *  the "staged" visual treatment (dashed amber outline) on the map. */
export function pendingAffectedIds(pending: PendingChange[]): { nodeIds: Set<string>; segmentIds: Set<string> } {
  const nodeIds = new Set<string>()
  const segmentIds = new Set<string>()
  for (const c of pending) {
    if (c.kind === 'move-node' || c.kind === 'delete-node') nodeIds.add(c.nodeId)
    if (c.kind === 'new-node') nodeIds.add(c.tempId)
    if (c.kind === 'edit-waypoints' || c.kind === 'delete-segment') segmentIds.add(c.segmentId)
    if (c.kind === 'new-segment') segmentIds.add(c.tempId)
  }
  return { nodeIds, segmentIds }
}
