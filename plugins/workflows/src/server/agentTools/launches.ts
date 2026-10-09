// `workflow_run` and `workflow_cancel` (docs/agent-tools/workflow-tools.md § Invocation authority).
//
// Admission happens in one step and leaves a durable receipt: the signed caller, the tool call, the
// frozen graph, and the effective authority, all before any work starts. The receipt's ID is the run
// ID it reserves. Dispatch is separate, because the calling agent is mid-turn in the same checkout:
// the run starts only after that turn settles, so the agent and the workflow never write the folder
// at once. A restart picks the receipt up again, and the reserved run ID means it never starts twice.
import { randomUUID } from 'node:crypto'
import { and, eq, inArray, ne } from 'drizzle-orm'
import { isRepoConfigTrustError, ToolError, type ToolContext } from '@acorn/plugin-api/node'
import type { DataValue } from '@acorn/protocol/dataValues.ts'
import type { AgentSettledTurn, AgentToolCaller } from '@acorn/plugin-agents/contract/toolCaller.ts'
import type { AgentTurnsCapability } from '@acorn/plugin-agents/contract/lifecycle.ts'
import { workflowAgentLaunches, workflowRuns } from '../../node/schema'
import type { ResolvedWorkflowGraph, ToolCeiling, WorkflowBudget, WorkflowDefinitionRef } from '../../shared/workflowContracts'
import type { WorkflowInvocationLimits } from '../../shared/workflowInvocation'
import { workflowContentFingerprint } from '../definitions/fingerprint'
import { intersectToolCeilings } from '../steps/tools'
import { WorkflowValidationError } from '../validation/definition'
import { requireManagedCaller, type CallerLookup } from './caller'
import { definitionKey, requireTaskScope, type WorkflowToolDeps } from './discovery'
import { definitionIdForKey, executableGraphDigest, type PrepareInvocation, type WorkflowInvocationPolicies } from './invocation'

type LaunchRow = typeof workflowAgentLaunches.$inferSelect
export type LaunchState = 'awaiting-caller' | 'started' | 'failed' | 'cancelled'

export const ACTIVE_RUN_STATUSES = ['running', 'gated', 'cancelling'] as const
const BUSY_TURN = new Set(['queued', 'dispatching', 'active'])

export type WorkflowRunTarget = { kind: 'workflow-run'; resourceId: string; taskId: string }
export const runTarget = (runId: string, taskId: string): WorkflowRunTarget => ({ kind: 'workflow-run', resourceId: runId, taskId })

export type WorkflowLaunchDeps = WorkflowToolDeps & {
  policies: WorkflowInvocationPolicies
  prepare: PrepareInvocation
  startLaunch(request: {
    taskId: string; graph: ResolvedWorkflowGraph; intendedRunId: string; callerKey: string
    payloadFingerprint: string; effectiveBudget: WorkflowBudget; effectiveTools: ToolCeiling
  }): Promise<string>
  cancelRun(runId: string): Promise<void>
  caller: CallerLookup
  turns(): AgentTurnsCapability | undefined
  /** Where a task's files are, so two tasks sharing one folder count as one checkout. */
  checkoutPath(taskId: string): Promise<string | null>
  audit(action: string, entry: { subject: string; details: Record<string, string | number | boolean | null> }): void
  warn(message: string): void
}

export type WorkflowRunInput = { ref: WorkflowDefinitionRef; digest: string; inputs?: Record<string, DataValue> }

const min = (left: number | undefined, right: number | undefined): number | undefined =>
  left === undefined ? right : right === undefined ? left : Math.min(left, right)

/** The definition's own budget, narrowed by the owner's limits. Nothing a caller sends can widen it. */
export function narrowedBudget(budget: WorkflowBudget | undefined, limits: WorkflowInvocationLimits): WorkflowBudget {
  const out: WorkflowBudget = {
    maxTurns: min(budget?.maxTurns, limits.maxTurns),
    maxWallTimeMs: min(budget?.maxWallTimeMs, limits.maxWallTimeMs),
    maxCostUsd: min(budget?.maxCostUsd, limits.maxCostUsd),
    maxInputTokens: min(budget?.maxInputTokens, limits.maxInputTokens),
    maxOutputTokens: min(budget?.maxOutputTokens, limits.maxOutputTokens),
  }
  return Object.fromEntries(Object.entries(out).filter(([, value]) => value !== undefined)) as WorkflowBudget
}

