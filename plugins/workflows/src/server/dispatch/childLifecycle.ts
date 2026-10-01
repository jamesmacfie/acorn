import type { DataValue } from '@acorn/protocol/dataValues.ts'
import { stepIdentity } from '../../shared/workflowIdentity'
import { workflowOutputs } from '../validation/values'
import { eq, inArray } from 'drizzle-orm'
import { slugifyBranch } from '@acorn/protocol/branch.ts'
import type { PluginDatabase } from '@acorn/plugin-api/node'
import * as schema from '../../node/schema'
import type { WorkflowChildRunSummary } from '../../shared/api'
import type {
  ResolvedWorkflowGraph,
  StepHandler,
  StepHandlerOutcome,
  WorkflowRunRow,
  WorkflowStepRow,
} from '../../shared/workflowContracts'
import type { WorkflowDispatchRequest, WorkflowDispatchResult } from './dispatcher'
import {
  resolveChildWorkflowInputs,
  resolveWorkflowMapRoster,
  type WorkflowMapRoster,
} from '../validation/bindings'
import { workflowContentFingerprint } from '../definitions/resolution'
import { workflowRunUsage } from '../runs/read/readModel'
import { WorkflowSafetyRailError } from '../validation/treeSafety'
import type { WorkflowSelectionRequest } from '../processing/store'
import { parseDataValue } from '@acorn/protocol/dataValues.ts'
import type { DataSourceResult } from '@acorn/protocol/dataSources.ts'
import type { ResolvedQuery } from '@acorn/protocol/dataQueries.ts'

const TERMINAL_RUN = new Set(['done', 'completed-with-failures', 'failed', 'safety-rail', 'cancelled'])
const SUMMARY_LIMIT = 2_000

type ChildLifecycleServices = {
  select?(request: WorkflowSelectionRequest, signal?: AbortSignal): Promise<{ selectionId: string; children: WorkflowDispatchResult[] }>
  dispatch(request: WorkflowDispatchRequest, signal?: AbortSignal): Promise<WorkflowDispatchResult>
  dispatchMany(requests: readonly WorkflowDispatchRequest[], signal?: AbortSignal): Promise<WorkflowDispatchResult[]>
  steps(runId: string): Promise<WorkflowStepRow[]>
  setStep(stepId: string, patch: Partial<WorkflowStepRow>): Promise<void>
  setParentStatus(runId: string, status: 'running' | 'gated'): Promise<void>
  childChanged?(summary: WorkflowChildRunSummary & { ownerTaskId: string }): void
}

type ChangeWait = { promise: Promise<void>; cancel(): void }

const asRunStatus = (status: string | undefined): WorkflowChildRunSummary['runStatus'] =>
  status && ['running', 'gated', 'cancelling', 'done', 'completed-with-failures', 'failed', 'safety-rail', 'cancelled'].includes(status)
    ? status as WorkflowChildRunSummary['runStatus']
    : null

const bounded = (value: string | null | undefined): string | null => {
  if (!value) return null
  return value.length <= SUMMARY_LIMIT ? value : `${value.slice(0, SUMMARY_LIMIT - 3)}...`
}

/** Coordinates a dispatch step without occupying an agent execution slot. */
export class WorkflowChildLifecycle {
  readonly #waiters = new Map<string, Set<() => void>>()

  constructor(
    private readonly db: PluginDatabase,
    private readonly services: ChildLifecycleServices,
  ) {}

