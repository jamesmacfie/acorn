import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { findingsPlugin } from '@acorn/plugin-findings/node/index.ts'
import { memoryPlugin } from '@acorn/plugin-memory/node/index.ts'
import { mintInternalToken } from '@acorn/node-core/server/auth/internalTokens.ts'
import { memoryIdentityStore } from '@acorn/node-core/server/activeIdentity.ts'
import { createCoreServices } from '@acorn/node-core/server/core/index.ts'
import { initPlugins, type LoadedPluginBinding } from '@acorn/node-core/server/pluginHost/host.ts'
import { CapabilityRegistry } from '@acorn/node-core/server/pluginHost/capabilities.ts'
import { agentToolContributions } from '@acorn/node-core/server/agentTools/registry.ts'
import { pluginRouteContributions } from '@acorn/node-core/server/routeRegistry.ts'
import { createApp } from '@acorn/node-core/server/index.ts'
import { reconcileBundledPlugins } from '@acorn/node-core/server/plugins/bundled.ts'
import { loadExternalPlugins, type LoadedPlugin } from '@acorn/node-core/server/plugins/loader.ts'
import { installPlugin, pluginDir, uninstallPlugin } from '@acorn/node-core/server/plugins/installer.ts'
import { pluginDbPath } from '@acorn/node-core/server/plugins/storage.ts'
import { schema } from '@acorn/node-core/server/db/index.ts'
import { makeTestDb, testEnv, type TestDb } from '@acorn/node-core/testkit/db.ts'
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
  destinations: entry.manifest.contributions.frames.flatMap((surface) => surface.destinations ?? []),
  dir: entry.dir,
})

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
    const host = await initPlugins([memoryPlugin(dataRoot), ...entries.map((entry) => entry.plugin)], {
      capabilities: new CapabilityRegistry(),
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
    running = await initPlugins([compiled, memoryPlugin(dataRoot)], {
      capabilities: new CapabilityRegistry(),
      core: createCoreServices({ db: core.db, secrets: core.secrets, activeIdentity: memoryIdentityStore('owner') }),
      dataDir: dataRoot,
      env,
    })
    const recorded = await call('/v2/p/findings/tasks/task-a/observations', device({
      sourceKey: 'compiled-one', title: 'Compiled finding', body: 'Persist this identity across cutover.', claimStatus: 'observed', evidence: [],
    }))
    expect(recorded.status).toBe(200)
    observationId = (await recorded.json() as { id: string }).id
    const prepared = await call('/v2/p/findings/tasks/task-a/review/prepare', device({ boundaryKey: 'compiled:cutover' }))
    expect(prepared.status).toBe(200)
    for (let attempt = 0; attempt < 40 && !candidateId; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10))
      const bundles = await call('/v2/p/findings/review/bundles?scope=project&projectId=project&history=true', device())
      const rows = await bundles.json() as Array<{ candidates: Array<{ candidateId: string }> }>
      candidateId = rows[0]?.candidates[0]?.candidateId ?? ''
    }
    expect(candidateId).not.toBe('')
    const currentCandidate = await call(`/v2/p/findings/review/candidates/${candidateId}`, device())
    const currentRevision = (await currentCandidate.json() as { revision: number }).revision
    const dismissed = await call(`/v2/p/findings/review/candidates/${candidateId}/decision`, device({
      expectedRevision: currentRevision, action: 'dismiss', idempotencyKey: 'compiled-dismiss',
    }))
    expect(dismissed.status).toBe(200)
    const reasoned = await call(`/v2/p/findings/review/candidates/${candidateId}/decision`, device({
      expectedRevision: currentRevision, action: 'dismiss-reason', reason: 'Preserve this dismissal.', idempotencyKey: 'compiled-dismiss-reason',
    }))
    expect(reasoned.status).toBe(200)
    await running.dispose()
    running = null

    mkdirSync(join(dataRoot, 'memory-proposals'), { recursive: true })
    writeFileSync(join(dataRoot, 'memory-proposals/legacy.json'), JSON.stringify({
      id: 'legacy', taskId: 'task-a', projectId: 'project', name: 'legacy-proposal', type: 'reference',
      description: 'Imported through the memory-owned source seam.', body: 'Legacy body', flags: [],
      status: 'pending', originSessionId: null, createdAt: now,
    }))
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
  })

  it('loads its packaged node, migrations, portable tree, permissions, and stable carriers', async () => {
    const { host, entries, installed } = await bootLoaded()
    expect(host.failed).toEqual([])
    expect(host.enabled).toEqual(expect.arrayContaining(['findings', 'architecture-review']))
    const findings = entries.find((entry) => entry.manifest.id === 'findings')!
    expect(findings.plugin).not.toHaveProperty('migrationsModule')
    expect(findings.manifest.permissions).toMatchObject({
      api: [],
      node: { capabilities: ['agents.reviewInput.v1'], secrets: false, exec: false, net: [] },
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

  it('preserves compiled IDs, candidate revisions, dismissal history, and legacy mappings', async () => {
    const observation = await call(`/v2/p/findings/tasks/task-a/observations/${observationId}`, device())
    expect(observation.status).toBe(200)
    expect(await observation.json()).toMatchObject({ id: observationId, title: 'Compiled finding' })
    const candidate = await call(`/v2/p/findings/review/candidates/${candidateId}`, device())
    expect(await candidate.json()).toMatchObject({ candidateId, status: 'dismissed' })
    const history = await call(`/v2/p/findings/review/candidates/${candidateId}/history`, device())
    const actions = (await history.json() as { items: Array<{ action: string; reason: string | null }> }).items
    expect(actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'dismiss-reason', reason: 'Preserve this dismissal.' }),
      expect.objectContaining({ action: 'dismiss' }),
    ]))
    const report = await call('/v2/p/findings/migration/report', device())
    const migration = await report.json() as { cutoverReady: boolean; imported: { pending: number }; errors: number; changed: number }
    expect(migration.errors, JSON.stringify(migration)).toBe(0)
    expect(migration.changed).toBe(0)
    expect(migration).toMatchObject({ cutoverReady: true, imported: { pending: 1 } })
  })

  it('dispatches stable task tools/context and rejects interactive access to their private handlers', async () => {
    const tools = await call('/v2/core/tasks/task-a/tools', task(undefined, 'session-1'))
    expect((await tools.json() as { tools: Array<{ name: string }> }).tools.map((entry) => entry.name)).toEqual(expect.arrayContaining([
      'findings_record', 'findings_list', 'findings_get', 'findings_withdraw',
    ]))
    const recorded = await call('/v2/core/tasks/task-a/tools/findings_record', task({
      sourceKey: 'loaded-tool', title: 'Loaded tool finding', body: 'Through the host dispatcher.', claimStatus: 'asked', evidence: [],
    }, 'session-1'))
    const recordedBody = await recorded.json()
    expect(recorded.status, JSON.stringify(recordedBody)).toBe(200)
    const context = await call('/v2/core/tasks/task-a/context?include=findings:task_findings', task())
    expect(await context.json()).toMatchObject({ sections: [expect.objectContaining({ id: 'findings:task_findings', items: expect.any(Array) })] })
    expect((await call('/v2/p/findings/runtime/tools/list', device({ arguments: {}, origin: { taskId: 'task-a' } }))).status).toBe(403)
    expect((await call('/v2/p/findings/tasks/task-b/observations/' + observationId, device())).status).toBe(404)
  })

  it('keeps maximum legal records readable through byte-aware loaded carriers', async () => {
    const prefix = 'https://example.com/'
    const evidenceUrl = prefix + 'x'.repeat(2_048 - prefix.length)
    const body = '€'.repeat(Math.floor((16 * 1024) / 3))
    const ids: string[] = []
    for (let index = 0; index < 5; index += 1) {
      const response = await call('/v2/p/findings/tasks/task-a/observations', device({
        sourceKey: `carrier-max-${index}`,
        title: `Carrier maximum ${index} ${'x'.repeat(170)}`,
        body,
        claimStatus: 'observed',
        evidence: Array.from({ length: 20 }, () => ({ kind: 'url', url: evidenceUrl, label: 'x'.repeat(200) })),
      }))
      expect(response.status).toBe(200)
      ids.push((await response.json() as { id: string }).id)
    }

    const get = await call('/v2/core/tasks/task-a/tools/findings_get', task({ id: ids[0] }))
    expect(get.status).toBe(200)
    const list = await call('/v2/core/tasks/task-a/tools/findings_list', task({ limit: 100, state: 'active' }))
    const listText = await list.text()
    expect(list.status, listText).toBe(200)
    expect(Buffer.byteLength(listText, 'utf8')).toBeLessThanOrEqual(256 * 1024)
    expect(JSON.parse(listText)).toMatchObject({ nextCursor: expect.any(String) })

    const context = await call('/v2/core/tasks/task-a/context?include=findings:task_findings', task())
    const contextBody = await context.json() as { sections: Array<{ id: string; items: unknown[]; absent?: unknown }> }
    expect(context.status).toBe(200)
    expect(contextBody.sections[0]).toMatchObject({ id: 'findings:task_findings', items: expect.any(Array) })
    expect(contextBody.sections[0]?.absent).toBeUndefined()
  })

  it('accepts a namespaced observation from an independently installed producer', async () => {
    const response = await call('/v2/p/architecture-review/record', device({
      taskId: 'task-a', sourceKey: 'architecture-1', title: 'Boundary leak', body: 'A private implementation escaped its owner.',
    }))
    expect(response.status).toBe(201)
    const id = (await response.json() as { id: string }).id
    const recorded = await call(`/v2/p/findings/tasks/task-a/observations/${id}`, device())
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
      expect((await call(`/v2/p/findings/tasks/task-a/observations/${observationId}`, device())).status).toBe(200)
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
      expect((await call(`/v2/p/findings/tasks/task-a/observations/${observationId}`, device())).status).toBe(200)
    } finally {
      rmSync(resources, { recursive: true, force: true })
    }
  }, 90_000)

  it('keeps state across disable/re-enable and ordinary uninstall/reinstall', async () => {
    await running?.dispose()
    running = null
    const disabled = await bootLoaded(['findings'])
    expect(disabled.host.skipped).toContain('findings')
    expect(pluginRouteContributions().some((entry) => entry.plugin === 'findings')).toBe(false)
    expect(agentToolContributions().some((entry) => entry.name === 'findings_record')).toBe(false)
    const disconnected = await call('/v2/p/architecture-review/record', device({
      taskId: 'task-a', sourceKey: 'after-disable', title: 'Must not record', body: 'The writer was revoked.',
    }))
    expect(disconnected.status).toBe(503)
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
      const restored = await call(`/v2/p/findings/tasks/task-a/observations/${observationId}`, device())
      expect(await restored.json()).toMatchObject({ id: observationId })
    } finally {
      rmSync(parked, { recursive: true, force: true })
    }
  }, 60_000)
})
