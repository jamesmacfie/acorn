import { randomUUID } from 'node:crypto'
import { SecretService } from '@acorn/node-core/server/core/secrets.ts'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { agentProfileRegistry } from '@acorn/plugin-api/node'
import { memoryIdentityStore } from '@acorn/node-core/server/activeIdentity.ts'
import { createCoreServices, type CoreServices } from '@acorn/node-core/server/core/index.ts'
import { makeTestDb, makeTestPluginDb, schema, type TestDb, type TestPluginDb } from '@acorn/plugin-api/testkit'
import type { AgentNormalizedEvent, AgentProviderDescriptor } from '@acorn/protocol/managedAgents.ts'
import type {
  AgentDriver,
  AgentDriverSession,
  AgentDriverStartOptions,
} from '../drivers/types'
import { AgentDriverRegistry } from '../drivers/registry'
import { FakeAgentDriver } from '../drivers/fake'
import { ManagedAgentRuntime } from './runtime'
import { writeAgentConcurrency } from '../concurrencyStore'
import { readAgentSessionDefaults, writeAgentSessionDefaults } from '../sessionDefaultsStore'
import type { AgentLifecycleFrame } from '../../contract/lifecycle'

const ENCRYPTION_KEY = '11'.repeat(32)
const SECRETS = new SecretService(ENCRYPTION_KEY)

type Seed = {
  taskId: string
  workspaceId: string
  worktree: string
}

