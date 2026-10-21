import { dehydrate, hydrate, QueryClient } from '@tanstack/solid-query'
import { describe, expect, it } from 'vitest'
import { prefsKey, projectsKey, tasksKey, workspacesKey } from '@acorn/protocol/api.ts'
import {
  PERSISTED_QUERY_MAX_AGE_MS,
  PERSISTED_SNAPSHOT_MAX_AGE_MS,
  shouldPersistQuery,
  shouldPersistQueryKey,
} from './queryPersistence'

describe('query cache persistence policy', () => {
  it('keeps what the first frame draws and nothing else', () => {
    for (const key of [prefsKey, workspacesKey, projectsKey, tasksKey, ['task-scripts', 'v1', 't1']])
      expect(shouldPersistQueryKey(key)).toBe(true)
    // A plugin's query the first frame needs opts in, since core can't name its key.
    expect(shouldPersistQueryKey(['agents', 'providers'], { persist: true })).toBe(true)
    for (const key of [
      ['blob', 'acorn', 'desktop', 'sha'],
      ['files', 'acorn', 'desktop', '12', 'summary'],
      ['pull', 'acorn', 'desktop', '12'],
      ['agents', 'pricing'],
      ['dashboard-plan-run', 'node-a', { source: 'a transcript panel card, whole plan in its key' }],
      ['tasks'],
    ])
      expect(shouldPersistQueryKey(key)).toBe(false)
  })

  it("preserves TanStack Query's successful-query-only dehydration gate", () => {
    const client = new QueryClient()
    const key: readonly unknown[] = tasksKey
    const pending = client.getQueryCache().build(client, { queryKey: key })
    expect(pending.state.status).toBe('pending')
    expect(shouldPersistQuery(pending)).toBe(false)

    client.setQueryData(key, [])
    const successful = client.getQueryCache().find({ queryKey: key })
    expect(successful?.state.status).toBe('success')
    expect(shouldPersistQuery(successful!)).toBe(true)
  })

  it('keeps a query that opts out of persistence in memory only', () => {
    const client = new QueryClient()
    const searchKey: readonly unknown[] = ['plugin-chrome-search', 'linear', 'linear-issues', 'p1', 'crash']
    const query = client.getQueryCache().build(client, { queryKey: searchKey, meta: { persist: false } })
    client.setQueryData(searchKey, { items: [], incomplete: false })
    expect(query.state.status).toBe('success')
    expect(shouldPersistQuery(query)).toBe(false)
  })

  it('does not carry stale entries forward when a newer cache snapshot is written', () => {
    const client = new QueryClient()
    const oldKey = [...tasksKey, 'old']
    const recentKey = [...tasksKey, 'recent']
    client.setQueryData(oldKey, { number: 1 }, { updatedAt: Date.now() - PERSISTED_QUERY_MAX_AGE_MS - 1_000 })
    client.setQueryData(recentKey, { number: 2 }, { updatedAt: Date.now() - PERSISTED_QUERY_MAX_AGE_MS + 1_000 })

    expect(shouldPersistQuery(client.getQueryCache().find({ queryKey: oldKey })!)).toBe(false)
    expect(shouldPersistQuery(client.getQueryCache().find({ queryKey: recentKey })!)).toBe(true)
  })

  it('restores a snapshot from after a weekend away, then drops what nobody refetched', () => {
    const day = 24 * 60 * 60 * 1000
    const quitAt = Date.now() - 3 * day
    const before = new QueryClient()
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
