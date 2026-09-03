import { createSignal } from 'solid-js'
import { QueryClient } from '@tanstack/solid-query'
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import { del, get, set } from 'idb-keyval'
import type { NodeConnectionState, NodeRecord, NodeStatus } from '@acorn/protocol/broker.ts'
import { fleetBridge, nodeTransport } from '../platform'

// The fleet store: which nodes this client knows, what state each connection is in, and one query
// cache per node (docs/architecture-overview.md § Client state and fleet behavior,
// docs/data-layer.md § Preferences and client persistence).
//
// Membership is main's, because main owns the device tokens and the pinned certificates
// (docs/architecture-overview.md § Process ownership). This is a projection of `fleetList()` plus the
// `onNodeStatus` push stream, and every mutation is a request to main.
//
// ## Why a QueryClient per node rather than a nodeId in every query key
//
// Partitioning at the client gives each node its own persister and cache without a nodeId in the key:
//
//   - Prefixing keys means touching every `*Options()` factory, every cache-mutation call site, and
//     `shouldPersistQueryKey`, which reads `key[0]` and `key[4]` positionally. A client per node
//     touches this file and index.tsx.
//   - Two nodes holding the same UUID cannot collide by construction, rather than by every call site
//     remembering the convention.
//   - IndexedDB partitions for free, one persister key per node.
//
// The invariant that makes it safe is in activeNode.ts: only the active node's provider is mounted,
// and `setActiveNode` runs before the swap.
const CACHE_KEY_PREFIX = 'acorn-cache:'

// The partition used when there is no broker: a renderer served by a node (`dev:node` in a browser),
// where the origin is the node and no nodeId is known. A named constant rather than `''` so the
// IndexedDB key stays readable.
export const ORIGIN_NODE_ID = 'origin'

const [nodes, setNodes] = createSignal<readonly NodeRecord[]>([])
const [statuses, setStatuses] = createSignal<Readonly<Record<string, NodeStatus>>>({})

export { nodes }

export const nodeStatus = (nodeId: string): NodeStatus | undefined => statuses()[nodeId]

// Unknown nodes read as `offline` rather than a sixth "unknown" state. The UI asks whether it can
// trust what it has, and for a node the broker has not reported on the answer is no.
export const nodeState = (nodeId: string): NodeConnectionState => statuses()[nodeId]?.state ?? 'offline'

// The node this window opens on when nothing else is selected, and the one a notification with no node
// of its own is attributed to. Not a prefs home: preferences follow the resource they describe
// (docs/state.md § Scope rules).
export const homeNode = (): NodeRecord | undefined => nodes().find((node) => node.local) ?? nodes()[0]
export const homeNodeId = (): string | null => homeNode()?.nodeId ?? null

let subscribed = false
// Node ids whose absence from the list has already sent us back to the helper. Once each, so a node
// the helper genuinely does not list cannot turn every ping into a fleet read.
const chased = new Set<string>()

// Idempotent, never torn down: the push stream's lifetime is the renderer's.
function subscribeStatuses(): void {
  if (subscribed) return
  const transport = nodeTransport()
  if (!transport) return
  subscribed = true
  transport.onStatus((status) => {
    setStatuses((current) => ({ ...current, [status.nodeId]: status }))
    // A status for a node this list has never heard of. It used to be impossible: membership was read
    // after the local node had been adopted. The window now opens first, so on a first-ever launch the
    // list is empty and the local node's first status is the only news that it exists
    // (docs/performance.md § Every host draws first). Re-reading costs the helper one
    // file read.
    if (chased.has(status.nodeId) || nodes().some((node) => node.nodeId === status.nodeId)) return
    chased.add(status.nodeId)
    void refreshFleet().catch((error: unknown) => console.warn('[fleet] could not re-read membership:', error))
  })
}

