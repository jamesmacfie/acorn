// The completion condition of one workflow step attempt (docs/workflows/agent-steps.md § Completion
// conditions). It holds the attempt's counters and last verdict, runs the shared judge, and saves each
// verdict against the exact turns it read. The loop that queues turns stays in ./sessionExecute.ts.
import type { HeadlessResult } from '@acorn/plugin-api/node'
import type { AgentExecuteGoalStatus, AgentExecuteGoalSummary } from '../../contract/sessionExecute'
import type { AgentEventRecord, AgentGoalVerdict } from '../../contract/wire.ts'
import {
  goalProgress,
  judgeGoal,
  MAX_GOAL_CONTINUATIONS,
  MAX_GOAL_NO_PROGRESS,
  type GoalJudgePorts,
} from './sessionGoal'
import type { AgentStore } from './store'

const EVALUATE = 'workflow.goal.evaluate'
const SUMMARY = 'workflow.goal'
const TERMINAL: ReadonlySet<AgentExecuteGoalStatus> = new Set([
  'satisfied',
  'blocked',
  'exhausted',
  'unavailable',
  'stopped',
])

type JudgeUsage = { inputTokens?: number; outputTokens?: number }

export type GoalDecision =
  | { kind: 'satisfied' }
  | { kind: 'continue' }
  | { kind: 'stop'; status: AgentExecuteGoalStatus; reason: string }

export class StepGoal {
  #status: AgentExecuteGoalStatus = 'checking'
  #continuations = 0
  #repairs = 0
  #noProgress = 0
  #verdict: AgentGoalVerdict | null = null
  #reason: string | undefined
  readonly #automaticTurns: AgentExecuteGoalSummary['automaticTurns'] = []
  /** What every check reported, added to the step's usage once at the end. */
  readonly judgeUsage: JudgeUsage[] = []

  constructor(
    private readonly ports: {
      judge: GoalJudgePorts
      store: Pick<AgentStore, 'operationResult' | 'saveOperation'>
      onChange?: (summary: AgentExecuteGoalSummary) => void
    },
    readonly objective: string,
    private readonly sessionId: string,
    private readonly profileId: string,
    /** The attempt's opening turn. Every key below hangs off it, so a retry in the same session starts clean. */
    private readonly originTurnId: string,
  ) {}

  /** Goal continuations and result repairs together, which share one limit. */
  get automatic(): number {
    return this.#continuations + this.#repairs
  }

  summary(): AgentExecuteGoalSummary {
    return {
      objective: this.objective,
      status: this.#status,
      continuations: this.#continuations,
      repairs: this.#repairs,
      verdict: this.#verdict,
      automaticTurns: [...this.#automaticTurns],
      ...(this.#reason ? { reason: this.#reason } : {}),
    }
  }

  set(status: AgentExecuteGoalStatus, reason?: string): void {
    this.#status = status
    this.#reason = reason
    this.ports.onChange?.(this.summary())
  }

  /** A turn Acorn queued on its own. */
  queued(turnId: string, reason: 'goal' | 'repair'): void {
    if (reason === 'goal') this.#continuations += 1
    else this.#repairs += 1
    this.#automaticTurns.push({ turnId, reason })
    if (reason === 'goal') this.set('continuing')
  }

  /** The verdict already saved for this exact turn set, so a repeated pass doesn't ask again. */
  async saved(turnIds: readonly string[]): Promise<AgentGoalVerdict | null> {
    const saved = await this.ports.store.operationResult<{ objective: string; verdict: AgentGoalVerdict }>(
      this.#key(turnIds),
      EVALUATE,
    )
    return saved?.objective === this.objective ? saved.verdict : null
  }

  /** Asks the judge. Throws when the check can't run or answers out of shape. */
  async judge(
    events: readonly AgentEventRecord[],
    turnId: string,
    signal: AbortSignal | undefined,
    timeoutMs: number,
  ): Promise<AgentGoalVerdict> {
    const { verdict, usage } = await judgeGoal(this.ports.judge, {
      profileId: this.profileId,
      objective: this.objective,
      events,
      turnId,
      signal,
      timeoutMs,
    })
    if (usage) this.judgeUsage.push(usage)
    return verdict
  }

  /** Saves a verdict against the turns it read and the last event it saw. */
  async save(turnIds: readonly string[], seq: number, verdict: AgentGoalVerdict): Promise<void> {
    await this.ports.store.saveOperation(
      this.#key(turnIds),
      EVALUATE,
      { objective: this.objective, turnIds, seq, verdict },
      this.sessionId,
    )
  }

  /**
   * What a verdict means for the step. `lastTurn` is the newest owned turn and its events: a goal
   * continuation that made no tool call or file change counts toward the no-progress limit.
   */
  decide(verdict: AgentGoalVerdict, lastTurn: { id: string; events: readonly AgentEventRecord[] }): GoalDecision {
    this.#verdict = verdict
    if (verdict.satisfied) {
      this.set('satisfied')
      return { kind: 'satisfied' }
    }
    if (verdict.blocker !== 'goal_not_met_yet') {
      const reason = `Completion condition not met: ${verdict.reason}`
      this.set('blocked', reason)
      return { kind: 'stop', status: 'blocked', reason }
    }
    const continued = this.#automaticTurns.some((turn) => turn.turnId === lastTurn.id && turn.reason === 'goal')
    if (continued) this.#noProgress = goalProgress(lastTurn.events) ? 0 : this.#noProgress + 1
    const limit =
      this.automatic >= MAX_GOAL_CONTINUATIONS
        ? `${MAX_GOAL_CONTINUATIONS} automatic continuations`
        : this.#noProgress >= MAX_GOAL_NO_PROGRESS
          ? `${MAX_GOAL_NO_PROGRESS} continuations in a row with no tool call or file change`
          : null
    if (limit) {
      const reason = `Goal limit reached after ${limit}. Last check: ${verdict.reason}`
      this.set('exhausted', reason)
      return { kind: 'stop', status: 'exhausted', reason }
    }
    return { kind: 'continue' }
  }

  /** The attempt's final state, saved once. A step that ended on its own reason records that reason. */
  async finish(result: HeadlessResult): Promise<AgentExecuteGoalSummary> {
    if (!TERMINAL.has(this.#status) || (this.#status === 'satisfied' && result.status !== 'ok')) {
      this.set(
        'stopped',
        result.stderrTail ||
          (result.status === 'cancelled' ? 'The step was cancelled.' : `The step ended: ${result.status}.`),
      )
    }
    const summary = this.summary()
    await this.ports.store.saveOperation(`workflow-goal:${this.originTurnId}`, SUMMARY, summary, this.sessionId)
    return summary
  }

  // Turns are only ever appended, so the newest one names the set.
  #key(turnIds: readonly string[]): string {
    return `workflow-goal-eval:${this.originTurnId}:${turnIds.length}:${turnIds.at(-1)}`
  }
}
