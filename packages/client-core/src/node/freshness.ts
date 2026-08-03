import type { NodeConnectionState } from '@acorn/protocol/broker.ts'

// docs/vNext/ui.md § Connection and staleness vocabulary: "Every node-backed surface can render
// exactly one of: live, refreshing, stale (with age), offline (cached), disabled (plugin off), error
// (with retry). No infinite spinners: anything past its deadline resolves to stale/offline/error."
//
// Six values from two inputs — the node's connection state and the query's own status — because that
// is all the information there is. Deriving it in one place is what stops the same badge being
// computed three subtly different ways.
export type Freshness = 'live' | 'refreshing' | 'stale' | 'offline' | 'disabled' | 'error'

// A structural subset of TanStack's query object, so callers pass the query itself and tests pass a
// literal. Every field is optional: the topbar chip has no query at all, only a node.
export type FreshnessQuery = {
  isFetching?: boolean
  isError?: boolean
  isStale?: boolean
  disabled?: boolean
}

// Precedence, and why: `disabled` is not a data state at all. An unreachable node comes next and wins
// over `refreshing`, because a fetch against an offline node is going to fail and calling it
// "refreshing" would be the infinite spinner ui.md forbids. `degraded` is WS-down/HTTP-up: reads still
// work, but there are no live events, so what is on screen is stale by definition.
export const freshnessOf = (state: NodeConnectionState, query: FreshnessQuery = {}): Freshness => {
  if (query.disabled) return 'disabled'
  if (state !== 'online' && state !== 'degraded') return 'offline'
  if (query.isError) return 'error'
  if (query.isFetching) return 'refreshing'
  if (state === 'degraded') return 'stale'
  return query.isStale ? 'stale' : 'live'
}

// PHASE 1 SCOPE: this is rendered in exactly two places — the topbar chip and the Settings → Nodes
// rows. ui.md's "offline/stale rendering everywhere" across the 13 panes is Phase 4 (plan.md § 116),
// deliberately not forgotten: threading a freshness prop through every pane before the fleet UX exists
// would be 13 edits to revisit.
export const FRESHNESS_LABELS: Record<Freshness, string> = {
  live: 'Live',
  refreshing: 'Refreshing',
  stale: 'Stale',
  offline: 'Offline',
  disabled: 'Disabled',
  error: 'Error',
}

// Ages are shown next to `stale`/`offline` per ui.md ("stale (with age)"); "never" rather than a
// fabricated 0 when the node has not answered once in this session.
export function formatLastSeen(lastSeenAt: number | undefined, now = Date.now()): string {
  if (lastSeenAt === undefined) return 'never'
  const seconds = Math.max(0, Math.round((now - lastSeenAt) / 1000))
  if (seconds < 45) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`
}
