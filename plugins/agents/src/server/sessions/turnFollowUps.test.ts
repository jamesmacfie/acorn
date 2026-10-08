import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTestNodeContext, type TestNodeContext } from '@acorn/plugin-api/testkit'
import { agentProfileRegistry } from '@acorn/plugin-api/node'
import type { SessionMessage, SessionMessenger } from '../../contract/sessionMessages.ts'
import type { TurnFollowUpContribution, TurnFollowUpWindow } from '../../contract/turnFollowUp.ts'
import type { AgentTurn, AgentUsage } from '../../contract/wire.ts'
import { AgentDriverRegistry } from '../drivers/registry'
import { FakeAgentDriver } from '../drivers/fake'
import { AgentDelegationStore } from '../delegation/store'
import { DelegationReports, reportKey } from '../delegation/reports'
import { ManagedAgentRuntime } from './runtime'
import { createSessionExecute } from './sessionExecute'
import { SessionMessages } from './sessionMessages'
import { TurnFollowUps } from './turnFollowUps'

// Unattended follow-ups at the agents/workflows boundary (docs/managed-agents/unattended-follow-ups.md):
// a scripted driver, a deterministic reviewer, and the real messenger.

type Reply = { text: string; usage?: AgentUsage; hold?: boolean; fail?: boolean }

