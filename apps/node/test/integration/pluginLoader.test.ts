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

// The dogfood (docs/plugins.md). Rollbar's node half is built to a
// real bundle and loaded off disk, which exercises the whole path end to end — manifest, import,
// shape check, permission-shaped context, provider registration — against first-party code rather
// than a fixture. It is the only test here that proves a real plugin survives the round trip.
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

  it('loads the built bundle and registers rollbar exactly as the compiled-in build does', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const { loaded, failures } = await loadExternalPlugins(dataRoot, { builtins: ['rollbar'] })
      expect(failures).toEqual([])
      expect(loaded.map((entry) => entry.manifest.id)).toEqual(['rollbar'])
      // It replaces the built-in rather than colliding with it — a dev boot runs the disk copy, which
      // is the whole point of dogfooding.
      expect(loaded[0].shadowsBuiltin).toBe(true)
      // It also appears in the distribution enumeration, with nothing to distribute: build-plugin.mjs
      // builds a node half only. Rollbar's client half is compiled into the app and is not a
      // self-contained sandbox bundle, so a `client` entry here would advertise something phase 3
      // could not run (docs/plugins.md).
      const { installed } = await loadExternalPlugins(dataRoot, { builtins: ['rollbar'] })
      expect(installed.map((entry) => [entry.manifest.id, entry.client])).toEqual([['rollbar', null]])

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
    } finally {
      vi.unstubAllEnvs()
      warn.mockRestore()
    }
  })

  it('drops the compiled-in rollbar from the graph when the disk copy wins', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const graph = await assembleNodeGraph(dataRoot, {} as never)
      // Exactly one rollbar in the graph. Two would fail initPlugins' duplicate-name guard, and
      // silently keeping the built-in would make the dogfood prove nothing.
      expect(graph.plugins.filter((plugin) => plugin.name === 'rollbar')).toHaveLength(1)
      expect(graph.loaded.has('rollbar')).toBe(true)
    } finally {
      vi.unstubAllEnvs()
      warn.mockRestore()
    }
  })
})
