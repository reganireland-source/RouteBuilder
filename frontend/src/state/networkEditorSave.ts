/**
 * state/networkEditorSave.ts — Save All orchestration for the Network Editor.
 *
 * Sequential, not atomic: reuses the existing per-resource endpoints
 * (api.createNode/updateNode/deleteNode, .../Segment, .../Capacity) in
 * dependency order — creates before anything that might reference them,
 * deletes last — instead of one new all-or-nothing backend transaction.
 * On a failed call, the error is recorded against that change and every
 * later step re-attempted; nothing is silently dropped, and failed items
 * stay in the pending list afterward for the user to fix and retry.
 *
 * Every step reports through `onProgress` before and after its HTTP call, so
 * the UI can show exactly which record is being written right now and whether
 * it passed — these writes are one round trip each (and in JSON-file mode the
 * backend rewrites the whole file per write), so a batch is genuinely slow
 * enough to need real feedback rather than an undifferentiated spinner.
 *
 * verification_status is forced to 'draft' on every write this makes,
 * regardless of what it was before — surfaces "edited but unreviewed"
 * through the same status badges RefDataModal already shows.
 */
import { api } from '../api/client'
import type { PendingChange, SaveStatus } from './editorState'
import type { CableSegment } from '../types'

export interface SaveAllResult {
  succeededChangeIds: string[]
  errors: { changeId: string; message: string }[]
}

export type ProgressFn = (changeId: string, status: SaveStatus, message: string) => void

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export async function saveAll(pending: PendingChange[], onProgress: ProgressFn = () => {}): Promise<SaveAllResult> {
  const succeededChangeIds: string[] = []
  const errors: { changeId: string; message: string }[] = []
  // Node ids that failed to create — any later change touching that id is skipped,
  // not attempted (it would just fail again, e.g. a segment referencing a node
  // that never got created).
  const failedNodeIds = new Set<string>()

  /** Runs one step with before/after progress reporting and uniform error
   *  capture, so every branch below reads as a single line of intent. */
  async function step(change: PendingChange, message: string, run: () => Promise<unknown>): Promise<boolean> {
    onProgress(change.changeId, 'running', message)
    try {
      await run()
      onProgress(change.changeId, 'ok', `${message} — done`)
      succeededChangeIds.push(change.changeId)
      return true
    } catch (e) {
      const msg = errMessage(e)
      onProgress(change.changeId, 'error', `${message} — FAILED: ${msg}`)
      errors.push({ changeId: change.changeId, message: msg })
      return false
    }
  }

  const newNodes = pending.filter((c): c is Extract<PendingChange, { kind: 'new-node' }> => c.kind === 'new-node')
  const newSegments = pending.filter((c): c is Extract<PendingChange, { kind: 'new-segment' }> => c.kind === 'new-segment')
  // Dedup to the last entry per id — an earlier move/waypoint-edit for the same
  // node/segment is superseded and would just be redundant work.
  const movesById = new Map<string, Extract<PendingChange, { kind: 'move-node' }>>()
  for (const c of pending) if (c.kind === 'move-node') movesById.set(c.nodeId, c)
  const waypointEditsById = new Map<string, Extract<PendingChange, { kind: 'edit-waypoints' }>>()
  for (const c of pending) if (c.kind === 'edit-waypoints') waypointEditsById.set(c.segmentId, c)
  const deleteSegments = pending.filter((c): c is Extract<PendingChange, { kind: 'delete-segment' }> => c.kind === 'delete-segment')
  const deleteNodes = pending.filter((c): c is Extract<PendingChange, { kind: 'delete-node' }> => c.kind === 'delete-node')

  // Superseded duplicates never get attempted — mark them resolved up front so
  // they don't sit at "Queued" forever and still clear from the pending list.
  for (const c of pending) {
    if (c.kind === 'move-node' && movesById.get(c.nodeId) !== c) {
      onProgress(c.changeId, 'ok', `Superseded by a later move of ${c.nodeId}`)
      succeededChangeIds.push(c.changeId)
    }
    if (c.kind === 'edit-waypoints' && waypointEditsById.get(c.segmentId) !== c) {
      onProgress(c.changeId, 'ok', `Superseded by a later path edit of ${c.segmentId}`)
      succeededChangeIds.push(c.changeId)
    }
  }

  // 1. New nodes first — everything else may reference them by id.
  for (const c of newNodes) {
    await step(c, `Creating node ${c.draft.id} (POST /api/nodes)`, async () => {
      await api.createNode({ ...c.draft, verification_status: 'draft' })
    })
    if (errors.some(e => e.changeId === c.changeId)) failedNodeIds.add(c.tempId)
  }

  // 2. New segments (+ their capacity) — may reference a node from step 1.
  for (const c of newSegments) {
    if (failedNodeIds.has(c.draft.start_node_id) || failedNodeIds.has(c.draft.end_node_id)) {
      const msg = 'Skipped — an endpoint node failed to create'
      onProgress(c.changeId, 'error', `Segment ${c.draft.id}: ${msg}`)
      errors.push({ changeId: c.changeId, message: msg })
      continue
    }
    await step(
      c,
      `Creating segment ${c.draft.id} + ${c.capacityDraft.total_capacity_t}T capacity (POST /api/segments, /api/capacity)`,
      async () => {
        await api.createSegment({ ...c.draft, verification_status: 'draft' })
        await api.createCapacity(c.capacityDraft)
      },
    )
  }

  // 3. Move existing nodes.
  for (const c of movesById.values()) {
    await step(
      c,
      `Moving ${c.nodeId} to ${c.to[0].toFixed(4)}, ${c.to[1].toFixed(4)} (PUT /api/nodes/${c.nodeId})`,
      () => api.updateNode(c.nodeId, { lat: c.to[0], lng: c.to[1], verification_status: 'draft' }),
    )
  }

  // 4. Edit existing segments' waypoints. `null` (not omitted) clears the field —
  // matches RefDataModal's existing waypoint-editor save convention exactly.
  for (const c of waypointEditsById.values()) {
    const count = c.to.length
    await step(
      c,
      `Saving ${count} waypoint${count === 1 ? '' : 's'} on ${c.segmentId} (PUT /api/segments/${c.segmentId})`,
      () => api.updateSegment(c.segmentId, { waypoints: count > 0 ? c.to : null, verification_status: 'draft' } as Partial<CableSegment>),
    )
  }

  // 5. Delete segments (+ capacity) before the nodes they might reference.
  for (const c of deleteSegments) {
    await step(c, `Deleting segment ${c.segmentId}${c.capacitySnapshot ? ' + its capacity' : ''} (DELETE /api/segments/${c.segmentId})`, async () => {
      if (c.capacitySnapshot) await api.deleteCapacity(c.segmentId).catch(() => {}) // capacity may not exist — best-effort
      await api.deleteSegment(c.segmentId)
    })
  }

  // 6. Delete nodes last.
  for (const c of deleteNodes) {
    await step(c, `Deleting node ${c.nodeId} (DELETE /api/nodes/${c.nodeId})`, () => api.deleteNode(c.nodeId))
  }

  return { succeededChangeIds, errors }
}
