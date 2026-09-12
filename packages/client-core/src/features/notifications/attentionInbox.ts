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

// Acknowledging a row. A finished session, or an unreviewed memory proposal, is a state the node
// keeps until someone acts on it, so it sits in "Needs you" long after they have read it. Looking at
// it in a focused window acknowledges it, and so does "Mark all read" in the bell.
//
// The key is the node and the row, and deliberately not the row's `at`. A timestamped key looked like
// it bought re-arming — a session that completes twice is news twice — but for the source that
// raises almost every row it bought nothing of the sort: `at` there is the session's `updatedAt`, and
// the node bumps that on every event it records, including the usage report that lands after the turn
// ended and the controller change a reconnect writes. So the key moved when nothing had happened, the
// ack stopped matching, and every row the owner had just cleared came back with the next frame.
//
// What we give up is small and already covered: a session that completes again keeps its cleared row
// hidden, but the completion still raises its own unread notice through the gate (deliver.ts), so the
// pill still moves. The set is session-only and clears on a node switch either way.
const [seen, setSeen] = createSignal<ReadonlySet<string>>(new Set())

const seenKey = (nodeId: string, itemId: string): string => `${nodeId}:${itemId}`

export function markAttentionSeen(nodeId: string, itemId: string): void {
  const key = seenKey(nodeId, itemId)
  setSeen((current) => (current.has(key) ? current : new Set<string>(current).add(key)))
}

// Only a nudge is retirable, and `severity` is the vocabulary for that: `info` means nothing is
// blocked — a turn that finished, a proposal nobody has read. A permission, a question, a gate or an
// error is `warn` or `danger` and describes a block that acknowledging it does not lift.
export const attentionIsAcknowledged = (nodeId: string, item: AttentionItem): boolean =>
  item.severity === 'info' && seen().has(seenKey(nodeId, item.id))

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
