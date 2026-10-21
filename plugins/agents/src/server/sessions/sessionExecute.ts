// The agents.sessionExecute implementation (AGENTS_SESSION_EXECUTE).
import { randomUUID } from 'node:crypto'
import { describeError, HEADLESS_TIMEOUT_MS, type HeadlessResult, type StreamEvent } from '@acorn/plugin-api/node'
import { MAX_AGENT_CONTEXT_BYTES } from '@acorn/protocol/agentContext.ts'
import type { AgentInputPart, AgentSession, AgentSessionSnapshot, AgentTurn, AgentUsage } from '../../contract/wire.ts'
import {
  managedProviderForProfile,
  MAX_AGENT_GOAL_CHARS,
  type AgentSessionExecute,
  type AgentSessionExecuteRequest,
  type AgentSessionExecuteResult,
  UnguardedAgentError,
} from '../../contract/sessionExecute'
import { unguardedSetting } from '../../shared/unguardedCommands'
import type { ManagedAgentRuntime } from './runtime'
import { assistantResult, parseStructuredResult, promptWithResultContract } from './resultContract'
import { contextBlock } from '../drivers/contextBlock'
import { ExecutionEvents } from './executionEvents'
import type { TurnFollowUps } from './turnFollowUps'
import { persistedAttendance, resolveAttendance, sessionAttendance } from './attendance'
import {
  goalContinuationPrompt,
  goalJudgeUnavailable,
  MAX_GOAL_CONTINUATIONS,
  type GoalJudgePorts,
} from './sessionGoal'
import { StepGoal, type GoalDecision } from './stepGoal'

function turnEvents(snapshot: AgentSessionSnapshot, turnIds: readonly string[]): StreamEvent[] {
  return snapshot.events
    .filter((record) => record.turnId != null && turnIds.includes(record.turnId))
    .map((record) => ({
      type: 'managed-agent',
      sequence: record.seq,
      event: record.event,
    }))
}

// How many times a step whose turn ended without its result is told to carry on. Anthropic's guidance
// for unattended runs is two or three, so that a run that is stuck ends and can be reviewed.
const MAX_CONTINUATIONS = 2

// Sent when a turn ended without what the step needs. The model can end a turn on a progress report,
// and a step with nothing to parse would otherwise fail on work that was still going.
const continuationPrompt = (schema: object | undefined): string =>
  schema
    ? 'Your turn ended before the fenced `json` result block this step needs. If the work is finished, reply with that block. If it is not, carry on and end with the block. If something is blocking you, say what it is.'
    : 'Your turn ended without a final message. If the work is finished, reply with the result. If it is not, carry on. If something is blocking you, say what it is.'

// Placed after the work request and before the result contract, so the model reads what to do, when it
// is finished, and how to answer, in that order.
const goalInstruction = (goal: string): string =>
  `Completion condition: ${goal}\n\nAcorn checks this condition when your turn ends and asks you to continue while useful work remains. If something blocks you, say what it is.`

// The step's prompt, then its context as parts of their own. The model reads the same tagged blocks
// either way. Past the per-turn context cap the blocks go inline in the text instead, which only the
// larger whole-input cap bounds, so a step with a big diff upstream still runs.
function stepInput(request: AgentSessionExecuteRequest, goal: string | undefined): AgentInputPart[] {
  const text = promptWithResultContract(
    goal ? [request.prompt, goalInstruction(goal)].join('\n\n') : request.prompt,
    request.schema,
  )
  const context = request.context ?? []
  const bytes = context.reduce((total, item) => total + Buffer.byteLength(item.content, 'utf8'), 0)
  if (bytes > MAX_AGENT_CONTEXT_BYTES)
    return [{ type: 'text', text: [text, ...context.map(contextBlock)].join('\n\n') }]
  return [
    { type: 'text', text },
    ...context.map((item): AgentInputPart => ({
      type: 'context',
      contextId: randomUUID(),
      ...item,
      provenance: request.runId ? `Workflow run ${request.runId}` : 'Workflow',
      byteSize: Buffer.byteLength(item.content, 'utf8'),
      estimatedTokens: Math.ceil(Buffer.byteLength(item.content, 'utf8') / 4),
      freshness: 'live',
      sensitivity: 'workspace',
      capturedAt: Date.now(),
    })),
  ]
}

