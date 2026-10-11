import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '@acorn/node-core/server/index.ts'
import { requireDevice, requireProviderAccess, requireTaskScope } from '@acorn/node-core/server/middleware/requireUser.ts'
import { PLUGIN_NAMESPACE } from '@acorn/node-core/server/routes/registry.ts'
import { mountCovers, registeredHandler } from '@acorn/node-core/testkit'
import { initCompiledPlugins } from '../helpers/compiledPlugins'

// The compiled plugins' version of packages/node-core/src/server/mountCoverage.test.ts. A task's agent
// holds a token that `requireUser` accepts, so every plugin route is open to it unless something says
// otherwise. Two reviews found a plugin route whose device gate depended on how the pinned Hono
// matches a trailing `/*`. This test reads the assembled mount table and fails unless each route
// under /v1/p is gated or named below with the reason it's open.
//
// A route counts as gated when, before its handler, one of these covers it:
// - a core gate mounted with `.use()`, including core's task-scope mount over `/v1/p/:plugin/tasks/:id`
// - a core gate registered on the route itself, as in `.put('/pricing', requireDevice, ...)`
// - a plugin ownership mount named in OWNERSHIP_GATES
//
// It reads only routers registered with `ctx.routes.register`. A fetch handler, which every loaded
// plugin uses, and a `lazyRouter` mount are opaque here: each checks its caller inside the handler.

// Plugin middleware that resolves the task behind an id in the path and refuses a caller that may not
// act on it. Named by mount path, because each plugin builds its own.
const OWNERSHIP_GATES: Record<string, string> = {
  // The bare form also covers `GET /sessions/search`, which this gate skips. That handler confines
  // its own filter to the caller's task.
  '/v1/p/agents/sessions/:sessionId': 'ownsSession resolves the session\'s task',
  '/v1/p/agents/sessions/:sessionId/*': 'ownsSession resolves the session\'s task',
  '/v1/p/agents/attachments/:attachmentId': 'resolves the attachment\'s task',
  '/v1/p/agents/attachments/:attachmentId/*': 'resolves the attachment\'s task',
  '/v1/p/agents/artifacts/:artifactId': 'resolves the artifact\'s task',
  '/v1/p/agents/artifacts/:artifactId/*': 'resolves the artifact\'s task',
  // Terminal has no route at the bare `/sessions/:sid`, so the `/*` form covers everything.
  '/v1/p/terminal/sessions/:sid/*': 'ownsSession resolves the terminal session\'s task',
  '/v1/p/workflows/workflows/runs/:runId': 'ownsRun resolves the run\'s task',
  '/v1/p/workflows/workflows/runs/:runId/*': 'ownsRun resolves the run\'s task',
}

// Reachable by a task's agent on purpose. `${METHOD} ${path}` exactly as the app registers it.
const OPEN_TO_A_TASK_TOKEN: Record<string, string> = {
  // Filtered to the caller's own task in the handler.
  'GET /v1/p/agents/sessions': 'confineFilter pins the list to the caller\'s task',
  'GET /v1/p/terminal/sessions': 'filtered by mayActOnTask',
  'GET /v1/p/memory/memory': 'readMemory holds a task caller to its task\'s project',
  'GET /v1/p/memory/memory/search': 'readMemory holds a task caller to its task\'s project',

  // The task is in the body or query, so no mount can see it. The handler checks it.
  'POST /v1/p/agents/attachments': 'checks the taskId query with mayActOnTask',

  // Refused to a task's agent in the handler.
  'GET /v1/p/agents/runs': 'answers 403 to a task-confined caller',
  'GET /v1/p/workflows/runs': 'answers 403 to a task-confined caller',
  'GET /v1/p/workflows/sessions/:sessionId/run': 'answers 403 to a task-confined caller',

  // The token, not the body, names the task and session, and only a session-bound task token is answered.
  'POST /v1/p/agents/loop-hook': 'answers only the task and session its token names',

  // The owner's own settings, read only. Every write beside them is device-only.
  'GET /v1/p/agents/pricing': 'owner settings, read only; the write is device-only',
  'GET /v1/p/agents/concurrency': 'owner settings, read only; the write is device-only',
  'GET /v1/p/agents/session-defaults': 'owner settings, read only; the write is device-only',
  'GET /v1/p/agents/custom-agents': 'owner settings, read only; the writes are device-only',
  'GET /v1/p/github/pins': 'the owner\'s pinned repository ids; the write is device-only',
  'GET /v1/p/agents/usage': 'the owner\'s plan usage, read only',
  'POST /v1/p/agents/usage/refresh': 're-reads the owner\'s plan usage and changes nothing',
  'POST /v1/p/agents/usage/refresh/:providerId': 're-reads one provider\'s plan usage and changes nothing',
  'GET /v1/p/terminal/profiles': 'shell profile labels and availability, no task data',
}

