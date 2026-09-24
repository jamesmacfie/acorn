// The subagent roster as a projection on the session row, against a real migrated database.
//
// The pure fold has its own tests in stateMachine.test.ts. What this covers is the part that only a
// database can answer: that the roster is written in the same transaction as the event, that it
// survives being read back through the row mapper, and that recording a subagent event does not move
// the session's own lifecycle.
import { randomUUID } from 'node:crypto'
import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { makeTestNodeContext, type TestNodeContext } from '@acorn/plugin-api/testkit'
import type { AgentProviderDescriptor } from '../../contract/wire.ts'
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
    const { turn } = await store.enqueueTurn(created.id, {
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

// Web activity through the index, against the real FTS5 table rather than against the string the
// protocol builds. A query is often the only durable record of why a run went the way it did, and
// before this the Codex path discarded it at normalization, so there was nothing to find.
describe('finding a run by what it did on the web', () => {
  let ctx: TestNodeContext
  let store: AgentStore

  beforeEach(() => {
    ctx = makeTestNodeContext({ plugin: { name: 'agents' } })
    store = new AgentStore(ctx.storage.open(), ctx.core)
  })

  afterEach(() => {
    ctx.cleanup()
  })

  it('indexes the query, the filters, the sources and their words', async () => {
    const created = await store.createSession({
      taskId: randomUUID(),
      providerId: 'fake',
      profileId: 'fake',
      kind: 'interactive',
      config: {},
    }, PROVIDER)
    await store.recordEvent(created.id, null, {
      type: 'tool',
      tool: {
        id: 'w',
        title: 'Search web',
        status: 'completed',
        web: {
          action: { type: 'search', queries: ['piranhagram'], allowedDomains: ['zaphodhost.example'] },
          results: [{
            url: 'https://zaphodhost.example/betelgeuse',
            title: 'Ravenousbugblatter',
            domain: 'zaphodhost.example',
            snippet: 'A sentence about frogstarcorp.',
          }],
        },
      },
    })

    for (const needle of [
      'piranhagram',
      'zaphodhost.example',
      'betelgeuse',
      'Ravenousbugblatter',
      'frogstarcorp',
    ]) {
      expect((await store.searchSessions(needle)).map((session) => session.id), needle).toEqual([created.id])
    }
    expect(await store.searchSessions('vogonpoetry')).toEqual([])
  })
})

// A reply arrives as many small `append` events. The index holds each message once, on its first event,
// so a search for two words matches however the stream happened to split them.
describe('searching a streamed reply', () => {
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
  const chunk = (text: string) => ({ type: 'assistant_message' as const, text, messageId: 'm1', append: true })

  it('indexes the whole message on its first event, and nothing on the rest', async () => {
    const created = await session()
    const first = await store.recordEvent(created.id, 'turn-1', chunk('The flux ca'))
    const rest = [
      await store.recordEvent(created.id, 'turn-1', chunk('pacitor is ')),
      await store.recordEvent(created.id, 'turn-1', chunk('charged')),
    ]
    expect(rest.map((event) => event.searchText)).toEqual([null, null])
    const stored = (await store.snapshot(created.id)).events.find((event) => event.id === first.id)
    expect(stored?.searchText).toBe('The flux capacitor is charged')
    expect((await store.searchSessions('flux capacitor charged')).map((row) => row.id)).toEqual([created.id])
  })

  it('starts a new message after anything that is not the same stream', async () => {
    const created = await session()
    await store.recordEvent(created.id, 'turn-1', chunk('before the '))
    await store.recordEvent(created.id, 'turn-1', { type: 'tool', tool: { id: 't', title: 'Run', status: 'completed' } })
    const after = await store.recordEvent(created.id, 'turn-1', chunk('tool call'))
    expect(after.searchText).toBe('tool call')
    // The two halves were never one message, so no indexed row holds both words.
    expect(await store.searchSessions('the tool')).toEqual([])
  })

  it('ranks a word in the conversation above the same word in tool output', async () => {
    const inTool = await session()
    await store.recordEvent(inTool.id, null, { type: 'tool', tool: { id: 't', title: 'cat', status: 'completed', output: 'marvin marvin marvin' } })
    const inReply = await session()
    await store.recordEvent(inReply.id, null, { type: 'assistant_message', text: 'marvin said hello' })
    expect((await store.searchSessions('marvin')).map((row) => row.id)).toEqual([inReply.id, inTool.id])
  })
})

// The archive page's search provider. The caller picks the tasks, so an archived session counts, and a
// session in any other task does not.
describe('searching the sessions of chosen tasks', () => {
  let ctx: TestNodeContext
  let store: AgentStore

  beforeEach(() => {
    ctx = makeTestNodeContext({ plugin: { name: 'agents' } })
    store = new AgentStore(ctx.storage.open(), ctx.core)
  })

  afterEach(() => {
    ctx.cleanup()
  })

  const session = (taskId: string) => store.createSession({ taskId, providerId: 'fake', profileId: 'fake', kind: 'interactive', config: {} }, PROVIDER)

  it('finds an archived session in scope, with an excerpt, and nothing outside it', async () => {
    const archived = await session('task-a')
    await store.recordEvent(archived.id, null, { type: 'assistant_message', text: 'The improbability drive is warm.' })
    await store.patchSession(archived.id, { archived: true })
    const elsewhere = await session('task-b')
    await store.recordEvent(elsewhere.id, null, { type: 'assistant_message', text: 'Another improbability entirely.' })

    const hits = await store.searchTaskSessions('improbability drive', ['task-a'], 10)
    expect(hits).toEqual([{
      taskId: 'task-a',
      title: archived.title,
      preview: expect.stringContaining('improbability drive'),
      target: { kind: 'managed-agent', resourceId: archived.id },
    }])
    expect(await store.searchTaskSessions('improbability', [], 10)).toEqual([])
  })
})
