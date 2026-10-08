import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTestNodeContext, type TestNodeContext } from '@acorn/plugin-api/testkit'
import type { AgentPermissionOption, AgentSessionKind } from '../../contract/wire.ts'
import type { AgentBeforePermissionPayload } from '../../contract/permissionHook.ts'
import type { AgentLifecycleFrame } from '../../contract/lifecycle'
import { AgentDriverRegistry } from '../drivers/registry'
import { FakeAgentDriver } from '../drivers/fake'
import type { AgentDriverSession, AgentDriverStartOptions } from '../drivers/types'
import { ManagedAgentRuntime } from './runtime'
import { BEFORE_PERMISSION_HOOK } from '../../contract/permissionHook.ts'

// `agents:before-permission` through the real hook chain: the agents plugin declares the point, a second
// plugin context registers the handler, and a driver parks a request the way both real drivers do.

const deferred = <T = void>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

const CODEX_OPTIONS: AgentPermissionOption[] = [
  { id: 'accept', label: 'Allow once', kind: 'allow_once' },
  { id: 'acceptForSession', label: 'Allow for session', kind: 'allow_always' },
  { id: 'decline', label: 'Reject', kind: 'reject_once' },
  { id: 'cancel', label: 'Cancel turn', kind: 'reject_once' },
]

type Veto = (payload: AgentBeforePermissionPayload) => Promise<unknown>

