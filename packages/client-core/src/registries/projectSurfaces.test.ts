import { afterEach, describe, expect, it } from 'vitest'
import { pluginProjectRoutePrefix, PROJECT_ROUTE, CREATE_TASK_ROUTE } from './corePaths'
import { decodeProjectSurfaceItem, projectSurfacePath, projectSurfaceRegistry, projectSurfaceRoutes } from './projectSurfaces'

// The address half of a project-scoped plugin surface. What is worth pinning is that the host mints the
// path and the caller only supplies values — a plugin never gets to say where its surface lives.

const surface = (id: string, path: string, item: string, order = 500) =>
  projectSurfaceRegistry.register({ id, path, item, order, component: () => null })

const registered: { dispose(): void }[] = []
const add = (...args: Parameters<typeof surface>) => void registered.push(surface(...args))

afterEach(() => {
  for (const entry of registered.splice(0).reverse()) entry.dispose()
})

describe('the host-minted prefix', () => {
  it('cannot collide with core’s project URLs', () => {
    const prefix = pluginProjectRoutePrefix('linear')
    expect(prefix).toBe('/p/:projectId/x/linear/')
    // `x` is the reserved segment, and these are the two core patterns it has to stay clear of. A plugin
    // route confined to the prefix is longer than both and shares neither's second segment.
    expect(prefix.startsWith(`${PROJECT_ROUTE}/`)).toBe(true)
    expect(prefix.startsWith(CREATE_TASK_ROUTE)).toBe(false)
    // Two plugins cannot collide either: one bundle wins per plugin id, and the id is the whole tail.
    expect(pluginProjectRoutePrefix('rollbar')).not.toBe(prefix)
  })
})

describe('projectSurfacePath', () => {
  it('substitutes the routed project and the addressed item into the registered pattern', () => {
    add('linear-issue', '/p/:projectId/x/linear/issues/:identifier', 'identifier')
    expect(projectSurfacePath('linear-issue', 'project-web', 'ENG-42')).toBe('/p/project-web/x/linear/issues/ENG-42')
  })

  it('encodes both values, so neither can add a path segment', () => {
    add('linear-issue', '/p/:projectId/x/linear/issues/:identifier', 'identifier')
    expect(projectSurfacePath('linear-issue', 'project/web', 'conn-1:ENG-42'))
      .toBe('/p/project%2Fweb/x/linear/issues/conn-1%3AENG-42')
  })

  it('answers null for a surface nothing registered on this device', () => {
    // Not installed on this node, or a bundle this device declined — both reach here, and neither is an
    // error worth throwing at a rail row click.
    expect(projectSurfacePath('linear-issue', 'project-web', 'ENG-42')).toBeNull()
  })
})

describe('decodeProjectSurfaceItem', () => {
  it('round-trips what projectSurfacePath encoded, because the router does not decode params', () => {
    add('linear-issue', '/p/:projectId/x/linear/issues/:identifier', 'identifier')
    const path = projectSurfacePath('linear-issue', 'project-web', 'conn-1:ENG-42')!
    // What Solid Router would hand back as `params.identifier` — the raw URL segment.
    const raw = path.split('/').pop()
    expect(decodeProjectSurfaceItem(raw)).toBe('conn-1:ENG-42')
  })

  it('treats a broken escape from a typed URL as nothing addressed rather than throwing', () => {
    expect(decodeProjectSurfaceItem('%zz')).toBeUndefined()
    expect(decodeProjectSurfaceItem(undefined)).toBeUndefined()
  })
})

describe('projectSurfaceRoutes', () => {
  it('orders by declared order so a static path can be registered ahead of a parameter path', () => {
    add('b-surface', '/p/:projectId/x/board/cards/:key', 'key', 60)
    add('a-surface', '/p/:projectId/x/board/new/:key', 'key', 30)
    expect(projectSurfaceRoutes().map((route) => route.id)).toEqual(['a-surface', 'b-surface'])
  })
})
