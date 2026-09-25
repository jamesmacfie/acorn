import { dehydrate, hydrate, QueryClient } from '@tanstack/solid-query'
import { describe, expect, it } from 'vitest'
import { PERSISTED_QUERY_MAX_AGE_MS, PERSISTED_SNAPSHOT_MAX_AGE_MS, shouldPersistQuery, shouldPersistQueryKey } from './queryPersistence'

describe('query cache persistence policy', () => {
  it('excludes file bodies and every patch-bearing files query', () => {
    expect(shouldPersistQueryKey(['blob', 'acorn', 'desktop', 'sha'])).toBe(false)
    expect(shouldPersistQueryKey(['files', 'acorn', 'desktop', '12'])).toBe(false)
    expect(shouldPersistQueryKey(['files', 'acorn', 'desktop', '12', 'patch', 'src/a.ts'])).toBe(false)
  })

  it('retains small file summaries and normal domain queries', () => {
    expect(shouldPersistQueryKey(['files', 'acorn', 'desktop', '12', 'summary'])).toBe(true)
    expect(shouldPersistQueryKey(['tasks'])).toBe(true)
  })

  it('preserves TanStack Query\'s successful-query-only dehydration gate', () => {
    const client = new QueryClient()
    const tasksKey: readonly unknown[] = ['tasks']
    const pending = client.getQueryCache().build(client, { queryKey: tasksKey })
    expect(pending.state.status).toBe('pending')
    expect(shouldPersistQuery(pending)).toBe(false)

    client.setQueryData(tasksKey, [])
    const successful = client.getQueryCache().find({ queryKey: tasksKey })
    expect(successful?.state.status).toBe('success')
    expect(shouldPersistQuery(successful!)).toBe(true)
  })

  it('does not carry stale entries forward when a newer cache snapshot is written', () => {
    const client = new QueryClient()
    const oldKey: readonly unknown[] = ['pull', 'acorn', 'desktop', '1']
    const recentKey: readonly unknown[] = ['pull', 'acorn', 'desktop', '2']
    client.setQueryData(oldKey, { number: 1 }, { updatedAt: Date.now() - PERSISTED_QUERY_MAX_AGE_MS - 1_000 })
    client.setQueryData(recentKey, { number: 2 }, { updatedAt: Date.now() - PERSISTED_QUERY_MAX_AGE_MS + 1_000 })

    expect(shouldPersistQuery(client.getQueryCache().find({ queryKey: oldKey })!)).toBe(false)
    expect(shouldPersistQuery(client.getQueryCache().find({ queryKey: recentKey })!)).toBe(true)
  })

  it('restores a snapshot from after a weekend away, then drops what nobody refetched', () => {
    const day = 24 * 60 * 60 * 1000
    const quitAt = Date.now() - 3 * day
    const before = new QueryClient()
    const tasksKey: readonly unknown[] = ['tasks']
    const pullKey: readonly unknown[] = ['pull', 'acorn', 'desktop', '1']
    before.setQueryData(tasksKey, [{ id: 'a' }], { updatedAt: quitAt })
    before.setQueryData(pullKey, { number: 1 }, { updatedAt: quitAt })
    const snapshot = { timestamp: quitAt, clientState: dehydrate(before, { shouldDehydrateQuery: () => true }) }

    // The persister's own test (persistQueryClientRestore): older than maxAge and the whole snapshot goes.
    expect(Date.now() - snapshot.timestamp > PERSISTED_SNAPSHOT_MAX_AGE_MS).toBe(false)
    const after = new QueryClient()
    hydrate(after, snapshot.clientState)
    expect(after.getQueryData(tasksKey)).toEqual([{ id: 'a' }])

    // The rail refetched its tasks; the pull request was never opened.
    after.setQueryData(tasksKey, [{ id: 'a' }, { id: 'b' }])
    const next = dehydrate(after, { shouldDehydrateQuery: shouldPersistQuery })
    expect(next.queries.map((query) => query.queryKey)).toEqual([tasksKey])
  })
})
