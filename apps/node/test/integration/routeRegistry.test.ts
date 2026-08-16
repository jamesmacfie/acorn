import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { nodePlugins } from '../../src/server/plugins'
import { createApp } from '@acorn/node-core/server/index.ts'
import { memoryIdentityStore } from '@acorn/node-core/main/activeIdentity.ts'
import { createCoreServices, SecretService } from '@acorn/node-core/main/core/index.ts'
import type { AppEnv } from '@acorn/node-core/server/middleware/auth.ts'
import { CapabilityRegistry } from '@acorn/node-core/server/plugin/capabilities.ts'
import { initPlugins } from '@acorn/node-core/server/plugin/host.ts'
import { Scheduler, SCHEDULER } from '@acorn/node-core/server/schedules/index.ts'
import { connectionProviderRegistry } from '@acorn/node-core/server/integrations/connectionRegistry.ts'
import { integrationProviderRegistry } from '@acorn/node-core/server/integrations/registry.ts'
import { modelProviderRegistry } from '@acorn/node-core/server/modelProviders/registry.ts'
import { makeTestDb, type TestDb } from '@acorn/node-core/testkit/db.ts'
import { RouteRegistry, routeMountPath } from '@acorn/node-core/server/routeRegistry.ts'
import { readGolden, writeGolden } from './golden'

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
// table below, this file verifies the current mount shape: core answers under /v2/core and plugins under
// /v2/p/<plugin>.
const MOUNTED_CORE_ROUTES: ReadonlyArray<readonly [method: string, path: string]> = [
  // The two pre-auth pairing routes. Core-owned but deliberately outside /v2/core, because that
  // namespace is the gated one and these are how an unpaired client gets a credential at all.
  ['GET', '/v2/node'],
  ['POST', '/v2/pair'],
  ['POST', '/v2/core/pair/start'],
  ['DELETE', '/v2/core/pair'],
  ['GET', '/v2/core/devices'],
  ['DELETE', '/v2/core/devices/:id'],
  ['PUT', '/v2/core/prefs'],
  ['GET', '/v2/core/workspaces'],
  // Linear/Rollbar projects linked to a workspace — NOT acorn projects, which live under /v2/core/projects.
  ['GET', '/v2/core/workspaces/:id/external-projects'],
  ['GET', '/v2/core/tasks'],
  ['PATCH', '/v2/core/tasks/:id'],
  ['POST', '/v2/core/tasks/:id/links'],
  ['GET', '/v2/core/tasks/:id/config-trust'],
  ['GET', '/v2/core/task-statuses'],
  ['GET', '/v2/core/projects'],
  ['GET', '/v2/core/projects/:id/config'],
  ['PUT', '/v2/core/projects/:id/config'],
  ['PUT', '/v2/core/projects/:id/run-targets'],
  ['POST', '/v2/core/tasks/:id/preview-url'],
  ['POST', '/v2/core/tasks/:id/on-created'],
  ['POST', '/v2/core/tasks/:id/archive'],
  ['GET', '/v2/core/tasks/:id/mcp'],
  ['POST', '/v2/core/tasks/:id/mcp/starter'],
  ['GET', '/v2/core/tasks/:id/context'], // taskContext
  ['GET', '/v2/core/tasks/:id/run'], // harness
  ['GET', '/v2/core/tasks/:id/tools'], // agentTools — the MCP/harness projection
  ['POST', '/v2/core/tasks/:id/renderer-tools/:name'],
  ['GET', '/v2/core/agent-tools'],
  ['GET', '/v2/core/integrations'],
]

