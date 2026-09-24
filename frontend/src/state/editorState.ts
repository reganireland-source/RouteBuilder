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

/**
 * A single staged, not-yet-saved edit — the discriminated union at the heart
 * of this file. One variant per user action the editor supports, each
 * carrying a full-value snapshot (never a delta — see the module header's
 * design notes) of what changed:
 *  - `move-node`: an existing node's `from`/`to` position.
 *  - `new-node`: a brand-new node not yet in the backend, keyed by `tempId`
 *    (== its own chosen id — nodes get their real id up front, unlike some
 *    systems that use a separate temp key) with its full `draft`.
 *  - `delete-node`: an existing node to remove, with a `snapshot` (for undo/
 *    display) and any segment ids being cascade-deleted alongside it.
 *  - `edit-waypoints`: an existing segment's path, `from`/`to` the full
 *    waypoint list (`from` may be null if the segment had none before).
 *  - `new-segment`: a brand-new segment (+ its initial capacity draft), keyed
 *    by `tempId` the same way as `new-node`.
 *  - `delete-segment`: an existing segment to remove, with its `snapshot`
 *    (+ capacity snapshot if it had one) and, if this deletion was staged as
 *    part of a node's cascade delete, the triggering node's id in
 *    `viaNodeCascade` (purely informational — see describeChange() in
 *    EditorPendingPanel.tsx).
 * `applyPendingChanges()` below folds an ordered list of these onto the real
 * fetched data; `saveAll()` in networkEditorSave.ts turns them into the
 * actual backend calls.
 */
export type PendingChange =
  | (PendingBase & { kind: 'move-node'; nodeId: string; from: [number, number]; to: [number, number] })
  | (PendingBase & { kind: 'new-node'; tempId: string; draft: CableNode })
  | (PendingBase & { kind: 'delete-node'; nodeId: string; snapshot: CableNode; cascadeSegmentIds: string[] })
  | (PendingBase & { kind: 'edit-waypoints'; segmentId: string; from: [number, number][] | null; to: [number, number][] })
  | (PendingBase & { kind: 'new-segment'; tempId: string; draft: CableSegment; capacityDraft: SegmentCapacity })
  | (PendingBase & { kind: 'delete-segment'; segmentId: string; snapshot: CableSegment; capacitySnapshot?: SegmentCapacity; viaNodeCascade?: string })

/** Which of the Network Editor's four interaction modes is active — see
 *  NetworkEditor.tsx's file header for what each one does. */
export type EditorSubMode = 'move' | 'waypoints' | 'create' | 'delete'

/** The single node or segment currently clicked/selected on the map, or null
 *  when nothing is selected. Only one thing can be selected at a time. */
export type EditorSelection = { kind: 'node' | 'segment'; id: string } | null

let changeCounter = 0
/** Generates a unique, monotonically-distinguishable id for a new
 *  PendingChange — timestamp plus an in-process counter, so two changes
 *  created within the same millisecond still get distinct ids. */
function nextChangeId(): string {
  changeCounter += 1
  return `chg-${Date.now()}-${changeCounter}`
}

// ── EditorState + reducer ────────────────────────────────────────────────────

/** In-progress "click a start node, then an end node" pick in Create sub-mode.
 *  `newNodeAt` is set instead when the user clicked empty map space and is
 *  filling in the drop-a-new-node form. */
export interface SegmentDraft {
  startNodeId: string | null
  endNodeId: string | null
  newNodeAt: { lat: number; lng: number } | null
}

export const emptySegmentDraft: SegmentDraft = { startNodeId: null, endNodeId: null, newNodeAt: null }

/** Per-change state during a Save All run, driving the traffic-light dots in
 *  EditorPendingPanel: queued (grey) → running (amber) → ok (green) / error
 *  (red). `message` is the human-readable description of the actual HTTP call
 *  being made, so a slow save shows exactly what it's doing rather than just
 *  hanging on a spinner. */
export type SaveStatus = 'queued' | 'running' | 'ok' | 'error'
export interface SaveProgressEntry { status: SaveStatus; message: string }

/** The Network Editor's complete local (React) state, managed by
 *  {@link editorReducer}. `pending`/`redoStack` are the staged-changes/undo
 *  mechanism (see the file header); `selection`/`subMode`/`segmentDraft`
 *  track the current UI interaction; `saveInFlight`/`saveProgress`/`saveLog`
 *  track an in-progress or just-finished Save All run (see
 *  networkEditorSave.ts's saveAll(), which App.tsx drives by dispatching
 *  SAVE_START/SAVE_PROGRESS/SAVE_RESULT actions as it runs). */
export interface EditorState {
  pending: PendingChange[]
  redoStack: PendingChange[]
  selection: EditorSelection
  subMode: EditorSubMode
  segmentDraft: SegmentDraft
  saveInFlight: boolean
  saveProgress: Record<string, SaveProgressEntry>
  saveLog: string[]
}

/** The Network Editor's state at mount / after a hard reset: nothing staged,
 *  nothing selected, Move sub-mode active, no save in progress. */
export const initialEditorState: EditorState = {
  pending: [],
  redoStack: [],
  selection: null,
  subMode: 'move',
  segmentDraft: emptySegmentDraft,
  saveInFlight: false,
  saveProgress: {},
  saveLog: [],
}