export class WorkflowAgentLaunches {
  private readonly inFlight = new Map<string, Promise<unknown>>()
  // Admission for one task is one at a time, so two calls cannot both take the last start or the
  // one checkout slot.
  private readonly admitting = new Map<string, Promise<unknown>>()
  private readonly settling = new Map<string, Promise<void>>()

  constructor(private readonly deps: WorkflowLaunchDeps) {}

  get(id: string): LaunchRow | null {
    return this.deps.db.select().from(workflowAgentLaunches).where(eq(workflowAgentLaunches.id, id)).get() ?? null
  }

  bySession(taskId: string, sessionId: string): LaunchRow[] {
    return this.deps.db.select().from(workflowAgentLaunches)
      .where(and(eq(workflowAgentLaunches.taskId, taskId), eq(workflowAgentLaunches.sessionId, sessionId))).all()
  }

  /** Starts this session has spent against a policy. A failed dispatch never started, so it is free;
   *  a completed or cancelled run stays spent. */
  spent(sessionId: string, policyId: string): number {
    return this.deps.db.select({ id: workflowAgentLaunches.id }).from(workflowAgentLaunches)
      .where(and(eq(workflowAgentLaunches.sessionId, sessionId), eq(workflowAgentLaunches.policyId, policyId), ne(workflowAgentLaunches.state, 'failed'))).all().length
  }

  /** For workflows_list: whether this session could start the definition, as far as can be told
   *  without resolving its graph. A changed dependency still surfaces at workflow_run. */
  readiness(projectId: string, definitionKey: string, digest: string | undefined, sessionId: string | undefined) {
    const policy = this.deps.policies.find(projectId, definitionKey)
    if (!policy || policy.state !== 'active') return { allowed: false, reason: 'The owner has not allowed agents to start it.' }
    if (digest !== policy.definitionDigest) return { allowed: false, reason: 'It changed since the owner approved it.' }
    return {
      allowed: true,
      callerInputs: policy.callerInputs,
      ...(sessionId ? { startsLeft: Math.max(0, policy.startsPerSession - this.spent(sessionId, policy.id)) } : {}),
    }
  }

  // ─── workflow_run ─────────────────────────────────────────────────────────────────────────────

  async launch(input: WorkflowRunInput, context: ToolContext) {
    const caller = await requireManagedCaller(this.deps.caller, context)
    // Nested execution goes through declared child workflow steps, which keep their ancestor's
    // accounting. A step's own session never starts a fresh root.
    if (caller.workflowOwned) throw new ToolError('not_found', 'A workflow step cannot start a workflow. Use a child workflow step instead.')
    if (!context.callId) throw new ToolError('bad_request', 'workflow_run needs a stable tool call ID.')
    const key = `${context.taskId}:${caller.sessionId}:workflow_run:${context.callId}`
    const running = this.inFlight.get(key)
    if (running) return running as ReturnType<WorkflowAgentLaunches['admit']>
    const operation = this.serialByTask(context.taskId, () => this.admit(key, input, caller, context))
    this.inFlight.set(key, operation)
    void operation.finally(() => this.inFlight.delete(key)).catch(() => undefined)
    return operation
  }

  private async serialByTask<T>(taskId: string, work: () => Promise<T>): Promise<T> {
    const prior = this.admitting.get(taskId) ?? Promise.resolve()
    const next = prior.catch(() => undefined).then(work)
    this.admitting.set(taskId, next)
    try { return await next } finally { if (this.admitting.get(taskId) === next) this.admitting.delete(taskId) }
  }