// Re-read membership from main. Called at boot (activeNode.ts) and after every owner-initiated
// mutation, because main is the authority and the renderer's copy is only a projection.
export async function refreshFleet(): Promise<void> {
  const bridge = fleetBridge()
  if (!bridge) return
  subscribeStatuses()
  const fleet = await bridge.list()
  setNodes(fleet.nodes)
  setStatuses(Object.fromEntries(fleet.statuses.map((status) => [status.nodeId, status])))
}

// The persister type is inferred rather than imported, because the package exports only the factory.
export type NodeCache = { client: QueryClient; persister: ReturnType<typeof createAsyncStoragePersister> }

const caches = new Map<string, NodeCache>()

export const cacheKeyFor = (nodeId: string): string => `${CACHE_KEY_PREFIX}${nodeId}`

// Where a cache partition is written. IndexedDB is the default because the two hosts that had one
// were both browsers; a host without one installs its own before the first cache is built, which is
// what the terminal client does with a directory of files (apps/tui/src/node/cache.ts). Three
// functions rather than an interface with two implementations: the persister already names them.
export type CacheStorage = {
  getItem(key: string): Promise<string | undefined | null>
  setItem(key: string, value: string): Promise<unknown>
  removeItem(key: string): Promise<void>
}

let cacheStorage: CacheStorage = { getItem: (key) => get<string>(key), setItem: set, removeItem: del }

/** Persist query caches somewhere other than IndexedDB. Call it before anything asks for a cache: a
 *  partition already built keeps the store it was built with. */
export const setCacheStorage = (storage: CacheStorage): void => {
  cacheStorage = storage
}

// The one place a QueryClient is constructed in production. Created lazily so a fleet of ten nodes
// costs one cache for the node actually being looked at.
export function clientFor(nodeId: string): NodeCache {
  const existing = caches.get(nodeId)
  if (existing) return existing
  const cache: NodeCache = {
    client: new QueryClient({
      // Keeps focus refreshes useful without turning a quick app switch into a fan-out across every
      // active query. Queries that need fresher data override this. gcTime has to outlive a session so
      // persisted entries survive a reload (docs/caching.md § Renderer query cache).
      defaultOptions: {
        queries: {
          refetchOnWindowFocus: true,
          staleTime: 30_000,
          gcTime: 1000 * 60 * 60 * 24,
        },
      },
    }),
    // Persisted so a restart renders from last-known data. One key per node, or node A's snapshot
    // rehydrates into node B.
    persister: createAsyncStoragePersister({
      // Through the indirection rather than the object, so a host that swaps the store gets the swap
      // rather than whatever was installed when this line was evaluated.
      storage: {
        getItem: (key) => cacheStorage.getItem(key),
        setItem: (key, value) => cacheStorage.setItem(key, value),
        removeItem: (key) => cacheStorage.removeItem(key),
      },
      key: cacheKeyFor(nodeId),
      // Persistence serializes the whole dehydrated cache, so a wider coalescing window stops a burst
      // of query updates stringifying the same growing snapshot over and over.
      throttleTime: 5_000,
    }),
  }
  caches.set(nodeId, cache)
  return cache
}

export const homeClient = (): QueryClient => clientFor(homeNodeId() ?? ORIGIN_NODE_ID).client

// Forget everything this client cached for a node. The payoff of the per-node partition: one place a
// node's data lives, so eviction is this function alone, unlike `runtime:task-archived`, which fans
// out to ten state owners.
//
// The in-memory client and the IndexedDB key are independent tiers, so dropping only the key leaves a
// live cache that re-persists itself on the next write.
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
    // A snapshot that could not be deleted only matters if the same nodeId comes back, which needs a
    // re-pair. Say so rather than failing the removal the owner asked for.
    console.warn(`[fleet] could not delete the persisted cache for ${nodeId}:`, error)
  })
}

// Test seam: the maps and signals above outlive a single test file otherwise.
export function _resetFleet(): void {
  subscribed = false
  chased.clear()
  caches.clear()
  setNodes([])
  setStatuses({})
}
