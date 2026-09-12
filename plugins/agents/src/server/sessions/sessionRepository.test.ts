// The subagent roster as a projection on the session row, against a real migrated database.
//
// The pure fold has its own tests in stateMachine.test.ts. What this covers is the part that only a
// database can answer: that the roster is written in the same transaction as the event, that it
// survives being read back through the row mapper, and that recording a subagent event does not move
// the session's own lifecycle.
import { randomUUID } from 'node:crypto'
import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { makeTestNodeContext, type TestNodeContext } from '@acorn/plugin-api/testkit'
import type { AgentProviderDescriptor } from '@acorn/protocol/managedAgents.ts'
import { AgentStore } from './store'

const PROVIDER: AgentProviderDescriptor = {
  id: 'fake',
  profileId: 'fake',
  label: 'Fake',
  driverKind: 'acp',
  driverVersion: '1',
  installed: true,
  authenticated: true,
  statusAuthority: 'protocol',
  capabilities: [],
  configOptions: [],
  commands: [],
  skills: [],
  diagnostics: [],
}

describe('subagent roster on the session row', () => {
  // Through the testkit seam rather than deep-importing core: `ctx.storage.open()` runs this plugin's
  // own migration chain, so the column under test is the one the migration created.
  let ctx: TestNodeContext
  let store: AgentStore

  beforeEach(() => {
    ctx = makeTestNodeContext({ plugin: { name: 'agents' } })
    store = new AgentStore(ctx.storage.open(), ctx.core)
  })

  afterEach(() => {
    ctx.cleanup()
  })

  const session = () => store.createSession({
    taskId: randomUUID(),
    providerId: 'fake',
    profileId: 'fake',
    kind: 'interactive',
    config: {},
  }, PROVIDER)

  it('starts empty and accumulates in spawn order', async () => {
    const created = await session()
    expect(created.subagents).toEqual([])

    await store.recordEvent(created.id, null, { type: 'subagent', subagent: { id: 'b', title: 'beta', status: 'running' } })
    await store.recordEvent(created.id, null, { type: 'subagent', subagent: { id: 'a', title: 'alpha', status: 'running' } })
    const roster = (await store.requireSession(created.id)).subagents
    expect(roster.map((entry) => entry.title)).toEqual(['beta', 'alpha'])
  })

  it('folds a later update onto the row it opened', async () => {
    const created = await session()
    await store.recordEvent(created.id, null, { type: 'subagent', subagent: { id: 'a', title: 'alpha', status: 'running' } })
    await store.recordEvent(created.id, null, {
      type: 'subagent',
      subagent: { id: 'a', status: 'completed', model: 'opus', usage: { contextUsed: 17_375 } },
    })
    const roster = (await store.requireSession(created.id)).subagents
    expect(roster).toHaveLength(1)
    expect(roster[0]).toMatchObject({
      id: 'a',
      title: 'alpha',
      status: 'completed',
      model: 'opus',
      usage: { contextUsed: 17_375 },
    })
  })

  it('leaves the session’s own lifecycle alone', async () => {
    // The regression to watch for on Codex, where a child can settle after the parent's turn is done.
    const created = await session()
    await store.recordEvent(created.id, null, { type: 'turn_completed', stopReason: 'end_turn' })
    await store.recordEvent(created.id, null, { type: 'subagent', subagent: { id: 'a', status: 'idle' } })
    const after = await store.requireSession(created.id)
    expect(after.runtimeState).toBe('ready')
    expect(after.attention).toBe('completed')
    // Still advanced the sequence, so the transcript and the WebSocket tail both see it.
    expect(after.lastEventSeq).toBe(2)
  })

  it('keeps the roster and the event in step', async () => {
    // One transaction: a reader can never see a roster that disagrees with the ledger behind it.
    const created = await session()
    const record = await store.recordEvent(created.id, null, {
      type: 'subagent',
      subagent: { id: 'a', title: 'alpha', status: 'running' },
    })
    const snapshot = await store.snapshot(created.id)
    expect(snapshot.events.map((event) => event.id)).toContain(record.id)
    expect(snapshot.session.subagents.map((entry) => entry.id)).toEqual(['a'])
  })

  it('projects only bounded completed-turn review input under the owning task', async () => {
    const created = await session()
    const turn = await store.enqueueTurn(created.id, {
      source: 'interactive', input: [{ type: 'text', text: 'Original prompt' }],
      effectivePolicy: {}, idempotencyKey: 'review-input-1',
    })
    await store.startTurn(turn.id)
    await store.recordEvent(created.id, turn.id, { type: 'assistant_message', text: 'Reusable outcome.' })
    await store.recordEvent(created.id, turn.id, { type: 'turn_completed', stopReason: 'end_turn' })
    await store.recordEvent(created.id, turn.id, { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } })

    const refs = await store.lifecycleCompletedReviewInputs(created.taskId)
    expect(refs).toHaveLength(1)
    expect(refs[0]!.completedSequence).toBe(2)
    await expect(store.lifecycleReviewInput({ taskId: created.taskId, sessionId: created.id, turnId: turn.id })).resolves.toMatchObject({
      assistantSummary: 'Reusable outcome.', completedSequence: 2, availability: 'available', purpose: 'ordinary',
    })
    await expect(store.lifecycleReviewInput({ taskId: 'another-task', sessionId: created.id, turnId: turn.id })).resolves.toMatchObject({
      availability: 'unavailable', assistantSummary: null,
    })
  })
})
