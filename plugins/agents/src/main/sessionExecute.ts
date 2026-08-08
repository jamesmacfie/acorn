// The agents.sessionExecute implementation (contract/sessionExecute.ts).
//
// Moved verbatim-in-behaviour from apps/node/src/wiring/managedWorkflowStep.ts, which existed in the
// app only because workflows could not import agents. It is agents' code: every line touches
// ManagedAgentRuntime, its session store, and its turn lifecycle.
import { randomUUID } from 'node:crypto'
import { HEADLESS_TIMEOUT_MS, type HeadlessResult, type StreamEvent } from '@acorn/plugin-api/node'
import type { AgentEventRecord, AgentSessionSnapshot } from '@acorn/protocol/managedAgents.ts'
import type { AgentSessionExecute, AgentSessionExecuteRequest } from '../contract/sessionExecute'
import type { ManagedAgentRuntime } from './runtime'

// Which agent profiles have a durable managed driver. A profile absent here has no managed path, and
// sessionExecute returns null so the caller falls back to its own one-shot runner.
const MANAGED_PROVIDERS: Readonly<Record<string, string>> = {
  'claude-code': 'claude',
  codex: 'codex',
}

export const managedProviderForProfile = (profileId: string | undefined): string | null =>
  MANAGED_PROVIDERS[profileId ?? ''] ?? null

function promptWithResultContract(prompt: string, schema: object | undefined): string {
  if (!schema) return prompt
  return [
    prompt,
    'Complete the task, then end your final response with exactly one fenced `json` block matching this result schema.',
    'Do not put commentary inside that JSON block.',
    JSON.stringify(schema),
  ].join('\n\n')
}

function assistantResult(events: AgentEventRecord[]): string | null {
  let text = ''
  for (const record of events) {
    if (record.event.type !== 'assistant_message') continue
    text = record.event.append ? text + record.event.text : record.event.text
  }
  return text.trim() || null
}

function parseStructuredResult(text: string, schema: object | undefined): unknown | null {
  if (!schema) return null
  const candidates = [
    ...[...text.matchAll(/```json\s*([\s\S]*?)```/gi)].map((match) => match[1]?.trim() ?? ''),
    text.trim(),
  ]
  const firstBrace = text.indexOf('{')
  const lastBrace = text.lastIndexOf('}')
  if (firstBrace >= 0 && lastBrace > firstBrace) candidates.push(text.slice(firstBrace, lastBrace + 1))
  const firstBracket = text.indexOf('[')
  const lastBracket = text.lastIndexOf(']')
  if (firstBracket >= 0 && lastBracket > firstBracket) candidates.push(text.slice(firstBracket, lastBracket + 1))
  for (const candidate of candidates) {
    if (!candidate) continue
    try {
      return JSON.parse(candidate) as unknown
    } catch {
      // Try the next bounded representation. The provider remains responsible for satisfying the
      // advertised schema; Acorn rejects output that is not JSON instead of guessing.
    }
  }
  return null
}

function turnEvents(snapshot: AgentSessionSnapshot, turnId: string): StreamEvent[] {
  return snapshot.events
    .filter((record) => record.turnId === turnId)
    .map((record) => ({
      type: 'managed-agent',
      sequence: record.seq,
      event: record.event,
    }))
}

function resultFromSnapshot(
  snapshot: AgentSessionSnapshot,
  turnId: string,
  schema: object | undefined,
): HeadlessResult | null {
  const turn = snapshot.turns.find((candidate) => candidate.id === turnId)
  if (!turn || !['completed', 'failed', 'cancelled', 'interrupted'].includes(turn.status)) return null
  const events = turnEvents(snapshot, turnId)
  const result = assistantResult(snapshot.events.filter((record) => record.turnId === turnId))
  const structuredOutput = result ? parseStructuredResult(result, schema) : null
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

export function createSessionExecute(runtime: ManagedAgentRuntime): AgentSessionExecute {
  return async (request) => {
    const providerId = managedProviderForProfile(request.profileId)
    if (!providerId) return null
    const session = await sessionFor(runtime, request, providerId)
    const beforeSeq = session.lastEventSeq
    const turn = await runtime.enqueueTurn(session.id, {
      input: [{ type: 'text', text: promptWithResultContract(request.prompt, request.schema) }],
      source: 'workflow',
      effectivePolicy: {
        model: request.model,
        workflowRunId: request.runId,
        workflowStepId: request.stepId,
        schema: request.schema,
        toolCeiling: request.tools ?? {},
      },
      idempotencyKey: `workflow-turn:${request.stepId ?? randomUUID()}:${beforeSeq}`,
    })
    let lastForwardedSeq = beforeSeq
    const unsubscribe = runtime.subscribe((frame) => {
      if (frame.channel !== 'agent:event' || frame.event.sessionId !== session.id || frame.event.turnId !== turn.id) return
      if (frame.event.seq <= lastForwardedSeq) return
      lastForwardedSeq = frame.event.seq
      request.onEvent?.({ type: 'managed-agent', sequence: frame.event.seq, event: frame.event.event })
    })
    const startedAt = Date.now()
    const timeoutMs = request.timeoutMs ?? HEADLESS_TIMEOUT_MS
    let cancelled = request.signal?.aborted ?? false
    const abort = () => {
      cancelled = true
      void runtime.cancelTurn(session.id, turn.id)
    }
    request.signal?.addEventListener('abort', abort, { once: true })
    try {
      for (;;) {
        if (cancelled) {
          const snapshot = await runtime.store.snapshot(session.id, beforeSeq)
          return (
            resultFromSnapshot(snapshot, turn.id, request.schema) ?? {
              status: 'cancelled',
              exitCode: null,
              capture: {
                result: null,
                structuredOutput: null,
                sessionId: snapshot.session.providerSessionRef,
                costUsd: null,
                usage: undefined,
                events: turnEvents(snapshot, turn.id),
              },
              stderrTail: '',
              agentSessionId: session.id,
            }
          )
        }
        const elapsed = Date.now() - startedAt
        if (elapsed >= timeoutMs) {
          await runtime.cancelTurn(session.id, turn.id)
          const snapshot = await runtime.store.snapshot(session.id, beforeSeq)
          return {
            status: 'timeout',
            exitCode: null,
            capture: {
              result: assistantResult(snapshot.events),
              structuredOutput: null,
              sessionId: snapshot.session.providerSessionRef,
              costUsd: null,
              usage: undefined,
              events: turnEvents(snapshot, turn.id),
            },
            stderrTail: `Managed workflow turn exceeded ${timeoutMs}ms.`,
            agentSessionId: session.id,
          }
        }
        const snapshot = await runtime.wait(session.id, beforeSeq, 'turn_completed', Math.min(1_000, timeoutMs - elapsed))
        const result = resultFromSnapshot(snapshot, turn.id, request.schema)
        if (result) return result
      }
    } finally {
      unsubscribe()
      request.signal?.removeEventListener('abort', abort)
    }
  }
}
