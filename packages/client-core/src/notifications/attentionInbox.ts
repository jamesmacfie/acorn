import { createMemo } from 'solid-js'
import type { NodeRecord } from '@acorn/protocol/broker.ts'
import { createFleetQuery, type FleetUnavailable } from '../node/fanout'
import { attentionSources, compareAttention, type AttentionItem } from '../registries/attention'

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
        for (const item of row.data) rows.push({ item, nodeId: row.nodeId, node: row.node, sourceId: source.id })
      }
      for (const entry of current.unavailable) if (!unavailable.has(entry.nodeId)) unavailable.set(entry.nodeId, entry)
    }
    // Severity first, then newest. The ranking lives with the type so the fleet-home count and
    // this list cannot disagree about what is urgent.
    rows.sort((a, b) => compareAttention(a.item, b.item))
    return { rows, unavailable: [...unavailable.values()] }
  })
}
