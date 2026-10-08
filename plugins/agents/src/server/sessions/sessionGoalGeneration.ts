import { agentProfileRegistry, type CoreServices, type PluginDatabase } from '@acorn/plugin-api/node'
import { HARNESS_BACKEND_PREFIX } from '@acorn/protocol/modelProviders.ts'
import type { AgentGoalVerdict, AgentSession, AgentTurn } from '../../contract/wire.ts'
import type { AgentStore } from './store'
import { SessionGoalStore } from './sessionGoalStore'
import { GOAL_JUDGE_SYSTEM, goalCheckFailure, goalContinuationPrompt, goalDecision, goalEvidence, parseGoalVerdict } from './sessionGoal'

const TIMEOUT_MS = 30_000

type GoalPorts = {
  store: AgentStore
  db: PluginDatabase
  models: CoreServices['models']
  currentUserId(): string | null
  publish(session: AgentSession): void
  enqueue(sessionId: string, prompt: string, key: string): Promise<void>
}

/** Owns goal checks until shutdown; persisted verdicts and turn keys make recovery idempotent. */
export class SessionGoalGeneration {
  private readonly running = new Map<string, { turnId: string; controller: AbortController; promise: Promise<void> }>()
  private readonly pending = new Map<string, string>()
  private stopped = false
  private readonly goals: SessionGoalStore

  constructor(private readonly ports: GoalPorts) {
    this.goals = new SessionGoalStore(ports.db, ports.store)
  }

  async set(sessionId: string, objective: string | null): Promise<AgentSession> {
    await this.cancelAndJoin(sessionId)
    const session = await this.goals.set(sessionId, objective)
    this.ports.publish(session)
    if (objective) {
      const snapshot = await this.ports.store.snapshot(sessionId)
      if (!snapshot.turns.some((turn) => ['queued', 'dispatching', 'active'].includes(turn.status))) {
        await this.ports.enqueue(sessionId, objective, `goal-first:${sessionId}:${Date.now()}`)
      }
    }
    return session
  }

  async resume(sessionId: string): Promise<AgentSession> {
    const session = await this.ports.store.requireSession(sessionId)
    if (session.goal?.status !== 'paused') throw new Error('This goal is not paused.')
    const resumed = await this.goals.status(sessionId, 'active')
    this.ports.publish(resumed)
    const snapshot = await this.ports.store.snapshot(sessionId)
    if (!snapshot.turns.some((turn) => ['queued', 'dispatching', 'active'].includes(turn.status))) {
      await this.ports.enqueue(sessionId, goalContinuationPrompt(session.goal.objective, 'The person resumed the goal.'),
        `goal-resume:${sessionId}:${Date.now()}`)
    }
    return resumed
  }

  async pause(sessionId: string): Promise<void> {
    await this.cancelAndJoin(sessionId)
    const session = await this.ports.store.getSession(sessionId)
    if (session?.goal?.status === 'active') this.ports.publish(await this.goals.status(sessionId, 'paused'))
  }

  check(sessionId: string, turnId: string): void {
    if (this.stopped) return
    const active = this.running.get(sessionId)
    if (active) {
      if (active.turnId === turnId) return
      this.pending.set(sessionId, turnId)
      return
    }
    const controller = new AbortController()
    const promise = this.evaluate(sessionId, turnId, controller.signal).finally(() => {
      if (this.running.get(sessionId)?.controller !== controller) return
      this.running.delete(sessionId)
      const pendingTurn = this.pending.get(sessionId)
      this.pending.delete(sessionId)
      if (pendingTurn) this.check(sessionId, pendingTurn)
    })
    this.running.set(sessionId, { turnId, controller, promise })
    void promise.catch(() => undefined)
  }

  async recover(): Promise<void> {
    for (const session of await this.goals.active()) {
      const snapshot = await this.ports.store.snapshot(session.id)
      const latest = snapshot.turns.at(-1)
      if (!latest) continue
      if (latest.status === 'interrupted' || latest.status === 'cancelled') await this.pause(session.id)
      else if (latest.status === 'completed' || latest.status === 'failed') this.check(session.id, latest.id)
    }
  }

  async stop(): Promise<void> {
    this.stopped = true
    this.pending.clear()
    for (const operation of this.running.values()) operation.controller.abort(new Error('runtime_stop'))
    await Promise.allSettled([...this.running.values()].map((operation) => operation.promise))
  }

