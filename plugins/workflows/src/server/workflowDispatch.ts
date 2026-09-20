import type { DataValue } from '@acorn/protocol/dataValues.ts'
import { randomUUID } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'
import type { CoreServices, PluginDatabase } from '@acorn/plugin-api/node'
import * as schema from '../node/schema'
import type { ResolvedWorkflowGraph, ToolCeiling, WorkflowBudget, WorkflowDef } from '../shared/workflowContracts'
import type { WorkflowRunner } from './workflowRunner'
import { childWorkflowGraph, MAX_CHILD_WORKFLOW_DEPTH, workflowContentFingerprint } from './workflowResolution'
import { childSafetyEnvelope, descendantLimit, WorkflowSafetyRailError } from './workflowTreeSafety'
import { stepIdentity } from '../shared/workflowIdentity'
import { resolveWorkflowInputs } from './workflowValidation'

export type WorkflowDispatchRequest = {
  callerKey: string
  parentRunId: string
  parentStepId: string
  itemKey?: string
  task: { title: string; branch: string; origin?: string }
  workflow: WorkflowDef
  inputs?: Record<string, DataValue>
}

export type WorkflowDispatchState = 'reserved' | 'task-created' | 'run-started' | 'cancelling' | 'terminal'

export type WorkflowDispatchResult = {
  taskId: string
  runId: string
  state: WorkflowDispatchState
}

type WorkflowDispatchPayload = {
  rootReprocess?: true
  reprocessSource?: { runId: string; stepId: string; recordId: string; digest: string }
  resolvedGraph?: ResolvedWorkflowGraph
  parentTaskId: string
  rootRunId: string
  depth: number
  task: WorkflowDispatchRequest['task']
  workflow: WorkflowDef
  inputs?: Record<string, DataValue>
  effectiveTools: ToolCeiling
  effectiveBudget: WorkflowBudget
  deadlineAt?: number
  requiresRepoTrust: boolean
}

export type WorkflowReprocessDispatchRequest = {
  callerKey: string
  sourceRunId: string
  sourceStepId: string
  sourceRecordId: string
  sourceDigest: string
  parentTaskId: string
  itemKey: string
  task: WorkflowDispatchRequest['task']
  workflow: WorkflowDef
  inputs?: Record<string, DataValue>
  resolvedGraph?: ResolvedWorkflowGraph
  effectiveTools: ToolCeiling
  effectiveBudget: WorkflowBudget
  requiresRepoTrust: boolean
}

type WorkflowDispatchRow = typeof schema.workflowDispatches.$inferSelect
export type WorkflowTransaction = Parameters<Parameters<PluginDatabase['transaction']>[0]>[0]

type WorkflowStarter = Pick<WorkflowRunner, 'start'> & Partial<Pick<WorkflowRunner, 'cancelRun'>>
type ChildTaskCreator = Pick<CoreServices['tasks'], 'createChild'>

type WorkflowDispatchAuthority = {
  authorizeRepoConfig?(taskId: string): Promise<void>
}

const message = (error: unknown): string => error instanceof Error ? error.message : 'Workflow dispatch failed.'

/**
 * Moves one child dispatch across the workflow and core database boundary. Each cross-database
 * effect uses the IDs reserved in the first transaction, so retrying an ambiguous call verifies the
 * same task or run instead of allocating a replacement.
 */
export class WorkflowDispatcher {
  constructor(
    private readonly db: PluginDatabase,
    private readonly runner: WorkflowStarter,
    private readonly tasks: ChildTaskCreator,
    private readonly authority: WorkflowDispatchAuthority = {},
    private readonly id: () => string = randomUUID,
  ) {}

  async dispatch(request: WorkflowDispatchRequest, signal?: AbortSignal): Promise<WorkflowDispatchResult> {
    const [row] = this.reserveMany([request])
    if (!row) throw new Error('Workflow dispatch reservation did not return a row.')
    return this.resume(row, signal)
  }

  /** Reserves the complete roster before creating tasks, then admits it in declaration order. */
  async dispatchMany(requests: readonly WorkflowDispatchRequest[], signal?: AbortSignal): Promise<WorkflowDispatchResult[]> {
    const rows = this.reserveMany(requests)
    return this.resumeMany(rows, signal)
  }

  async resumeMany(rows: readonly WorkflowDispatchRow[], signal?: AbortSignal): Promise<WorkflowDispatchResult[]> {
    const results: WorkflowDispatchResult[] = []
    for (const row of rows) results.push(await this.resume(row, signal))
    return results
  }