  handler(): StepHandler {
    return async (ctx) => {
      if (ctx.def.kind !== 'workflow' || !ctx.def.childWorkflow) {
        return { status: 'failed', error: `Step '${ctx.def.name}' is not a single-child workflow step.` }
      }
      const snapshot = this.childSnapshot(ctx.run, stepIdentity(ctx.def))
      if (!snapshot) return { status: 'failed', error: `Step '${ctx.def.name}' has no frozen child workflow snapshot.` }

      let childInputs: Record<string, DataValue>
      try {
        childInputs = resolveChildWorkflowInputs(
          ctx.def.childWorkflow.inputs ?? {},
          ctx.inputs,
          await this.services.steps(ctx.run.id),
          ctx.predecessorValues,
        )
      } catch (error) {
        return { status: 'failed', error: error instanceof Error ? error.message : 'Child workflow input binding failed.' }
      }

      await this.services.setStep(ctx.step.id, { status: 'waiting-children' })
      let dispatched: WorkflowDispatchResult
      try {
        dispatched = await this.services.dispatch({
          callerKey: `${ctx.run.id}:${ctx.step.id}:single`,
          parentRunId: ctx.run.id,
          parentStepId: ctx.step.id,
          task: {
            title: `${ctx.run.name}: ${ctx.def.name}`.slice(0, 500),
            branch: slugifyBranch(`${ctx.run.name}-${ctx.def.name}`),
          },
          workflow: snapshot.definition,
          inputs: childInputs,
        }, ctx.signal)
      } catch (error) {
        if (ctx.signal.aborted) return { status: 'cancelled', error: 'Child workflow dispatch cancelled.' }
        if (error instanceof WorkflowSafetyRailError) return { status: 'safety-rail', scope: 'admission', error: error.message }
        return { status: 'failed', error: error instanceof Error ? error.message : 'Child workflow dispatch failed.' }
      }

      if (ctx.signal.aborted || dispatched.state === 'cancelling') {
        return { status: 'cancelled', error: 'Child workflow dispatch cancelled.' }
      }
      if (dispatched.state === 'terminal' && !(await this.run(dispatched.runId))) {
        return { status: 'cancelled', error: 'Child workflow dispatch cancelled before the child run started.' }
      }
      return this.waitForChild(ctx.run.id, dispatched.runId, ctx.signal)
    }
  }

  mapHandler(): StepHandler {
    return async (ctx) => {
      if (ctx.def.kind !== 'workflow-map' || !ctx.def.childWorkflow) {
        return { status: 'failed', error: `Step '${ctx.def.name}' is not a workflow-map step.` }
      }
      const snapshot = this.childSnapshot(ctx.run, stepIdentity(ctx.def))
      if (!snapshot) return { status: 'failed', error: `Step '${ctx.def.name}' has no frozen child workflow snapshot.` }

      let roster: WorkflowMapRoster
      try {
        roster = this.persistedRoster(ctx.step)
          ?? resolveWorkflowMapRoster(ctx.def, ctx.inputs, await this.services.steps(ctx.run.id), snapshot.defaultInputs, ctx.predecessorValues, snapshot.definition.name)
        await this.services.setStep(ctx.step.id, { inputsJson: JSON.stringify({ mapRoster: roster }) })
      } catch (error) {
        return { status: 'failed', error: error instanceof Error ? error.message : 'Workflow map binding failed.' }
      }

      await this.services.setStep(ctx.step.id, { status: 'waiting-children' })
      let dispatched: WorkflowDispatchResult[]
      try {
        const requests = roster.entries.map((entry) => ({
          callerKey: `${ctx.run.id}:${ctx.step.id}:map:${workflowContentFingerprint(entry.itemKey)}`,
          parentRunId: ctx.run.id,
          parentStepId: ctx.step.id,
          itemKey: entry.itemKey,
          task: { title: entry.title, branch: entry.title },
          workflow: snapshot.definition,
          inputs: entry.inputs,
        }))
        if (this.services.select) {
          const source = ctx.def.items && ctx.predecessorValues?.[ctx.def.items.step] as (DataSourceResult & { provenance?: ResolvedQuery }) | undefined
          let checkpoint: WorkflowSelectionRequest['checkpoint']
          if (source?.provenance?.query.incremental) {
            if (source.mode !== 'execution' || source.completeness.kind !== 'complete' || source.incrementalBoundary === undefined || source.provenance.query.take) throw new Error('Incremental selection is not complete')
            const { incremental, ...query } = source.provenance.query
            checkpoint = { queryFingerprint: workflowContentFingerprint(query), boundary: source.incrementalBoundary,
              ...(incremental.kind === 'continue' ? { previousBoundary: incremental.boundary } : {}) }
          }
          const selected = await this.services.select({ invocationKey: `${ctx.run.id}:${ctx.step.id}:selection`, runId: ctx.run.id,
            stepId: ctx.step.id, policy: ctx.def.repeat ?? { mode: 'every-match' },
            records: roster.entries.map((entry, index) => ({ key: entry.itemKey, snapshot: parseDataValue(entry.item), dispatch: requests[index] })),
            ...(source?.provenance ? { provenance: parseDataValue({
              source: source.provenance.query.source,
              connectionId: source.provenance.query.scope.connectionId ?? null,
              sourceRevision: source.revision,
              savedQuery: source.provenance.published
                ? { id: source.provenance.published.queryId, revision: source.provenance.published.revision }
                : null,
              evaluationTime: source.evaluationTime,
              readTime: source.readTime,
              completeness: source.completeness,
            }) } : {}), ...(checkpoint ? { checkpoint } : {}) }, ctx.signal)
          dispatched = selected.children
        } else {
          if (ctx.def.repeat) throw new Error('Record processing is unavailable')
          dispatched = await this.services.dispatchMany(requests, ctx.signal)
        }
      } catch (error) {
        if (ctx.signal.aborted) return { status: 'cancelled', error: 'Workflow map dispatch cancelled.' }
        if (error instanceof WorkflowSafetyRailError) return { status: 'safety-rail', scope: 'admission', error: error.message }
        return { status: 'failed', error: error instanceof Error ? error.message : 'Workflow map dispatch failed.' }
      }
      if (ctx.signal.aborted) return { status: 'cancelled', error: 'Workflow map dispatch cancelled.' }
      if (!dispatched.length) return this.mapOutcome(ctx.def.name, roster, [])
      return this.waitForChildren(ctx.run.id, ctx.def.name, roster, dispatched, ctx.signal)
    }
  }

