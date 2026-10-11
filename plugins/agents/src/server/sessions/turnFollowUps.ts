// Unattended operations and the plugin notes that join them
// (docs/managed-agents/unattended-follow-ups.md).
//
// An operation is an owner waiting on one turn: a running workflow step, or a managed agent waiting for
// its delegated child's report. While it's open, a plugin's note about that turn queues behind it and
// the owner waits for the note's turn before it publishes. Once the owner closes it, notes are refused.
// It lives in memory and is keyed by the owner's turn id, so a cancelled or restarted owner starts a new
// one under a new turn. What recovery needs is durable: each note's turn records `followUpOf`, and each
// review window's outcome is an `agent_operations` row.
import { createLogger, describeError } from '@acorn/plugin-api/node'
import {
  TURN_FOLLOW_UP_DEADLINE_MS,
  type TurnFollowUpContribution,
  type TurnFollowUpWindow,
} from '../../contract/turnFollowUp.ts'
import type { AgentTurn } from '../../contract/wire.ts'
import type { ManagedAgentRuntime } from './runtime'

const log = createLogger('agents:turn-follow-up', 'agents')

const REVIEW_OPERATION = 'turn-follow-up.review'
const SETTLED: ReadonlySet<AgentTurn['status']> = new Set(['completed', 'failed', 'cancelled', 'interrupted'])

type Entry = { id: string; pluginId: string; value: TurnFollowUpContribution }

export type FollowUpOperation = {
  readonly origin: AgentTurn
  readonly owner: TurnFollowUpWindow['owner']
  open: boolean
  /** Plugins whose review window has closed. Their notes after it are late. */
  readonly lateReviewers: Set<string>
  /** Admissions under way, which closing waits for so none lands after the owner finished. */
  readonly admitting: Set<Promise<unknown>>
  /** Aborted when the owner closes, which stops a review still running. */
  readonly controller: AbortController
  onAccepted?: (turnId: string) => void
}

export type ReviewOutcome = {
  turnId: string
  outcome: 'reviewed' | 'timed-out' | 'cancelled' | 'skipped'
  reviewers: { pluginId: string; outcome: 'done' | 'failed' | 'timed-out' | 'cancelled' }[]
}

export type TurnFollowUpPorts = {
  runtime: Pick<ManagedAgentRuntime, 'store' | 'cancelTurn'>
  /** The point's live entries, snapshotted when a window opens. */
  entries(): readonly Entry[]
  /** Whether a delegated turn's owner still waits for its report (DelegationReports). */
  delegationLive(turn: AgentTurn): Promise<boolean>
  /** The shared review deadline. Tests shorten it. */
  deadlineMs?: number
}

export class TurnFollowUps {
  readonly #operations = new Map<string, FollowUpOperation>()

  constructor(private readonly ports: TurnFollowUpPorts) {}

  /** The operation for an owner's turn. Opening one that is already open returns it. */
  open(origin: AgentTurn, owner: FollowUpOperation['owner'], onAccepted?: (turnId: string) => void): FollowUpOperation {
    let operation = this.#operations.get(origin.id)
    if (!operation) {
      operation = {
        origin,
        owner,
        open: true,
        lateReviewers: new Set(),
        admitting: new Set(),
        controller: new AbortController(),
      }
      this.#operations.set(origin.id, operation)
    }
    if (onAccepted) operation.onAccepted = onAccepted
    return operation
  }

  /**
   * Runs `enqueue` only while the operation owning `originTurnId` is open, and returns the note's turn.
   * Null is `operation-closed`. A note about a note or a continuation joins the operation that turn
   * belongs to, never another task's or session's.
   */
  async admit(
    sessionId: string,
    pluginId: string,
    originTurnId: string | undefined,
    enqueue: (origin: AgentTurn) => Promise<AgentTurn>,
  ): Promise<AgentTurn | null> {
    const operation = await this.#operationFor(sessionId, originTurnId)
    // Checked after the reads above and in the same tick as the admission is recorded, so closing
    // either refuses this note or waits for it.
    if (!operation?.open || operation.lateReviewers.has(pluginId)) return null
    const admitted = enqueue(operation.origin)
    operation.admitting.add(admitted)
    try {
      const turn = await admitted
      operation.onAccepted?.(turn.id)
      return turn
    } finally {
      operation.admitting.delete(admitted)
    }
  }

