// The agents.sessionExecute implementation (contract/sessionExecute.ts).
//
// Moved from apps/node/src/wiring/managedWorkflowStep.ts, which existed in the app only because
// workflows couldn't import agents. It's agents' code: every line touches ManagedAgentRuntime, its
// session store and its turn lifecycle.
import { randomUUID } from 'node:crypto'
import { HEADLESS_TIMEOUT_MS, type HeadlessResult, type StreamEvent } from '@acorn/plugin-api/node'
import { MAX_AGENT_CONTEXT_BYTES } from '@acorn/protocol/agentContext.ts'
import type { AgentInputPart, AgentSessionSnapshot } from '../../contract/wire.ts'
import { managedProviderForProfile, type AgentSessionExecute, type AgentSessionExecuteRequest } from '../../contract/sessionExecute'
import type { ManagedAgentRuntime } from './runtime'
import { assistantResult, parseStructuredResult, promptWithResultContract } from './resultContract'
import { contextBlock } from '../drivers/contextBlock'
import { ExecutionEvents } from './executionEvents'

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

/** The step's outcome once its latest turn has settled. `turnIds` is every turn the step has sent, in
 *  order: the transcript it hands back covers all of them, and the result is the last one's. */
function resultFromSnapshot(
  snapshot: AgentSessionSnapshot,
  turnIds: readonly string[],
  schema: object | undefined,
): HeadlessResult | null {
  const turnId = turnIds[turnIds.length - 1]!
  const turn = snapshot.turns.find((candidate) => candidate.id === turnId)
  if (!turn || !['completed', 'failed', 'cancelled', 'interrupted'].includes(turn.status)) return null
  const events = turnEvents(snapshot, turnIds)
  const result = assistantResult(snapshot.events.filter((record) => record.turnId === turnId), Infinity)
  const structuredOutput = result ? parseStructuredResult(result, schema) : null
  // Usage and cost are the last turn's alone. A step that needed a continuation under-reports by the
  // earlier turn, which is not summed because Codex reports cumulative totals and Claude does not.
  const capture = {
    result,
    structuredOutput,
    sessionId: snapshot.session.providerSessionRef,
    costUsd: turn.usage?.cost?.currency.toUpperCase() === 'USD' ? turn.usage.cost.amount : null,
    usage: turn.usage
      ? {
          inputTokens: turn.usage.inputTokens,
          outputTokens: turn.usage.outputTokens,
          cachedInputTokens: turn.usage.cachedInputTokens,
          cacheWriteInputTokens: turn.usage.cacheWriteInputTokens,
        }
      : undefined,
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

export function createSessionExecute(runtime: ManagedAgentRuntime): AgentSessionExecute {
  return async (request) => {
    const providerId = managedProviderForProfile(request.profileId)
    if (!providerId) return null
    const session = await sessionFor(runtime, request, providerId)
    await applyRequestedConfig(runtime, session.id, request.configOptions)
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
      const turnIds = [first.id]
      forwarding.acceptTurn(first.id)
      const currentTurnId = () => turnIds[turnIds.length - 1]!
      // The events the loop below waits past. It moves on with each continuation, because a wait for
      // `turn_completed` after `beforeSeq` is already met by the turn that needed continuing.
      let waitSeq = beforeSeq
      const startedAt = Date.now()
      const timeoutMs = request.timeoutMs ?? HEADLESS_TIMEOUT_MS
      let cancelled = request.signal?.aborted ?? false
      let cancellation: Promise<void> | undefined
      let cancellingTurnId: string | undefined
      const abort = () => {
        cancelled = true
        cancellingTurnId = currentTurnId()
        cancellation = runtime.cancelTurn(session.id, cancellingTurnId)
        // The loop joins the cancellation before capturing. Suppress an unhandled rejection meanwhile.
        void cancellation.catch(() => {})
      }
      request.signal?.addEventListener('abort', abort, { once: true })
      try {
        for (;;) {
          if (cancelled) {
            await cancellation
            if (cancellingTurnId !== currentTurnId()) await runtime.cancelTurn(session.id, currentTurnId())
            const snapshot = await runtime.captureExecution(session.id, turnIds)
            return (
              resultFromSnapshot(snapshot, turnIds, request.schema) ?? {
                status: 'cancelled',
                exitCode: null,
                capture: {
                  result: assistantResult(snapshot.events.filter((record) => record.turnId === currentTurnId()), Infinity),
                  structuredOutput: null,
                  sessionId: snapshot.session.providerSessionRef,
                  costUsd: null,
                  usage: undefined,
                  events: turnEvents(snapshot, turnIds),
                },
                stderrTail: '',
                agentSessionId: session.id,
              }
            )
          }
          const elapsed = Date.now() - startedAt
          if (elapsed >= timeoutMs) {
            await runtime.cancelTurn(session.id, currentTurnId())
            const snapshot = await runtime.captureExecution(session.id, turnIds)
            return {
              status: 'timeout',
              exitCode: null,
              capture: {
                result: assistantResult(snapshot.events.filter((record) => record.turnId === currentTurnId()), Infinity),
                structuredOutput: null,
                sessionId: snapshot.session.providerSessionRef,
                costUsd: null,
                usage: undefined,
                events: turnEvents(snapshot, turnIds),
              },
              stderrTail: `Managed workflow turn exceeded ${timeoutMs}ms.`,
              agentSessionId: session.id,
            }
          }
          try {
            await runtime.wait(session.id, waitSeq, 'turn_completed', Math.min(1_000, timeoutMs - elapsed), request.signal)
          } catch (error) {
            if (!cancelled) throw error
            continue
          }
          const snapshot = await runtime.captureExecution(session.id, turnIds)
          if (cancelled) continue
          const result = resultFromSnapshot(snapshot, turnIds, request.schema)
          if (!result) continue
          if (result.status !== 'malformed' || turnIds.length > MAX_CONTINUATIONS || cancelled) return result
          waitSeq = snapshot.session.lastEventSeq
          forwarding.beginEnqueue()
          const next = await runtime.enqueueTurn(session.id, {
            input: [{ type: 'text', text: continuationPrompt(request.schema) }],
            source: 'workflow',
            effectivePolicy: { ...first.effectivePolicy, continuationOf: first.id },
            idempotencyKey: `workflow-continue:${first.id}:${turnIds.length}`,
          })
          turnIds.push(next.id)
          forwarding.acceptTurn(next.id)
        }
      } finally {
        request.signal?.removeEventListener('abort', abort)
      }
    } finally { unsubscribe() }
  }
}