// Routes that run a command as the person, outside any agent's sandbox. A task-scope gate isn't enough
// for these: a task token with a read-only ceiling started run targets and opened terminals through
// them, skipping the tool permissions and signed ceiling the run_* tools apply. Each must sit behind
// requireDevice, as a mount or on the route.
const EXECUTION_ROUTES = [
  'POST /v1/core/tasks/:id/run/:target/start',
  'POST /v1/core/tasks/:id/run/:target/stop',
  'POST /v1/core/tasks/:id/run/:target/restart',
  'POST /v1/core/tasks/:id/preview-url',
  'POST /v1/core/tasks/:id/on-created',
  'POST /v1/core/tasks/:id/config-trust',
  'POST /v1/p/terminal/sessions',
  'POST /v1/p/terminal/sessions/:sid/send',
  'POST /v1/p/terminal/tasks/:taskId/setup',
]

describe('compiled plugin mount coverage', () => {
  let plugins: { dispose(): Promise<void> }
  beforeAll(async () => { plugins = await initCompiledPlugins() })
  afterAll(async () => plugins.dispose())

  const CORE_GATES = new Set<unknown>([requireDevice, requireProviderAccess, requireTaskScope])
  const table = () => {
    const routes = createApp().routes.map((route, index) => ({ ...route, handler: registeredHandler(route.handler), index }))
    const gates = routes.filter((r) => CORE_GATES.has(r.handler) || (r.method === 'ALL' && OWNERSHIP_GATES[r.path]))
    const pluginRoutes = routes.filter((r) => r.method !== 'ALL' && r.path.startsWith(`${PLUGIN_NAMESPACE}/`) && !CORE_GATES.has(r.handler))
    const gated = (route: { method: string; path: string; index: number }) => gates.some((gate) =>
      gate.index < route.index && (gate.method === 'ALL' || gate.method === route.method) && mountCovers(gate.path, route.path))
    return { routes, gates, pluginRoutes, gated }
  }

  it('the plugins really are mounted, so an empty pass cannot look like a green one', () => {
    const { pluginRoutes, gates } = table()
    expect(pluginRoutes.length).toBeGreaterThan(200)
    expect(gates.length).toBeGreaterThan(40)
  })

  it('every plugin route is gated or named as open to a task token', () => {
    const { pluginRoutes, gated } = table()
    const ungated = pluginRoutes
      .filter((r) => !gated(r))
      .map((r) => `${r.method} ${r.path}`)
      .filter((key) => !OPEN_TO_A_TASK_TOKEN[key])
    expect([...new Set(ungated)].sort()).toEqual([])
  })

  it('the open list has no stale entries', () => {
    const { pluginRoutes, gated } = table()
    const live = new Map(pluginRoutes.map((r) => [`${r.method} ${r.path}`, r]))
    const gone = Object.keys(OPEN_TO_A_TASK_TOKEN).filter((key) => !live.has(key) || gated(live.get(key)!))
    expect(gone.sort()).toEqual([])
  })

  it('every route that runs a command is device-only', () => {
    const { routes } = table()
    const deviceGates = routes.filter((r) => r.handler === requireDevice)
    const deviceOnly = (key: string) => routes.some((route) => `${route.method} ${route.path}` === key && route.handler !== requireDevice
      && deviceGates.some((gate) => gate.index < route.index && (gate.method === 'ALL' || gate.method === route.method) && mountCovers(gate.path, route.path)))
    expect(EXECUTION_ROUTES.filter((key) => !deviceOnly(key))).toEqual([])
  })

  it('every named ownership gate is mounted as plugin middleware', () => {
    const { routes } = table()
    const mounted = new Set(routes.filter((r) => r.method === 'ALL' && !CORE_GATES.has(r.handler)).map((r) => r.path))
    expect(Object.keys(OWNERSHIP_GATES).filter((path) => !mounted.has(path))).toEqual([])
  })
})
