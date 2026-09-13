import { eq } from 'drizzle-orm'
import type { PluginDatabase } from '@acorn/plugin-api/node'
import * as schema from '../node/schema'
import type { WorkflowRunRow, WorkflowStepRow } from '../shared/workflowContracts'

const TERMINAL_RUN = new Set(['done', 'failed', 'safety-rail', 'cancelled'])
const TERMINAL_STEP = new Set(['done', 'failed', 'skipped', 'safety-rail', 'cancelled'])

type WorkflowRunTerminationDeps = {
  run(runId: string): Promise<WorkflowRunRow | undefined>
  steps(runId: string): Promise<WorkflowStepRow[]>
  setRun(runId: string, patch: Partial<WorkflowRunRow>): Promise<void>
  setStep(stepId: string, patch: Partial<WorkflowStepRow>): Promise<void>
  finishRun(run: WorkflowRunRow, status: 'safety-rail' | 'cancelled', reason: string): Promise<void>
  abortRun(runId: string): void
  cancelAgentSession?(taskId: string, sessionId: string): Promise<void>
  cancelChildTask?(taskId: string): Promise<void>
}

/** Settles a run tree after cancellation, failure, or a safety rail. */
export class WorkflowRunTermination {
  constructor(
    private readonly db: PluginDatabase,
    private readonly deps: WorkflowRunTerminationDeps,
  ) {}

  async cancel(runId: string, reason = 'Run cancelled.'): Promise<void> {
    const run = await this.deps.run(runId)
    if (!run || TERMINAL_RUN.has(run.status)) return
    if (run.status !== 'cancelling') await this.deps.setRun(runId, { status: 'cancelling', error: reason })
    const dispatches = await this.dispatches(runId)
    await this.markDispatchesCancelling(dispatches, reason)
    await this.stopActiveWork(run)
    for (const dispatch of dispatches) {
      const child = await this.deps.run(dispatch.runId)
      if (child && !TERMINAL_RUN.has(child.status)) {
        await this.cancel(child.id, `Ancestor workflow run '${run.id}' was cancelled.`)
      }
    }
    await this.terminalizeDispatches(runId, reason)
    const steps = await this.deps.steps(runId)
    for (const step of steps) {
      if (!TERMINAL_STEP.has(step.status)) {
        await this.deps.setStep(step.id, { status: 'cancelled', error: reason })
      }
    }
    await this.cancelLegacyChildTasks(steps)
    await this.deps.finishRun(run, 'cancelled', reason)
  }

  async cleanupAfterFailure(run: WorkflowRunRow, reason: string): Promise<void> {
    const dispatches = (await this.dispatches(run.id)).filter((dispatch) => dispatch.state !== 'terminal')
    await this.deps.setRun(run.id, { status: 'cancelling', error: reason })
    await this.markDispatchesCancelling(dispatches, reason)
    await this.stopActiveWork(run)
    for (const dispatch of dispatches) {
      const child = await this.deps.run(dispatch.runId)
      if (child && !TERMINAL_RUN.has(child.status)) {
        await this.cancel(child.id, `Ancestor workflow run '${run.id}' failed.`)
      }
      await this.terminalizeDispatch(dispatch.id, reason)
    }
    const steps = await this.deps.steps(run.id)
    for (const step of steps) {
      // Pending steps were never admitted. Keep them pending so retry can distinguish them from
      // interrupted work.
      if (!TERMINAL_STEP.has(step.status) && step.status !== 'pending') {
        await this.deps.setStep(step.id, { status: 'cancelled', error: reason })
      }
    }
    await this.cancelLegacyChildTasks(steps)
  }

  async safetyRail(
    runId: string,
    reason: string,
    trigger?: { runId: string; stepId: string },
  ): Promise<void> {
    const run = await this.deps.run(runId)
    if (!run || TERMINAL_RUN.has(run.status)) return
    if (run.status !== 'cancelling') await this.deps.setRun(run.id, { status: 'cancelling', error: reason })
    const dispatches = (await this.dispatches(run.id)).filter((dispatch) => dispatch.state !== 'terminal')
    await this.markDispatchesCancelling(dispatches, reason)
    await this.stopActiveWork(run)
    for (const dispatch of dispatches) {
      const child = await this.deps.run(dispatch.runId)
      if (child && !TERMINAL_RUN.has(child.status)) await this.cancel(child.id, reason)
      await this.terminalizeDispatch(dispatch.id, reason)
    }
    const steps = await this.deps.steps(run.id)
    for (const step of steps) {
      if (TERMINAL_STEP.has(step.status)) continue
      if (trigger?.runId === run.id && trigger.stepId === step.id) {
        await this.deps.setStep(step.id, { status: 'safety-rail', error: reason })
      } else if (step.status !== 'pending') {
        await this.deps.setStep(step.id, { status: 'cancelled', error: reason })
      }
    }
    await this.cancelLegacyChildTasks(steps)
    await this.deps.finishRun(run, 'safety-rail', reason)
  }

  private dispatches(parentRunId: string) {
    return this.db.select().from(schema.workflowDispatches)
      .where(eq(schema.workflowDispatches.parentRunId, parentRunId))
  }

  private async markDispatchesCancelling(
    dispatches: Awaited<ReturnType<WorkflowRunTermination['dispatches']>>,
    reason: string,
  ): Promise<void> {
    for (const dispatch of dispatches.filter((row) => row.state !== 'terminal')) {
      await this.db.update(schema.workflowDispatches).set({
        state: 'cancelling',
        error: reason,
        updatedAt: Date.now(),
      }).where(eq(schema.workflowDispatches.id, dispatch.id))
    }
  }

  private async terminalizeDispatches(parentRunId: string, reason: string): Promise<void> {
    for (const dispatch of (await this.dispatches(parentRunId)).filter((row) => row.state !== 'terminal')) {
      await this.terminalizeDispatch(dispatch.id, reason)
    }
  }

  private async terminalizeDispatch(dispatchId: string, reason: string): Promise<void> {
    await this.db.update(schema.workflowDispatches).set({
      state: 'terminal',
      error: reason,
      updatedAt: Date.now(),
    }).where(eq(schema.workflowDispatches.id, dispatchId))
  }

  private async stopActiveWork(run: WorkflowRunRow): Promise<void> {
    this.deps.abortRun(run.id)
    const steps = await this.deps.steps(run.id)
    await Promise.all(steps.flatMap((step) => step.agentSessionId && this.deps.cancelAgentSession
      ? [this.deps.cancelAgentSession(run.taskId, step.agentSessionId).catch(() => undefined)]
      : []))
  }

  private async cancelLegacyChildTasks(steps: WorkflowStepRow[]): Promise<void> {
    if (!this.deps.cancelChildTask) return
    const ids = new Set<string>()
    for (const step of steps) {
      // Workflow dispatch tasks are durable history. Only legacy fan-out and isolated agent steps
      // store disposable child tasks directly in the step input snapshot.
      if (step.kind === 'workflow' || step.kind === 'workflow-map') continue
      if (!step.inputsJson) continue
      try {
        const id = (JSON.parse(step.inputsJson) as { childTaskId?: string }).childTaskId
        if (id) ids.add(id)
      } catch {
        // Malformed input snapshots remain cancellable at the step level.
      }
    }
    await Promise.all([...ids].map((id) => this.deps.cancelChildTask!(id).catch(() => undefined)))
  }
}
