import { randomUUID } from 'node:crypto'
import { createLogger, describeError, pastedContent } from '@acorn/plugin-api/node'
import type { AgentInputPart, AgentTurn } from '../../contract/wire.ts'
import type { ManagedAgentRuntime } from '../sessions/runtime'
import type { TurnFollowUps } from '../sessions/turnFollowUps'
import { TURN_FOLLOW_UP_DEADLINE_MS } from '../../contract/turnFollowUp.ts'
import type { AgentDelegationStore } from './store'
import { assistantResult, parseStructuredResult, promptWithResultContract } from '../sessions/resultContract'
import type { CoreServices } from '@acorn/plugin-api/node'
import type { CheckResults } from '../../shared/delegationSchemas'

const log = createLogger('agents:delegation', 'agents')

const SETTLED: ReadonlySet<AgentTurn['status']> = new Set(['completed', 'failed', 'cancelled', 'interrupted'])
const MAX_REPORT_TEXT = 8 * 1024
// A parent and child that keep answering each other are an agent loop with a provider bill. Past this
// many reports on one owner, the child's results stay readable through agent_read and stop waking it.
const MAX_REPORTS_PER_OWNER = 100

export const reportKey = (childTurnId: string): string => `delegation-report:${childTurnId}`
export const requestReportKey = (requestId: string): string => `delegation-request:${requestId}`

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

/** Queues one turn on the owner when a turn it gave a child settles (docs/managed-agents/delegation.md § Managed delegation). */
export class DelegationReports {
  // One delivery per child turn at a time: the broadcast and the startup pass can both ask for it.
  private readonly delivering = new Map<string, Promise<void>>()

  constructor(
    private readonly runtime: ManagedAgentRuntime,
    private readonly delegations: AgentDelegationStore,
    // The unattended operations a plugin's note joins (../sessions/turnFollowUps.ts). Absent, a turn
    // reports as soon as it settles.
    private readonly followUps?: () => Promise<TurnFollowUps>,
    private readonly core?: Pick<CoreServices, 'tasks' | 'fs' | 'git'>,
  ) {}

  async checkResults(turn: AgentTurn): Promise<CheckResults | null> {
    const { DelegationChecks, savedCheckResults, turnChecks } = await import('./checks')
    if (!turnChecks(turn).length) return null
    const saved = savedCheckResults(turn)
    if (saved) return saved
    if (!this.core) return null
    const child = await this.runtime.store.getSession(turn.sessionId)
    const root = child ? await this.core.tasks.root(child.taskId) : null
    const baseCommit = typeof turn.effectivePolicy.baseCommit === 'string' ? turn.effectivePolicy.baseCommit : undefined
    const result = await new DelegationChecks(this.core).runInRoot(turn, root, baseCommit)
    const persisted = await this.runtime.store.saveCheckResultsOnce(turn.id, result)
    return persisted ? savedCheckResults(persisted) : result
  }

  /** A pending request is a pause, not a settled turn. The request row is read after commit. */
  async deliverRequest(sessionId: string, providerRequestId: string): Promise<void> {
    const store = this.runtime.store
    const request = await store.request(sessionId, providerRequestId)
    if (!request || request.status !== 'pending' || !request.turnId
      || !['permission', 'question', 'elicitation'].includes(request.kind)) return
    const asked = await store.turn(request.turnId)
    // A plugin's note reports through the delegated turn it follows.
    const followUpOf = asked?.effectivePolicy.followUpOf
    const turn = typeof followUpOf === 'string' ? await store.turn(followUpOf) : asked
    const ownerId = turn?.effectivePolicy.reportTo
    if (!turn || turn.sessionId !== sessionId || turn.source !== 'delegation' || typeof ownerId !== 'string') return
    const [owner, child] = await Promise.all([store.getSession(ownerId), store.getSession(sessionId)])
    if (!owner || !child || owner.archivedAt || owner.runtimeState === 'failed'
      || !await this.delegations.ownedChild(owner.taskId, ownerId, sessionId)) return
    const key = requestReportKey(request.id)
    if (await store.turnForIdempotency(ownerId, key)) return
    if (await store.countTurns(ownerId, 'delegation_report') >= MAX_REPORTS_PER_OWNER) {
      log.warn(`not reporting request ${request.id}: session ${ownerId} already holds ${MAX_REPORTS_PER_OWNER} reports`)
      return
    }
    const need = request.kind === 'permission' ? 'permission' : request.kind === 'question' ? 'an answer' : 'elicitation input'
    const detail = [request.title, request.detail].filter(Boolean).join(' — ').slice(0, 500)
    await this.runtime.enqueueTurn(ownerId, {
      input: [
        { type: 'text', text: `${child.title} is blocked and needs ${need}.\n\nRequest:\n${pastedContent(detail)}\n\nOpen or inspect child session ${child.id} to see the request. A human must resolve it in the child session; you cannot approve or answer it from this report.` },
        context('delegation_report', child.title,
          `Blocked request from delegated session ${child.id}, turn ${turn.id}, request ${request.id}.`,
          child.id, `Delegated session ${child.id}, request ${request.id}`),
      ],
      source: 'delegation_report',
      effectivePolicy: { reportFrom: { sessionId: child.id, turnId: turn.id } },
      idempotencyKey: key,
    })
  }

  deliverRequestSafely(sessionId: string, providerRequestId: string): void {
    void this.deliverRequest(sessionId, providerRequestId).catch((error: unknown) =>
      log.warn(`report for request ${providerRequestId} failed: ${describeError(error).message}`))
  }

