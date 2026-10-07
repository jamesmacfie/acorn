// The agents.sessionExecute implementation (contract/sessionExecute.ts).
//
// Moved from apps/node/src/wiring/managedWorkflowStep.ts, which existed in the app only because
// workflows couldn't import agents. It's agents' code: every line touches ManagedAgentRuntime, its
// session store and its turn lifecycle.
import { randomUUID } from 'node:crypto'
import { HEADLESS_TIMEOUT_MS, type HeadlessResult, type StreamEvent } from '@acorn/plugin-api/node'
import { MAX_AGENT_CONTEXT_BYTES } from '@acorn/protocol/agentContext.ts'
import type { AgentInputPart, AgentSession, AgentSessionSnapshot, AgentTurn, AgentUsage } from '../../contract/wire.ts'
import { managedProviderForProfile, type AgentSessionExecute, type AgentSessionExecuteRequest } from '../../contract/sessionExecute'
import type { ManagedAgentRuntime } from './runtime'
import { assistantResult, parseStructuredResult, promptWithResultContract } from './resultContract'
import { contextBlock } from '../drivers/contextBlock'
import { ExecutionEvents } from './executionEvents'
import type { TurnFollowUps } from './turnFollowUps'

// The profile-to-driver map moved to ../../contract/sessionExecute.ts, so a caller can ask before it
// calls whether a profile has a managed path at all. Re-exported here for the callers already on it.
export { managedProviderForProfile }

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
const continuationPrompt = (schema: object | undefined): string => schema
  ? 'Your turn ended before the fenced `json` result block this step needs. If the work is finished, reply with that block. If it is not, carry on and end with the block. If something is blocking you, say what it is.'
  : 'Your turn ended without a final message. If the work is finished, reply with the result. If it is not, carry on. If something is blocking you, say what it is.'

// The step's prompt, then its context as parts of their own. The model reads the same tagged blocks
// either way. Past the per-turn context cap the blocks go inline in the text instead, which only the
// larger whole-input cap bounds, so a step with a big diff upstream still runs.
function stepInput(request: AgentSessionExecuteRequest): AgentInputPart[] {
  const text = promptWithResultContract(request.prompt, request.schema)
  const context = request.context ?? []
  const bytes = context.reduce((total, item) => total + Buffer.byteLength(item.content, 'utf8'), 0)
  if (bytes > MAX_AGENT_CONTEXT_BYTES) return [{ type: 'text', text: [text, ...context.map(contextBlock)].join('\n\n') }]
  return [{ type: 'text', text }, ...context.map((item): AgentInputPart => ({
    type: 'context',
    contextId: randomUUID(),
    ...item,
    provenance: request.runId ? `Workflow run ${request.runId}` : 'Workflow',
    byteSize: Buffer.byteLength(item.content, 'utf8'),
    estimatedTokens: Math.ceil(Buffer.byteLength(item.content, 'utf8') / 4),
    freshness: 'live',
    sensitivity: 'workspace',
    capturedAt: Date.now(),
  }))]
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
function operationUsage(session: AgentSession, turns: readonly AgentTurn[]): { costUsd: number | null; usage: HeadlessResult['capture']['usage'] } {
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
  const result = assistantResult(snapshot.events.filter((record) => record.turnId === turn.id), Infinity)
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
      stderrTail: 'The model declined this request. Rephrase the step\'s prompt, or run the step on another model.',
      agentSessionId: snapshot.session.id,
    }
  }
  if (!result || (schema && structuredOutput == null)) {
    return {
      status: 'malformed',
      exitCode: 0,
      capture,
      stderrTail: schema ? 'Managed agent returned no parseable structured result.' : 'Managed agent returned no response.',
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
  )
}

// How long to wait for the provider to report its option list before applying a step's requested
// config. `wait` hands back the current snapshot on expiry, so a slow provider costs the step this
// much and then runs on the provider's own settings.
const CONFIG_READY_TIMEOUT_MS = 30_000

/** The provider options a step asked for, applied to its session. Ordered after the provider's
 *  `session_metadata` because that list is the only thing a value can be validated against, and
 *  before the turn is enqueued because the Claude driver reads a switch through `setConfig` only. */
async function applyRequestedConfig(runtime: ManagedAgentRuntime, sessionId: string, wanted: Record<string, string> | undefined): Promise<void> {
  if (!wanted || !Object.keys(wanted).length) return
  await runtime.wait(sessionId, 0, 'ready', CONFIG_READY_TIMEOUT_MS)
  await runtime.applyRequestedConfig(sessionId, wanted)
}

/**
 * `followUps` is the operation registry, loaded on the first step. A step opens an operation on its
 * first turn: plugin notes about its turns join it, its reviewers get one window once its own turns
 * finish, and it publishes only after every joined turn has settled
 * (docs/managed-agents/unattended-follow-ups.md).
 */