  private async admit(key: string, input: WorkflowRunInput, caller: AgentToolCaller, context: ToolContext) {
    const db = this.deps.db
    const fingerprint = workflowContentFingerprint(input)
    const existing = db.select().from(workflowAgentLaunches).where(eq(workflowAgentLaunches.key, key)).get()
    // A replay answers with the admitted snapshot, even if the definition changed since.
    if (existing) {
      if (existing.payloadFingerprint !== fingerprint) throw new ToolError('conflict', 'This tool call ID was already used to start a workflow with different inputs.')
      return this.answer(existing)
    }

    const scope = await requireTaskScope(this.deps, context.taskId)
    const target = definitionKey(input.ref)
    const policy = this.deps.policies.find(scope.projectId, target)
    if (!policy || policy.state !== 'active') {
      throw new ToolError('needs-trust', 'The owner has not allowed agents to start this workflow in this project. Ask them to open it in the workflow editor and choose Allow agent invocation.')
    }
    const read = await this.deps.policies.definitionDigest(scope, target).catch(() => null)
    if (read !== input.digest) throw new ToolError('conflict', 'The workflow changed since you read it. Read it again with workflows_list, then start it with the new digest.')
    // The graph digest below leaves the root's input values out, because a caller supplies some of
    // them. The definition digest covers the root's defaults, so a changed default needs approval too.
    if (read !== policy.definitionDigest) {
      throw new ToolError('needs-trust', 'The workflow changed since the owner approved it. Ask the owner to review agent invocation again.')
    }
    const refused = Object.keys(input.inputs ?? {}).filter((name) => !policy.callerInputs.includes(name))
    if (refused.length) {
      throw new ToolError('bad_request', `The owner has not let agents set ${refused.map((name) => `'${name}'`).join(', ')}. `
        + (policy.callerInputs.length ? `You may set: ${policy.callerInputs.join(', ')}.` : 'This workflow takes no inputs from agents.'))
    }
    const used = this.spent(caller.sessionId, policy.id)
    if (used >= policy.startsPerSession) {
      throw new ToolError('conflict', `This session has used all ${policy.startsPerSession} starts the owner allowed for this workflow.`)
    }
    const busy = await this.activeInCheckout(context.taskId)
    if (busy) throw new ToolError('conflict', `Workflow run ${busy} is already active in this checkout. Wait for it to finish; the person can open it in the run pane.`)

    let graph: ResolvedWorkflowGraph
    try {
      graph = (await this.deps.prepare({ taskId: context.taskId }, definitionIdForKey(target), { ...input.inputs, ...policy.fixedInputs }, 'start')).graph
    } catch (error) {
      if (isRepoConfigTrustError(error)) throw new ToolError('needs-trust', "This workflow's repository files changed and need the owner's trust review before it can run.")
      if (error instanceof WorkflowValidationError) throw new ToolError('bad_request', error.message)
      throw new ToolError('failed', error instanceof Error ? error.message : 'The workflow could not be prepared.')
    }
    const graphDigest = executableGraphDigest(graph)
    if (graphDigest !== policy.graphDigest) {
      throw new ToolError('needs-trust', 'The workflow or one of its dependencies changed since the owner approved it. Ask the owner to review agent invocation again.')
    }

    const at = Date.now()
    const row: LaunchRow = {
      id: randomUUID(),
      key,
      taskId: context.taskId,
      sessionId: caller.sessionId,
      callerTitle: caller.title,
      callerTurnId: caller.activeTurnId,
      policyId: policy.id,
      definitionKey: target,
      graphDigest,
      payloadFingerprint: fingerprint,
      graphJson: JSON.stringify(graph),
      effectiveJson: JSON.stringify({
        budget: narrowedBudget(graph.root.budget, policy.limits),
        // The signed caller's ceiling and the definition's own; neither can widen the other.
        tools: intersectToolCeilings(context.toolCeiling, graph.root.tools),
      }),
      state: 'awaiting-caller',
      error: null,
      createdAt: at,
      updatedAt: at,
    }
    db.insert(workflowAgentLaunches).values(row).run()
    this.deps.audit('agent-run-launched', {
      subject: row.id,
      details: { taskId: row.taskId, sessionId: row.sessionId, policyId: policy.id, definition: target, graphDigest },
    })
    // Usually the caller's turn is still running and this returns at once. It also covers a turn
    // that settled while admission ran, which no settled-turn event will report again.
    await this.settle(row.id)
    return this.answer(this.get(row.id)!)
  }

