import { describe, expect, it } from 'vitest'
import { collectionQueryKey, isCollectionCacheKey, scopedQuery } from './data'

// Only the pure things in the panel's read path. The read itself needs a QueryClient and a
// fan-out, and vitest here runs in node with no Solid plugin, so a test of it would be a test of the
// mocks.

describe('collectionQueryKey', () => {
  it('sorts params, so the same query written two ways shares one cache entry', () => {
    expect(collectionQueryKey({ pluginId: 'github', collectionId: 'pulls', params: { b: '2', a: '1' } }))
      .toEqual(collectionQueryKey({ pluginId: 'github', collectionId: 'pulls', params: { a: '1', b: '2' } }))
  })

  it('separates different params, which are different answers', () => {
    expect(collectionQueryKey({ pluginId: 'github', collectionId: 'pulls', params: { a: '1' } }))
      .not.toEqual(collectionQueryKey({ pluginId: 'github', collectionId: 'pulls', params: { a: '2' } }))
  })
})

describe('scopedQuery', () => {
  const query = { pluginId: 'agents', collectionId: 'sessions' }

  it('fills the board’s workspace for a collection whose rows belong to one', () => {
    expect(scopedQuery(query, { workspaceScoped: true }, 'ws-1').params).toEqual({ workspace: 'ws-1' })
  })

  it('moves the cache key with the workspace, so one board never serves another’s rows', () => {
    expect(collectionQueryKey(scopedQuery(query, { workspaceScoped: true }, 'ws-1')))
      .not.toEqual(collectionQueryKey(scopedQuery(query, { workspaceScoped: true }, 'ws-2')))
  })

  it('leaves every other collection alone, so its answer is still cached once', () => {
    expect(scopedQuery(query, { workspaceScoped: false }, 'ws-1')).toBe(query)
    expect(scopedQuery(query, undefined, 'ws-1')).toBe(query)
  })

  it('keeps a workspace the panel chose, and asks for everything when there is none', () => {
    const pinned = { ...query, params: { workspace: 'ws-9' } }
    expect(scopedQuery(pinned, { workspaceScoped: true }, 'ws-1')).toBe(pinned)
    expect(scopedQuery(query, { workspaceScoped: true }, undefined)).toBe(query)
  })
})

describe('isCollectionCacheKey', () => {
  it('recognises the key a collection query actually uses', () => {
    // The pair that would silently drift: the editor stops refreshing its schema the day the key
    // prefix changes and nothing else notices, because the failure is a form that stays empty.
    expect(isCollectionCacheKey(collectionQueryKey({ pluginId: 'github', collectionId: 'pulls' }))).toBe(true)
    expect(isCollectionCacheKey(collectionQueryKey(undefined))).toBe(true)
  })

  it('ignores every other query on the node', () => {
    expect(isCollectionCacheKey(['repos'])).toBe(false)
    expect(isCollectionCacheKey([])).toBe(false)
  })
})