// Every route the compiled plugins mount, as a GOLDEN LIST in `routeRegistry.snapshot.json` — see
// ./golden.ts for the one command that regenerates it. This used to be one hand-typed REPRESENTATIVE route
// per contribution, checked with `some()`; it is the whole mount table now, checked with exact equality, so
// it caught a table going stale in one direction only and now catches both. It is also where the deliberate
// segment doubling is visible (see the note in routes.ts): a router that names its own top-level segment
// repeats it under its plugin namespace, e.g. `/v2/p/memory/memory`.
//
// Duplicates are kept rather than deduped. Several github routers register under one path with different
// handlers, and collapsing them would stop the list noticing nine of them disappearing.
//
// What is NOT in here, and would be a real change if it appeared: any route from a LOADED package. Linear's
// `/v2/p/linear/projects` and http's `/v2/p/http/projects/:projectId/requests` both left when their plugins
// did — their routes reach the mount table through the loader's fetch carrier, which this suite does not
// assemble. `pluginLoader.test.ts` is where a loaded plugin's routes are exercised, `httpLoaded.test.ts`
// drives http's through the carrier the host actually uses, and `linear.test.ts` drives linear's router
// directly.
const PLUGIN_ROUTES = 'routeRegistry.snapshot.json'

describe('assembled routes', () => {
  // A plugin that declares periodic work resolves the scheduler through the capability registry at
  // registration time, so a graph assembled without one throws — which is what both composition roots
  // already avoid by providing it before initPlugins. Never started: this suite asserts the MOUNT TABLE,
  // and a running loop would fire jobs at a temp data root while the assertions run.
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
        // agents is `required` too, so it initializes here as well. Same treatment as terminal below: the
        // deps are inert, because this suite asserts the MOUNT TABLE and nothing it exercises starts a
        // provider child.
        agents: { internalEnv: () => ({}) },
        // Inert: this suite asserts the MOUNT TABLE, and preview contributes agent tools, not routes.
        preview: { browser: {} as never },
        notes: { internalEnv: () => ({}) },
        // terminal is `required`, so it initializes here whatever this test asks for. Its four
        // composition-root deps are inert stubs: this suite asserts the MOUNT TABLE, and nothing it
        // exercises spawns a pseudo-terminal.
        terminal: {
          internalEnv: () => ({}),
          launchInjector: async () => {},
          memoryReviewTrigger: async () => {},
          reconciled: Promise.resolve(),
        },
        // Same treatment: this suite asserts the MOUNT TABLE, so nothing here starts a run. `failingChecks`
        // answers null — "no PR to check" — which is the honest inert value rather than a fake green.
        workflows: {
          internalEnv: () => ({}),
          reconciled: Promise.resolve(),
          failingChecks: async () => null,
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
      .filter((route) => route.path.startsWith('/v2/p/'))
      .map((route) => `${route.method} ${route.path}`)
      .sort()
    writeGolden(PLUGIN_ROUTES, actual)
    // Anti-vacuity: the assertion below is an exact match against a file, so a boot that mounted nothing
    // would pass against an empty golden. A floor rather than a count — the compiled tier shrinks by
    // decision, so this comes down as plugins ship loaded instead.
    expect(actual.length).toBeGreaterThanOrEqual(30)
    expect(actual).toEqual(readGolden<string[]>(PLUGIN_ROUTES))
  })

  it('does not mount routes outside the current /v2 namespaces', () => {
    expect(routes().filter((route) => route.path.startsWith('/api'))).toEqual([])
  })

  it('registers every built-in provider from its own plugin, in both registries', () => {
    // One left. github is the only provider still compiled in; linear, openai and anthropic all come
    // from loaded packages, and this suite assembles the COMPILED list only — so their absence is the
    // assertion, and any of them appearing would mean something in the binary had started registering
    // a provider again.
    const expected = ['github']
    expect(connectionProviderRegistry.list().map((p) => p.id).sort()).toEqual(expected)
    // The integration registry holds only providers with mirrored resources. github happens to have
    // them, so the two lists coincide today; they are still asserted separately because a connection
    // provider need not be an integration one.
    expect(integrationProviderRegistry.list().map((p) => p.id).sort()).toEqual(expected)
    expect(modelProviderRegistry.list().map((a) => a.providerId).sort()).toEqual([])
  })
})