  /**
   * Whether the owner of a delegated turn still waits for its report. That is the operation a plugin's
   * note about the turn joins: once the report is queued, the owner cancelled the turn, or the owner
   * is gone, notes are refused.
   */
  async operationLive(turn: AgentTurn): Promise<boolean> {
    const store = this.runtime.store
    const ownerId = turn.effectivePolicy.reportTo
    if (turn.source !== 'delegation' || typeof ownerId !== 'string') return false
    // The idempotency key is the exactly-once rule, so an existing report ends this before the hooks
    // and file checks enqueueTurn runs, which matters for the startup pass over every settled turn.
    if (await store.turnForIdempotency(ownerId, reportKey(turn.id))) return false
    if (await store.hasOperationFor('delegation.cancel', turn.id)) return false
    const owner = await store.getSession(ownerId)
    return !!owner && !owner.archivedAt && owner.runtimeState !== 'failed'
  }

  /** The owner stopped the turn: its notes stop too. */
  async cancelFollowUps(turn: AgentTurn): Promise<void> {
    await (await this.followUps?.())?.cancel(turn)
  }

  deliver(childTurnId: string): Promise<void> {
    let running = this.delivering.get(childTurnId)
    if (!running) {
      running = this.deliverOnce(childTurnId).finally(() => this.delivering.delete(childTurnId))
      this.delivering.set(childTurnId, running)
    }
    return running
  }

  private async deliverOnce(childTurnId: string): Promise<void> {
    const store = this.runtime.store
    const turn = await store.turn(childTurnId)
    const ownerId = turn?.effectivePolicy.reportTo
    if (!turn || typeof ownerId !== 'string' || !SETTLED.has(turn.status)) return
    if (!await this.operationLive(turn)) return this.cancelFollowUps(turn)
    // The report waits for the plugin notes that joined this turn, and says what the last one ended on.
    const last = await this.settleFollowUps(turn)
    if (!await this.operationLive(turn)) return
    const child = await store.getSession(turn.sessionId)
    if (!child) return
    if (await store.countTurns(ownerId, 'delegation_report') >= MAX_REPORTS_PER_OWNER) {
      log.warn(`not reporting turn ${turn.id}: session ${ownerId} already holds ${MAX_REPORTS_PER_OWNER} reports`)
      return
    }
    const text = assistantResult(await store.eventsForTurn(last.id))
    const checks = await this.checkResults(turn)
    const schema = turnResultSchema(turn)
    const structured = schema && text ? parseStructuredResult(text, schema) : null
    const notes = last.id === turn.id ? [] : [`A plugin sent it notes about that turn. The outcome and message below are from its reply to the last one, turn ${last.id}.`]
    // The child's message is marked as text the owner did not write. A child that read a hostile page
    // can repeat what it read, and unmarked, that would reach the owner as its own user's request.
    const body = [
      `${child.title} finished the turn you gave it. Answer it with agent_prompt on session ${child.id}, or read its full output with agent_read.`,
      ...notes,
      `Outcome: ${last.stopReason === 'refusal' ? 'refused. The model declined the request, so asking again in the same words will not help.' : last.status}`,
      ...(last.error ? [`Error: ${last.error.message}`] : []),
      ...(text ? ['Final message:', pastedContent(text.length > MAX_REPORT_TEXT ? `…${text.slice(-MAX_REPORT_TEXT)}` : text)] : ['The turn ended with no message.']),
      ...(checks ? ['Host checks:', `Checked at: ${new Date(checks.checkedAt).toISOString()}`, ...checks.verdicts.map(({ check, status, reason }) =>
        `- ${check.kind}${'path' in check ? ` ${check.path}` : ''}: ${status} (${reason})`)] : []),
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
      effectivePolicy: { reportFrom: { sessionId: child.id, turnId: turn.id }, ...(checks ? { checkResults: checks } : {}) },
      idempotencyKey: reportKey(turn.id),
    })
  }

  /**
   * Offers a finished turn to its reviewers, then waits for every note that joined the operation, and
   * closes it. Returns the operation's last turn. Waiting on turns never holds the provider queue: this
   * runs from a broadcast, after the write that settled the turn.
   */
  private async settleFollowUps(turn: AgentTurn): Promise<AgentTurn> {
    const registry = await this.followUps?.()
    if (!registry) return turn
    const store = this.runtime.store
    const operation = registry.open(turn, 'delegation')
    try {
      if (turn.status === 'completed') await registry.review(operation, turn.id, TURN_FOLLOW_UP_DEADLINE_MS)
      for (;;) {
        const seq = (await store.requireSession(turn.sessionId)).lastEventSeq
        const notes = await store.followUpTurns(turn.sessionId, turn.id)
        if (notes.some((note) => !SETTLED.has(note.status))) {
          await this.runtime.wait(turn.sessionId, seq, 'turn_completed', 1_000)
          continue
        }
        // Closed only once its notes have settled, so a note can still join while one runs. Then once
        // more round, for a note that was being admitted as it closed.
        if (!operation.open) return notes.at(-1) ?? turn
        await registry.close(operation)
      }
    } finally {
      registry.release(operation)
    }
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

  /** Boot waits for this, so a report that waits on a plugin's note carries on after it returns. */
  async reconcile(): Promise<void> {
    for (const turn of await this.runtime.store.settledReportingTurns()) {
      if (!await this.operationLive(turn)) continue
      void this.deliver(turn.id).catch((error: unknown) =>
        log.warn(`report for turn ${turn.id} failed at startup: ${describeError(error).message}`))
    }
  }
}
