import { createSignal } from 'solid-js'
import { MutationCache, QueryCache, QueryClient } from '@tanstack/solid-query'
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import { del, get, set } from 'idb-keyval'
import type { NodeConnectionState, NodeRecord, NodeStatus } from '@acorn/protocol/broker.ts'
import { fleetBridge, nodeTransport } from '../platform'
import { emitError, measure, recordDuration, recordSample, telemetryEnabled } from '../telemetry/emitter'
import { createLogger, describeError } from '../telemetry/logger'

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

const log = createLogger('fleet')

/**
 * The prefix of a query or mutation key, as the one attribute a failure record carries.
 *
 * The first two segments and no more. A key is `['tasks', nodeId, taskId, …]`, so the whole thing
 * would be a row per task in whatever a sink draws, and the first segment alone cannot tell two of
 * one plugin's reads apart. A non-string segment is dropped rather than stringified, because that
 * is where an id or a filter object sits.
 */
const keyPrefix = (key: readonly unknown[]): string =>
  key.slice(0, 2).filter((part) => typeof part === 'string').join('.') || 'unknown'

/**
 * Every failed read and every failed write on one node, as a handled error record.
 *
 * Here rather than at each call site because this is the choke point: every query and every
 * mutation in the app runs through one of these two caches, and the alternative is a `catch` on
 * several hundred `createQuery` calls that nobody would keep up to date.
 *
 * Handled, always. The UI has already dealt with these: a failed read leaves the last-known data on
 * screen with a stale badge, and a failed write surfaces a notice and keeps the draft
 * (docs/ui-design.md § Connection and staleness vocabulary). What the record adds is a count.
 */
const failureCaches = () => ({
  queryCache: new QueryCache({
    onError: (error, query) => {
      const described = describeError(error)
      emitError('core', {
        ...described,
        handled: true,
        attrs: { seam: 'query', 'query.key': keyPrefix(query.queryKey), 'error.name': described.name },
      })
    },
  }),
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      const described = describeError(error)
      emitError('core', {
        ...described,
        handled: true,
        attrs: {
          seam: 'mutation',
          'query.key': mutation.options.mutationKey ? keyPrefix(mutation.options.mutationKey) : 'unkeyed',
          'error.name': described.name,
        },
      })
    },
  }),
})

// The partition used when there is no broker: a renderer served by a node (`dev:node` in a browser),
// where the origin is the node and no nodeId is known. A named constant rather than `''` so the
// IndexedDB key stays readable.
export const ORIGIN_NODE_ID = 'origin'

const [nodes, setNodes] = createSignal<readonly NodeRecord[]>([])
const [statuses, setStatuses] = createSignal<Readonly<Record<string, NodeStatus>>>({})

export { nodes }

export const nodeStatus = (nodeId: string): NodeStatus | undefined => statuses()[nodeId]

// A supervised local node that membership knows about but the broker has not reported on yet. This
// is the desktop cold-start interval: the helper can answer the fleet read before the node process
// has finished booting and opened its connection. A remote node with no status is offline, not
// starting, because this app does not supervise its process.
export const nodeIsStarting = (nodeId: string): boolean =>
  !nodeStatus(nodeId) && !!nodes().find((node) => node.nodeId === nodeId)?.local

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
    void refreshFleet().catch((error: unknown) => log.warn('could not re-read membership', error))
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
export type NodeCache = { hydrated(): void; client: QueryClient; persister: ReturnType<typeof createAsyncStoragePersister> }

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
  let restoreStarted: number | null = null
  const cache: NodeCache = {
    hydrated: () => {
      if (restoreStarted !== null) recordDuration('core', 'cache.restore_to_hydrated', performance.now() - restoreStarted)
      restoreStarted = null
    },
    client: new QueryClient({
      ...failureCaches(),
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
        getItem: (key) => measure('core', 'cache.read', () => cacheStorage.getItem(key)),
        setItem: (key, value) => measure('core', 'cache.write', () => cacheStorage.setItem(key, value)),
        removeItem: (key) => cacheStorage.removeItem(key),
      },
      serialize: (client) => measure('core', 'cache.serialize', () => {
        recordSample('core', 'cache.entries', client.clientState.queries.length)
        const text = JSON.stringify(client)
        recordSample('core', 'cache.characters', text.length)
        return text
      }),
      deserialize: (text) => measure('core', 'cache.deserialize', () => JSON.parse(text)),
      key: cacheKeyFor(nodeId),
      // Persistence serializes the whole dehydrated cache, so a wider coalescing window stops a burst
      // of query updates stringifying the same growing snapshot over and over.
      throttleTime: 5_000,
    }),
  }
  const restore = cache.persister.restoreClient
  cache.persister.restoreClient = () => {
    restoreStarted = telemetryEnabled() ? performance.now() : null
    return restore()
  }
  cache.client.getQueryCache().subscribe((event) => {
    // Fixed action names only. Query keys can contain task IDs, search text, and file paths.
    if (event.type === 'updated') recordSample('core', 'cache.updates', 1, '1', { action: event.action.type })
    else if (event.type === 'added' || event.type === 'removed') recordSample('core', 'cache.entries.changed', 1, '1', { action: event.type })
  })
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
    log.warn(`could not delete the persisted cache for ${nodeId}`, error)
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