const SETTLED = ['completed', 'failed', 'cancelled', 'interrupted']

const usdCost = (usage: AgentUsage | undefined): number | undefined =>
  usage?.cost?.currency.toUpperCase() === 'USD' ? usage.cost.amount : undefined

// Undefined when no turn reported the value, so an unknown stays unknown rather than becoming zero.
const sum = (values: (number | undefined)[]): number | undefined =>
  values.some((value) => value != null) ? values.reduce<number>((total, value) => total + (value ?? 0), 0) : undefined

/**
 * Usage and cost across every turn the step owns: its own, its continuations, and plugin notes that
 * joined it. Codex counts a thread cumulatively, so its last report already includes the earlier turns
 * and summing would count them twice. A turn that reported nothing adds nothing.
 */
function operationUsage(
  session: AgentSession,
  turns: readonly AgentTurn[],
): { costUsd: number | null; usage: HeadlessResult['capture']['usage'] } {
  const reported = turns.flatMap((turn) => (turn.usage ? [turn.usage] : []))
  const counted = session.providerId === 'codex' ? reported.slice(-1) : reported
  if (!counted.length) return { costUsd: null, usage: undefined }
  return {
    costUsd: sum(counted.map(usdCost)) ?? null,
    usage: {
      inputTokens: sum(counted.map((usage) => usage.inputTokens)),
      outputTokens: sum(counted.map((usage) => usage.outputTokens)),
      cachedInputTokens: sum(counted.map((usage) => usage.cachedInputTokens)),
      cacheWriteInputTokens: sum(counted.map((usage) => usage.cacheWriteInputTokens)),
    },
  }
}

/** The step's outcome once every turn it owns has settled. `turnIds` is all of them: the transcript it
 *  hands back covers them, and the result is the latest one's, which is a correcting note's reply when
 *  one joined. */
function resultFromSnapshot(
  snapshot: AgentSessionSnapshot,
  turnIds: readonly string[],
  schema: object | undefined,
): HeadlessResult | null {
  // The snapshot's turns are in queue order.
  const turn = snapshot.turns.at(-1)
  if (!turn || snapshot.turns.some((candidate) => !SETTLED.includes(candidate.status))) return null
  const events = turnEvents(snapshot, turnIds)
  const result = assistantResult(
    snapshot.events.filter((record) => record.turnId === turn.id),
    Infinity,
  )
  const structuredOutput = result ? parseStructuredResult(result, schema) : null
  const capture = {
    result,
    structuredOutput,
    sessionId: snapshot.session.providerSessionRef,
    ...operationUsage(snapshot.session, snapshot.turns),
    events,
  }
  if (turn.status === 'cancelled') {
    return { status: 'cancelled', exitCode: null, capture, stderrTail: '', agentSessionId: snapshot.session.id }
  }
  if (turn.status === 'failed' || turn.status === 'interrupted') {
    return {
      status: 'error',
      exitCode: null,
      capture,
      stderrTail: turn.error?.message ?? turn.stopReason ?? 'Managed agent turn failed.',
      agentSessionId: snapshot.session.id,
    }
  }
  // Before the malformed check: a declined turn has nothing to parse, and telling the step to carry
  // on would only ask the same question again.
  if (turn.stopReason === 'refusal') {
    return {
      status: 'error',
      exitCode: null,
      capture,
      stderrTail: "The model declined this request. Rephrase the step's prompt, or run the step on another model.",
      agentSessionId: snapshot.session.id,
    }
  }
  if (result?.trimStart().startsWith('BLOCKED:')) {
    return {
      status: 'error',
      exitCode: null,
      capture,
      stderrTail: result.trim().split('\n')[0]!,
      agentSessionId: snapshot.session.id,
    }
  }
  if (!result || (schema && structuredOutput == null)) {
    return {
      status: 'malformed',
      exitCode: 0,
      capture,
      stderrTail: schema
        ? 'Managed agent returned no parseable structured result.'
        : 'Managed agent returned no response.',
      agentSessionId: snapshot.session.id,
    }
  }
  return { status: 'ok', exitCode: 0, capture, stderrTail: '', agentSessionId: snapshot.session.id }
}

