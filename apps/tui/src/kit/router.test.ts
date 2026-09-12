import { afterEach, describe, expect, it } from 'vitest'
import { sourceRegistry } from '@acorn/client-core/host/registries/sources/sources.ts'
import { projectSurfaceRegistry } from '@acorn/client-core/host/registries/panes/projectSurfaces.ts'
import { _resetRouter, useMatch, useNavigate, useParams, useSearchParams } from './router'

// The router shim, which is the whole of what `@solidjs/router` is on this host.
//
// No FFI and no renderer: this is a path in a signal matched against the patterns the desktop's Router
// is built from, and every case here is about the answers a pane gets back. What it is *for* is one
// step further out — a browse surface reads its project and its open item off these — and that half is
// the shell's, in ../chrome/routing.ts.

describe('the router shim', () => {
  afterEach(() => _resetRouter())

  it('has no parameters before anything has been navigated to', () => {
    expect(useParams().projectId).toBeUndefined()
  })

  it('reads a core pattern back off the path', () => {
    useNavigate()('/p/proj-1')
    const params = useParams<{ projectId: string }>()
    expect(params.projectId).toBe('proj-1')

    useNavigate()('/t/task-9')
    expect(useParams<{ taskId: string }>().taskId).toBe('task-9')
    // …and the project is gone with the path that carried it, rather than lingering as a stale answer.
    expect(params.projectId).toBeUndefined()
  })

  it('decodes a segment, so a project id with a slash in it survives the round trip', () => {
    useNavigate()(`/p/${encodeURIComponent('owner/repo')}`)
    expect(useParams<{ projectId: string }>().projectId).toBe('owner/repo')
  })

  it('reads a contributed pattern, and prefers a static segment to a parameter that would swallow it', () => {
    const source = sourceRegistry.register({
      id: 'test.router',
      order: 1,
      glyph: 'x',
      label: 'Router',
      routes: [
        { id: 'test.new', path: '/p/:projectId/pulls/new', order: 40 },
        { id: 'test.pull', path: '/p/:projectId/pulls/:number', order: 50 },
      ],
    })
    try {
      const params = useParams<{ projectId: string; number: string }>()

      useNavigate()('/p/proj-1/pulls/42')
      expect(params.projectId).toBe('proj-1')
      expect(params.number).toBe('42')

      // `new` is a route, not a pull number, and it is declared first for exactly this reason. Getting
      // the order wrong would open pull request "new".
      useNavigate()('/p/proj-1/pulls/new')
      expect(params.number).toBeUndefined()
      expect(useMatch(() => '/p/:projectId/pulls/new')()).toBeDefined()
    } finally {
      source.dispose()
    }
  })

  it('reads a project surface pattern, which is the other table a plugin can register one in', () => {
    // A descriptor plugin's surface is not a source route: it registers with the project-surface
    // registry, which the desktop mounts as `<Route>`s of its own. This host had only the source table,
    // so a Linear row navigated to a path nothing matched — the surface never saw its item, and the
    // shell read the path as carrying no project at all (../chrome/routing.ts).
    const surface = projectSurfaceRegistry.register({
      id: 'board-issue',
      path: '/p/:projectId/x/linear/board/:issue',
      item: 'issue',
      order: 10,
      component: () => null,
    })
    try {
      const params = useParams<{ projectId: string; issue: string }>()
      useNavigate()(`/p/proj-1/x/linear/board/${encodeURIComponent('ENG-42')}`)
      expect(params.projectId).toBe('proj-1')
      expect(params.issue).toBe('ENG-42')
    } finally {
      surface.dispose()
    }
  })

  it('reads an empty segment as no segment, which is why a caller must not build one', () => {
    // `/p//42` is not a broken path to this matcher, it is a shorter one: the empty segment falls out
    // of the split and `/p/:projectId` matches with `42` as the project. A caller with no project to
    // put in a URL has to draw no URL rather than an empty slot
    // (plugins/github/src/client/PullList.tsx).
    useNavigate()('/p//42')
    expect(useParams<{ projectId: string }>().projectId).toBe('42')
  })

  it('answers a proxy that tracks, not an object read once', () => {
    // The load-bearing half. Every caller does `const params = useParams()` once in setup and reads a
    // field inside a derivation afterwards, so the reactivity has to be in the property access — an
    // object built at call time would resolve once and never change, which is the inert shim wearing
    // a better disguise.
    const params = useParams<{ projectId: string }>()
    useNavigate()('/p/first')
    expect(params.projectId).toBe('first')
    useNavigate()('/p/second')
    expect(params.projectId).toBe('second')
  })

  it('matches one pattern at a time, and says no to a path of a different shape', () => {
    useNavigate()('/p/proj-1')
    expect(useMatch(() => '/p/:projectId')()).toMatchObject({ params: { projectId: 'proj-1' } })
    expect(useMatch(() => '/t/:taskId')()).toBeUndefined()
    expect(useMatch(() => '/p/:projectId/pulls')()).toBeUndefined()
  })

  it('ignores a number, because there is no history to go back through', () => {
    useNavigate()('/p/proj-1')
    useNavigate()(-1)
    expect(useParams<{ projectId: string }>().projectId).toBe('proj-1')
  })

  it('carries no query string, on purpose', () => {
    useNavigate()('/p/proj-1?base=main')
    const [query, setQuery] = useSearchParams<{ base: string }>()
    expect(query.base).toBeUndefined()
    setQuery({ base: 'other' })
    expect(query.base).toBeUndefined()
    // The path still resolves around it, so a caller that keeps view state in the query on the desktop
    // and in a signal here is not broken by one arriving.
    expect(useParams<{ projectId: string }>().projectId).toBe('proj-1')
  })
})