  /** What `workflow_run` returns, for a new launch and a replay alike. */
  answer(row: LaunchRow) {
    const run = this.deps.db.select({ status: workflowRuns.status }).from(workflowRuns).where(eq(workflowRuns.id, row.id)).get()
    const policy = this.deps.policies.byId(row.policyId)
    const effective = JSON.parse(row.effectiveJson) as { budget: WorkflowBudget; tools: ToolCeiling }
    return {
      runId: row.id,
      status: run?.status ?? (row.state === 'failed' ? 'not-started' : row.state),
      ...(row.state === 'awaiting-caller' ? { next: 'The run starts after this turn ends. End your turn now; the person can watch it in the run pane.' } : {}),
      ...(row.error ? { error: row.error } : {}),
      effective,
      allowance: { used: this.spent(row.sessionId, row.policyId), limit: policy?.startsPerSession ?? null },
      receipt: { launchId: row.id, definition: row.definitionKey, graphDigest: row.graphDigest, admittedAt: row.createdAt },
      target: runTarget(row.id, row.taskId),
    }
  }

  /** The first active run, or pending launch, in this task's checkout. */
  private async activeInCheckout(taskId: string, except?: string): Promise<string | null> {
    const db = this.deps.db
    const candidates = [
      ...db.select({ id: workflowRuns.id, taskId: workflowRuns.taskId }).from(workflowRuns).where(inArray(workflowRuns.status, [...ACTIVE_RUN_STATUSES])).all(),
      ...db.select({ id: workflowAgentLaunches.id, taskId: workflowAgentLaunches.taskId }).from(workflowAgentLaunches).where(eq(workflowAgentLaunches.state, 'awaiting-caller')).all(),
    ].filter((candidate) => candidate.id !== except)
    if (!candidates.length) return null
    const path = await this.deps.checkoutPath(taskId)
    for (const candidate of candidates) {
      if (candidate.taskId === taskId || (path && await this.deps.checkoutPath(candidate.taskId) === path)) return candidate.id
    }
    return null
  }

  // ─── Handoff and dispatch ─────────────────────────────────────────────────────────────────────

  /** Moves one waiting launch on if its caller has settled. Safe to call any number of times. */
  settle(id: string): Promise<void> {
    const prior = this.settling.get(id) ?? Promise.resolve()
    const next = prior.catch(() => undefined).then(() => this.settleOnce(id))
    this.settling.set(id, next)
    void next.finally(() => { if (this.settling.get(id) === next) this.settling.delete(id) }).catch(() => undefined)
    return next
  }

  private setState(id: string, state: LaunchState, error: string | null = null): void {
    this.deps.db.update(workflowAgentLaunches).set({ state, error, updatedAt: Date.now() }).where(eq(workflowAgentLaunches.id, id)).run()
  }

  private async settleOnce(id: string): Promise<void> {
    const launch = this.get(id)
    if (!launch || launch.state !== 'awaiting-caller') return
    // A restart between creating the run and recording it.
    if (this.deps.db.select({ id: workflowRuns.id }).from(workflowRuns).where(eq(workflowRuns.id, id)).get()) return this.setState(id, 'started')
    const turns = this.deps.turns()
    // Without the Agents plugin nobody can say the caller settled, so the launch keeps waiting.
    if (!turns) return
    const own = await turns.list({ taskId: launch.taskId, sessionId: launch.sessionId })
    const launching = launch.callerTurnId ? own.find((turn) => turn.turnId === launch.callerTurnId) : undefined
    if (launching?.status === 'cancelled') return this.setState(id, 'cancelled', 'Stopped with the turn that started it.')
    // The caller is working, either still in the launching turn or in a newer one. The next settled
    // turn tries again, so a caller that never settles never starts the work.
    if (own.some((turn) => BUSY_TURN.has(turn.status))) return
    await this.dispatch(launch)
  }

