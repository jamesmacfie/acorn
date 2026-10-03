import { createSignal } from 'solid-js'
import { MutationCache, QueryCache, QueryClient } from '@tanstack/solid-query'
import { del, get, set } from 'idb-keyval'
import type { NodeConnectionState, NodeRecord, NodeStatus } from '@acorn/protocol/broker.ts'
import { ACORN_BASELINE } from '@acorn/protocol/baseline.ts'
import { fleetBridge, nodeTransport } from '../platform'
import { emitError, recordDuration, recordSample, telemetryEnabled } from '../telemetry/emitter'
import { createLogger, describeError } from '../telemetry/logger'
import { queryCacheLifecycle, type CacheStorage, type QueryCacheLifecycle } from '../persistence/queryCacheLifecycle'
import { registerQueryOwner } from './queryOwnership'
export type { CacheStorage } from '../persistence/queryCacheLifecycle'
import { dropSegmentCache } from '../../features/diff/segmentCaches'

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
const CACHE_KEY_PREFIX = `acorn-cache:${ACORN_BASELINE}:`

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
// (docs/state-ownership.md § Scope rules).
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
    // (docs/frontend.md § Startup readiness). Re-reading costs the helper one
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

export type NodeCache = { hydrated(): void; client: QueryClient; persister: QueryCacheLifecycle['persister']; persistence: QueryCacheLifecycle }

const caches = new Map<string, NodeCache>()
type Retirement = { pending: Promise<void>; retry?: () => Promise<void> }
const retirements = new Map<string, Retirement>()

function retryRetirement(nodeId: string, record: Retirement): void {
  if (record.retry) record.pending = record.retry()
  const pending = record.pending
  void pending.then(() => {
    if (record.pending !== pending) return
    record.retry = undefined
    if (retirements.get(nodeId) === record) retirements.delete(nodeId)
  }, () => {})
}

function trackRetirement(nodeId: string, retry: () => Promise<void>): Retirement {
  const record: Retirement = { pending: Promise.resolve(), retry }
  retirements.set(nodeId, record)
  retryRetirement(nodeId, record)
  return record
}

export const cacheKeyFor = (nodeId: string): string => `${CACHE_KEY_PREFIX}${nodeId}`

// Where a cache partition is written. IndexedDB is the default because the two hosts that had one
// were both browsers; a host without one installs its own before the first cache is built, which is
// what the terminal client does with a directory of files (apps/tui/src/node/cache.ts). Three
// operations match the public persister contract. Each partition captures this adapter once.
let cacheStorage: CacheStorage = { getItem: (key) => get<string>(key), setItem: set, removeItem: del }

/** Persist query caches somewhere other than IndexedDB. Call it before anything asks for a cache: a
 *  partition already built keeps the store it was built with. */
export const setCacheStorage = (storage: CacheStorage): void => {
  cacheStorage = storage
}