describe('agents:before-permission', () => {
  let agents: TestNodeContext
  let policy: TestNodeContext
  let runtime: ManagedAgentRuntime
  let frames: AgentLifecycleFrame[]
  // What the driver's parked request was answered with, and the knobs a test turns on it.
  let answers: unknown[]
  let parked: Set<string>
  let options: AgentPermissionOption[]
  let askDuringStart: boolean
  let askForm: 'question' | 'elicitation' | null
  let emit: AgentDriverStartOptions['onEvent']

  const ask = (requestId = 'permission-1') => {
    parked.add(requestId)
    return emit({
      type: 'permission_request',
      request: { type: 'request', requestId, kind: 'permission', title: 'Allow command?', options },
      subject: { toolCallId: 'call-1', kind: 'command', command: 'git push --force', paths: ['/tmp'] },
      open: () => parked.has(requestId),
      respond: (resolution) => {
        if (!parked.delete(requestId)) throw new Error('no longer pending')
        answers.push(resolution)
      },
    })
  }

  const handle = (run: Veto) => policy.hooks.handle(`agents:${BEFORE_PERMISSION_HOOK.id}`, {
    id: 'rules',
    mode: 'veto',
    run: (payload) => run(payload as AgentBeforePermissionPayload),
  })

  beforeEach(() => {
    agents = makeTestNodeContext({ plugin: { name: 'agents' } })
    policy = makeTestNodeContext({ plugin: { name: 'policy' } })
    agents.hooks.declare(BEFORE_PERMISSION_HOOK)
    vi.spyOn(agents.core.tasks, 'requireRoot').mockResolvedValue('/work/task')
    vi.spyOn(agents.core.tasks, 'workspaceId').mockResolvedValue('workspace')
    frames = []; answers = []; parked = new Set(); options = CODEX_OPTIONS; askDuringStart = false; askForm = null
    const registry = new AgentDriverRegistry()
    registry.registerNative('fake', () => ({
      providerId: 'fake',
      profileId: 'fake',
      probe: () => new FakeAgentDriver().probe(),
      start: async (start): Promise<AgentDriverSession> => {
        emit = start.onEvent
        await start.onEvent({ type: 'session_state', state: 'ready' })
        // Before `start` returns, so the runtime holds no handle yet: the veto has to reach the parked
        // request through the event itself.
        if (askDuringStart) await ask()
        return {
          providerSessionRef: start.session.id, ready: true,
          sendTurn: async () => {
            if (askForm) void emit({ type: 'request', requestId: 'question-1', kind: askForm, title: 'Which target?' })
            else if (!askDuringStart) void ask()
            return {}
          },
          cancel: async () => {}, resolveRequest: async (_id, resolution) => { answers.push(resolution) }, stop: async () => {},
        }
      },
    }))
    runtime = new ManagedAgentRuntime({
      db: agents.storage.open(), dataDir: agents.dataDir, core: agents.core, registry, hooks: agents.hooks,
      internalEnv: () => ({}), secrets: agents.env.SECRETS, currentUserId: () => 'owner',
      publish: (frame) => { if (frame.channel.startsWith('plugin:agents:')) frames.push(frame as AgentLifecycleFrame) },
    })
  })
  afterEach(async () => { await runtime.stop(); policy.cleanup(); agents.cleanup(); vi.restoreAllMocks() })

  const start = async (kind: AgentSessionKind = 'interactive', posture?: 'gated' | 'autonomous') => {
    const session = await runtime.store.createSession({
      taskId: randomUUID(), providerId: 'fake', profileId: 'fake', kind, config: {},
    }, await new FakeAgentDriver().probe(), posture)
    const turn = await runtime.enqueueTurn(session.id, {
      input: [{ type: 'text', text: 'Push it.' }], source: 'interactive', effectivePolicy: {}, idempotencyKey: randomUUID(),
    }, { posture })
    return { session, turn }
  }
  const requestStatuses = () => frames.flatMap((frame) => frame.channel === 'plugin:agents:request-changed' ? [frame.status] : [])

  it('rejects an autonomous permission once without an attention row', async () => {
    const { session, turn } = await start('workflow', 'autonomous')
    await vi.waitFor(async () => expect((await runtime.store.request(session.id, 'permission-1'))?.status).toBe('resolved'))
    expect(answers).toEqual([{ optionId: 'decline' }])
    expect((await runtime.store.turn(turn.id))?.effectivePolicy.attendance).toBe('autonomous')
    expect((await runtime.store.requireSession(session.id)).attention).not.toBe('permission')
    expect(requestStatuses()).toEqual(['resolved'])
  })

  it('rejects an autonomous startup request before the driver handle exists', async () => {
    askDuringStart = true
    const { session } = await start('workflow', 'autonomous')
    await vi.waitFor(() => expect(answers).toEqual([{ optionId: 'decline' }]))
    expect((await runtime.store.snapshot(session.id)).requests.every((request) => request.status === 'resolved')).toBe(true)
    expect(requestStatuses()).toEqual(['resolved'])
  })

  it('keeps a supervised workflow permission pending for the person', async () => {
    const { session } = await start('workflow', 'gated')
    await vi.waitFor(async () => expect((await runtime.store.request(session.id, 'permission-1'))?.status).toBe('pending'))
    expect(answers).toEqual([])
    expect((await runtime.store.requireSession(session.id)).attention).toBe('permission')
  })

  it.each(['question', 'elicitation'] as const)('cancels an autonomous %s without a person waiting', async (kind) => {
    askForm = kind
    const { session } = await start('workflow', 'autonomous')
    await vi.waitFor(async () => expect((await runtime.store.request(session.id, 'question-1'))?.status).toBe('resolved'))
    await vi.waitFor(() => expect(answers).toHaveLength(1))
    expect(answers[0]).toMatchObject({ cancelled: true })
    expect((await runtime.store.requireSession(session.id)).attention).not.toBe('question')
  })

  it('refuses with the first reject-once option and records the request already resolved', async () => {
    const seen: AgentBeforePermissionPayload[] = []
    handle(async (payload) => { seen.push(payload); return { ok: false, reason: 'No force-push.' } })
    const { session, turn } = await start('delegated')
    await vi.waitFor(async () => expect(await runtime.store.request(session.id, 'permission-1')).not.toBeNull())

    expect(answers).toEqual([{ optionId: 'decline' }])
    expect(seen).toEqual([{
      sessionId: session.id, taskId: session.taskId, requestId: 'permission-1', providerId: 'fake',
      unattended: true, title: 'Allow command?', root: '/work/task',
      toolCallId: 'call-1', kind: 'command', command: 'git push --force', paths: ['/tmp'],
    }])
    const row = await runtime.store.request(session.id, 'permission-1')
    expect(row).toMatchObject({ status: 'resolved', turnId: turn.id, resolution: { blocked: { by: 'policy', reason: 'No force-push.' } } })
    // Pending is what notifies, badges, and wakes a delegated parent (../../node/index.ts § publish).
    expect(requestStatuses()).toEqual(['resolved'])
    expect((await runtime.store.requireSession(session.id)).attention).not.toBe('permission')
    expect(await runtime.store.lifecycleRequests({ taskId: session.taskId })).toEqual([
      expect.objectContaining({ requestId: 'permission-1', status: 'resolved', blocked: { by: 'policy', reason: 'No force-push.' } }),
    ])
    const events = (await runtime.store.snapshot(session.id)).events.map((record) => record.event)
    expect(events).toContainEqual(expect.objectContaining({ type: 'request', blocked: { by: 'policy', reason: 'No force-push.' } }))
    expect(JSON.stringify(events)).not.toContain('git push --force')
  })

  it('cancels a request that offers no reject-once option, and never picks a lasting answer', async () => {
    options = [
      { id: 'allow', label: 'Allow', kind: 'allow_once' },
      { id: 'never', label: 'Always reject', kind: 'reject_always' },
    ]
    handle(async () => ({ ok: false, reason: 'No.' }))
    const { session } = await start()
    await vi.waitFor(async () => expect(await runtime.store.request(session.id, 'permission-1')).not.toBeNull())
    expect(answers).toEqual([{ cancelled: true }])
  })

  it('reaches the parked request while the driver is still starting', async () => {
    askDuringStart = true
    handle(async () => ({ ok: false, reason: 'No.' }))
    const { session } = await start()
    await vi.waitFor(async () => expect((await runtime.store.request(session.id, 'permission-1'))?.status).toBe('resolved'))
    expect(answers).toEqual([{ optionId: 'decline' }])
  })

  it('passes a request to the person when the handler throws', async () => {
    handle(async () => { throw new Error('broken rule') })
    const { session } = await start()
    await vi.waitFor(async () => expect((await runtime.store.request(session.id, 'permission-1'))?.status).toBe('pending'))
    expect(answers).toEqual([])
    expect(requestStatuses()).toEqual(['pending'])
  })

  it('keeps the session streaming while a handler stalls, then passes the request to the person', async () => {
    handle(() => new Promise(() => {}))
    const { session } = await start()
    await vi.waitFor(() => expect(parked.has('permission-1')).toBe(true))
    await emit({ type: 'assistant_message', text: 'Still working while the policy thinks.' })
    await vi.waitFor(async () => expect((await runtime.store.snapshot(session.id)).events
      .some((record) => record.event.type === 'assistant_message')).toBe(true))
    expect(await runtime.store.request(session.id, 'permission-1')).toBeNull()
    await vi.waitFor(async () => expect((await runtime.store.request(session.id, 'permission-1'))?.status).toBe('pending'), { timeout: 7_000 })
    expect(answers).toEqual([])
  }, 10_000)

  it('keeps the asking turn after that turn completes during the wait', async () => {
    const verdict = deferred<unknown>()
    handle(() => verdict.promise)
    const { session, turn } = await start()
    await vi.waitFor(() => expect(parked.has('permission-1')).toBe(true))
    await emit({ type: 'turn_completed', stopReason: 'end_turn' })
    await vi.waitFor(async () => expect((await runtime.store.turn(turn.id))?.status).toBe('completed'))
    verdict.resolve({ ok: false, reason: 'No.' })
    await vi.waitFor(async () => expect((await runtime.store.request(session.id, 'permission-1'))?.turnId).toBe(turn.id))
  })

  it('records an honest warning, not a refusal, when the agent withdrew the request first', async () => {
    const verdict = deferred<unknown>()
    handle(() => verdict.promise)
    const { session } = await start()
    await vi.waitFor(() => expect(parked.has('permission-1')).toBe(true))
    parked.delete('permission-1')
    verdict.resolve({ ok: false, reason: 'No.' })
    await vi.waitFor(async () => expect((await runtime.store.snapshot(session.id)).events.map((record) => record.event))
      .toContainEqual(expect.objectContaining({ type: 'diagnostic', level: 'warning' })))
    expect(await runtime.store.request(session.id, 'permission-1')).toBeNull()
    expect(answers).toEqual([])
  })

  it('ignores a late verdict for a provider generation that has been replaced', async () => {
    const verdict = deferred<unknown>()
    handle(() => verdict.promise)
    const { session } = await start()
    await vi.waitFor(() => expect(parked.has('permission-1')).toBe(true))
    const stopping = runtime['engine'].stopLive(session.id)
    verdict.resolve({ ok: false, reason: 'No.' })
    await stopping
    await new Promise((resolve) => setImmediate(resolve))
    expect(answers).toEqual([])
    expect(await runtime.store.request(session.id, 'permission-1')).toBeNull()
  })
})
