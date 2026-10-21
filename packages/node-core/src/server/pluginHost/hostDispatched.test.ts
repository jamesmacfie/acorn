// The host calls a loaded plugin's tool, context section, CLI command, source, and task check routes
// itself, after its own checks. Over HTTP those same paths refuse an internal caller, or a task token
// would skip the tool tiers, the CLI command's device check, and source admission.
import { Hono } from 'hono'
import { afterEach, describe, expect, it } from 'vitest'
import { memoryIdentityStore } from '../activeIdentity'
import { createCoreServices, SecretService } from '../core'
import type { NodePermissions } from '../plugins/manifest'
import { makeTestDb, testCoreSeams, testEnv } from '../../testkit/db'
import { testGate } from '../../testkit/auth'
import { testCliCommandDescriptor } from '../../testkit/runtimeContributions'
import type { AppEnv, Principal } from '../middleware/auth'
import { PLUGIN_NAMESPACE } from '../routes/registry'
import { CapabilityRegistry } from './capabilities'
import { dispatchPluginRoute } from './dispatch'
import { dispatchPluginFetch } from './fetchRoute'
import { clearRegistrations, initPlugins, type LoadedPluginBinding } from './host'
import type { NodePlugin, PluginStorage } from './types'

const PLUGIN = 'acme'
const OWNER = 'owner-1'
const TASK: Principal = { kind: 'internal', scope: 'task', userId: OWNER, taskId: 'task-1' }
const SERVICE: Principal = { kind: 'internal', scope: 'service', userId: OWNER }
const DEVICE: Principal = { kind: 'device', userId: OWNER, deviceId: 'device-1' }

const NO_PERMISSIONS: NodePermissions = {
  core: [],
  capabilities: [],
  secrets: false,
  exec: false,
  net: [],
  sockets: false,
}
const storage: PluginStorage = {
  open: () => {
    throw new Error('this suite never opens a plugin database')
  },
}

const tool = {
  id: 'run',
  description: 'Run something on the host.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  risk: 'execute',
  scope: 'task',
  handler: `/v1/p/${PLUGIN}/tools/run`,
  requiresSession: false,
  timeoutMs: 1_000,
  maxOutputBytes: 4_096,
} as const
const binding: LoadedPluginBinding = {
  permissions: NO_PERMISSIONS,
  storage,
  agentTools: [tool],
  contextSections: [
    {
      id: 'refs',
      label: 'References',
      scope: 'task',
      order: 60,
      read: `/v1/p/${PLUGIN}/context/refs`,
      defaultIncluded: false,
      timeoutMs: 1_000,
      maxBytes: 4_096,
      maxTokens: 1_024,
    },
  ],
  cliCommands: [testCliCommandDescriptor()],
  taskChecks: [{ id: 'dirty', check: `/v1/p/${PLUGIN}/checks/dirty` }],
}

// Every path the plugin serves lands in `calls`, so a refused request shows as one that never ran.
let calls: string[] = []
const acme = (): NodePlugin => ({
  name: PLUGIN,
  init: (ctx) => {
    ctx.routes.fetch(async (request) => {
      calls.push(new URL(request.url).pathname)
      return Response.json({})
    })
    ctx.dataSources.register({
      sourceId: 'items',
      name: 'Items',
      singular: 'Item',
      plural: 'Items',
      identityScope: 'An item ID is unique.',
      handler: `/v1/p/${PLUGIN}/sources/items`,
    })
  },
})

const DECLARED = [
  ['tool handler', '/tools/run'],
  ['context section', '/context/refs'],
  ['CLI command', '/cli/probe'],
  ['data source', '/sources/items'],
  ['task check', '/checks/dirty'],
] as const

const db = makeTestDb()
const env = testEnv({ DB: db.db, ACTIVE_IDENTITY: memoryIdentityStore(OWNER) })
const start = (pluginBinding: LoadedPluginBinding = binding, plugin = acme()) =>
  initPlugins([plugin], {
    capabilities: new CapabilityRegistry(),
    core: createCoreServices({
      secrets: new SecretService('b'.repeat(64)),
      db: db.db,
      activeIdentity: memoryIdentityStore(OWNER),
      ...testCoreSeams(),
    }),
    dataDir: '',
    env,
    loaded: new Map([[PLUGIN, pluginBinding]]),
  })
