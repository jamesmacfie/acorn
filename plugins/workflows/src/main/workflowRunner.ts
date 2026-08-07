// Durable workflow engine. Rows remain the checkpoint; registered handlers own work while this
// class alone owns validation, ordering, persistence, branching, cancellation, and reconciliation.
import { randomUUID } from 'node:crypto'
import { asc, eq, inArray } from 'drizzle-orm'
import type { PluginDatabase } from '@acorn/node-core/main/pluginStorage.ts'
import * as schema from '../node/schema'
import { agentProfileRegistry, DEFAULT_PROFILE_ID } from '@acorn/node-core/main/agentProfiles/index.ts'
import type { HeadlessOpts, HeadlessResult, StreamEvent } from '@acorn/node-core/main/headless.ts'
import type {
  StepHandlerContext,
  StepHandlerOutcome,
  ToolCeiling,
  WorkflowDef,
  WorkflowBudget,
  WorkflowRunRow,
  WorkflowStepDef,
  WorkflowStepRow,
  WorkflowTriggerContribution,
} from './workflowContracts'
import { WorkflowContributionRegistry } from './workflowRegistry'
import { MAX_FAN_OUT_TASKS, MAX_STEP_TURNS, registerBuiltinWorkflowContributions } from './workflowBuiltins'
import { Semaphore } from './workflowSemaphore'
import { intersectToolCeilings } from './workflowTools'
import { assertValidWorkflow, normalizePersistedWorkflow, renderWorkflowPrompt, type WorkflowValidationCatalog } from './workflowValidation'

export type { ToolCeiling, WorkflowDef, WorkflowStepDef } from './workflowContracts'

export type FanOutTaskSeed = { title: string; branch: string; prompt?: string }
export type RunStepOptions = HeadlessOpts & {
  mode?: 'headless' | 'ai'
  signal?: AbortSignal
  onEvent?: (event: StreamEvent) => void
  // Fires once a concurrency slot is acquired, just before the process spawns — the seam fan-out
  // children use to flip 'pending' → 'running' only when they actually start.
  onStart?: () => void | Promise<void>
  tools?: ToolCeiling
  workflowRunId?: string
  workflowStepId?: string
  managedSessionId?: string
  timeoutMs?: number
}

export type RunnerDeps = {
  runStep(taskId: string, def: WorkflowStepDef, opts: RunStepOptions): Promise<HeadlessResult>
  writeHandoff(taskId: string, runId: string, stepName: string, body: string): Promise<void>
  finishHandoffs?(taskId: string, runId: string): Promise<void>
  assembleContext(taskId: string, runId: string): Promise<string>
  evaluatePolicy(taskId: string, policy: string): Promise<{ pass: boolean; detail?: string }>
  failingChecks(taskId: string): Promise<string | null>
  notify(taskId: string, kind: 'gate' | 'run-done', title: string): void
  statusChanged?(): void
  emitStepEvent?(runId: string, stepId: string, event: StreamEvent): void
  onRunTerminal?(taskId: string, runId: string): Promise<void>
  startRunTarget?(taskId: string, targetId: string): Promise<{ ok: boolean; url?: string }>
  createChildTask?(parentTaskId: string, seed: FanOutTaskSeed): Promise<string>
  cancelChildTask?(taskId: string): Promise<void>
  authorizeRepoConfig?(taskId: string): Promise<void>
}


const TERMINAL_RUN = new Set(['done', 'failed', 'safety-rail', 'cancelled'])
const TERMINAL_STEP = new Set(['done', 'failed', 'skipped', 'safety-rail', 'cancelled'])
export const MAX_CONCURRENT_HEADLESS = 4
export { MAX_FAN_OUT_TASKS, MAX_STEP_TURNS }

const now = () => Date.now()

const minDefined = (...values: Array<number | undefined>): number | undefined => {
  const defined = values.filter((value): value is number => value != null)
  return defined.length ? Math.min(...defined) : undefined
}

const intersectBudgets = (
  workflow: WorkflowBudget | undefined,
  step: WorkflowBudget | undefined,
): WorkflowBudget => ({
  maxWallTimeMs: minDefined(workflow?.maxWallTimeMs, step?.maxWallTimeMs),
  maxCostUsd: minDefined(workflow?.maxCostUsd, step?.maxCostUsd),
  maxInputTokens: minDefined(workflow?.maxInputTokens, step?.maxInputTokens),
  maxOutputTokens: minDefined(workflow?.maxOutputTokens, step?.maxOutputTokens),
  maxTurns: minDefined(workflow?.maxTurns, step?.maxTurns),
})

