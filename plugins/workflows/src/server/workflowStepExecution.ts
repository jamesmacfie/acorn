import { eq } from 'drizzle-orm'
import { slugifyBranch } from '@acorn/protocol/branch.ts'
import { DEFAULT_PROFILE_ID, type HeadlessResult, type PluginDatabase } from '@acorn/plugin-api/node'
import { validateDataValue } from '@acorn/protocol/dataSchemas.ts'
import { parseDataValue } from '@acorn/protocol/dataValues.ts'
import * as schema from '../node/schema'
import type { StepHandlerContext, StepHandlerOutcome, WorkflowDef, WorkflowRunRow, WorkflowStepDef, WorkflowStepRow, StepKindContribution } from '../shared/workflowContracts'
import { rowIdentity, stepIdentity } from '../shared/workflowIdentity'
import { predecessorValues, WORKFLOW_VALUE_BYTES } from './workflowValues'
import { frozenWorkflowInputs, renderWith, renderWorkflowPrompt, stepOutput } from './workflowValidation'
import { intersectToolCeilings } from './workflowTools'
import { intersectWorkflowBudgets, parseEffectiveBudget, parseEffectiveTools, WorkflowSafetyRailError, type WorkflowTreeSafety } from './workflowTreeSafety'
import { retryRecord, unreachableSteps } from './workflowGraph'
import { Semaphore } from './workflowSemaphore'
import type { RunnerDeps, StepRunRequest } from './workflowRunnerDeps'
import type { WorkflowRunState } from './workflowRunState'

export const MAX_CONCURRENT_HEADLESS = 4
const now = () => Date.now()
const minDefined = (...values: Array<number | undefined>): number | undefined => {
  const defined = values.filter((value): value is number => value != null)
  return defined.length ? Math.min(...defined) : undefined
}

type ExecutionServices = {
  db: PluginDatabase
  deps: Pick<RunnerDeps, 'hooks' | 'createChildTask' | 'emitStepEvent' | 'writeHandoff' | 'notify' | 'runStep'>
  treeSafety: WorkflowTreeSafety
  state: WorkflowRunState
  kind(kind: string): StepKindContribution | undefined
  finishRun(run: WorkflowRunRow, status: 'done' | 'completed-with-failures' | 'failed' | 'safety-rail' | 'cancelled', error?: string, stepId?: string): Promise<void>
  safetyRailRun(runId: string, reason: string, trigger?: { runId: string; stepId: string }): Promise<void>
}

/** Runs a step and records its outcome. The runner retains graph scheduling and run lifecycle. */
export class WorkflowStepExecution {
  readonly #headless = new Semaphore(MAX_CONCURRENT_HEADLESS)
  readonly #activeHandlers = new Map<string, Map<string, AbortController>>()
  #handoffs: Promise<unknown> = Promise.resolve()
  #stopping = false

  constructor(private readonly services: ExecutionServices) {}

  stop(): void {
    this.#stopping = true
    for (const handlers of this.#activeHandlers.values()) {
      for (const controller of handlers.values()) controller.abort()
    }
    this.#activeHandlers.clear()
  }