  async reconcile(): Promise<{ reconciled: number; errors: string[] }> {
    const rows = await this.db
      .select()
      .from(schema.workflowDispatches)
      .where(inArray(schema.workflowDispatches.state, ['reserved', 'task-created']))
    const errors: string[] = []
    let reconciled = 0
    for (const row of rows) {
      try {
        await this.resume(row)
        reconciled += 1
      } catch (error) {
        errors.push(`${row.callerKey}: ${message(error)}`)
      }
    }
    return { reconciled, errors }
  }

  reserveMany(requests: readonly WorkflowDispatchRequest[], transaction?: WorkflowTransaction): WorkflowDispatchRow[] {
    for (const request of requests) {
      if (!request.callerKey.trim()) throw new Error('A workflow dispatch caller key is required.')
    }
    const reserve = (tx: WorkflowTransaction) => {
      const batchAt = Date.now()
      return requests.map((request, index) => {
        const parent = tx.select().from(schema.workflowRuns).where(eq(schema.workflowRuns.id, request.parentRunId)).get()
        if (!parent) throw new Error(`Parent workflow run '${request.parentRunId}' was not found.`)
        const parentStep = tx.select().from(schema.workflowSteps).where(eq(schema.workflowSteps.id, request.parentStepId)).get()
        if (!parentStep || parentStep.runId !== parent.id) {
          throw new Error(`Parent workflow step '${request.parentStepId}' does not belong to run '${parent.id}'.`)
        }

        if (parent.depth >= MAX_CHILD_WORKFLOW_DEPTH) throw new WorkflowSafetyRailError(`Workflow depth exceeds ${MAX_CHILD_WORKFLOW_DEPTH} child levels.`)
        let parentDefinition: WorkflowDef
        try {
          parentDefinition = JSON.parse(parent.defJson) as WorkflowDef
        } catch {
          throw new Error('Parent workflow definition is unavailable for child authority calculation.')
        }
        const dispatchDefinition = parentDefinition.steps[parentStep.idx]
        if (!dispatchDefinition) throw new Error(`Parent workflow step '${parentStep.name}' is missing from its frozen definition.`)
        const graph = parent.resolvedGraphJson
          ? childWorkflowGraph(JSON.parse(parent.resolvedGraphJson), stepIdentity(dispatchDefinition)) : undefined
        if (graph && workflowContentFingerprint(graph.root) !== workflowContentFingerprint(request.workflow)) {
          throw new Error('Child workflow does not match the frozen execution graph.')
        }
        const existing = tx
          .select()
          .from(schema.workflowDispatches)
          .where(eq(schema.workflowDispatches.callerKey, request.callerKey))
          .get()
        const reservationAt = existing?.createdAt ?? batchAt + index
        const envelope = childSafetyEnvelope(parent, dispatchDefinition, request.workflow, reservationAt)

        const payload: WorkflowDispatchPayload = {
          parentTaskId: parent.taskId,
          rootRunId: parent.rootRunId ?? parent.id,
          depth: parent.depth + 1,
          task: structuredClone(request.task),
          workflow: structuredClone(request.workflow),
          ...(graph ? { resolvedGraph: graph } : {}),
          effectiveTools: envelope.tools,
          effectiveBudget: envelope.budget,
          ...(envelope.deadlineAt == null ? {} : { deadlineAt: envelope.deadlineAt }),
          requiresRepoTrust: parent.requiresRepoTrust,
          ...(request.inputs ? { inputs: structuredClone(request.inputs) } : {}),
        }
        const payloadJson = JSON.stringify(payload)
        const payloadFingerprint = workflowContentFingerprint({
          parentRunId: request.parentRunId,
          parentStepId: request.parentStepId,
          itemKey: request.itemKey ?? null,
          payload,
        })
        if (existing) {
          if (existing.payloadFingerprint !== payloadFingerprint) {
            throw new Error(`Workflow dispatch caller key '${request.callerKey}' was reused with a different payload.`)
          }
          return existing
        }
        if (!['running', 'gated'].includes(parent.status)) {
          throw new Error(`Parent workflow run '${request.parentRunId}' is no longer admitting children.`)
        }
        resolveWorkflowInputs(request.workflow, request.inputs)

        const descendants = tx.select({ id: schema.workflowDispatches.id }).from(schema.workflowDispatches)
          .where(eq(schema.workflowDispatches.rootRunId, parent.rootRunId ?? parent.id)).all()
        const root = tx.select().from(schema.workflowRuns).where(eq(schema.workflowRuns.id, payload.rootRunId)).get()
        if (!root || !['running', 'gated'].includes(root.status)) throw new Error('Root workflow is no longer admitting children.')
        const limit = descendantLimit(JSON.parse(root.defJson))
        if (descendants.length >= limit) {
          throw new WorkflowSafetyRailError(`Safety rail: workflow tree reached the ${limit}-task descendant limit.`)
        }

        const at = reservationAt
        const row: typeof schema.workflowDispatches.$inferInsert = {
          id: this.id(),
          callerKey: request.callerKey,
          payloadFingerprint,
          payloadJson,
          parentTaskId: payload.parentTaskId,
          taskId: this.id(),
          runId: this.id(),
          rootRunId: payload.rootRunId,
          parentRunId: request.parentRunId,
          parentStepId: request.parentStepId,
          itemKey: request.itemKey ?? null,
          state: 'reserved',
          error: null,
          createdAt: at,
          updatedAt: at,
        }
        tx.insert(schema.workflowDispatches).values(row).run()
        return row as WorkflowDispatchRow
      })
    }
    return transaction ? reserve(transaction) : this.db.transaction(reserve)
  }

