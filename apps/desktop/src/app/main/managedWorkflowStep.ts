import { randomUUID } from 'node:crypto'
import { HEADLESS_TIMEOUT_MS, type HeadlessResult, type StreamEvent } from '../../core/main/headless'
import type { ManagedAgentRuntime } from '../../plugins/agents/main/runtime'
import type { AgentEventRecord, AgentSessionSnapshot } from '@acorn/protocol/managedAgents.ts'
import type { RunStepOptions } from '../../plugins/workflows/main/workflowRunner'
import type { WorkflowStepDef } from '../../plugins/workflows/main/workflowContracts'

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

function workflowEvents(snapshot: AgentSessionSnapshot, turnId: string): StreamEvent[] {
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
  const events = workflowEvents(snapshot, turnId)
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

async function sessionForStep(
  runtime: ManagedAgentRuntime,
  taskId: string,
  def: WorkflowStepDef,
  opts: RunStepOptions,
  providerId: string,
) {
  if (opts.managedSessionId) {
    const session = await runtime.store.requireSession(opts.managedSessionId)
    if (session.taskId !== taskId || session.providerId !== providerId || session.kind !== 'workflow') {
      throw new Error('The persisted managed workflow session does not match this step.')
    }
    return session
  }
  return runtime.createSession({
    taskId,
    providerId,
    profileId: def.profileId ?? providerId,
    kind: 'workflow',
    title: `Workflow: ${def.name}`,
    config: {
      workflowRunId: opts.workflowRunId,
      workflowStepId: opts.workflowStepId,
      toolCeiling: opts.tools ?? {},
    },
  }, `workflow-session:${opts.workflowStepId ?? randomUUID()}`)
}

export function createManagedWorkflowStepRunner(runtime: ManagedAgentRuntime) {
  return async (
    taskId: string,
    def: WorkflowStepDef,
    opts: RunStepOptions,
  ): Promise<HeadlessResult | null> => {
    const providerId = managedProviderForProfile(def.profileId)
    if (!providerId) return null
    const session = await sessionForStep(runtime, taskId, def, opts, providerId)
    const beforeSeq = session.lastEventSeq
    const turn = await runtime.enqueueTurn(session.id, {
      input: [{ type: 'text', text: promptWithResultContract(opts.prompt, opts.schema) }],
      source: 'workflow',
      effectivePolicy: {
        model: opts.model,
        workflowRunId: opts.workflowRunId,
        workflowStepId: opts.workflowStepId,
        schema: opts.schema,
        toolCeiling: opts.tools ?? {},
      },
      idempotencyKey: `workflow-turn:${opts.workflowStepId ?? randomUUID()}:${beforeSeq}`,
    })
    let lastForwardedSeq = beforeSeq
    const unsubscribe = runtime.subscribe((frame) => {
      if (frame.channel !== 'agent:event' || frame.event.sessionId !== session.id || frame.event.turnId !== turn.id) return
      if (frame.event.seq <= lastForwardedSeq) return
      lastForwardedSeq = frame.event.seq
      opts.onEvent?.({ type: 'managed-agent', sequence: frame.event.seq, event: frame.event.event })
    })
    const startedAt = Date.now()
    const timeoutMs = opts.timeoutMs ?? HEADLESS_TIMEOUT_MS
    let cancelled = opts.signal?.aborted ?? false
    const abort = () => {
      cancelled = true
      void runtime.cancelTurn(session.id, turn.id)
    }
    opts.signal?.addEventListener('abort', abort, { once: true })
    try {
      for (;;) {
        if (cancelled) {
          const snapshot = await runtime.store.snapshot(session.id, beforeSeq)
          return resultFromSnapshot(snapshot, turn.id, opts.schema) ?? {
            status: 'cancelled',
            exitCode: null,
            capture: {
              result: null,
              structuredOutput: null,
              sessionId: snapshot.session.providerSessionRef,
              costUsd: null,
              usage: undefined,
              events: workflowEvents(snapshot, turn.id),
            },
            stderrTail: '',
            agentSessionId: session.id,
          }
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
              events: workflowEvents(snapshot, turn.id),
            },
            stderrTail: `Managed workflow turn exceeded ${timeoutMs}ms.`,
            agentSessionId: session.id,
          }
        }
        const snapshot = await runtime.wait(
          session.id,
          beforeSeq,
          'turn_completed',
          Math.min(1_000, timeoutMs - elapsed),
        )
        const result = resultFromSnapshot(snapshot, turn.id, opts.schema)
        if (result) return result
      }
    } finally {
      unsubscribe()
      opts.signal?.removeEventListener('abort', abort)
    }
  }
}
