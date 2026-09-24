import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearSearchProviders, registerSearchProvider, SEARCH_HITS_MAX, SEARCH_TIMEOUT_MS, searchProviders } from './search'

const query = { text: 'towel', limit: 50, taskIds: ['t1'] }

describe('search providers', () => {
  afterEach(() => {
    clearSearchProviders('fast')
    clearSearchProviders('slow')
    clearSearchProviders('broken')
    vi.useRealTimers()
  })

  it('keeps one group per provider, and a slow or broken one reads as unable to answer', async () => {
    vi.useFakeTimers()
    registerSearchProvider({ pluginId: 'fast', id: 'notes', label: 'Notes', search: async () => [{ taskId: 't1', title: 'Towel day', preview: 'bring one' }] })
    registerSearchProvider({ pluginId: 'slow', id: 'x', label: 'Slow', search: () => new Promise(() => {}) })
    registerSearchProvider({ pluginId: 'broken', id: 'x', label: 'Broken', search: async () => { throw new Error('no') } })
    const pending = searchProviders(query)
    await vi.advanceTimersByTimeAsync(SEARCH_TIMEOUT_MS)
    expect(await pending).toEqual([
      { providerId: 'broken:x', label: 'Broken', status: 'failed', hits: [] },
      { providerId: 'fast:notes', label: 'Notes', status: 'ok', hits: [{ taskId: 't1', title: 'Towel day', preview: 'bring one' }] },
      { providerId: 'slow:x', label: 'Slow', status: 'timeout', hits: [] },
    ])
  })

  it('drops hits outside the scope it was given, and caps the rest', async () => {
    const many = Array.from({ length: SEARCH_HITS_MAX + 5 }, (_, i) => ({ taskId: 't1', title: `hit ${i}`, preview: '' }))
    registerSearchProvider({ pluginId: 'fast', id: 'x', label: 'X', search: async () => [{ taskId: 'someone-else', title: 'leak', preview: '' }, ...many] })
    const [group] = await searchProviders(query)
    expect(group!.hits).toHaveLength(SEARCH_HITS_MAX)
    expect(group!.hits.some((hit) => hit.title === 'leak')).toBe(false)
  })
})