export function createSessionExecute(runtime: ManagedAgentRuntime, followUps?: () => Promise<TurnFollowUps>): AgentSessionExecute {
  return async (request) => {
    const providerId = managedProviderForProfile(request.profileId)
    if (!providerId) return null
    const session = await sessionFor(runtime, request, providerId)
    await applyRequestedConfig(runtime, session.id, request.configOptions)
    const registry = await followUps?.()
    const beforeSeq = (await runtime.store.requireSession(session.id)).lastEventSeq
    const forwarding = new ExecutionEvents(session.id, beforeSeq, request.onEvent)
    const unsubscribe = runtime.subscribe((frame) => forwarding.receive(frame))
    try {
      const first = await runtime.enqueueTurn(session.id, {
        input: stepInput(request),
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
      })
      // Every turn the step owns, in the order they were queued. Notes join through the operation.
      const turnIds = [first.id]
      forwarding.acceptTurn(first.id)
      const operation = registry?.open(first, 'workflow', (turnId) => {
        turnIds.push(turnId)
        forwarding.acceptTurn(turnId)
      })
      // The events the loop below waits past. It moves on whenever the step is still waiting on a turn,
      // because a wait for `turn_completed` after `beforeSeq` is already met by the first turn.
      let waitSeq = beforeSeq
      let continuations = 0
      let reviewed = false
      // Set when the operation changed without a turn completing, so the loop looks again at once.
      let recheck = false
      const startedAt = Date.now()
      const timeoutMs = request.timeoutMs ?? HEADLESS_TIMEOUT_MS
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
        result: assistantResult(snapshot.events.filter((record) => record.turnId === turnIds.at(-1)), Infinity),
        structuredOutput: null,
        sessionId: snapshot.session.providerSessionRef,
        costUsd: null,
        usage: undefined,
        events: turnEvents(snapshot, turnIds),
      })
      request.signal?.addEventListener('abort', abort, { once: true })
      try {
        for (;;) {
          if (cancelled) {
            await cancellation
            // Again, for a continuation enqueued while the first sweep ran.
            await cancelAll()
            const snapshot = await runtime.captureExecution(session.id, turnIds)
            return (
              resultFromSnapshot(snapshot, turnIds, request.schema)
              ?? { status: 'cancelled', exitCode: null, capture: unfinished(snapshot), stderrTail: '', agentSessionId: session.id }
            )
          }
          const elapsed = Date.now() - startedAt
          if (elapsed >= timeoutMs) {
            await cancelAll()
            const snapshot = await runtime.captureExecution(session.id, turnIds)
            return {
              status: 'timeout',
              exitCode: null,
              capture: unfinished(snapshot),
              stderrTail: `Managed workflow turn exceeded ${timeoutMs}ms.`,
              agentSessionId: session.id,
            }
          }
          try {
            if (!recheck) await runtime.wait(session.id, waitSeq, 'turn_completed', Math.min(1_000, timeoutMs - elapsed), request.signal)
          } catch (error) {
            if (!cancelled) throw error
            continue
          }
          recheck = false
          const snapshot = await runtime.captureExecution(session.id, turnIds)
          if (cancelled) continue
          waitSeq = snapshot.session.lastEventSeq
          const result = resultFromSnapshot(snapshot, turnIds, request.schema)
          if (!result) continue
          if (result.status === 'malformed' && continuations < MAX_CONTINUATIONS) {
            continuations += 1
            forwarding.beginEnqueue()
            const next = await runtime.enqueueTurn(session.id, {
              input: [{ type: 'text', text: continuationPrompt(request.schema) }],
              source: 'workflow',
              effectivePolicy: { ...first.effectivePolicy, continuationOf: first.id },
              idempotencyKey: `workflow-continue:${first.id}:${continuations}`,
            })
            turnIds.push(next.id)
            forwarding.acceptTurn(next.id)
            continue
          }
          // One review window, once the step has a finished answer. A note it sends queues another turn,
          // which the loop waits for before it publishes anything.
          if (operation && !reviewed && (result.status === 'ok' || result.status === 'malformed')) {
            reviewed = true
            await registry!.review(operation, snapshot.turns.at(-1)!.id, timeoutMs - (Date.now() - startedAt))
            recheck = true
            continue
          }
          // Nothing joins after this. Go round once more for a note that was being admitted as it closed.
          if (operation?.open) {
            await registry!.close(operation)
            recheck = true
            continue
          }
          return result
        }
      } finally {
        request.signal?.removeEventListener('abort', abort)
        if (operation) registry!.release(operation)
      }
    } finally { unsubscribe() }
  }
}
