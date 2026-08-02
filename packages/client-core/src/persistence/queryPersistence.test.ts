import { QueryClient } from '@tanstack/solid-query'
import { describe, expect, it } from 'vitest'
import { PERSISTED_QUERY_MAX_AGE_MS, shouldPersistQuery, shouldPersistQueryKey } from './queryPersistence'

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
})
