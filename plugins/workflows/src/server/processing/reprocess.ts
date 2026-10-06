import { and, eq } from 'drizzle-orm'
import type { PluginDatabase } from '@acorn/plugin-api/node'
import * as schema from '../../node/schema'
import { processingAttemptActive } from './readModel'
import { workflowContentFingerprint } from '../definitions/fingerprint'
import type { WorkflowDispatchRequest, WorkflowReprocessDispatchRequest, WorkflowTransaction } from '../dispatch/dispatcher'
import type { ResolvedWorkflowGraph } from '../../shared/workflowContracts'
import type { DataValue } from '@acorn/protocol/dataValues.ts'

/** Resolve immutable server rows; a client cannot supply replacement child inputs or definitions. */
export function resolveWorkflowReprocess(db: PluginDatabase | WorkflowTransaction, runId: string, recordId: string, digest?: string) {
  const selected = db.select().from(schema.workflowSelectedRecords).where(eq(schema.workflowSelectedRecords.id, recordId)).get()
  const selection = selected && db.select().from(schema.workflowSelections).where(and(eq(schema.workflowSelections.id, selected.selectionId), eq(schema.workflowSelections.runId, runId))).get()
  if (!selected || !selection || !selected.attemptId) throw new Error('Record attempt was not found in this run')
  const attempt = db.select().from(schema.workflowRecordAttempts).where(eq(schema.workflowRecordAttempts.id, selected.attemptId)).get()
  const state = attempt && db.select().from(schema.workflowRecordStates).where(eq(schema.workflowRecordStates.id, attempt.stateId)).get()
  const dispatch = attempt && db.select().from(schema.workflowDispatches).where(eq(schema.workflowDispatches.id, attempt.dispatchId)).get()
  const admitted = attempt && db.select().from(schema.workflowSelectedRecords).where(and(eq(schema.workflowSelectedRecords.selectionId, attempt.selectionId), eq(schema.workflowSelectedRecords.attemptId, attempt.id))).get()
  if (!attempt || !state || !dispatch || !admitted || state.attemptId !== attempt.id) throw new Error('Select the latest retained record attempt')
  if (processingAttemptActive(db, attempt.id)) throw new Error('Record attempt is still active')
  const fingerprint = workflowContentFingerprint({ attemptId: attempt.id, snapshot: admitted.snapshotJson, payload: dispatch.payloadJson })
  if (digest !== undefined && digest !== fingerprint) throw new Error('Reprocess preparation changed')
  const payload = JSON.parse(dispatch.payloadJson) as Pick<WorkflowDispatchRequest, 'task' | 'workflow' | 'inputs'> & {
    taskMode?: 'child' | 'parent'
    parentTaskId: string
    resolvedGraph?: ResolvedWorkflowGraph
    effectiveTools?: WorkflowReprocessDispatchRequest['effectiveTools']
    effectiveBudget?: WorkflowReprocessDispatchRequest['effectiveBudget']
    requiresRepoTrust?: boolean
  }
  if (payload.taskMode === 'parent') {
    const dispatches = db.select({ state: schema.workflowDispatches.state }).from(schema.workflowDispatches)
      .where(and(eq(schema.workflowDispatches.taskId, dispatch.taskId), eq(schema.workflowDispatches.taskMode, 'parent'))).all()
    const runs = db.select({ trigger: schema.workflowRuns.trigger, status: schema.workflowRuns.status }).from(schema.workflowRuns)
      .where(eq(schema.workflowRuns.taskId, dispatch.taskId)).all()
    if (dispatches.some(row => row.state !== 'terminal') || runs.some(row => row.trigger === 'agent-map' && ['running', 'gated', 'cancelling'].includes(row.status))) {
      throw new Error('Another item is using this task’s folder. Run this item again after the loop finishes.')
    }
  }
  return { recordId, digest: fingerprint, previousAttemptId: attempt.id, recordKey: admitted.recordKey,
    selectionId: selection.id, stepId: selection.stepId, stateId: state.id,
    scopeKey: selection.scopeKey, snapshot: JSON.parse(admitted.snapshotJson) as DataValue, payload }
}

export function prepareWorkflowReprocess(db: PluginDatabase, runId: string, recordId: string) {
  const prepared = resolveWorkflowReprocess(db, runId, recordId)
  return { recordId: prepared.recordId, digest: prepared.digest, previousAttemptId: prepared.previousAttemptId, title: prepared.payload.task.title }
}
