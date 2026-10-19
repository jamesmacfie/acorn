// A loaded plugin whose worker dies after it started. Its routes must go and its roster row must say
// why, instead of every request answering a bare 500 from a closed worker.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Hono } from 'hono'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { memoryIdentityStore } from '../activeIdentity'
import { createCoreServices, SecretService } from '../core'
import { makeTestDb, testCoreSeams } from '../../testkit/db'
import { testGate } from '../../testkit/auth'
import type { Env } from '../bindings'
import type { AppEnv } from '../middleware/auth'
import { PLUGIN_NAMESPACE } from '../routes/registry'
import { CapabilityRegistry } from '../pluginHost/capabilities'
import { dispatchPluginFetch } from '../pluginHost/fetchRoute'
import { clearRegistrations, initPlugins } from '../pluginHost/host'
import { isolateNodePlugin } from './isolation'
import type { NodePermissions } from './manifest'

const PLUGIN = 'crasher'
const fixture = fileURLToPath(new URL('./__fixtures__/crashingPlugin.mjs', import.meta.url))
const permissions: NodePermissions = {
  core: [],
  capabilities: [],
  secrets: false,
  exec: false,
  net: [],
  sockets: false,
}
const binding = {
  permissions,
  storage: {
    open: () => {
      throw new Error('no database here')
    },
  },
}

let root = ''
beforeEach(() => void (root = mkdtempSync(join(tmpdir(), 'acorn-worker-stopped-'))))
afterEach(() => {
  clearRegistrations(PLUGIN)
  rmSync(root, { recursive: true, force: true })
})

const shared = makeTestDb()
const start = async () => {
  const plugin = await isolateNodePlugin({
    entrypoint: fixture,
    pluginDir: dirname(fixture),
    plugin: PLUGIN,
    dataRoot: root,
    migrationsFolder: null,
    permissions,
  })
  return initPlugins([plugin], {
    capabilities: new CapabilityRegistry(),
    core: createCoreServices({
      secrets: new SecretService('b'.repeat(64)),
      db: shared.db,
      activeIdentity: memoryIdentityStore(),
      ...testCoreSeams(),
    }),
    dataDir: root,
    loaded: new Map([[PLUGIN, binding]]),
  })
}

const request = () =>
  new Hono<AppEnv>()
    .use('/v1/*', ...testGate({ kind: 'device', userId: 'owner-1', deviceId: 'device-1' }))
    .all(`${PLUGIN_NAMESPACE}/:plugin`, dispatchPluginFetch)
    .all(`${PLUGIN_NAMESPACE}/:plugin/*`, dispatchPluginFetch)
    .fetch(new Request(`http://acorn.test/v1/p/${PLUGIN}`), {} as Env)

it('takes back the routes of a plugin whose worker died and records why on its row', async () => {
  const host = await start()
  expect(await (await request()).text()).toBe('alive')

  await vi.waitFor(() => expect(host.roster[0]).toMatchObject({ state: 'failed', stage: 'run' }), { timeout: 5_000 })
  expect(host.roster[0]!.reason).toContain('boom from a timer')
  // Unclaimed now, so the app's own 404 answers instead of the dead worker's 500.
  expect((await request()).status).toBe(404)
  await host.dispose()
})

it('does not call a plugin the host stopped itself a crash', async () => {
  const host = await start()
  await host.unload(PLUGIN, 'disabled')
  // Past the fixture's timer: a terminated worker never runs it.
  await new Promise((resolve) => setTimeout(resolve, 400))
  expect(host.roster[0]).toMatchObject({ state: 'disabled' })
  await host.dispose()
})
