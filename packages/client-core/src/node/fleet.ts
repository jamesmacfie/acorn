import { createSignal } from 'solid-js'
import { QueryClient } from '@tanstack/solid-query'
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import { del, get, set } from 'idb-keyval'
import type { NodeConnectionState, NodeRecord, NodeStatus } from '@acorn/protocol/broker.ts'
import { acornGlobal } from '../capabilities'

// The fleet store: which nodes this client knows, what state each connection is in, and one query
// cache per node (docs/architecture-overview.md § Fleet semantics, docs/data-layer.md § Client cache).
//
// Membership itself is NOT owned here. Main owns it, because main owns the device tokens and the
// pinned certificates (docs/architecture-overview.md § What runs where); this is a projection of `fleetList()` plus
// the `onNodeStatus` push stream, and every mutation is a request to main.
//
// ## Why a QueryClient per node rather than a nodeId in every query key
//
// docs/data-layer.md calls the cache "keyed by (nodeId, queryKey)". Partitioning at the CLIENT satisfies that
// without a nodeId in the key, and it is the cheaper half of the trade by a wide margin:
//
//   - Prefixing keys means touching all 34 `*Options()` factories, the 44 cache-mutation call sites,
//     the 3 inline key literals, and `shouldPersistQueryKey`, which reads `key[0]`/`key[4]`
//     POSITIONALLY. A client per node touches this file and index.tsx.
//   - "Two nodes may coincidentally hold the same UUID; that must never collide" becomes true by
//     CONSTRUCTION rather than by every future call site remembering the convention.
//   - IndexedDB partitions for free: one persister key per node.
//
// The invariant that makes it safe is stated in activeNode.ts: only the active node's provider is
// mounted, and `setActiveNode` runs before the swap.
const CACHE_KEY_PREFIX = 'acorn-cache:'

// The partition used when there is no broker at all — the renderer served directly by a node
// (`dev:node` in a browser), where the origin IS the node and no nodeId is ever known. A named
// constant rather than `''` so the IndexedDB key stays readable.
export const ORIGIN_NODE_ID = 'origin'

const [nodes, setNodes] = createSignal<readonly NodeRecord[]>([])
const [statuses, setStatuses] = createSignal<Readonly<Record<string, NodeStatus>>>({})

export { nodes }

export const nodeStatus = (nodeId: string): NodeStatus | undefined => statuses()[nodeId]

// Unknown nodes read as `offline` rather than a sixth "unknown" state: the UI's question is always
// "may I trust what I have?", and the answer for a node the broker has not reported on is no.
export const nodeState = (nodeId: string): NodeConnectionState => statuses()[nodeId]?.state ?? 'offline'

// The node whose prefs, keybindings and theme this client obeys. See the divergence note in
// queries.ts's `prefsOptions`: presentation prefs are stored per node, so one node has to win.
export const homeNode = (): NodeRecord | undefined => nodes().find((node) => node.local) ?? nodes()[0]
export const homeNodeId = (): string | null => homeNode()?.nodeId ?? null

// An apiClient target for a request that must go to the home node whatever is active. `nodeId:
// undefined` would be an own property that overrides apiClient's default, so this is spread in or
// omitted entirely; omitted means "the active node", which is right when there is no broker at all
// (the origin IS the node).
export const homeNodeTarget = (): { nodeId?: string } => {
  const nodeId = homeNodeId()
  return nodeId ? { nodeId } : {}
}

let subscribed = false
// Idempotent, never torn down: the push stream's lifetime is the renderer's.
function subscribeStatuses(): void {
  if (subscribed) return
  const onNodeStatus = acornGlobal()?.onNodeStatus
  if (!onNodeStatus) return
  subscribed = true
  onNodeStatus((status) => setStatuses((current) => ({ ...current, [status.nodeId]: status })))
}

// Re-read membership from main. Called at boot (activeNode.ts) and after every owner-initiated
// mutation, because main is the authority and the renderer's copy is only a projection.
export async function refreshFleet(): Promise<void> {
  const fleetList = acornGlobal()?.fleetList
  if (!fleetList) return
  subscribeStatuses()
  const fleet = await fleetList()
  setNodes(fleet.nodes)
  setStatuses(Object.fromEntries(fleet.statuses.map((status) => [status.nodeId, status])))
}

// The persister type is inferred rather than imported: the package exports only the factory, and a
// hand-written structural copy of its return type would be a second thing to keep in step.
export type NodeCache = { client: QueryClient; persister: ReturnType<typeof createAsyncStoragePersister> }

const caches = new Map<string, NodeCache>()

export const cacheKeyFor = (nodeId: string): string => `${CACHE_KEY_PREFIX}${nodeId}`

// The one place a QueryClient is constructed in production. Created lazily so a fleet of ten nodes
// costs one cache for the node actually being looked at.
export function clientFor(nodeId: string): NodeCache {
  const existing = caches.get(nodeId)
  if (existing) return existing
  const cache: NodeCache = {
    client: new QueryClient({
      // Keep focus refreshes useful without turning every quick app switch into a fan-out across every
      // active query. Domain queries that genuinely need fresher data override this (running checks,
      // integration detail, the one-minute PR-list poll).
      // gcTime must outlive a session so persisted entries survive reload (docs/caching.md 3-tier).
      defaultOptions: {
        queries: {
          refetchOnWindowFocus: true,
          staleTime: 30_000,
          gcTime: 1000 * 60 * 60 * 24,
        },
      },
    }),
    // Persist to IndexedDB → instant render from last-known data + offline browsing of recently-seen
    // PRs. One key per node: a shared key would let node A's snapshot rehydrate into node B.
    persister: createAsyncStoragePersister({
      storage: { getItem: get, setItem: set, removeItem: del },
      key: cacheKeyFor(nodeId),
      // Persistence serializes the whole dehydrated cache. A slightly wider coalescing window keeps a
      // burst of PR-prefetch/query updates from repeatedly stringifying the same growing snapshot.
      throttleTime: 5_000,
    }),
  }
  caches.set(nodeId, cache)
  return cache
}

export const homeClient = (): QueryClient => clientFor(homeNodeId() ?? ORIGIN_NODE_ID).client

// Forget everything this client cached for a node. The whole point of the per-node partition: there is
// exactly one place a node's data lives, so eviction is this function and nothing else — contrast
// `runtime:task-archived`, which has to fan out to ten state owners.
//
// Clearing the in-memory client as well as the IndexedDB key matters because the two are independent
// tiers: dropping only the key would leave a live cache that re-persists itself on the next write.
export function dropNode(nodeId: string): void {
  const cache = caches.get(nodeId)
  caches.delete(nodeId)
  cache?.client.clear()
  setNodes((current) => current.filter((node) => node.nodeId !== nodeId))
  setStatuses((current) => {
    const next = { ...current }
    delete next[nodeId]
    return next
  })
  void del(cacheKeyFor(nodeId)).catch((error: unknown) => {
    // A persisted snapshot we could not delete is a correctness problem only if the same nodeId comes
    // back, which needs a re-pair; say so rather than failing the removal the owner asked for.
    console.warn(`[fleet] could not delete the persisted cache for ${nodeId}:`, error)
  })
}

// Test seam: the maps and signals above outlive a single test file otherwise.
export function _resetFleet(): void {
  subscribed = false
  caches.clear()
  setNodes([])
  setStatuses({})
}