const budgetViolation = (
  budget: WorkflowBudget,
  usage: { costUsd: number; inputTokens: number; outputTokens: number },
): string | null => {
  if (budget.maxCostUsd != null && usage.costUsd > budget.maxCostUsd) {
    return `cost budget exceeded (${usage.costUsd.toFixed(4)} > ${budget.maxCostUsd.toFixed(4)} USD)`
  }
  if (budget.maxInputTokens != null && usage.inputTokens > budget.maxInputTokens) {
    return `input-token budget exceeded (${usage.inputTokens} > ${budget.maxInputTokens})`
  }
  if (budget.maxOutputTokens != null && usage.outputTokens > budget.maxOutputTokens) {
    return `output-token budget exceeded (${usage.outputTokens} > ${budget.maxOutputTokens})`
  }
  return null
}

const persistedUsage = (rows: WorkflowStepRow[]): {
  costUsd: number
  inputTokens: number
  outputTokens: number
} => rows.reduce((total, row) => {
  let usage: { inputTokens?: number; outputTokens?: number } = {}
  try {
    const result = row.resultJson ? JSON.parse(row.resultJson) as { usage?: typeof usage } : null
    usage = result?.usage ?? {}
  } catch {
    // An old/malformed result remains bounded by cost and wall-time rails.
  }
  return {
    costUsd: total.costUsd + (row.costUsd ?? 0),
    inputTokens: total.inputTokens + (usage.inputTokens ?? 0),
    outputTokens: total.outputTokens + (usage.outputTokens ?? 0),
  }
}, { costUsd: 0, inputTokens: 0, outputTokens: 0 })

export class WorkflowRunner {
  readonly contributions = new WorkflowContributionRegistry()
  readonly #activeRuns = new Set<string>()
  readonly #activeHandlers = new Map<string, Map<string, AbortController>>()

  // Abort every in-flight step, for teardown. Not a cancel: cancelling a RUN is a user action that
  // writes 'cancelled' and is meant to be visible next launch, whereas this is the process going away
  // mid-run — the rows stay 'running' and reconcile() sweeps them back to 'pending' on the next boot,
  // which is exactly what that sweep is for.
  //
  // Without it, dispose() closed the plugin's SQLite handle while headless children kept running, and
  // their persistOutcome/setStep writes landed on a closed database as unhandled rejections.
  stop(): void {
    for (const handlers of this.#activeHandlers.values()) {
      for (const controller of handlers.values()) controller.abort()
    }
    this.#activeHandlers.clear()
    this.#activeRuns.clear()
  }
  readonly #headless = new Semaphore(MAX_CONCURRENT_HEADLESS)

  constructor(
    private readonly db: PluginDatabase,
    private readonly deps: RunnerDeps,
  ) {
    registerBuiltinWorkflowContributions(this.contributions, {
      db: this.db,
      deps: this.deps,
      runHeadless: (taskId, def, opts, ctx) => this.runHeadless(taskId, def, opts, ctx),
      setStep: (stepId, patch) => this.setStep(stepId, patch),
      steps: (runId) => this.steps(runId),
      childSteps: (stepId) => this.childSteps(stepId),
      registerActive: (runId, stepId, controller) => this.registerActive(runId, stepId, controller),
      unregisterActive: (runId, stepId) => this.unregisterActive(runId, stepId),
      changed: () => this.changed(),
    })
  }

  validationCatalog(): WorkflowValidationCatalog {
    return {
      stepKinds: new Set(this.contributions.stepKinds.ids()),
      policies: new Set(this.contributions.policies.ids()),
      profiles: new Set(agentProfileRegistry.list().map((profile) => profile.id)),
      structuredProfiles: new Set(agentProfileRegistry.list().filter((profile) => profile.aiArgv).map((profile) => profile.id)),
      validateStepKind: (kind, step, context) => this.contributions.stepKinds.get(kind)?.validate?.(step, context) ?? [],
    }
  }

