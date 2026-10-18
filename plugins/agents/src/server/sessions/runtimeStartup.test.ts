import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createCoreServices,
  makeTestDb,
  makeTestPluginDb,
  memoryIdentityStore,
  SecretService,
  testCoreSeams,
} from '@acorn/plugin-api/testkit'
import { ManagedAgentRuntime } from './runtime'
import { ManagedAgentEngine, type AgentRuntimeOptions } from './runtimeEngine'
import { FakeAgentDriver } from '../drivers/fake'
import { AgentDriverRegistry } from '../drivers/registry'
import type { AgentInputPart, AgentSession } from '../../contract/wire.ts'
import type { AgentDriverStartOptions } from '../drivers/types'
import { ProcessRetirementError } from '../processes/ownedProcess'

const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('managed startup generations', () => {
  let runtime: ManagedAgentRuntime
  let engine: ManagedAgentEngine
  let db: ReturnType<typeof makeTestDb>
  let plugin: ReturnType<typeof makeTestPluginDb>
  let core: ReturnType<typeof createCoreServices>
  let session: AgentSession
  let starts: AgentDriverStartOptions[]
  let stops: number
  let tokens: number
  let user: string | null
  let expectedStopError: Error | null
  let memory: string | null
  let memoryReads: number
  let currentMemory: string | null
  let launch: (options: AgentDriverStartOptions) => Promise<Awaited<ReturnType<FakeAgentDriver['start']>>>

  // The engine is built here and handed to the runtime, so a test can start and stop a provider directly.
  const build = (options: AgentRuntimeOptions) => {
    engine = new ManagedAgentEngine(options)
    runtime = new ManagedAgentRuntime(options, engine)
  }

  beforeEach(async () => {
    db = makeTestDb()
    plugin = makeTestPluginDb('agents')
    core = createCoreServices({
      db: db.db,
      secrets: new SecretService('11'.repeat(32)),
      activeIdentity: memoryIdentityStore(),
      ...testCoreSeams(),
    })
    vi.spyOn(core.tasks, 'requireRoot').mockResolvedValue(plugin.dataDir)
    vi.spyOn(core.tasks, 'workspaceId').mockResolvedValue('workspace')
    starts = []
    stops = 0
    tokens = 0
    user = null
    expectedStopError = null
    memory = null
    memoryReads = 0
    currentMemory = null
    launch = (options) => new FakeAgentDriver().start(options)
    const registry = new AgentDriverRegistry()
    registry.registerNative('fake', () => ({
      providerId: 'fake',
      profileId: 'fake',
      probe: () => new FakeAgentDriver().probe(),
      async start(options) {
        starts.push(options)
        const handle = await launch(options)
        return {
          ...handle,
          stop: async () => {
            stops++
            await handle.stop()
          },
        }
      },
    }))
    build({
      db: plugin.db,
      dataDir: plugin.dataDir,
      core,
      registry,
      internalEnv: () => {
        tokens++
        return {}
      },
      secrets: new SecretService('11'.repeat(32)),
      currentUserId: () => user,
      standingContext: async () => {
        memoryReads++
        return memory
      },
      currentStandingContext: async () => currentMemory,
    })
    session = await runtime.store.createSession(
      { taskId: 'task', providerId: 'fake', profileId: 'fake', kind: 'interactive', config: {} },
      await new FakeAgentDriver().probe(),
    )
  })
  afterEach(async () => {
    try {
      await runtime.stop()
    } catch (error) {
      if (error !== expectedStopError) throw error
    } finally {
      plugin.cleanup()
      db.cleanup()
      vi.restoreAllMocks()
    }
  })

  it('joins callers during the first task read and starts one provider', async () => {
    const cwd = deferred<string>()
    vi.mocked(core.tasks.requireRoot).mockReturnValue(cwd.promise)
    const a = engine.ensureSession(session)
    const b = engine.ensureSession(session)
    await vi.waitFor(() => expect(core.tasks.requireRoot).toHaveBeenCalledTimes(1))
    cwd.resolve(plugin.dataDir)
    expect(await a).toBe(await b)
    expect(starts).toHaveLength(1)
  })

  it('snapshots memory at admission, preserves it across configuration and resume, and refreshes for a fresh session', async () => {
    memory = 'Memory at creation.'
    const created = await runtime.createSession({
      taskId: 'task',
      providerId: 'fake',
      profileId: 'fake',
      kind: 'interactive',
      config: { standingContext: 'Forged context.' },
    })
    expect(created.config.standingContext).toBe('Memory at creation.')
    memory = 'Memory after another agent wrote.'
    await runtime.patchSession(created.id, { config: { standingContext: 'Client replacement.' } })
    await engine.stopLive(created.id)
    await engine.ensureSession(await runtime.store.requireSession(created.id))
    expect(starts.at(-1)?.session.config.standingContext).toBe('Memory at creation.')
    expect(memoryReads).toBe(1)
    const fresh = await runtime.createSession({
      taskId: 'task',
      providerId: 'fake',
      profileId: 'fake',
      kind: 'interactive',
      config: {},
    })
    expect(fresh.config.standingContext).toBe('Memory after another agent wrote.')
    expect(memoryReads).toBe(2)
  })

  it('tells a running session what memory changed since its last turn, and again after a failed turn', async () => {
    const index = (...lines: string[]) => `## Memory\n\nThe contract.\n\n## Project memory\n\n${lines.join('\n')}`
    memory = index('- [db](db.md) — Use SQLite', '- [style](style.md) — Tabs')
    currentMemory = memory
    const sent: AgentInputPart[][] = []
    let failNext = false
    launch = async (options) => {
      const handle = await new FakeAgentDriver().start(options)
      const send = handle.sendTurn.bind(handle)
      handle.sendTurn = async (turn) => {
        sent.push(turn.input)
        if (failNext) {
          failNext = false
          throw new Error('Provider refused the turn.')
        }
        return send(turn)
      }
      return handle
    }
    const created = await runtime.createSession({
      taskId: 'task',
      providerId: 'fake',
      profileId: 'fake',
      kind: 'interactive',
      config: { standingContextTold: 'Forged.' },
    })
    const turn = (text: string) =>
      runtime.enqueueTurn(created.id, {
        input: [{ type: 'text', text }],
        source: 'interactive',
        effectivePolicy: { providerDefault: true },
        idempotencyKey: randomUUID(),
      })
    const memoryPart = (input: AgentInputPart[]) =>
      input.find((part) => part.type === 'context' && part.source === 'context.memory')
    const told = async () => (await runtime.store.requireSession(created.id)).config.standingContextTold

    await turn('First.')
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    expect(memoryPart(sent[0]!)).toBeUndefined()
    expect(await told()).toBeUndefined()

    // Another agent saves a memory and edits a description. The failed turn records nothing.
    currentMemory = index('- [api](api.md) — REST only', '- [db](db.md) — Use Postgres', '- [style](style.md) — Tabs')
    failNext = true
    await turn('Second.')
    await vi.waitFor(() => expect(sent).toHaveLength(2))
    const note = {
      type: 'context',
      contextId: 'memory',
      source: 'context.memory',
      label: 'Memory changes',
      content: [
        'The memory index changed since your last turn. Read a memory with memory_get when it matters.',
        'Added or updated:',
        '- [api](api.md) — REST only',
        '- [db](db.md) — Use Postgres',
        'No longer in the index:',
        '- [db](db.md) — Use SQLite',
      ].join('\n'),
    }
    expect(memoryPart(sent[1]!)).toMatchObject(note)
    await turn('Third.')
    await vi.waitFor(() => expect(sent).toHaveLength(3))
    expect(memoryPart(sent[2]!)).toMatchObject(note)
    await vi.waitFor(async () => expect(await told()).toBe(currentMemory))
    const { events } = await runtime.store.snapshot(created.id)
    expect(events.map((record) => record.event)).toContainEqual(
      expect.objectContaining({ message: 'Memory changed since the last turn: 2 added, 1 removed.' }),
    )

    // Told once, so the next turn is quiet. A configuration patch can't rewind what it was told.
    await turn('Fourth.')
    await vi.waitFor(() => expect(sent).toHaveLength(4))
    expect(memoryPart(sent[3]!)).toBeUndefined()
    await runtime.patchSession(created.id, { config: { standingContextTold: 'Client replacement.' } })
    expect(await told()).toBe(currentMemory)
    expect((await runtime.store.requireSession(created.id)).config.standingContext).toBe(memory)
  })

  it.each(['cwd', 'workspace', 'history', 'mcp'])(
    'cancels a held %s read without spawning or using closed storage later',
    async (stage) => {
      const held = deferred<never>()
      if (stage === 'cwd') vi.mocked(core.tasks.requireRoot).mockReturnValue(held.promise)
      if (stage === 'workspace') vi.mocked(core.tasks.workspaceId).mockReturnValue(held.promise)
      if (stage === 'history') vi.spyOn(runtime.store, 'hasProviderExecutionHistory').mockReturnValue(held.promise)
      if (stage === 'mcp') vi.spyOn(runtime.mcpServers, 'resolve').mockReturnValue(held.promise)
      const starting = engine.ensureSession(session).catch((error: unknown) => error)
      const dependency =
        stage === 'cwd'
          ? core.tasks.requireRoot
          : stage === 'workspace'
            ? core.tasks.workspaceId
            : stage === 'history'
              ? runtime.store.hasProviderExecutionHistory
              : runtime.mcpServers.resolve
      await vi.waitFor(() => expect(dependency).toHaveBeenCalledOnce())
      const tokensBeforeStop = tokens
      const first = runtime.stop()
      expect(runtime.stop()).toBe(first)
      await first
      expect(await starting).toBeInstanceOf(Error)
      plugin.cleanup()
      held.resolve(undefined as never)
      await new Promise((resolve) => setImmediate(resolve))
      expect(starts).toHaveLength(0)
      expect(tokens).toBe(tokensBeforeStop)
    },
  )

  it('joins a held startup warning before closing storage', async () => {
    vi.spyOn(runtime.mcpServers, 'resolve').mockResolvedValue({
      servers: [],
      secrets: [],
      unavailable: ['missing-server'],
      managedRoots: [],
      revisions: {},
    })
    const held = deferred<void>()
    const record = runtime.store.recordEvent.bind(runtime.store)
    const writing = vi.spyOn(runtime.store, 'recordEvent').mockImplementation(async (sessionId, turnId, event) => {
      if (event.type === 'diagnostic' && event.message.includes('missing-server')) await held.promise
      return record(sessionId, turnId, event)
    })
    const starting = engine.ensureSession(session).catch((error: unknown) => error)
    await vi.waitFor(() =>
      expect(writing).toHaveBeenCalledWith(
        session.id,
        null,
        expect.objectContaining({ type: 'diagnostic', message: expect.stringContaining('missing-server') }),
      ),
    )
    let finished = false
    const stopping = runtime.stop().then(() => {
      finished = true
    })
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(finished).toBe(false)
    held.resolve()
    await stopping
    expect(await starting).toBeInstanceOf(Error)
    expect(starts).toHaveLength(0)
  })

  it('joins and retires a late handle from a native driver that ignores cancellation', async () => {
    const held = deferred<void>()
    launch = async (options) => {
      await held.promise
      return new FakeAgentDriver().start(options)
    }
    const starting = engine.ensureSession(session).catch((error: unknown) => error)
    await vi.waitFor(() => expect(starts).toHaveLength(1))
    let stopped = false
    const stopping = runtime.stop().then(() => {
      stopped = true
    })
    await new Promise((resolve) => setImmediate(resolve))
    expect(stopped).toBe(false)
    held.resolve()
    await stopping
    expect(await starting).toBeInstanceOf(Error)
    expect(stops).toBe(1)
  })

  it('joins a held provider callback and commits its event before shutdown returns', async () => {
    await engine.ensureSession(session)
    const held = deferred<void>()
    const record = runtime.store.recordEvent.bind(runtime.store)
    const writing = vi.spyOn(runtime.store, 'recordEvent').mockImplementation(async (sessionId, turnId, event) => {
      if (event.type === 'assistant_message') await held.promise
      return record(sessionId, turnId, event)
    })
    const emitted = starts[0].onEvent({ type: 'assistant_message', text: 'committed before close' })
    await vi.waitFor(() =>
      expect(writing).toHaveBeenCalledWith(session.id, null, expect.objectContaining({ type: 'assistant_message' })),
    )
    let finished = false
    const stopping = runtime.stop().then(() => {
      finished = true
    })
    await vi.waitFor(() => expect(stops).toBe(1))
    expect(finished).toBe(false)
    held.resolve()
    await emitted
    await stopping
    plugin.db.close()
    const reopened = plugin.openConnection()
    try {
      build({
        db: reopened,
        dataDir: plugin.dataDir,
        core,
        registry: new AgentDriverRegistry(),
        internalEnv: () => ({}),
        secrets: new SecretService('11'.repeat(32)),
        currentUserId: () => null,
      })
      await runtime.reconcile()
      expect((await runtime.store.eventPage(session.id)).events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event: expect.objectContaining({ type: 'assistant_message', text: 'committed before close' }),
          }),
        ]),
      )
      await starts[0].onEvent({ type: 'assistant_message', text: 'after close' })
      expect(
        (await runtime.store.eventPage(session.id)).events.some(
          (entry) => entry.event.type === 'assistant_message' && entry.event.text === 'after close',
        ),
      ).toBe(false)
    } finally {
      await runtime.stop()
      reopened.close()
    }
  })

  it('joins an in-flight webhook queue write before shutdown returns', async () => {
    await engine.ensureSession(session)
    const held = deferred<void>()
    const accepting = vi.spyOn(engine.webhooks, 'accept').mockImplementation(async () => {
      await held.promise
    })
    let stopping: Promise<void> | null = null
    try {
      await starts[0].onEvent({ type: 'assistant_message', text: 'published event' })
      await vi.waitFor(() => expect(accepting).toHaveBeenCalled())
      let finished = false
      stopping = runtime.stop().then(() => {
        finished = true
      })
      await vi.waitFor(() => expect(stops).toBe(1))
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(finished).toBe(false)
    } finally {
      held.resolve()
      await stopping
    }
  })

  it('refuses replacement startup after process retirement failed', async () => {
    const failure = new ProcessRetirementError('synthetic exit was not acknowledged')
    launch = async () => {
      throw failure
    }
    expectedStopError = failure
    await expect(engine.ensureSession(session)).rejects.toBe(failure)
    await expect(engine.ensureSession(session)).rejects.toBe(failure)
    expect(starts).toHaveLength(1)
    await expect(runtime.stop()).rejects.toBe(failure)
  })

  it('refuses replacement after a disconnected process fails retirement', async () => {
    const failure = new ProcessRetirementError('disconnected child did not exit')
    launch = async (options) => {
      const handle = await new FakeAgentDriver().start(options)
      return {
        ...handle,
        stop: async () => {
          throw failure
        },
      }
    }
    expectedStopError = failure
    await engine.ensureSession(session)
    await expect(starts[0].onClosed(new Error('stream ended'))).rejects.toBe(failure)
    await expect(engine.ensureSession(session)).rejects.toBe(failure)
    await expect(runtime.stop()).rejects.toBe(failure)
  })

  it('rejects events and reconnect callbacks from a retired generation', async () => {
    await engine.ensureSession(session)
    const old = starts[0]
    await engine.stopLive(session.id)
    await engine.ensureSession(await runtime.store.requireSession(session.id))
    const before = (await runtime.store.requireSession(session.id)).lastEventSeq
    await old.onEvent({ type: 'assistant_message', text: 'stale message' })
    await old.onClosed(new Error('stale close'))
    expect((await runtime.store.requireSession(session.id)).lastEventSeq).toBe(before)
    await runtime.stop()
    plugin.cleanup()
    await starts[1].onEvent({ type: 'assistant_message', text: 'after dispose' })
    await starts[1].onClosed(new Error('after dispose'))
    expect(starts).toHaveLength(2)
  })
  it('cancels creation held before ensureSession without writing a late session', async () => {
    const held = deferred<string>()
    vi.mocked(core.tasks.requireRoot).mockReturnValue(held.promise)
    const create = vi.spyOn(runtime.store, 'createSession')
    const starting = runtime
      .createSession({ taskId: 'task', providerId: 'fake', profileId: 'fake', kind: 'interactive', config: {} })
      .catch((error: unknown) => error)
    await vi.waitFor(() => expect(core.tasks.requireRoot).toHaveBeenCalledOnce())
    await runtime.stop()
    expect(await starting).toBeInstanceOf(Error)
    plugin.cleanup()
    held.resolve(plugin.dataDir)
    await new Promise((resolve) => setImmediate(resolve))
    expect(create).not.toHaveBeenCalled()
    expect(starts).toHaveLength(0)
  })

  it('cancels held saved defaults before they can touch closed storage', async () => {
    user = 'owner'
    const held = deferred<string | null>()
    const actualRead = core.prefs.read.bind(core.prefs)
    const read = vi
      .spyOn(core.prefs, 'read')
      .mockImplementation((userId, key) =>
        key === 'agents:session-defaults:v1' ? held.promise : actualRead(userId, key),
      )
    const starting = runtime
      .createSession({ taskId: 'task', providerId: 'fake', profileId: 'fake', kind: 'interactive', config: {} })
      .catch((error: unknown) => error)
    await vi.waitFor(() => expect(read).toHaveBeenCalledWith('owner', 'agents:session-defaults:v1'))
    await runtime.stop()
    expect(await starting).toBeInstanceOf(Error)
    const writes = vi.spyOn(runtime, 'patchSession')
    plugin.cleanup()
    held.resolve(JSON.stringify({ pinned: { fake: { model: 'late-model' } } }))
    await new Promise((resolve) => setImmediate(resolve))
    expect(writes).not.toHaveBeenCalled()
    expect(stops).toBe(1)
  })

  it('cancels a dispatcher preference read during shutdown', async () => {
    user = 'owner'
    const held = deferred<string | null>()
    const actualRead = core.prefs.read.bind(core.prefs)
    const read = vi
      .spyOn(core.prefs, 'read')
      .mockImplementation((userId, key) => (key === 'agents:concurrency:v1' ? held.promise : actualRead(userId, key)))
    await engine.ensureSession(session)
    await vi.waitFor(() => expect(read).toHaveBeenCalledWith('owner', 'agents:concurrency:v1'))
    await runtime.stop()
    plugin.cleanup()
    held.resolve(null)
    await new Promise((resolve) => setImmediate(resolve))
    expect(starts).toHaveLength(1)
    expect(stops).toBe(1)
  })
})
