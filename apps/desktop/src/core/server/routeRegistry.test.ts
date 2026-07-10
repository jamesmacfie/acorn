import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import '../../app/server/providers'
import '../../app/server/routes'
import { createApp } from './index'
import type { AppEnv } from './middleware/auth'
import { RouteRegistry } from './routeRegistry'

describe('plugin route registry', () => {
  it('accepts only prefixes covered by the global /api auth and CSRF middleware', () => {
    const registry = new RouteRegistry()
    const router = new Hono<AppEnv>()
    registry.register({ prefix: '/api', router })
    registry.register({ prefix: '/api/tasks', router })
    expect(registry.list()).toHaveLength(2)

    expect(() => registry.register({ prefix: '/auth/plugin', router })).toThrow('authenticated /api namespace')
    expect(() => registry.register({ prefix: '/apiary', router })).toThrow('authenticated /api namespace')
    expect(() => registry.register({ prefix: '/', router })).toThrow('authenticated /api namespace')
  })
})

// One representative route per app/server/routes.ts contribution, plus the provider projection.
// Router unit tests cover behavior; this table proves the composition root actually mounts them.
const MOUNTED_PLUGIN_ROUTES: ReadonlyArray<readonly [method: string, path: string]> = [
  ['GET', '/api/tasks/:id/review-notes'],
  ['POST', '/api/tasks/:id/search'],
  ['GET', '/api/tasks/:id/editor/root'],
  ['GET', '/api/tasks/:id/local/changes'],
  ['POST', '/api/tasks/:id/database/connect'],
  ['GET', '/api/tasks/:id/workflows'],
  ['GET', '/api/memory'],
  ['GET', '/api/terminal/sessions'],
  ['GET', '/api/repos'],
  ['GET', '/api/repos/:owner/:repo/labels'],
  ['GET', '/api/repos/:owner/:repo/pulls'],
  ['GET', '/api/repos/:owner/:repo/pulls/:number'],
  ['GET', '/api/repos/:owner/:repo/pulls/:number/files'],
  ['GET', '/api/repos/:owner/:repo/blobs/:sha'],
  ['POST', '/api/repos/:owner/:repo/pulls/batch'],
  ['POST', '/api/repos/:owner/:repo/pulls/:number/merge'],
  ['GET', '/api/repos/:owner/:repo/actions/runs/:runId/jobs'],
  ['GET', '/api/repos/:owner/:repo/branches'],
  ['GET', '/api/repos/:owner/:repo/mentions'],
  ['GET', '/api/linear/projects'],
  ['GET', '/api/rollbar/items'],
]

describe('assembled plugin routes', () => {
  const routes = createApp().routes

  it.each(MOUNTED_PLUGIN_ROUTES)('mounts %s %s', (method, path) => {
    expect(routes.some((route) => route.method === method && route.path === path)).toBe(true)
  })
})