async function seedTask(testDb: TestDb, root: string, projectName = 'runtime-test'): Promise<Seed> {
  const timestamp = Date.now()
  const taskId = randomUUID()
  const workspaceId = randomUUID()
  const worktree = join(root, `worktree-${projectName}`)
  await import('node:fs/promises').then((fs) => fs.mkdir(worktree))
  await testDb.db.insert(schema.workspaces).values({
    id: workspaceId,
    name: 'Test workspace',
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  await testDb.db.insert(schema.projects).values({
    id: `project-${projectName}`,
    name: projectName,
    path: worktree,
    workspaceId,
    sort: 0,
    hidden: false,
    vcs: 'git',
    defaultBranch: 'main',
    remoteUrl: null,
    githubOwner: 'acorn',
    githubName: projectName,
    githubRepoId: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  await testDb.db.insert(schema.tasks).values({
    id: taskId,
    title: 'Runtime test',
    origin: 'local',
    projectId: `project-${projectName}`,
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

/** Blocks inside start() until the test releases it, so a pump scan can be held mid-pass. */
class GatedStartDriver implements AgentDriver {
  readonly providerId = 'gated-start'
  readonly profileId = 'gated-start'
  #entered!: () => void
  #release!: (error: Error) => void
  readonly entered = new Promise<void>((resolve) => {
    this.#entered = resolve
  })
  readonly #gate = new Promise<never>((_, reject) => {
    this.#release = reject
  })

  async probe(): Promise<AgentProviderDescriptor> {
    return descriptor(this.providerId)
  }

  release(): void {
    this.#release(new Error('provider never came up'))
  }

  async start(): Promise<AgentDriverSession> {
    this.#entered()
    return this.#gate
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

/** Holds the provider handshake open so creation acknowledgement and readiness can be asserted
 * independently. The real Claude and Codex drivers spend this interval negotiating their protocol
 * sessions; a test gate makes that delay deterministic. */
class DeferredStartDriver implements AgentDriver {
  readonly providerId = 'deferred-start'
  readonly profileId = 'deferred-start'
  stops = 0
  #entered!: () => void
  #release!: () => void
  readonly entered = new Promise<void>((resolve) => {
    this.#entered = resolve
  })
  readonly #gate = new Promise<void>((resolve) => {
    this.#release = resolve
  })

  async probe(): Promise<AgentProviderDescriptor> {
    return descriptor(this.providerId)
  }

  release(): void {
    this.#release()
  }

  async start(options: AgentDriverStartOptions): Promise<AgentDriverSession> {
    const providerSessionRef = randomUUID()
    await options.onEvent({ type: 'session_state', state: 'connecting' })
    this.#entered()
    await this.#gate
    await options.onEvent({ type: 'session_metadata', providerSessionRef })
    await options.onEvent({ type: 'session_state', state: 'ready' })
    return {
      providerSessionRef,
      ready: true,
      async sendTurn() { return {} },
      async cancel() {},
      async resolveRequest() {},
      stop: async () => { this.stops++ },
    }
  }
}

/** Keeps streaming after the prompt call it was answering has already returned. Claude Code did this
 *  five minutes past an `end_turn`, and the trailing message stranded the session in 'working'. */
class TrailingEventDriver extends FakeAgentDriver {
  #emit: AgentDriverStartOptions['onEvent'] | null = null

  override async start(options: AgentDriverStartOptions): Promise<AgentDriverSession> {
    this.#emit = options.onEvent
    return super.start(options)
  }

  async push(event: AgentNormalizedEvent): Promise<void> {
    await this.#emit?.(event)
  }
}

describe('managed agent runtime conformance', () => {
  // Two real databases, matching the shape of the thing under test. `testDb` is core's, holding the
  // workspace, project, and task rows seedTask writes, which the runtime reaches through CoreServices.
  // `pluginDb` is this plugin's own migrated file, holding every `agent_*` table and the
  // `agent_events_fts` virtual table the workspace search case exercises.
  //
  // The workspace-scoping case below is the load-bearing one: before the split it passed through a SQL
  // join across these two, and it still passes through an id round trip. If `idsForWorkspace` ever
  // returned the wrong set, or fell back to unfiltered on an empty workspace, this is what fails.
  let testDb: TestDb
  let pluginDb: TestPluginDb
  let core: CoreServices
  let dataDir: string
  let runtime: ManagedAgentRuntime | null
  let disposeProfile: (() => void) | null

  beforeEach(async () => {
    testDb = makeTestDb()
    pluginDb = makeTestPluginDb('agents')
    core = createCoreServices({ secrets: SECRETS, db: testDb.db, activeIdentity: memoryIdentityStore() })
    dataDir = await mkdtemp(join(tmpdir(), 'acorn-managed-runtime-'))
    runtime = null
    disposeProfile = null
  })

  afterEach(async () => {
    await runtime?.stop()
    disposeProfile?.()
    pluginDb.cleanup()
    testDb.cleanup()
    await rm(dataDir, { recursive: true, force: true })
  })

  const registerTitleProfile = (id: string) => {
    disposeProfile = agentProfileRegistry.register({
      id,
      label: 'Title test',
      kind: 'agent',
      command: '/bin/true',
      backendPreference: 'node-pty',
      transport: 'pty',
      aiArgv: (command, options) => ({ file: command, args: [options.prompt] }),
    })
  }

  it('acknowledges an interactive session once durable while its provider keeps connecting', async () => {
    const seed = await seedTask(testDb, dataDir)
    const registry = new AgentDriverRegistry()
    const driver = new DeferredStartDriver()
    registry.registerNative(driver.providerId, () => driver)
    runtime = new ManagedAgentRuntime({
      db: pluginDb.db,
      dataDir,
      core,
      internalEnv: () => ({}),
      secrets: SECRETS,
      currentUserId: () => null,
      registry,
    })

    const opening = runtime.acceptSession({
      taskId: seed.taskId,
      providerId: driver.providerId,
      profileId: driver.profileId,
      kind: 'interactive',
      config: {},
    })
    await driver.entered
    const result = await Promise.race([
      opening.then((session) => ({ kind: 'accepted' as const, session })),
      new Promise<{ kind: 'timeout' }>((resolve) => setTimeout(() => resolve({ kind: 'timeout' }), 50)),
    ])
    driver.release()

    expect(result.kind).toBe('accepted')
    if (result.kind !== 'accepted') return
    expect(result.session.runtimeState).toBe('creating')
    expect((await runtime.store.requireSession(result.session.id)).runtimeState).toBe('connecting')
    expect((await runtime.wait(result.session.id, 0, 'ready', 2_000)).session.runtimeState).toBe('ready')
  })

  it('acknowledges a delegated session and its first turn while the provider keeps connecting', async () => {
    const seed = await seedTask(testDb, dataDir)
    const registry = new AgentDriverRegistry()
    const driver = new DeferredStartDriver()
    registry.registerNative(driver.providerId, () => driver)
    runtime = new ManagedAgentRuntime({
      db: pluginDb.db,
      dataDir,
      core,
      internalEnv: () => ({}),
      secrets: SECRETS,
      currentUserId: () => null,
      registry,
    })

    const session = await runtime.acceptSession({
      taskId: seed.taskId,
      providerId: driver.providerId,
      profileId: driver.profileId,
      kind: 'delegated',
      config: { toolCeiling: { allow: ['agent_read'] } },
    })
    await driver.entered
    const turn = await runtime.enqueueTurn(session.id, {
      input: [{ type: 'text', text: 'Report without waiting for startup.' }],
      source: 'delegation',
      effectivePolicy: {},
      idempotencyKey: 'delegated-first-turn',
    })

    expect(session.runtimeState).toBe('creating')
    expect(turn).toMatchObject({ source: 'delegation', status: 'queued' })
    driver.release()
    expect((await runtime.wait(session.id, 0, 'ready', 2_000)).session.runtimeState).toBe('ready')
  })

  it('does not miss a condition committed between the initial wait snapshot and subscription', async () => {
    const seed = await seedTask(testDb, dataDir)
    runtime = new ManagedAgentRuntime({
      db: pluginDb.db,
      dataDir,
      core,
      internalEnv: () => ({}),
      secrets: SECRETS,
      currentUserId: () => null,
      registry: new AgentDriverRegistry(),
    })
    const session = await runtime.store.createSession({
      taskId: seed.taskId,
      providerId: 'fake',
      profileId: 'fake',
      kind: 'delegated',
      config: {},
    }, descriptor('fake'))
    const { turn } = await runtime.store.enqueueTurn(session.id, {
      input: [{ type: 'text', text: 'Finish during the wait setup window.' }],
      source: 'delegation',
      effectivePolicy: {},
      idempotencyKey: 'wait-setup-race',
    })
    const snapshot = runtime.store.snapshot.bind(runtime.store)
    let firstRead = true
    runtime.store.snapshot = async (...args) => {
      const result = await snapshot(...args)
      if (firstRead) {
        firstRead = false
        await runtime!.store.recordEvent(session.id, turn.id, {
          type: 'turn_completed',
          stopReason: 'end_turn',
        })
      }
      return result
    }

    const result = await Promise.race([
      runtime.wait(session.id, 0, 'turn_completed', 1_000),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 100)),
    ])

    expect(result).not.toBeNull()
    expect(result?.events.some((record) => record.event.type === 'turn_completed')).toBe(true)
  })

  it('settles an acknowledged interactive session when provider startup fails', async () => {
    const seed = await seedTask(testDb, dataDir)
    const registry = new AgentDriverRegistry()
    const driver = new FailingStartDriver()
    registry.registerNative(driver.providerId, () => driver)
    runtime = new ManagedAgentRuntime({
      db: pluginDb.db,
      dataDir,
      core,
      internalEnv: () => ({}),
      secrets: SECRETS,
      currentUserId: () => null,
      registry,
    })

    const accepted = await runtime.acceptSession({
      taskId: seed.taskId,
      providerId: driver.providerId,
      profileId: driver.profileId,
      kind: 'interactive',
      config: {},
    })
    const failed = await runtime.wait(accepted.id, 0, 'stopped', 2_000)

    expect(accepted.runtimeState).toBe('creating')
    expect(failed.session.runtimeState).toBe('failed')
    expect(failed.events.some((record) =>
      record.event.type === 'error' && record.event.code === 'provider_start_failed')).toBe(true)
  })

  it('keeps the internal creation contract blocked until the provider is ready', async () => {
    const seed = await seedTask(testDb, dataDir)
    const registry = new AgentDriverRegistry()
    const driver = new DeferredStartDriver()
    registry.registerNative(driver.providerId, () => driver)
    runtime = new ManagedAgentRuntime({
      db: pluginDb.db,
      dataDir,
      core,
      internalEnv: () => ({}),
      secrets: SECRETS,
      currentUserId: () => null,
      registry,
    })

    let settled = false
    const opening = runtime.createSession({
      taskId: seed.taskId,
      providerId: driver.providerId,
      profileId: driver.profileId,
      kind: 'workflow',
      config: {},
    }).then((session) => {
      settled = true
      return session
    })
    await driver.entered
    await Promise.resolve()
    expect(settled).toBe(false)

    driver.release()
    expect((await opening).runtimeState).toBe('ready')
  })

  it('joins an acknowledged session startup before runtime shutdown completes', async () => {
    const seed = await seedTask(testDb, dataDir)
    const registry = new AgentDriverRegistry()
    const driver = new DeferredStartDriver()
    registry.registerNative(driver.providerId, () => driver)
    runtime = new ManagedAgentRuntime({
      db: pluginDb.db,
      dataDir,
      core,
      internalEnv: () => ({}),
      secrets: SECRETS,
      currentUserId: () => null,
      registry,
    })

    await runtime.acceptSession({
      taskId: seed.taskId,
      providerId: driver.providerId,
      profileId: driver.profileId,
      kind: 'interactive',
      config: {},
    })
    await driver.entered
    let stopped = false
    const stopping = runtime.stop().then(() => { stopped = true })
    await Promise.resolve()
    expect(stopped).toBe(false)

    driver.release()
    await stopping
    expect(driver.stops).toBe(1)
    runtime = null
  })

  it('persists a provider transcript before publishing ordered events', async () => {
    const seed = await seedTask(testDb, dataDir)
    const registry = new AgentDriverRegistry()
    registry.registerNative('fake', () => new FakeAgentDriver())
    const published: number[] = []
    const lifecycle: AgentLifecycleFrame[] = []
    runtime = new ManagedAgentRuntime({
      db: pluginDb.db,
      dataDir,
      core,
      internalEnv: () => ({}),
      secrets: SECRETS,
      currentUserId: () => null,
      registry,
      publish: (frame) => {
        if (frame.channel === 'agent:event') published.push(frame.event.seq)
        if (frame.channel.startsWith('plugin:agents:')) lifecycle.push(frame as AgentLifecycleFrame)
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
    expect(lifecycle.filter((frame) => frame.channel === 'plugin:agents:turn-changed')).toEqual([
      { channel: 'plugin:agents:turn-changed', taskId: seed.taskId, sessionId: session.id, turnId: turn.id, source: 'interactive', status: 'queued', attempt: 0 },
      { channel: 'plugin:agents:turn-changed', taskId: seed.taskId, sessionId: session.id, turnId: turn.id, source: 'interactive', status: 'dispatching', attempt: 1 },
      { channel: 'plugin:agents:turn-changed', taskId: seed.taskId, sessionId: session.id, turnId: turn.id, source: 'interactive', status: 'active', attempt: 1 },
      { channel: 'plugin:agents:turn-changed', taskId: seed.taskId, sessionId: session.id, turnId: turn.id, source: 'interactive', status: 'completed', attempt: 1 },
    ])
  })

  it('holds a settled session settled when the provider streams past its turn', async () => {
    const seed = await seedTask(testDb, dataDir)
    const registry = new AgentDriverRegistry()
    const driver = new TrailingEventDriver()
    registry.registerNative('fake', () => driver)
    runtime = new ManagedAgentRuntime({
      db: pluginDb.db,
      dataDir,
      core,
      internalEnv: () => ({}),
      secrets: SECRETS,
      currentUserId: () => null,
      registry,
    })

    const session = await runtime.createSession({
      taskId: seed.taskId,
      providerId: 'fake',
      profileId: 'fake',
      kind: 'interactive',
      config: {},
    })
    await runtime.enqueueTurn(session.id, {
      input: [{ type: 'text', text: 'Exercise the protocol.' }],
      source: 'interactive',
      effectivePolicy: { providerDefault: true },
      idempotencyKey: randomUUID(),
    })
    const completed = await runtime.wait(session.id, 0, 'turn_completed', 2_000)
    expect(completed.session.runtimeState).toBe('ready')

    // A zero timeout makes wait() a plain read of the current snapshot.
    const read = () => runtime!.wait(session.id, 0, 'ready', 0)

    await driver.push({ type: 'assistant_message', text: 'One more thing.' })
    const trailing = await read()

    // The message lands in the transcript and marks the session unread, but it does not claim work is
    // in flight. Nothing would clear that claim: turn_completed only fires as sendTurn's return value.
    expect(trailing.events.at(-1)?.event).toMatchObject({ type: 'assistant_message' })
    expect(trailing.session.runtimeState).toBe('ready')
    expect(trailing.session.attention).toBe('unread')

    // And Stop settles a session that reports work with no turn to cancel, instead of returning
    // quietly and leaving 'working' to block every later dispatch.
    await driver.push({ type: 'session_state', state: 'working' })
    expect((await read()).session.runtimeState).toBe('working')
    await runtime.cancelTurn(session.id)
    expect((await read()).session.runtimeState).toBe('ready')
  })

  it('acknowledges a durable queued turn even when provider startup fails afterward', async () => {
    const seed = await seedTask(testDb, dataDir)
    const registry = new AgentDriverRegistry()
    const driver = new FailingStartDriver()
    registry.registerNative(driver.providerId, () => driver)
    runtime = new ManagedAgentRuntime({
      db: pluginDb.db,
      dataDir,
      core,
      internalEnv: () => ({}),
      secrets: SECRETS,
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

  it('generates a first-turn title in the background and preserves a concurrent user rename', async () => {
    const seed = await seedTask(testDb, dataDir)
    const profileId = 'title-generation-race'
    registerTitleProfile(profileId)
    let resolveGeneration!: (value: Awaited<ReturnType<CoreServices['models']['generateText']>>) => void
    const generation = new Promise<Awaited<ReturnType<CoreServices['models']['generateText']>>>((resolve) => {
      resolveGeneration = resolve
    })
    const generateText = vi.fn(() => generation)
    core.models.generateText = generateText
    const published: Array<{ channel: string; [key: string]: unknown }> = []
    runtime = new ManagedAgentRuntime({
      db: pluginDb.db,
      dataDir,
      core,
      internalEnv: () => ({}),
      secrets: SECRETS,
      currentUserId: () => 'owner',
      registry: new AgentDriverRegistry(),
      publish: (frame) => published.push(frame),
    })
    const session = await runtime.store.createSession({
      taskId: seed.taskId,
      providerId: profileId,
      profileId,
      kind: 'interactive',
      config: {},
    }, descriptor(profileId))
    const key = randomUUID()

    const turn = await runtime.enqueueTurn(session.id, {
      input: [{ type: 'text', text: 'Please implement generated session naming now' }],
      source: 'interactive',
      effectivePolicy: {},
      idempotencyKey: key,
    })
    expect(turn.ordinal).toBe(0)
    expect((await runtime.store.requireSession(session.id)).title).toBe('Please implement generated session naming now')
    expect(generateText).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'owner',
      backendId: `harness:${profileId}`,
      timeoutMs: 30_000,
      input: expect.objectContaining({
        maxOutputTokens: 64,
        prompt: 'First user request:\nPlease implement generated session naming now',
      }),
    }))
    expect(published.some((frame) => frame.channel === 'agent:session'
      && (frame.session as { title?: string }).title === 'Please implement generated session naming now')).toBe(true)

    await runtime.patchSession(session.id, { title: 'My chosen title' })
    resolveGeneration({
      text: 'Generated title should lose',
      providerId: profileId,
      backendId: `harness:${profileId}`,
      modelId: 'default',
    })
    await vi.waitFor(async () => {
      expect((await runtime!.store.requireSession(session.id)).title).toBe('My chosen title')
    })
    await runtime.enqueueTurn(session.id, {
      input: [{ type: 'text', text: 'Please implement generated session naming now' }],
      source: 'interactive',
      effectivePolicy: {},
      idempotencyKey: key,
    })
    expect(generateText).toHaveBeenCalledTimes(1)
  })

  it('publishes a generated title after the fallback', async () => {
    const seed = await seedTask(testDb, dataDir)
    const profileId = 'title-generation-success'
    registerTitleProfile(profileId)
    core.models.generateText = vi.fn(async () => ({
      text: 'Generated session naming',
      providerId: profileId,
      backendId: `harness:${profileId}`,
      modelId: 'default',
    }))
    const titles: string[] = []
    runtime = new ManagedAgentRuntime({
      db: pluginDb.db,
      dataDir,
      core,
      internalEnv: () => ({}),
      secrets: SECRETS,
      currentUserId: () => 'owner',
      registry: new AgentDriverRegistry(),
      publish: (frame) => {
        if (frame.channel === 'agent:session') titles.push(frame.session.title)
      },
    })
    const session = await runtime.store.createSession({
      taskId: seed.taskId,
      providerId: profileId,
      profileId,
      kind: 'interactive',
      config: {},
    }, descriptor(profileId))
    await runtime.enqueueTurn(session.id, {
      input: [{ type: 'text', text: 'Please implement generated session naming now' }],
      source: 'interactive',
      effectivePolicy: {},
      idempotencyKey: randomUUID(),
    })
    await vi.waitFor(async () => {
      expect((await runtime!.store.requireSession(session.id)).title).toBe('Generated session naming')
    })
    expect(titles).toEqual(expect.arrayContaining([
      'Please implement generated session naming now',
      'Generated session naming',
    ]))
  })

  it('allows a slow one-shot CLI to finish without delaying the accepted turn', async () => {
    vi.useFakeTimers()
    try {
      const seed = await seedTask(testDb, dataDir)
      const profileId = 'title-generation-slow-success'
      registerTitleProfile(profileId)
      core.models.generateText = vi.fn(() => new Promise<Awaited<ReturnType<CoreServices['models']['generateText']>>>((resolve) => {
        setTimeout(() => resolve({
          text: 'Generated after CLI startup',
          providerId: profileId,
          backendId: `harness:${profileId}`,
          modelId: 'default',
        }), 10_000)
      }))
      runtime = new ManagedAgentRuntime({
        db: pluginDb.db,
        dataDir,
        core,
        internalEnv: () => ({}),
        secrets: SECRETS,
        currentUserId: () => 'owner',
        registry: new AgentDriverRegistry(),
      })
      const session = await runtime.store.createSession({
        taskId: seed.taskId,
        providerId: profileId,
        profileId,
        kind: 'interactive',
        config: {},
      }, descriptor(profileId))

      await runtime.enqueueTurn(session.id, {
        input: [{ type: 'text', text: 'Allow enough time for title generation' }],
        source: 'interactive',
        effectivePolicy: {},
        idempotencyKey: randomUUID(),
      })
      expect((await runtime.store.requireSession(session.id)).title).toBe('Allow enough time for title generation')

      await vi.advanceTimersByTimeAsync(10_000)
      expect((await runtime.store.requireSession(session.id)).title).toBe('Generated after CLI startup')
    } finally {
      vi.useRealTimers()
    }
  })

  it('aborts owned title work during shutdown', async () => {
    const seed = await seedTask(testDb, dataDir)
    const profileId = 'title-generation-shutdown'
    registerTitleProfile(profileId)
    const generateText = vi.fn(({ input }: Parameters<CoreServices['models']['generateText']>[0]) =>
      new Promise<never>((_resolve, reject) => {
        input.signal?.addEventListener('abort', () => reject(input.signal?.reason), { once: true })
      }))
    core.models.generateText = generateText
    runtime = new ManagedAgentRuntime({
      db: pluginDb.db,
      dataDir,
      core,
      internalEnv: () => ({}),
      secrets: SECRETS,
      currentUserId: () => 'owner',
      registry: new AgentDriverRegistry(),
    })
    const session = await runtime.store.createSession({
      taskId: seed.taskId,
      providerId: profileId,
      profileId,
      kind: 'interactive',
      config: {},
    }, descriptor(profileId))
    await runtime.enqueueTurn(session.id, {
      input: [{ type: 'text', text: 'Keep the fallback when runtime stops' }],
      source: 'interactive',
      effectivePolicy: {},
      idempotencyKey: randomUUID(),
    })
    expect(generateText).toHaveBeenCalledTimes(1)
    await runtime.stop()
    expect((await runtime.store.requireSession(session.id)).title).toBe('Keep the fallback when runtime stops')
    runtime = null
  })

  it('edits, reorders, and removes durable queued turns', async () => {
    const seed = await seedTask(testDb, dataDir)
    runtime = new ManagedAgentRuntime({
      db: pluginDb.db,
      dataDir,
      core,
      internalEnv: () => ({}),
      secrets: SECRETS,
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
    const { turn: first } = await runtime.store.enqueueTurn(session.id, {
      input: [{ type: 'text', text: 'First prompt.' }],
      source: 'interactive',
      effectivePolicy: {},
      idempotencyKey: randomUUID(),
    })
    const { turn: second } = await runtime.store.enqueueTurn(session.id, {
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
    registry.registerNative(driver.providerId, () => driver)
    runtime = new ManagedAgentRuntime({
      db: pluginDb.db,
      dataDir,
      core,
      internalEnv: () => ({}),
      secrets: SECRETS,
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

  // Archiving a task retires its agents (docs/managed-agents.md § Client surfaces).
  it('retires the sessions of an archived task from the live list', async () => {
    const seed = await seedTask(testDb, dataDir)
    runtime = new ManagedAgentRuntime({
      db: pluginDb.db,
      dataDir,
      core,
      internalEnv: () => ({}),
      secrets: SECRETS,
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

    const before = await runtime.store.listSessions({ archived: false })
    expect(before.sessions.map((row) => row.id)).toEqual([session.id])

    await testDb.db.update(schema.tasks).set({ status: 'archived' }).where(eq(schema.tasks.id, seed.taskId))

    const live = await runtime.store.listSessions({ archived: false })
    const archived = await runtime.store.listSessions({ archived: true })
    expect(live.sessions).toEqual([])
    expect(archived.sessions.map((row) => row.id)).toEqual([session.id])
    // Exempt: a pinned task id is the task pane looking at its own task (docs/managed-agents.md § Client
    // surfaces).
    const pinned = await runtime.store.listSessions({ taskId: seed.taskId, archived: false })
    expect(pinned.sessions.map((row) => row.id)).toEqual([session.id])
  })

  it('counts queued turns onto list rows', async () => {
    const seed = await seedTask(testDb, dataDir)
    runtime = new ManagedAgentRuntime({
      db: pluginDb.db,
      dataDir,
      core,
      internalEnv: () => ({}),
      secrets: SECRETS,
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

    const empty = await runtime.store.listSessions({ taskId: seed.taskId })
    expect(empty.sessions[0]?.queuedTurns).toBe(0)

    const { turn: first } = await runtime.store.enqueueTurn(session.id, {
      input: [{ type: 'text', text: 'first follow-up' }],
      source: 'interactive',
      effectivePolicy: {},
      idempotencyKey: 'queued-one',
    })
    await runtime.store.enqueueTurn(session.id, {
      input: [{ type: 'text', text: 'second follow-up' }],
      source: 'interactive',
      effectivePolicy: {},
      idempotencyKey: 'queued-two',
    })

    const listed = await runtime.store.listSessions({ taskId: seed.taskId })
    expect(listed.sessions[0]?.queuedTurns).toBe(2)

    // A turn leaving the queue drops the count, so the mark clears.
    await runtime.store.cancelTurn(first.id)
    const afterCancel = await runtime.store.listSessions({ taskId: seed.taskId })
    expect(afterCancel.sessions[0]?.queuedTurns).toBe(1)
  })

  it('scopes session lists and full-text search to one workspace', async () => {
    const firstSeed = await seedTask(testDb, dataDir, 'workspace-one')
    const secondSeed = await seedTask(testDb, dataDir, 'workspace-two')
    runtime = new ManagedAgentRuntime({
      db: pluginDb.db,
      dataDir,
      core,
      internalEnv: () => ({}),
      secrets: SECRETS,
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
    registry.registerNative(driver.providerId, () => driver)
    runtime = new ManagedAgentRuntime({
      db: pluginDb.db,
      dataDir,
      core,
      internalEnv: () => ({}),
      secrets: SECRETS,
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
    registry.registerNative(driver.providerId, () => driver)
    runtime = new ManagedAgentRuntime({
      db: pluginDb.db,
      dataDir,
      core,
      internalEnv: () => ({}),
      secrets: SECRETS,
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

  it('dispatches a turn that arrives while a fruitless pump scan is in flight', async () => {
    const seed = await seedTask(testDb, dataDir)
    const registry = new AgentDriverRegistry()
    const gated = new GatedStartDriver()
    registry.registerNative('fake', () => new FakeAgentDriver())
    registry.registerNative(gated.providerId, () => gated)
    runtime = new ManagedAgentRuntime({
      db: pluginDb.db,
      dataDir,
      core,
      internalEnv: () => ({}),
      secrets: SECRETS,
      currentUserId: () => null,
      registry,
    })
    const live = await runtime.createSession({
      taskId: seed.taskId,
      providerId: 'fake',
      profileId: 'fake',
      kind: 'interactive',
      config: {},
    })
    // Queued through the store, so the only thing that can dispatch it is the scan reconcile starts.
    const stuck = await runtime.store.createSession({
      taskId: seed.taskId,
      providerId: gated.providerId,
      profileId: gated.profileId,
      kind: 'interactive',
      config: {},
    }, descriptor(gated.providerId))
    await runtime.store.enqueueTurn(stuck.id, {
      input: [{ type: 'text', text: 'Never starts.' }],
      source: 'interactive',
      effectivePolicy: {},
      idempotencyKey: randomUUID(),
    })

    await runtime.reconcile()
    await gated.entered

    // The scan is parked inside the gated provider's start, holding a queue snapshot that predates
    // this turn. Its own pump call finds the scan already running and cannot start a second one.
    const turn = await runtime.enqueueTurn(live.id, {
      input: [{ type: 'text', text: 'Arrives mid-scan.' }],
      source: 'interactive',
      effectivePolicy: {},
      idempotencyKey: randomUUID(),
    })
    gated.release()

    const snapshot = await runtime.wait(live.id, 0, 'turn_completed', 2_000)
    expect(snapshot.turns.find((candidate) => candidate.id === turn.id)?.status).toBe('completed')
  })

  it('reconciles an active turn and continues a durable queued turn after restart', async () => {
    const seed = await seedTask(testDb, dataDir)
    const beforeRestart = new ManagedAgentRuntime({
      db: pluginDb.db,
      dataDir,
      core,
      internalEnv: () => ({}),
      secrets: SECRETS,
      currentUserId: () => null,
      registry: new AgentDriverRegistry(),
    })
    const session = await beforeRestart.store.createSession({
      taskId: seed.taskId,
      providerId: 'fake',
      profileId: 'fake',
      kind: 'delegated',
      config: {},
    }, descriptor('fake'))
    const { turn: active } = await beforeRestart.store.enqueueTurn(session.id, {
      input: [{ type: 'text', text: 'Was active before restart.' }],
      source: 'delegation',
      effectivePolicy: {},
      idempotencyKey: 'restart-active',
    })
    await beforeRestart.store.startTurn(active.id)
    await beforeRestart.store.recordEvent(session.id, active.id, {
      type: 'diagnostic',
      level: 'warning',
      message: 'Preserve me.',
    })
    await beforeRestart.store.recordEvent(session.id, active.id, { type: 'session_state', state: 'working' })
    await beforeRestart.store.recordEvent(session.id, active.id, {
      type: 'request',
      requestId: 'restart-question',
      kind: 'question',
      title: 'This request did not survive the restart',
    })
    const { turn: queued } = await beforeRestart.store.enqueueTurn(session.id, {
      input: [{ type: 'text', text: 'Continue after restart.' }],
      source: 'delegation',
      effectivePolicy: {},
      idempotencyKey: 'restart-queued',
    })

    const registry = new AgentDriverRegistry()
    registry.registerNative('fake', () => new FakeAgentDriver())
    const lifecycle: AgentLifecycleFrame[] = []
    runtime = new ManagedAgentRuntime({
      db: pluginDb.db,
      dataDir,
      core,
      internalEnv: () => ({}),
      secrets: SECRETS,
      currentUserId: () => null,
      registry,
      publish: (frame) => {
        if (frame.channel.startsWith('plugin:agents:')) lifecycle.push(frame as AgentLifecycleFrame)
      },
    })
    await runtime.reconcile()
    const snapshot = await runtime.wait(session.id, 2, 'turn_completed', 2_000)

    expect(snapshot.turns.find((turn) => turn.id === active.id)?.status).toBe('interrupted')
    expect(snapshot.turns.find((turn) => turn.id === queued.id)?.status).toBe('completed')
    expect(lifecycle).toContainEqual({
      channel: 'plugin:agents:turn-changed',
      taskId: seed.taskId,
      sessionId: session.id,
      turnId: active.id,
      source: 'delegation',
      status: 'interrupted',
      attempt: 1,
    })
    expect(lifecycle).toContainEqual({
      channel: 'plugin:agents:request-changed',
      taskId: seed.taskId,
      sessionId: session.id,
      requestId: 'restart-question',
      kind: 'question',
      status: 'expired',
    })
    expect((await runtime.store.eventsForTurn(active.id)).some((record) =>
      record.event.type === 'diagnostic' && record.event.message === 'Preserve me.')).toBe(true)
  })

  it('gates dispatch on the stored concurrency limits and drains when they are raised', async () => {
    const seed = await seedTask(testDb, dataDir)
    const owner = 'owner-1'
    const registry = new AgentDriverRegistry()
    const driver = new RequestDriver()
    registry.registerNative(driver.providerId, () => driver)
    await writeAgentConcurrency(core.prefs, owner, { provider: 1, workspace: 3 })
    runtime = new ManagedAgentRuntime({
      db: pluginDb.db,
      dataDir,
      core,
      internalEnv: () => ({}),
      secrets: SECRETS,
      currentUserId: () => owner,
      registry,
    })
    const open = async () => runtime!.createSession({
      taskId: seed.taskId,
      providerId: driver.providerId,
      profileId: driver.profileId,
      kind: 'interactive',
      config: {},
    })
    const first = await open()
    const second = await open()
    const prompt = (sessionId: string) => runtime!.enqueueTurn(sessionId, {
      input: [{ type: 'text', text: 'Take the slot.' }],
      source: 'interactive',
      effectivePolicy: {},
      idempotencyKey: randomUUID(),
    })

    // The first turn holds the one provider slot: this driver waits on a permission and does not finish.
    await prompt(first.id)
    await runtime.wait(first.id, 0, 'attention', 2_000)

    const queued = await prompt(second.id)
    // Resolves on the timeout with whatever the session has, which is the point: nothing happened.
    const blocked = await runtime.wait(second.id, 0, 'attention', 150)
    expect(blocked.turns.find((turn) => turn.id === queued.id)?.status).toBe('queued')

    await writeAgentConcurrency(core.prefs, owner, { provider: 2, workspace: 3 })
    runtime.drainQueue()

    const dispatched = await runtime.wait(second.id, 0, 'attention', 2_000)
    expect(dispatched.turns.find((turn) => turn.id === queued.id)?.status).toBe('active')
  })

  it('writes a transcript row when the model or reasoning level changes', async () => {
    const seed = await seedTask(testDb, dataDir)
    const registry = new AgentDriverRegistry()
    registry.registerNative('fake', () => new FakeAgentDriver())
    runtime = new ManagedAgentRuntime({
      db: pluginDb.db,
      dataDir,
      core,
      internalEnv: () => ({}),
      secrets: SECRETS,
      currentUserId: () => null,
      registry,
    })

    const configOptions = [
      {
        id: 'model',
        label: 'Model',
        category: 'model',
        currentValue: 'sonnet',
        values: [{ value: 'sonnet', label: 'Sonnet 5' }, { value: 'opus', label: 'Opus 5' }],
      },
      {
        id: 'reasoning',
        label: 'Reasoning effort',
        category: 'reasoning',
        currentValue: 'medium',
        values: [{ value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }],
      },
      {
        id: 'mode',
        label: 'Mode',
        category: 'mode',
        currentValue: 'default',
        values: [{ value: 'default', label: 'Default' }, { value: 'plan', label: 'Plan' }],
      },
    ]
    const session = await runtime.createSession({
      taskId: seed.taskId,
      providerId: 'fake',
      profileId: 'fake',
      kind: 'interactive',
      config: { configOptions },
    })
    await runtime.patchSession(session.id, {
      config: {
        configOptions: [
          { ...configOptions[0], currentValue: 'opus' },
          { ...configOptions[1], currentValue: 'high' },
          { ...configOptions[2], currentValue: 'plan' },
        ],
      },
    })

    const snapshot = await runtime.store.snapshot(session.id, 0)
    const messages = snapshot.events.flatMap((record) =>
      record.event.type === 'diagnostic' ? [record.event.message] : [])
    expect(messages).toContain('Model changed to Opus 5')
    expect(messages).toContain('Reasoning effort changed to High')
    expect(messages).toContain('Mode changed to Plan')

    // Re-patching the same values is not a change, so it must not add another row.
    await runtime.patchSession(session.id, {
      config: {
        configOptions: [
          { ...configOptions[0], currentValue: 'opus' },
          { ...configOptions[1], currentValue: 'high' },
          { ...configOptions[2], currentValue: 'plan' },
        ],
      },
    })
    const after = await runtime.store.snapshot(session.id, 0)
    expect(after.events.filter((record) => record.event.type === 'diagnostic')).toHaveLength(3)
  })

  // Three advertised options, matching what a provider reports when a session starts. Seeded through
  // `config` because FakeAgentDriver advertises none of its own, and its `session_metadata` carries no
  // `configOptions`, so what is seeded here is what the session runs with.
  const advertised = () => [
    {
      id: 'model',
      label: 'Model',
      category: 'model' as const,
      currentValue: 'sonnet',
      values: [{ value: 'sonnet', label: 'Sonnet 5' }, { value: 'opus', label: 'Opus 5' }],
    },
    {
      id: 'reasoning',
      label: 'Reasoning effort',
      category: 'reasoning' as const,
      currentValue: 'medium',
      values: [{ value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }],
    },
    {
      id: 'mode',
      label: 'Mode',
      category: 'mode' as const,
      currentValue: 'default',
      values: [{ value: 'default', label: 'Default' }, { value: 'plan', label: 'Plan' }],
    },
  ]

  const defaultsRuntime = (owner: string) => new ManagedAgentRuntime({
    db: pluginDb.db,
    dataDir,
    core,
    internalEnv: () => ({}),
    secrets: SECRETS,
    currentUserId: () => owner,
    registry: (() => {
      const registry = new AgentDriverRegistry()
      registry.registerNative('fake', () => new FakeAgentDriver())
      return registry
    })(),
  })

  it('starts a new session on the pinned defaults, and does not treat that as a change to carry forward', async () => {
    const seed = await seedTask(testDb, dataDir)
    const owner = 'owner-defaults'
    await writeAgentSessionDefaults(core.prefs, owner, {
      followLastSession: false,
      pinned: { fake: { model: 'opus', reasoning: 'nonsense' } },
      last: {},
    })
    runtime = defaultsRuntime(owner)

    const session = await runtime.createSession({
      taskId: seed.taskId,
      providerId: 'fake',
      profileId: 'fake',
      kind: 'interactive',
      config: { configOptions: advertised() },
    })

    const options = session.config.configOptions as Array<{ id: string; currentValue: string }>
    expect(options.find((option) => option.id === 'model')?.currentValue).toBe('opus')
    // 'nonsense' is not one of the values the provider advertised, so the provider's own choice stands.
    expect(options.find((option) => option.id === 'reasoning')?.currentValue).toBe('medium')
    const startupEvents = (await runtime.store.snapshot(session.id, 0)).events
    expect(startupEvents.flatMap((record) =>
      record.event.type === 'diagnostic' ? [record.event.message] : [])).toContain('Model changed to Opus 5')
    expect(startupEvents.findLastIndex((record) =>
      record.event.type === 'session_state' && record.event.state === 'ready'))
      .toBeGreaterThan(startupEvents.findIndex((record) =>
        record.event.type === 'diagnostic' && record.event.message === 'Model changed to Opus 5'))
    // Applying a stored default is not the owner switching anything.
    expect((await readAgentSessionDefaults(core.prefs, owner)).last).toEqual({})
  })

  it('carries an in-session switch onto the next session of that provider while following is on', async () => {
    const seed = await seedTask(testDb, dataDir)
    const owner = 'owner-following'
    runtime = defaultsRuntime(owner)

    const first = await runtime.createSession({
      taskId: seed.taskId,
      providerId: 'fake',
      profileId: 'fake',
      kind: 'interactive',
      config: { configOptions: advertised() },
    })
    await runtime.patchSession(first.id, {
      config: { configOptions: advertised().map((option) => {
        if (option.id === 'reasoning') return { ...option, currentValue: 'high' }
        if (option.id === 'mode') return { ...option, currentValue: 'plan' }
        return option
      }) },
    })
    expect((await readAgentSessionDefaults(core.prefs, owner)).last).toEqual({
      fake: { reasoning: 'high', mode: 'plan' },
    })

    const second = await runtime.createSession({
      taskId: seed.taskId,
      providerId: 'fake',
      profileId: 'fake',
      kind: 'interactive',
      config: { configOptions: advertised() },
    })
    expect((second.config.configOptions as Array<{ id: string; currentValue: string }>)
      .find((option) => option.id === 'reasoning')?.currentValue).toBe('high')
    expect((second.config.configOptions as Array<{ id: string; currentValue: string }>)
      .find((option) => option.id === 'mode')?.currentValue).toBe('plan')

    // A workflow step names the model it wants in its own policy, and a fork continues the session it
    // came from, so neither takes the owner's interactive picks.
    for (const input of [
      { kind: 'workflow' as const },
      { kind: 'interactive' as const, parentSessionId: first.id },
    ]) {
      const session = await runtime.createSession({
        taskId: seed.taskId,
        providerId: 'fake',
        profileId: 'fake',
        config: { configOptions: advertised() },
        ...input,
      })
      expect((session.config.configOptions as Array<{ id: string; currentValue: string }>)
        .find((option) => option.id === 'reasoning')?.currentValue).toBe('medium')
      expect((session.config.configOptions as Array<{ id: string; currentValue: string }>)
        .find((option) => option.id === 'mode')?.currentValue).toBe('default')
    }
  })
})