  /**
   * The review window, once per operation: every reviewer filed now gets the turn, and the owner waits
   * until they all settle or the deadline passes. The outcome is saved, so a recovered owner doesn't
   * review the same turn again.
   */
  async review(operation: FollowUpOperation, turnId: string, remainingMs: number): Promise<ReviewOutcome | null> {
    const reviewers = this.ports.entries()
    if (!operation.open || !reviewers.length) return null
    const store = this.ports.runtime.store
    const key = `turn-follow-up:${operation.origin.id}`
    if (await store.operationResult(key, REVIEW_OPERATION)) return null
    const session = await store.getSession(operation.origin.sessionId)
    if (!session) return null
    const windowMs = Math.min(this.ports.deadlineMs ?? TURN_FOLLOW_UP_DEADLINE_MS, remainingMs)
    const outcome: ReviewOutcome =
      windowMs > 0
        ? await this.#window(operation, reviewers, { taskId: session.taskId, sessionId: session.id, turnId }, windowMs)
        : { turnId, outcome: 'skipped', reviewers: [] }
    await store.saveOperation(key, REVIEW_OPERATION, outcome, operation.origin.sessionId)
    return outcome
  }

  /** No note joins after this. A note being admitted when it's called is waited for. */
  async close(operation: FollowUpOperation): Promise<void> {
    operation.open = false
    operation.controller.abort()
    await Promise.allSettled(operation.admitting)
  }

  /** Forget a finished operation. */
  release(operation: FollowUpOperation): void {
    operation.open = false
    operation.controller.abort()
    if (this.#operations.get(operation.origin.id) === operation) this.#operations.delete(operation.origin.id)
  }

  /** The owner stopped: refuse further notes, stop its reviewers, and cancel its notes not yet settled. */
  async cancel(origin: AgentTurn): Promise<void> {
    const operation = this.#operations.get(origin.id)
    if (operation) {
      await this.close(operation)
      this.release(operation)
    }
    // Newest first, so cancelling a running note doesn't start the next one.
    for (const turn of (await this.ports.runtime.store.followUpTurns(origin.sessionId, origin.id)).reverse()) {
      if (!SETTLED.has(turn.status)) await this.ports.runtime.cancelTurn(turn.sessionId, turn.id)
    }
  }

  async #operationFor(sessionId: string, originTurnId: string | undefined): Promise<FollowUpOperation | null> {
    if (typeof originTurnId !== 'string') return null
    const store = this.ports.runtime.store
    const named = await store.turn(originTurnId)
    if (!named || named.sessionId !== sessionId) return null
    const policy = named.effectivePolicy
    const rootId =
      [policy.followUpOf, policy.continuationOf].find((id): id is string => typeof id === 'string') ?? named.id
    const origin = rootId === named.id ? named : await store.turn(rootId)
    if (!origin || origin.sessionId !== sessionId) return null
    const existing = this.#operations.get(origin.id)
    if (existing?.owner === 'workflow') return existing
    // A workflow step opens its own operation while it runs. A delegated turn's owner is durable, so its
    // operation opens on the first note and is checked again on every one.
    if (origin.source !== 'delegation' || !(await this.ports.delegationLive(origin))) return null
    return this.#operations.get(origin.id) ?? this.open(origin, 'delegation')
  }

  async #window(
    operation: FollowUpOperation,
    reviewers: readonly Entry[],
    turn: Pick<TurnFollowUpWindow, 'taskId' | 'sessionId' | 'turnId'>,
    windowMs: number,
  ): Promise<ReviewOutcome> {
    const controller = new AbortController()
    const stop = () => controller.abort()
    operation.controller.signal.addEventListener('abort', stop, { once: true })
    const timer = setTimeout(stop, windowMs)
    const closed = new Promise<'timed-out' | 'cancelled'>((resolve) =>
      controller.signal.addEventListener(
        'abort',
        () => resolve(operation.controller.signal.aborted ? 'cancelled' : 'timed-out'),
        { once: true },
      ),
    )
    const window: TurnFollowUpWindow = {
      ...turn,
      owner: operation.owner,
      deadline: Date.now() + windowMs,
      signal: controller.signal,
    }
    const results = await Promise.all(
      reviewers.map(async (entry) => {
        const run = Promise.resolve()
          .then(() => entry.value.review(window))
          .then(
            () => 'done' as const,
            (error: unknown) => {
              log.warn(`turn reviewer '${entry.id}' failed: ${describeError(error).message}`)
              return 'failed' as const
            },
          )
        return { pluginId: entry.pluginId, outcome: await Promise.race([run, closed]) }
      }),
    )
    clearTimeout(timer)
    operation.controller.signal.removeEventListener('abort', stop)
    // From here a reviewer's note is late: its signal is aborted and the host refuses it.
    for (const entry of reviewers) operation.lateReviewers.add(entry.pluginId)
    const cancelled = operation.controller.signal.aborted
    controller.abort()
    return {
      turnId: turn.turnId,
      outcome: cancelled
        ? 'cancelled'
        : results.some((result) => result.outcome === 'timed-out')
          ? 'timed-out'
          : 'reviewed',
      reviewers: results,
    }
  }
}
