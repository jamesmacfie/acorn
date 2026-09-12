import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeTestNodeContext, type TestNodeContext } from '@acorn/plugin-api/testkit'
import type { AgentProviderDescriptor } from '@acorn/protocol/managedAgents.ts'
import type { AgentLifecycleFrame } from '../contract/lifecycle'
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

describe('managed session lifecycle', () => {
  let ctx: TestNodeContext
  let store: AgentStore
  let frames: AgentLifecycleFrame[]

  beforeEach(() => {
    ctx = makeTestNodeContext({ plugin: { name: 'agents' } })
    frames = []
    store = new AgentStore(ctx.storage.open(), ctx.core, (frame) => frames.push(frame))
  })

  afterEach(() => ctx.cleanup())

  const create = (title?: string) => store.createSession({
    taskId: randomUUID(),
    providerId: 'fake',
    profileId: 'fake',
    kind: 'interactive',
    config: {},
    ...(title ? { title } : {}),
  }, PROVIDER)

  it('announces creation, generated fallback, and idempotent insertion state without content', async () => {
    const session = await create()
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
    expect(frames.at(-1)).toEqual({
      channel: 'plugin:agents:sessions-changed',
      taskId: session.taskId,
      sessionId: session.id,
      present: true,
      archived: false,
      changes: ['renamed'],
      renameSource: 'generated',
    })
    expect(frames.at(-1)).not.toHaveProperty('title')

    const replay = await store.enqueueTurn(session.id, {
      input: [{ type: 'text', text: 'ignored replay' }],
      source: 'interactive',
      effectivePolicy: {},
      idempotencyKey: key,
    })
    expect(replay).toMatchObject({ inserted: false, firstTurnFallback: null, sessionAfterRename: null })
    expect(frames).toHaveLength(2)
  })

  it('uses compare-and-set and emits one stable event for combined user changes', async () => {
    const session = await create()
    frames = []
    const equal = await store.renameSession(session.id, {
      title: session.title,
      source: 'user',
    })
    expect(equal).toEqual({ session, changed: false })
    expect(frames).toEqual([])

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
    const session = await create('Owner title')
    frames = []
    const outcome = await store.enqueueTurn(session.id, {
      input: [{ type: 'text', text: 'Please implement generated session naming now' }],
      source: 'interactive',
      effectivePolicy: {},
      idempotencyKey: randomUUID(),
    })
    expect(outcome).toMatchObject({ inserted: true, firstTurnFallback: null, sessionAfterRename: null })
    expect((await store.requireSession(session.id)).title).toBe('Owner title')
    expect(frames).toEqual([])
  })

  it('announces restore and deletion exactly once', async () => {
    const session = await create()
    await store.patchSession(session.id, { archived: true })
    frames = []
    await store.patchSession(session.id, { archived: false })
    await store.deleteSession(session.id)
    expect(frames.map((frame) => frame.changes)).toEqual([['restored'], ['deleted']])
    expect(frames.at(-1)).toMatchObject({ present: false, archived: false })
  })
})
