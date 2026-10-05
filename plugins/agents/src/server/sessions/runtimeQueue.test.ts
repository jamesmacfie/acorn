import { eq } from 'drizzle-orm'
import * as schema from '../../node/schema'
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTestNodeContext, type TestNodeContext } from '@acorn/plugin-api/testkit'
import { AgentDriverRegistry } from '../drivers/registry'
import { FakeAgentDriver } from '../drivers/fake'
import type { AgentDriverSession, AgentDriverStartOptions } from '../drivers/types'
import { ManagedAgentRuntime } from './runtime'

const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

class Runtime extends ManagedAgentRuntime {
  counts() { return this.processes.occupancy().reduce((counts, live) => ({
    active: counts.active + Number(!!live.activeTurnId),
    reserved: counts.reserved + Number(!!live.admissionTurnId),
  }), { active: 0, reserved: 0 }) }
}

describe('durable queue admission', () => {
  let ctx: TestNodeContext
  let runtime: Runtime
  let starts: AgentDriverStartOptions[]
  let sends: string[]
  let stops: string[]
  let registry: AgentDriverRegistry
  let launch: (options: AgentDriverStartOptions) => Promise<AgentDriverSession>

  beforeEach(() => {
    ctx = makeTestNodeContext({ plugin: { name: 'agents' } })
    vi.spyOn(ctx.core.tasks, 'requireRoot').mockResolvedValue(ctx.dataDir)
    vi.spyOn(ctx.core.tasks, 'workspaceId').mockResolvedValue('workspace')
    vi.spyOn(ctx.core.prefs, 'read').mockResolvedValue(JSON.stringify({ provider: 2, workspace: 2 }))
    starts = []; sends = []; stops = []
    launch = async (options) => {
      await options.onEvent({ type: 'session_state', state: 'ready' })
      return {
        providerSessionRef: options.session.id, ready: true,
        sendTurn: async ({ turn }) => { sends.push(turn.id); return {} },
        cancel: async () => {}, resolveRequest: async () => {},
        stop: async () => { stops.push(options.session.id) },
      }
    }
    registry = new AgentDriverRegistry()
    registry.registerNative('fake', () => ({ providerId: 'fake', profileId: 'fake',
      probe: () => new FakeAgentDriver().probe(),
      start: async (options) => { starts.push(options); return launch(options) },
    }))
    runtime = new Runtime({ db: ctx.storage.open(), dataDir: ctx.dataDir, core: ctx.core, registry,
      internalEnv: () => ({}), secrets: ctx.env.SECRETS, currentUserId: () => 'owner' })
  })
  afterEach(async () => { await runtime.stop(); ctx.cleanup(); vi.restoreAllMocks() })

  const session = async (kind: 'interactive' | 'workflow' = 'interactive') => runtime.store.createSession({
    taskId: randomUUID(), providerId: 'fake', profileId: 'fake', kind, config: {},
  }, await new FakeAgentDriver().probe())
  const enqueue = (sessionId: string, text = 'Synthetic') => runtime.enqueueTurn(sessionId, {
    input: [{ type: 'text', text }], source: 'interactive', effectivePolicy: {}, idempotencyKey: randomUUID(),
  })

  it('acknowledges 20 public enqueues during startup and starts only admitted providers', async () => {
    const held = deferred<void>(), start = launch
    launch = async (options) => { await held.promise; return start(options) }
    const sessions = await Promise.all(Array.from({ length: 20 }, session))
    const turns = await Promise.all(sessions.map((item) => enqueue(item.id)))
    await vi.waitFor(() => expect(starts).toHaveLength(1))
    expect(runtime.counts()).toEqual({ active: 0, reserved: 1 })
    expect(turns.every((turn) => turn.status === 'queued')).toBe(true)
    held.resolve()
    await vi.waitFor(() => expect(sends).toHaveLength(2))
    expect(starts).toHaveLength(2)
    expect(runtime.counts()).toEqual({ active: 2, reserved: 0 })
  })

  it('joins cancellation to a late startup handle and releases admission for the next head', async () => {
    const held = deferred<void>(), start = launch
    launch = async (options) => { if (starts.length === 1) await held.promise; return start(options) }
    const item = await session(), first = await enqueue(item.id), next = await enqueue(item.id)
    await vi.waitFor(() => expect(starts).toHaveLength(1))
    let cancelled = false
    const cancelling = runtime.cancelTurn(item.id, first.id).then(() => { cancelled = true })
    await vi.waitFor(() => expect(starts[0]!.signal?.aborted).toBe(true))
    expect(cancelled).toBe(false)
    held.resolve()
    await cancelling
    await vi.waitFor(() => expect(sends).toEqual([next.id]))
    expect(stops).toEqual([item.id])
    expect((await runtime.store.snapshot(item.id)).events.some((record) => record.turnId === first.id && record.event.type === 'user_message')).toBe(false)
    expect(runtime.counts()).toEqual({ active: 1, reserved: 0 })
  })

  it('rechecks cancellation after a held workspace read before starting any provider', async () => {
    const workspace = deferred<string>()
    vi.mocked(ctx.core.tasks.workspaceId).mockReturnValue(workspace.promise)
    const item = await session(), turn = await enqueue(item.id)
    await vi.waitFor(() => expect(ctx.core.tasks.workspaceId).toHaveBeenCalledOnce())
    await runtime.cancelTurn(item.id, turn.id)
    workspace.resolve('workspace')
    await new Promise((resolve) => setImmediate(resolve))
    expect(starts).toHaveLength(0)
    expect(sends).toHaveLength(0)
  })

  it('scans again for a public enqueue that arrives during a held workspace read', async () => {
    const workspace = deferred<string>()
    vi.mocked(ctx.core.tasks.workspaceId).mockReturnValueOnce(workspace.promise)
    const first = await session(), second = await session()
    const firstTurn = await enqueue(first.id)
    await vi.waitFor(() => expect(ctx.core.tasks.workspaceId).toHaveBeenCalledOnce())
    const secondTurn = await enqueue(second.id)
    workspace.resolve('workspace')
    await vi.waitFor(() => expect(sends).toEqual(expect.arrayContaining([firstTurn.id, secondTurn.id])))
    expect(sends).toHaveLength(2)
  })

  it('keeps a completed dispatch scan after a later preparation loses its provider generation', async () => {
    const open = () => runtime.createSession({
      taskId: randomUUID(), providerId: 'fake', profileId: 'fake', kind: 'interactive', config: {},
    })
    const first = await open(), later = await open()
    const queued = (sessionId: string, input: Array<{ type: 'text'; text: string } | { type: 'attachment'; attachmentId: string }>) =>
      runtime.store.enqueueTurn(sessionId, {
        input, source: 'interactive', effectivePolicy: {}, idempotencyKey: randomUUID(),
      })
    const firstTurn = await queued(first.id, [{ type: 'text', text: 'First' }])
    const pending = await queued(first.id, [{ type: 'text', text: 'Next' }])
    const attachmentId = randomUUID()
    const db = ctx.storage.open()
    await db.insert(schema.agentAttachments).values({
      id: attachmentId, taskId: later.taskId, storageKey: attachmentId, contentHash: attachmentId,
      filename: 'held.txt', mediaType: 'text/plain', byteSize: 1, createdAt: 1,
    })
    const stale = await queued(later.id, [{ type: 'attachment', attachmentId }])
    await db.update(schema.agentTurns).set({ createdAt: 1 }).where(eq(schema.agentTurns.id, firstTurn.turn.id))
    await db.update(schema.agentTurns).set({ createdAt: 2 }).where(eq(schema.agentTurns.id, stale.turn.id))

    const held = deferred<void>()
    const resolveAttachment = vi.spyOn(runtime.attachments, 'resolve').mockImplementation(async () => {
      await held.promise
      return {
        id: attachmentId, taskId: later.taskId, filename: 'held.txt', mediaType: 'text/plain',
        byteSize: 1, createdAt: 1, localPath: '/held.txt',
      }
    })
    runtime.drainQueue()
    await vi.waitFor(() => expect(sends).toEqual([firstTurn.turn.id]))
    await vi.waitFor(() => expect(resolveAttachment).toHaveBeenCalledOnce())
    await runtime.stopTaskSessions(first.taskId)
    await runtime.stopTaskSessions(later.taskId)
    held.resolve()

    await vi.waitFor(() => expect(sends).toEqual([firstTurn.turn.id, pending.turn.id]))
    expect((await runtime.store.turn(stale.turn.id))?.status).toBe('interrupted')
  })

  it('admits workflow work after five interactive dispatches', async () => {
    vi.mocked(ctx.core.prefs.read).mockResolvedValue(JSON.stringify({ provider: 1, workspace: 1 }))
    const workspace = deferred<string>()
    vi.mocked(ctx.core.tasks.workspaceId).mockReturnValueOnce(workspace.promise)
    const interactive = await Promise.all(Array.from({ length: 6 }, () => session()))
    const workflow = await session('workflow')
    const turns = [await enqueue(interactive[0]!.id)]
    await vi.waitFor(() => expect(ctx.core.tasks.workspaceId).toHaveBeenCalledOnce())
    for (const item of interactive.slice(1)) turns.push(await enqueue(item.id))
    const workflowTurn = await runtime.enqueueTurn(workflow.id, {
      input: [{ type: 'text', text: 'Workflow' }], source: 'workflow',
      effectivePolicy: {}, idempotencyKey: randomUUID(),
    })
    workspace.resolve('workspace')

    for (let index = 0; index < 5; index++) {
      await vi.waitFor(() => expect(sends[index]).toBe(turns[index]!.id))
      const started = starts.find((options) => options.session.id === interactive[index]!.id)!
      await started.onEvent({ type: 'turn_completed', stopReason: 'end_turn' })
    }
    await vi.waitFor(() => expect(sends[5]).toBe(workflowTurn.id))
    expect((await runtime.store.turn(turns[5]!.id))?.status).toBe('queued')
  })

  it('sends the edited durable input after a held startup', async () => {
    const held = deferred<void>(), start = launch
    const input: unknown[] = []
    launch = async (options) => {
      await held.promise
      const handle = await start(options)
      return { ...handle, sendTurn: async (turn) => { input.push(turn.input); return handle.sendTurn(turn) } }
    }
    const item = await session(), turn = await enqueue(item.id)
    await vi.waitFor(() => expect(starts).toHaveLength(1))
    await runtime.patchQueuedTurn(item.id, turn.id, { input: [{ type: 'text', text: 'Edited' }] })
    held.resolve()
    await vi.waitFor(() => expect(input).toEqual([[{ type: 'text', text: 'Edited' }]]))
  })

  it('rechecks the durable head after a reorder during startup', async () => {
    const held = deferred<void>(), start = launch
    launch = async (options) => { await held.promise; return start(options) }
    const item = await session(), first = await enqueue(item.id), second = await enqueue(item.id)
    await vi.waitFor(() => expect(starts).toHaveLength(1))
    await runtime.patchQueuedTurn(item.id, second.id, { ordinal: 0 })
    held.resolve()
    await vi.waitFor(() => expect(sends).toEqual([second.id]))
    expect((await runtime.store.turn(first.id))?.status).toBe('queued')
  })

  it('selects only the earliest queued ordinal for each eligible session, including a deferred head', async () => {
    const eligible = await session(), archived = await session(), external = await session()
    const queue = (id: string) => runtime.store.enqueueTurn(id, { source: 'interactive',
      input: [{ type: 'text', text: 'Synthetic' }], effectivePolicy: {}, idempotencyKey: randomUUID() })
    const first = await queue(eligible.id), second = await queue(eligible.id)
    await queue(archived.id); await queue(external.id)
    const db = ctx.storage.open()
    await db.update(schema.agentSessions).set({ archivedAt: 1 }).where(eq(schema.agentSessions.id, archived.id))
    await db.update(schema.agentSessions).set({ controller: 'terminal' }).where(eq(schema.agentSessions.id, external.id))
    await db.update(schema.agentTurns).set({ notBefore: Date.now() + 60_000 }).where(eq(schema.agentTurns.id, first.turn.id))
    expect((await runtime.store.queuedHeads()).map((item) => item.turn.id)).toEqual([first.turn.id])
    await runtime.store.cancelTurn(first.turn.id)
    expect((await runtime.store.queuedHeads()).map((item) => item.turn.id)).toEqual([second.turn.id])
  })

  it('records startup failure against the accepted turn and admits another session', async () => {
    launch = async () => { throw new Error('Synthetic startup failure') }
    const items = await Promise.all([session(), session()])
    const turns = await Promise.all(items.map((item) => enqueue(item.id)))
    expect(turns.every((turn) => turn.status === 'queued')).toBe(true)
    await vi.waitFor(async () => {
      const stored = await Promise.all(turns.map((turn) => runtime.store.turn(turn.id)))
      const sessions = await Promise.all(items.map((item) => runtime.store.snapshot(item.id)))
      expect(sessions.map((snapshot) => snapshot.session.runtimeState)).toEqual(['failed', 'failed'])
      expect(stored.map((turn) => turn?.status)).toEqual(['queued', 'queued'])
      expect(sessions[0]?.events.some((record) => record.turnId === turns[0]?.id && record.event.type === 'error')).toBe(true)
    })
    expect(runtime.counts()).toEqual({ active: 0, reserved: 0 })
  })

  it('shutdown joins the reserved process generation and leaves its durable turn queued', async () => {
    const held = deferred<void>(), start = launch
    launch = async (options) => { await held.promise; return start(options) }
    const item = await session(), turn = await enqueue(item.id)
    await vi.waitFor(() => expect(starts).toHaveLength(1))
    let stopped = false
    const stopping = runtime.stop().then(() => { stopped = true })
    await new Promise((resolve) => setImmediate(resolve))
    expect(stopped).toBe(false)
    held.resolve()
    await stopping
    expect(stops).toEqual([item.id])
    expect(sends).toEqual([])
    expect((await runtime.store.turn(turn.id))?.status).toBe('queued')
    expect(runtime.counts()).toEqual({ active: 0, reserved: 0 })
  })

  it('survives repeated start and cancel, then admits accepted work from a new runtime', async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const held = deferred<void>(), start = launch
      launch = async (options) => { await held.promise; return start(options) }
      const item = await session(), turn = await enqueue(item.id)
      await vi.waitFor(() => expect(starts).toHaveLength(attempt + 1))
      const cancelling = runtime.cancelTurn(item.id, turn.id)
      held.resolve()
      await cancelling
      expect((await runtime.store.turn(turn.id))?.status).toBe('cancelled')
      launch = start
    }

    const held = deferred<void>(), start = launch
    launch = async (options) => { await held.promise; return start(options) }
    const item = await session(), accepted = await enqueue(item.id)
    await vi.waitFor(() => expect(starts).toHaveLength(3))
    const oldCallback = starts[2]!.onEvent
    const stopping = runtime.stop()
    held.resolve()
    await stopping
    expect((await runtime.store.turn(accepted.id))?.status).toBe('queued')

    launch = start
    runtime = new Runtime({ db: ctx.storage.open(), dataDir: ctx.dataDir, core: ctx.core, registry,
      internalEnv: () => ({}), secrets: ctx.env.SECRETS, currentUserId: () => 'owner' })
    await runtime.reconcile()
    await vi.waitFor(() => expect(sends).toContain(accepted.id))
    const sent = sends.length
    await oldCallback({ type: 'assistant_message', text: 'stale' })
    expect(sends).toHaveLength(sent)
  })
})
