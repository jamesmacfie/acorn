import { Registry } from './registry'

// The attention inbox's contribution point (docs/plugins.md § The plugin API names it `attention`;
// docs/ui-design.md § Prompts and notifications defines it: "durable items needing action (agent approvals/questions,
// setup incomplete, failures), sourced from node queries + events, resolved by node commands; dismissal
// of informational items is client-local").
//
// The distinction from a NOTICE, which the same popover renders below these: a notice is an EVENT that
// already happened — "claude finished", "run failed" — client-local, dismissible, and gone when the ring
// rolls over. An attention item is a STATE that persists until something changes on the node: a pending
// approval is still pending after you dismiss it, so it comes back on the next fetch, by design. That is
// why items are fetched rather than pushed, and why there is no `read` flag.
//
// Fetched per node, addressed explicitly, so the inbox is fleet-wide through the same fan-out every other
// aggregated surface uses.
export type AttentionItem = {
  // Stable across fetches for the same underlying state — the row is re-rendered, not re-created, and the
  // client needs a key that survives a refetch. Namespace it with the contribution id.
  id: string
  // Which task it concerns, when it concerns one. Absent for a node-level item (an integration that needs
  // reauthenticating, a plugin whose setup is incomplete).
  taskId?: string
  title: string
  detail?: string
  severity: 'info' | 'warn' | 'danger'
  // When the state began, for the relative time on the row.
  at: number
  // Where clicking should land. Reuses the notice target vocabulary and its handler table, because "open
  // the thing this is about" is the same problem and already solved (notifications/notifications.ts).
  target?: { kind: string; resourceId: string; subresourceId?: string }
}

export type AttentionSourceContribution = {
  id: string
  // Section order within the inbox — declared, like every other registry here.
  order: number
  // Resolved against ONE node. A source must never read the ambient active node: the inbox shows every
  // paired node at once, and a fetcher that ignored its argument would silently report the active node's
  // items under every card.
  fetch(nodeId: string, signal: AbortSignal): Promise<AttentionItem[]>
}

export const attentionRegistry = new Registry<AttentionSourceContribution>('attention')

export const attentionSources = (): AttentionSourceContribution[] =>
  [...attentionRegistry.entries()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))

// Ranking for the merged list: worst first, then newest. Severity beats age because the point of the inbox
// is "what is blocked", and a two-day-old approval request still blocks.
const SEVERITY_RANK: Record<AttentionItem['severity'], number> = { danger: 0, warn: 1, info: 2 }

export const compareAttention = (a: AttentionItem, b: AttentionItem): number =>
  SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.at - a.at || a.id.localeCompare(b.id)