/** Omit that distributes over a union — a plain Omit<PendingChange, ...> would
 *  collapse the discriminated union down to only its common keys. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

/**
 * Every action {@link editorReducer} handles.
 *  - `MOVE_NODE`: drag/typed-coordinate move of an existing OR still-pending-
 *    new node — the reducer itself decides which (see the 'MOVE_NODE' case).
 *  - `ADD_CHANGE`: stage any other kind of PendingChange (new/delete node or
 *    segment, waypoint edit). Takes a change missing `changeId`/`ts`, which
 *    the reducer fills in — see DistributiveOmit below for why a plain Omit
 *    can't be used for this.
 *  - `UNDO`/`REDO`: pop/restore the most recent pending entry, using
 *    `redoStack` as a stack (see file header).
 *  - `DISCARD_ONE`/`DISCARD_ALL`: remove one or every pending change (and its
 *    redo-stack counterpart, if any) without saving it.
 *  - `SELECT`: set which node/segment is clicked on the map.
 *  - `SET_SUBMODE`: switch Move/Waypoints/Create/Delete — also clears
 *    selection and any in-progress Create-mode draft, since they don't carry
 *    meaning across a sub-mode switch.
 *  - `SET_SEGMENT_DRAFT`: update the in-progress "pick start/end node or drop
 *    a new one" state for Create sub-mode.
 *  - `SAVE_START`/`SAVE_PROGRESS`/`SAVE_RESULT`: drive the Save All progress
 *    UI — dispatched by whatever calls networkEditorSave.ts's saveAll()
 *    (before the run, on each step's progress callback, and with the final
 *    result, respectively).
 */
export type EditorAction =
  | { type: 'MOVE_NODE'; nodeId: string; lat: number; lng: number; fromLat: number; fromLng: number }
  | { type: 'ADD_CHANGE'; change: DistributiveOmit<PendingChange, 'changeId' | 'ts'> }
  | { type: 'UNDO' }
  | { type: 'REDO' }
  | { type: 'DISCARD_ONE'; changeId: string }
  | { type: 'DISCARD_ALL' }
  | { type: 'SELECT'; selection: EditorSelection }
  | { type: 'SET_SUBMODE'; subMode: EditorSubMode }
  | { type: 'SET_SEGMENT_DRAFT'; draft: SegmentDraft }
  | { type: 'SAVE_START' }
  | { type: 'SAVE_PROGRESS'; changeId: string; status: SaveStatus; message: string }
  | { type: 'SAVE_RESULT'; succeededChangeIds: string[]; errors: { changeId: string; message: string }[] }

/** The Network Editor's single reducer — pure, synchronous, and the only
 *  place EditorState ever changes. Every branch returns a new state object
 *  (no in-place mutation); see each `case` below for its own behavior. */
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
      // Move the most recently staged change from `pending` onto `redoStack`
      // — it stays fully intact (full snapshot, same changeId), so REDO can
      // simply move it back.
      if (state.pending.length === 0) return state
      const popped = state.pending[state.pending.length - 1]
      return { ...state, pending: state.pending.slice(0, -1), redoStack: [...state.redoStack, popped] }
    }
    case 'REDO': {
      // The exact inverse of UNDO — pop the most recently undone change back
      // onto the end of `pending`.
      if (state.redoStack.length === 0) return state
      const popped = state.redoStack[state.redoStack.length - 1]
      return { ...state, redoStack: state.redoStack.slice(0, -1), pending: [...state.pending, popped] }
    }
    case 'DISCARD_ONE':
      // Remove by changeId from both lists — a discarded change might be
      // sitting in `redoStack` rather than `pending` if the user had just
      // undone it, so both are filtered defensively.
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
      return { ...state, subMode: action.subMode, selection: null, segmentDraft: emptySegmentDraft }
    case 'SET_SEGMENT_DRAFT':
      return { ...state, segmentDraft: action.draft }
    case 'SAVE_START':
      // Seed every currently-pending change's progress entry as 'queued' up
      // front, so EditorPendingPanel can immediately show the full list of
      // steps about to run rather than having entries pop in one at a time.
      return {
        ...state,
        saveInFlight: true,
        saveLog: [],
        saveProgress: Object.fromEntries(state.pending.map(c => [c.changeId, { status: 'queued' as SaveStatus, message: 'Queued' }])),
      }
    case 'SAVE_PROGRESS':
      // Update just that one change's live status/message, and append a
      // formatted line (✗/✓/→ prefix) to the running saveLog transcript.
      return {
        ...state,
        saveProgress: { ...state.saveProgress, [action.changeId]: { status: action.status, message: action.message } },
        saveLog: [...state.saveLog, `${action.status === 'error' ? '✗' : action.status === 'ok' ? '✓' : '→'} ${action.message}`],
      }
    case 'SAVE_RESULT': {
      // Drop every change that actually succeeded (it's now real backend
      // data, not a pending edit anymore); anything left in `pending` after
      // that filter either wasn't attempted or failed — failed ones get
      // `lastError` attached so EditorPendingPanel can flag them and the user
      // can retry or discard. `saveProgress`/`saveLog` are deliberately left
      // as-is here so the just-finished run's summary stays visible.
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
