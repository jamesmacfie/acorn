import { asc, eq, inArray } from 'drizzle-orm'
import type { PluginDatabase, SpanHandle } from '@acorn/plugin-api/node'
import * as schema from '../../node/schema'
import type { WorkflowRunRow, WorkflowStepRow } from '../../shared/workflowContracts'
import type { WorkflowGateStatus, WorkflowRunStatus } from '../../contract/events'
import type { RunnerDeps } from './deps'

const TERMINAL_STEP = new Set(['done', 'completed-with-failures', 'failed', 'skipped', 'safety-rail', 'cancelled'])

/** Owns persisted run and step state and the notifications caused by status edges. */
export class WorkflowRunState {
  readonly #runSpans = new Map<string, SpanHandle>()
  readonly #stepSpans = new Map<string, SpanHandle>()

  constructor(
    private readonly db: PluginDatabase,
    private readonly deps: Pick<RunnerDeps, 'runChanged' | 'stepChanged' | 'gateChanged' | 'statusChanged' | 'telemetry'>,
    private readonly publishChild: (runId: string) => Promise<void>,
  ) {}

  stop(): void {
    // An open span cannot describe work that continues after this process exits.
    this.#runSpans.clear()
    this.#stepSpans.clear()
  }

  startRunSpan(runId: string, trigger: string, stepCount: number): void {
    const span = this.deps.telemetry?.startSpan('workflow.run', {
      attrs: { seam: 'workflow.run', 'run.id': runId, trigger, steps: stepCount },
    })
    if (span) this.#runSpans.set(runId, span)
  }

  finishRunSpan(runId: string, status: string): void {
    const span = this.#runSpans.get(runId)
    this.#runSpans.delete(runId)
    span?.end(status === 'done' ? 'ok' : 'error', { status })
  }

  async run(runId: string): Promise<WorkflowRunRow | undefined> {
    const [row] = await this.db.select().from(schema.workflowRuns).where(eq(schema.workflowRuns.id, runId))
    return row
  }

  async steps(runId: string): Promise<WorkflowStepRow[]> {
    return this.db.select().from(schema.workflowSteps).where(eq(schema.workflowSteps.runId, runId)).orderBy(asc(schema.workflowSteps.idx))
  }

  async childSteps(parentStepId: string): Promise<WorkflowStepRow[]> {
    return this.db.select().from(schema.workflowSteps).where(eq(schema.workflowSteps.parentStepId, parentStepId)).orderBy(asc(schema.workflowSteps.createdAt))
  }

  async setWaitingParentStatus(runId: string, status: 'running' | 'gated'): Promise<void> {
    const run = await this.run(runId)
    if (!run || !['running', 'gated'].includes(run.status)) return
    const ownGate = (await this.steps(runId)).some((step) => step.status === 'waiting-gate')
    const dispatches = await this.db.select({ runId: schema.workflowDispatches.runId })
      .from(schema.workflowDispatches)
      .where(eq(schema.workflowDispatches.parentRunId, runId))
    const children = dispatches.length
      ? await this.db.select({ status: schema.workflowRuns.status })
        .from(schema.workflowRuns)
        .where(inArray(schema.workflowRuns.id, dispatches.map((dispatch) => dispatch.runId)))
      : []
    // One child settling cannot clear another child's gate or a gate in this run.
    const next = ownGate || children.some((child) => child.status === 'gated') ? 'gated' : status
    if (run.status !== next) await this.setRun(runId, { status: next })
  }

  async setRun(runId: string, patch: Partial<WorkflowRunRow>): Promise<void> {
    const before = patch.status == null ? undefined : await this.run(runId)
    await this.db.update(schema.workflowRuns).set({ ...patch, updatedAt: Date.now() }).where(eq(schema.workflowRuns.id, runId))
    if (before && before.status !== patch.status) {
      this.deps.runChanged?.(before.taskId, runId, patch.status as WorkflowRunStatus)
      if (before.parentRunId) await this.publishChild(runId)
    }
    this.deps.statusChanged?.()
  }

  async setStep(stepId: string, patch: Partial<WorkflowStepRow>): Promise<void> {
    // A patch without a status edge does not emit a step or gate event.
    const [before] = patch.status == null
      ? []
      : await this.db.select({ runId: schema.workflowSteps.runId, status: schema.workflowSteps.status })
        .from(schema.workflowSteps).where(eq(schema.workflowSteps.id, stepId))
    await this.db.update(schema.workflowSteps).set({ ...patch, updatedAt: Date.now() }).where(eq(schema.workflowSteps.id, stepId))
    if (before && before.status !== patch.status) {
      this.#markStepSpan(before.runId, stepId, patch.status!)
      this.deps.stepChanged?.(before.runId, stepId, patch.status!)
      if (before.status === 'waiting-gate' || patch.status === 'waiting-gate') {
        const run = await this.run(before.runId)
        if (run) this.deps.gateChanged?.(run.taskId, before.runId, stepId, patch.status as WorkflowGateStatus)
      }
    }
    this.deps.statusChanged?.()
  }

  #markStepSpan(runId: string, stepId: string, status: string): void {
    if (status === 'running') {
      const parent = this.#runSpans.get(runId)
      const span = this.deps.telemetry?.startSpan('workflow.step', {
        traceId: parent?.traceId,
        parentSpanId: parent?.spanId,
        attrs: { seam: 'workflow.step', 'run.id': runId, 'step.id': stepId },
      })
      if (span) this.#stepSpans.set(stepId, span)
      return
    }
    // Waiting at a gate remains part of the step's measured duration.
    if (!TERMINAL_STEP.has(status)) return
    const span = this.#stepSpans.get(stepId)
    this.#stepSpans.delete(stepId)
    span?.end(status === 'done' || status === 'skipped' ? 'ok' : 'error', { status })
  }
}
