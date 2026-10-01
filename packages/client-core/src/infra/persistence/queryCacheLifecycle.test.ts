import { dehydrate, QueryClient, QueryObserver } from '@tanstack/solid-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { queryCacheLifecycle, type CacheStorage, type QueryCacheLifecycle } from './queryCacheLifecycle'
import { PERSISTED_QUERY_MAX_AGE_MS, shouldPersistQuery } from './queryPersistence'

const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
const owners: QueryCacheLifecycle[] = []
const setup = (storage?: CacheStorage) => {
  const records = new Map<string, string>()
  const adapter = storage ?? {
    getItem: vi.fn(async (key: string) => records.get(key)),
    setItem: vi.fn(async (key: string, value: string) => { records.set(key, value) }),
    removeItem: vi.fn(async (key: string) => { records.delete(key) }),
  }
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } })
  let visits = 0
  const persistence = queryCacheLifecycle({
    client, storage: adapter, key: 'partition', onError: vi.fn(),
    dehydrateOptions: { shouldDehydrateQuery: (query) => { visits++; return shouldPersistQuery(query) } },
  })
  owners.push(persistence)
  return { client, persistence, records, adapter, visits: () => visits }
}
const snapshot = (client: QueryClient, timestamp = Date.now()) => JSON.stringify({
  timestamp, buster: '', clientState: dehydrate(client),
})
beforeEach(() => vi.useFakeTimers())
afterEach(async () => {
  for (const owner of owners.splice(0)) await owner.retire().catch(() => {})
  vi.useRealTimers()
})

