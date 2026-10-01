/**
 * utils/nodeLabel.ts — one place for how a node is written out in the UI.
 *
 * A node's 4-alpha code (SYD1, PALI, CHCC…) is its unique identifier — two
 * sites can share a city or a similar name, but never a code. So anywhere a
 * node is named in a data/reference view it's written code-first:
 *
 *     PALI - Pali Cable Station
 *
 * Use `nodeLabel` when you have the node, `nodeLabelById` when you only have
 * the id and a lookup (it degrades to the bare id for an unknown node, which
 * is still the identifier and so still useful).
 */
import type { CableNode } from '../types'

export function nodeLabel(node: Pick<CableNode, 'id' | 'name'> | undefined | null, fallbackId?: string): string {
  if (!node) return fallbackId ?? '—'
  return node.name ? `${node.id} - ${node.name}` : node.id
}

export function nodeLabelById(id: string, nodesById: Record<string, Pick<CableNode, 'id' | 'name'>>): string {
  return nodeLabel(nodesById[id], id)
}
