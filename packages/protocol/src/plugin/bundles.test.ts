import { describe, expect, it } from 'vitest'
import { hasNodeHalf } from './bundles.ts'

describe('device manifest admission', () => {
  it('accepts client-only contributions', () => {
    expect(hasNodeHalf({ client: 'client.js', contributions: { frames: [{ id: 'pane' }], themes: [{ id: 'warm' }] } })).toBe(false)
    expect(hasNodeHalf({ client: 'client.js', contributions: { sources: [{ id: 'board', tree: { list: 'list', detail: 'detail' } }] } })).toBe(false)
  })

  it.each(['node', 'migrations'])('refuses a %s entry', (key) => {
    expect(hasNodeHalf({ [key]: 'entry.js', contributions: {} })).toBe(true)
  })

  it.each(['routes', 'schedules', 'tools', 'agentTools', 'contextSections', 'providers', 'harnesses', 'taskChecks', 'auditActions', 'dataSources', 'dataSourceDiscoveries'])(
    'refuses %s even if an older parser would strip it', (key) => {
      expect(hasNodeHalf({ contributions: { [key]: [{ id: 'x' }] } })).toBe(true)
    },
  )

  it('refuses declared node permissions', () => {
    expect(hasNodeHalf({ permissions: { node: { exec: true } }, contributions: {} })).toBe(true)
  })

  it.each([
    { sources: [{ id: 'board', items: '/v1/p/board/items' }] },
    { slots: [{ id: 'badge', data: '/v1/p/board/badge' }] },
    { nodeStats: [{ id: 'count', data: '/v1/p/board/count' }] },
    { attention: [{ id: 'attention', items: '/v1/p/board/attention' }] },
    { agentContexts: [{ id: 'context', options: '/v1/p/board/options' }] },
    { refResolvers: [{ id: 'refs', resolve: '/v1/p/board/refs' }] },
    { commands: [{ id: 'search', kind: 'search', route: '/v1/p/board/search' }] },
    { frames: [{ id: 'pane', regions: { main: { kind: 'document', read: '/v1/p/board/read' } } }] },
    { extensions: [{ id: 'rows', items: '/v1/p/board/rows' }] },
    { contextMenus: [{ id: 'menu', action: { verb: 'runNodeAction', path: '/v1/p/board/run' } }] },
  ])('refuses route-backed contributions', (contributions) => {
    expect(hasNodeHalf({ client: 'client.js', contributions })).toBe(true)
  })
})
