import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { nodePlugins } from '../../src/composition/plugins'
import { createApp } from '@acorn/node-core/server/index.ts'
import { memoryIdentityStore } from '@acorn/node-core/server/activeIdentity.ts'
import { createCoreServices, SecretService } from '@acorn/node-core/server/core/index.ts'
import type { AppEnv } from '@acorn/node-core/server/middleware/auth.ts'
import { CapabilityRegistry } from '@acorn/node-core/server/pluginHost/capabilities.ts'
import { initPlugins } from '@acorn/node-core/server/pluginHost/host.ts'
import { Scheduler, SCHEDULER } from '@acorn/node-core/server/schedules/index.ts'
import { connectionProviderRegistry } from '@acorn/node-core/server/integrations'
import { integrationProviderRegistry } from '@acorn/node-core/server/integrations'
import { modelProviderRegistry } from '@acorn/node-core/server/modelProviders'
import { makeTestDb, type TestDb } from '@acorn/node-core/testkit'
import { RouteRegistry, routeMountPath } from '@acorn/node-core/server/routes/registry.ts'
import { readGolden, writeGolden } from '../helpers/golden'

describe('plugin route registry', () => {
  it('mounts a contribution under its declared plugin namespace', () => {
    const registry = new RouteRegistry()
    const router = new Hono<AppEnv>()
    registry.register({ plugin: 'memory', prefix: '', router })
    registry.register({ plugin: 'github', prefix: '/repos', router })
    expect(registry.list().map(routeMountPath)).toEqual(['/v1/p/memory', '/v1/p/github/repos'])
  })

  it('rejects anything that would escape /v1/p/<plugin>', () => {
    const registry = new RouteRegistry()
    const router = new Hono<AppEnv>()
    // A plugin id is a URL segment, not free text.
    expect(() => registry.register({ plugin: 'My Plugin', prefix: '', router })).toThrow('Plugin route id')
    expect(() => registry.register({ plugin: '', prefix: '', router })).toThrow('Plugin route id')
    // The prefix is relative to the namespace: an absolute-looking or namespace-repeating prefix
    // would still mount *inside* /v1/p/<plugin>, i.e. at a URL nothing requests.
    expect(() => registry.register({ plugin: 'github', prefix: 'repos', router })).toThrow("start with '/'")
    expect(() => registry.register({ plugin: 'github', prefix: '/v1/core/repos', router })).toThrow("must not repeat '/v1'")
    expect(registry.list()).toHaveLength(0)
  })
})

// One representative route per core router mounted by name in createApp(). Together with the plugin
// table below, this file verifies the current mount shape: core answers under /v1/core and plugins under
// /v1/p/<plugin>.
const MOUNTED_CORE_ROUTES: ReadonlyArray<readonly [method: string, path: string]> = [
  // The two pre-auth pairing routes, outside /v1/core because that namespace is the gated one. They
  // are how an unpaired client gets a credential at all (docs/api-reference/transport.md § Request processing).
  ['GET', '/v1/node'],
  ['POST', '/v1/pair'],
  ['POST', '/v1/core/pair/start'],
  ['DELETE', '/v1/core/pair'],
  ['GET', '/v1/core/devices'],
  ['DELETE', '/v1/core/devices/:id'],
  ['PUT', '/v1/core/prefs'],
  ['GET', '/v1/core/workspaces'],
  // Linear/Rollbar projects linked to a workspace, not acorn projects, which live under
  // /v1/core/projects.
  ['GET', '/v1/core/workspaces/:id/external-projects'],
  ['GET', '/v1/core/tasks'],
  ['PATCH', '/v1/core/tasks/:id'],
  ['POST', '/v1/core/tasks/:id/links'],
  ['GET', '/v1/core/tasks/:id/config-trust'],
  ['GET', '/v1/core/task-statuses'],
  ['GET', '/v1/core/projects'],
  ['GET', '/v1/core/projects/:id/config'],
  ['PUT', '/v1/core/projects/:id/config'],
  ['PUT', '/v1/core/projects/:id/run-targets'],
  ['GET', '/v1/core/projects/:id/mcp'],
  ['POST', '/v1/core/projects/:id/mcp/starter'],
  ['POST', '/v1/core/tasks/:id/preview-url'],
  ['POST', '/v1/core/tasks/:id/on-created'],
  ['POST', '/v1/core/tasks/:id/archive'],
  ['GET', '/v1/core/tasks/:id/context'], // taskContext
  ['GET', '/v1/core/tasks/:id/run'], // harness
  ['GET', '/v1/core/tasks/:id/tools'], // agentTools — the MCP/harness projection
  ['POST', '/v1/core/tasks/:id/renderer-tools/:name'],
  ['GET', '/v1/core/agent-tools'],
  ['GET', '/v1/core/integrations'],
  ['POST', '/v1/core/telemetry'], // the batch route every runtime that is not the node posts to
  ['GET', '/v1/core/telemetry/summary'], // what Settings → Telemetry draws (docs/telemetry.md)
]