  abortRun(runId: string): void {
    for (const controller of this.#activeHandlers.get(runId)?.values() ?? []) controller.abort()
  }

  abortStep(runId: string, stepId: string): void {
    this.#activeHandlers.get(runId)?.get(stepId)?.abort()
  }

  registerActive(runId: string, stepId: string, controller: AbortController): void {
    let handlers = this.#activeHandlers.get(runId)
    if (!handlers) {
      handlers = new Map()
      this.#activeHandlers.set(runId, handlers)
    }
    handlers.set(stepId, controller)
  }

  unregisterActive(runId: string, stepId: string): void {
    const handlers = this.#activeHandlers.get(runId)
    handlers?.delete(stepId)
    if (!handlers?.size) this.#activeHandlers.delete(runId)
  }

  /** Serializes handoff writes because the note store uses write then rename. */
  queueHandoff<T>(write: () => Promise<T>): Promise<T> {
    const next = this.#handoffs.then(write)
    this.#handoffs = next.catch(() => undefined)
    return next
  }

  async execute(
    run: WorkflowRunRow,
    step: WorkflowStepRow,
    def: WorkflowStepDef,
    workflow: WorkflowDef,
    rows: WorkflowStepRow[],
    edges: ReadonlyMap<string, string[]>,
  ): Promise<void> {
    const kind = def.kind ?? 'agent'
    const handler = this.services.kind(kind)?.handler
    if (!handler) {
      await this.services.finishRun(run, 'failed', `Step '${def.name}' has unknown kind '${kind}'.`, step.id)
      return
    }
    const inputs = frozenWorkflowInputs(workflow)
    const valueContext = predecessorValues(workflow, def, rows)
    const promptRows = rows.map(row => ({ ...row, name: rowIdentity(workflow, row) }))
    let renderedPrompt: string
    let renderedWith: Record<string, unknown> | undefined
    try {
      renderedPrompt = renderWorkflowPrompt(def.prompt, promptRows, inputs)
      // A contributed handler never sees a template: it gets the substituted command, URL or SQL.
      renderedWith = renderWith(def.with, promptRows, inputs)
    } catch (error) {
      await this.services.state.setStep(step.id, { status: 'failed', error: error instanceof Error ? error.message : 'Template rendering failed.' })
      await this.services.finishRun(run, 'failed', `Step '${def.name}' has an invalid template reference.`, step.id)
      return
    }
    const upstream = (edges.get(stepIdentity(def)) ?? []).flatMap((name) => {
      const row = rows.find((candidate) => rowIdentity(workflow, candidate) === name)
      return row && ['done', 'completed-with-failures'].includes(row.status) ? [{ name, output: stepOutput(row) }] : []
    })
    // A before-step refusal stops admission at a safety rail before the handler starts.
    const verdict = await this.services.deps.hooks?.run('before-step', {
      taskId: run.taskId,
      runId: run.id,
      stepId: step.id,
      step: def.name,
      kind: def.kind ?? 'agent',
    })
    if (verdict && !verdict.ok) {
      await this.services.state.setStep(step.id, { status: 'safety-rail', error: `${verdict.by}: ${verdict.reason}` })
      await this.services.safetyRailRun(
        run.rootRunId ?? run.id,
        `Step '${def.name}' was stopped by ${verdict.by}.`,
        { runId: run.id, stepId: step.id },
      )
      return
    }
    const controller = new AbortController()
    const tools = intersectToolCeilings(parseEffectiveTools(run), def.tools)
    const budget = intersectWorkflowBudgets(parseEffectiveBudget(run), def.budget)
    const runRemainingMs = run.deadlineAt == null ? undefined : run.deadlineAt - now()
    const timeoutMs = minDefined(budget.maxWallTimeMs, runRemainingMs)
    if (timeoutMs != null && timeoutMs <= 0) {
      await this.services.state.setStep(step.id, { status: 'safety-rail', error: 'Workflow wall-time budget exhausted.' })
      await this.services.safetyRailRun(
        run.rootRunId ?? run.id,
        'Workflow wall-time budget exhausted.',
        { runId: run.id, stepId: step.id },
      )
      return
    }
    this.registerActive(run.id, step.id, controller)
    // Persist the child task ID so cancellation can reach an isolated step.
    let childTaskId: string | undefined
    if (def.isolation === 'worktree' && (this.services.kind(kind)?.describe?.runsAgent ?? false)) {
      if (!this.services.deps.createChildTask) {
        this.unregisterActive(run.id, step.id)
        await this.services.state.setStep(step.id, { status: 'failed', error: 'Worktree isolation is unavailable (no child-task factory).' })
        await this.services.finishRun(run, 'failed', `Step '${def.name}' asked for its own worktree and there is no child-task factory.`, step.id)
        return
      }
      try {
        childTaskId = await this.services.deps.createChildTask(run.taskId, {
          title: `${run.name}: ${def.name}`,
          branch: slugifyBranch(`${run.name}-${def.name}`),
        })
      } catch (error) {
        this.unregisterActive(run.id, step.id)
        const detail = error instanceof Error ? error.message : 'Could not create the step\'s child task.'
        await this.services.state.setStep(step.id, { status: 'failed', error: detail })
        await this.services.finishRun(run, 'failed', `Step '${def.name}': ${detail}`, step.id)
        return
      }
    }
    let budgetTimedOut = false
    const budgetTimer = timeoutMs == null ? null : setTimeout(() => {
      budgetTimedOut = true
      controller.abort()
    }, timeoutMs)
    const context: StepHandlerContext = {
      // Only handler execution moves to the child task. The run and handoffs keep their owner.
      run: childTaskId ? { ...run, taskId: childTaskId } : run,
      step,
      def: renderedWith ? { ...def, with: renderedWith } : def,
      renderedPrompt,
      tools,
      budget,
      signal: controller.signal,
      inputs,
      predecessorValues: valueContext,
      upstream,
      emit: ({ event }) => {
        this.services.deps.emitStepEvent?.(run.id, step.id, event)
      },
    }
    // Preserve retry and child-task metadata when a handler replaces its input record.
    const carried = { ...retryRecord(step), ...(childTaskId ? { childTaskId } : {}) }
    await this.services.state.setStep(step.id, {
      status: 'running',
      inputsJson: JSON.stringify({ ...(step.inputsJson ? JSON.parse(step.inputsJson) : {}), prompt: renderedPrompt, tools, budget, ...carried }),
    })
    let outcome: StepHandlerOutcome
    try {
      outcome = await handler(context)
    } catch (error) {
      outcome = error instanceof WorkflowSafetyRailError
        ? { status: 'safety-rail', error: error.message }
        : controller.signal.aborted
        ? { status: 'cancelled', error: 'Step cancelled.' }
        : { status: 'failed', error: error instanceof Error ? error.message : 'Step handler failed.' }
    } finally {
      if (budgetTimer) clearTimeout(budgetTimer)
      this.unregisterActive(run.id, step.id)
    }
    if (this.#stopping) return
    if (budgetTimedOut) {
      outcome = {
        status: 'safety-rail',
        error: `Wall-time budget exhausted after ${timeoutMs}ms.`,
      }
    }
    if (outcome.status === 'safety-rail' && outcome.scope === 'admission') {
      await this.services.state.setStep(step.id, { status: 'safety-rail', error: outcome.error, resultJson: '{"admissionStopped":true}' })
      return
    }
    if (outcome.status === 'safety-rail') {
      await this.services.safetyRailRun(run.rootRunId ?? run.id, outcome.error, { runId: run.id, stepId: step.id })
      return
    }
    await this.persistOutcome(run, step, def, outcome, carried)
  }

  private async persistOutcome(
    run: WorkflowRunRow,
    step: WorkflowStepRow,
    def: WorkflowStepDef,
    outcome: StepHandlerOutcome,
    carried: Record<string, unknown> = {},
  ): Promise<void> {
    const currentRun = await this.services.state.run(run.id)
    const [currentStep] = await this.services.db.select().from(schema.workflowSteps).where(eq(schema.workflowSteps.id, step.id))
    if (!currentRun || currentRun.status === 'cancelling' || currentRun.status === 'cancelled' || currentStep?.status === 'cancelled') return
    if (outcome.status === 'waiting-gate') {
      await this.services.state.setStep(step.id, { status: 'waiting-gate' })
      // The run stays gated until its waiting steps or children settle.
      await this.services.state.setRun(run.id, { status: 'gated' })
      this.services.deps.notify(run.taskId, 'gate', `Workflow '${run.name}' needs you: ${def.name}`, { runId: run.id, stepId: step.id })
      return
    }
    if (outcome.status === 'waiting-children') {
      await this.services.state.setStep(step.id, { status: 'waiting-children' })
      return
    }
    if (['done', 'completed-with-failures'].includes(outcome.status) && JSON.parse(run.defJson).formatVersion === 1 && 'structured' in outcome) {
      try {
        const outputSchema = def.schema ?? this.services.kind(def.kind ?? 'agent')?.describe?.output?.schema
        if (outputSchema) validateDataValue(outcome.structured, outputSchema as import('@acorn/protocol/dataSchemas.ts').DataSchema, WORKFLOW_VALUE_BYTES)
        else if (outcome.structured !== undefined) parseDataValue(outcome.structured, WORKFLOW_VALUE_BYTES)
      } catch (error) { outcome = { ...outcome, status: 'failed', error: `Invalid structured output: ${String(error)}` } }
    }
    if (outcome.status === 'cancelled') {
      await this.services.state.setStep(step.id, { status: 'cancelled', error: outcome.error ?? 'Step cancelled.' })
      await this.services.finishRun(run, 'cancelled', outcome.error ?? `Step '${def.name}' cancelled.`, step.id)
      return
    }
    const inputsJson = outcome.inputs !== undefined
      ? JSON.stringify(outcome.inputs && typeof outcome.inputs === 'object' && !Array.isArray(outcome.inputs)
        ? { ...(outcome.inputs as Record<string, unknown>), ...carried }
        : outcome.inputs)
      : undefined
    const patch = {
      ...(inputsJson !== undefined ? { inputsJson } : {}),
      ...(outcome.result !== undefined ? { resultJson: JSON.stringify(outcome.result) } : {}),
      ...(outcome.structured !== undefined ? { structuredJson: JSON.stringify(outcome.structured) } : {}),
      ...(outcome.sessionId !== undefined ? { sessionId: outcome.sessionId } : {}),
      ...(outcome.agentSessionId !== undefined ? { agentSessionId: outcome.agentSessionId } : {}),
      ...(outcome.costUsd !== undefined ? { costUsd: outcome.costUsd } : {}),
      ...(outcome.usage !== undefined
        ? {
            resultJson: JSON.stringify({
              ...(outcome.result && typeof outcome.result === 'object' ? outcome.result : { result: outcome.result }),
              usage: outcome.usage,
            }),
          }
        : {}),
    }
    if (outcome.status === 'failed' || outcome.status === 'safety-rail') {
      await this.services.state.setStep(step.id, { ...patch, status: outcome.status, error: outcome.error })
      await this.services.finishRun(run, outcome.status, `Step '${def.name}': ${outcome.error}`, step.id)
      return
    }
    await this.services.state.setStep(step.id, { ...patch, status: outcome.status, ...(outcome.status === 'completed-with-failures' ? { error: outcome.error } : {}) })
    if (outcome.handoff) await this.queueHandoff(() => this.services.deps.writeHandoff(run.taskId, run.id, def.name, outcome.handoff!))
    if (def.branches && outcome.status === 'done') await this.applyBranch(run, step, def, outcome)
  }

  private async applyBranch(
    run: WorkflowRunRow,
    step: WorkflowStepRow,
    def: WorkflowStepDef,
    outcome: Extract<StepHandlerOutcome, { status: 'done' }>,
  ): Promise<void> {
    const structured = outcome.structured as { verdict?: unknown } | undefined
    const verdict = structured?.verdict
    const targetName = typeof verdict === 'string' ? (def.branches?.[verdict] ?? def.branches?.default) : def.branches?.default
    if (!targetName) {
      const detail = `Decision '${def.name}' produced unmatched verdict '${String(verdict)}' and has no default branch.`
      await this.services.state.setStep(step.id, { status: 'failed', error: detail })
      await this.services.finishRun(run, 'failed', detail, step.id)
      return
    }
    const current = await this.services.state.run(run.id)
    const workflow = JSON.parse((current ?? run).defJson) as WorkflowDef
    const rows = (await this.services.state.steps(run.id)).filter((row) => row.parentStepId == null)
    if (!rows.some((row) => rowIdentity(workflow, row) === targetName)) {
      await this.services.finishRun(run, 'failed', `Decision '${def.name}' has invalid target '${targetName}'.`, step.id)
      return
    }
    // A shared successor remains reachable through the chosen branch.
    const skipped = new Set(rows.filter((row) => row.status === 'skipped').map((row) => rowIdentity(workflow, row)))
    for (const name of Object.values(def.branches ?? {})) {
      if (name !== targetName && rows.find((row) => rowIdentity(workflow, row) === name)?.status === 'pending') skipped.add(name)
    }
    for (const name of unreachableSteps(workflow, skipped, new Set([targetName]))) skipped.add(name)
    for (const row of rows) {
      if (row.status === 'pending' && skipped.has(rowIdentity(workflow, row))) await this.services.state.setStep(row.id, { status: 'skipped' })
    }
  }

  async runHeadless(taskId: string, def: WorkflowStepDef, opts: StepRunRequest, ctx: StepHandlerContext): Promise<HeadlessResult> {
    // Record the session when the first event names it so the Agent pane can link a running step.
    let noted = ctx.step.agentSessionId ?? ''
    const root = await this.services.state.run(ctx.run.rootRunId ?? ctx.run.id)
    const concurrency = root ? (JSON.parse(root.defJson) as WorkflowDef).maxConcurrency ?? MAX_CONCURRENT_HEADLESS : MAX_CONCURRENT_HEADLESS
    return this.#headless.use(opts.signal ?? ctx.signal, async () => {
      const turnBudget = intersectWorkflowBudgets(ctx.budget, def.budget)
      const admissionId = this.services.treeSafety.reserveTurn(ctx.run, ctx.step, turnBudget)
      await opts.onStart?.()
      let result: HeadlessResult | undefined
      try {
        result = await this.services.deps.runStep(taskId, def, {
          ...opts,
          // A dispatched child row can carry its parent's profile. Use the frozen definition.
          profileId: def.profileId ?? DEFAULT_PROFILE_ID,
          workflowRunId: ctx.run.id,
          workflowStepId: ctx.step.id,
          managedSessionId: ctx.step.agentSessionId ?? undefined,
          onEvent: (event) => {
            opts.onEvent?.(event)
            ctx.emit({ at: now(), event })
            const sessionId = event.sessionId
            if (typeof sessionId !== 'string' || !sessionId || sessionId === noted) return
            noted = sessionId
            void this.services.state.setStep(ctx.step.id, { agentSessionId: sessionId })
          },
          timeoutMs: opts.timeoutMs ?? ctx.budget.maxWallTimeMs,
        })
        const violation = await this.services.treeSafety.settleTurn(admissionId, {
          costUsd: result.capture.costUsd ?? 0,
          inputTokens: result.capture.usage?.inputTokens ?? 0,
          outputTokens: result.capture.usage?.outputTokens ?? 0,
        }, result.status === 'ok' ? undefined : result.stderrTail, turnBudget)
        if (violation) throw new WorkflowSafetyRailError(`Safety rail: ${violation}.`)
        return result
      } catch (error) {
        if (!result) await this.services.treeSafety.settleTurn(admissionId, {}, error instanceof Error ? error.message : 'Provider turn failed.')
        throw error
      }
    }, { key: ctx.run.rootRunId ?? ctx.run.id, limit: concurrency })
  }
}
