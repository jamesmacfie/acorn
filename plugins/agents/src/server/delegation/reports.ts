import { randomUUID } from 'node:crypto'
import { createLogger, describeError } from '@acorn/plugin-api/node'
import type { AgentInputPart, AgentTurn } from '../../contract/wire.ts'
import type { ManagedAgentRuntime } from '../sessions/runtime'
import { assistantResult, parseStructuredResult, promptWithResultContract } from '../sessions/resultContract'

const log = createLogger('agents:delegation', 'agents')

const SETTLED: ReadonlySet<AgentTurn['status']> = new Set(['completed', 'failed', 'cancelled', 'interrupted'])
const MAX_REPORT_TEXT = 8 * 1024
// A parent and child that keep answering each other are an agent loop with a provider bill. Past this
// many reports on one owner, the child's results stay readable through agent_read and stop waking it.
const MAX_REPORTS_PER_OWNER = 100

export const reportKey = (childTurnId: string): string => `delegation-report:${childTurnId}`

export const turnResultSchema = (turn: AgentTurn): object | undefined => {
  const value = turn.effectivePolicy.resultSchema ?? turn.effectivePolicy.schema
  return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined
}

type Owner = { sessionId: string; title: string } | { sessionId: null; title: string }

const context = (
  source: 'delegation' | 'delegation_report',
  label: string,
  content: string,
  resourceId: string | null,
  provenance: string,
): Extract<AgentInputPart, { type: 'context' }> => ({
  type: 'context',
  contextId: randomUUID(),
  label,
  content,
  source,
  ...(resourceId ? { resourceId, deepLink: { pane: 'agents', intent: { sessionId: resourceId } } } : {}),
  provenance,
  byteSize: Buffer.byteLength(content, 'utf8'),
  estimatedTokens: Math.ceil(Buffer.byteLength(content, 'utf8') / 4),
  freshness: 'live',
  sensitivity: 'workspace',
  capturedAt: Date.now(),
})

const roleText = (owner: Owner): string => owner.sessionId
  ? [
      `You are a delegated agent. ${owner.title} gave you this turn.`,
      'When the turn ends, your final message goes back to that agent as your report. Put the result, what you changed, and anything still open in that final message, not in a separate file.',
      'If you need a decision, end the turn with the question. The agent answers with a new turn.',
      'Do not ask the user directly. Nobody may be watching this session.',
    ].join('\n')
  : [
      'You are a delegated agent. A terminal agent gave you this turn and reads your final message with agent_read.',
      'Put the result, what you changed, and anything still open in that final message, not in a separate file.',
      'If you need a decision, end the turn with the question. Do not ask the user directly.',
    ].join('\n')

/**
 * The input and policy of a turn an owner queues on its child. A managed owner is recorded as
 * `reportTo`, which is what makes the settled turn report back; a terminal owner has no session to
 * wake and keeps reading with agent_read.
 */
export function delegatedTurn(
  owner: Owner,
  prompt: string,
  resultSchema: object | undefined,
  effectivePolicy: Record<string, unknown>,
): { input: AgentInputPart[]; effectivePolicy: Record<string, unknown> } {
  return {
    input: [
      { type: 'text', text: promptWithResultContract(prompt, resultSchema) },
      context('delegation', owner.title, roleText(owner), owner.sessionId, 'Acorn delegation'),
    ],
    effectivePolicy: { ...effectivePolicy, ...(owner.sessionId ? { reportTo: owner.sessionId } : {}) },
  }
}

/** Queues one turn on the owner when a turn it gave a child settles (docs/managed-agents.md § Managed delegation). */
export class DelegationReports {
  constructor(private readonly runtime: ManagedAgentRuntime) {}

  async deliver(childTurnId: string): Promise<void> {
    const store = this.runtime.store
    const turn = await store.turn(childTurnId)
    const ownerId = turn?.effectivePolicy.reportTo
    if (!turn || typeof ownerId !== 'string' || !SETTLED.has(turn.status)) return
    // The idempotency key is the exactly-once rule, so an existing report ends this before the hooks
    // and file checks enqueueTurn runs, which matters for the startup pass over every settled turn.
    if (await store.turnForIdempotency(ownerId, reportKey(turn.id))) return
    if (turn.status === 'cancelled' && await store.hasOperationFor('delegation.cancel', turn.id)) return
    const [owner, child] = await Promise.all([store.getSession(ownerId), store.getSession(turn.sessionId)])
    if (!owner || !child || owner.archivedAt || owner.runtimeState === 'failed') return
    if (await store.countTurns(ownerId, 'delegation_report') >= MAX_REPORTS_PER_OWNER) {
      log.warn(`not reporting turn ${turn.id}: session ${ownerId} already holds ${MAX_REPORTS_PER_OWNER} reports`)
      return
    }
    const text = assistantResult(await store.eventsForTurn(turn.id))
    const schema = turnResultSchema(turn)
    const structured = schema && text ? parseStructuredResult(text, schema) : null
    const body = [
      `${child.title} finished the turn you gave it. Answer it with agent_prompt on session ${child.id}, or read its full output with agent_read.`,
      `Outcome: ${turn.status}`,
      ...(turn.error ? [`Error: ${turn.error.message}`] : []),
      ...(text ? ['Final message:', text.length > MAX_REPORT_TEXT ? `…${text.slice(-MAX_REPORT_TEXT)}` : text] : ['The turn ended with no message.']),
      ...(structured != null ? ['Structured result:', '```json', JSON.stringify(structured, null, 2), '```'] : []),
    ].join('\n\n')
    await this.runtime.enqueueTurn(ownerId, {
      // The report is the text, so the reader sees it in the transcript. The context part names the
      // sender for the label and links to the child.
      input: [
        { type: 'text', text: body },
        context(
          'delegation_report',
          child.title,
          `Report from delegated session ${child.id}, turn ${turn.id}.`,
          child.id,
          `Delegated session ${child.id}, turn ${turn.id}`,
        ),
      ],
      source: 'delegation_report',
      effectivePolicy: { reportFrom: { sessionId: child.id, turnId: turn.id } },
      idempotencyKey: reportKey(turn.id),
    })
  }

  /** Delivers from the lifecycle broadcast, which is not durable; `reconcile` covers a lost one. */
  deliverSafely(childTurnId: string): void {
    void this.deliver(childTurnId).catch((error: unknown) =>
      log.warn(`report for turn ${childTurnId} failed: ${describeError(error).message}`))
  }

  /**
   * Drops a report the owner no longer needs because it read the result or cancelled the turn itself.
   * A read that lands in the moment between the child settling and its report being queued
   * leaves one redundant report; closing that needs the read recorded, which nothing else wants.
   */
  async withdraw(ownerSessionId: string, childTurnId: string): Promise<void> {
    const report = await this.runtime.store.turnForIdempotency(ownerSessionId, reportKey(childTurnId))
    if (report?.status === 'queued') await this.runtime.cancelTurn(ownerSessionId, report.id)
  }

  async reconcile(): Promise<void> {
    for (const turn of await this.runtime.store.settledReportingTurns()) {
      await this.deliver(turn.id).catch((error: unknown) =>
        log.warn(`report for turn ${turn.id} failed at startup: ${describeError(error).message}`))
    }
  }
}
