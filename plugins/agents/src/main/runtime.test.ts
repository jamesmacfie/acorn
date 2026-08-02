import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { schema } from '@acorn/node-core/server/db/index.ts'
import { makeTestDb, type TestDb } from '@acorn/node-core/server/routes/testDb.ts'
import type { AgentProviderDescriptor } from '@acorn/protocol/managedAgents.ts'
import type {
  AgentDriver,
  AgentDriverSession,
  AgentDriverStartOptions,
} from './drivers/types'
import { AgentDriverRegistry } from './drivers/registry'
import { FakeAgentDriver } from './drivers/fake'
import { ManagedAgentRuntime } from './runtime'

const ENCRYPTION_KEY = '11'.repeat(32)

type Seed = {
  taskId: string
  workspaceId: string
  worktree: string
}

async function seedTask(testDb: TestDb, root: string, repoName = 'runtime-test'): Promise<Seed> {
  const timestamp = Date.now()
  const taskId = randomUUID()
  const workspaceId = randomUUID()
  const worktree = join(root, `worktree-${repoName}`)
  await import('node:fs/promises').then((fs) => fs.mkdir(worktree))
  await testDb.db.insert(schema.workspaces).values({
    id: workspaceId,
    name: 'Test workspace',
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  await testDb.db.insert(schema.workspaceRepos).values({
    workspaceId,
    repoOwner: 'acorn',
    repoName,
    createdAt: timestamp,
  })
  await testDb.db.insert(schema.repoPaths).values({
    owner: 'acorn',
    repo: repoName,
    path: worktree,
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  await testDb.db.insert(schema.tasks).values({
    id: taskId,
    title: 'Runtime test',
    origin: 'local',
    repoOwner: 'acorn',
    repoName,
    branch: 'test',
    worktreePath: worktree,
    status: 'active',
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  return { taskId, workspaceId, worktree }
}

const descriptor = (id: string): AgentProviderDescriptor => ({
  id,
  profileId: id,
  label: `Test ${id}`,
  driverKind: 'acp',
  driverVersion: 'test-1',
  installed: true,
  authenticated: true,
  statusAuthority: 'protocol',
  capabilities: ['streaming_messages', 'permissions', 'resume'],
  configOptions: [],
  commands: [],
  skills: [],
  diagnostics: [],
})

class RequestDriver implements AgentDriver {
  readonly providerId = 'request-test'
  readonly profileId = 'request-test'
  resolutions = 0

  async probe(): Promise<AgentProviderDescriptor> {
    return descriptor(this.providerId)
  }

  async start(options: AgentDriverStartOptions): Promise<AgentDriverSession> {
    const providerSessionRef = options.session.providerSessionRef ?? randomUUID()
    let ready = true
    await options.onEvent({ type: 'session_metadata', providerSessionRef })
    await options.onEvent({ type: 'session_state', state: 'ready' })
    return {
      providerSessionRef,
      get ready() {
        return ready
      },
      async sendTurn() {
        ready = false
        await options.onEvent({
          type: 'request',
          requestId: 'permission-1',
          kind: 'permission',
          title: 'Run the test command?',
          options: [{ id: 'allow-once', label: 'Allow once', kind: 'allow_once' }],
        })
        return { providerTurnRef: 'provider-turn-1' }
      },
      async cancel() {
        ready = true
      },
      resolveRequest: async () => {
        this.resolutions++
        await new Promise((resolve) => setTimeout(resolve, 20))
        ready = true
        await options.onEvent({ type: 'turn_completed', stopReason: 'end_turn' })
      },
      async stop() {
        ready = false
      },
    }
  }
}

class SafeRetryDriver implements AgentDriver {
  readonly providerId = 'retry-test'
  readonly profileId = 'retry-test'
  attempts = 0

  async probe(): Promise<AgentProviderDescriptor> {
    return descriptor(this.providerId)
  }

  classifyTurnFailure(): 'safe_transient' {
    return 'safe_transient'
  }

  async start(options: AgentDriverStartOptions): Promise<AgentDriverSession> {
    const providerSessionRef = randomUUID()
    let ready = true
    await options.onEvent({ type: 'session_metadata', providerSessionRef })
    await options.onEvent({ type: 'session_state', state: 'ready' })
    return {
      providerSessionRef,
      get ready() {
        return ready
      },
      sendTurn: async () => {
        this.attempts++
        if (this.attempts === 1) throw new Error('transient before provider acceptance')
        ready = false
        await options.onEvent({ type: 'assistant_message', text: 'Recovered safely.' })
        await options.onEvent({ type: 'turn_completed', stopReason: 'end_turn' })
        ready = true
        return {}
      },
      async cancel() {
        ready = true
      },
      async resolveRequest() {
        throw new Error('No request is pending.')
      },
      async stop() {
        ready = false
      },
    }
  }
}

class FailingStartDriver implements AgentDriver {
  readonly providerId = 'failing-start'
  readonly profileId = 'failing-start'
  noProviderExecutionHistory: boolean | null = null

  async probe(): Promise<AgentProviderDescriptor> {
    return descriptor(this.providerId)
  }

  async start(options: AgentDriverStartOptions): Promise<AgentDriverSession> {
    this.noProviderExecutionHistory = options.noProviderExecutionHistory
    throw new Error('provider account is unavailable')
  }
}

describe('managed agent runtime conformance', () => {
  let testDb: TestDb
  let dataDir: string
  let runtime: ManagedAgentRuntime | null

  beforeEach(async () => {
    testDb = makeTestDb()
    dataDir = await mkdtemp(join(tmpdir(), 'acorn-managed-runtime-'))
    runtime = null
  })

  afterEach(async () => {
    await runtime?.stop()
    testDb.cleanup()
    await rm(dataDir, { recursive: true, force: true })
  })

  it('persists a provider transcript before publishing ordered events', async () => {
    const seed = await seedTask(testDb, dataDir)
    const registry = new AgentDriverRegistry()
    registry.register('fake', () => new FakeAgentDriver())
    const published: number[] = []
    runtime = new ManagedAgentRuntime({
      db: testDb.db,
      dataDir,
      internalApiEnv: {},
      encryptionKey: ENCRYPTION_KEY,
      currentUserId: () => null,
      registry,
      publish: (frame) => {
        if (frame.channel === 'agent:event') published.push(frame.event.seq)
      },
    })

    const session = await runtime.createSession({
      taskId: seed.taskId,
      providerId: 'fake',
      profileId: 'fake',
      kind: 'interactive',
      config: {},
    })
    const turn = await runtime.enqueueTurn(session.id, {
      input: [{ type: 'text', text: 'Exercise the protocol.' }],
      source: 'interactive',
      effectivePolicy: { providerDefault: true },
      idempotencyKey: randomUUID(),
    })
    const snapshot = await runtime.wait(session.id, 0, 'turn_completed', 2_000)

    expect(snapshot.session.providerSessionRef).toMatch(/^fake-/)
    expect(snapshot.session.runtimeState).toBe('ready')
    expect(snapshot.turns.find((candidate) => candidate.id === turn.id)?.status).toBe('completed')
    expect(snapshot.events.map((event) => event.seq)).toEqual(
      snapshot.events.map((_, index) => index + 1),
    )
    expect(published).toEqual([...published].sort((a, b) => a - b))
    expect(snapshot.events.some((event) => event.event.type === 'assistant_message')).toBe(true)
  })

  it('acknowledges a durable queued turn even when provider startup fails afterward', async () => {
    const seed = await seedTask(testDb, dataDir)
    const registry = new AgentDriverRegistry()
    const driver = new FailingStartDriver()
    registry.register(driver.providerId, () => driver)
    runtime = new ManagedAgentRuntime({
      db: testDb.db,
      dataDir,
      internalApiEnv: {},
      encryptionKey: ENCRYPTION_KEY,
      currentUserId: () => null,
      registry,
    })
    const session = await runtime.store.createSession({
      taskId: seed.taskId,
      providerId: driver.providerId,
      profileId: driver.profileId,
      kind: 'interactive',
      config: {},
    }, descriptor(driver.providerId))

    const turn = await runtime.enqueueTurn(session.id, {
      input: [{ type: 'text', text: 'Keep this queued.' }],
      source: 'interactive',
      effectivePolicy: {},
      idempotencyKey: randomUUID(),
    })
    const failed = await runtime.wait(session.id, 0, 'stopped', 2_000)

    expect(turn.status).toBe('queued')
    expect(driver.noProviderExecutionHistory).toBe(true)
    expect(failed.session.runtimeState).toBe('failed')
    expect(failed.turns.find((candidate) => candidate.id === turn.id)?.status).toBe('queued')
    expect(failed.events.some((record) =>
      record.event.type === 'error' && record.event.code === 'provider_start_failed')).toBe(true)
    expect(await runtime.store.hasProviderExecutionHistory(session.id)).toBe(false)

    await runtime.store.startTurn(turn.id)
    expect(await runtime.store.hasProviderExecutionHistory(session.id)).toBe(true)
  })

  it('edits, reorders, and removes durable queued turns', async () => {
    const seed = await seedTask(testDb, dataDir)
    runtime = new ManagedAgentRuntime({
      db: testDb.db,
      dataDir,
      internalApiEnv: {},
      encryptionKey: ENCRYPTION_KEY,
      currentUserId: () => null,
      registry: new AgentDriverRegistry(),
    })
    const session = await runtime.store.createSession({
      taskId: seed.taskId,
      providerId: 'fake',
      profileId: 'fake',
      kind: 'interactive',
      config: {},
    }, descriptor('fake'))
    const first = await runtime.store.enqueueTurn(session.id, {
      input: [{ type: 'text', text: 'First prompt.' }],
      source: 'interactive',
      effectivePolicy: {},
      idempotencyKey: randomUUID(),
    })
    const second = await runtime.store.enqueueTurn(session.id, {
      input: [{ type: 'text', text: 'Second prompt.' }],
      source: 'interactive',
      effectivePolicy: {},
      idempotencyKey: randomUUID(),
    })

    await runtime.patchQueuedTurn(session.id, second.id, {
      input: [{ type: 'text', text: 'Edited second prompt.' }],
    })
    await runtime.patchQueuedTurn(session.id, first.id, { ordinal: 1 })
    let snapshot = await runtime.store.snapshot(session.id)
    expect(snapshot.turns.map((turn) => turn.id)).toEqual([second.id, first.id])
    expect(snapshot.turns[0]?.input).toEqual([{ type: 'text', text: 'Edited second prompt.' }])

    await runtime.cancelTurn(session.id, first.id)
    snapshot = await runtime.store.snapshot(session.id)
    expect(snapshot.turns.find((turn) => turn.id === first.id)?.status).toBe('cancelled')
    expect(snapshot.turns.filter((turn) => turn.status === 'queued').map((turn) => turn.id)).toEqual([second.id])
  })

  it('deletes local history without starting a provider that has no resumable session', async () => {
    const seed = await seedTask(testDb, dataDir)
    const registry = new AgentDriverRegistry()
    const driver = new FailingStartDriver()
    registry.register(driver.providerId, () => driver)
    runtime = new ManagedAgentRuntime({
      db: testDb.db,
      dataDir,
      internalApiEnv: {},
      encryptionKey: ENCRYPTION_KEY,
      currentUserId: () => null,
      registry,
    })
    const session = await runtime.store.createSession({
      taskId: seed.taskId,
      providerId: driver.providerId,
      profileId: driver.profileId,
      kind: 'interactive',
      config: {},
    }, descriptor(driver.providerId))

    await expect(runtime.deleteSession(session.id)).resolves.toEqual({
      local: 'deleted',
      provider: 'unsupported',
    })
    expect(driver.noProviderExecutionHistory).toBeNull()
    await expect(runtime.store.requireSession(session.id)).rejects.toThrow('Managed agent session not found')
  })

  it('scopes session lists and full-text search to one workspace', async () => {
    const firstSeed = await seedTask(testDb, dataDir, 'workspace-one')
    const secondSeed = await seedTask(testDb, dataDir, 'workspace-two')
    runtime = new ManagedAgentRuntime({
      db: testDb.db,
      dataDir,
      internalApiEnv: {},
      encryptionKey: ENCRYPTION_KEY,
      currentUserId: () => null,
      registry: new AgentDriverRegistry(),
    })
    const first = await runtime.store.createSession({
      taskId: firstSeed.taskId,
      providerId: 'fake',
      profileId: 'fake',
      kind: 'interactive',
      config: {},
    }, descriptor('fake'))
    const second = await runtime.store.createSession({
      taskId: secondSeed.taskId,
      providerId: 'fake',
      profileId: 'fake',
      kind: 'interactive',
      config: {},
    }, descriptor('fake'))
    await runtime.store.recordEvent(first.id, null, {
      type: 'assistant_message',
      text: 'shared workspace needle',
    })
    await runtime.store.recordEvent(second.id, null, {
      type: 'assistant_message',
      text: 'shared workspace needle',
    })

    const listed = await runtime.store.listSessions({ workspaceId: firstSeed.workspaceId })
    const searched = await runtime.store.searchSessions('workspace needle', {
      workspaceId: firstSeed.workspaceId,
    })
    expect(listed.sessions.map((session) => session.id)).toEqual([first.id])
    expect(searched.map((session) => session.id)).toEqual([first.id])
  })

  it('durably claims a provider request so concurrent responses are sent once', async () => {
    const seed = await seedTask(testDb, dataDir)
    const registry = new AgentDriverRegistry()
    const driver = new RequestDriver()
    registry.register(driver.providerId, () => driver)
    runtime = new ManagedAgentRuntime({
      db: testDb.db,
      dataDir,
      internalApiEnv: {},
      encryptionKey: ENCRYPTION_KEY,
      currentUserId: () => null,
      registry,
    })
    const session = await runtime.createSession({
      taskId: seed.taskId,
      providerId: driver.providerId,
      profileId: driver.profileId,
      kind: 'interactive',
      config: {},
    })
    await runtime.enqueueTurn(session.id, {
      input: [{ type: 'text', text: 'Ask first.' }],
      source: 'interactive',
      effectivePolicy: {},
      idempotencyKey: randomUUID(),
    })
    await runtime.wait(session.id, 0, 'attention', 2_000)

    const key = randomUUID()
    await Promise.all([
      runtime.resolveRequest(session.id, 'permission-1', { optionId: 'allow-once' }, key),
      runtime.resolveRequest(session.id, 'permission-1', { optionId: 'allow-once' }, key),
    ])

    expect(driver.resolutions).toBe(1)
    expect((await runtime.store.request(session.id, 'permission-1'))?.status).toBe('resolved')
  })

  it('retries only a driver-classified transient turn with no accepted response', async () => {
    const seed = await seedTask(testDb, dataDir)
    const registry = new AgentDriverRegistry()
    const driver = new SafeRetryDriver()
    registry.register(driver.providerId, () => driver)
    runtime = new ManagedAgentRuntime({
      db: testDb.db,
      dataDir,
      internalApiEnv: {},
      encryptionKey: ENCRYPTION_KEY,
      currentUserId: () => null,
      registry,
    })
    const session = await runtime.createSession({
      taskId: seed.taskId,
      providerId: driver.providerId,
      profileId: driver.profileId,
      kind: 'interactive',
      config: {},
    })
    const turn = await runtime.enqueueTurn(session.id, {
      input: [{ type: 'text', text: 'Retry safely.' }],
      source: 'interactive',
      effectivePolicy: {},
      idempotencyKey: randomUUID(),
    })
    const snapshot = await runtime.wait(session.id, 0, 'turn_completed', 2_000)

    expect(driver.attempts).toBe(2)
    expect(snapshot.turns.find((candidate) => candidate.id === turn.id)?.attempt).toBe(2)
    expect(snapshot.events.some((record) =>
      record.event.type === 'diagnostic' && record.event.message.includes('retrying'))).toBe(true)
  })
})