describe('query cache capture lifecycle', () => {
  it('marks a 3,000-query invalidation burst dirty without traversing and captures once at five seconds', async () => {
    const { client, persistence, records, visits } = setup()
    const lease = persistence.acquire()
    await lease.restored
    for (let i = 0; i < 3_000; i++) client.setQueryData(['row', i], { i })
    await client.invalidateQueries({ refetchType: 'none' })
    expect(visits()).toBe(0)
    await vi.advanceTimersByTimeAsync(4_999)
    expect(records.size).toBe(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(visits()).toBe(3_000)
    const stored = JSON.parse(records.get('partition')!)
    expect(stored.timestamp).toBe(Date.now())
    expect(stored.clientState.queries).toHaveLength(3_000)
    expect(stored.clientState.queries.every((query: { state: { isInvalidated: boolean } }) => query.state.isInvalidated)).toBe(true)
    lease.release()
  })

  it('preserves success eligibility, removal, exclusions, and same-data timestamp advancement', async () => {
    const { client, persistence, records } = setup()
    await persistence.acquire().restored
    const value = { stable: true }
    client.setQueryData(['same'], value, { updatedAt: Date.now() - PERSISTED_QUERY_MAX_AGE_MS - 1 })
    client.setQueryData(['same'], { stable: true })
    expect(client.getQueryData(['same'])).toBe(value)
    client.setQueryData(['removed'], 'gone')
    client.removeQueries({ queryKey: ['removed'] })
    client.setQueryData(['blob', 'sha'], 'excluded')
    client.setQueryData(['files', 1, 2, 3, 'patch'], 'excluded')
    client.setQueryData(['files', 1, 2, 3, 'summary'], 'included')
    client.setQueryData(['failed'], 'previous')
    await client.fetchQuery({ queryKey: ['failed'], queryFn: () => Promise.reject(new Error('offline')) }).catch(() => {})
    client.getQueryCache().build(client, { queryKey: ['pending'] })
    await persistence.flush()
    const rows = JSON.parse(records.get('partition')!).clientState.queries
    expect(rows.map((row: { queryKey: unknown[] }) => row.queryKey)).toEqual([['same'], ['files', 1, 2, 3, 'summary']])
    expect(rows[0].state.dataUpdatedAt).toBe(Date.now())
    const restored = setup()
    restored.records.set('partition', records.get('partition')!)
    await restored.persistence.acquire().restored
    expect(restored.client.getQueryData(['same'])).toEqual(value)
  })

  it('includes paused mutations, records their updates, and persists removal', async () => {
    const { client, persistence, records } = setup()
    await persistence.acquire().restored
    const mutation = client.getMutationCache().build(client, { mutationKey: ['save'] }, {
      context: undefined, data: undefined, error: null, failureCount: 0, failureReason: null,
      isPaused: true, status: 'pending', variables: 'draft', submittedAt: Date.now(),
    })
    client.getMutationCache().notify({ type: 'updated', mutation, action: { type: 'pause' } })
    await persistence.flush()
    expect(JSON.parse(records.get('partition')!).clientState.mutations[0].state.variables).toBe('draft')
    client.getMutationCache().remove(mutation)
    await persistence.flush()
    expect(JSON.parse(records.get('partition')!).clientState.mutations).toEqual([])
  })

  it('ignores observer-only changes', async () => {
    const { client, persistence, visits } = setup()
    client.setQueryData(['row'], 'value')
    await persistence.acquire().restored
    const observer = new QueryObserver(client, { queryKey: ['row'], enabled: false })
    const off = observer.subscribe(() => {})
    observer.setOptions({ queryKey: ['row'], enabled: false, staleTime: 100 })
    off()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(visits()).toBe(0)
  })

  it('coalesces restore, preserves outgoing writes, and unsubscribes the inactive partition', async () => {
    const { client, persistence, records, adapter } = setup()
    const a = persistence.acquire(), b = persistence.acquire()
    expect(a.restored).toBe(b.restored)
    await a.restored
    client.setQueryData(['row'], 'outgoing')
    a.release(); b.release()
    client.setQueryData(['row'], 'cleanup')
    await vi.advanceTimersByTimeAsync(5_000)
    expect(JSON.parse(records.get('partition')!).clientState.queries[0].state.data).toBe('cleanup')
    const writes = vi.mocked(adapter.setItem).mock.calls.length
    client.setQueryData(['row'], 'inactive fleet update')
    await vi.advanceTimersByTimeAsync(5_000)
    expect(adapter.setItem).toHaveBeenCalledTimes(writes)
    // Simulate the inactive GC interval: the disk snapshot still supplies offline return rows.
    client.clear()
    const remount = persistence.acquire()
    await remount.restored
    expect(client.getQueryData(['row'])).toBe('cleanup')
    expect(adapter.getItem).toHaveBeenCalledTimes(2)
    remount.release()
  })

  it('does not capture a clean acquire/release or rewrite an unchanged week-old restore', async () => {
    const seed = new QueryClient(); seed.setQueryData(['row'], 'weekend')
    const { persistence, records, visits, adapter } = setup()
    records.set('partition', snapshot(seed, Date.now() - 3 * 86_400_000))
    const previous = records.get('partition')
    const lease = persistence.acquire()
    await lease.restored
    lease.release()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(visits()).toBe(0)
    expect(adapter.setItem).not.toHaveBeenCalled()
    expect(records.get('partition')).toBe(previous)
  })

  it('shares a pending restore across release/remount without leaving duplicate subscriptions', async () => {
    const seed = new QueryClient(); seed.setQueryData(['row'], 'restored')
    const gate = deferred<string>(), entered = deferred<void>()
    const write = vi.fn(async () => {})
    const { client, persistence, visits } = setup({ getItem: vi.fn(() => { entered.resolve(); return gate.promise }), setItem: write, removeItem: async () => {} })
    const first = persistence.acquire()
    await entered.promise
    first.release()
    await Promise.resolve()
    const remount = persistence.acquire()
    expect(remount.restored).toBe(first.restored)
    gate.resolve(snapshot(seed))
    await remount.restored
    expect(visits()).toBe(0)
    client.setQueryData(['row'], 'fresh')
    await vi.advanceTimersByTimeAsync(5_000)
    expect(visits()).toBe(1)
    expect(write).toHaveBeenCalledTimes(1)
    remount.release()
  })

  it('coalesces newer changes while a write is held and saves the final revision serially', async () => {
    const gate = deferred<void>(), entered = deferred<void>()
    const revisions: unknown[] = []
    let active = 0, maxActive = 0
    const { client, persistence } = setup({ getItem: async () => undefined, removeItem: async () => {}, setItem: async (_key, text) => {
      maxActive = Math.max(maxActive, ++active)
      if (!revisions.length) { entered.resolve(); await gate.promise }
      revisions.push(JSON.parse(text).clientState.queries[0].state.data)
      active--
    } })
    await persistence.acquire().restored
    client.setQueryData(['row'], 1)
    const first = persistence.flush()
    await entered.promise
    client.setQueryData(['row'], 2)
    client.setQueryData(['row'], 3)
    const final = persistence.flush()
    gate.resolve()
    await Promise.all([first, final])
    expect(revisions).toEqual([1, 3])
    expect(maxActive).toBe(1)
  })

  it('retains dirty work after a write or dehydration failure and retries on explicit flush/reacquire', async () => {
    const write = vi.fn().mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(undefined)
    const { client, persistence } = setup({ getItem: async () => undefined, removeItem: async () => {}, setItem: write })
    const lease = persistence.acquire(); await lease.restored
    client.setQueryData(['row'], 'durable after retry')
    await expect(persistence.flush()).rejects.toThrow('disk full')
    await persistence.flush()
    expect(write).toHaveBeenCalledTimes(2)
    lease.release()
    await Promise.resolve()
    write.mockRejectedValueOnce(new Error('again'))
    const remount = persistence.acquire(); await remount.restored
    client.setQueryData(['row'], 'reacquire retry')
    await expect(persistence.flush()).rejects.toThrow('again')
    remount.release(); await Promise.resolve()
    const retry = persistence.acquire(); await retry.restored
    await vi.advanceTimersByTimeAsync(5_000)
    expect(write).toHaveBeenCalledTimes(4)
    retry.release()

    let failing = true
    const broken = new QueryClient()
    const owner = queryCacheLifecycle({ client: broken, key: 'broken', storage: { getItem: async () => undefined, setItem: write, removeItem: async () => {} }, onError: vi.fn(), dehydrateOptions: { shouldDehydrateQuery: () => { if (failing) throw new Error('codec'); return true } } })
    owners.push(owner)
    await owner.acquire().restored
    broken.setQueryData(['row'], 'retry codec')
    await expect(owner.flush()).rejects.toThrow('codec')
    failing = false
    await owner.flush()
    expect(write.mock.calls.at(-1)?.[1]).toContain('retry codec')
  })

  it('drains an already-started write before deletion and drops queued captures', async () => {
    const gate = deferred<void>(), entered = deferred<void>()
    const records = new Map<string, string>()
    const storage: CacheStorage = {
      getItem: async (key) => records.get(key),
      setItem: async (key, value) => { entered.resolve(); await gate.promise; records.set(key, value) },
      removeItem: vi.fn(async (key) => { records.delete(key) }),
    }
    const { client, persistence } = setup(storage)
    const lease = persistence.acquire()
    await lease.restored
    client.setQueryData(['row'], 'started')
    const saving = persistence.flush()
    await entered.promise
    client.setQueryData(['row'], 'queued')
    lease.release()
    const retiring = persistence.retire()
    expect(storage.removeItem).not.toHaveBeenCalled()
    gate.resolve()
    await Promise.all([saving, retiring])
    await vi.advanceTimersByTimeAsync(10_000)
    expect(records.size).toBe(0)
    expect(storage.removeItem).toHaveBeenCalledTimes(1)
  })

  it('fences a read completing after retirement and retries failed deletion explicitly', async () => {
    const gate = deferred<string>(), entered = deferred<void>()
    const seed = new QueryClient()
    seed.setQueryData(['row'], 'retired read')
    const remove = vi.fn().mockRejectedValueOnce(new Error('blocked')).mockResolvedValue(undefined)
    const { client, persistence } = setup({ getItem: () => { entered.resolve(); return gate.promise }, setItem: vi.fn(), removeItem: remove })
    const lease = persistence.acquire()
    await entered.promise
    await expect(persistence.retire()).rejects.toThrow('blocked')
    gate.resolve(snapshot(seed))
    await lease.restored
    expect(client.getQueryData(['row'])).toBeUndefined()
    await persistence.retire()
    expect(remove).toHaveBeenCalledTimes(2)
    lease.release()
  })

  it('restores seven-day snapshots, discards expired and malformed snapshots with public restore', async () => {
    const seed = new QueryClient()
    seed.setQueryData(['row'], 'weekend')
    for (const [text, expected] of [
      [snapshot(seed, Date.now() - 3 * 86_400_000), 'weekend'],
      [snapshot(seed, Date.now() - 8 * 86_400_000), undefined],
      ['invalid json', undefined],
    ] as const) {
      const { client, persistence, records } = setup()
      records.set('partition', text)
      await persistence.acquire().restored.catch(() => {})
      expect(client.getQueryData(['row'])).toBe(expected)
      if (expected === undefined) expect(records.size).toBe(0)
    }
  })
})
