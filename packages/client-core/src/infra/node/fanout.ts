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

// Past this a node is treated as not-answering for aggregation purposes, whatever its socket says.
//
// It deliberately no longer matches the broker's DEGRADED_AFTER_MS. That number describes how long a
// WebSocket may go quiet, not how long a route may take, and a route that reads a credential out of
// 1Password waits on the `op` command: 9.5s on one developer machine against a cold 1Password daemon,
// 1.6s once it was warm. Five seconds drew an "unavailable" banner over a node that was answering
// normally. The node resolves those credentials during boot now
// (node-core server/integrations/connections.ts, warmOnePasswordCache), so this is headroom rather
// than the fix.
const DEFAULT_TIMEOUT_MS = 10_000

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
  // A node that is still booting answers nothing inside the deadline above, and it is listed as
  // `online` the whole time, so the resource's source never changes and nothing re-runs the fan-out.
  // The surface keeps a banner for a node that is fine a few seconds later. This is the ordinary
  // shape of a cold launch, not an edge case: the shell opens the window as soon as the helper is
  // listening, which is a socket bind rather than a node boot (apps/desktop/src-tauri/src/lib.rs).
  let attempt = 0
  createEffect(() => {
    const unavailable = resource[0]().unavailable.length
    if (resource[0].loading) return
    // Only a clean run resets the ladder. Running out of attempts must not, or the next settle for
    // any other reason would start it over and turn this into the poll it is meant not to be.
    if (unavailable === 0) {
      attempt = 0
      return
    }
    const delay = retryDelayMs(attempt, unavailable)
    if (delay === null) return
    attempt += 1
    const timer = setTimeout(() => void resource[1].refetch(), delay)
    onCleanup(() => clearTimeout(timer))
  })
  return resource
}

// How long to wait before asking an unavailable node again, or `null` to stop asking.
//
// A short ladder rather than a poll, because the thing it covers has an end: a node is either up
// within the boot window or it is actually down. The ceiling is that a node which comes back after
// the ladder runs out is not picked up until something else re-runs the fan-out, which a fleet
// change, a write, or a remount all do. Widen RETRY_DELAYS_MS before reaching for a poll.
export const retryDelayMs = (attempt: number, unavailable: number): number | null =>
  unavailable === 0 ? null : (RETRY_DELAYS_MS[attempt] ?? null)

// Covers about 17 seconds, then stops. A node that really is down costs three requests per surface,
// not one every few seconds for as long as the surface is open.
const RETRY_DELAYS_MS = [2_000, 5_000, 10_000]

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