  validate(def: WorkflowDef): void {
    assertValidWorkflow(def, this.validationCatalog())
  }

  registerTrigger(trigger: WorkflowTriggerContribution): () => void {
    return this.contributions.registerTrigger(trigger)
  }

  async pollTriggers(): Promise<{ started: number; errors: string[] }> {
    let started = 0
    const errors: string[] = []
    for (const trigger of this.contributions.triggers.values()) {
      try {
        for (const match of await trigger.evaluate()) {
          await this.start(match.taskId, match.workflow, { trigger: trigger.id })
          started += 1
        }
      } catch (error) {
        errors.push(`${trigger.id}: ${error instanceof Error ? error.message : 'trigger failed'}`)
      }
    }
    return { started, errors }
  }

  async start(taskId: string, def: WorkflowDef, opts?: { trigger?: string }): Promise<string> {
    if ((def as WorkflowDef & { source?: string }).source === 'repo') await this.deps.authorizeRepoConfig?.(taskId)
    this.validate(def)
    const runId = randomUUID()
    const at = now()
    await this.db.insert(schema.workflowRuns).values({
      id: runId,
      taskId,
      name: def.name,
      status: 'running',
      posture: def.posture ?? 'gated',
      trigger: opts?.trigger ?? def.trigger ?? 'manual',
      defJson: JSON.stringify(def),
      createdAt: at,
      updatedAt: at,
    })
    for (const [idx, step] of def.steps.entries()) {
      await this.db.insert(schema.workflowSteps).values({
        id: randomUUID(),
        runId,
        idx,
        name: step.name,
        kind: step.kind ?? 'agent',
        mode: step.kind === 'decide' ? 'ai' : 'headless',
        profileId: step.profileId ?? DEFAULT_PROFILE_ID,
        model: step.model ?? null,
        status: 'pending',
        createdAt: at,
        updatedAt: at,
      })
    }
    this.changed()
    void this.tick(runId)
    return runId
  }

  async run(runId: string): Promise<WorkflowRunRow | undefined> {
    const [row] = await this.db.select().from(schema.workflowRuns).where(eq(schema.workflowRuns.id, runId))
    return row
  }

  async steps(runId: string): Promise<WorkflowStepRow[]> {
    return this.db.select().from(schema.workflowSteps).where(eq(schema.workflowSteps.runId, runId)).orderBy(asc(schema.workflowSteps.idx))
  }

  async childSteps(fanOutStepId: string): Promise<WorkflowStepRow[]> {
    return this.db.select().from(schema.workflowSteps).where(eq(schema.workflowSteps.parentStepId, fanOutStepId)).orderBy(asc(schema.workflowSteps.createdAt))
  }

  async resolveGate(runId: string, stepId: string, approved: boolean): Promise<void> {
    const [step] = await this.db.select().from(schema.workflowSteps).where(eq(schema.workflowSteps.id, stepId))
    if (!step || step.runId !== runId || step.status !== 'waiting-gate') return
    if (approved) {
      await this.setStep(stepId, { status: 'done', resultJson: JSON.stringify({ approved: true }) })
      await this.setRun(runId, { status: 'running' })
      void this.tick(runId)
      return
    }
    await this.setStep(stepId, { status: 'failed', error: 'Rejected at the human gate.' })
    const run = await this.run(runId)
    if (run) await this.finishRun(run, 'failed', `Gate '${step.name}' rejected.`)
  }