  cancel(sessionId: string): void {
    this.pending.delete(sessionId)
    this.running.get(sessionId)?.controller.abort(new Error('goal_changed'))
  }

  private async cancelAndJoin(sessionId: string): Promise<void> {
    const operation = this.running.get(sessionId)
    this.cancel(sessionId)
    if (operation) await operation.promise.catch(() => undefined)
  }

  private async evaluate(sessionId: string, turnId: string, signal: AbortSignal): Promise<void> {
    const snapshot = await this.ports.store.exportSnapshot(sessionId)
    if (signal.aborted || this.stopped) return
    const session = snapshot.session
    const goal = session.goal
    const turn = snapshot.turns.find((item) => item.id === turnId)
    if (!goal || goal.status !== 'active' || !turn || !['completed', 'failed'].includes(turn.status)) return
    if (snapshot.turns.at(-1)?.id !== turnId) return
    if (snapshot.turns.some((item) => item.id !== turn.id && ['queued', 'dispatching', 'active'].includes(item.status))) return
    if (goal.verdict?.turnId === turnId) {
      if (goal.verdict.blocker === 'goal_not_met_yet') await this.continue(session, turn, goal.verdict, signal)
      return
    }
    const events = snapshot.events.filter((item) => item.turnId === turnId)
    let verdict: AgentGoalVerdict
    const evaluationKey = `goal-eval:${turnId}`
    const saved = await this.ports.store.operationResult<{ objective: string; verdict: AgentGoalVerdict }>(
      evaluationKey, 'session.goal.evaluate')
    if (signal.aborted || this.stopped) return
    if (saved?.objective === goal.objective) verdict = saved.verdict
    else if (turn.status === 'failed') {
      verdict = { ...goalCheckFailure(turnId), blocker: 'run_failed', reason: 'The agent turn failed.' }
    } else {
      const userId = this.ports.currentUserId()
      const profile = agentProfileRegistry.get(session.profileId)
      if (!userId || !profile?.aiArgv) verdict = goalCheckFailure(turnId)
      else {
        const controller = new AbortController()
        const abort = () => controller.abort(signal.reason)
        if (signal.aborted) abort()
        else signal.addEventListener('abort', abort, { once: true })
        const timeout = setTimeout(() => controller.abort(new Error('goal_check_timeout')), TIMEOUT_MS)
        try {
          if (controller.signal.aborted || this.stopped) return
          const result = await this.ports.models.generateText({
            userId, backendId: `${HARNESS_BACKEND_PREFIX}${session.profileId}`,
            input: {
              system: GOAL_JUDGE_SYSTEM,
              prompt: goalEvidence(goal.objective, snapshot.events),
              ...(session.profileId === 'claude-code' ? { modelId: 'haiku' } : {}),
              maxOutputTokens: 500,
              signal: controller.signal,
            }, timeoutMs: TIMEOUT_MS,
          })
          verdict = parseGoalVerdict(result.text, turnId)
        } catch {
          if (signal.aborted) return
          verdict = goalCheckFailure(turnId)
        } finally {
          clearTimeout(timeout)
          signal.removeEventListener('abort', abort)
        }
      }
    }
    if (signal.aborted || this.stopped) return
    if ((await this.ports.store.snapshot(sessionId)).turns.at(-1)?.id !== turnId) return
    if (signal.aborted || this.stopped) return
    await this.ports.store.saveOperation(evaluationKey, 'session.goal.evaluate', { objective: goal.objective, verdict }, sessionId)
    if (signal.aborted || this.stopped) return
    const decision = goalDecision(session, turn, verdict, events)
    const applied = await this.goals.apply(sessionId, goal.objective, verdict, decision.status,
      decision.continuations, decision.noProgress)
    if (!applied) return
    this.ports.publish(applied)
    if (decision.status === 'active') await this.continue(applied, turn, verdict, signal)
  }

  private async continue(session: AgentSession, turn: AgentTurn, verdict: AgentGoalVerdict, signal: AbortSignal): Promise<void> {
    if (signal.aborted || this.stopped || session.goal?.status !== 'active') return
    const latest = await this.ports.store.snapshot(session.id)
    if (signal.aborted || this.stopped) return
    if (latest.turns.at(-1)?.id !== turn.id) return
    if (latest.turns.some((item) => item.id !== turn.id && ['queued', 'dispatching', 'active'].includes(item.status))) return
    await this.ports.enqueue(session.id, goalContinuationPrompt(session.goal.objective, verdict.reason), `goal:${turn.id}`)
  }
}
