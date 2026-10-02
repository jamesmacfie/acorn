import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { FINDINGS_AGENT_PROPOSAL } from '@acorn/plugin-findings/contract/review.ts'
import { findingsPlugin } from '@acorn/plugin-findings/node/index.ts'
import { AGENTS_SESSIONS, type AgentSessionRosterEntry } from '@acorn/plugin-agents/contract/lifecycle.ts'
import { memoryPlugin } from '@acorn/plugin-memory/node/index.ts'
import { mintInternalToken } from '@acorn/node-core/server/auth'
import { memoryIdentityStore } from '@acorn/node-core/server/activeIdentity.ts'
import { createCoreServices } from '@acorn/node-core/server/core/index.ts'
import { initPlugins, type LoadedPluginBinding } from '@acorn/node-core/server/pluginHost/host.ts'
import { CapabilityRegistry } from '@acorn/node-core/server/pluginHost/capabilities.ts'
import { registerHookPoint, runHook } from '@acorn/node-core/server/pluginHost'
import { agentToolContributions } from '@acorn/node-core/server/agentTools'
import { pluginRouteContributions } from '@acorn/node-core/server/routes/registry.ts'
import { createApp } from '@acorn/node-core/server/index.ts'
import { reconcileBundledPlugins } from '@acorn/node-core/server/plugins'
import { loadExternalPlugins, type LoadedPlugin } from '@acorn/node-core/server/plugins'
import { installPlugin, pluginDir, uninstallPlugin } from '@acorn/node-core/server/plugins'
import { pluginDbPath } from '@acorn/node-core/server/plugins'
import { schema } from '@acorn/node-core/server/db/index.ts'
import { makeTestDb, testEnv, issueAgentToolProvenance, type TestDb } from '@acorn/node-core/testkit'
import type { Env } from '@acorn/node-core/server/bindings.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const NODE_APP = resolve(HERE, '../../..')
const PRODUCER_FIXTURE = join(HERE, '../../__fixtures__/findings-producer')
const FINDINGS_MODULE = new URL('../../../../../plugins/findings/src/node/index.ts', import.meta.url).href
const INTERNAL = 'findings-loaded-internal'

const binding = (entry: LoadedPlugin): LoadedPluginBinding => ({
  permissions: entry.manifest.permissions.node,
  events: entry.manifest.permissions.events,
  emits: entry.manifest.emits,
  storage: entry.storage,
  agentTools: entry.manifest.contributions.agentTools,
  contextSections: entry.manifest.contributions.contextSections,
  extensionPoints: entry.manifest.contributions.extensionPoints,
  extensions: entry.manifest.contributions.extensions,
  destinations: entry.manifest.contributions.frames.flatMap((surface) => surface.destinations ?? []),
  dir: entry.dir,
})

const capabilities = () => {
  const registry = new CapabilityRegistry()
  registry.provide(AGENTS_SESSIONS, {
    list: async (taskId) => [{ taskId, sessionId: 'session-1' } as AgentSessionRosterEntry],
  })
  return registry
}

