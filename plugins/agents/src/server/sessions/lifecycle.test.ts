import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeTestCoreServices, makeTestDb, makeTestPluginDb, schema, type TestDb, type TestPluginDb } from '@acorn/plugin-api/testkit'
import type { AgentProviderDescriptor } from '@acorn/protocol/managedAgents.ts'
import type { AgentLifecycleFrame } from '../../contract/lifecycle'
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
