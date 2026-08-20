import { describe, expect, it } from 'vitest'
import { defaultSourceId, sourceRegistry, sourceRouteContributions, taskPathFromSources, taskTracksRef, type SourceContribution } from './sources'
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

// "Is there already a task for this?", the question a reference panel asks before offering to create
// one, and the question that got a wrong answer the first time it was asked.
describe('taskTracksRef', () => {
  const linked = (links: Task['links']): Task => ({ id: 'task-1', links } as Task)

  it('matches a task whose links name the same provider and identifier', () => {
    expect(taskTracksRef(linked([{ connectionId: 'c1', providerId: 'linear', identifier: 'ENG-42' }]), { providerId: 'linear', displayId: 'ENG-42' })).toBe(true)
    expect(taskTracksRef(linked([{ connectionId: 'c1', providerId: 'linear', identifier: 'ENG-42' }]), { providerId: 'linear', displayId: 'ENG-43' })).toBe(false)
    // Same identifier, different provider. `ENG-42` is not a globally unique name and never was.
    expect(taskTracksRef(linked([{ connectionId: 'c1', providerId: 'linear', identifier: 'ENG-42' }]), { providerId: 'board', displayId: 'ENG-42' })).toBe(false)
  })

  it('compares the connection only when both sides carry one', () => {
    const task = linked([{ connectionId: 'c1', providerId: 'linear', identifier: 'ENG-42' }])
    // A panel target from a scanned PR body has no connection, since a body says `ENG-42` rather than
    // which of several connected Linears owns it, so requiring one would find nothing for the commonest
    // case.
    expect(taskTracksRef(task, { providerId: 'linear', displayId: 'ENG-42' })).toBe(true)
    expect(taskTracksRef(task, { providerId: 'linear', displayId: 'ENG-42', connectionId: 'c1' })).toBe(true)
    expect(taskTracksRef(task, { providerId: 'linear', displayId: 'ENG-42', connectionId: 'c2' })).toBe(false)
  })

  // The bug this function exists for. A link-only check isn't enough, because a task can record an
  // external item somewhere other than `links`: a github-pr task keeps its PR as `pullNumber` on the row,
  // and its links hold the Linear tickets found in the PR body. Matching links alone found nothing and
  // the panel offered to create a task that already existed.
  it('asks each source for its own second spelling of the same relationship', () => {
    const task = { id: 'task-1', links: [], pullNumber: 42 } as unknown as Task
    const github = sourceRegistry.register({
      id: 'test.github', order: 1, glyph: 'x', label: 'GitHub',
      tracksRef: (t, ref) => ref.providerId === 'github' && ref.displayId === `runn/acorn#${t.pullNumber}`,
    })
    try {
      expect(taskTracksRef(task, { providerId: 'github', displayId: 'runn/acorn#42' })).toBe(true)
      expect(taskTracksRef(task, { providerId: 'github', displayId: 'runn/acorn#99' })).toBe(false)
      // A source that declines leaves the answer where the host's own link check left it.
      expect(taskTracksRef(task, { providerId: 'linear', displayId: 'ENG-1' })).toBe(false)
    } finally {
      github.dispose()
    }
  })
})
