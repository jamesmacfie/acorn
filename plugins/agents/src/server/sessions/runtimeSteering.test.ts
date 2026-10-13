import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTestNodeContext, type TestNodeContext } from '@acorn/plugin-api/testkit'
import * as schema from '../../node/schema'
import type { AgentEventRecord } from '../../contract/wire.ts'
import { AgentDriverRegistry } from '../drivers/registry'
import { FakeAgentDriver } from '../drivers/fake'
import { InstructionAdmissionError } from './instructionAdmissionError'
import { ManagedAgentRuntime } from './runtime'
import { ManagedAgentEngine, type AgentRuntimeOptions } from './runtimeEngine'

describe('steering a running turn', () => {
  let ctx: TestNodeContext
  let runtime: ManagedAgentRuntime
  let driver: FakeAgentDriver
  let options: AgentRuntimeOptions

  beforeEach(() => {
    ctx = makeTestNodeContext({ plugin: { name: 'agents' } })
    vi.spyOn(ctx.core.tasks, 'requireRoot').mockResolvedValue(ctx.dataDir)
    vi.spyOn(ctx.core.tasks, 'workspaceId').mockResolvedValue('workspace')
    driver = new FakeAgentDriver({ holdTurns: true })
    const registry = new AgentDriverRegistry()
    registry.registerNative('fake', () => driver)
    options = {
      db: ctx.storage.open(),
      dataDir: ctx.dataDir,
      core: ctx.core,
      registry,
      internalEnv: () => ({}),
      secrets: ctx.env.SECRETS,
      currentUserId: () => null,
    }
    runtime = new ManagedAgentRuntime(options, new ManagedAgentEngine(options))
  })
  afterEach(async () => {
    driver.finishTurns()
    await runtime.stop()
    ctx.cleanup()
    vi.restoreAllMocks()
  })

  const session = async () =>
    runtime.store.createSession(
      { taskId: randomUUID(), providerId: 'fake', profileId: 'fake', kind: 'interactive', config: {} },
      await driver.probe(),
    )
  const enqueue = (sessionId: string, text: string) =>
    runtime.enqueueTurn(sessionId, {
      input: [{ type: 'text', text }],
      source: 'interactive',
      effectivePolicy: {},
      idempotencyKey: randomUUID(),
    })
  // A session whose first turn is running and held open, with a second message queued behind it.
  const running = async () => {
    const item = await session()
    const first = await enqueue(item.id, 'Run the long command')
    await vi.waitFor(async () => expect((await runtime.store.turn(first.id))?.status).toBe('active'))
    const queued = await enqueue(item.id, 'Stop and list the files instead')
    return { sessionId: item.id, first, queued }
  }
  const status = async (turnId: string) => (await runtime.store.turn(turnId))?.status
  const userMessages = (events: AgentEventRecord[]) =>
    events.flatMap(({ turnId, event }) => (event.type === 'user_message' ? [{ turnId, ...event }] : []))

  it('puts the message in the running turn and leaves the row steered', async () => {
    const { sessionId, first, queued } = await running()

    const answered = await runtime.steerTurn(sessionId, queued.id)
    expect(['steering', 'steered']).toContain(answered.status)
    await vi.waitFor(async () => expect(await status(queued.id)).toBe('steered'))
    expect((await runtime.store.turn(queued.id))?.steeredIntoTurnId).toBe(first.id)
    expect((await runtime.store.requireSession(sessionId)).queuedTurns).toBe(0)

    driver.finishTurns()
    await vi.waitFor(async () => expect(await status(first.id)).toBe('completed'))
    const snapshot = await runtime.store.snapshot(sessionId)
    expect(userMessages(snapshot.events)).toEqual([
      { turnId: first.id, type: 'user_message', text: 'Run the long command' },
      { turnId: first.id, type: 'user_message', text: 'Stop and list the files instead', steeredTurnId: queued.id },
    ])
    // The steered message sits after the output it followed and before its own answer and the turn's end.
    expect(
      snapshot.events.flatMap(({ event }) =>
        event.type === 'assistant_message'
          ? [event.text]
          : event.type === 'user_message' && event.steeredTurnId
            ? ['steered']
            : event.type === 'turn_completed'
              ? ['completed']
              : [],
      ),
    ).toEqual([`Fake response for ${first.id}`, 'steered', `Fake response for ${queued.id}`, 'completed'])
    // A steered row is part of the turn it joined, so the turn list ends with the real turn.
    expect(snapshot.turns.map((turn) => turn.id)).toEqual([first.id])
    // The session had one turn throughout.
    expect(await runtime.store.nextQueuedTurn(sessionId)).toBeNull()
  })

  it('answers a repeated request with the row the first one moved', async () => {
    const { sessionId, queued } = await running()
    await runtime.steerTurn(sessionId, queued.id)
    await vi.waitFor(async () => expect(await status(queued.id)).toBe('steered'))
    await expect(runtime.steerTurn(sessionId, queued.id)).resolves.toMatchObject({ status: 'steered' })
  })

  it('sends a missed steer as the next turn, exactly once', async () => {
    const { sessionId, first, queued } = await running()
    driver.steering = 'missed'

    await runtime.steerTurn(sessionId, queued.id)
    await vi.waitFor(async () => expect(await status(queued.id)).toBe('queued'))
    expect((await runtime.store.requireSession(sessionId)).queuedTurns).toBe(1)

    driver.finishTurns()
    await vi.waitFor(async () => expect(await status(queued.id)).toBe('active'))
    driver.finishTurns()
    await vi.waitFor(async () => expect(await status(queued.id)).toBe('completed'))
    const messages = userMessages((await runtime.store.snapshot(sessionId)).events)
    expect(messages).toEqual([
      { turnId: first.id, type: 'user_message', text: 'Run the long command' },
      { turnId: queued.id, type: 'user_message', text: 'Stop and list the files instead' },
    ])
  })

  it('leaves the row queued when nothing is running', async () => {
    const item = await session()
    // Straight into the store, so nothing starts a provider for it.
    const { turn } = await runtime.store.enqueueTurn(item.id, {
      source: 'interactive',
      input: [{ type: 'text', text: 'Later' }],
      effectivePolicy: {},
      idempotencyKey: randomUUID(),
    })
    await expect(runtime.steerTurn(item.id, turn.id)).resolves.toMatchObject({ id: turn.id, status: 'queued' })
  })

  it('keeps the row queued with the dispatch error when the instruction check refuses', async () => {
    const { sessionId, queued } = await running()
    const admission = await runtime.instructionAdmission.get()
    vi.spyOn(admission, 'admit').mockRejectedValue(
      new InstructionAdmissionError('instruction_review_required', 'Instruction review required.'),
    )

    await expect(runtime.steerTurn(sessionId, queued.id)).rejects.toMatchObject({
      code: 'instruction_review_required',
    })
    expect(await status(queued.id)).toBe('queued')
    expect((await runtime.store.requireSession(sessionId)).queuedTurns).toBe(1)
  })

  it('refuses a turn something other than a person queued', async () => {
    const { sessionId } = await running()
    const { turn } = await runtime.store.enqueueTurn(sessionId, {
      source: 'plugin',
      input: [{ type: 'text', text: 'A plugin note' }],
      effectivePolicy: {},
      idempotencyKey: randomUUID(),
    })
    await expect(runtime.steerTurn(sessionId, turn.id)).rejects.toThrow('Only a message you sent can be steered.')
    expect(await status(turn.id)).toBe('queued')
  })

  it('puts a row left steering by a stopped Node back in the queue on boot', async () => {
    const { sessionId, first, queued } = await running()
    await options.db.update(schema.agentTurns).set({ status: 'steering' }).where(eq(schema.agentTurns.id, queued.id))
    driver.finishTurns()
    await runtime.stop()

    runtime = new ManagedAgentRuntime(options, new ManagedAgentEngine(options))
    await runtime.reconcile()
    await vi.waitFor(async () => expect(await status(queued.id)).toBe('active'))
    driver.finishTurns()
    await vi.waitFor(async () => expect(await status(queued.id)).toBe('completed'))
    expect(userMessages((await runtime.store.snapshot(sessionId)).events).map((message) => message.turnId)).toEqual([
      first.id,
      queued.id,
    ])
  })
})
