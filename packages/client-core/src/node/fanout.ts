import { createResource, type Accessor, type InitializedResourceReturn } from 'solid-js'
import type { NodeRecord } from '@acorn/protocol/broker.ts'
import { clientFor, nodes, nodeState, nodeStatus } from './fleet'
import { freshnessOf, type Freshness } from './freshness'

// The one fan-out primitive (docs/architecture-overview.md § Fleet semantics: "Aggregate surfaces fan out
// per-node requests with per-node timeouts and merge results. A slow or offline node yields a
// partial-result banner, never a failed page.").
//
// It exists once so that Agent Center, the workspace picker, the attention inbox and the palette all get
// the same three properties without each reimplementing them:
//
//   1. **A per-node deadline.** docs/ui-design.md forbids infinite spinners; a node behind a dropped VPN answers
//      nothing and its socket may not have been marked offline yet, so the timeout — not the connection
//      state — is what bounds the page.
//   2. **Cache as the fallback.** A node that times out still has whatever it last said in its own
//      QueryClient, so its rows render with a `stale`/`offline` badge instead of vanishing. That is only
//      possible because the cache is partitioned per node (fleet.ts) — there is a real place to look.
//   3. **Partial results are data, not an error.** `unavailable` is a list the caller renders as a
//      banner; nothing rejects, so one dead node cannot fail the surface.
//
// Deliberately NOT a TanStack `useQueries`: the whole point is that each node has its OWN QueryClient,
// and a hook resolves the one from context. `fetchQuery` against an explicitly named client is the only
// shape that reaches the right cache, and it writes through it, so a later single-node read of the same
// key is warm.
//
// ## The one rule that matters when picking `queryKey`
//
// **Sharing a key with another reader means sharing the value's SHAPE.** `fetchQuery` writes through, which is
// the feature — a fan-out over `tasksKey` warms the same cache the rail and the palette read — and it is also
// the trap. A fan-out must reuse a domain key only when the response has exactly that domain's value shape;
// otherwise a private aggregate key prevents one reader from corrupting another reader's cache entry.
//
// So: reuse a domain key when the fetch returns exactly that domain value (fleet home now fetches the task
// LIST and counts in the component), and use a private key otherwise (`['node-stat', id]`,
// `['attention', id]`).

// Matches the broker's DEGRADED_AFTER_MS. Past this a node is treated as not-answering for aggregation
// purposes, whatever its socket says.
const DEFAULT_TIMEOUT_MS = 5_000

export type FleetRow<T> = {
  nodeId: string
  node: NodeRecord
  data: T
  // `live` for a fresh answer; `stale`/`offline` when the row came from that node's cache after a
  // timeout or an error. Rows carry it individually because a fleet surface's whole job is to show that
  // one node's data is older than another's.
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
// surface renders the list it last had instead of flashing "Loading…" while the fan-out re-runs — the
// same bargain `fetchOne` already strikes when a node times out, taken one step earlier. Badged
// `refreshing` rather than `stale`, because a fetch IS in flight; the real answer replaces these rows.
// Exported for its test: `createResource` cannot run in this suite (solid resolves to its server build
// under a node env with no solid plugin), so the seeding rule is covered here rather than through the
// resource that calls it.
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
    // Seconds above a second, milliseconds below. `Math.round(ms/1000)` produced "no answer within 0s" for
    // every sub-second deadline — a string the banner shows the owner verbatim.
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
    // `isStale`, NOT `isError`. docs/ui-design.md's `error` means "no data, offer a retry"; a row served from cache
    // has data, and the honest label for it is `stale` — or `offline` when the connection state already
    // says the node is gone, which freshnessOf decides on its own. Passing `isError` here would paint an
    // error badge over a perfectly readable row.
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

// The reactive half. Re-runs when the fleet changes or when `deps` changes — pass a memo of whatever the
// fetch closes over (a workspace id, a search string) so a stale closure cannot be reused.
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