  /** Reserve an explicitly approved record reprocess as an independent root run.
   *
   * The dispatch row retains the source run/step for record lineage, while the run itself starts a
   * fresh execution tree. This avoids reopening a settled ancestor or manufacturing a wrapper run.
   */
  reserveReprocess(request: WorkflowReprocessDispatchRequest, transaction?: WorkflowTransaction): WorkflowDispatchRow {
    if (!request.callerKey.trim()) throw new Error('A workflow reprocess caller key is required.')
    const reserve = (tx: WorkflowTransaction) => {
      const existing = tx.select().from(schema.workflowDispatches)
        .where(eq(schema.workflowDispatches.callerKey, request.callerKey)).get()
      const payloadBase = {
        rootReprocess: true as const,
        reprocessSource: {
          runId: request.sourceRunId,
          stepId: request.sourceStepId,
          recordId: request.sourceRecordId,
          digest: request.sourceDigest,
        },
        parentTaskId: request.parentTaskId,
        // Kept for the shared persisted payload shape. The invocation below deliberately starts a
        // new root and uses the reserved run ID as its accounting owner.
        rootRunId: request.sourceRunId,
        depth: 0,
        task: structuredClone(request.task),
        workflow: structuredClone(request.workflow),
        ...(request.resolvedGraph ? { resolvedGraph: structuredClone(request.resolvedGraph) } : {}),
        effectiveTools: structuredClone(request.effectiveTools),
        effectiveBudget: structuredClone(request.effectiveBudget),
        requiresRepoTrust: request.requiresRepoTrust,
        ...(request.inputs ? { inputs: structuredClone(request.inputs) } : {}),
      }
      const payloadFingerprint = workflowContentFingerprint({
        sourceRunId: request.sourceRunId,
        sourceStepId: request.sourceStepId,
        sourceRecordId: request.sourceRecordId,
        sourceDigest: request.sourceDigest,
        itemKey: request.itemKey,
        payload: payloadBase,
      })
      if (existing) {
        if (existing.payloadFingerprint !== payloadFingerprint) {
          throw new Error(`Workflow dispatch caller key '${request.callerKey}' was reused with a different payload.`)
        }
        return existing
      }
      resolveWorkflowInputs(request.workflow, request.inputs)
      const runId = this.id()
      const at = Date.now()
      const row: typeof schema.workflowDispatches.$inferInsert = {
        id: this.id(),
        callerKey: request.callerKey,
        payloadFingerprint,
        payloadJson: JSON.stringify(payloadBase satisfies WorkflowDispatchPayload),
        parentTaskId: request.parentTaskId,
        taskId: this.id(),
        runId,
        rootRunId: runId,
        parentRunId: request.sourceRunId,
        parentStepId: request.sourceStepId,
        itemKey: request.itemKey,
        state: 'reserved',
        error: null,
        createdAt: at,
        updatedAt: at,
      }
      tx.insert(schema.workflowDispatches).values(row).run()
      return row as WorkflowDispatchRow
    }
    return transaction ? reserve(transaction) : this.db.transaction(reserve)
  }

