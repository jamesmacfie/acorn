import { createEffect, createResource, onCleanup, type Accessor, type InitializedResourceReturn } from 'solid-js'
import { hashKey } from '@tanstack/solid-query'
import type { NodeRecord } from '@acorn/protocol/broker.ts'
import { clientFor, nodes, nodeState, nodeStatus } from './fleet'
import { freshnessOf, type Freshness } from './freshness'

// The one fan-out primitive. Aggregate surfaces fan out per-node requests with per-node timeouts and
// merge results into a partial-result banner rather than a failed page
// (docs/architecture-overview.md § Client state and fleet behavior).
//
// Not a TanStack `useQueries`: each node has its own QueryClient, so `fetchQuery` against a named
// client is the only shape that reaches the right cache. It writes through, so a later single-node
// read of the same key is warm.
//
// The rule for picking a `queryKey`: sharing a key with another reader means sharing the value's shape
// (docs/caching.md § Fan-out cache safety). Reuse a domain key only when the response is that domain's
// value. Otherwise use a private key such as `['node-stat', id]`, or one reader corrupts another's
// cache entry.

// Matches the broker's DEGRADED_AFTER_MS. Past this a node is treated as not-answering for aggregation
// purposes, whatever its socket says.
const DEFAULT_TIMEOUT_MS = 5_000

export type FleetRow<T> = {
  nodeId: string
  node: NodeRecord
  data: T
  // `live` for a fresh answer, `stale` or `offline` when the row came from that node's cache after a
  // timeout or an error. Per row, because a fleet surface has to show that one node's data is older
  // than another's.
  freshness: Freshness
}

export type FleetUnavailable = {
  nodeId: string
  label: string
  reason: string
}

export type FleetResult<T> = {
  rows: FleetRow<T>[]
  unavailable: FleetUnavailable[]
}

export type FleetQueryOptions = {
  timeoutMs?: number
  // Restrict the fan-out. Fleet home wants every paired node; a surface scoped to one workspace wants
  // only the node that owns it.
  nodeIds?: readonly string[]
}

// What each node's own QueryClient holds under this key. Serve-then-revalidate: a remounted surface
// renders the list it last had instead of a spinner while the fan-out re-runs. Badged `refreshing`
// rather than `stale`, because a fetch is in flight.
//
// Exported for its own test. `createResource` cannot run in this suite, because Solid resolves to its
// server build under a node environment with no Solid plugin.
export function cachedFleet<T>(queryKey: readonly unknown[], options: FleetQueryOptions = {}): FleetResult<T> {
  const wanted = options.nodeIds ? new Set(options.nodeIds) : null
  const rows: FleetRow<T>[] = []
  for (const node of nodes()) {
    if (wanted && !wanted.has(node.nodeId)) continue
    const data = clientFor(node.nodeId).client.getQueryData<T>(queryKey)
    if (data !== undefined) {
      rows.push({ nodeId: node.nodeId, node, data, freshness: freshnessOf(nodeState(node.nodeId), { isFetching: true }) })
    }
  }
  return { rows, unavailable: [] }
}

const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : typeof error === 'string' ? error : 'unavailable'

// Race a promise against a deadline. Rejects with a named error so `unavailable` can say "timed out"
// rather than the generic message every failure shares.
function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    // Seconds above a second, milliseconds below. `Math.round(ms/1000)` reads "no answer within 0s"
    // for a sub-second deadline, and the banner shows this string verbatim.
    const label = ms >= 1_000 ? `${Math.round(ms / 1000)}s` : `${ms}ms`
    const timer = setTimeout(() => reject(new Error(`no answer within ${label}`)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error instanceof Error ? error : new Error(reasonOf(error)))
      },
    )
  })
}

