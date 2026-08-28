import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NodeAdoptResult, NodeProvidersResponse } from '@acorn/protocol/nodeProviders.ts'
import { createApp } from '@acorn/node-core/server/index.ts'
import { deviceService } from '@acorn/node-core/server/auth/deviceTokens.ts'
import { idempotencyStore } from '@acorn/node-core/server/auth/idempotency.ts'
import { mintInternalToken } from '@acorn/node-core/server/auth/internalTokens.ts'
import { pairingCodes } from '@acorn/node-core/server/auth/pairingCodes.ts'
import { loadExternalPlugins } from '@acorn/node-core/main/pluginLoader.ts'
import { createCoreServices, SecretService } from '@acorn/node-core/main/core/index.ts'
import { memoryIdentityStore } from '@acorn/node-core/main/activeIdentity.ts'
import { CapabilityRegistry } from '@acorn/node-core/server/plugin/capabilities.ts'
import { initPlugins } from '@acorn/node-core/server/plugin/host.ts'
import { nodeProviders } from '@acorn/node-core/server/nodeProviders/registry.ts'
import { makeTestDb, testSecretEnv, type TestDb } from '@acorn/node-core/testkit/db.ts'
import type { Env } from '@acorn/node-core/main/bindings.ts'

// The node-provider seam end to end, against the reference provider loaded off disk
// (docs/plugins.md § Node providers).
//
// Loaded, not imported. The acceptance criterion for the whole phase is that the first-party cloud
// plugin will be a loaded plugin built only from published seams, and the way to know that is true is
// to make the reference provider one and drive it through the real routes. So this builds the package,
// loads it the way boot does, and asks `/v2/core/nodes` the way a client does.
//
// The single most important assertion here is negative: the list route does not carry the device token
// the provider handed it. That token is the whole trust story, and the projection is a field list
// rather than a delete precisely so it cannot leak by omission.

const NODE_APP = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const INTERNAL = 'internal-secret'
const ENC_KEY = '0'.repeat(64)
const FINGERPRINT = 'b'.repeat(64)
const CLOUD_NODE_ID = '99999999-8888-4777-8666-555555555555'

