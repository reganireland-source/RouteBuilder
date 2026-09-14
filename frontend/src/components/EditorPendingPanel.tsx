/**
 * EditorPendingPanel — the Network Editor's staged-changes list.
 *
 * One row per PendingChange (human-readable label, a discard ×, and the error
 * message if a previous Save All attempt failed on it), plus Undo/Redo/Save
 * All/Discard All. This list IS the undo stack — see state/editorState.ts's
 * header comment for why entries are full-value snapshots rather than deltas.
 *
 * Mounted from App.tsx's middle panel when mode === 'networkeditor', replacing
 * the RouteList that mounts there in every other mode.
 */
import { useState } from 'react'
import type { CableNode, CableSegment } from '../types'
import type { EditorState, EditorAction, PendingChange } from '../state/editorState'
import { useTheme } from '../theme'

interface Props {
  state: EditorState
  dispatch: (action: EditorAction) => void
  nodes: CableNode[]
  segments: CableSegment[]
  onSaveAll: () => void
}

function describeChange(change: PendingChange, nodesById: Record<string, CableNode>, segmentsById: Record<string, CableSegment>): string {
  switch (change.kind) {
    case 'move-node': {
      const name = nodesById[change.nodeId]?.name ?? change.nodeId
      return `Moved ${name} → ${change.to[0].toFixed(4)}, ${change.to[1].toFixed(4)}`
    }
    case 'new-node':
      return `New node ${change.draft.name || change.draft.id}`
    case 'delete-node':
      return `Delete ${change.snapshot.name || change.nodeId}${change.cascadeSegmentIds.length ? ` (+${change.cascadeSegmentIds.length} segment${change.cascadeSegmentIds.length === 1 ? '' : 's'})` : ''}`
    case 'edit-waypoints': {
      const name = segmentsById[change.segmentId]?.name ?? change.segmentId
      return `Edited path — ${name} (${change.to.length} waypoint${change.to.length === 1 ? '' : 's'})`
    }
    case 'new-segment':
      return `New segment ${change.draft.name || change.draft.id}`
    case 'delete-segment':
      return `Delete segment ${change.snapshot.name || change.segmentId}${change.viaNodeCascade ? ' (via node delete)' : ''}`
    default:
      return 'Change'
  }
}

export function EditorPendingPanel({ state, dispatch, nodes, segments, onSaveAll }: Props) {
  const t = useTheme()
  const [confirmDiscardAll, setConfirmDiscardAll] = useState(false)
  const nodesById = Object.fromEntries(nodes.map(n => [n.id, n]))
  const segmentsById = Object.fromEntries(segments.map(s => [s.id, s]))

  const hasPending = state.pending.length > 0
  const hasErrors = state.pending.some(c => c.lastError)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          onClick={() => dispatch({ type: 'UNDO' })}
          disabled={!hasPending}
          title="Undo (Ctrl+Z)"
          style={smallBtnStyle(t, !hasPending)}
        >↶ Undo</button>
        <button
          onClick={() => dispatch({ type: 'REDO' })}
          disabled={state.redoStack.length === 0}
          title="Redo (Ctrl+Shift+Z)"
          style={smallBtnStyle(t, state.redoStack.length === 0)}
        >↷ Redo</button>
        <div style={{ flex: 1 }} />
        {hasPending && (
          confirmDiscardAll ? (
            <>
              <span style={{ fontSize: 11, color: t.textMuted, alignSelf: 'center' }}>Discard all {state.pending.length}?</span>
              <button onClick={() => { dispatch({ type: 'DISCARD_ALL' }); setConfirmDiscardAll(false) }} style={smallBtnStyle(t, false, t.red)}>Yes</button>
              <button onClick={() => setConfirmDiscardAll(false)} style={smallBtnStyle(t, false)}>Cancel</button>
            </>
          ) : (
            <button onClick={() => setConfirmDiscardAll(true)} style={smallBtnStyle(t, false)}>Discard All</button>
          )
        )}
      </div>

      {!hasPending ? (
        <p style={{ color: t.textFaintest, fontSize: 13, marginTop: 8 }}>
          Pending changes will appear here once you start moving nodes, editing waypoints, or creating segments on the map.
        </p>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {state.pending.map(change => (
              <div
                key={change.changeId}
                style={{
                  display: 'flex', flexDirection: 'column', gap: 2,
                  padding: '6px 8px', borderRadius: 5,
                  border: `1px solid ${change.lastError ? t.red : t.border}`,
                  background: change.lastError ? t.red + '10' : t.bgCard,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 12, color: t.text, flex: 1 }}>{describeChange(change, nodesById, segmentsById)}</span>
                  <button
                    onClick={() => dispatch({ type: 'DISCARD_ONE', changeId: change.changeId })}
                    title="Discard this change"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: t.textFaint, fontSize: 13, lineHeight: 1, padding: '0 2px' }}
                  >×</button>
                </div>
                {change.lastError && <span style={{ fontSize: 11, color: t.red }}>⚠ {change.lastError}</span>}
              </div>
            ))}
          </div>

          <button
            onClick={onSaveAll}
            disabled={state.saveInFlight}
            style={{
              padding: '9px 12px', borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: state.saveInFlight ? 'default' : 'pointer',
              border: 'none', background: state.saveInFlight ? t.textFaintest : t.green, color: '#0b1f14', fontFamily: 'inherit',
            }}
          >
            {state.saveInFlight ? 'Saving…' : `Save All (${state.pending.length})`}
          </button>
          {hasErrors && (
            <p style={{ fontSize: 11, color: t.red, margin: 0 }}>
              Some changes failed to save last time — fix and retry, or discard them.
            </p>
          )}
        </>
      )}
    </div>
  )
}

function smallBtnStyle(t: ReturnType<typeof useTheme>, disabled: boolean, bg?: string) {
  return {
    padding: '5px 10px', borderRadius: 5, fontSize: 11, fontWeight: 600,
    cursor: disabled ? 'default' : 'pointer',
    border: `1px solid ${bg ?? t.border}`,
    background: bg ?? 'transparent',
    color: disabled ? t.textFaintest : bg ? '#fff' : t.textMuted,
    opacity: disabled ? 0.5 : 1,
    fontFamily: 'inherit',
  } as const
}
