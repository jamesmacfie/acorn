import type { NodeConnectionState } from '@acorn/protocol/broker.ts'

// Every Node-backed surface renders exactly one of these six values (docs/ui-design.md § States),
// derived from the node's connection state and the query's own status. Deriving it in one place is
// what stops the same badge being computed three subtly different ways.
export type Freshness = 'live' | 'refreshing' | 'stale' | 'offline' | 'disabled' | 'error'

// A structural subset of TanStack's query object, so callers pass the query itself and tests pass a
// literal. Every field is optional: the topbar chip has no query at all, only a node.
export type FreshnessQuery = {
  isFetching?: boolean
  isError?: boolean
  isStale?: boolean
  disabled?: boolean
}

// Precedence follows docs/ui-design.md § States: `disabled`, then an unreachable node (which outranks
// `refreshing`), then `degraded` (WS-down/HTTP-up, which reads as `stale`), then the query's own
// status.
export const freshnessOf = (state: NodeConnectionState, query: FreshnessQuery = {}): Freshness => {
  if (query.disabled) return 'disabled'
  if (state !== 'online' && state !== 'degraded') return 'offline'
  if (query.isError) return 'error'
  if (query.isFetching) return 'refreshing'
  if (state === 'degraded') return 'stale'
  return query.isStale ? 'stale' : 'live'
}

export const FRESHNESS_LABELS: Record<Freshness, string> = {
  live: 'Live',
  refreshing: 'Refreshing',
  stale: 'Stale',
  offline: 'Offline',
  disabled: 'Disabled',
  error: 'Error',
}

// Ages are shown next to `stale`/`offline` per docs/ui-design.md § States; "never" rather than a
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