  wake(runId: string): void {
    for (const resolve of this.#waiters.get(runId) ?? []) resolve()
    this.#waiters.delete(runId)
  }

  async publish(runId: string): Promise<void> {
    this.wake(runId)
    const summary = await this.summaryForRun(runId)
    if (summary) this.services.childChanged?.({ ...summary, ownerTaskId: summary.parentTaskId })
  }

  async summariesForStep(parentStepId: string): Promise<WorkflowChildRunSummary[]> {
    const dispatches = await this.db
      .select()
      .from(schema.workflowDispatches)
      .where(eq(schema.workflowDispatches.parentStepId, parentStepId))
    return Promise.all(dispatches
      .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
      .map((row) => this.summary(row)))
  }

  private persistedRoster(step: WorkflowStepRow): WorkflowMapRoster | null {
    if (!step.inputsJson) return null
    try {
      const roster = (JSON.parse(step.inputsJson) as { mapRoster?: WorkflowMapRoster }).mapRoster
      if (roster?.version !== 1 || !Array.isArray(roster.entries)) return null
      return roster
    } catch {
      return null
    }
  }

  private childSnapshot(run: WorkflowRunRow, stepName: string) {
    if (!run.resolvedGraphJson) return null
    try {
      const graph = JSON.parse(run.resolvedGraphJson) as ResolvedWorkflowGraph
      return graph.nodes.find((node) => node.path.length === 2 && node.path[0] === '$' && node.path[1] === stepName) ?? null
    } catch {
      return null
    }
  }

  private async waitForChild(
    parentRunId: string,
    childRunId: string,
    signal: AbortSignal,
  ): Promise<StepHandlerOutcome> {
    for (;;) {
      if (signal.aborted) return { status: 'cancelled', error: 'Child workflow dispatch cancelled.' }
      const change = this.waitForChange(childRunId, signal)
      const run = await this.run(childRunId)
      if (!run) {
        change.cancel()
        return { status: 'failed', error: `Child workflow run '${childRunId}' was not found.` }
      }
      const summary = await this.summaryForRun(childRunId)
      if (summary) this.services.childChanged?.({ ...summary, ownerTaskId: summary.parentTaskId })
      if (TERMINAL_RUN.has(run.status)) {
        change.cancel()
        await this.db
          .update(schema.workflowDispatches)
          .set({ state: 'terminal', error: run.error, updatedAt: Date.now() })
          .where(eq(schema.workflowDispatches.runId, childRunId))
        await this.services.setParentStatus(parentRunId, 'running')
        const terminal = await this.summaryForRun(childRunId)
        if (terminal) this.services.childChanged?.({ ...terminal, ownerTaskId: terminal.parentTaskId })
        return this.outcome(run, terminal)
      }
      await this.services.setParentStatus(parentRunId, run.status === 'gated' ? 'gated' : 'running')
      await change.promise
      if (signal.aborted) return { status: 'cancelled', error: 'Child workflow dispatch cancelled.' }
      // The wake-up says only that the row may have changed. Read it again at the top of the loop.
    }
  }

  private async waitForChildren(
    parentRunId: string,
    stepName: string,
    roster: WorkflowMapRoster,
    dispatched: readonly WorkflowDispatchResult[],
    signal: AbortSignal,
  ): Promise<StepHandlerOutcome> {
    const runIds = dispatched.map((child) => child.runId)
    for (;;) {
      if (signal.aborted) return { status: 'cancelled', error: 'Workflow map dispatch cancelled.' }
      const change = this.waitForAnyChange(runIds, signal)
      const runRows = await this.db.select({ id: schema.workflowRuns.id, status: schema.workflowRuns.status, error: schema.workflowRuns.error }).from(schema.workflowRuns).where(inArray(schema.workflowRuns.id, runIds))
      const dispatchRows = await this.db.select({ runId: schema.workflowDispatches.runId, state: schema.workflowDispatches.state, error: schema.workflowDispatches.error }).from(schema.workflowDispatches).where(inArray(schema.workflowDispatches.runId, runIds))
      const runs = runIds.map(id => runRows.find(run => run.id === id))
      const settled = runs.map((run, index) => TERMINAL_RUN.has(run?.status ?? '')
        || (!run && dispatchRows.find(row => row.runId === runIds[index])?.state === 'terminal'))
      if (settled.every(Boolean)) {
        change.cancel()
        const at = Date.now()
        await Promise.all(runIds.map((runId, index) => this.db
          .update(schema.workflowDispatches)
          .set({ state: 'terminal', error: runs[index]?.error ?? dispatchRows.find(row => row.runId === runId)?.error ?? null, updatedAt: at + index })
          .where(eq(schema.workflowDispatches.runId, runId))))
        await this.services.setParentStatus(parentRunId, 'running')
        const terminal = await Promise.all(runIds.map((runId) => this.summaryForRun(runId)))
        const complete = terminal.filter((summary): summary is WorkflowChildRunSummary => summary !== null)
        for (const summary of complete) this.services.childChanged?.({ ...summary, ownerTaskId: summary.parentTaskId })
        return this.mapOutcome(stepName, roster, complete)
      }
      await this.services.setParentStatus(parentRunId, runs.some((run) => run?.status === 'gated') ? 'gated' : 'running')
      await change.promise
    }
  }

  private mapOutcome(
    stepName: string,
    roster: WorkflowMapRoster,
    summaries: WorkflowChildRunSummary[],
  ): StepHandlerOutcome {
    const data = {
      inputs: { mapRoster: roster },
      result: { children: summaries, failed: summaries.filter((summary) => summary.runStatus !== 'done').length },
      structured: { children: summaries, selected: roster.entries.length, skipped: roster.entries.length - summaries.length,
        emptyReason: !roster.entries.length ? 'no-matches' : !summaries.length ? 'all-skipped' : null },
      handoff: JSON.stringify({ children: summaries }, null, 2),
    }
    const failed = summaries.filter((summary) => summary.runStatus !== 'done')
    if (!failed.length) return { status: 'done', ...data }
    return {
      status: 'completed-with-failures',
      error: `Workflow map '${stepName}' finished with ${failed.length} failed ${failed.length === 1 ? 'child' : 'children'}.`,
      ...data,
    }
  }

  private outcome(run: WorkflowRunRow, summary: WorkflowChildRunSummary | null): StepHandlerOutcome {
    if (!summary) return { status: 'failed', error: `Child workflow run '${run.id}' has no dispatch record.` }
    const data = {
      inputs: { childTaskId: summary.taskId, childRunId: summary.runId },
      result: summary,
      structured: { child: summary, outputs: summary.outputs ?? {} },
      handoff: JSON.stringify(summary, null, 2),
    }
    if (run.status === 'done') return { status: 'done', ...data }
    if (run.status === 'completed-with-failures') return { status: 'completed-with-failures', error: run.error ?? 'Child workflow completed with failures.', ...data }
    const detail = run.error ? `: ${run.error}` : ''
    if (run.status === 'safety-rail') {
      return { status: 'failed', error: `Child workflow '${run.name}' stopped at a safety rail${detail}`, ...data }
    }
    if (run.status === 'cancelled') {
      return { status: 'failed', error: `Child workflow '${run.name}' was cancelled${detail}`, ...data }
    }
    return { status: 'failed', error: `Child workflow '${run.name}' failed${detail}`, ...data }
  }

  private async summaryForRun(runId: string): Promise<WorkflowChildRunSummary | null> {
    const [dispatch] = await this.db
      .select()
      .from(schema.workflowDispatches)
      .where(eq(schema.workflowDispatches.runId, runId))
    return dispatch ? this.summary(dispatch) : null
  }

  private async summary(dispatch: typeof schema.workflowDispatches.$inferSelect): Promise<WorkflowChildRunSummary> {
    const run = await this.run(dispatch.runId)
    const steps = run ? await this.services.steps(run.id) : []
    const result = [...steps]
      .reverse()
      .find((step) => step.parentStepId == null && (step.structuredJson || step.resultJson))
    return {
      parentTaskId: dispatch.parentTaskId,
      parentRunId: dispatch.parentRunId,
      parentStepId: dispatch.parentStepId,
      itemKey: dispatch.itemKey,
      taskId: dispatch.taskId,
      runId: dispatch.runId,
      name: run?.name ?? null,
      dispatchState: dispatch.state as WorkflowChildRunSummary['dispatchState'],
      runStatus: asRunStatus(run?.status),
      resultSummary: bounded(result?.structuredJson ?? result?.resultJson),
      ...(run && ['done', 'completed-with-failures'].includes(run.status) ? { outputs: workflowOutputs(JSON.parse(run.defJson), steps) } : {}),
      error: bounded(run?.error ?? dispatch.error),
      usage: await workflowRunUsage(this.db, dispatch.runId),
      updatedAt: Math.max(dispatch.updatedAt, run?.updatedAt ?? 0),
    }
  }

  private async run(runId: string): Promise<WorkflowRunRow | undefined> {
    const [run] = await this.db.select().from(schema.workflowRuns).where(eq(schema.workflowRuns.id, runId))
    return run
  }

  private waitForChange(runId: string, signal: AbortSignal): ChangeWait {
    let settled = false
    let resolvePromise = () => {}
    const cleanup = () => {
      const waiters = this.#waiters.get(runId)
      waiters?.delete(resolvePromise)
      if (!waiters?.size) this.#waiters.delete(runId)
      signal.removeEventListener('abort', resolvePromise)
    }
    const promise = new Promise<void>((resolve) => {
      resolvePromise = () => {
        if (settled) return
        settled = true
        cleanup()
        resolve()
      }
      const waiters = this.#waiters.get(runId) ?? new Set<() => void>()
      waiters.add(resolvePromise)
      this.#waiters.set(runId, waiters)
      signal.addEventListener('abort', resolvePromise, { once: true })
      if (signal.aborted) resolvePromise()
    })
    return { promise, cancel: resolvePromise }
  }

  private waitForAnyChange(childRunIds: readonly string[], signal: AbortSignal): ChangeWait {
    let settled = false
    let resolvePromise = () => {}
    const runIds = [...new Set(childRunIds)]
    const cleanup = () => {
      for (const runId of runIds) {
        const waiters = this.#waiters.get(runId)
        waiters?.delete(resolvePromise)
        if (!waiters?.size) this.#waiters.delete(runId)
      }
      signal.removeEventListener('abort', resolvePromise)
    }
    const promise = new Promise<void>((resolve) => {
      resolvePromise = () => {
        if (settled) return
        settled = true
        cleanup()
        resolve()
      }
      for (const runId of runIds) {
        const waiters = this.#waiters.get(runId) ?? new Set<() => void>()
        waiters.add(resolvePromise)
        this.#waiters.set(runId, waiters)
      }
      signal.addEventListener('abort', resolvePromise, { once: true })
      if (signal.aborted) resolvePromise()
    })
    return { promise, cancel: resolvePromise }
  }
}
