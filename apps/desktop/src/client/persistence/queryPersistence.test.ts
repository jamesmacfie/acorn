import { QueryClient } from '@tanstack/solid-query'
import { describe, expect, it } from 'vitest'
import { shouldPersistQuery, shouldPersistQueryKey } from './queryPersistence'

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
})