  private async resume(initial: WorkflowDispatchRow, signal?: AbortSignal): Promise<WorkflowDispatchResult> {
    let row = initial
    try {
      while (row.state === 'reserved' || row.state === 'task-created') {
        const payload = JSON.parse(row.payloadJson) as WorkflowDispatchPayload
        await this.assertAdmission(row, signal)
        await this.assertAuthority(row, payload)
        if (row.state === 'reserved') {
          await this.tasks.createChild(row.parentTaskId, { ...payload.task, origin: payload.task.origin ?? 'workflows:child' }, row.taskId)
          await this.assertAdmission(row, signal)
          await this.assertAuthority(row, payload)
          row = await this.advance(row, 'task-created')
          continue
        }
        await this.runner.start(row.taskId, payload.workflow, {
          inputs: payload.inputs,
          resolvedGraph: payload.resolvedGraph,
          intendedRunId: row.runId,
          invocation: {
            callerKey: row.callerKey,
            payloadFingerprint: row.payloadFingerprint,
            rootRunId: payload.rootReprocess ? row.runId : row.rootRunId,
            parentRunId: payload.rootReprocess ? null : row.parentRunId,
            parentStepId: payload.rootReprocess ? null : row.parentStepId,
            depth: payload.rootReprocess ? 0 : payload.depth,
          },
          ...(payload.rootReprocess ? { trigger: 'reprocess' } : {}),
          effectiveTools: payload.effectiveTools,
          effectiveBudget: payload.effectiveBudget,
          deadlineAt: payload.deadlineAt,
          requiresRepoTrust: payload.requiresRepoTrust,
        })
        await this.assertAdmission(row, signal)
        row = await this.advance(row, 'run-started')
      }
      return { taskId: row.taskId, runId: row.runId, state: row.state as WorkflowDispatchState }
    } catch (error) {
      const payload = JSON.parse(row.payloadJson) as WorkflowDispatchPayload
      const [parent] = await this.db.select().from(schema.workflowRuns).where(eq(schema.workflowRuns.id, row.parentRunId))
      const [root] = await this.db.select().from(schema.workflowRuns).where(eq(schema.workflowRuns.id, row.rootRunId))
      if (signal?.aborted || (!payload.rootReprocess && (!parent || !root || !['running', 'gated'].includes(parent.status) || !['running', 'gated'].includes(root.status)))) {
        // Cancellation can race the run-start call after the parent's first descendant sweep. If
        // the reserved run committed in that window, settle it here before returning to the parent.
        // Keep the child task as workflow history; cancellation never archives or hides it.
        await this.runner.cancelRun?.(row.runId, 'Ancestor workflow run was cancelled.').catch(() => undefined)
      }
      await this.db
        .update(schema.workflowDispatches)
        .set({ error: message(error), updatedAt: Date.now() })
        .where(and(eq(schema.workflowDispatches.id, row.id), eq(schema.workflowDispatches.state, row.state)))
      throw error
    }
  }

  private async assertAuthority(row: WorkflowDispatchRow, payload: WorkflowDispatchPayload): Promise<void> {
    if (!payload.requiresRepoTrust) return
    if (!this.authority.authorizeRepoConfig) {
      throw new Error('Repository workflow trust cannot be revalidated, so child dispatch is unavailable.')
    }
    await this.authority.authorizeRepoConfig(row.parentTaskId)
    if (row.state !== 'reserved') await this.authority.authorizeRepoConfig(row.taskId)
  }

  private async assertAdmission(row: WorkflowDispatchRow, signal?: AbortSignal): Promise<void> {
    const [current] = await this.db.select().from(schema.workflowDispatches).where(eq(schema.workflowDispatches.id, row.id))
    const payload = JSON.parse(row.payloadJson) as WorkflowDispatchPayload
    if (payload.rootReprocess) {
      if (signal?.aborted || !current || current.state === 'cancelling' || current.state === 'terminal') {
        throw new Error('Workflow reprocess admission stopped before the new attempt started.')
      }
      return
    }
    const runs = await this.db.select().from(schema.workflowRuns).where(eq(schema.workflowRuns.rootRunId, row.rootRunId))
    let parent = runs.find(run => run.id === row.parentRunId)
    const seen = new Set<string>()
    let stopped = false
    while (parent && !seen.has(parent.id)) {
      seen.add(parent.id)
      if (!['running', 'gated'].includes(parent.status) || (parent.deadlineAt != null && parent.deadlineAt <= Date.now())) stopped = true
      parent = runs.find(run => run.id === parent!.parentRunId)
    }
    if (signal?.aborted || !current || current.state === 'cancelling' || current.state === 'terminal'
      || stopped || !seen.has(row.rootRunId)) {
      throw new Error('Workflow dispatch admission stopped because its parent is no longer running.')
    }
  }

  private async advance(row: WorkflowDispatchRow, state: WorkflowDispatchState): Promise<WorkflowDispatchRow> {
    await this.db
      .update(schema.workflowDispatches)
      .set({ state, error: null, updatedAt: Date.now() })
      .where(and(eq(schema.workflowDispatches.id, row.id), eq(schema.workflowDispatches.state, row.state)))
    const [current] = await this.db.select().from(schema.workflowDispatches).where(eq(schema.workflowDispatches.id, row.id))
    if (!current) throw new Error(`Workflow dispatch '${row.callerKey}' disappeared during reconciliation.`)
    return current
  }
}