async function sessionFor(runtime: ManagedAgentRuntime, request: AgentSessionExecuteRequest, providerId: string) {
  if (request.managedSessionId) {
    const session = await runtime.store.requireSession(request.managedSessionId)
    if (session.taskId !== request.taskId || session.providerId !== providerId || session.kind !== 'workflow') {
      throw new Error('The persisted managed workflow session does not match this step.')
    }
    const attendance =
      request.posture === undefined
        ? sessionAttendance(session)
        : resolveAttendance(session, 'workflow', request.posture)
    if (session.config.initialAttendance === undefined) {
      return runtime.store.patchSession(session.id, { config: { ...session.config, initialAttendance: attendance } })
    }
    if (sessionAttendance(session) !== attendance)
      throw new Error('The workflow session posture does not match this run.')
    return session
  }
  return runtime.createSession(
    {
      taskId: request.taskId,
      providerId,
      profileId: request.profileId ?? providerId,
      kind: 'workflow',
      title: request.title,
      config: {
        workflowRunId: request.runId,
        workflowStepId: request.stepId,
        toolCeiling: request.tools ?? {},
      },
    },
    `workflow-session:${request.stepId ?? randomUUID()}`,
    request.posture,
  )
}

// How long to wait for the provider to report its option list before applying a step's requested
// config. `wait` hands back the current snapshot on expiry, so a slow provider costs the step this
// much and then runs on the provider's own settings.
const CONFIG_READY_TIMEOUT_MS = 30_000

/** The provider options a step asked for, applied to its session. Ordered after the provider's
 *  `session_metadata` because that list is the only thing a value can be validated against, and
 *  before the turn is enqueued because the Claude driver reads a switch through `setConfig` only. */
async function applyRequestedConfig(
  runtime: ManagedAgentRuntime,
  sessionId: string,
  wanted: Record<string, string> | undefined,
): Promise<void> {
  if (!wanted || !Object.keys(wanted).length) return
  await runtime.wait(sessionId, 0, 'ready', CONFIG_READY_TIMEOUT_MS)
  await runtime.applyRequestedConfig(sessionId, wanted)
}

type JudgeUsage = { inputTokens?: number; outputTokens?: number }

/** Adds what the completion checks reported to the turns' usage. Tokens only: a check reports no cost. */
function withJudgeUsage(
  usage: HeadlessResult['capture']['usage'],
  judged: readonly JudgeUsage[],
): HeadlessResult['capture']['usage'] {
  if (!judged.length) return usage
  return {
    ...usage,
    inputTokens: sum([usage?.inputTokens, ...judged.map((item) => item.inputTokens)]),
    outputTokens: sum([usage?.outputTokens, ...judged.map((item) => item.outputTokens)]),
  }
}

/** The step ends on `reason` with whatever its last turn produced. */
const stopped = (result: HeadlessResult, reason: string): HeadlessResult => ({
  ...result,
  status: 'error',
  exitCode: null,
  stderrTail: reason,
})

/**
 * `followUps` is the operation registry, loaded on the first step. A step opens an operation on its
 * first turn: plugin notes about its turns join it, its reviewers get one window once its own turns
 * finish, and it publishes only after every joined turn has settled
 * (docs/managed-agents/unattended-follow-ups.md).
 *
 * `judge` runs completion checks for a step with a goal (docs/workflows/agent-steps.md § Completion
 * conditions). A goal is checked once the step's turns settle, before the review window, and again
 * whenever a repair or a joined note changes the step's turns.
 */
