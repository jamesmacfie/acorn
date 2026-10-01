import { dehydrate, type DehydrateOptions, type QueryClient } from '@tanstack/solid-query'
import { persistQueryClientRestore, type PersistedClient, type Persister } from '@tanstack/query-persist-client-core'
import { measure, recordSample } from '../telemetry/emitter'
import { PERSISTED_SNAPSHOT_MAX_AGE_MS, shouldPersistQuery } from './queryPersistence'

export type CacheStorage = {
  getItem(key: string): Promise<string | undefined | null>
  setItem(key: string, value: string): Promise<unknown>
  removeItem(key: string): Promise<void>
}

export type QueryCacheLease = { restored: Promise<void>; release(): void }
export type QueryCacheLifecycle = {
  persister: Persister
  acquire(): QueryCacheLease
  flush(): Promise<void>
  retire(): Promise<void>
  retired(): boolean
}

// The clock covers capture, serialization, and storage. Cache notifications only mark dirty; a
// partition scan happens once per window, regardless of the number of queries invalidated.
export function queryCacheLifecycle(options: {
  client: QueryClient
  storage: CacheStorage
  key: string
  beforeAccess?: () => Promise<void>
  beforeRetire?: () => Promise<void>
  onHydrated?: () => void
  onRetire?: () => void
  onError: (error: unknown) => void
  captureWindowMs?: number
  dehydrateOptions?: DehydrateOptions
}): QueryCacheLifecycle {
  const { client, storage, key } = options
  let retired = false
  let leases = 0
  let dirty = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let unsubscribe: (() => void) | undefined
  let restoring: Promise<void> | undefined
  let retirement: Promise<void> | undefined
  let retirementFailed = false
  let writes = Promise.resolve()
  let capturing: Promise<void> | undefined

  const beforeAccess = () => options.beforeAccess?.() ?? Promise.resolve()
  // Serialize writes and deletion through the same owner. This also keeps the file adapter's fixed
  // sibling temporary filename safe across captures and retirement.
  const enqueue = (work: () => Promise<void>): Promise<void> => {
    const next = writes.catch(() => {}).then(work)
    writes = next
    return next
  }
  const remove = (retiring = false) => enqueue(async () => {
    await (retiring && options.beforeRetire ? options.beforeRetire() : beforeAccess())
    await storage.removeItem(key)
  })
  const persister: Persister = {
    persistClient: (snapshot) => enqueue(async () => {
      await beforeAccess()
      if (retired) return
      const text = measure('core', 'cache.serialize', () => {
        recordSample('core', 'cache.entries', snapshot.clientState.queries.length)
        const value = JSON.stringify(snapshot)
        recordSample('core', 'cache.characters', value.length)
        return value
      })
      await measure('core', 'cache.write', () => storage.setItem(key, text))
    }),
    restoreClient: async () => {
      await beforeAccess()
      if (retired) return undefined
      // A remount must not read an older disk value while its final outgoing write is pending.
      await writes.catch(() => {})
      const text = await measure('core', 'cache.read', () => storage.getItem(key))
      if (retired || !text) return undefined
      return measure('core', 'cache.deserialize', () => JSON.parse(text) as PersistedClient)
    },
    removeClient: () => retired ? Promise.resolve() : remove(),
  }
  const flush = (): Promise<void> => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    if (capturing) return capturing.then(() => dirty && !retired ? flush() : undefined)
    capturing = (async () => {
      await restoring
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
      if (!retired && dirty) {
        dirty = false
        try {
          recordSample('core', 'cache.dehydrate.count', 1)
          const clientState = measure('core', 'cache.dehydrate', () => dehydrate(client, {
            ...options.dehydrateOptions,
            shouldDehydrateQuery: options.dehydrateOptions?.shouldDehydrateQuery ?? shouldPersistQuery,
          }))
          await persister.persistClient({ buster: '', timestamp: Date.now(), clientState })
        } catch (error) {
          if (!retired) dirty = true
          throw error
        }
      } else await writes
    })().finally(() => { capturing = undefined })
    return capturing
  }
  const markDirty = () => {
    if (retired) return
    dirty = true
    if (timer === undefined) timer = setTimeout(() => {
      void flush().catch(options.onError)
    }, options.captureWindowMs ?? 5_000)
  }
  const subscribe = () => {
    if (retired || !leases || unsubscribe) return
    const onEvent = (event: { type: string }) => {
      if (event.type === 'added' || event.type === 'removed' || event.type === 'updated') markDirty()
    }
    const queryOff = client.getQueryCache().subscribe(onEvent)
    const mutationOff = client.getMutationCache().subscribe(onEvent)
    unsubscribe = () => { queryOff(); mutationOff() }
  }
  return {
    persister,
    retired: () => retired,
    flush,
    acquire: () => {
      leases++
      if (!restoring) {
        restoring = persistQueryClientRestore({ queryClient: client, persister, maxAge: PERSISTED_SNAPSHOT_MAX_AGE_MS })
          .then(() => {
            if (!retired) options.onHydrated?.()
            subscribe()
            if (dirty && timer === undefined) markDirty()
          })
          .catch((error) => {
            // A rejected retirement barrier still fences storage. Keep tracking real selected-cache
            // changes so an explicit recovery can save them after deletion succeeds.
            subscribe()
            options.onError(error)
            throw error
          })
          .finally(() => { restoring = undefined })
      }
      const restored = restoring
      let released = false
      return { restored, release: () => {
        if (released) return
        released = true
        leases--
        if (leases) return
        // Child cleanup can write synchronously after the provider releases. Keep the listener until
        // that cleanup turn finishes, then retain one bounded final capture without idle subscriptions.
        queueMicrotask(() => {
          if (leases || retired) return
          unsubscribe?.()
          unsubscribe = undefined
          if (dirty && timer === undefined) markDirty()
        })
      } }
    },
    retire: () => {
      if (retirement && !retirementFailed) return retirement
      if (!retired) options.onRetire?.()
      retired = true
      dirty = false
      unsubscribe?.()
      unsubscribe = undefined
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
      retirementFailed = false
      retirement = remove(true).catch((error) => { retirementFailed = true; throw error })
      return retirement
    },
  }
}
