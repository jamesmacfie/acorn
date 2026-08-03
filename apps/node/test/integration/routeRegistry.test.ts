import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import '../../src/server/providers'
import '../../src/server/routes'
import { createApp } from '@acorn/node-core/server/index.ts'
import type { AppEnv } from '@acorn/node-core/server/middleware/auth.ts'
import { RouteRegistry, routeMountPath } from '@acorn/node-core/server/routeRegistry.ts'

describe('plugin route registry', () => {
  it('mounts a contribution under its declared plugin namespace', () => {
    const registry = new RouteRegistry()
    const router = new Hono<AppEnv>()
    registry.register({ plugin: 'memory', prefix: '', router })
    registry.register({ plugin: 'github', prefix: '/repos', router })
    expect(registry.list().map(routeMountPath)).toEqual(['/v2/p/memory', '/v2/p/github/repos'])
  })

  it('rejects anything that would escape /v2/p/<plugin>', () => {
    const registry = new RouteRegistry()
    const router = new Hono<AppEnv>()
    // A plugin id is a URL segment, not free text.
    expect(() => registry.register({ plugin: 'My Plugin', prefix: '', router })).toThrow('Plugin route id')
    expect(() => registry.register({ plugin: '', prefix: '', router })).toThrow('Plugin route id')
    // The prefix is relative to the namespace: an absolute-looking or namespace-repeating prefix
    // would still mount *inside* /v2/p/<plugin>, i.e. at a URL nothing requests.
    expect(() => registry.register({ plugin: 'github', prefix: 'repos', router })).toThrow("start with '/'")
    expect(() => registry.register({ plugin: 'github', prefix: '/v2/core/repos', router })).toThrow("must not repeat '/v2'")
    expect(registry.list()).toHaveLength(0)
  })
})

// One representative route per core router mounted by name in createApp(). Together with the plugin
// table below, this file is the proof of the vNext mount shape: core answers under /v2/core, plugins
// under /v2/p/<plugin>, and nothing is left at the V1 /api prefix.
const MOUNTED_CORE_ROUTES: ReadonlyArray<readonly [method: string, path: string]> = [
  ['GET', '/v2/core/me'],
  ['GET', '/v2/core/pins'],
  ['PUT', '/v2/core/prefs'],
  ['GET', '/v2/core/workspaces'],
  ['GET', '/v2/core/workspaces/:id/projects'],
  ['GET', '/v2/core/tasks'],
  ['PATCH', '/v2/core/tasks/:id'],
  ['POST', '/v2/core/tasks/:id/links'],
  ['GET', '/v2/core/tasks/:id/config-trust'],
  ['GET', '/v2/core/tasks/:id/context'], // taskContext
  ['GET', '/v2/core/tasks/:id/run'], // harness
  ['GET', '/v2/core/tasks/:id/tools'], // agentTools — the MCP/harness projection
  ['POST', '/v2/core/tasks/:id/renderer-tools/:name'],
  ['GET', '/v2/core/agent-tools'],
  ['GET', '/v2/core/integrations'],
]

// One representative route per app/server/routes.ts contribution, plus the provider projection.
// Router unit tests cover behavior; this table proves the composition root actually mounts them —
// and it is where the deliberate segment doubling is visible (see the note in routes.ts): a router
// that names its own top-level segment repeats it under its plugin namespace.
const MOUNTED_PLUGIN_ROUTES: ReadonlyArray<readonly [method: string, path: string]> = [
  ['GET', '/v2/p/changes/tasks/:id/review-notes'],
  ['GET', '/v2/p/changes/tasks/:id/local/changes'],
  ['POST', '/v2/p/editor/tasks/:id/search'],
  ['GET', '/v2/p/editor/tasks/:id/editor/root'],
  ['POST', '/v2/p/database/tasks/:id/database/connect'],
  ['GET', '/v2/p/docker/info'],
  ['GET', '/v2/p/http/:owner/:repo/requests'],
  ['GET', '/v2/p/agents/usage'],
  ['GET', '/v2/p/agents/sessions'],
  ['GET', '/v2/p/workflows/tasks/:id/workflows'],
  ['GET', '/v2/p/workflows/workflows/runs/:runId/steps'], // doubled: the router owns '/workflows/*'
  ['GET', '/v2/p/memory/memory'], // doubled: the router owns '/memory'
  ['GET', '/v2/p/memory/tasks/:id/notes'],
  ['GET', '/v2/p/memory/workspaces/:wsId/notes'],
  ['GET', '/v2/p/terminal/terminal/sessions'], // doubled: the router owns '/terminal/*'
  ['GET', '/v2/p/terminal/tasks/:id/mcp'],
  ['GET', '/v2/p/github/repos'],
  ['GET', '/v2/p/github/repos/:owner/:repo/labels'],
  ['GET', '/v2/p/github/repos/:owner/:repo/pulls'],
  ['GET', '/v2/p/github/repos/:owner/:repo/pulls/:number'],
  ['GET', '/v2/p/github/repos/:owner/:repo/pulls/:number/conflicts'],
  ['GET', '/v2/p/github/repos/:owner/:repo/pulls/:number/files'],
  ['GET', '/v2/p/github/repos/:owner/:repo/blobs/:sha'],
  ['POST', '/v2/p/github/repos/:owner/:repo/pulls/batch'],
  ['POST', '/v2/p/github/repos/:owner/:repo/pulls/:number/merge'],
  ['GET', '/v2/p/github/repos/:owner/:repo/actions/runs/:runId/jobs'],
  ['POST', '/v2/p/github/repos/:owner/:repo/pulls'], // prCreate
  ['GET', '/v2/p/github/repos/:owner/:repo/branches'],
  ['GET', '/v2/p/github/repos/:owner/:repo/mentions'],
  ['POST', '/v2/p/github/auth/device/start'],
  ['GET', '/v2/p/linear/projects'],
  ['GET', '/v2/p/rollbar/items'],
]

describe('assembled routes', () => {
  const routes = createApp().routes

  it.each([...MOUNTED_CORE_ROUTES, ...MOUNTED_PLUGIN_ROUTES])('mounts %s %s', (method, path) => {
    expect(routes.some((route) => route.method === method && route.path === path)).toBe(true)
  })

  it('leaves nothing behind on the V1 /api prefix', () => {
    expect(routes.filter((route) => route.path.startsWith('/api'))).toEqual([])
  })
})
