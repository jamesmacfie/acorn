import { createMemo, createSignal } from 'solid-js'
import type { NodeRecord } from '@acorn/protocol/broker.ts'
import { createFleetQuery, type FleetUnavailable } from '../../infra/node/fanout'
import { attentionSources, compareAttention, type AttentionItem } from '../../host/registries/rail/attention'
import { onScopeEvicted } from '../../host/registries/shell/scopeEviction'

// The fleet-wide attention list, merged across every source and every node.
//
// One fan-out per source rather than one combined call per node: each plugin's fetch is
// independent, so a plugin disabled on one node leaves its rows off that node only, and a slow
// source cannot hold up a fast one. The cost is N resources instead of one, which for two or three
// sources is nothing.
export type AttentionRow = {
  item: AttentionItem
  nodeId: string
  node: NodeRecord
  sourceId: string
}

export type AttentionInbox = {
  rows: AttentionRow[]
  // Deduplicated across sources: with three sources each fanning out, one dead node would otherwise
  // report itself three times in the banner.
  unavailable: FleetUnavailable[]
}

// Acknowledge on view. `completed` is a state the node keeps until the owner speaks again, so a
// finished session sits in "Needs you" long after they have read it. Looking at it, in a focused
// window, is the acknowledgement.
//
// The key carries `at`, which is the session's `updatedAt`: an ack keyed on the row alone would
// never re-arm, and a session that completes a second time is news again.
const [seen, setSeen] = createSignal<ReadonlySet<string>>(new Set())

const seenKey = (nodeId: string, itemId: string, at: number): string => `${nodeId}:${itemId}:${at}`

export function markAttentionSeen(nodeId: string, itemId: string, at: number): void {
  const key = seenKey(nodeId, itemId, at)
  setSeen((current) => (current.has(key) ? current : new Set<string>(current).add(key)))
}

// Only `completed` is retirable. A permission, a question, a gate or an error describes a block that
// looking at it does not lift.
export const attentionIsAcknowledged = (nodeId: string, item: AttentionItem): boolean =>
  item.attentionReason === 'completed' && seen().has(seenKey(nodeId, item.id, item.at))

// Node-scoped like every other node-minted id (docs/state-ownership.md § Scope rules).
onScopeEvicted((e) => {
  if (e.scope === 'node-switched') setSeen(new Set<string>())
})

export function createAttentionInbox(): () => AttentionInbox {
  // Read once, at creation: the registry is stable for the lifetime of an activation, and re-reading it
  // reactively would recreate every resource on any unrelated registration.
  const sources = attentionSources().map((source) => {
    const [result] = createFleetQuery(
      () => ['attention', source.id] as const,
      (nodeId, _dep, signal) => source.fetch(nodeId, signal),
    )
    return { source, result }
  })

  return createMemo<AttentionInbox>(() => {
    const rows: AttentionRow[] = []
    const unavailable = new Map<string, FleetUnavailable>()
    for (const { source, result } of sources) {
      const current = result()
      for (const row of current.rows) {
        for (const item of row.data) {
          if (attentionIsAcknowledged(row.nodeId, item)) continue
          rows.push({ item, nodeId: row.nodeId, node: row.node, sourceId: source.id })
        }
      }
      for (const entry of current.unavailable) if (!unavailable.has(entry.nodeId)) unavailable.set(entry.nodeId, entry)
    }
    // Severity first, then newest. The ranking lives with the type so the fleet-home count and
    // this list cannot disagree about what is urgent.
    rows.sort((a, b) => compareAttention(a.item, b.item))
    return { rows, unavailable: [...unavailable.values()] }
  })
}