// Every route the compiled plugins mount, as a golden snapshot in routeRegistry.snapshot.json;
// docs/plugins.md § The golden lists covers the mechanism and why it's exact equality now instead of
// a representative `some()` check per contribution. The segment doubling is visible here too
// (docs/api-reference/plugin-routes.md § Plugin routes): a router that names its own top-level segment repeats it
// under its plugin namespace, e.g. `/v1/p/memory/memory`.
//
// Duplicates are kept rather than deduped. Several github routers register under one path with
// different handlers, and collapsing them would stop the list noticing nine of them disappearing.
//
// What's not in here, and would be a real change if it appeared: any route from a loaded package.
// Linear's and http's routes left when those plugins did; a loaded plugin's routes reach the mount
// table through the loader's fetch carrier (docs/plugins.md § Loaded plugins), which this suite
// doesn't assemble. `pluginLoader.test.ts` exercises a loaded plugin's routes, `httpLoaded.test.ts`
// drives http's through that carrier, and `linear.test.ts` drives linear's router directly.
const PLUGIN_ROUTES = join(import.meta.dirname, 'routeRegistry.snapshot.json')

describe('assembled routes', () => {
  // A plugin that declares periodic work resolves the scheduler through the capability registry at
  // registration time, so a graph assembled without one throws; both composition roots provide it
  // before initPlugins for that reason (docs/schedules.md § Why the node, and only the node). Never
  // started: this suite asserts the mount table, and a running loop would fire jobs at a temp data
  // root while the assertions run.
  const schedulerCapable = (capabilities: CapabilityRegistry, db: TestDb['db']): CapabilityRegistry => {
    capabilities.provide(SCHEDULER, new Scheduler(db))
    return capabilities
  }

  let core: TestDb
  let dataDir: string
  let plugins: Awaited<ReturnType<typeof initPlugins>>
  beforeAll(async () => {
    core = makeTestDb()
    dataDir = mkdtempSync(join(tmpdir(), 'acorn-routes-'))
    plugins = await initPlugins(
      nodePlugins(dataDir, {
        // agents is `required` too, so it initializes here as well, the same treatment as terminal
        // below: the deps are inert because this suite asserts the mount table and nothing it
        // exercises starts a provider child.
        agents: { internalEnv: () => ({}), reconciled: Promise.resolve() },
        notes: { internalEnv: () => ({}) },
        // terminal is required; nothing in this suite spawns a pseudo-terminal.
        terminal: {
          internalEnv: () => ({}),
          reconciled: Promise.resolve(),
        },
        // This suite asserts the mount table, so nothing here starts a workflow run.
        workflows: {
          internalEnv: () => ({}),
          reconciled: Promise.resolve(),
        },
      }),
      {
        capabilities: schedulerCapable(new CapabilityRegistry(), core.db),
        core: createCoreServices({ secrets: new SecretService('0'.repeat(64)), db: core.db, activeIdentity: memoryIdentityStore() }),
        dataDir,
      },
    )
  })
  // Disposed, not just cleaned up: the terminal plugin opens a WAL-mode SQLite file and starts an
  // idle-watch interval, and the plugin databases have to be closed before their temp dir is removed.
  afterAll(async () => {
    await plugins.dispose()
    core.cleanup()
    rmSync(dataDir, { recursive: true, force: true })
  })

  const routes = () => createApp().routes

  it.each(MOUNTED_CORE_ROUTES)('mounts %s %s', (method, path) => {
    expect(routes().some((route) => route.method === method && route.path === path)).toBe(true)
  })

  it('mounts exactly the plugin routes in the golden list', () => {
    const actual = routes()
      .filter((route) => route.path.startsWith('/v1/p/'))
      .map((route) => `${route.method} ${route.path}`)
      .sort()
    writeGolden(PLUGIN_ROUTES, actual)
    // Anti-vacuity: the assertion below is an exact match against a file, so a boot that mounted
    // nothing would pass against an empty golden. A floor, not a count: the compiled tier shrinks by
    // design, so this comes down as plugins ship loaded instead.
    expect(actual.length).toBeGreaterThanOrEqual(30)
    expect(actual).toEqual(readGolden<string[]>(PLUGIN_ROUTES))
  })

  it('does not mount routes outside the current /v1 namespaces', () => {
    expect(routes().filter((route) => route.path.startsWith('/api'))).toEqual([])
  })

  it('registers every built-in provider from its own plugin, in both registries', () => {
    // One left: github is the only provider still compiled in. linear, openai and anthropic all come
    // from loaded packages, and this suite assembles the compiled list only, so their absence is the
    // assertion; any of them appearing would mean something in the binary had started registering a
    // provider again.
    const expected = ['github']
    expect(connectionProviderRegistry.list().map((p) => p.id).sort()).toEqual(expected)
    // The integration registry holds only providers with mirrored resources (docs/integrations.md §
    // Connection and integration contributions). github has them, so the two lists coincide. They are
    // asserted separately because a connection provider need not be an integration one.
    expect(integrationProviderRegistry.list().map((p) => p.id).sort()).toEqual(expected)
    expect(modelProviderRegistry.list().map((a) => a.providerId).sort()).toEqual([])
  })
})