describe('findings as a loaded plugin', () => {
  let core: TestDb
  let dataRoot = ''
  let env: Env
  let running: Awaited<ReturnType<typeof initPlugins>> | null = null
  let observationId = ''
  let candidateId = ''

  const call = (path: string, init: RequestInit = {}) => createApp().fetch(new Request(`http://127.0.0.1${path}`, init), env)
  const device = (body?: unknown): RequestInit => ({
    method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: 'Bearer paired-device-token', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const task = (body?: unknown, sessionId?: string): RequestInit => ({
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'x-acorn-internal': mintInternalToken(INTERNAL, { scope: 'task', taskId: 'task-a', toolCeiling: { maxRisk: 'write' }, ...(sessionId ? { sessionId } : {}) }),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

  const bootLoaded = async (disabled: string[] = []) => {
    const loaded = await loadExternalPlugins(dataRoot, { builtins: ['memory'] })
    expect(loaded.failures).toEqual([])
    const entries = loaded.loaded.filter((entry) => ['findings', 'architecture-review'].includes(entry.manifest.id))
    const registry = capabilities()
    env.CAPABILITIES = registry
    const host = await initPlugins([memoryPlugin(), ...entries.map((entry) => entry.plugin)], {
      capabilities: registry,
      core: createCoreServices({ db: core.db, secrets: core.secrets, activeIdentity: memoryIdentityStore('owner') }),
      dataDir: dataRoot,
      env,
      disabled,
      loaded: new Map(entries.map((entry) => [entry.manifest.id, binding(entry)])),
    })
    running = host
    return { host, entries, installed: loaded.installed }
  }

  beforeAll(async () => {
    dataRoot = mkdtempSync(join(tmpdir(), 'acorn-findings-loaded-'))
    vi.stubEnv('ACORN_DATA_DIR', dataRoot)
    core = makeTestDb()
    const now = Date.now()
    core.db.insert(schema.workspaces).values({ id: 'ws', name: 'Workspace', isDefault: true, sort: 0, createdAt: now, updatedAt: now }).run()
    core.db.insert(schema.projects).values({ id: 'project', name: 'Acorn', path: dataRoot, workspaceId: 'ws', createdAt: now, updatedAt: now }).run()
    core.db.insert(schema.tasks).values([
      { id: 'task-a', title: 'Task A', origin: 'local', projectId: 'project', status: 'active', createdAt: now, updatedAt: now },
      { id: 'task-b', title: 'Task B', origin: 'local', projectId: 'project', status: 'active', createdAt: now, updatedAt: now },
    ]).run()
    env = testEnv({
      DB: core.db,
      DATA_DIR: dataRoot,
      INTERNAL_TOKEN: INTERNAL,
      ACTIVE_IDENTITY: { get: () => 'owner', set: () => {}, clear: () => {} },
      DEVICES: { authenticate: async (candidate: string) => candidate === 'paired-device-token' ? { deviceId: 'device-1' } : null } as Env['DEVICES'],
    })

    // Populate the stable database through the former compiled execution path before the package is
    // installed. The wrapper supplies only that path's historical migration declaration.
    const compiled = { ...findingsPlugin(), migrationsModule: FINDINGS_MODULE }
    const compiledCapabilities = capabilities()
    running = await initPlugins([compiled, memoryPlugin()], {
      capabilities: compiledCapabilities,
      core: createCoreServices({ db: core.db, secrets: core.secrets, activeIdentity: memoryIdentityStore('owner') }),
      dataDir: dataRoot,
      env,
    })
    const recorded = await call('/v1/p/findings/tasks/task-a/observations', device({
      sourceKey: 'compiled-one', title: 'Compiled finding', body: 'Persist this identity across cutover.', claimStatus: 'observed', evidence: [],
    }))
    expect(recorded.status).toBe(200)
    observationId = (await recorded.json() as { id: string }).id
    // Seed the retained proposal seam directly: Memory tools now save files instead of proposals.
    const submitted = await compiledCapabilities.get(FINDINGS_AGENT_PROPOSAL)!.submit({
      taskId: 'task-a', sessionId: 'session-1', proof: issueAgentToolProvenance('task-a', 'session-1', 'memory_write'),
      sourceKey: 'compiled-proposal', title: 'Review this memory.', body: 'Persist this review across cutover.',
      payload: { operation: 'add', scope: { kind: 'project', projectId: 'project' }, name: 'compiled-proposal', type: 'reference', description: 'Review this memory.', body: 'Persist this review across cutover.' },
    })
    candidateId = submitted.candidateId
    expect(existsSync(join(dataRoot, 'memory-proposals'))).toBe(false)
    expect(candidateId).not.toBe('')
    const currentCandidate = await call(`/v1/p/findings/review/candidates/${candidateId}`, device())
    const currentRevision = (await currentCandidate.json() as { revision: number }).revision
    const dismissed = await call(`/v1/p/findings/review/candidates/${candidateId}/decision`, device({
      expectedRevision: currentRevision, action: 'dismiss', idempotencyKey: 'compiled-dismiss',
    }))
    expect(dismissed.status).toBe(200)
    const reasoned = await call(`/v1/p/findings/review/candidates/${candidateId}/decision`, device({
      expectedRevision: currentRevision, action: 'dismiss-reason', reason: 'Preserve this dismissal.', idempotencyKey: 'compiled-dismiss-reason',
    }))
    expect(reasoned.status).toBe(200)
    await running.dispose()
    running = null

    execFileSync(process.execPath, [join(NODE_APP, 'scripts/build-plugin.mjs'), 'findings'], {
      cwd: NODE_APP,
      env: { ...process.env, ACORN_DATA_DIR: dataRoot },
      stdio: 'pipe',
    })
    cpSync(PRODUCER_FIXTURE, pluginDir(dataRoot, 'architecture-review'), { recursive: true })
  }, 180_000)

  afterAll(async () => {
    await running?.dispose()
    core.cleanup()
    rmSync(dataRoot, { recursive: true, force: true })
    vi.unstubAllEnvs()
  })

  it('loads its packaged node, migrations, portable tree, permissions, and stable carriers', async () => {
    const { host, entries, installed } = await bootLoaded()
    expect(host.failed).toEqual([])
    expect(host.enabled).toEqual(expect.arrayContaining(['findings', 'architecture-review']))
    const findings = entries.find((entry) => entry.manifest.id === 'findings')!
    expect(findings.plugin).not.toHaveProperty('migrationsModule')
    expect(findings.manifest.permissions).toMatchObject({
      api: [],
      events: expect.arrayContaining(['plugin:terminal:completed', 'plugin:workflows:completed']),
      node: { capabilities: ['agents.reviewInput.v1', 'agents.sessions', 'terminal.reviewInput.v1', 'workflows.reviewInput.v1'], secrets: false, exec: false, net: [], sockets: false },
    })
    expect(findings.manifest.permissions.node.capabilities).not.toContain('memory.knowledge')
    expect(findings.manifest.contributions.agentTools.map((entry) => entry.id)).toEqual(['record', 'list', 'get', 'withdraw'])
    expect(findings.manifest.contributions.contextSections.map((entry) => entry.id)).toEqual(['task_findings'])
    expect(installed.find((entry) => entry.manifest.id === 'findings')?.client).toMatchObject({
      hash: expect.stringMatching(/^[0-9a-f]{64}$/), bytes: expect.any(Number),
    })
    expect(existsSync(join(pluginDir(dataRoot, 'findings'), 'migrations/meta/_journal.json'))).toBe(true)
    expect(existsSync(pluginDbPath(dataRoot, 'findings'))).toBe(true)
  }, 60_000)

  it('runs the bounded archive hook only while loaded Findings is enabled', async () => {
    const point = registerHookPoint({ id: 'terminal:archive-review', ownerId: 'terminal',
      payload: { taskId: 'string', sessionIds: 'string[]', terminalOutput: 'string', diff: 'string', captureStatus: 'string' },
      allows: ['transform'], timeoutMs: 5_000, onTimeout: 'allow', order: 'priority', collect: false })
    try {
      const input = { taskId: 'task-a', sessionIds: ['session-1'], terminalOutput: 'Retained output',
        diff: 'diff --git a/file b/file', captureStatus: 'pending' }
      const captured = await runHook('terminal:archive-review', input)
      expect(captured.payload.captureStatus).toBe('captured')
      const exportResponse = await call('/v1/p/findings/export', device())
      const exported = await exportResponse.json() as { observations: Array<{ body: string }> }
      expect(exported.observations).toEqual(expect.arrayContaining([
        expect.objectContaining({ body: expect.stringContaining('Terminal sessions: session-1') }),
      ]))

      await running?.dispose()
      running = null
      const disabled = await bootLoaded(['findings'])
      const absent = await runHook('terminal:archive-review', { ...input, taskId: 'task-b' })
      expect(absent.payload.captureStatus).toBe('pending')
      await disabled.host.dispose()
      running = null
      await bootLoaded()
      const restored = await runHook('terminal:archive-review', { ...input, taskId: 'task-b' })
      expect(restored.payload.captureStatus).toBe('captured')
    } finally {
      point.dispose()
    }
  }, 60_000)

  it('preserves compiled IDs, candidate revisions, and dismissal history', async () => {
    const observation = await call(`/v1/p/findings/tasks/task-a/observations/${observationId}`, device())
    expect(observation.status).toBe(200)
    expect(await observation.json()).toMatchObject({ id: observationId, title: 'Compiled finding' })
    const candidate = await call(`/v1/p/findings/review/candidates/${candidateId}`, device())
    expect(await candidate.json()).toMatchObject({ candidateId, status: 'dismissed' })
    const history = await call(`/v1/p/findings/review/candidates/${candidateId}/history`, device())
    const actions = (await history.json() as { items: Array<{ action: string; reason: string | null }> }).items
    expect(actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'dismiss-reason', reason: 'Preserve this dismissal.' }),
      expect.objectContaining({ action: 'dismiss' }),
    ]))
    const exported = await call('/v1/p/findings/export', device())
    expect(exported.status).toBe(200)
    expect(await exported.json()).toMatchObject({
      baseline: 'acorn-1',
      version: 1,
      observations: expect.arrayContaining([expect.objectContaining({ id: observationId })]),
      candidates: expect.arrayContaining([expect.objectContaining({ id: candidateId })]),
    })
    expect((await call('/v1/p/findings/migration/report', device())).status).toBe(403)
  })

  it('dispatches stable task tools/context and rejects interactive access to their private handlers', async () => {
    const tools = await call('/v1/core/tasks/task-a/tools', task(undefined, 'session-1'))
    expect((await tools.json() as { tools: Array<{ name: string }> }).tools.map((entry) => entry.name)).toEqual(expect.arrayContaining([
      'findings_record', 'findings_list', 'findings_get', 'findings_withdraw',
    ]))
    const recorded = await call('/v1/core/tasks/task-a/tools/findings_record', task({
      sourceKey: 'loaded-tool', title: 'Loaded tool finding', body: 'Through the host dispatcher.', claimStatus: 'asked', evidence: [],
    }, 'session-1'))
    const recordedBody = await recorded.json()
    expect(recorded.status, JSON.stringify(recordedBody)).toBe(200)
    const context = await call('/v1/core/tasks/task-a/context?include=findings:task_findings', task())
    expect(await context.json()).toMatchObject({ sections: [expect.objectContaining({ id: 'findings:task_findings', items: expect.any(Array) })] })
    expect((await call('/v1/p/findings/runtime/tools/list', device({ arguments: {}, origin: { taskId: 'task-a' } }))).status).toBe(403)
    expect((await call('/v1/p/findings/tasks/task-b/observations/' + observationId, device())).status).toBe(404)
  })

  it('saves direct memory without producing a review candidate', async () => {
    const before = await (await call('/v1/p/findings/export', device())).json() as { candidates: unknown[] }
    const submitted = await call('/v1/core/tasks/task-a/tools/memory_write', task({
      scope: 'project', name: 'loaded-memory', type: 'reference', description: 'Save a loaded tool write.', body: 'The memory is available before restart.',
    }, 'session-1'))
    const result = await submitted.json() as { changeId: string; hash: string }
    expect(submitted.status, JSON.stringify(result)).toBe(200)
    expect(result.changeId).toEqual(expect.any(String))
    expect(existsSync(join(dataRoot, 'memory/projects/project/loaded-memory.md'))).toBe(true)
    const after = await (await call('/v1/p/findings/export', device())).json() as { candidates: unknown[] }
    expect(after.candidates).toHaveLength(before.candidates.length)
    const unsigned = await call('/v1/core/tasks/task-a/tools/memory_write', task({
      scope: 'project', name: 'unsigned-memory', type: 'reference', description: 'Do not accept.', body: 'Missing session.',
    }))
    expect(unsigned.status).not.toBe(200)
  })

  it('keeps maximum legal records readable through byte-aware loaded carriers', async () => {
    const prefix = 'https://example.com/'
    const evidenceUrl = prefix + 'x'.repeat(2_048 - prefix.length)
    const body = '€'.repeat(Math.floor((16 * 1024) / 3))
    const ids: string[] = []
    for (let index = 0; index < 5; index += 1) {
      const response = await call('/v1/p/findings/tasks/task-a/observations', device({
        sourceKey: `carrier-max-${index}`,
        title: `Carrier maximum ${index} ${'x'.repeat(170)}`,
        body,
        claimStatus: 'observed',
        evidence: Array.from({ length: 20 }, () => ({ kind: 'url', url: evidenceUrl, label: 'x'.repeat(200) })),
      }))
      expect(response.status).toBe(200)
      ids.push((await response.json() as { id: string }).id)
    }

    const get = await call('/v1/core/tasks/task-a/tools/findings_get', task({ id: ids[0] }))
    expect(get.status).toBe(200)
    const list = await call('/v1/core/tasks/task-a/tools/findings_list', task({ limit: 100, state: 'active' }))
    const listText = await list.text()
    expect(list.status, listText).toBe(200)
    expect(Buffer.byteLength(listText, 'utf8')).toBeLessThanOrEqual(256 * 1024)
    expect(JSON.parse(listText)).toMatchObject({ nextCursor: expect.any(String) })

    const context = await call('/v1/core/tasks/task-a/context?include=findings:task_findings', task())
    const contextBody = await context.json() as { sections: Array<{ id: string; items: unknown[]; absent?: unknown }> }
    expect(context.status).toBe(200)
    expect(contextBody.sections[0]).toMatchObject({ id: 'findings:task_findings', items: expect.any(Array) })
    expect(contextBody.sections[0]?.absent).toBeUndefined()
  })

  it('accepts a namespaced observation from an independently installed producer', async () => {
    const response = await call('/v1/p/architecture-review/record', device({
      taskId: 'task-a', sourceKey: 'architecture-1', title: 'Boundary leak', body: 'A private implementation escaped its owner.',
    }))
    expect(response.status).toBe(201)
    const id = (await response.json() as { id: string }).id
    const recorded = await call(`/v1/p/findings/tasks/task-a/observations/${id}`, device())
    expect(await recorded.json()).toMatchObject({
      id, kind: { id: 'architecture-review:architecture', label: 'Architecture concern' },
      origin: { kind: 'plugin', pluginId: 'architecture-review' },
    })
  })

  it('applies an installed update and contains a later failed migration without losing data', async () => {
    await running?.dispose()
    running = null
    const resources = mkdtempSync(join(tmpdir(), 'acorn-findings-resources-'))
    try {
      const staged = join(resources, 'findings')
      cpSync(pluginDir(dataRoot, 'findings'), staged, { recursive: true })
      rmSync(join(staged, '.acorn-dev-build'), { force: true })
      const manifestPath = join(staged, 'acorn-plugin.json')
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { version: string }
      writeFileSync(manifestPath, JSON.stringify({ ...manifest, version: `${manifest.version}-next` }))
      const journalPath = join(staged, 'migrations/meta/_journal.json')
      const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: Array<{ idx: number; version: string; when: number; tag: string; breakpoints: boolean }> }
      const next = journal.entries.length
      writeFileSync(join(staged, `migrations/${String(next).padStart(4, '0')}_loaded_update.sql`), 'ALTER TABLE `observations` ADD `loaded_update_marker` text;')
      journal.entries.push({ idx: next, version: '6', when: Date.now(), tag: `${String(next).padStart(4, '0')}_loaded_update`, breakpoints: true })
      writeFileSync(journalPath, JSON.stringify(journal))
      expect(reconcileBundledPlugins(dataRoot, resources)).toMatchObject({ updated: ['findings'] })
      const updated = await bootLoaded()
      expect((await call(`/v1/p/findings/tasks/task-a/observations/${observationId}`, device())).status).toBe(200)
      await updated.host.dispose()
      running = null

      const dir = pluginDir(dataRoot, 'findings')
      const liveJournalPath = join(dir, 'migrations/meta/_journal.json')
      const goodJournal = readFileSync(liveJournalPath, 'utf8')
      const broken = JSON.parse(goodJournal) as typeof journal
      const brokenIndex = broken.entries.length
      writeFileSync(join(dir, `migrations/${String(brokenIndex).padStart(4, '0')}_broken.sql`), 'CREATE TABLE `observations` (`id` text);')
      broken.entries.push({ idx: brokenIndex, version: '6', when: Date.now(), tag: `${String(brokenIndex).padStart(4, '0')}_broken`, breakpoints: true })
      writeFileSync(liveJournalPath, JSON.stringify(broken))
      const error = vi.spyOn(console, 'error').mockImplementation(() => {})
      const failed = await bootLoaded()
      try {
        expect(failed.host.failed.map((entry) => entry.name)).toContain('findings')
        expect(pluginRouteContributions().some((entry) => entry.plugin === 'findings')).toBe(false)
      } finally {
        error.mockRestore()
        rmSync(join(dir, `migrations/${String(brokenIndex).padStart(4, '0')}_broken.sql`), { force: true })
        writeFileSync(liveJournalPath, goodJournal)
      }
      await failed.host.dispose()
      running = null
      await bootLoaded()
      expect((await call(`/v1/p/findings/tasks/task-a/observations/${observationId}`, device())).status).toBe(200)
    } finally {
      rmSync(resources, { recursive: true, force: true })
    }
  }, 90_000)

  it('keeps state across disable/re-enable and ordinary uninstall/reinstall', async () => {
    await running?.dispose()
    running = null
    const disabled = await bootLoaded(['findings'])
    expect(disabled.host.skipped).toContain('findings')
    expect(disabled.host.enabled, JSON.stringify(disabled.host.failed)).toContain('memory')
    expect(pluginRouteContributions().some((entry) => entry.plugin === 'findings')).toBe(false)
    expect(agentToolContributions().some((entry) => entry.name === 'findings_record')).toBe(false)
    const disconnected = await call('/v1/p/architecture-review/record', device({
      taskId: 'task-a', sourceKey: 'after-disable', title: 'Must not record', body: 'The writer was revoked.',
    }))
    expect(disconnected.status).toBe(503)
    const unavailable = await call('/v1/core/tasks/task-a/tools/memory_write', task({
      scope: 'project', name: 'disabled-memory', type: 'reference', description: 'No review queue needed.', body: 'Findings is disabled.',
    }, 'session-1'))
    expect(unavailable.status).toBe(200)
    expect(await unavailable.json()).toMatchObject({ changeId: expect.any(String) })
    expect(existsSync(join(dataRoot, 'memory/projects/project/disabled-memory.md'))).toBe(true)
    expect((await call('/v1/p/memory/tasks/task-a/memory', device({
      scope: 'project', name: 'manual-while-disabled', type: 'reference', description: 'Owner-authored memory.', body: 'Saved directly by the owner.',
    }))).status).toBe(200)
    expect(core.db.select().from(schema.tasks).all().some((row) => row.id === 'task-a')).toBe(true)
    expect(existsSync(join(dataRoot, 'memory-proposals'))).toBe(false)
    await disabled.host.dispose()
    running = null

    const dir = pluginDir(dataRoot, 'findings')
    const parked = mkdtempSync(join(tmpdir(), 'acorn-findings-parked-'))
    try {
      cpSync(dir, join(parked, 'findings'), { recursive: true })
      expect(uninstallPlugin(dataRoot, 'findings')).toEqual({ restartRequired: true, dataPurged: false })
      expect(existsSync(pluginDbPath(dataRoot, 'findings'))).toBe(true)
      const gone = await loadExternalPlugins(dataRoot, { builtins: ['memory'] })
      expect(gone.loaded.some((entry) => entry.manifest.id === 'findings')).toBe(false)
      expect(gone.failures).toEqual([expect.objectContaining({ id: 'architecture-review', reason: expect.stringContaining("requires the plugin 'findings'") })])
      await expect(installPlugin(dataRoot, { path: join(parked, 'findings') })).resolves.toMatchObject({
        id: 'findings', state: 'installed-restart-required',
      })
      await bootLoaded()
      const restored = await call(`/v1/p/findings/tasks/task-a/observations/${observationId}`, device())
      expect(await restored.json()).toMatchObject({ id: observationId })
    } finally {
      rmSync(parked, { recursive: true, force: true })
    }
  }, 60_000)
})