  async cancelRun(runId: string): Promise<void> {
    const run = await this.run(runId)
    if (!run || TERMINAL_RUN.has(run.status)) return
    await this.setRun(runId, { status: 'cancelling' })
    for (const controller of this.#activeHandlers.get(runId)?.values() ?? []) controller.abort()
    const steps = await this.steps(runId)
    for (const step of steps) {
      if (!TERMINAL_STEP.has(step.status)) await this.setStep(step.id, { status: 'cancelled', error: 'Run cancelled.' })
    }
    await this.cancelChildTasks(steps)
    await this.finishRun(run, 'cancelled', 'Run cancelled.')
  }

  async killStep(runId: string, stepId: string): Promise<void> {
    const run = await this.run(runId)
    const [step] = await this.db.select().from(schema.workflowSteps).where(eq(schema.workflowSteps.id, stepId))
    if (!run || !step || step.runId !== runId || TERMINAL_RUN.has(run.status) || TERMINAL_STEP.has(step.status)) return
    if (step.parentStepId == null && step.kind === 'fan-out') return this.cancelRun(runId)
    this.#activeHandlers.get(runId)?.get(stepId)?.abort()
    await this.setStep(stepId, { status: 'cancelled', error: 'Step killed by user.' })
    if (step.parentStepId == null) await this.finishRun(run, 'cancelled', `Step '${step.name}' was killed.`)
  }

  async reconcile(): Promise<void> {
    const runs = await this.db.select().from(schema.workflowRuns).where(inArray(schema.workflowRuns.status, ['running', 'cancelling']))
    for (const run of runs) {
      if (run.status === 'cancelling') {
        const steps = await this.steps(run.id)
        for (const step of steps) if (!TERMINAL_STEP.has(step.status)) await this.setStep(step.id, { status: 'cancelled' })
        await this.cancelChildTasks(steps)
        await this.finishRun(run, 'cancelled', run.error ?? 'Cancellation completed after restart.')
      } else if (run.status === 'running') {
        for (const step of await this.steps(run.id)) {
          if (step.status === 'running') await this.setStep(step.id, { status: 'pending', error: 'restarted: step re-queued after app restart' })
        }
        void this.tick(run.id)
      }
    }
  }

  async tick(runId: string): Promise<void> {
    if (this.#activeRuns.has(runId)) return
    this.#activeRuns.add(runId)
    try {
      let def: WorkflowDef | undefined
      for (;;) {
        const run = await this.run(runId)
        if (!run || run.status !== 'running') return
        def ??= normalizePersistedWorkflow(JSON.parse(run.defJson) as WorkflowDef) // defJson is frozen at start
        const steps = (await this.steps(runId)).filter((step) => step.parentStepId == null)
        // A persisted failed/safety-rail step with the run still 'running' means the app died
        // between the step write and finishRun — complete the halt instead of advancing past it.
        const halted = steps.find((step) => step.status === 'failed' || step.status === 'safety-rail')
        if (halted) {
          await this.finishRun(run, halted.status === 'safety-rail' ? 'safety-rail' : 'failed', halted.error ?? `Step '${halted.name}' failed.`)
          return
        }
        const next = steps.find((step) => step.status === 'pending')
        if (!next) {
          await this.finishRun(run, 'done')
          return
        }
        const outcome = await this.execute(run, next, def.steps[next.idx], def, steps)
        if (outcome !== 'continue') return
      }
    } finally {
      this.#activeRuns.delete(runId)
    }
  }

  private async execute(
    run: WorkflowRunRow,
    step: WorkflowStepRow,
    def: WorkflowStepDef,
    workflow: WorkflowDef,
    rows: WorkflowStepRow[],
  ): Promise<'continue' | 'stop'> {
    const handler = this.contributions.stepKinds.get(def.kind ?? 'agent')?.handler
    if (!handler) {
      await this.finishRun(run, 'failed', `Step '${def.name}' has unknown kind '${def.kind}'.`)
      return 'stop'
    }
    let renderedPrompt: string
    try {
      renderedPrompt = renderWorkflowPrompt(def.prompt, rows)
    } catch (error) {
      await this.setStep(step.id, { status: 'failed', error: error instanceof Error ? error.message : 'Template rendering failed.' })
      await this.finishRun(run, 'failed', `Step '${def.name}' has an invalid template reference.`)
      return 'stop'
    }
    const controller = new AbortController()
    const tools = intersectToolCeilings(workflow.tools, def.tools)
    const budget = intersectBudgets(workflow.budget, def.budget)
    const runRemainingMs = workflow.budget?.maxWallTimeMs == null
      ? undefined
      : workflow.budget.maxWallTimeMs - (now() - run.createdAt)
    const timeoutMs = minDefined(budget.maxWallTimeMs, runRemainingMs)
    if (timeoutMs != null && timeoutMs <= 0) {
      await this.setStep(step.id, { status: 'safety-rail', error: 'Workflow wall-time budget exhausted.' })
      await this.finishRun(run, 'safety-rail', 'Workflow wall-time budget exhausted.')
      return 'stop'
    }
    this.registerActive(run.id, step.id, controller)
    let budgetTimedOut = false
    const budgetTimer = timeoutMs == null ? null : setTimeout(() => {
      budgetTimedOut = true
      controller.abort()
    }, timeoutMs)
    const context: StepHandlerContext = {
      run,
      step,
      def,
      renderedPrompt,
      tools,
      budget,
      signal: controller.signal,
      emit: ({ event }) => {
        this.deps.emitStepEvent?.(run.id, step.id, event)
      },
    }
    await this.setStep(step.id, {
      status: 'running',
      inputsJson: JSON.stringify({ prompt: renderedPrompt, tools, budget }),
    })
    let outcome: StepHandlerOutcome
    try {
      outcome = await handler(context)
    } catch (error) {
      outcome = controller.signal.aborted
        ? { status: 'cancelled', error: 'Step cancelled.' }
        : { status: 'failed', error: error instanceof Error ? error.message : 'Step handler failed.' }
    } finally {
      if (budgetTimer) clearTimeout(budgetTimer)
      this.unregisterActive(run.id, step.id)
    }
    if (budgetTimedOut) {
      outcome = {
        status: 'safety-rail',
        error: `Wall-time budget exhausted after ${timeoutMs}ms.`,
      }
    } else if ('costUsd' in outcome || 'usage' in outcome) {
      const previous = persistedUsage(rows)
      const current = {
        costUsd: previous.costUsd + (outcome.costUsd ?? 0),
        inputTokens: previous.inputTokens + (outcome.usage?.inputTokens ?? 0),
        outputTokens: previous.outputTokens + (outcome.usage?.outputTokens ?? 0),
      }
      const violation = budgetViolation(workflow.budget ?? {}, current)
        ?? budgetViolation(def.budget ?? {}, {
          costUsd: outcome.costUsd ?? 0,
          inputTokens: outcome.usage?.inputTokens ?? 0,
          outputTokens: outcome.usage?.outputTokens ?? 0,
        })
      if (violation) outcome = { ...outcome, status: 'safety-rail', error: `Safety rail: ${violation}.` }
    }
    return this.persistOutcome(run, step, def, outcome)
  }

  private async persistOutcome(
    run: WorkflowRunRow,
    step: WorkflowStepRow,
    def: WorkflowStepDef,
    outcome: StepHandlerOutcome,
  ): Promise<'continue' | 'stop'> {
    const currentRun = await this.run(run.id)
    const [currentStep] = await this.db.select().from(schema.workflowSteps).where(eq(schema.workflowSteps.id, step.id))
    if (!currentRun || currentRun.status === 'cancelling' || currentRun.status === 'cancelled' || currentStep?.status === 'cancelled') return 'stop'
    if (outcome.status === 'waiting-gate') {
      await this.setStep(step.id, { status: 'waiting-gate' })
      await this.setRun(run.id, { status: 'gated' })
      this.deps.notify(run.taskId, 'gate', `Workflow '${run.name}' needs you: ${def.name}`)
      return 'stop'
    }
    if (outcome.status === 'cancelled') {
      await this.setStep(step.id, { status: 'cancelled', error: outcome.error ?? 'Step cancelled.' })
      await this.finishRun(run, 'cancelled', outcome.error ?? `Step '${def.name}' cancelled.`)
      return 'stop'
    }
    const patch = {
      ...(outcome.inputs !== undefined ? { inputsJson: JSON.stringify(outcome.inputs) } : {}),
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
      await this.setStep(step.id, { ...patch, status: outcome.status, error: outcome.error })
      await this.finishRun(run, outcome.status, `Step '${def.name}': ${outcome.error}`)
      return 'stop'
    }
    await this.setStep(step.id, { ...patch, status: 'done' })
    if (outcome.handoff) await this.deps.writeHandoff(run.taskId, run.id, def.name, outcome.handoff)
    if (def.branches) return this.applyBranch(run, step, def, outcome)
    return 'continue'
  }

  private async applyBranch(
    run: WorkflowRunRow,
    step: WorkflowStepRow,
    def: WorkflowStepDef,
    outcome: Extract<StepHandlerOutcome, { status: 'done' }>,
  ): Promise<'continue' | 'stop'> {
    const structured = outcome.structured as { verdict?: unknown } | undefined
    const verdict = structured?.verdict
    const targetName = typeof verdict === 'string' ? (def.branches?.[verdict] ?? def.branches?.default) : def.branches?.default
    if (!targetName) {
      const detail = `Decision '${def.name}' produced unmatched verdict '${String(verdict)}' and has no default branch.`
      await this.setStep(step.id, { status: 'failed', error: detail })
      await this.finishRun(run, 'failed', detail)
      return 'stop'
    }
    const rows = (await this.steps(run.id)).filter((row) => row.parentStepId == null)
    const target = rows.find((row) => row.name === targetName)
    if (!target) {
      await this.finishRun(run, 'failed', `Decision '${def.name}' has invalid target '${targetName}'.`)
      return 'stop'
    }
    const branchTargets = new Set(Object.values(def.branches ?? {}))
    for (const row of rows) {
      const isSkippedTarget = row.status === 'pending' && branchTargets.has(row.name) && row.name !== targetName
      const isJumpedOver = row.status === 'pending' && row.idx > step.idx && row.idx < target.idx
      if (isSkippedTarget || isJumpedOver) await this.setStep(row.id, { status: 'skipped' })
    }
    return 'continue'
  }

  private async runHeadless(taskId: string, def: WorkflowStepDef, opts: RunStepOptions, ctx: StepHandlerContext): Promise<HeadlessResult> {
    return this.#headless.use(opts.signal ?? ctx.signal, async () => {
      await opts.onStart?.()
      return this.deps.runStep(taskId, def, {
        ...opts,
        workflowRunId: ctx.run.id,
        workflowStepId: ctx.step.id,
        managedSessionId: ctx.step.agentSessionId ?? undefined,
        onEvent: (event) => {
          opts.onEvent?.(event)
          ctx.emit({ at: now(), event })
        },
        timeoutMs: opts.timeoutMs ?? ctx.budget.maxWallTimeMs,
      })
    })
  }