// The one place a QueryClient is constructed in production. Fleet readers can warm memory here;
// persistence starts only when a host acquires the partition for selection.
export function clientFor(nodeId: string): NodeCache {
  const existing = caches.get(nodeId)
  if (existing) return existing
  let restoreStarted: number | null = null
  const storage = cacheStorage
  const predecessor = retirements.get(nodeId)
  const hydrated = () => {
    if (restoreStarted !== null) recordDuration('core', 'cache.restore_to_hydrated', performance.now() - restoreStarted)
    restoreStarted = null
  }
  const client = new QueryClient({
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
  })
  let offTelemetry = () => {}
  const persistence = queryCacheLifecycle({
    client, storage, key: cacheKeyFor(nodeId),
    beforeAccess: () => predecessor?.pending ?? Promise.resolve(),
    beforeRetire: () => {
      if (predecessor?.retry) retryRetirement(nodeId, predecessor)
      return predecessor?.pending ?? Promise.resolve()
    },
    onHydrated: hydrated,
    onRetire: () => offTelemetry(),
    onError: (error) => log.warn('could not persist query cache', error),
  })
  const cache: NodeCache = { client, persistence, persister: persistence.persister, hydrated }
  registerQueryOwner(client, nodeId === ORIGIN_NODE_ID ? null : nodeId)
  const restore = cache.persister.restoreClient
  cache.persister.restoreClient = () => {
    restoreStarted = telemetryEnabled() ? performance.now() : null
    return restore()
  }
  offTelemetry = cache.client.getQueryCache().subscribe((event) => {
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
export function dropNode(nodeId: string): Promise<void> {
  const cache = caches.get(nodeId)
  caches.delete(nodeId)
  if (cache) void cache.persistence.retire().catch(() => {})
  if (cache) dropSegmentCache(cache.client)
  cache?.client.clear()
  setNodes((current) => current.filter((node) => node.nodeId !== nodeId))
  setStatuses((current) => {
    const next = { ...current }
    delete next[nodeId]
    return next
  })
  const predecessor = retirements.get(nodeId)
  // Repeated explicit removal retries a failed deletion through the adapter that owned it.
  if (!cache && predecessor?.retry) retryRetirement(nodeId, predecessor)
  const storage = cacheStorage
  const retiring = cache
    ? trackRetirement(nodeId, () => cache.persistence.retire())
    : predecessor ?? trackRetirement(nodeId, async () => { await storage.removeItem(cacheKeyFor(nodeId)) })
  return retiring.pending.catch((error: unknown) => {
    log.warn(`could not delete the persisted cache for ${nodeId}`, error)
  })
}

// Recover a failed removal through its original adapter, then restore and flush the selected
// replacement's dirty memory. Explicit only; failures do not start a retry loop.
export async function retryCacheRetirement(nodeId: string): Promise<void> {
  const record = retirements.get(nodeId)
  if (!record?.retry) return
  retryRetirement(nodeId, record)
  await record.pending
  const cache = caches.get(nodeId)
  if (!cache) return
  const lease = cache.persistence.acquire()
  try {
    await lease.restored
    await cache.persistence.flush()
  } finally {
    lease.release()
  }
}

/**
 * Settings > Storage and memory's Clear cache: forget what this client cached for a node that stays
 * connected (docs/caching.md § Renderer query cache).
 *
 * Not `dropNode`, which also takes the node out of the fleet list and its status map, and deletes the
 * QueryClient the mounted provider is still holding. This keeps the client and empties it: entries
 * nothing is drawing are removed, the saved snapshot is deleted, and what is on screen is refetched.
 * The on-screen rows stay drawn until their refetch lands, rather than the window going blank. The
 * persister writes a new snapshot with just those entries within five seconds.
 *
 * The resident diff segments are left alone. They are never saved, their memory is bounded, and their
 * `clear` is written for a node that is gone: it drops the claims a mounted diff pane holds.
 */
export async function clearNodeCache(nodeId: string): Promise<void> {
  const cache = clientFor(nodeId)
  await cache.persistence.clearInactive()
  if (caches.get(nodeId) === cache && !cache.persistence.retired()) {
    void cache.client.invalidateQueries({ type: 'active' })
  }
}

/** The saved snapshot for a node: its size as UTF-8 and how many entries it holds, or null when there
 *  is none. Read from the store rather than from memory, because that is what the next launch restores. */
export async function persistedCacheSize(nodeId: string): Promise<{ bytes: number; entries: number } | null> {
  const text = await cacheStorage.getItem(cacheKeyFor(nodeId))
  if (!text) return null
  let entries = 0
  try {
    const parsed = JSON.parse(text) as { clientState?: { queries?: unknown[] } }
    entries = parsed.clientState?.queries?.length ?? 0
  } catch {
    // A snapshot that does not parse still takes the space. The persister discards it on restore.
  }
  return { bytes: new TextEncoder().encode(text).byteLength, entries }
}

// Test seam: the maps and signals above outlive a single test file otherwise.
export function _resetFleet(): void {
  subscribed = false
  chased.clear()
  for (const cache of caches.values()) {
    void cache.persistence.retire().catch(() => {})
    cache.client.clear()
  }
  caches.clear()
  retirements.clear()
  cacheStorage = { getItem: (key) => get<string>(key), setItem: set, removeItem: del }
  setNodes([])
  setStatuses({})
}
