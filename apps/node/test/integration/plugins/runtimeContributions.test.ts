import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mintInternalToken } from '@acorn/node-core/server/auth/internalTokens.ts'
import { memoryIdentityStore } from '@acorn/node-core/server/activeIdentity.ts'
import { createCoreServices } from '@acorn/node-core/server/core/index.ts'
import { schema } from '@acorn/node-core/server/db/index.ts'
import { agentToolContributions } from '@acorn/node-core/server/agentTools/registry.ts'
import { getContextSections } from '@acorn/node-core/server/agentTools/contextSections.ts'
import { createApp } from '@acorn/node-core/server/index.ts'
import { CapabilityRegistry } from '@acorn/node-core/server/pluginHost/capabilities.ts'
import { initPlugins, type LoadedPluginBinding } from '@acorn/node-core/server/pluginHost/host.ts'
import { loadExternalPlugins, type LoadedPlugin } from '@acorn/node-core/server/plugins/loader.ts'
import { pluginDir } from '@acorn/node-core/server/plugins/installer.ts'
import { makeTestDb, testEnv, type TestDb } from '@acorn/node-core/testkit/db.ts'
import type { Env } from '@acorn/node-core/server/bindings.ts'

// The package is copied under the OS temp directory before loading. Its node.js has no imports and
// therefore cannot accidentally resolve a private workspace package from this repository's node_modules.
const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), '../../__fixtures__/runtime-contributions')
const INTERNAL = 'runtime-contribution-secret'
const USER = 'james'

const binding = (entry: LoadedPlugin): LoadedPluginBinding => ({
  permissions: entry.manifest.permissions.node,
  events: entry.manifest.permissions.events,
  emits: entry.manifest.emits,
  storage: entry.storage,
  agentTools: entry.manifest.contributions.agentTools,
  contextSections: entry.manifest.contributions.contextSections,
  dir: entry.dir,
})

