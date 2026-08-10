import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { memoryIdentityStore } from '@acorn/node-core/main/activeIdentity.ts'
import { createCoreServices, SecretService } from '@acorn/node-core/main/core/index.ts'
import { loadExternalPlugins } from '@acorn/node-core/main/pluginLoader.ts'
import { connectionProviderRegistry } from '@acorn/node-core/server/integrations/connectionRegistry.ts'
import { integrationProviderRegistry } from '@acorn/node-core/server/integrations/registry.ts'
import { CapabilityRegistry } from '@acorn/node-core/server/plugin/capabilities.ts'
import { initPlugins } from '@acorn/node-core/server/plugin/host.ts'
import { makeTestDb, type TestDb } from '@acorn/node-core/testkit/db.ts'
import { assembleNodeGraph } from '../../src/server/composition'

// The dogfood (docs/plugins.md). Rollbar's two halves are built into a real package and loaded off
// disk, which exercises the whole path end to end — manifest, bundles, shape check, permission-shaped
// context, provider registration and descriptor projection — against production plugin code rather
// than a fixture.
const NODE_APP = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

describe('loading rollbar from disk', () => {
  let dataRoot = ''
  let core: TestDb
  let plugins: Awaited<ReturnType<typeof initPlugins>> | null = null

  beforeAll(() => {
    dataRoot = mkdtempSync(join(tmpdir(), 'acorn-dogfood-'))
    core = makeTestDb()
    // The same script a developer runs. Building here rather than committing a fixture bundle keeps
    // the test honest about the CURRENT source of the plugin.
    execFileSync(process.execPath, [join(NODE_APP, 'scripts/build-plugin.mjs'), 'rollbar'], {
      cwd: NODE_APP,
      env: { ...process.env, ACORN_DATA_DIR: dataRoot },
      stdio: 'pipe',
    })
  }, 120_000)

  afterAll(async () => {
    await plugins?.dispose()
    core.cleanup()
    rmSync(dataRoot, { recursive: true, force: true })
  })

  it('loads the built package and registers the portable provider, frame and native source', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const { loaded, failures } = await loadExternalPlugins(dataRoot, { builtins: [] })
      expect(failures).toEqual([])
      expect(loaded.map((entry) => entry.manifest.id)).toEqual(['rollbar'])
      expect(loaded[0].shadowsBuiltin).toBe(false)
      const { installed } = await loadExternalPlugins(dataRoot, { builtins: [] })
      expect(installed[0]?.client).toMatchObject({ hash: expect.stringMatching(/^[0-9a-f]{64}$/) })
      expect(installed[0]?.client?.bytes).toBeGreaterThan(1_000)
      expect(installed[0]?.manifest.contributions).toMatchObject({
        frames: [{ target: 'pane', id: 'rollbar' }],
        sources: [{ id: 'rollbar-items', items: '/v2/p/rollbar/rail-items' }],
      })

      plugins = await initPlugins([loaded[0].plugin], {
        capabilities: new CapabilityRegistry(),
        core: createCoreServices({ secrets: new SecretService('0'.repeat(64)), db: core.db, activeIdentity: memoryIdentityStore() }),
        loaded: new Map([['rollbar', {
          permissions: loaded[0].manifest.permissions.node,
          storage: loaded[0].storage,
        }]]),
      })
      expect(plugins.failed).toEqual([])
      expect(plugins.enabled).toEqual(['rollbar'])
      // Registered through ctx from inside the bundle, into the HOST's registries — the seam that
      // has to work for a loaded plugin to be indistinguishable from a built-in one.
      expect(integrationProviderRegistry.list().map((provider) => provider.id)).toContain('rollbar')
      expect(connectionProviderRegistry.list().map((provider) => provider.id)).toContain('rollbar')
      const providerRoute = integrationProviderRegistry.routes().find((route) => route.providerId === 'rollbar')
      expect(providerRoute?.fetch).toEqual(expect.any(Function))
      expect(providerRoute?.router).toBeUndefined()
      const response = await providerRoute!.fetch!(new Request('http://rollbar.test/items'), {
        userId: 'dogfood-user',
        principal: { kind: 'device', userId: 'dogfood-user', deviceId: 'dogfood-device' },
        providers: {
          connections: async () => [],
          resource: async () => { throw new Error('an empty connection list must not read a resource') },
          withConnections: async () => [],
        },
      })
      expect(response.status).toBe(403)
      expect(await response.json()).toMatchObject({ error: { code: 'provider_not_connected' } })

      const rail = await providerRoute!.fetch!(new Request('http://rollbar.test/rail-items'), {
        userId: 'dogfood-user',
        principal: { kind: 'device', userId: 'dogfood-user', deviceId: 'dogfood-device' },
        providers: {
          connections: async () => [{ id: 'rollbar-production', label: 'Production' } as never],
          resource: async () => ({
            ok: true,
            value: {
              capped: false,
              items: [{
                integrationId: 'rollbar-production', integrationLabel: 'Production', identifier: '142', itemId: '999',
                url: 'https://rollbar.com/item/999/', title: 'Checkout failed', level: 'error', environment: 'production',
                status: 'active', totalOccurrences: 12, firstOccurrenceAt: 1, lastOccurrenceAt: 2,
              }],
            },
          }) as never,
          withConnections: async () => [],
        },
      })
      expect(rail.status).toBe(200)
      expect(await rail.json()).toEqual({
        items: [{
          id: 'rollbar-production:142',
          title: 'Checkout failed',
          subtitle: '#142 · error · production · Production',
          badge: '12 occurrences',
          task: {
            origin: 'rollbar',
            title: 'Checkout failed',
            link: {
              connectionId: 'rollbar-production', identifier: '142',
              ref: { displayId: '142', externalId: '999', url: 'https://rollbar.com/item/999/' },
            },
          },
        }],
      })
    } finally {
      vi.unstubAllEnvs()
      warn.mockRestore()
    }
  })

  it('adds Rollbar to the graph only when the loaded package is installed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const graph = await assembleNodeGraph(dataRoot, {} as never)
      // Exactly one Rollbar in the graph, and it is the contained loaded entry rather than a binary
      // contribution that happens to share its name.
      expect(graph.plugins.filter((plugin) => plugin.name === 'rollbar')).toHaveLength(1)
      expect(graph.loaded.has('rollbar')).toBe(true)
      expect(graph.loaded.get('rollbar')?.permissions.core).toEqual(['projects:read'])
    } finally {
      vi.unstubAllEnvs()
      warn.mockRestore()
    }
  })
})