  private async dispatch(launch: LaunchRow): Promise<void> {
    const busy = await this.activeInCheckout(launch.taskId, launch.id)
    if (busy) return this.setState(launch.id, 'failed', `Workflow run ${busy} started in this checkout first.`)
    const effective = JSON.parse(launch.effectiveJson) as { budget: WorkflowBudget; tools: ToolCeiling }
    try {
      await this.deps.startLaunch({
        taskId: launch.taskId,
        graph: JSON.parse(launch.graphJson) as ResolvedWorkflowGraph,
        intendedRunId: launch.id,
        callerKey: `agent:${launch.key}`,
        payloadFingerprint: launch.payloadFingerprint,
        effectiveBudget: effective.budget,
        effectiveTools: effective.tools,
      })
      this.setState(launch.id, 'started')
    } catch (error) {
      const message = isRepoConfigTrustError(error)
        ? "The workflow's repository files need the owner's trust review."
        : error instanceof Error ? error.message : 'The workflow could not start.'
      this.setState(launch.id, 'failed', message)
      this.deps.warn(`agent-launched workflow ${launch.id} did not start: ${message}`)
    }
  }

  /** A turn of some session settled. A stopped turn stops that session's launched runs; any settled
   *  turn may release a launch waiting on its caller. */
  async turnSettled(turn: AgentSettledTurn): Promise<void> {
    const launches = this.bySession(turn.taskId, turn.sessionId)
    if (turn.status === 'cancelled') {
      for (const launch of launches) {
        if (launch.state === 'awaiting-caller') this.setState(launch.id, 'cancelled', 'Stopped with its agent session.')
        else if (launch.state === 'started') await this.cancelIfActive(launch.id)
      }
      return
    }
    for (const launch of launches) if (launch.state === 'awaiting-caller') await this.settle(launch.id)
  }

  /** After a restart, every launch still waiting is checked once; events cover the rest. */
  async reconcile(): Promise<void> {
    const waiting = this.deps.db.select({ id: workflowAgentLaunches.id }).from(workflowAgentLaunches)
      .where(eq(workflowAgentLaunches.state, 'awaiting-caller')).all()
    for (const { id } of waiting) {
      await this.settle(id).catch((error) => this.deps.warn(`agent launch ${id} could not be checked: ${error instanceof Error ? error.message : String(error)}`))
    }
  }

  private async cancelIfActive(runId: string): Promise<void> {
    const run = this.deps.db.select({ status: workflowRuns.status }).from(workflowRuns).where(eq(workflowRuns.id, runId)).get()
    if (run && (ACTIVE_RUN_STATUSES as readonly string[]).includes(run.status)) await this.deps.cancelRun(runId)
  }

  // ─── workflow_cancel ──────────────────────────────────────────────────────────────────────────

  async cancel(input: { runId: string }, context: ToolContext) {
    const caller = await requireManagedCaller(this.deps.caller, context)
    const launch = this.get(input.runId)
    // Only a run this session launched. The enclosing workflow and anyone else's run read as missing.
    if (!launch || launch.sessionId !== caller.sessionId || launch.taskId !== context.taskId) {
      throw new ToolError('not_found', 'No run this session started has that ID.')
    }
    if (launch.state === 'awaiting-caller') this.setState(launch.id, 'cancelled', 'Cancelled by the agent that started it.')
    else if (launch.state === 'started') await this.cancelIfActive(launch.id)
    this.deps.audit('agent-run-cancelled', { subject: launch.id, details: { taskId: launch.taskId, sessionId: launch.sessionId } })
    const run = this.deps.db.select({ status: workflowRuns.status }).from(workflowRuns).where(eq(workflowRuns.id, launch.id)).get()
    return { runId: launch.id, status: run?.status ?? this.get(launch.id)!.state, target: runTarget(launch.id, launch.taskId) }
  }
}
