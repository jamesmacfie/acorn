import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentUsageSnapshot } from '../../shared/usage'
import type { AgentUsageClient } from './usageClient'
import { createAgentUsageStore } from './usageStore'

const snapshot = (refreshedAt: number): AgentUsageSnapshot => ({ providers: [], refreshedAt })
const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

afterEach(() => vi.useRealTimers())

describe('agent usage store', () => {
  it('reference-counts consumers and maintains only one polling interval', async () => {
    vi.useFakeTimers()
    const client: AgentUsageClient = {
      read: vi.fn(async () => snapshot(Date.now())),
      refresh: vi.fn(async () => snapshot(Date.now())),
      refreshProvider: vi.fn(async () => snapshot(Date.now())),
    }
    const store = createAgentUsageStore(client)
    const firstCleanup = store.init()
    const secondCleanup = store.init()
    await vi.advanceTimersByTimeAsync(0)
    expect(client.read).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(client.read).toHaveBeenCalledTimes(2)
    firstCleanup()
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(client.read).toHaveBeenCalledTimes(3)
    secondCleanup()
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(client.read).toHaveBeenCalledTimes(3)
  })

  it('does not let a slower initial read replace a forced refresh', async () => {
    const initial = deferred<AgentUsageSnapshot>()
    const forced = deferred<AgentUsageSnapshot>()
    const client: AgentUsageClient = {
      read: () => initial.promise,
      refresh: () => forced.promise,
      refreshProvider: () => forced.promise,
    }
    const store = createAgentUsageStore(client)
    const cleanup = store.init()
    const refresh = store.refresh()
    forced.resolve(snapshot(2))
    await refresh
    initial.resolve(snapshot(1))
    await initial.promise
    await Promise.resolve()
    expect(store.snapshot()?.refreshedAt).toBe(2)
    cleanup()
  })

  it('retains the last snapshot and surfaces a route-level refresh error', async () => {
    const client: AgentUsageClient = {
      read: async () => snapshot(1),
      refresh: async () => {
        throw new Error('bridge unavailable')
      },
      refreshProvider: async () => snapshot(2),
    }
    const store = createAgentUsageStore(client)
    await store.ensure()
    await store.refresh()
    expect(store.snapshot()?.refreshedAt).toBe(1)
    expect(store.error()).toBe('bridge unavailable')
    expect(store.refreshing()).toBe(false)
  })

  it('refreshes only the requested provider and clears its busy state', async () => {
    const claude = deferred<AgentUsageSnapshot>()
    const client: AgentUsageClient = {
      read: async () => snapshot(1),
      refresh: async () => snapshot(2),
      refreshProvider: vi.fn(() => claude.promise),
    }
    const store = createAgentUsageStore(client)
    await store.ensure()
    const refreshing = store.refreshProvider('claude')
    expect(client.refreshProvider).toHaveBeenCalledWith('claude')
    expect(store.refreshingProviderId()).toBe('claude')
    claude.resolve(snapshot(3))
    await refreshing
    expect(store.snapshot()?.refreshedAt).toBe(3)
    expect(store.refreshingProviderId()).toBeNull()
    expect(store.refreshing()).toBe(false)
  })
})
