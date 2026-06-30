import { describe, expect, it } from 'vitest'
import { parseTabs, repoOf, serializeTabs, type TabsState, withLocation } from './model'

const state: TabsState = {
  tabs: [
    { id: 'a', icon: '◆', path: '/acme/web/1' },
    { id: 'b', icon: '●', path: '/acme/api' },
  ],
  activeId: 'b',
}

describe('parseTabs / serializeTabs', () => {
  it('round-trips a state', () => {
    expect(parseTabs(serializeTabs(state))).toEqual(state)
  })

  it('returns null for missing or garbage input', () => {
    expect(parseTabs(undefined)).toBeNull()
    expect(parseTabs('')).toBeNull()
    expect(parseTabs('not json')).toBeNull()
    expect(parseTabs('{"tabs":[]}')).toBeNull()
    expect(parseTabs('[]')).toBeNull()
  })

  it('drops malformed tabs and falls back the active id when it points nowhere', () => {
    const parsed = parseTabs('{"tabs":[{"id":"a","icon":"◆","path":"/"},{"id":42}],"activeId":"gone"}')
    expect(parsed).toEqual({ tabs: [{ id: 'a', icon: '◆', path: '/' }], activeId: 'a' })
  })
})

describe('withLocation', () => {
  it('updates only the active tab', () => {
    const next = withLocation(state, '/acme/api/9')
    expect(next.tabs[0].path).toBe('/acme/web/1')
    expect(next.tabs[1].path).toBe('/acme/api/9')
  })

  it('returns the same reference when the active path is unchanged', () => {
    expect(withLocation(state, '/acme/api')).toBe(state)
  })
})

describe('repoOf', () => {
  it('extracts owner/repo across path shapes', () => {
    expect(repoOf('/acme/web/1')).toEqual({ owner: 'acme', repo: 'web' })
    expect(repoOf('/acme/web/new')).toEqual({ owner: 'acme', repo: 'web' })
    expect(repoOf('/acme/web')).toEqual({ owner: 'acme', repo: 'web' })
    expect(repoOf('/')).toEqual({ owner: undefined, repo: undefined })
  })
})
