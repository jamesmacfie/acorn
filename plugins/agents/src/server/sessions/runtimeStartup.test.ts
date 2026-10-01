import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCoreServices, makeTestDb, makeTestPluginDb, memoryIdentityStore, SecretService } from '@acorn/plugin-api/testkit'
import { ManagedAgentRuntime } from './runtime'
import { FakeAgentDriver } from '../drivers/fake'
import { AgentDriverRegistry } from '../drivers/registry'
import type { AgentSession } from '../../contract/wire.ts'
import type { AgentDriverStartOptions } from '../drivers/types'
import { ProcessRetirementError } from '../processes/ownedProcess'

const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

class Engine extends ManagedAgentRuntime {
  connect(session: AgentSession) { return this.ensureSession(session) }
  disconnect(session: AgentSession) { return this.stopLive(session.id) }
}

describe('managed startup generations', () => {
  let engine: Engine
  let db: ReturnType<typeof makeTestDb>
  let plugin: ReturnType<typeof makeTestPluginDb>
  let core: ReturnType<typeof createCoreServices>
  let session: AgentSession
  let starts: AgentDriverStartOptions[]
  let stops: number
  let tokens: number
  let user: string | null
  let expectedStopError: Error | null
  let launch: (options: AgentDriverStartOptions) => Promise<Awaited<ReturnType<FakeAgentDriver['start']>>>

  beforeEach(async () => {
    db = makeTestDb()
    plugin = makeTestPluginDb('agents')
    core = createCoreServices({ db: db.db, secrets: new SecretService('11'.repeat(32)), activeIdentity: memoryIdentityStore() })
    vi.spyOn(core.tasks, 'requireRoot').mockResolvedValue(plugin.dataDir)
    vi.spyOn(core.tasks, 'workspaceId').mockResolvedValue('workspace')
    starts = []
    stops = 0
    tokens = 0
    user = null
    expectedStopError = null
    launch = (options) => new FakeAgentDriver().start(options)
    const registry = new AgentDriverRegistry()
    registry.registerNative('fake', () => ({
      providerId: 'fake', profileId: 'fake', probe: () => new FakeAgentDriver().probe(),
      async start(options) {
        starts.push(options)
        const handle = await launch(options)
        return { ...handle, stop: async () => { stops++; await handle.stop() } }
      },
    }))
    engine = new Engine({ db: plugin.db, dataDir: plugin.dataDir, core, registry,
      internalEnv: () => { tokens++; return {} }, secrets: new SecretService('11'.repeat(32)), currentUserId: () => user })
    session = await engine.store.createSession({ taskId: 'task', providerId: 'fake', profileId: 'fake', kind: 'interactive', config: {} }, await new FakeAgentDriver().probe())
  })
  afterEach(async () => {
    try { await engine.stop() } catch (error) { if (error !== expectedStopError) throw error }
    finally { plugin.cleanup(); db.cleanup(); vi.restoreAllMocks() }
  })

  it('joins callers during the first task read and starts one provider', async () => {
    const cwd = deferred<string>()
    vi.mocked(core.tasks.requireRoot).mockReturnValue(cwd.promise)
    const a = engine.connect(session)
    const b = engine.connect(session)
    await vi.waitFor(() => expect(core.tasks.requireRoot).toHaveBeenCalledTimes(1))
    cwd.resolve(plugin.dataDir)
    expect(await a).toBe(await b)
    expect(starts).toHaveLength(1)
  })

  it.each(['cwd', 'workspace', 'history', 'mcp'])('cancels a held %s read without spawning or using closed storage later', async (stage) => {
    const held = deferred<never>()
    if (stage === 'cwd') vi.mocked(core.tasks.requireRoot).mockReturnValue(held.promise)
    if (stage === 'workspace') vi.mocked(core.tasks.workspaceId).mockReturnValue(held.promise)
    if (stage === 'history') vi.spyOn(engine.store, 'hasProviderExecutionHistory').mockReturnValue(held.promise)
    if (stage === 'mcp') vi.spyOn(engine.mcpServers, 'resolve').mockReturnValue(held.promise)
    const starting = engine.connect(session).catch((error: unknown) => error)
    const dependency = stage === 'cwd' ? core.tasks.requireRoot : stage === 'workspace' ? core.tasks.workspaceId : stage === 'history' ? engine.store.hasProviderExecutionHistory : engine.mcpServers.resolve
    await vi.waitFor(() => expect(dependency).toHaveBeenCalledOnce())
    const tokensBeforeStop = tokens
    const first = engine.stop()
    expect(engine.stop()).toBe(first)
    await first
    expect(await starting).toBeInstanceOf(Error)
    plugin.cleanup()
    held.resolve(undefined as never)
    await new Promise((resolve) => setImmediate(resolve))
    expect(starts).toHaveLength(0)
    expect(tokens).toBe(tokensBeforeStop)
  })

  it('joins and retires a late handle from a native driver that ignores cancellation', async () => {
    const held = deferred<void>()
    launch = async (options) => { await held.promise; return new FakeAgentDriver().start(options) }
    const starting = engine.connect(session).catch((error: unknown) => error)
    await vi.waitFor(() => expect(starts).toHaveLength(1))
    let stopped = false
    const stopping = engine.stop().then(() => { stopped = true })
    await new Promise((resolve) => setImmediate(resolve))
    expect(stopped).toBe(false)
    held.resolve()
    await stopping
    expect(await starting).toBeInstanceOf(Error)
    expect(stops).toBe(1)
  })

  it('refuses replacement startup after process retirement failed', async () => {
    const failure = new ProcessRetirementError('synthetic exit was not acknowledged')
    launch = async () => { throw failure }
    expectedStopError = failure
    await expect(engine.connect(session)).rejects.toBe(failure)
    await expect(engine.connect(session)).rejects.toBe(failure)
    expect(starts).toHaveLength(1)
    await expect(engine.stop()).rejects.toBe(failure)
  })

  it('rejects events and reconnect callbacks from a retired generation', async () => {
    await engine.connect(session)
    const old = starts[0]
    await engine.disconnect(session)
    await engine.connect(await engine.store.requireSession(session.id))
    const before = (await engine.store.requireSession(session.id)).lastEventSeq
    await old.onEvent({ type: 'assistant_message', text: 'stale message' })
    await old.onClosed(new Error('stale close'))
    expect((await engine.store.requireSession(session.id)).lastEventSeq).toBe(before)
    await engine.stop()
    plugin.cleanup()
    await starts[1].onEvent({ type: 'assistant_message', text: 'after dispose' })
    await starts[1].onClosed(new Error('after dispose'))
    expect(starts).toHaveLength(2)
  })
  it('cancels creation held before ensureSession without writing a late session', async () => {
    const held = deferred<string>()
    vi.mocked(core.tasks.requireRoot).mockReturnValue(held.promise)
    const create = vi.spyOn(engine.store, 'createSession')
    const starting = engine.createSession({ taskId: 'task', providerId: 'fake', profileId: 'fake', kind: 'interactive', config: {} }).catch((error: unknown) => error)
    await vi.waitFor(() => expect(core.tasks.requireRoot).toHaveBeenCalledOnce())
    await engine.stop()
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
    const read = vi.spyOn(core.prefs, 'read').mockImplementation((userId, key) => key === 'agents:session-defaults:v1' ? held.promise : actualRead(userId, key))
    const starting = engine.createSession({ taskId: 'task', providerId: 'fake', profileId: 'fake', kind: 'interactive', config: {} }).catch((error: unknown) => error)
    await vi.waitFor(() => expect(read).toHaveBeenCalledWith('owner', 'agents:session-defaults:v1'))
    await engine.stop()
    expect(await starting).toBeInstanceOf(Error)
    const writes = vi.spyOn(engine, 'patchSession')
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
    const read = vi.spyOn(core.prefs, 'read').mockImplementation((userId, key) => key === 'agents:concurrency:v1' ? held.promise : actualRead(userId, key))
    await engine.connect(session)
    await vi.waitFor(() => expect(read).toHaveBeenCalledWith('owner', 'agents:concurrency:v1'))
    await engine.stop()
    plugin.cleanup()
    held.resolve(null)
    await new Promise((resolve) => setImmediate(resolve))
    expect(starts).toHaveLength(1)
    expect(stops).toBe(1)
  })

})
