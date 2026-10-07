import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTestCoreServices, makeTestDb, makeTestPluginDb, schema, type TestDb, type TestPluginDb } from '@acorn/plugin-api/testkit'
import type { AgentNormalizedEvent, AgentProviderDescriptor } from '../../contract/wire.ts'
import {
  MAX_REVIEW_FINAL_TEXT_BYTES,
  MAX_REVIEW_USER_TEXT_BYTES,
  type AgentActivityEvent,
  type AgentActivityState,
  type AgentLifecycleFrame,
} from '../../contract/lifecycle'
import { AgentStore } from './store'

const provider: AgentProviderDescriptor = {
  id: 'fake',
  profileId: 'fake',
  label: 'Fake',
  driverKind: 'acp',
  driverVersion: 'test',
  installed: true,
  authenticated: true,
  statusAuthority: 'protocol',
  capabilities: [],
  configOptions: [],
  commands: [],
  skills: [],
  diagnostics: [],
}

describe('managed-agent lifecycle events and read models', () => {
  let coreDb: TestDb
  let pluginDb: TestPluginDb
  let core: ReturnType<typeof makeTestCoreServices>
  let taskId: string
  let otherTaskId: string
  let frames: AgentLifecycleFrame[]
  let store: AgentStore

  beforeEach(async () => {
    coreDb = makeTestDb()
    pluginDb = makeTestPluginDb('agents')
    core = makeTestCoreServices(coreDb)
    const createdAt = Date.now()
    const workspaceId = randomUUID()
    taskId = randomUUID()
    otherTaskId = randomUUID()
    await coreDb.db.insert(schema.workspaces).values({
      id: workspaceId,
      name: 'Lifecycle tests',
      createdAt,
      updatedAt: createdAt,
    })
    await coreDb.db.insert(schema.projects).values({
      id: 'lifecycle-project',
      name: 'Lifecycle project',
      path: '/tmp/lifecycle-project',
      workspaceId,
      sort: 0,
      hidden: false,
      vcs: 'git',
      defaultBranch: 'main',
      remoteUrl: null,
      githubOwner: null,
      githubName: null,
      githubRepoId: null,
      createdAt,
      updatedAt: createdAt,
    })
    await coreDb.db.insert(schema.tasks).values([
      {
        id: taskId,
        title: 'Lifecycle task',
        origin: 'local',
        projectId: 'lifecycle-project',
        branch: 'one',
        worktreePath: '/tmp/lifecycle-project-one',
        status: 'active',
        createdAt,
        updatedAt: createdAt,
      },
      {
        id: otherTaskId,
        title: 'Other task',
        origin: 'local',
        projectId: 'lifecycle-project',
        branch: 'two',
        worktreePath: '/tmp/lifecycle-project-two',
        status: 'active',
        createdAt,
        updatedAt: createdAt,
      },
    ])
    frames = []
    store = new AgentStore(pluginDb.db, core, (frame) => frames.push(frame))
  })

  afterEach(() => {
    pluginDb.cleanup()
    coreDb.cleanup()
  })

  const createSession = (ownerTaskId = taskId) => store.createSession({
    taskId: ownerTaskId,
    providerId: provider.id,
    profileId: provider.profileId,
    kind: 'interactive',
    config: {},
  }, provider)

  it('announces creation, generated fallback, and idempotent insertion state without content', async () => {
    const session = await createSession()
    expect(frames).toEqual([expect.objectContaining({
      channel: 'plugin:agents:sessions-changed',
      sessionId: session.id,
      changes: ['created'],
      present: true,
      archived: false,
    })])

    const key = randomUUID()
    const first = await store.enqueueTurn(session.id, {
      input: [{ type: 'text', text: '  Implement\n generated   session names  ' }],
      source: 'interactive',
      effectivePolicy: {},
      idempotencyKey: key,
    })
    expect(first).toMatchObject({ inserted: true, firstTurnFallback: 'Implement generated session names' })
    expect(first.sessionAfterRename?.title).toBe('Implement generated session names')
    const sessionFrames = frames.filter((frame) => frame.channel === 'plugin:agents:sessions-changed')
    expect(sessionFrames.at(-1)).toEqual({
      channel: 'plugin:agents:sessions-changed',
      taskId: session.taskId,
      sessionId: session.id,
      present: true,
      archived: false,
      changes: ['renamed'],
      renameSource: 'generated',
    })
    expect(sessionFrames.at(-1)).not.toHaveProperty('title')

    const replay = await store.enqueueTurn(session.id, {
      input: [{ type: 'text', text: 'ignored replay' }],
      source: 'interactive',
      effectivePolicy: {},
      idempotencyKey: key,
    })
    expect(replay).toMatchObject({ inserted: false, firstTurnFallback: null, sessionAfterRename: null })
    expect(frames.filter((frame) => frame.channel === 'plugin:agents:sessions-changed')).toHaveLength(2)
  })

  it('uses compare-and-set and emits one stable event for combined user changes', async () => {
    const session = await createSession()
    frames = []
    const equal = await store.renameSession(session.id, {
      title: session.title,
      source: 'user',
    })
    expect(equal).toEqual({ session, changed: false })
    expect(frames.filter((frame) => frame.channel === 'plugin:agents:sessions-changed')).toEqual([])

    const unchanged = await store.renameSession(session.id, {
      title: 'Generated result',
      expectedTitle: 'a different fallback',
      source: 'generated',
    })
    expect(unchanged.changed).toBe(false)
    expect(unchanged.session.updatedAt).toBe(session.updatedAt)
    expect(frames).toEqual([])

    const changed = await store.patchSession(session.id, { title: '  Owner title  ', archived: true })
    expect(changed.title).toBe('Owner title')
    expect(changed.archivedAt).not.toBeNull()
    expect(frames).toEqual([{
      channel: 'plugin:agents:sessions-changed',
      taskId: session.taskId,
      sessionId: session.id,
      present: true,
      archived: true,
      changes: ['renamed', 'archived'],
      renameSource: 'user',
    }])
    expect((await store.lifecycleSessions(session.taskId))[0]?.title).toBe('Owner title')
  })

  it('does not replace a title authored before the first turn', async () => {
    const session = await store.createSession({
      taskId,
      providerId: provider.id,
      profileId: provider.profileId,
      kind: 'interactive',
      config: {},
      title: 'Owner title',
    }, provider)
    frames = []
    const outcome = await store.enqueueTurn(session.id, {
      input: [{ type: 'text', text: 'Please implement generated session naming now' }],
      source: 'interactive',
      effectivePolicy: {},
      idempotencyKey: randomUUID(),
    })
    expect(outcome).toMatchObject({ inserted: true, firstTurnFallback: null, sessionAfterRename: null })
    expect((await store.requireSession(session.id)).title).toBe('Owner title')
    expect(frames.filter((frame) => frame.channel === 'plugin:agents:sessions-changed')).toEqual([])
  })

  it('announces every real turn transition with the current attempt and suppresses replays', async () => {
    const session = await createSession()
    frames = []
    const { turn } = await store.enqueueTurn(session.id, {
      input: [{ type: 'text', text: 'Do the work.' }],
      source: 'delegation',
      effectivePolicy: {},
      idempotencyKey: 'turn-one',
    })
    await store.enqueueTurn(session.id, {
      input: [{ type: 'text', text: 'This replay is ignored.' }],
      source: 'delegation',
      effectivePolicy: {},
      idempotencyKey: 'turn-one',
    })
    await store.dispatchTurn(turn.id)
    await store.dispatchTurn(turn.id)
    await store.startTurn(turn.id)
    await store.startTurn(turn.id)
    await store.requeueTransientTurn(turn.id, 'retry safely')
    await store.dispatchTurn(turn.id)
    await store.startTurn(turn.id)
    await store.recordEvent(session.id, turn.id, {
      type: 'error',
      code: 'provider_failed',
      message: 'private failure detail',
      retryable: false,
    })
    await store.recordEvent(session.id, turn.id, {
      type: 'error',
      code: 'duplicate_failure',
      message: 'late provider frame',
      retryable: false,
    })

    expect(frames.filter((frame) => frame.channel === 'plugin:agents:turn-changed')).toEqual([
      { channel: 'plugin:agents:turn-changed', taskId, sessionId: session.id, turnId: turn.id, source: 'delegation', status: 'queued', attempt: 0 },
      { channel: 'plugin:agents:turn-changed', taskId, sessionId: session.id, turnId: turn.id, source: 'delegation', status: 'dispatching', attempt: 1 },
      { channel: 'plugin:agents:turn-changed', taskId, sessionId: session.id, turnId: turn.id, source: 'delegation', status: 'active', attempt: 1 },
      { channel: 'plugin:agents:turn-changed', taskId, sessionId: session.id, turnId: turn.id, source: 'delegation', status: 'queued', attempt: 1 },
      { channel: 'plugin:agents:turn-changed', taskId, sessionId: session.id, turnId: turn.id, source: 'delegation', status: 'dispatching', attempt: 2 },
      { channel: 'plugin:agents:turn-changed', taskId, sessionId: session.id, turnId: turn.id, source: 'delegation', status: 'active', attempt: 2 },
      { channel: 'plugin:agents:turn-changed', taskId, sessionId: session.id, turnId: turn.id, source: 'delegation', status: 'failed', attempt: 2 },
    ])
    expect(await store.lifecycleTurns({ taskId })).toMatchObject([{
      taskId,
      sessionId: session.id,
      turnId: turn.id,
      source: 'delegation',
      status: 'failed',
      attempt: 2,
    }])
    expect(await store.lifecycleTurns({ taskId: otherTaskId })).toEqual([])
  })

  it('reads one completed turn for review, bounded, with provenance, and only within its task', async () => {
    const session = await createSession()
    const context = { type: 'context' as const, contextId: 'c1', label: 'Issue', content: 'Fix the parser.', source: 'plugin:github', capturedAt: 1 }
    const { turn } = await store.enqueueTurn(session.id, {
      input: [{ type: 'text', text: 'Please fix it.' }, { type: 'file', path: '/private/secret.txt' }, context],
      source: 'interactive',
      effectivePolicy: {},
      idempotencyKey: 'review-one',
    })
    const ref = { taskId, sessionId: session.id, turnId: turn.id }
    expect(await store.lifecycleReviewInput(ref)).toEqual({ available: false, reason: 'not-completed' })
    await store.dispatchTurn(turn.id)
    await store.startTurn(turn.id)
    await store.recordEvent(session.id, turn.id, { type: 'assistant_message', text: 'Looking.', messageId: 'm1' })
    await store.recordEvent(session.id, turn.id, { type: 'reasoning', text: 'hidden reasoning stays private', messageId: 'r1' })
    await store.recordEvent(session.id, turn.id, { type: 'assistant_message', text: 'Done', messageId: 'm2', append: true })
    await store.recordEvent(session.id, turn.id, { type: 'assistant_message', text: ': fixed.', messageId: 'm2', append: true })
    await store.recordEvent(session.id, turn.id, { type: 'assistant_message', text: 'a subagent aside', messageId: 's1', subagentId: 'sub' })
    await store.recordEvent(session.id, turn.id, { type: 'turn_completed', stopReason: 'end_turn' })

    const read = await store.lifecycleReviewInput(ref)
    expect(read).toEqual({
      available: true,
      input: {
        ...ref,
        source: 'interactive',
        completedAt: expect.any(Number),
        userText: [
          { text: 'Please fix it.', provenance: { kind: 'person' }, truncated: false },
          { text: 'Fix the parser.', provenance: { kind: 'context', source: 'plugin:github', label: 'Issue' }, truncated: false },
        ],
        userTextTruncated: false,
        finalText: 'Done: fixed.',
        finalTextTruncated: false,
      },
    })
    expect(JSON.stringify(read)).not.toMatch(/secret\.txt|hidden reasoning/)
    // Another task, another session, or an unknown turn all read the same.
    for (const other of [{ ...ref, taskId: otherTaskId }, { ...ref, sessionId: (await createSession(otherTaskId)).id }, { ...ref, turnId: 'nope' }]) {
      expect(await store.lifecycleReviewInput(other)).toEqual({ available: false, reason: 'not-found' })
    }
  })

  it('cuts review text at its byte bounds and says so', async () => {
    const session = await createSession()
    const big = 'é'.repeat(MAX_REVIEW_USER_TEXT_BYTES)
    const { turn } = await store.enqueueTurn(session.id, {
      input: [{ type: 'text', text: big }, { type: 'text', text: 'dropped' }],
      source: 'plugin',
      effectivePolicy: {},
      idempotencyKey: 'review-big',
    })
    await store.dispatchTurn(turn.id)
    await store.startTurn(turn.id)
    await store.recordEvent(session.id, turn.id, { type: 'assistant_message', text: 'x'.repeat(MAX_REVIEW_FINAL_TEXT_BYTES + 10), messageId: 'm' })
    await store.recordEvent(session.id, turn.id, { type: 'turn_completed', stopReason: 'end_turn' })
    const read = await store.lifecycleReviewInput({ taskId, sessionId: session.id, turnId: turn.id })
    if (!read.available) throw new Error('expected a completed turn')
    expect(read.input.userText).toHaveLength(1)
    expect(read.input.userText[0]).toMatchObject({ provenance: { kind: 'turn', source: 'plugin' }, truncated: true })
    expect(Buffer.byteLength(read.input.userText[0]!.text)).toBeLessThanOrEqual(MAX_REVIEW_USER_TEXT_BYTES)
    expect(read.input.userText[0]!.text).not.toContain('\uFFFD')
    expect(read.input.userTextTruncated).toBe(true)
    expect(read.input.finalTextTruncated).toBe(true)
    expect(Buffer.byteLength(read.input.finalText)).toBeLessThanOrEqual(MAX_REVIEW_FINAL_TEXT_BYTES)
  })

  it('announces request creation, claims, acknowledgement and expiry without leaking resolution data', async () => {
    const session = await createSession()
    frames = []
    await store.recordEvent(session.id, null, {
      type: 'request',
      requestId: 'permission-one',
      kind: 'permission',
      title: 'Run a command?',
      detail: 'private details',
    })
    await store.recordEvent(session.id, null, {
      type: 'request',
      requestId: 'permission-one',
      kind: 'permission',
      title: 'duplicate',
    })
    await store.claimRequestResolution(session.id, 'permission-one', { choice: 'yes' }, 'resolve-one')
    await store.claimRequestResolution(session.id, 'permission-one', { choice: 'yes' }, 'resolve-one')
    await store.recordEvent(session.id, null, {
      type: 'request_resolved',
      requestId: 'permission-one',
      resolution: { choice: 'yes' },
    })
    await store.recordEvent(session.id, null, {
      type: 'request_resolved',
      requestId: 'permission-one',
      resolution: { choice: 'late' },
    })
    await store.recordEvent(session.id, null, {
      type: 'request',
      requestId: 'question-two',
      kind: 'question',
      title: 'Choose one',
    })
    await store.expirePendingRequests(session.id)
    await store.expirePendingRequests(session.id)

    expect(frames.filter((frame) => frame.channel === 'plugin:agents:request-changed')).toEqual([
      { channel: 'plugin:agents:request-changed', taskId, sessionId: session.id, requestId: 'permission-one', kind: 'permission', status: 'pending' },
      { channel: 'plugin:agents:request-changed', taskId, sessionId: session.id, requestId: 'permission-one', kind: 'permission', status: 'resolving' },
      { channel: 'plugin:agents:request-changed', taskId, sessionId: session.id, requestId: 'permission-one', kind: 'permission', status: 'resolved' },
      { channel: 'plugin:agents:request-changed', taskId, sessionId: session.id, requestId: 'question-two', kind: 'question', status: 'pending' },
      { channel: 'plugin:agents:request-changed', taskId, sessionId: session.id, requestId: 'question-two', kind: 'question', status: 'expired' },
    ])
    const requests = await store.lifecycleRequests({ taskId, sessionId: session.id })
    expect(requests.map((request) => ({ id: request.requestId, status: request.status }))).toEqual([
      { id: 'permission-one', status: 'resolved' },
      { id: 'question-two', status: 'expired' },
    ])
    expect(requests[0]).not.toHaveProperty('resolution')
    expect(await store.lifecycleRequests({ taskId: otherTaskId })).toEqual([])
  })

  // What a consumer does with the frames: each one replaces its item and moves it to the end.
  const applyActivity = (state: AgentActivityState, frame: AgentActivityEvent): AgentActivityState => {
    if (frame.kind === 'usage') return { ...state, usage: frame.usage }
    if (frame.kind === 'tool') {
      return { ...state, tools: [...state.tools.filter((tool) => tool.toolCallId !== frame.tool.toolCallId), frame.tool] }
    }
    return { ...state, subagents: [...state.subagents.filter((item) => item.subagentId !== frame.subagent.subagentId), frame.subagent] }
  }

  it('publishes tool, subagent, and context edges that rebuild to the same state, with no command or output', async () => {
    const session = await createSession()
    const turn = (await store.enqueueTurn(session.id, { input: [{ type: 'text', text: 'go' }], source: 'interactive', effectivePolicy: {}, idempotencyKey: randomUUID() })).turn
    const first: AgentNormalizedEvent[] = [
      { type: 'usage', usage: { contextUsed: 1_000, contextSize: 200_000, cost: { amount: 0.01, currency: 'USD' } } },
      { type: 'tool', tool: { id: 'bash-1', title: 'rm -rf /tmp/secret-dir', kind: 'execute', status: 'pending', input: 'rm -rf /tmp/secret-dir' } },
      { type: 'tool', tool: { id: 'bash-1', title: '', output: 'SECRET OUTPUT', outputAppend: true } },
      { type: 'usage', usage: { contextUsed: 1_000, contextSize: 200_000 } },
      { type: 'subagent', subagent: { id: 'agent-1', title: 'Explore the repo', status: 'running', role: 'Explore' } },
    ]
    const second: AgentNormalizedEvent[] = [
      { type: 'tool', tool: { id: 'read-1', title: 'Read src/a.ts', kind: 'read', status: 'running', paths: ['/w/src/a.ts'], subagentId: 'agent-1' } },
      { type: 'tool', tool: { id: 'read-1', title: '', status: 'completed', output: 'file body' } },
      { type: 'tool', tool: { id: 'bash-1', title: '', status: 'completed', output: 'more SECRET OUTPUT' } },
      { type: 'subagent', subagent: { id: 'agent-1', status: 'completed' } },
      { type: 'usage', usage: { contextUsed: 5_000 } },
      { type: 'assistant_message', text: 'private reply' },
    ]
    frames = []
    const activityFrames = () => frames.flatMap((frame) => frame.channel === 'plugin:agents:activity' ? [frame] : [])
    // Frames go out once the projection module has loaded, after the commit.
    for (const event of first) await store.recordEvent(session.id, turn.id, event)
    await vi.waitFor(() => expect(activityFrames()).toHaveLength(3))
    const midway = await store.lifecycleActivity({ taskId, sessionId: session.id })
    for (const event of second) await store.recordEvent(session.id, turn.id, event)
    await vi.waitFor(() => expect(activityFrames()).toHaveLength(8))

    const activity = activityFrames()
    expect(activity.map((frame) => frame.kind === 'tool'
      ? `tool ${frame.tool.toolCallId} ${frame.tool.status}`
      : frame.kind === 'subagent' ? `subagent ${frame.subagent.subagentId} ${frame.subagent.status}` : `usage ${frame.usage.contextUsed}`)).toEqual([
      'usage 1000', 'tool bash-1 pending', 'subagent agent-1 running',
      'tool read-1 running', 'tool read-1 completed', 'tool bash-1 completed', 'subagent agent-1 completed', 'usage 5000',
    ])
    const sent = JSON.stringify(activity)
    for (const secret of ['rm -rf', 'secret-dir', 'SECRET OUTPUT', 'file body', 'private reply']) expect(sent).not.toContain(secret)
    expect(activity[1]).toMatchObject({ kind: 'tool', tool: { title: 'Command', kind: 'execute', turnId: turn.id } })
    expect(activity.at(-1)).toMatchObject({ kind: 'usage', usage: { contextUsed: 5_000, contextSize: 200_000 } })

    // A view opened midway reads the first half, then applies the frames sent after it.
    const live = activity.slice(3).reduce(
      (state, { channel: _channel, ...frame }) => applyActivity(state, frame),
      midway!,
    )
    const rebuilt = await store.lifecycleActivity({ taskId, sessionId: session.id })
    // The same items by id. Order is a display hint: an output chunk moves a call's stored row unannounced.
    const keyed = (state: AgentActivityState) => ({ ...state, tools: state.tools.toSorted((a, b) => a.toolCallId.localeCompare(b.toolCallId)) })
    expect(keyed(rebuilt!)).toEqual(keyed(live))
    expect(rebuilt!.tools.map((tool) => [tool.toolCallId, tool.status, tool.subagentId])).toEqual([
      ['read-1', 'completed', 'agent-1'],
      ['bash-1', 'completed', null],
    ])
    expect(rebuilt!.subagents).toEqual([{ subagentId: 'agent-1', turnId: turn.id, title: 'Explore the repo', role: 'Explore', status: 'completed', background: false }])

    // After a restart, the read comes from the ledger alone.
    const restarted = new AgentStore(pluginDb.db, core, () => undefined)
    expect(await restarted.lifecycleActivity({ taskId, sessionId: session.id })).toEqual(rebuilt)
    expect(await store.lifecycleActivity({ taskId: otherTaskId, sessionId: session.id })).toBeNull()
  })

  it('announces roster creation, title and archive edges, and deletion after the row is gone', async () => {
    const session = await createSession()
    await store.patchSession(session.id, { title: 'Renamed' })
    await store.patchSession(session.id, { title: 'Renamed' })
    await store.patchSession(session.id, { archived: true })
    await store.patchSession(session.id, { archived: true })
    await store.patchSession(session.id, { archived: false })

    expect(await store.lifecycleSessions(taskId)).toMatchObject([{
      taskId,
      sessionId: session.id,
      present: true,
      archived: false,
      title: 'Renamed',
    }])
    await store.deleteSession(session.id)
    await store.deleteSession(session.id)

    expect(frames.filter((frame) => frame.channel === 'plugin:agents:sessions-changed')).toEqual([
      { channel: 'plugin:agents:sessions-changed', taskId, sessionId: session.id, present: true, archived: false, changes: ['created'] },
      { channel: 'plugin:agents:sessions-changed', taskId, sessionId: session.id, present: true, archived: false, changes: ['renamed'], renameSource: 'user' },
      { channel: 'plugin:agents:sessions-changed', taskId, sessionId: session.id, present: true, archived: true, changes: ['archived'] },
      { channel: 'plugin:agents:sessions-changed', taskId, sessionId: session.id, present: true, archived: false, changes: ['restored'] },
      { channel: 'plugin:agents:sessions-changed', taskId, sessionId: session.id, present: false, archived: false, changes: ['deleted'] },
    ])
    expect(await store.lifecycleSessions(taskId)).toEqual([])
  })
})