describe('agents:turn-follow-up', () => {
  let ctx: TestNodeContext
  let runtime: ManagedAgentRuntime
  let replies: Reply[]
  let sent: string[]
  // Finishes a held turn with its scripted reply.
  let release: (() => Promise<void>) | null
  let reviewers: { id: string; pluginId: string; value: TurnFollowUpContribution }[]
  let followUps: TurnFollowUps
  let messages: SessionMessages
  let reports: DelegationReports
  let providerId: string
  let releaseProfile: () => void

  const build = (deadlineMs = 2_000) => {
    followUps = new TurnFollowUps({
      runtime,
      entries: () => reviewers,
      delegationLive: (turn) => reports.operationLive(turn),
      deadlineMs,
    })
    reports = new DelegationReports(runtime, new AgentDelegationStore(ctx.storage.open()), async () => followUps, ctx.core)
    messages = new SessionMessages({ runtime, entries: () => senders, notice: () => {}, followUps: async () => followUps })
  }
  let senders: { id: string; pluginId: string; value: { connect(sender: SessionMessenger): void } }[]
  const messenger = async (pluginId: string): Promise<SessionMessenger> => {
    let sender: SessionMessenger | null = null
    senders.push({ id: `${pluginId}:notes`, pluginId, value: { connect: (given) => { sender = given } } })
    await messages.reconcile()
    return sender!
  }
  const reviewer = (pluginId: string, review: (window: TurnFollowUpWindow) => Promise<void>) =>
    reviewers.push({ id: `${pluginId}:review`, pluginId, value: { review } })
  const note = (window: Pick<TurnFollowUpWindow, 'taskId' | 'sessionId' | 'turnId'>, text = 'add() subtracts.'): SessionMessage => ({
    taskId: window.taskId, sessionId: window.sessionId, originTurnId: window.turnId, text, subject: 'advisor blocker', idempotencyKey: randomUUID(),
  })

  beforeEach(() => {
    ctx = makeTestNodeContext({ plugin: { name: 'agents' } })
    vi.spyOn(ctx.core.tasks, 'requireRoot').mockResolvedValue(ctx.dataDir)
    vi.spyOn(ctx.core.tasks, 'workspaceId').mockResolvedValue('workspace')
    replies = []; sent = []; release = null; reviewers = []; senders = []
    providerId = 'scripted'
    const registry = new AgentDriverRegistry()
    const driver = (id: string) => ({
      providerId: id, profileId: id,
      probe: async () => ({ ...await new FakeAgentDriver().probe(), id, profileId: id }),
      start: async (options: Parameters<FakeAgentDriver['start']>[0]) => {
        await options.onEvent({ type: 'session_metadata', providerSessionRef: options.session.id })
        await options.onEvent({ type: 'session_state', state: 'ready' })
        let active = false
        const finish = async (reply: Reply) => {
          await options.onEvent({ type: 'assistant_message', text: reply.text })
          if (reply.usage) await options.onEvent({ type: 'usage', usage: reply.usage })
          if (reply.fail) await options.onEvent({ type: 'error', code: 'fixture_failure', message: 'Follow-up failed.', retryable: false })
          else await options.onEvent({ type: 'turn_completed', stopReason: 'end_turn' })
          active = false
        }
        return {
          providerSessionRef: options.session.id,
          get ready() { return !active },
          sendTurn: async ({ turn }: { turn: AgentTurn }) => {
            active = true
            sent.push(turn.id)
            const reply = replies.shift() ?? { text: 'Done.' }
            if (reply.hold) release = () => finish(reply)
            else await finish(reply)
            return {}
          },
          cancel: async () => { active = false },
          resolveRequest: async () => {},
          stop: async () => {},
        }
      },
    })
    registry.registerNative('scripted', () => driver('scripted') as never)
    registry.registerNative('codex', () => driver('codex') as never)
    const base = { kind: 'agent', command: 'scripted', backendPreference: 'tmux', transport: 'pty' } as const
    const releases = [
      agentProfileRegistry.register({ ...base, id: 'scripted', label: 'Scripted', managedProvider: 'scripted' }),
      agentProfileRegistry.register({ ...base, id: 'codex', label: 'Codex', managedProvider: 'codex' }),
    ]
    releaseProfile = () => releases.forEach((dispose) => dispose())
    runtime = new ManagedAgentRuntime({
      db: ctx.storage.open(), dataDir: ctx.dataDir, core: ctx.core, registry,
      internalEnv: () => ({}), secrets: ctx.env.SECRETS, currentUserId: () => 'owner',
    })
    build()
  })
  afterEach(async () => { await runtime.stop(); releaseProfile(); ctx.cleanup(); vi.restoreAllMocks() })

  const step = (patch: Partial<Parameters<ReturnType<typeof createSessionExecute>>[0]> = {}) =>
    createSessionExecute(runtime, async () => followUps)({
      taskId: 'task-1', profileId: providerId, title: 'Workflow: review', prompt: 'Write add().',
      schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] },
      runId: 'run-1', stepId: `step-${randomUUID()}`, timeoutMs: 20_000, ...patch,
    })
  const turnsOf = async (sessionId: string) => (await runtime.store.snapshot(sessionId, 0)).turns

  it.each(['gated', 'autonomous'] as const)('runs a blocker’s correction under %s before the step publishes', async (posture) => {
    replies = [
      { text: 'Done.\n```json\n{"ok": false}\n```', usage: { inputTokens: 100, outputTokens: 10, cost: { amount: 0.5, currency: 'USD' } } },
      { text: 'Fixed add().\n```json\n{"ok": true}\n```', usage: { inputTokens: 40, outputTokens: 4, cost: { amount: 0.25, currency: 'USD' } } },
    ]
    const sender = await messenger('acorn-advisor')
    const windows: TurnFollowUpWindow[] = []
    reviewer('acorn-advisor', async (window) => {
      windows.push(window)
      expect(await sender.queue(note(window))).toMatchObject({ ok: true })
    })
    const result = await step({ posture })
    expect(result).toMatchObject({ status: 'ok', capture: { result: expect.stringContaining('Fixed add()'), structuredOutput: { ok: true } } })
    // Both turns are the step's: its usage and cost are theirs together.
    expect(result!.capture.usage).toMatchObject({ inputTokens: 140, outputTokens: 14 })
    expect(result!.capture.costUsd).toBe(0.75)
    const [original, correction] = await turnsOf(result!.agentSessionId!)
    expect(windows).toEqual([expect.objectContaining({ turnId: original!.id, owner: 'workflow', taskId: 'task-1' })])
    expect(correction).toMatchObject({
      source: 'plugin', status: 'completed',
      effectivePolicy: { attendance: posture === 'autonomous' ? 'autonomous' : 'supervised', followUpOf: original!.id, sentBy: { pluginId: 'acorn-advisor' }, workflowRunId: 'run-1', workflowStepId: original!.effectivePolicy.workflowStepId },
    })
    expect(correction!.effectivePolicy.reportTo).toBeUndefined()
    expect(correction!.input[0]).toMatchObject({ text: expect.stringContaining('fenced `json` result block again') })
    // The correction is a plugin turn, so it opened no second window.
    expect(windows).toHaveLength(1)
    expect(await runtime.store.operationResult(`turn-follow-up:${original!.id}`, 'turn-follow-up.review'))
      .toMatchObject({ outcome: 'reviewed', reviewers: [{ pluginId: 'acorn-advisor', outcome: 'done' }] })
    // The step has finished, so the same note is now late.
    expect(await sender.queue(note({ taskId: 'task-1', sessionId: result!.agentSessionId!, turnId: original!.id }))).toEqual({ ok: false, reason: 'operation-closed' })
  })

  it('keeps a note queued during the running turn inside the step, and refuses notes with no live operation', async () => {
    replies = [{ text: 'Working.\n```json\n{"ok": true}\n```', hold: true }, { text: 'Understood.\n```json\n{"ok": true}\n```' }]
    const sender = await messenger('acorn-permission-policy')
    const running = step()
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    const [first] = await runtime.store.snapshot((await runtime.store.turn(sent[0]!))!.sessionId, 0).then((snapshot) => snapshot.turns)
    const sessionId = first!.sessionId
    expect(await sender.queue(note({ taskId: 'task-1', sessionId, turnId: first!.id }))).toMatchObject({ ok: true })
    // No origin, or an origin in another session, has no operation.
    expect(await sender.queue({ ...note({ taskId: 'task-1', sessionId, turnId: first!.id }), originTurnId: undefined })).toEqual({ ok: false, reason: 'operation-closed' })
    expect(await sender.queue(note({ taskId: 'task-1', sessionId, turnId: randomUUID() }))).toEqual({ ok: false, reason: 'operation-closed' })
    await release!()
    const result = await running
    expect(result?.capture.result).toContain('Understood.')
    expect((await turnsOf(sessionId)).map((turn) => [turn.source, turn.status])).toEqual([['workflow', 'completed'], ['plugin', 'completed']])
  })

  it('records a review timeout and refuses the late reviewer’s note', async () => {
    build(50)
    replies = [{ text: '```json\n{"ok": true}\n```' }]
    const sender = await messenger('acorn-advisor')
    let late: Promise<unknown> | null = null
    let signal: AbortSignal | null = null
    reviewer('acorn-advisor', (window) => {
      signal = window.signal
      late = new Promise((resolve) => setTimeout(resolve, 150)).then(() => sender.queue(note(window)))
      return new Promise(() => {})
    })
    const result = await step()
    expect(result?.status).toBe('ok')
    expect(signal!.aborted).toBe(true)
    expect(await late).toEqual({ ok: false, reason: 'operation-closed' })
    const [original, ...rest] = await turnsOf(result!.agentSessionId!)
    expect(rest).toEqual([])
    expect(await runtime.store.operationResult(`turn-follow-up:${original!.id}`, 'turn-follow-up.review'))
      .toMatchObject({ outcome: 'timed-out', reviewers: [{ pluginId: 'acorn-advisor', outcome: 'timed-out' }] })
  })

  it('finishes ordinary execution when a reviewer fails', async () => {
    replies = [{ text: '```json\n{"ok": true}\n```' }]
    reviewer('acorn-advisor', async () => { throw Object.assign(new Error('Advisor has used today’s allowance.'), { code: 'provider_budget_exhausted' }) })
    const result = await step()
    expect(result?.status).toBe('ok')
    const [original] = await turnsOf(result!.agentSessionId!)
    expect(await runtime.store.operationResult(`turn-follow-up:${original!.id}`, 'turn-follow-up.review'))
      .toMatchObject({ outcome: 'reviewed', reviewers: [{ pluginId: 'acorn-advisor', outcome: 'failed' }] })
  })

  it('leaves no orphan work when cancellation races the review and a note’s admission', async () => {
    replies = [{ text: '```json\n{"ok": true}\n```' }, { text: 'Fixing.', hold: true }]
    const sender = await messenger('acorn-advisor')
    const controller = new AbortController()
    reviewer('acorn-advisor', async (window) => {
      const queued = sender.queue(note(window))
      controller.abort()
      await queued
    })
    // The step's own turn had finished, so its result stands, as for any cancel that lands after it.
    const result = await step({ signal: controller.signal })
    const turns = await turnsOf(result!.agentSessionId!)
    expect(turns.every((turn) => ['completed', 'cancelled'].includes(turn.status))).toBe(true)
    expect(await runtime.store.operationResult(`turn-follow-up:${turns[0]!.id}`, 'turn-follow-up.review')).toMatchObject({ outcome: 'cancelled' })
  })

  it('takes Codex’s cumulative usage from its last turn instead of summing', async () => {
    providerId = 'codex'
    replies = [
      { text: '```json\n{"ok": false}\n```', usage: { inputTokens: 100, outputTokens: 10 } },
      { text: '```json\n{"ok": true}\n```', usage: { inputTokens: 150, outputTokens: 16 } },
    ]
    const sender = await messenger('acorn-advisor')
    reviewer('acorn-advisor', async (window) => { await sender.queue(note(window)) })
    const result = await step()
    expect(result!.capture.usage).toMatchObject({ inputTokens: 150, outputTokens: 16 })
    expect(result!.capture.costUsd).toBeNull()
  })

  it('does not review an operation twice, and a restart cancels a workflow step’s queued notes', async () => {
    replies = [{ text: '```json\n{"ok": true}\n```' }, { text: 'Hold.', hold: true }]
    let reviews = 0
    reviewer('acorn-advisor', async () => { reviews += 1 })
    const result = await step()
    const [original] = await turnsOf(result!.agentSessionId!)
    const operation = followUps.open(original!, 'workflow')
    expect(await followUps.review(operation, original!.id, 10_000)).toBeNull()
    expect(reviews).toBe(1)
    followUps.release(operation)

    // A note queued behind a held turn, as if the Node stopped with the step running.
    const sessionId = result!.agentSessionId!
    const held = await runtime.enqueueTurn(sessionId, { input: [{ type: 'text', text: 'More.' }], source: 'workflow', effectivePolicy: {}, idempotencyKey: randomUUID() })
    const orphan = await runtime.enqueueTurn(sessionId, {
      input: [{ type: 'text', text: 'Note.' }], source: 'plugin', effectivePolicy: { sentBy: { pluginId: 'acorn-advisor' }, followUpOf: held.id }, idempotencyKey: randomUUID(),
    })
    await runtime.store.cancelWorkflowFollowUps()
    expect((await runtime.store.turn(orphan.id))?.status).toBe('cancelled')
  })

  describe('a delegated turn', () => {
    const delegated = async (reply: Reply, effectivePolicy: Record<string, unknown> = {}) => {
      const owner = await runtime.store.createSession({ taskId: 'task-1', providerId: 'scripted', profileId: 'scripted', kind: 'interactive', config: {} }, await new FakeAgentDriver().probe())
      const child = await runtime.store.createSession({ taskId: 'task-1', providerId: 'scripted', profileId: 'scripted', kind: 'delegated', config: {} }, await new FakeAgentDriver().probe())
      replies = [reply]
      const turn = await runtime.enqueueTurn(child.id, {
        input: [{ type: 'text', text: 'Write add().' }], source: 'delegation', effectivePolicy: { reportTo: owner.id, ...effectivePolicy }, idempotencyKey: randomUUID(),
      })
      await vi.waitFor(async () => expect((await runtime.store.turn(turn.id))?.status).toBe('completed'))
      return { owner, child, turn }
    }

    it('reports once, after the accepted correction, with the correction’s message', async () => {
      const sender = await messenger('acorn-advisor')
      reviewer('acorn-advisor', async (window) => {
        expect(window.owner).toBe('delegation')
        await sender.queue(note(window))
        replies.push({ text: 'Fixed add().' })
      })
      const { owner, turn } = await delegated({ text: 'Done.' })
      await Promise.all([reports.deliver(turn.id), reports.deliver(turn.id)])
      await reports.deliver(turn.id)
      const ownerTurns = (await turnsOf(owner.id)).filter((candidate) => candidate.source === 'delegation_report')
      expect(ownerTurns).toHaveLength(1)
      expect((await runtime.store.turnForIdempotency(owner.id, reportKey(turn.id)))?.id).toBe(ownerTurns[0]!.id)
      const body = (ownerTurns[0]!.input[0] as { text: string }).text
      expect(body).toContain('Fixed add().')
      expect(body).toContain('A plugin sent it notes')
      // After the report, the operation is closed.
      expect(await sender.queue(note({ taskId: 'task-1', sessionId: turn.sessionId, turnId: turn.id }))).toEqual({ ok: false, reason: 'operation-closed' })
    })

    it('records an unverified check against a failed plugin follow-up outcome', async () => {
      const sender = await messenger('acorn-advisor')
      reviewer('acorn-advisor', async (window) => {
        await sender.queue(note(window))
        replies.push({ text: 'Could not finish.', fail: true })
      })
      const { owner, turn } = await delegated({ text: 'Done.' }, { checks: [{ kind: 'file-exists', path: 'output.txt' }] })
      await reports.deliver(turn.id)
      const [report] = (await turnsOf(owner.id)).filter((candidate) => candidate.source === 'delegation_report')
      const followUp = (await runtime.store.followUpTurns(turn.sessionId, turn.id))[0]!
      expect(followUp.status).toBe('failed')
      expect(report?.effectivePolicy.checkResults).toMatchObject({
        outcome: 'failed', outcomeTurnId: followUp.id,
        verdicts: [{ status: 'unverified', reason: 'Turn failed.' }],
      })
      expect((report!.input[0] as { text: string }).text).toContain('Outcome: failed')
    })

    it('sends no report and cancels the notes when the owner cancels a note', async () => {
      const sender = await messenger('acorn-advisor')
      const { owner, child, turn } = await delegated({ text: 'Done.' })
      replies.push({ text: 'Fixing.', hold: true })
      const queued = await sender.queue(note({ taskId: 'task-1', sessionId: child.id, turnId: turn.id }))
      expect(queued).toMatchObject({ ok: true })
      const delivering = reports.deliver(turn.id)
      await vi.waitFor(() => expect(sent).toContain((queued as { turnId: string }).turnId))
      await reports.cancelFollowUps(turn)
      await runtime.store.saveOperation('cancel-1', 'delegation.cancel', {}, turn.id)
      await delivering
      expect((await turnsOf(owner.id)).filter((candidate) => candidate.source === 'delegation_report')).toEqual([])
      expect((await runtime.store.turn((queued as { turnId: string }).turnId))?.status).toBe('cancelled')
    })
  })
})
