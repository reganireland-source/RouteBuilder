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
 * verification_status is forced to 'draft' on every write this makes,
 * regardless of what it was before — surfaces "edited but unreviewed"
 * through the same status badges RefDataModal already shows.
 */
import { api } from '../api/client'
import type { PendingChange } from './editorState'

export interface SaveAllResult {
  succeededChangeIds: string[]
  errors: { changeId: string; message: string }[]
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export async function saveAll(pending: PendingChange[]): Promise<SaveAllResult> {
  const succeededChangeIds: string[] = []
  const errors: { changeId: string; message: string }[] = []
  // Node ids that failed to create — any later change touching that id is skipped,
  // not attempted (it would just fail again, e.g. a segment referencing a node
  // that never got created).
  const failedNodeIds = new Set<string>()

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

  // 1. New nodes first — everything else may reference them by id.
  for (const c of newNodes) {
    try {
      await api.createNode({ ...c.draft, verification_status: 'draft' })
      succeededChangeIds.push(c.changeId)
    } catch (e) {
      errors.push({ changeId: c.changeId, message: errMessage(e) })
      failedNodeIds.add(c.tempId)
    }
  }

  // 2. New segments (+ their capacity) — may reference a node from step 1.
  for (const c of newSegments) {
    if (failedNodeIds.has(c.draft.start_node_id) || failedNodeIds.has(c.draft.end_node_id)) {
      errors.push({ changeId: c.changeId, message: 'Skipped — an endpoint node failed to create' })
      continue
    }
    try {
      await api.createSegment({ ...c.draft, verification_status: 'draft' })
      await api.createCapacity(c.capacityDraft)
      succeededChangeIds.push(c.changeId)
    } catch (e) {
      errors.push({ changeId: c.changeId, message: errMessage(e) })
    }
  }

  // 3. Move existing nodes.
  for (const c of movesById.values()) {
    try {
      await api.updateNode(c.nodeId, { lat: c.to[0], lng: c.to[1], verification_status: 'draft' })
      succeededChangeIds.push(c.changeId)
    } catch (e) {
      errors.push({ changeId: c.changeId, message: errMessage(e) })
    }
  }

  // 4. Edit existing segments' waypoints. `null` (not omitted) clears the field —
  // matches RefDataModal's existing waypoint-editor save convention exactly.
  for (const c of waypointEditsById.values()) {
    try {
      const payload = { waypoints: c.to.length > 0 ? c.to : null, verification_status: 'draft' } as Partial<import('../types').CableSegment>
      await api.updateSegment(c.segmentId, payload)
      succeededChangeIds.push(c.changeId)
    } catch (e) {
      errors.push({ changeId: c.changeId, message: errMessage(e) })
    }
  }

  // 5. Delete segments (+ capacity) before the nodes they might reference.
  for (const c of deleteSegments) {
    try {
      if (c.capacitySnapshot) await api.deleteCapacity(c.segmentId).catch(() => {}) // capacity may not exist — best-effort
      await api.deleteSegment(c.segmentId)
      succeededChangeIds.push(c.changeId)
    } catch (e) {
      errors.push({ changeId: c.changeId, message: errMessage(e) })
    }
  }

  // 6. Delete nodes last.
  for (const c of deleteNodes) {
    try {
      await api.deleteNode(c.nodeId)
      succeededChangeIds.push(c.changeId)
    } catch (e) {
      errors.push({ changeId: c.changeId, message: errMessage(e) })
    }
  }

  return { succeededChangeIds, errors }
}
