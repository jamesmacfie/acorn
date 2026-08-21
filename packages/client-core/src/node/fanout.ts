import { createResource, type Accessor, type InitializedResourceReturn } from 'solid-js'
import type { NodeRecord } from '@acorn/protocol/broker.ts'
import { clientFor, nodes, nodeState, nodeStatus } from './fleet'
import { freshnessOf, type Freshness } from './freshness'

// The one fan-out primitive. Aggregate surfaces fan out per-node requests with per-node timeouts and
// merge results into a partial-result banner rather than a failed page
// (docs/architecture-overview.md § Client state and fleet behavior). Agent Center, the workspace
// picker, the attention inbox and the palette all share this one implementation instead of each
// reimplementing the deadline, the cache fallback, and the "partial results are data" rule.
//
// Not a TanStack `useQueries`: each node has its own QueryClient, so `fetchQuery` against an
// explicitly named client is the only shape that reaches the right cache. It writes through, so a
// later single-node read of the same key is warm.
//
// The one rule for picking a `queryKey`: sharing a key with another reader means sharing the value's
// shape (docs/caching.md § Fan-out cache safety). Reuse a domain key only when the response is
// exactly that domain's value (fleet home fetches the task list and counts it in the component); use
// a private key otherwise (`['node-stat', id]`, `['attention', id]`), or one reader can corrupt
// another reader's cache entry.

// Matches the broker's DEGRADED_AFTER_MS. Past this a node is treated as not-answering for aggregation
// purposes, whatever its socket says.
const DEFAULT_TIMEOUT_MS = 5_000

export type FleetRow<T> = {
  nodeId: string
  node: NodeRecord
  data: T
  // `live` for a fresh answer; `stale`/`offline` when the row came from that node's cache after a
  // timeout or an error. Carried per row, since a fleet surface's job is to show that one node's data
  // is older than another's.
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

// What each node's own QueryClient already holds under this key. Serve-then-revalidate: a remounted
// surface renders the list it last had instead of showing a spinner while the fan-out re-runs, the
// same bargain `fetchOne` strikes when a node times out, taken one step earlier. Badged `refreshing`
// rather than `stale`, because a fetch is actually in flight.
//
// Exported for its own test: `createResource` cannot run in this suite (Solid resolves to its server
// build under a node environment with no Solid plugin), so the seeding rule is covered here instead
// of through the resource that calls it.
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
// rather than repeating the generic message every failure would otherwise share.
function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    // Seconds above a second, milliseconds below. `Math.round(ms/1000)` used to produce "no answer
    // within 0s" for every sub-second deadline, a string the banner shows the owner verbatim.
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
    // `isStale`, not `isError`: a row served from cache has data, and the honest label for it is
    // `stale`, or `offline` when the connection state already says the node is gone, which
    // `freshnessOf` decides on its own (docs/ui-design.md § States). Passing `isError` here would
    // paint an error badge over a perfectly readable row.
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
  // Fleet order, not completion order: rows must not reshuffle because one node answered faster this
  // time. `nodes()` is main's list, which is stable.
  return { rows, unavailable }
}

// The reactive half. Re-runs when the fleet changes or when `deps` changes: pass a memo of whatever
// the fetch closes over (a workspace id, a search string) so a stale closure cannot be reused.
export function createFleetQuery<T, D = void>(
  queryKey: (dep: D) => readonly unknown[],
  fetch: (nodeId: string, dep: D, signal: AbortSignal) => Promise<T>,
  deps: Accessor<D> = (() => undefined as D),
  options: FleetQueryOptions = {},
  // Initialized, so a consumer never has to handle `undefined`: whatever the per-node caches already
  // hold IS the pre-answer state, and an empty one renders as "no rows, nothing unavailable" rather
  // than as a spinner with no deadline.
): InitializedResourceReturn<FleetResult<T>> {
  return createResource(
    // The fleet is part of the source so pairing, unpairing or a node coming back re-runs the fan-out.
    // `nodeIds` is joined into the key rather than compared by identity, which an array literal would fail.
    () => ({ dep: deps(), fleet: nodes().map((node) => `${node.nodeId}:${nodeStatus(node.nodeId)?.state ?? ''}`).join(',') }),
    ({ dep }) => fetchFleet(queryKey(dep), (nodeId, signal) => fetch(nodeId, dep, signal), options),
    { initialValue: cachedFleet<T>(queryKey(deps()), options) },
  )
}