// One node's attempt: fetch through that node's own QueryClient, and on any failure fall back to
// whatever that client already holds under the same key.
async function fetchOne<T>(
  node: NodeRecord,
  queryKey: readonly unknown[],
  fetch: (nodeId: string, signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<{ row: FleetRow<T> } | { unavailable: FleetUnavailable }> {
  const client = clientFor(node.nodeId).client
  const state = nodeState(node.nodeId)
  try {
    const data = await withDeadline(
      client.fetchQuery({
        queryKey,
        queryFn: ({ signal }) => fetch(node.nodeId, signal),
        // The fan-out decides its own freshness; a shared staleTime here would make one surface's
        // deadline depend on another's last visit.
        staleTime: 0,
      }),
      timeoutMs,
    )
    return { row: { nodeId: node.nodeId, node, data, freshness: freshnessOf(state) } }
  } catch (error) {
    const cached = client.getQueryData<T>(queryKey)
    if (cached === undefined) return { unavailable: { nodeId: node.nodeId, label: node.label, reason: reasonOf(error) } }
    // `isStale`, not `isError`. A row served from cache has data, so the honest label is `stale`, or
    // `offline` when the connection state says the node is gone (docs/ui-design.md § States).
    // `isError` would paint an error badge over a readable row.
    return { row: { nodeId: node.nodeId, node, data: cached, freshness: freshnessOf(state, { isStale: true }) } }
  }
}

// The imperative half, for callers that are not inside a reactive scope (a command handler, a test).
export async function fetchFleet<T>(
  queryKey: readonly unknown[],
  fetch: (nodeId: string, signal: AbortSignal) => Promise<T>,
  options: FleetQueryOptions = {},
): Promise<FleetResult<T>> {
  const wanted = options.nodeIds ? new Set(options.nodeIds) : null
  const targets = nodes().filter((node) => !wanted || wanted.has(node.nodeId))
  if (!targets.length) return { rows: [], unavailable: [] }
  const settled = await Promise.all(
    targets.map((node) => fetchOne(node, queryKey, fetch, options.timeoutMs ?? DEFAULT_TIMEOUT_MS)),
  )
  const rows: FleetRow<T>[] = []
  const unavailable: FleetUnavailable[] = []
  for (const outcome of settled) {
    if ('row' in outcome) rows.push(outcome.row)
    else unavailable.push(outcome.unavailable)
  }
  // Fleet order, not completion order, so rows do not reshuffle when one node answers faster.
  return { rows, unavailable }
}

// The reactive half. Re-runs when the fleet changes or when `deps` changes: pass a memo of whatever
// the fetch closes over (a workspace id, a search string) so a stale closure cannot be reused.
export function createFleetQuery<T, D = void>(
  queryKey: (dep: D) => readonly unknown[],
  fetch: (nodeId: string, dep: D, signal: AbortSignal) => Promise<T>,
  deps: Accessor<D> = (() => undefined as D),
  options: FleetQueryOptions = {},
  // Initialized, so a consumer never handles `undefined`. Whatever the per-node caches hold is the
  // pre-answer state, and an empty one renders as no rows rather than a spinner with no deadline.
): InitializedResourceReturn<FleetResult<T>> {
  const resource = createResource(
    // The fleet is part of the source, so pairing, unpairing or a node coming back re-runs the fan-out.
    // The ids are joined into a string, because an array literal compares by identity and never matches.
    () => ({ dep: deps(), fleet: nodes().map((node) => `${node.nodeId}:${nodeStatus(node.nodeId)?.state ?? ''}`).join(',') }),
    ({ dep }) => fetchFleet(queryKey(dep), (nodeId, signal) => fetch(nodeId, dep, signal), options),
    { initialValue: cachedFleet<T>(queryKey(deps()), options) },
  )
  createEffect(() => onCleanup(onFleetInvalidation(queryKey(deps()), () => void resource[1].refetch())))
  return resource
}

// A write invalidates the domain key on the node's own QueryClient, which is all a `createQuery`
// reader needs. A resource hears nothing, so a fan-out surface keeps showing the pre-write list until
// something else re-runs it. Subscribe on every node, because the write may target any of them.
//
// Only the `invalidate` action, so the fan-out's own `fetchQuery` writes cannot loop into a refetch.
export function onFleetInvalidation(queryKey: readonly unknown[], run: () => void): () => void {
  const wanted = hashKey(queryKey)
  const off = nodes().map((node) => clientFor(node.nodeId).client.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated' || event.action.type !== 'invalidate') return
    if (hashKey(event.query.queryKey) === wanted) run()
  }))
  return () => { for (const unsubscribe of off) unsubscribe() }
}