  private async finishRun(run: WorkflowRunRow, status: 'done' | 'failed' | 'safety-rail' | 'cancelled', error?: string): Promise<void> {
    const current = await this.run(run.id)
    if (!current || TERMINAL_RUN.has(current.status)) return
    await this.setRun(run.id, { status, error: error ?? null })
    await this.deps.finishHandoffs?.(run.taskId, run.id).catch(() => undefined)
    await this.deps.onRunTerminal?.(run.taskId, run.id).catch(() => undefined)
    if (status === 'done') this.deps.notify(run.taskId, 'run-done', `Workflow '${run.name}' finished`)
    if (status === 'safety-rail') this.deps.notify(run.taskId, 'gate', `Workflow '${run.name}' stopped at a safety rail.`)
  }

  private async cancelChildTasks(steps: WorkflowStepRow[]): Promise<void> {
    if (!this.deps.cancelChildTask) return
    const ids = new Set<string>()
    for (const step of steps) {
      if (!step.inputsJson) continue
      try {
        const id = (JSON.parse(step.inputsJson) as { childTaskId?: string }).childTaskId
        if (id) ids.add(id)
      } catch {
        // Old/malformed input snapshots remain cancellable at the step level.
      }
    }
    await Promise.all([...ids].map((id) => this.deps.cancelChildTask!(id).catch(() => undefined)))
  }

  private registerActive(runId: string, stepId: string, controller: AbortController): void {
    let run = this.#activeHandlers.get(runId)
    if (!run) {
      run = new Map()
      this.#activeHandlers.set(runId, run)
    }
    run.set(stepId, controller)
  }

  private unregisterActive(runId: string, stepId: string): void {
    const run = this.#activeHandlers.get(runId)
    run?.delete(stepId)
    if (!run?.size) this.#activeHandlers.delete(runId)
  }

  private async setRun(runId: string, patch: Partial<WorkflowRunRow>): Promise<void> {
    await this.db.update(schema.workflowRuns).set({ ...patch, updatedAt: now() }).where(eq(schema.workflowRuns.id, runId))
    this.changed()
  }

  private async setStep(stepId: string, patch: Partial<WorkflowStepRow>): Promise<void> {
    await this.db.update(schema.workflowSteps).set({ ...patch, updatedAt: now() }).where(eq(schema.workflowSteps.id, stepId))
    this.changed()
  }

  private changed(): void {
    this.deps.statusChanged?.()
  }
}