describe('independently installed runtime contributions', () => {
  let dataRoot = ''
  let core: TestDb
  let env: Env
  let running: Awaited<ReturnType<typeof initPlugins>> | null = null

  const token = (taskId = 'task-1', options: { sessionId?: string; maxRisk?: 'read' | 'write' | 'execute' } = {}) =>
    mintInternalToken(INTERNAL, {
      scope: 'task', taskId,
      ...(options.sessionId ? { sessionId: options.sessionId } : {}),
      ...(options.maxRisk ? { toolCeiling: { maxRisk: options.maxRisk } } : {}),
    })
  const call = (path: string, init: RequestInit = {}) => createApp().fetch(new Request(`http://127.0.0.1${path}`, init), env)
  const asTask = (body?: unknown, options?: { taskId?: string; sessionId?: string; maxRisk?: 'read' | 'write' | 'execute' }): RequestInit => ({
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'x-acorn-internal': token(options?.taskId, options),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

  beforeAll(async () => {
    dataRoot = mkdtempSync(join(tmpdir(), 'acorn-runtime-contributions-'))
    cpSync(FIXTURE, pluginDir(dataRoot, 'runtime-fixture'), { recursive: true })
    core = makeTestDb()
    const now = Date.now()
    await core.db.insert(schema.workspaces).values({ id: 'workspace-1', name: 'Default', isDefault: true, sort: 0, createdAt: now, updatedAt: now })
    await core.db.insert(schema.projects).values({
      id: 'project-1', name: 'Fixture', path: null, workspaceId: 'workspace-1', sort: 0, hidden: false,
      vcs: 'git', defaultBranch: 'main', remoteUrl: null, githubOwner: null, githubName: null, githubRepoId: null,
      createdAt: now, updatedAt: now,
    })
    await core.db.insert(schema.tasks).values({
      id: 'task-1', title: 'Fixture task', origin: 'local', projectId: 'project-1', branch: null,
      status: 'active', sort: 0, createdAt: now, updatedAt: now,
    })
    env = testEnv({
      DB: core.db,
      DATA_DIR: dataRoot,
      INTERNAL_TOKEN: INTERNAL,
      ACTIVE_IDENTITY: { get: () => USER, set: () => {}, clear: () => {} },
      DEVICES: {
        authenticate: async (candidate: string) => candidate === 'paired-device-token' ? { deviceId: 'device-1' } : null,
      } as Env['DEVICES'],
    })
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const loaded = await loadExternalPlugins(dataRoot, { builtins: [] })
      expect(loaded.failures).toEqual([])
      const entry = loaded.loaded[0]!
      running = await initPlugins([entry.plugin], {
        capabilities: new CapabilityRegistry(),
        core: createCoreServices({ db: core.db, secrets: core.secrets, activeIdentity: memoryIdentityStore(USER) }),
        dataDir: dataRoot,
        env,
        loaded: new Map([[entry.manifest.id, binding(entry)]]),
      })
    } finally {
      error.mockRestore()
    }
  })

  afterAll(async () => {
    await running?.dispose()
    core.cleanup()
    rmSync(dataRoot, { recursive: true, force: true })
  })

  it('normalizes descriptors into MCP list and direct HTTP call with host-built origin', async () => {
    const listed = await call('/v2/core/tasks/task-1/tools', asTask())
    expect(listed.status).toBe(200)
    const tools = (await listed.json() as { tools: { name: string; inputSchema: unknown }[] }).tools
    expect(tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
      'runtime-fixture_echo', 'runtime-fixture_large', 'runtime-fixture_slow',
    ]))
    expect(tools.find((tool) => tool.name === 'runtime-fixture_echo')?.inputSchema).toMatchObject({
      type: 'object', required: ['message'], additionalProperties: false,
    })

    const response = await call('/v2/core/tasks/task-1/tools/runtime-fixture_echo', asTask({ message: 'hello' }, { sessionId: 'session-1' }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      arguments: { message: 'hello' },
      origin: { taskId: 'task-1', sessionId: 'session-1' },
      principal: { kind: 'internal', scope: 'task', taskId: 'task-1', sessionId: 'session-1' },
    })
    expect((await call('/v2/core/tasks/task-1/tools/runtime-fixture_echo', asTask({ message: 'x', extra: true }))).status).toBe(400)
  })

  it('enforces signed task/session authority and tool ceilings before dispatch', async () => {
    expect((await call('/v2/core/tasks/task-1/tools/runtime-fixture_mutate', asTask({}, { maxRisk: 'read' }))).status).toBe(404)
    expect((await call('/v2/core/tasks/task-1/tools/runtime-fixture_mutate', asTask({}))).status).toBe(404)
    expect((await call('/v2/core/tasks/task-1/tools/runtime-fixture_mutate', asTask({}, { sessionId: 'session-1' }))).status).toBe(200)
    expect((await call('/v2/core/tasks/task-1/tools/runtime-fixture_echo', asTask({ message: 'x' }, { taskId: 'other-task' }))).status).toBe(404)
    // A real paired-device principal can never enter the MCP/harness route, even though plugin routes
    // receive device principals elsewhere. This is the boundary a descriptor pointing at an approval
    // route cannot cross.
    expect((await call('/v2/core/tasks/task-1/tools/runtime-fixture_echo', {
      method: 'POST',
      headers: { authorization: 'Bearer paired-device-token', 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'x' }),
    })).status).toBe(404)
  })

  it('bounds timeout/output and never retries a mutation after a lost reply', async () => {
    expect((await call('/v2/core/tasks/task-1/tools/runtime-fixture_slow', asTask({}))).status).toBe(504)
    expect((await call('/v2/core/tasks/task-1/tools/runtime-fixture_large', asTask({}))).status).toBe(500)
    const lost = await call('/v2/core/tasks/task-1/tools/runtime-fixture_lost', asTask({}, { sessionId: 'session-1' }))
    expect(lost.status).toBe(500)
    const state = await call('/v2/p/runtime-fixture/state', asTask())
    expect(await state.json()).toMatchObject({ lost: 1 })
  })

  it('assembles bounded reference data, then removes stale registrations on update and unload', async () => {
    const context = await call('/v2/core/tasks/task-1/context?include=issues,runtime-fixture:fixture', asTask())
    expect(context.status).toBe(200)
    const body = await context.json() as { sections: { id: string; compact: string; absent?: unknown; items: unknown[]; omitted: number }[] }
    expect(body.sections.map((section) => section.id)).toEqual(['issues', 'runtime-fixture:fixture'])
    const fixture = body.sections[1]!
    expect(new TextEncoder().encode(fixture.compact).byteLength).toBeLessThanOrEqual(2048)
    expect(fixture.omitted).toBe(7)
    expect(fixture.items).toEqual([expect.objectContaining({ sources: [{ label: 'fixture source', uri: 'urn:fixture:reference-1' }] })])

    const manifestPath = join(pluginDir(dataRoot, 'runtime-fixture'), 'acorn-plugin.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as any
    manifest.version = '2.0.0'
    manifest.contributions.agentTools = manifest.contributions.agentTools.filter((tool: { id: string }) => tool.id === 'echo')
    manifest.contributions.agentTools[0].description = 'Updated echo.'
    manifest.contributions.contextSections[0].read = '/v2/p/runtime-fixture/context/invalid'
    writeFileSync(manifestPath, JSON.stringify(manifest))
    const loaded = await loadExternalPlugins(dataRoot, { builtins: [], reimport: ['runtime-fixture'] })
    const next = loaded.loaded[0]!
    expect(await running!.reload('runtime-fixture', { plugin: next.plugin, binding: binding(next) })).toEqual({ ok: true })

    const after = await call('/v2/core/tasks/task-1/tools', asTask())
    expect((await after.json() as { tools: { name: string; description: string }[] }).tools.filter((tool) => tool.name.startsWith('runtime-fixture')))
      .toEqual([expect.objectContaining({ name: 'runtime-fixture_echo', description: 'Updated echo.' })])
    const failedSection = await call('/v2/core/tasks/task-1/context?include=issues,runtime-fixture:fixture', asTask())
    const failedBody = await failedSection.json() as { sections: { id: string; absent?: { reason: string } }[] }
    expect(failedBody.sections.find((section) => section.id === 'issues')).toBeDefined()
    expect(failedBody.sections.find((section) => section.id === 'runtime-fixture:fixture')?.absent?.reason).toBe('invalid-response')

    await running!.dispose()
    running = null
    expect(agentToolContributions().some((tool) => tool.name.startsWith('runtime-fixture'))).toBe(false)
    expect(getContextSections().some((section) => section.id === 'runtime-fixture:fixture')).toBe(false)
  })
})