describe('a loaded plugin that contributes a node provider', () => {
  let dataRoot = ''
  let nodesFile = ''
  let core: TestDb
  let env: Env
  let running: Awaited<ReturnType<typeof initPlugins>> | null = null
  let ownerToken = ''

  const boot = async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const { loaded } = await loadExternalPlugins(dataRoot, { builtins: [] })
      const entry = loaded.find((row) => row.manifest.id === 'nodes-file')
      if (!entry) throw new Error('the nodes-file package did not load')
      running = await initPlugins([entry.plugin], {
        capabilities: new CapabilityRegistry(),
        core: createCoreServices({ secrets: new SecretService(ENC_KEY), db: core.db, activeIdentity: memoryIdentityStore() }),
        dataDir: dataRoot,
        loaded: new Map([['nodes-file', { permissions: entry.manifest.permissions.node, storage: entry.storage }]]),
      })
      return running
    } finally {
      warn.mockRestore()
    }
  }

  const call = (path: string, init: RequestInit = {}) => createApp().fetch(new Request(`http://127.0.0.1${path}`, init), env)
  const asOwner = (body?: unknown): RequestInit => ({
    method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${ownerToken}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

  beforeAll(() => {
    dataRoot = mkdtempSync(join(tmpdir(), 'acorn-node-providers-'))
    nodesFile = join(dataRoot, 'nodes.json')
    // The provider reads its path from the environment, so it has to be set before the plugin's init
    // runs. Set for the whole file rather than per test: a plugin registers once, at boot.
    process.env.ACORN_NODES_FILE = nodesFile
    execFileSync(process.execPath, [join(NODE_APP, 'scripts/build-plugin.mjs'), 'nodes-file'], {
      cwd: NODE_APP,
      env: { ...process.env, ACORN_DATA_DIR: dataRoot },
      stdio: 'pipe',
    })
  }, 180_000)

  afterAll(async () => {
    await running?.dispose()
    delete process.env.ACORN_NODES_FILE
    rmSync(dataRoot, { recursive: true, force: true })
  })

  beforeEach(async () => {
    core = makeTestDb()
    const devices = deviceService(core.db)
    ownerToken = (await devices.issue('test client')).token
    env = {
      DB: core.db,
      DATA_DIR: dataRoot,
      NODE_ID: 'node-1',
      APP_VERSION: 'test',
      NODE_FINGERPRINT: 'ff'.repeat(32),
      ...testSecretEnv(ENC_KEY),
      INTERNAL_TOKEN: INTERNAL,
      // Bound, because an internal principal resolves to the machine's owner and an unbound store
      // answers 401 before any gate is reached (server/middleware/auth.ts).
      ACTIVE_IDENTITY: { get: () => 'james', set: () => {}, clear: () => {} },
      DEVICES: devices,
      IDEMPOTENCY: idempotencyStore(core.db),
      PAIRING_CODES: pairingCodes(),
      BLOBS: { get: async () => null, put: async () => {} },
    } as unknown as Env
    writeFileSync(nodesFile, JSON.stringify({
      nodes: [{
        providerNodeId: 'cloud-1',
        nodeId: CLOUD_NODE_ID,
        label: 'Big box',
        endpoint: 'https://big.example:4317',
        fingerprint: FINGERPRINT,
        deviceToken: 'acorn_dt_pretend',
      }],
    }))
  })

  afterEach(() => core.cleanup())

  it('registers under a host-qualified id, from a manifest that grants it nothing', async () => {
    const plugins = await boot()
    expect(plugins.failed).toEqual([])
    expect(plugins.enabled).toEqual(['nodes-file'])
    // `nodes-file:file`: the plugin declared `file`, the host stamped the rest.
    expect(nodeProviders().map((provider) => provider.qualifiedId)).toEqual(['nodes-file:file'])
  })

  it('answers the list route without the credential the provider handed it', async () => {
    await boot()
    const response = await call('/v2/core/nodes', asOwner())
    expect(response.status).toBe(200)
    const body = (await response.json()) as NodeProvidersResponse
    expect(body.providers).toEqual([{ id: 'nodes-file:file', label: 'Nodes from a file', verbs: ['create', 'destroy', 'start', 'stop'] }])
    expect(body.nodes).toEqual([{
      providerId: 'nodes-file:file',
      providerNodeId: 'cloud-1',
      nodeId: CLOUD_NODE_ID,
      label: 'Big box',
      endpoint: 'https://big.example:4317',
      fingerprint: FINGERPRINT,
      state: 'ready',
    }])
    expect(body.failures).toEqual([])
  })

  it('hands the credential over only through adopt', async () => {
    await boot()
    // Belt on the assertion above: the token appears nowhere in the list response at all, whatever the
    // shape of the projection.
    expect(await (await call('/v2/core/nodes', asOwner())).text()).not.toContain('acorn_dt_pretend')

    const response = await call('/v2/core/nodes/adopt', asOwner({ providerId: 'nodes-file:file', providerNodeId: 'cloud-1' }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      nodeId: CLOUD_NODE_ID,
      label: 'Big box',
      endpoint: 'https://big.example:4317',
      fingerprint: FINGERPRINT,
      deviceToken: 'acorn_dt_pretend',
    } satisfies NodeAdoptResult)
  })

  it('refuses to adopt a node that has nothing to connect to yet', async () => {
    await boot()
    writeFileSync(nodesFile, JSON.stringify({ nodes: [{ providerNodeId: 'cloud-2', label: 'Half-built', state: 'provisioning' }] }))
    const response = await call('/v2/core/nodes/adopt', asOwner({ providerId: 'nodes-file:file', providerNodeId: 'cloud-2' }))
    // 409, not 500: the node is fine, it is simply not finished, and the client shows it as building.
    expect(response.status).toBe(409)
    expect(await response.text()).toContain('provisioning')
  })

  it('creates and destroys a node through the provider', async () => {
    await boot()
    const created = await call('/v2/core/nodes/create', asOwner({ providerId: 'nodes-file:file', label: 'New one', options: {} }))
    expect(created.status).toBe(200)
    const row = (await created.json()) as { providerNodeId: string; state: string }
    expect(row.state).toBe('provisioning')

    const listed = (await (await call('/v2/core/nodes', asOwner())).json()) as NodeProvidersResponse
    expect(listed.nodes.map((node) => node.label)).toEqual(['Big box', 'New one'])

    expect((await call('/v2/core/nodes/destroy', asOwner({ providerId: 'nodes-file:file', providerNodeId: row.providerNodeId }))).status).toBe(204)
    const after = (await (await call('/v2/core/nodes', asOwner())).json()) as NodeProvidersResponse
    expect(after.nodes.map((node) => node.label)).toEqual(['Big box'])
  })

  it('names a verb the provider does not have as unknown rather than failing quietly', async () => {
    await boot()
    const response = await call('/v2/core/nodes/start', asOwner({ providerId: 'nodes-file:nope', providerNodeId: 'cloud-1' }))
    expect(response.status).toBe(404)
  })

  it('is closed to a task-scoped agent, in every direction', async () => {
    await boot()
    const asAgent: RequestInit = {
      headers: { 'x-acorn-internal': mintInternalToken(INTERNAL, { scope: 'task', taskId: 'task-1' }), 'content-type': 'application/json' },
    }
    // The list enumerates the owner's infrastructure, adopt hands over a credential for another
    // machine, and create spends money. None of the three is a question an agent gets to ask.
    const list = await call('/v2/core/nodes', asAgent)
    expect(list.status).toBe(403)
    expect(await list.text()).not.toContain('big.example')
    for (const path of ['/v2/core/nodes/adopt', '/v2/core/nodes/create', '/v2/core/nodes/destroy']) {
      const response = await call(path, { ...asAgent, method: 'POST', body: JSON.stringify({ providerId: 'nodes-file:file', providerNodeId: 'cloud-1', label: 'x' }) })
      expect(response.status).toBe(403)
    }
  })
})
