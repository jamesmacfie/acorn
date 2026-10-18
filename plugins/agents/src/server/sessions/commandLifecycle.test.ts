import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTestNodeContext, type TestNodeContext } from '@acorn/plugin-api/testkit'
import type { AgentWsFrame } from '../../contract/wire'
import { normalizeCodexNotification } from '../drivers/codexNormalizer'
import { FakeAgentDriver } from '../drivers/fake'
import { AgentDriverRegistry } from '../drivers/registry'
import { buildConversationItems } from '../../client/sessions/conversationItems'
import { foldToolEvents } from '../../shared/toolFold'
import { ManagedAgentRuntime } from './runtime'
import { AgentStore } from './store'

describe('command lifecycle across restart and delayed output', () => {
  let ctx: TestNodeContext
  let store: AgentStore
  let runtime: ManagedAgentRuntime | undefined
  const frames: AgentWsFrame[] = []

  beforeEach(() => {
    ctx = makeTestNodeContext({ plugin: { name: 'agents' } })
    store = new AgentStore(ctx.storage.open(), ctx.core)
    frames.length = 0
  })
  afterEach(async () => {
    await runtime?.stop()
    runtime = undefined
    ctx.cleanup()
  })

  async function open() {
    const session = await store.createSession(
      { taskId: randomUUID(), providerId: 'fake', profileId: 'fake', kind: 'interactive', config: {} },
      await new FakeAgentDriver().probe(),
    )
    const turn = await next(session.id)
    return { session, turn }
  }
  async function next(sessionId: string) {
    const { turn } = await store.enqueueTurn(sessionId, {
      input: [{ type: 'text', text: 'Run a command' }],
      source: 'interactive',
      effectivePolicy: {},
      idempotencyKey: randomUUID(),
    })
    await store.startTurn(turn.id)
    await store.recordEvent(sessionId, turn.id, { type: 'user_message', text: 'Run a command' })
    return turn
  }
  async function command(sessionId: string, turnId: string | null, method: string, extra = {}) {
    for (const event of normalizeCodexNotification({
      method,
      params: {
        item: { id: 'cmd', type: 'commandExecution', command: 'sleep 30', ...extra },
        itemId: 'cmd',
        delta: 'first\n',
        ...extra,
      },
    }))
      await store.recordEvent(sessionId, turnId, event)
  }
  const cards = async (sessionId: string) =>
    buildConversationItems(foldToolEvents((await store.clientSnapshot(sessionId)).events))
      .flatMap((item) => [item, ...(item.children ?? [])])
      .filter((item) => item.event.type === 'tool')
      .map((item) => (item.event.type === 'tool' ? item.event.tool : null))

  it('repairs a crash and older interrupted history past cursors without changing output or card order', async () => {
    const { session, turn } = await open()
    await command(session.id, turn.id, 'item/started')
    await command(session.id, turn.id, 'item/commandExecution/outputDelta')
    const before = await store.snapshot(session.id)
    const firstCard = buildConversationItems(before.events).find((item) => item.event.type === 'tool')!
    runtime = new ManagedAgentRuntime({
      db: ctx.storage.open(),
      core: ctx.core,
      dataDir: ctx.dataDir,
      secrets: ctx.env.SECRETS,
      internalEnv: () => ({}),
      currentUserId: () => null,
      registry: new AgentDriverRegistry(),
      publish: (frame) => {
        if (frame.channel === 'agent:event' || frame.channel === 'agent:session') frames.push(frame)
      },
    })
    await runtime.reconcile()
    const after = await store.clientSnapshot(session.id)
    expect(after.session.runtimeState).toBe('stopped')
    expect(after.turns[0]?.status).toBe('interrupted')
    expect(await cards(session.id)).toMatchObject([{ status: 'interrupted', output: 'first\n', input: 'sleep 30' }])
    expect(buildConversationItems(after.events).find((item) => item.event.type === 'tool')).toMatchObject({
      key: firstCard.key,
      firstSeq: firstCard.firstSeq,
      createdAt: firstCard.createdAt,
    })
    expect((await store.clientEventPage(session.id, before.session.lastEventSeq)).events).toContainEqual(
      expect.objectContaining({
        turnId: turn.id,
        event: expect.objectContaining({
          type: 'tool',
          tool: expect.objectContaining({ status: 'interrupted' }),
        }),
      }),
    )
    expect(frames).toContainEqual(
      expect.objectContaining({
        channel: 'agent:event',
        event: expect.objectContaining({
          event: expect.objectContaining({ type: 'tool', tool: expect.objectContaining({ status: 'interrupted' }) }),
        }),
      }),
    )
    const seq = after.session.lastEventSeq
    await runtime.reconcile()
    expect((await store.requireSession(session.id)).lastEventSeq).toBe(seq)
  })

  it.each(['interrupted', 'cancelled', 'completed'] as const)(
    'projects saved %s history on snapshots and event pages',
    async (status) => {
      const { session, turn } = await open()
      await command(session.id, turn.id, 'item/started')
      await command(session.id, turn.id, 'item/commandExecution/outputDelta')
      if (status === 'interrupted') await store.interruptActiveTurn(session.id, 'Restart')
      if (status === 'cancelled') await store.cancelTurn(turn.id)
      if (status === 'completed') await store.recordEvent(session.id, turn.id, { type: 'turn_completed' })
      await store.recordEvent(session.id, null, { type: 'session_state', state: 'stopped' })
      const expected = status === 'completed' ? 'unknown' : status
      expect(await cards(session.id)).toMatchObject([{ status: expected, output: 'first\n' }])
      expect(
        foldToolEvents((await store.clientEventPage(session.id)).events).find((record) => record.event.type === 'tool')
          ?.event,
      ).toMatchObject({ tool: { status: expected } })
      // Read projection preserves the provider facts in the durable history.
      expect(
        foldToolEvents((await store.snapshot(session.id)).events).find((record) => record.event.type === 'tool')?.event,
      ).toMatchObject({ tool: { status: 'running' } })
    },
  )

  it('joins late completion to the original card and keeps late output from reviving work or completed status', async () => {
    const { session, turn } = await open()
    await command(session.id, turn.id, 'item/started')
    await store.recordEvent(session.id, turn.id, { type: 'turn_completed' })
    await command(session.id, null, 'item/completed', { aggregatedOutput: 'first\n', status: 'completed' })
    await command(session.id, null, 'item/commandExecution/outputDelta', { delta: 'late\n' })
    expect(await cards(session.id)).toMatchObject([{ status: 'completed', output: 'first\nlate\n' }])
    expect((await store.requireSession(session.id)).runtimeState).toBe('ready')
    const second = await next(session.id)
    await command(session.id, turn.id, 'item/completed', { aggregatedOutput: 'first\nlate\n', status: 'completed' })
    expect((await store.requireSession(session.id)).runtimeState).toBe('working')
    expect((await store.turn(second.id))?.status).toBe('active')
  })

  it('keeps a background command running past its turn, then reads it as unknown after a restart', async () => {
    const { session, turn } = await open()
    await command(session.id, turn.id, 'item/started')
    await store.recordEvent(session.id, turn.id, {
      type: 'tool',
      tool: { id: 'cmd', title: '', kind: 'execute', background: true },
    })
    await store.recordEvent(session.id, turn.id, { type: 'turn_completed' })
    await command(session.id, null, 'item/commandExecution/outputDelta')
    expect(await cards(session.id)).toMatchObject([{ status: 'running', background: true, output: 'first\n' }])
    // A background command is not the session's own work.
    expect((await store.requireSession(session.id)).runtimeState).toBe('ready')
    runtime = new ManagedAgentRuntime({
      db: ctx.storage.open(),
      core: ctx.core,
      dataDir: ctx.dataDir,
      secrets: ctx.env.SECRETS,
      internalEnv: () => ({}),
      currentUserId: () => null,
      registry: new AgentDriverRegistry(),
    })
    await runtime.reconcile()
    expect(await cards(session.id)).toMatchObject([{ status: 'unknown', background: true, output: 'first\n' }])
  })

  it('settles only commands written since the last start began, then records when this one began', async () => {
    async function backgroundCommand() {
      const { session, turn } = await open()
      await command(session.id, turn.id, 'item/started')
      await store.recordEvent(session.id, turn.id, {
        type: 'tool',
        tool: { id: 'cmd', title: '', kind: 'execute', background: true },
      })
      await store.recordEvent(session.id, turn.id, { type: 'turn_completed' })
      return session
    }
    const older = await backgroundCommand()
    // As if the previous start's settle began after `older` was written, so that start owned it.
    store.markCommandsSettled(Date.now() + 1)
    await new Promise((resolve) => setTimeout(resolve, 5))
    const newer = await backgroundCommand()
    runtime = new ManagedAgentRuntime({
      db: ctx.storage.open(),
      core: ctx.core,
      dataDir: ctx.dataDir,
      secrets: ctx.env.SECRETS,
      internalEnv: () => ({}),
      currentUserId: () => null,
      registry: new AgentDriverRegistry(),
    })
    const startedAt = Date.now()
    await runtime.reconcile()
    expect(await cards(newer.id)).toMatchObject([{ status: 'unknown', background: true }])
    expect(await cards(older.id)).toMatchObject([{ status: 'running', background: true }])
    // Ten minutes back from the start, for a clock set back before the next one.
    expect(store.commandsSettledBefore()).toBeGreaterThanOrEqual(startedAt - 10 * 60_000 - 1_000)
    expect(store.commandsSettledBefore()).toBeLessThan(startedAt)
  })

  it('settles stopped, child, and background commands with one read scoped to the last start', async () => {
    // Settled history from before the last start, which the restart must not read again.
    const { session: crashed, turn } = await open()
    for (let n = 0; n < 30; n++) {
      await command(crashed.id, turn.id, 'item/completed', { aggregatedOutput: 'old\n', status: 'completed' })
    }
    store.markCommandsSettled(Date.now() + 1)
    await new Promise((resolve) => setTimeout(resolve, 5))
    await store.recordEvent(crashed.id, turn.id, {
      type: 'tool',
      tool: { id: 'fresh', title: 'sleep 30', kind: 'execute', status: 'running' },
    })
    const { session: parent, turn: parentTurn } = await open()
    await store.recordEvent(parent.id, parentTurn.id, {
      type: 'subagent',
      subagent: { id: 'child', status: 'running' },
    })
    await store.recordEvent(parent.id, null, {
      type: 'tool',
      tool: { id: 'cmd', title: 'Child command', kind: 'execute', status: 'running', subagentId: 'child' },
    })
    await store.recordEvent(parent.id, parentTurn.id, { type: 'turn_completed' })
    const { session: background, turn: backgroundTurn } = await open()
    await command(background.id, backgroundTurn.id, 'item/started')
    await store.recordEvent(background.id, backgroundTurn.id, {
      type: 'tool',
      tool: { id: 'cmd', title: '', kind: 'execute', background: true },
    })
    await store.recordEvent(background.id, backgroundTurn.id, { type: 'turn_completed' })
    const since = store.commandsSettledBefore()
    runtime = new ManagedAgentRuntime({
      db: ctx.storage.open(),
      core: ctx.core,
      dataDir: ctx.dataDir,
      secrets: ctx.env.SECRETS,
      internalEnv: () => ({}),
      currentUserId: () => null,
      registry: new AgentDriverRegistry(),
    })
    const reads = vi.spyOn(runtime.store, 'unfinishedCommands')
    await runtime.reconcile()
    expect(reads.mock.calls).toEqual([[{ since }]])
    expect(await cards(crashed.id)).toMatchObject([
      { id: 'cmd', status: 'completed' },
      { id: 'fresh', status: 'interrupted' },
    ])
    expect(await cards(parent.id)).toMatchObject([{ status: 'unknown' }])
    expect(await cards(background.id)).toMatchObject([{ status: 'unknown', background: true }])
  })

  it('settles a background command with its exit code', async () => {
    const { session, turn } = await open()
    await command(session.id, turn.id, 'item/started')
    await store.recordEvent(session.id, turn.id, {
      type: 'tool',
      tool: { id: 'cmd', title: '', kind: 'execute', background: true },
    })
    await store.recordEvent(session.id, turn.id, { type: 'turn_completed' })
    await command(session.id, null, 'item/completed', { aggregatedOutput: 'boom\n', status: 'failed', exitCode: 1 })
    expect(await cards(session.id)).toMatchObject([
      { status: 'failed', exitCode: 1, background: true, output: 'boom\n' },
    ])
  })

  it('keeps background child execution live after the parent settles, then quiets it at Node startup', async () => {
    const { session, turn } = await open()
    await store.recordEvent(session.id, turn.id, { type: 'subagent', subagent: { id: 'child', status: 'running' } })
    await store.recordEvent(session.id, null, {
      type: 'tool',
      tool: {
        id: 'cmd',
        title: 'Child command',
        kind: 'execute',
        status: 'running',
        subagentId: 'child',
        output: 'child output',
      },
    })
    await store.recordEvent(session.id, turn.id, { type: 'turn_completed' })
    expect(await cards(session.id)).toMatchObject([{ status: 'running', output: 'child output' }])
    expect((await store.requireSession(session.id)).runtimeState).toBe('ready')
    runtime = new ManagedAgentRuntime({
      db: ctx.storage.open(),
      core: ctx.core,
      dataDir: ctx.dataDir,
      secrets: ctx.env.SECRETS,
      internalEnv: () => ({}),
      currentUserId: () => null,
      registry: new AgentDriverRegistry(),
    })
    await runtime.reconcile()
    expect((await store.requireSession(session.id)).subagents[0]?.status).toBe('idle')
    expect(await cards(session.id)).toMatchObject([{ status: 'unknown', output: 'child output' }])
  })
})
