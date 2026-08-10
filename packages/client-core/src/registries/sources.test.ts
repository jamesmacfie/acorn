import { describe, expect, it } from 'vitest'
import { defaultSourceId, sourceRegistry, sourceRouteContributions, taskPathFromSources, type SourceContribution } from './sources'
import type { Task } from '../queries'

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

  it('orders contributed route shapes by declared order', () => {
    const disposable = sourceRegistry.register({
      id: 'test.routes', order: 1, glyph: 'x', label: 'Routes',
      routes: [
        { id: 'test.detail', path: '/p/:projectId/pulls/:number', order: 30 },
        { id: 'test.create', path: '/p/:projectId/new', order: 20 },
        { id: 'test.project', path: '/p/:projectId', order: 10 },
      ],
    })
    try {
      expect(sourceRouteContributions().map((route) => route.id)).toEqual(['test.project', 'test.create', 'test.detail'])
    } finally {
      disposable.dispose()
    }
  })
})

describe('task paths', () => {
  const task = (id: string): Task => ({ id } as Task)

  it('takes the first source that claims the task', () => {
    const declines = sourceRegistry.register({ id: 'test.declines', order: 1, glyph: 'x', label: 'Declines', taskPath: () => undefined })
    const claims = sourceRegistry.register({ id: 'test.claims', order: 2, glyph: 'x', label: 'Claims', taskPath: (t) => `/claimed/${t.id}` })
    try {
      expect(taskPathFromSources(task('task-1'))).toBe('/claimed/task-1')
    } finally {
      claims.dispose()
      declines.dispose()
    }
  })

  it('leaves an unclaimed task to core', () => {
    const declines = sourceRegistry.register({ id: 'test.declines', order: 1, glyph: 'x', label: 'Declines', taskPath: () => undefined })
    try {
      expect(taskPathFromSources(task('task-1'))).toBeUndefined()
    } finally {
      declines.dispose()
    }
  })
})
