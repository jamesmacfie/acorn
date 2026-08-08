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
import { connectionProviderRegistry } from '@acorn/node-core/server/integrations/connectionRegistry.ts'
import { integrationProviderRegistry } from '@acorn/node-core/server/integrations/registry.ts'
import { modelProviderRegistry } from '@acorn/node-core/server/modelProviders/registry.ts'
import { makeTestDb, type TestDb } from '@acorn/node-core/testkit/db.ts'
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
  ['GET', '/v2/p/http/projects/:projectId/requests'],
  ['GET', '/v2/p/agents/usage'],
  ['GET', '/v2/p/agents/sessions'],
  ['GET', '/v2/p/workflows/tasks/:id/workflows'], // registered by the plugin's own init
  ['GET', '/v2/p/workflows/workflows/runs/:runId/steps'], // doubled: the router owns '/workflows/*'
  ['GET', '/v2/p/memory/memory'], // doubled: the router owns '/memory'
  ['GET', '/v2/p/notes/tasks/:id/notes'],
  ['GET', '/v2/p/notes/workspaces/:wsId/notes'],
  ['GET', '/v2/p/memory/tasks/:id/notes'],
  ['GET', '/v2/p/memory/workspaces/:wsId/notes'],
  ['GET', '/v2/p/terminal/sessions'], // the terminal router owns the sessions namespace
  ['GET', '/v2/p/terminal/profiles'],
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
  ['GET', '/v2/p/github/pins'],
  ['PUT', '/v2/p/github/pins'],
  ['POST', '/v2/p/github/auth/device/start'],
  ['POST', '/v2/p/github/import'],
  ['GET', '/v2/p/linear/projects'],
  ['GET', '/v2/p/rollbar/items'],
]

describe('assembled routes', () => {
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
        capabilities: new CapabilityRegistry(),
        core: createCoreServices({ secrets: new SecretService('0'.repeat(64)), db: core.db, activeIdentity: memoryIdentityStore() }),
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

  it.each([...MOUNTED_CORE_ROUTES, ...MOUNTED_PLUGIN_ROUTES])('mounts %s %s', (method, path) => {
    expect(routes().some((route) => route.method === method && route.path === path)).toBe(true)
  })

  it('does not mount routes outside the current /v2 namespaces', () => {
    expect(routes().filter((route) => route.path.startsWith('/api'))).toEqual([])
  })

  it('registers every built-in provider from its own plugin, in both registries', () => {
    const expected = ['anthropic', 'github', 'linear', 'openai', 'rollbar']
    expect(connectionProviderRegistry.list().map((p) => p.id).sort()).toEqual(expected)
    // The integration registry holds only providers with mirrored resources — the model providers
    // contribute credentials and adapters, not resources.
    expect(integrationProviderRegistry.list().map((p) => p.id).sort()).toEqual(['github', 'linear', 'rollbar'])
    expect(modelProviderRegistry.list().map((a) => a.providerId).sort()).toEqual(['anthropic', 'openai'])
  })
})