export function createSessionExecute(
  runtime: ManagedAgentRuntime,
  followUps?: () => Promise<TurnFollowUps>,
  judge?: GoalJudgePorts,
): AgentSessionExecute {
  return async (request) => {
    const providerId = managedProviderForProfile(request.profileId)
    if (!providerId) return null
    // Checked before any work starts, so a goal never runs without its check.
    const objective = request.goal?.trim()
    if (request.goal !== undefined) {
      if (!objective || objective.length > MAX_AGENT_GOAL_CHARS)
        throw new Error(`A completion condition must be 1 to ${MAX_AGENT_GOAL_CHARS} characters.`)
      const unavailable = judge
        ? goalJudgeUnavailable(judge, request.profileId!)
        : 'This node has no completion checker.'
      if (unavailable) throw new Error(unavailable)
    }
    const session = await sessionFor(runtime, request, providerId)
    await applyRequestedConfig(runtime, session.id, request.configOptions)
    if (request.posture === 'autonomous' && !request.allowUnguardedAgents) {
      // Read after the requested options are applied, and before the first turn is queued.
      const { config } = await runtime.store.requireSession(session.id)
      const unguarded = Array.isArray(config.configOptions) ? unguardedSetting(config.configOptions) : undefined
      if (unguarded) throw new UnguardedAgentError(unguarded.value)
    }
    const registry = await followUps?.()
    const beforeSeq = (await runtime.store.requireSession(session.id)).lastEventSeq
    const forwarding = new ExecutionEvents(session.id, beforeSeq, request.onEvent)
    const unsubscribe = runtime.frames.subscribe((frame) => forwarding.receive(frame))
    try {
      const first = await runtime.enqueueTurn(
        session.id,
        {
          input: stepInput(request, objective),
          source: 'workflow',
          effectivePolicy: {
            // Codex reads the model and the effort off the policy at turn time; the Claude driver takes
            // them only through the session config above. Both are written so the two drivers see one
            // request, and `configOptions` wins over the older `model` field where a file sets both.
            model: request.configOptions?.model ?? request.model,
            ...(request.configOptions?.reasoning ? { effort: request.configOptions.reasoning } : {}),
            ...(request.configOptions ? { configOptions: request.configOptions } : {}),
            workflowRunId: request.runId,
            workflowStepId: request.stepId,
            schema: request.schema,
            toolCeiling: request.tools ?? {},
          },
          idempotencyKey: `workflow-turn:${request.stepId ?? randomUUID()}:${beforeSeq}`,
        },
        { posture: request.posture },
      )
      persistedAttendance(first.effectivePolicy)
      // Every turn the step owns, in the order they were queued. Notes join through the operation.
      const turnIds = [first.id]
      forwarding.acceptTurn(first.id)
      const operation = registry?.open(first, 'workflow', (turnId) => {
        turnIds.push(turnId)
        forwarding.acceptTurn(turnId)
      })
      const goal =
        objective && judge
          ? new StepGoal(
              { judge, store: runtime.store, onChange: request.onGoal },
              objective,
              session.id,
              request.profileId!,
              first.id,
            )
          : null
      // The events the loop below waits past. It moves on whenever the step is still waiting on a turn,
      // because a wait for `turn_completed` after `beforeSeq` is already met by the first turn.
      let waitSeq = beforeSeq
      let repairs = 0
      let reviewed = false
      // Set when the operation changed without a turn completing, so the loop looks again at once.
      let recheck = false
      // The turn set the goal was found satisfied for, and the turn set the step was stopped on. A
      // turn joining changes the set, so either decision goes stale and the loop decides again.
      // Asserted rather than annotated: TypeScript would otherwise narrow them to null across the loop.
      let satisfiedFor = null as string | null
      let stop = null as { key: string; reason: string } | null
      const startedAt = Date.now()
      const timeoutMs = request.timeoutMs ?? HEADLESS_TIMEOUT_MS
      const remainingMs = () => timeoutMs - (Date.now() - startedAt)
      // Turns are only ever appended, so the count and the newest one name the set.
      const turnSet = () => `${turnIds.length}:${turnIds.at(-1)}`
      // Closes the operation first, so no note joins after the sweep, then cancels newest first so a
      // cancelled running turn doesn't start the next queued one.
      const cancelAll = async () => {
        if (operation) await registry!.close(operation)
        for (const turnId of [...turnIds].reverse()) await runtime.cancelTurn(session.id, turnId)
      }
      let cancelled = request.signal?.aborted ?? false
      let cancellation: Promise<void> | undefined
      const abort = () => {
        cancelled = true
        cancellation = cancelAll()
        // The loop joins the cancellation before capturing. Suppress an unhandled rejection meanwhile.
        void cancellation.catch(() => {})
      }
      const unfinished = (snapshot: AgentSessionSnapshot) => ({
        result: assistantResult(
          snapshot.events.filter((record) => record.turnId === turnIds.at(-1)),
          Infinity,
        ),
        structuredOutput: null,
        sessionId: snapshot.session.providerSessionRef,
        costUsd: null,
        usage: undefined,
        events: turnEvents(snapshot, turnIds),
      })
      const finish = async (result: HeadlessResult): Promise<AgentSessionExecuteResult> => {
        if (!goal) return result
        const capture = { ...result.capture, usage: withJudgeUsage(result.capture.usage, goal.judgeUsage) }
        return { ...result, capture, goal: await goal.finish(result) }
      }
      // The caller's say on each turn Acorn queues by itself, and on each check, with usage so far.
      const admit = async (kind: 'turn' | 'check', snapshot: AgentSessionSnapshot): Promise<string | null> => {
        if (!request.admitAutomatic) return null
        const { costUsd, usage } = operationUsage(snapshot.session, snapshot.turns)
        return request.admitAutomatic({
          kind,
          usage: { costUsd, usage: withJudgeUsage(usage, goal?.judgeUsage ?? []) },
        })
      }
      const enqueueAutomatic = async (text: string, key: string): Promise<string> => {
        forwarding.beginEnqueue()
        const next = await runtime.enqueueTurn(
          session.id,
          {
            input: [{ type: 'text', text }],
            source: 'workflow',
            effectivePolicy: { ...first.effectivePolicy, continuationOf: first.id },
            idempotencyKey: key,
          },
          { originTurnId: first.id },
        )
        turnIds.push(next.id)
        forwarding.acceptTurn(next.id)
        return next.id
      }
      // One completion check of the settled turns in `snapshot`. 'stale' means the step changed while
      // it ran, or was cancelled, so the loop looks again rather than acting on it.
      const checkGoal = async (goal: StepGoal, snapshot: AgentSessionSnapshot): Promise<'stale' | GoalDecision> => {
        const checked = turnSet()
        const owned = snapshot.events.filter((record) => record.turnId != null && turnIds.includes(record.turnId))
        let verdict = await goal.saved(turnIds)
        if (cancelled) return 'stale'
        if (!verdict) {
          const refused = await admit('check', snapshot)
          if (cancelled) return 'stale'
          if (refused) {
            goal.set('stopped', refused)
            return { kind: 'stop', status: 'stopped', reason: refused }
          }
          goal.set('checking')
          try {
            verdict = await goal.judge(owned, turnIds.at(-1)!, request.signal, remainingMs())
          } catch (error) {
            if (cancelled) return 'stale'
            const reason = `Unable to check completion: ${describeError(error).message}`
            goal.set('unavailable', reason)
            return { kind: 'stop', status: 'unavailable', reason }
          }
          // A note admitted or a turn queued while the judge ran makes this verdict stale.
          if (cancelled || turnSet() !== checked || operation?.admitting.size) return 'stale'
          const after = await runtime.captureExecution(session.id, turnIds)
          if (cancelled || turnSet() !== checked || after.turns.some((turn) => !SETTLED.includes(turn.status)))
            return 'stale'
          await goal.save(turnIds, snapshot.session.lastEventSeq, verdict)
          if (cancelled) return 'stale'
        }
        const last = snapshot.turns.at(-1)!
        return goal.decide(verdict, { id: last.id, events: owned.filter((record) => record.turnId === last.id) })
      }
      request.signal?.addEventListener('abort', abort, { once: true })
      try {
        for (;;) {
          if (cancelled) {
            await cancellation
            // Again, for a continuation enqueued while the first sweep ran.
            await cancelAll()
            const snapshot = await runtime.captureExecution(session.id, turnIds)
            const settled = resultFromSnapshot(snapshot, turnIds, request.schema)
            // A cancel that lands after the step's turns finished leaves an ordinary step's result
            // standing. A step with a goal publishes no success once cancelled: its check never finished.
            return finish(
              settled && !(goal && settled.status === 'ok')
                ? settled
                : {
                    status: 'cancelled',
                    exitCode: null,
                    capture: settled?.capture ?? unfinished(snapshot),
                    stderrTail: '',
                    agentSessionId: session.id,
                  },
            )
          }
          const elapsed = Date.now() - startedAt
          if (elapsed >= timeoutMs) {
            await cancelAll()
            const snapshot = await runtime.captureExecution(session.id, turnIds)
            return finish({
              status: 'timeout',
              exitCode: null,
              capture: unfinished(snapshot),
              stderrTail: `Managed workflow turn exceeded ${timeoutMs}ms.`,
              agentSessionId: session.id,
            })
          }
          try {
            if (!recheck)
              await runtime.wait(
                session.id,
                waitSeq,
                'turn_completed',
                Math.min(1_000, timeoutMs - elapsed),
                request.signal,
              )
          } catch (error) {
            if (!cancelled) throw error
            continue
          }
          recheck = false
          const snapshot = await runtime.captureExecution(session.id, turnIds)
          if (cancelled) continue
          waitSeq = snapshot.session.lastEventSeq
          const settled = resultFromSnapshot(snapshot, turnIds, request.schema)
          if (!settled) continue
          const key = turnSet()
          const answered = settled.status === 'ok' || settled.status === 'malformed'
          // The goal first: a valid answer with work left continues, and repair only polishes a finished one.
          if (goal && answered && stop?.key !== key && satisfiedFor !== key) {
            const decision = await checkGoal(goal, snapshot)
            if (decision === 'stale') {
              recheck = !cancelled
              continue
            }
            if (decision.kind === 'stop') stop = { key, reason: decision.reason }
            else if (decision.kind === 'satisfied') satisfiedFor = key
            else {
              const refused = await admit('turn', snapshot)
              if (cancelled) continue
              if (refused) {
                goal.set('stopped', refused)
                stop = { key, reason: refused }
              } else {
                goal.queued(
                  await enqueueAutomatic(
                    promptWithResultContract(
                      goalContinuationPrompt(goal.objective, goal.summary().verdict!.reason),
                      request.schema,
                    ),
                    `workflow-goal:${first.id}:${goal.automatic + 1}`,
                  ),
                  'goal',
                )
                continue
              }
            }
          }
          const result = stop?.key === key ? stopped(settled, stop.reason) : settled
          if (
            result.status === 'malformed' &&
            repairs < MAX_CONTINUATIONS &&
            (!goal || goal.automatic < MAX_GOAL_CONTINUATIONS)
          ) {
            const refused = await admit('turn', snapshot)
            if (cancelled) continue
            if (refused) {
              goal?.set('stopped', refused)
              stop = { key, reason: refused }
              recheck = true
              continue
            }
            repairs += 1
            const turnId = await enqueueAutomatic(
              continuationPrompt(request.schema),
              `workflow-continue:${first.id}:${repairs}`,
            )
            goal?.queued(turnId, 'repair')
            continue
          }
          // One review window, once the step has a finished answer. A note it sends queues another turn,
          // which the loop waits for before it publishes anything.
          if (operation && !reviewed && (result.status === 'ok' || result.status === 'malformed')) {
            reviewed = true
            await registry!.review(operation, snapshot.turns.at(-1)!.id, remainingMs())
            recheck = true
            continue
          }
          // Nothing joins after this. Go round once more for a note that was being admitted as it closed.
          if (operation?.open) {
            await registry!.close(operation)
            recheck = true
            continue
          }
          return finish(result)
        }
      } finally {
        request.signal?.removeEventListener('abort', abort)
        if (operation) registry!.release(operation)
      }
    } finally {
      unsubscribe()
    }
  }
}
