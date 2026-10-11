import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { agentProfileRegistry } from '@acorn/plugin-api/node'
import { makeTestNodeContext, type CoreServices, type TestNodeContext } from '@acorn/plugin-api/testkit'
import type { AgentSession } from '../../contract/wire.ts'
import { FakeAgentDriver } from '../drivers/fake'
import { AgentStore } from './store'
import { SessionGoalGeneration } from './sessionGoalGeneration'
import { SessionGoalStore } from './sessionGoalStore'

const answer = (blocker: string) =>
  JSON.stringify({
    satisfied: blocker === 'none',
    blocker,
    reason: 'More work remains.',
    evidence_summary: 'The tests have not run.',
    relied_on_assumption: false,
  })

const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('session goal generation', () => {
  let ctx: TestNodeContext
  let store: AgentStore
  let goals: SessionGoalStore
  let disposeProfile: () => void
  let generation: SessionGoalGeneration
  let enqueued: Array<{ sessionId: string; key: string }>
  let published: AgentSession[]
  let generateText: ReturnType<typeof vi.fn>
  let enqueue: Mock<(sessionId: string, prompt: string, key: string) => Promise<void>>

  beforeEach(() => {
    ctx = makeTestNodeContext({ plugin: { name: 'agents' } })
    const db = ctx.storage.open()
    store = new AgentStore(db, ctx.core)
    goals = new SessionGoalStore(db, store)
    disposeProfile = agentProfileRegistry.register({
      id: 'goal-test',
      label: 'Goal test',
      kind: 'agent',
      command: '/bin/true',
      backendPreference: 'node-pty',
      transport: 'pty',
      aiArgv: (command, options) => ({ file: command, args: [options.prompt] }),
    })
    enqueued = []
    published = []
    generateText = vi.fn(async () => ({
      text: answer('goal_not_met_yet'),
      modelId: 'cheap',
      providerId: 'fake',
      backendId: 'harness:goal-test',
    }))
    ctx.core.models.generateText = generateText as CoreServices['models']['generateText']
    enqueue = vi.fn(async (sessionId: string, _prompt: string, key: string) => {
      enqueued.push({ sessionId, key })
    })
    generation = new SessionGoalGeneration({
      store,
      db,
      models: ctx.core.models,
      currentUserId: () => 'owner',
      publish: (session) => published.push(session),
      enqueue,
    })
  })
  afterEach(async () => {
    await generation.stop()
    disposeProfile()
    ctx.cleanup()
    vi.restoreAllMocks()
  })

  const settled = async () => {
    const session = await store.createSession(
      { taskId: randomUUID(), providerId: 'fake', profileId: 'goal-test', kind: 'interactive', config: {} },
      await new FakeAgentDriver().probe(),
    )
    await goals.set(session.id, 'Finish the migration')
    const { turn } = await store.enqueueTurn(session.id, {
      input: [{ type: 'text', text: 'Start' }],
      source: 'interactive',
      effectivePolicy: {},
      idempotencyKey: randomUUID(),
    })
    await store.dispatchTurn(turn.id)
    await store.startTurn(turn.id)
    await store.recordEvent(session.id, turn.id, { type: 'user_message', text: 'Finish the migration' })
    await store.recordEvent(session.id, turn.id, { type: 'assistant_message', text: 'I need to run the tests.' })
    await store.recordEvent(session.id, turn.id, { type: 'turn_completed' })
    return { session, turn }
  }

  it('checks one settled turn once and queues one continuation', async () => {
    const { session, turn } = await settled()
    generation.check(session.id, turn.id)
    generation.check(session.id, turn.id)
    await vi.waitFor(() => expect(enqueued).toHaveLength(1))
    expect(enqueued[0]?.key).toBe(`goal:${turn.id}`)
    expect(generateText).toHaveBeenCalledTimes(1)
    expect((await store.requireSession(session.id)).goal).toMatchObject({
      status: 'active',
      continuations: 1,
      verdict: { turnId: turn.id },
    })
    expect(published).toHaveLength(1)
  })

  it('waits for a queued person turn', async () => {
    const { session, turn } = await settled()
    await store.enqueueTurn(session.id, {
      input: [{ type: 'text', text: 'One more request' }],
      source: 'interactive',
      effectivePolicy: {},
      idempotencyKey: randomUUID(),
    })
    generation.check(session.id, turn.id)
    await new Promise((resolve) => setImmediate(resolve))
    expect(generateText).not.toHaveBeenCalled()
    expect(enqueued).toEqual([])
  })

  it('blocks the goal when admission refuses a continuation', async () => {
    const { session, turn } = await settled()
    enqueue.mockRejectedValueOnce(new Error('Instruction check refused the turn.'))
    generation.check(session.id, turn.id)
    await vi.waitFor(async () => expect((await store.requireSession(session.id)).goal?.status).toBe('blocked'))
    await generation.recover()
    expect(enqueue).toHaveBeenCalledOnce()
    expect(enqueued).toEqual([])
    expect((await store.snapshot(session.id)).turns).toHaveLength(1)
  })

  it('does not enqueue behind a person turn accepted during judgment', async () => {
    const { session, turn } = await settled()
    let resolve!: (value: unknown) => void
    generateText.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    generation.check(session.id, turn.id)
    await vi.waitFor(() => expect(generateText).toHaveBeenCalledOnce())
    await store.enqueueTurn(session.id, {
      input: [{ type: 'text', text: 'Check one more thing' }],
      source: 'interactive',
      effectivePolicy: {},
      idempotencyKey: randomUUID(),
    })
    resolve({ text: answer('goal_not_met_yet') })
    await new Promise((done) => setImmediate(done))
    expect((await store.requireSession(session.id)).goal?.verdict).toBeNull()
    expect(enqueued).toEqual([])
  })

  it('checks the latest settled turn when a person replies during judgment', async () => {
    const { session, turn } = await settled()
    let resolve!: (value: unknown) => void
    generateText.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    generation.check(session.id, turn.id)
    await vi.waitFor(() => expect(generateText).toHaveBeenCalledOnce())
    const { turn: next } = await store.enqueueTurn(session.id, {
      input: [{ type: 'text', text: 'Also check the schema' }],
      source: 'interactive',
      effectivePolicy: {},
      idempotencyKey: randomUUID(),
    })
    await store.dispatchTurn(next.id)
    await store.startTurn(next.id)
    await store.recordEvent(session.id, next.id, { type: 'turn_completed' })
    generation.check(session.id, next.id)
    resolve({ text: answer('goal_not_met_yet') })
    await vi.waitFor(() => expect(enqueued).toEqual([{ sessionId: session.id, key: `goal:${next.id}` }]))
    expect(generateText).toHaveBeenCalledTimes(2)
    expect((await store.requireSession(session.id)).goal?.verdict?.turnId).toBe(next.id)
  })

  it('recovers a completed check and reuses its continuation key', async () => {
    const { session, turn } = await settled()
    await goals.apply(
      session.id,
      'Finish the migration',
      {
        turnId: turn.id,
        satisfied: false,
        blocker: 'goal_not_met_yet',
        reason: 'Tests remain.',
        evidence_summary: 'No test result.',
        relied_on_assumption: false,
      },
      'active',
      1,
      0,
    )
    await generation.recover()
    await vi.waitFor(() => expect(enqueued).toEqual([{ sessionId: session.id, key: `goal:${turn.id}` }]))
    expect(generateText).not.toHaveBeenCalled()
  })

  it('pauses on cancellation and ignores a late verdict', async () => {
    const { session, turn } = await settled()
    let resolve!: (value: unknown) => void
    generateText.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    generation.check(session.id, turn.id)
    await vi.waitFor(() => expect(generateText).toHaveBeenCalledOnce())
    const pausing = generation.pause(session.id)
    resolve({ text: answer('goal_not_met_yet') })
    await pausing
    await vi.waitFor(async () => expect((await store.requireSession(session.id)).goal?.status).toBe('paused'))
    expect(enqueued).toEqual([])
  })

  it('does not start a judge after pause during the ledger read', async () => {
    const { session, turn } = await settled()
    const snapshot = await store.exportSnapshot(session.id)
    const held = deferred<typeof snapshot>()
    vi.spyOn(store, 'exportSnapshot').mockReturnValueOnce(held.promise)
    generation.check(session.id, turn.id)
    const pausing = generation.pause(session.id)
    held.resolve(snapshot)
    await pausing
    expect(generateText).not.toHaveBeenCalled()
    expect((await store.requireSession(session.id)).goal?.status).toBe('paused')
  })

  it('does not start a judge after shutdown during the saved-verdict read', async () => {
    const { session, turn } = await settled()
    const held = deferred<null>()
    vi.spyOn(store, 'operationResult').mockReturnValueOnce(held.promise)
    generation.check(session.id, turn.id)
    await vi.waitFor(() => expect(store.operationResult).toHaveBeenCalledOnce())
    const stopping = generation.stop()
    held.resolve(null)
    await stopping
    expect(generateText).not.toHaveBeenCalled()
    expect(enqueued).toEqual([])
  })

  it('does not enqueue a continuation after pause during its final snapshot read', async () => {
    const { session, turn } = await settled()
    const readSnapshot = store.snapshot.bind(store)
    const held = deferred<Awaited<ReturnType<typeof store.snapshot>>>()
    let reads = 0
    vi.spyOn(store, 'snapshot').mockImplementation((id) => (++reads === 2 ? held.promise : readSnapshot(id)))
    generation.check(session.id, turn.id)
    await vi.waitFor(() => expect(reads).toBe(2))
    const pausing = generation.pause(session.id)
    held.resolve(await readSnapshot(session.id))
    await pausing
    expect(enqueued).toEqual([])
    expect((await store.requireSession(session.id)).goal?.status).toBe('paused')
  })
})
