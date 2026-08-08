import { describe, expect, it } from 'vitest'
import { defaultSourceId, sourcePath, sourceRegistry, sourceRouteContributions, sourceRoutePath, type SourceContribution } from './sources'

const source = (id: string, order: number, isDefault?: boolean): SourceContribution => ({
  id,
  order,
  glyph: 'x',
  label: id,
  ...(isDefault ? { isDefault } : {}),
})

describe('source defaults', () => {
  it('prefers the declared default over a lower-order source', () => {
    const lower = sourceRegistry.register(source('test.source.lower', 1))
    const declared = sourceRegistry.register(source('test.source.default', 50, true))
    try {
      expect(defaultSourceId()).toBe('test.source.default')
    } finally {
      declared.dispose()
      lower.dispose()
    }
  })

  it('falls back to declared rail order when no source is marked default', () => {
    const later = sourceRegistry.register(source('test.source.later', 20))
    const earlier = sourceRegistry.register(source('test.source.earlier', 10))
    try {
      expect(defaultSourceId()).toBe('test.source.earlier')
    } finally {
      earlier.dispose()
      later.dispose()
    }
  })

  it('orders contributed route shapes by declared order and composes parameters generically', () => {
    const disposable = sourceRegistry.register({
      id: 'test.routes', order: 1, glyph: 'x', label: 'Routes',
      routes: [
        { id: 'test.detail', path: '/p/:projectId/pulls/:number', kind: 'detail', order: 30 },
        { id: 'test.create', path: '/p/:projectId/new', kind: 'create', order: 20 },
        { id: 'test.project', path: '/p/:projectId', kind: 'project', order: 10 },
      ],
    })
    try {
      expect(sourceRouteContributions().map((route) => route.id)).toEqual(['test.project', 'test.create', 'test.detail'])
      expect(sourceRoutePath('create')).toBe('/p/:projectId/new')
      expect(sourcePath('detail', { projectId: 'project-web', number: 42 })).toBe('/p/project-web/pulls/42')
    } finally {
      disposable.dispose()
    }
  })
})
