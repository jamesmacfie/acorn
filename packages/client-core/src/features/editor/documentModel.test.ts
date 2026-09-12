import { describe, expect, it } from 'vitest'
import {
  clearDocumentViewStates,
  documentUri,
  documentViewState,
  evictDocumentViewStates,
  rememberDocumentViewState,
  resolveDocumentRoute,
} from './documentModel'

// The surface itself is a component and this repo's vitest runs in node with no Solid plugin, so the
// two things that can actually be wrong live here: what URL the host fetches on a plugin's behalf,
// and whether host-owned view state survives (and stops surviving) the right scope changes.

describe('resolveDocumentRoute', () => {
  it('substitutes only the two parameters the host holds', () => {
    expect(resolveDocumentRoute('/v2/p/db/tasks/:taskId/scratch', { taskId: 't1' }))
      .toBe('/v2/p/db/tasks/t1/scratch')
    expect(resolveDocumentRoute('/v2/p/db/projects/:projectId/doc', { projectId: 'p1' }))
      .toBe('/v2/p/db/projects/p1/doc')
    // Anything else in the path is the plugin's own business and is left alone.
    expect(resolveDocumentRoute('/v2/p/db/:sheet/rows', { taskId: 't1' })).toBe('/v2/p/db/:sheet/rows')
  })

  it('refuses rather than fetching a URL with a literal :taskId in it', () => {
    expect(resolveDocumentRoute('/v2/p/db/tasks/:taskId/scratch', { projectId: 'p1' })).toBeNull()
    expect(resolveDocumentRoute('/v2/p/db/projects/:projectId/doc', { taskId: 't1' })).toBeNull()
  })

  it('encodes the value, so a substitution cannot walk out of the plugin namespace', () => {
    // This is what keeps the parse-time confinement check true at runtime.
    expect(resolveDocumentRoute('/v2/p/db/tasks/:taskId/doc', { taskId: '../../core/tasks' }))
      .toBe('/v2/p/db/tasks/..%2F..%2Fcore%2Ftasks/doc')
    expect(resolveDocumentRoute('/v2/p/db/tasks/:taskId/doc', { taskId: '$&' }))
      .toBe('/v2/p/db/tasks/%24%26/doc')
  })

  it('does not match a longer parameter that merely starts the same way', () => {
    expect(resolveDocumentRoute('/v2/p/db/:taskIdentifier/doc', { taskId: 't1' }))
      .toBe('/v2/p/db/:taskIdentifier/doc')
  })
})

describe('view state', () => {
  it('is keyed by node and scope, so switching back restores where the reader was', () => {
    clearDocumentViewStates()
    const uri = documentUri('database', 'db')
    rememberDocumentViewState('node-a', 'task-1', uri, { scroll: 10 })
    rememberDocumentViewState('node-b', 'task-1', uri, { scroll: 20 })
    expect(documentViewState('node-a', 'task-1', uri)).toEqual({ scroll: 10 })
    expect(documentViewState('node-b', 'task-1', uri)).toEqual({ scroll: 20 })
    expect(documentViewState('node-a', 'task-2', uri)).toBeUndefined()
  })

  it('evicts a scope across EVERY node, because archival is final', () => {
    // A key left behind under another node's prefix would never be reached again.
    clearDocumentViewStates()
    const uri = documentUri('database', 'db')
    rememberDocumentViewState('node-a', 'task-1', uri, { scroll: 10 })
    rememberDocumentViewState('node-b', 'task-1', uri, { scroll: 20 })
    rememberDocumentViewState('node-a', 'task-2', uri, { scroll: 30 })
    evictDocumentViewStates('task-1')
    expect(documentViewState('node-a', 'task-1', uri)).toBeUndefined()
    expect(documentViewState('node-b', 'task-1', uri)).toBeUndefined()
    expect(documentViewState('node-a', 'task-2', uri)).toEqual({ scroll: 30 })
  })

  it('gives each surface its own document identity', () => {
    expect(documentUri('database', 'db')).not.toBe(documentUri('database', 'scratch'))
    expect(documentUri('database', 'db')).not.toBe(documentUri('graphql', 'db'))
  })
})
