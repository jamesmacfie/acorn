import { Registry } from '../../../kit/lib/registry'

// The attention inbox's contribution point (docs/frontend.md § Shell state distinguishes it from a
// notice).
//
// An attention item is a state that persists until something changes on the node: a pending approval
// is still pending after you dismiss it, so it comes back on the next fetch. That is why items are
// fetched rather than pushed, and why there is no `read` flag.
//
// Fetched per node, addressed explicitly, so the inbox is fleet-wide through the same fan-out every
// other aggregated surface uses.
export type AttentionItem = {
  // Stable across fetches for the same underlying state: the row is re-rendered, not re-created, and
  // the client needs a key that survives a refetch. Namespace it with the contribution id.
  id: string
  // Which task it concerns, when it concerns one. Absent for a node-level item (an integration that
  // needs reauthenticating, a plugin whose setup is incomplete).
  taskId?: string
  // Which project it concerns, when it concerns one and no task. The inbox routes there before it
  // dispatches the target, because a `projectScoped` surface reads the routed project: arriving on
  // the wrong one draws the page with this row's own subject filtered out of it, which is worse than
  // not moving at all.
  //
  // Read only when `taskId` is absent. A task route carries no project, so a row naming both would
  // have to pick, and the task is the more specific of the two.
  projectId?: string
  title: string
  detail?: string
  // The row's own glyph, a Lucide name (docs/ui-design.md § Icons). Absent falls back to the pair the
  // inbox draws from `severity`, which is the right answer for a row about a blocked agent and the
  // wrong one for a source whose rows are all the same kind of thing.
  glyph?: string
  // Urgency, and with it whether the row can be retired: `info` means nothing is blocked, so the
  // owner can acknowledge it away (attentionInbox.ts § the seen set). `warn` and `danger` name a
  // block only they can lift, so the row stays until they do.
  severity: 'info' | 'warn' | 'danger'
  // When the state began, for the relative time on the row.
  at: number
  // Where clicking should land. Reuses the notice target vocabulary and its handler table
  // (notifications/notifications.ts), since "open the thing this is about" is the same problem
  // already solved.
  //
  // Required, and that is the point. A row in the inbox is an invitation to go and deal with
  // something; a row that swallows the click and does nothing teaches the reader that the whole
  // section is decorative. Plugin failures shipped without one for exactly that reason, so the rule
  // is a type rather than a convention. A source with nowhere to send the reader has no row to draw.
  target: { kind: string; resourceId: string; subresourceId?: string }
}

export type AttentionSourceContribution = {
  id: string
  // Section order within the inbox, declared, like every other registry here.
  order: number
  // Resolved against one node. A source must never read the ambient active node: the inbox shows
  // every paired node at once, and a fetcher that ignored its argument would silently report the
  // active node's items under every card.
  fetch(nodeId: string, signal: AbortSignal): Promise<AttentionItem[]>
}

export const attentionRegistry = new Registry<AttentionSourceContribution>('attention')

export const attentionSources = (): AttentionSourceContribution[] =>
  [...attentionRegistry.entries()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))

// Ranking for the merged list: worst first, then newest. Severity beats age because the point of the
// inbox is "what is blocked", and a two-day-old approval request still blocks.
const SEVERITY_RANK: Record<AttentionItem['severity'], number> = { danger: 0, warn: 1, info: 2 }

export const compareAttention = (a: AttentionItem, b: AttentionItem): number =>
  SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.at - a.at || a.id.localeCompare(b.id)