const post = (principal: Principal, path: string) =>
  new Hono<AppEnv>()
    .use('/v1/*', ...testGate(principal))
    .all(`${PLUGIN_NAMESPACE}/:plugin`, dispatchPluginFetch)
    .all(`${PLUGIN_NAMESPACE}/:plugin/*`, dispatchPluginFetch)
    .fetch(new Request(`http://acorn.test${path}`, { method: 'POST', body: '{}' }), env)

afterEach(() => {
  clearRegistrations(PLUGIN)
  calls = []
})

describe('paths the host dispatches', () => {
  it.each(DECLARED)('refuse an internal caller on a %s, and the handler never runs', async (_kind, path) => {
    const host = await start()
    for (const principal of [TASK, SERVICE]) {
      const response = await post(principal, `/v1/p/${PLUGIN}${path}`)
      expect(response.status).toBe(404)
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe('not_found')
    }
    expect(calls).toEqual([])
    await host.dispose()
  })

  it.each(DECLARED)('stay open to a device on a %s', async (_kind, path) => {
    const host = await start()
    expect((await post(DEVICE, `/v1/p/${PLUGIN}${path}`)).status).toBe(200)
    expect(calls).toEqual([path])
    await host.dispose()
  })

  it.each(DECLARED)("still answer the host's own dispatch on a %s", async (_kind, path) => {
    const host = await start()
    const response = await dispatchPluginRoute(
      env,
      PLUGIN,
      `/v1/p/${PLUGIN}${path}`,
      { method: 'POST', body: '{}' },
      AbortSignal.timeout(1_000),
      TASK,
    )
    expect(response.status).toBe(200)
    expect(calls).toEqual([path])
    await host.dispose()
  })

  it("leave the plugin's other paths to the plugin", async () => {
    const host = await start()
    expect((await post(TASK, `/v1/p/${PLUGIN}/state`)).status).toBe(200)
    expect(calls).toEqual(['/state'])
    await host.dispose()
  })

  // Hono decodes the path before a plugin's router matches it, and a lenient router ignores extra slashes.
  it.each(['/tools/%72un', '/tools/run/', '//tools//run', '/tools/run?taskId=task-2'])(
    'refuse a task token on another spelling of a declared path: %s',
    async (path) => {
      const host = await start()
      expect((await post(TASK, `/v1/p/${PLUGIN}${path}`)).status).toBe(404)
      expect(calls).toEqual([])
      await host.dispose()
    },
  )

  it("close a code host's whole change request API", async () => {
    const host = await start({
      permissions: NO_PERMISSIONS,
      storage,
      codeHost: { label: 'Acme', hosts: ['acme.test'], changeRequest: { api: `/v1/p/${PLUGIN}/change-requests` } },
    })
    for (const path of ['/change-requests', '/change-requests/12', '/change-requests/12/checks'])
      expect((await post(TASK, `/v1/p/${PLUGIN}${path}`)).status).toBe(404)
    expect((await post(TASK, `/v1/p/${PLUGIN}/change-requests-other`)).status).toBe(200)
    expect(calls).toEqual(['/change-requests-other'])
    await host.dispose()
  })

  it('follow a reload that renames a tool handler: the new path closes and the old one opens', async () => {
    const host = await start()
    const renamed = `/v1/p/${PLUGIN}/tools/run-v2`
    expect(
      await host.reload(PLUGIN, {
        plugin: acme(),
        binding: { ...binding, agentTools: [{ ...tool, handler: renamed }] },
      }),
    ).toEqual({ ok: true })
    expect((await post(TASK, renamed)).status).toBe(404)
    expect((await post(TASK, `/v1/p/${PLUGIN}/tools/run`)).status).toBe(200)
    expect(calls).toEqual(['/tools/run'])
    await host.dispose()
  })

  it('open again once a reload drops the declaration', async () => {
    const host = await start()
    expect(await host.reload(PLUGIN, { plugin: acme(), binding: { permissions: NO_PERMISSIONS, storage } })).toEqual({
      ok: true,
    })
    expect((await post(TASK, `/v1/p/${PLUGIN}/tools/run`)).status).toBe(200)
    expect(calls).toEqual(['/tools/run'])
    await host.dispose()
  })
})
