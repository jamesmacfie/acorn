import { randomUUID } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'
import type { CoreServices, PluginDatabase } from '@acorn/plugin-api/node'
import * as schema from '../node/schema'
import type { ToolCeiling, WorkflowBudget, WorkflowDef } from '../shared/workflowContracts'
import type { WorkflowRunner } from './workflowRunner'
import { workflowContentFingerprint } from './workflowResolution'
import { childSafetyEnvelope, MAX_WORKFLOW_DESCENDANTS, WorkflowSafetyRailError } from './workflowTreeSafety'

export type WorkflowDispatchRequest = {
  callerKey: string
  parentRunId: string
  parentStepId: string
  itemKey?: string
  task: { title: string; branch: string }
  workflow: WorkflowDef
  inputs?: Record<string, string>
}

export type WorkflowDispatchState = 'reserved' | 'task-created' | 'run-started' | 'cancelling' | 'terminal'

export type WorkflowDispatchResult = {
  taskId: string
  runId: string
  state: WorkflowDispatchState
}

type WorkflowDispatchPayload = {
  parentTaskId: string
  rootRunId: string
  depth: number
  task: WorkflowDispatchRequest['task']
  workflow: WorkflowDef
  inputs?: Record<string, string>
  effectiveTools: ToolCeiling
  effectiveBudget: WorkflowBudget
  deadlineAt?: number
  requiresRepoTrust: boolean
}

type WorkflowDispatchRow = typeof schema.workflowDispatches.$inferSelect

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

  private reserveMany(requests: readonly WorkflowDispatchRequest[]): WorkflowDispatchRow[] {
    for (const request of requests) {
      if (!request.callerKey.trim()) throw new Error('A workflow dispatch caller key is required.')
    }
    return this.db.transaction((tx) => {
      const batchAt = Date.now()
      return requests.map((request, index) => {
        const parent = tx.select().from(schema.workflowRuns).where(eq(schema.workflowRuns.id, request.parentRunId)).get()
        if (!parent) throw new Error(`Parent workflow run '${request.parentRunId}' was not found.`)
        if (!['running', 'gated'].includes(parent.status)) {
          throw new Error(`Parent workflow run '${request.parentRunId}' is no longer admitting children.`)
        }
        const parentStep = tx.select().from(schema.workflowSteps).where(eq(schema.workflowSteps.id, request.parentStepId)).get()
        if (!parentStep || parentStep.runId !== parent.id) {
          throw new Error(`Parent workflow step '${request.parentStepId}' does not belong to run '${parent.id}'.`)
        }

        if (parent.depth !== 0) throw new Error('Child workflows cannot dispatch another workflow.')
        let parentDefinition: WorkflowDef
        try {
          parentDefinition = JSON.parse(parent.defJson) as WorkflowDef
        } catch {
          throw new Error('Parent workflow definition is unavailable for child authority calculation.')
        }
        const dispatchDefinition = parentDefinition.steps.find((step) => step.name === parentStep.name)
        if (!dispatchDefinition) throw new Error(`Parent workflow step '${parentStep.name}' is missing from its frozen definition.`)
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

        const descendants = tx.select({ id: schema.workflowDispatches.id }).from(schema.workflowDispatches)
          .where(eq(schema.workflowDispatches.rootRunId, parent.rootRunId ?? parent.id)).all()
        if (descendants.length >= MAX_WORKFLOW_DESCENDANTS) {
          throw new WorkflowSafetyRailError(`Safety rail: workflow tree reached the ${MAX_WORKFLOW_DESCENDANTS}-task descendant limit.`)
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
    })
  }

  private async resume(initial: WorkflowDispatchRow, signal?: AbortSignal): Promise<WorkflowDispatchResult> {
    let row = initial
    try {
      while (row.state === 'reserved' || row.state === 'task-created') {
        const payload = JSON.parse(row.payloadJson) as WorkflowDispatchPayload
        await this.assertAdmission(row, signal)
        await this.assertAuthority(row, payload)
        if (row.state === 'reserved') {
          await this.tasks.createChild(row.parentTaskId, payload.task, row.taskId)
          await this.assertAdmission(row, signal)
          await this.assertAuthority(row, payload)
          row = await this.advance(row, 'task-created')
          continue
        }
        await this.runner.start(row.taskId, payload.workflow, {
          inputs: payload.inputs,
          intendedRunId: row.runId,
          invocation: {
            callerKey: row.callerKey,
            payloadFingerprint: row.payloadFingerprint,
            rootRunId: row.rootRunId,
            parentRunId: row.parentRunId,
            parentStepId: row.parentStepId,
            depth: payload.depth,
          },
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
      if (signal?.aborted) {
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
    const [parent] = await this.db.select({ status: schema.workflowRuns.status }).from(schema.workflowRuns).where(eq(schema.workflowRuns.id, row.parentRunId))
    if (signal?.aborted || !current || current.state === 'cancelling' || current.state === 'terminal'
      || !parent || ['cancelling', 'cancelled', 'done', 'failed', 'safety-rail'].includes(parent.status)) {
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
