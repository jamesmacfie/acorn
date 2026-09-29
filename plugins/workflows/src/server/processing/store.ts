import { randomUUID } from 'node:crypto'
import { and, asc, eq } from 'drizzle-orm'
import type { PluginDatabase } from '@acorn/plugin-api/node'
import { DATA_LIMITS, canonicalDataEncoding, parseDataValue, type DataValue } from '@acorn/protocol/dataValues.ts'
import * as schema from '../../node/schema'
import type { WorkflowCheckpoint, WorkflowProcessingScope, WorkflowRepeatPolicy } from '../../shared/workflowProcessing'
import type { WorkflowDef } from '../../shared/workflowContracts'
import { stepIdentity } from '../../shared/workflowIdentity'
import type { WorkflowDispatcher, WorkflowDispatchRequest, WorkflowTransaction } from '../dispatch/dispatcher'
import { workflowContentFingerprint } from '../definitions/resolution'
import { processingDecision, processingFields, processingProjection } from './rules'
import { processingAttemptActive } from './readModel'
import { resolveWorkflowReprocess } from './reprocess'

export type WorkflowSelectionRequest = {
  invocationKey: string
  runId: string
  stepId: string
  policy: WorkflowRepeatPolicy
  records: { key: string; snapshot: DataValue; dispatch: WorkflowDispatchRequest; previousAttemptId?: string }[]
  provenance?: DataValue
  baseline?: boolean
  checkpoint?: WorkflowCheckpoint
}

/** A schedule binds a root once; ordinary manual roots get independent history. */
export function bindWorkflowProcessingScope(db: PluginDatabase, runId: string, scope: WorkflowProcessingScope): void {
  if (!scope.scopeId.trim() || !scope.epoch.trim()) throw new Error('Processing scope and epoch are required')
  db.transaction(tx => {
    const run = tx.select().from(schema.workflowRuns).where(eq(schema.workflowRuns.id, runId)).get()
    if (!run || run.parentRunId) throw new Error('Processing scope must bind a root run')
    const prior = tx.select().from(schema.workflowProcessingScopes).where(eq(schema.workflowProcessingScopes.runId, runId)).get()
    if (!prior && tx.select().from(schema.workflowSelections).where(eq(schema.workflowSelections.runId, runId)).get()) throw new Error('Bind processing scope before the first selection')
    if (prior && (prior.scopeId !== scope.scopeId || prior.epoch !== scope.epoch)) throw new Error('Run processing scope is frozen')
    if (!prior) tx.insert(schema.workflowProcessingScopes).values({ runId, ...scope }).run()
  })
}

export function workflowProcessingScopeKey(db: PluginDatabase | WorkflowTransaction, runId: string, stepId: string): string {
  let run = db.select().from(schema.workflowRuns).where(eq(schema.workflowRuns.id, runId)).get()
  const step = db.select().from(schema.workflowSteps).where(eq(schema.workflowSteps.id, stepId)).get()
  if (!run || !step || step.runId !== run.id) throw new Error('Selection step does not belong to its run')
  const path: unknown[] = [stepIdentity((JSON.parse(run.defJson) as WorkflowDef).steps[step.idx])]
  while (run.parentRunId) {
    const dispatch = db.select().from(schema.workflowDispatches).where(eq(schema.workflowDispatches.runId, run.id)).get()
    const parent = db.select().from(schema.workflowRuns).where(eq(schema.workflowRuns.id, run.parentRunId)).get()
    const caller = dispatch && db.select().from(schema.workflowSteps).where(eq(schema.workflowSteps.id, dispatch.parentStepId)).get()
    if (!dispatch || !parent || !caller) throw new Error('Processing lineage is incomplete')
    path.unshift([stepIdentity((JSON.parse(parent.defJson) as WorkflowDef).steps[caller.idx]), dispatch.itemKey])
    run = parent
  }
  const scope = db.select().from(schema.workflowProcessingScopes).where(eq(schema.workflowProcessingScopes.runId, run.id)).get()
  return JSON.stringify([scope?.scopeId ?? `manual:${run.id}`, scope?.epoch ?? '1', path])
}

/** Selection, business decisions, reserved child IDs, and checkpoint share this transaction. */
export class WorkflowProcessingStore {
  constructor(private readonly db: PluginDatabase, private readonly dispatcher: Pick<WorkflowDispatcher, 'reserveMany' | 'reserveReprocess' | 'resumeMany'>) {}

  reserve(request: WorkflowSelectionRequest) {
    return this.db.transaction(tx => this.reserveSelection(tx, request))
  }

  /** Reserve a related attempt from immutable retained rows. The request supplies identity only. */
  reserveReprocess(request: { sourceRunId: string; recordId: string; digest: string; requestId: string }) {
    return this.db.transaction(tx => {
      if (!request.requestId.trim()) throw new Error('A reprocess request identity is required')
      const callerKey = `reprocess:${request.requestId}`
      const existing = tx.select().from(schema.workflowDispatches).where(eq(schema.workflowDispatches.callerKey, callerKey)).get()
      if (existing) {
        const payload = JSON.parse(existing.payloadJson) as { reprocessSource?: { runId: string; recordId: string; digest: string } }
        const source = payload.reprocessSource
        if (!source || source.runId !== request.sourceRunId || source.recordId !== request.recordId || source.digest !== request.digest) {
          throw new Error('Reprocess request identity was reused with different content')
        }
        const attempt = tx.select().from(schema.workflowRecordAttempts).where(eq(schema.workflowRecordAttempts.dispatchId, existing.id)).get()
        if (!attempt) throw new Error('Reserved reprocess attempt is incomplete')
        return { selectionId: attempt.selectionId, dispatches: [existing] }
      }
      const prepared = resolveWorkflowReprocess(tx, request.sourceRunId, request.recordId, request.digest)
      const dispatch = this.dispatcher.reserveReprocess({
        callerKey,
        sourceRunId: request.sourceRunId,
        sourceStepId: prepared.stepId,
        sourceRecordId: request.recordId,
        sourceDigest: request.digest,
        parentTaskId: prepared.payload.parentTaskId,
        itemKey: prepared.recordKey,
        task: prepared.payload.task,
        workflow: prepared.payload.workflow,
        inputs: prepared.payload.inputs,
        resolvedGraph: prepared.payload.resolvedGraph,
        effectiveTools: prepared.payload.effectiveTools ?? prepared.payload.workflow.tools ?? {},
        effectiveBudget: prepared.payload.effectiveBudget ?? prepared.payload.workflow.budget ?? {},
        requiresRepoTrust: prepared.payload.requiresRepoTrust ?? prepared.payload.resolvedGraph?.requiresRepoTrust ?? false,
      }, tx)
      const attemptId = randomUUID()
      tx.insert(schema.workflowRecordAttempts).values({
        id: attemptId,
        stateId: prepared.stateId,
        selectionId: prepared.selectionId,
        dispatchId: dispatch.id,
        previousAttemptId: prepared.previousAttemptId,
        createdAt: Date.now(),
      }).run()
      tx.update(schema.workflowRecordStates).set({ attemptId, updatedAt: Date.now() })
        .where(eq(schema.workflowRecordStates.id, prepared.stateId)).run()
      tx.update(schema.workflowSelectedRecords).set({ attemptId })
        .where(eq(schema.workflowSelectedRecords.id, request.recordId)).run()
      return { selectionId: prepared.selectionId, dispatches: [dispatch] }
    })
  }

  async reprocess(request: { sourceRunId: string; recordId: string; digest: string; requestId: string }, signal?: AbortSignal) {
    const reserved = this.reserveReprocess(request)
    const [attempt] = await this.dispatcher.resumeMany(reserved.dispatches, signal)
    if (!attempt) throw new Error('Reprocess reservation did not return an attempt')
    return { selectionId: reserved.selectionId, ...attempt }
  }

  private reserveSelection(tx: WorkflowTransaction, request: WorkflowSelectionRequest, retainedScopeKey?: string) {
    const fields = processingFields(request.policy)
    const fingerprint = workflowContentFingerprint(request)
    if (new Set(request.records.map(record => record.key)).size !== request.records.length) throw new Error('Selection has duplicate record identities')
    if (request.records.length > DATA_LIMITS.selectionRecords) throw new Error('Selection exceeds the record limit')
    parseDataValue(request.records.map(record => record.snapshot), DATA_LIMITS.selectionBytes)
    const previous = tx.select().from(schema.workflowSelections).where(eq(schema.workflowSelections.invocationKey, request.invocationKey)).get()
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new Error('Selection invocation key was reused with different content')
      return { selectionId: previous.id, dispatches: this.dispatches(tx, previous.id) }
    }
    const scopeKey = retainedScopeKey ?? workflowProcessingScopeKey(tx, request.runId, request.stepId)
    const selectedRun = tx.select().from(schema.workflowRuns).where(eq(schema.workflowRuns.id, request.runId)).get()
    const root = selectedRun
      ? tx.select().from(schema.workflowRuns).where(eq(schema.workflowRuns.id, selectedRun.rootRunId ?? selectedRun.id)).get()
      : undefined
    const runScope = root ? tx.select().from(schema.workflowProcessingScopes).where(eq(schema.workflowProcessingScopes.runId, root.id)).get() : undefined
    // A scheduled baseline is frozen on the root run. The data step may still request a baseline for
    // the existing manual/reprocess path, but it cannot turn a scheduled baseline back into work.
    const baseline = runScope?.baseline === true || request.baseline === true
    const boundary = tx.select().from(schema.workflowProcessingBoundaries).where(eq(schema.workflowProcessingBoundaries.scopeKey, scopeKey)).get()
    if (request.checkpoint) {
      if (boundary && boundary.queryFingerprint !== request.checkpoint.queryFingerprint && !baseline) throw new Error('Incremental query changed. Choose a fresh baseline or epoch.')
      const expected = request.checkpoint.previousBoundary
      if ((boundary?.boundaryJson ?? null) !== (expected === undefined ? null : canonicalDataEncoding(expected))) throw new Error('Incremental boundary changed during selection')
    }
    const id = randomUUID()
    const at = Date.now()
    tx.insert(schema.workflowSelections).values({ id, invocationKey: request.invocationKey, fingerprint, runId: request.runId,
      stepId: request.stepId, scopeKey, snapshotJson: JSON.stringify(request.provenance ?? null), createdAt: at }).run()
    const eligible: { record: WorkflowSelectionRequest['records'][number]; stateId: string; selectedId: string }[] = []
    for (const [position, record] of request.records.entries()) {
      if (record.dispatch.parentRunId !== request.runId || record.dispatch.parentStepId !== request.stepId) throw new Error('Record dispatch belongs to another selection')
      const state = tx.select().from(schema.workflowRecordStates).where(and(eq(schema.workflowRecordStates.scopeKey, scopeKey), eq(schema.workflowRecordStates.recordKey, record.key))).get()
      const active = processingAttemptActive(tx, state?.attemptId ?? null)
      if (active && (record.previousAttemptId || baseline)) throw new Error('Record attempt is still active')
      if (active && request.checkpoint && state) {
        const comparedFields = fields.length ? fields : ['']
        if (processingProjection(record.snapshot, comparedFields) !== processingProjection(JSON.parse(state.snapshotJson), comparedFields)) throw new Error('An active record has undispatched changes. Retry the check after it settles.')
      }
      if (record.previousAttemptId && record.previousAttemptId !== state?.attemptId) throw new Error('Reprocess must reference the latest attempt in this scope')
      const decision = processingDecision({ policy: request.policy, snapshot: record.snapshot, active, baseline,
        reprocess: !!record.previousAttemptId, previous: state ? { snapshot: JSON.parse(state.snapshotJson), fields: JSON.parse(state.fieldsJson), projection: state.projection } : undefined })
      const stateId = state?.id ?? randomUUID()
      const selectedId = randomUUID()
      tx.insert(schema.workflowSelectedRecords).values({ id: selectedId, selectionId: id, position, recordKey: record.key,
        snapshotJson: JSON.stringify(record.snapshot), decision, attemptId: state?.attemptId ?? null }).run()
      if (state && decision === 'unchanged') tx.update(schema.workflowRecordStates).set({ fieldsJson: JSON.stringify(fields),
        projection: processingProjection(JSON.parse(state.snapshotJson), fields) }).where(eq(schema.workflowRecordStates.id, state.id)).run()
      if (decision === 'admitted' || decision === 'baseline') {
        const values = { id: stateId, scopeKey, recordKey: record.key, snapshotJson: JSON.stringify(record.snapshot),
          fieldsJson: JSON.stringify(fields), projection: processingProjection(record.snapshot, fields), attemptId: state?.attemptId ?? null, updatedAt: at }
        tx.insert(schema.workflowRecordStates).values(values).onConflictDoUpdate({ target: schema.workflowRecordStates.id, set: values }).run()
        if (decision === 'admitted') eligible.push({ record, stateId, selectedId })
      }
    }
    const dispatches = this.dispatcher.reserveMany(eligible.map(entry => entry.record.dispatch), tx)
    for (const [index, dispatch] of dispatches.entries()) {
      const entry = eligible[index]
      const attemptId = randomUUID()
      tx.insert(schema.workflowRecordAttempts).values({ id: attemptId, stateId: entry.stateId, selectionId: id, dispatchId: dispatch.id,
        previousAttemptId: entry.record.previousAttemptId ?? null, createdAt: at }).run()
      tx.update(schema.workflowRecordStates).set({ attemptId }).where(eq(schema.workflowRecordStates.id, entry.stateId)).run()
      tx.update(schema.workflowSelectedRecords).set({ attemptId }).where(eq(schema.workflowSelectedRecords.id, entry.selectedId)).run()
    }
    if (request.checkpoint) {
      const values = { scopeKey, queryFingerprint: request.checkpoint.queryFingerprint, boundaryJson: canonicalDataEncoding(request.checkpoint.boundary), selectionId: id, updatedAt: at }
      tx.insert(schema.workflowProcessingBoundaries).values(values).onConflictDoUpdate({ target: schema.workflowProcessingBoundaries.scopeKey, set: values }).run()
    }
    return { selectionId: id, dispatches }
  }

  async dispatch(request: WorkflowSelectionRequest, signal?: AbortSignal) {
    const reserved = this.reserve(request)
    return { selectionId: reserved.selectionId, children: await this.dispatcher.resumeMany(reserved.dispatches, signal) }
  }

  private dispatches(tx: WorkflowTransaction, selectionId: string) {
    const attempts = tx.select().from(schema.workflowRecordAttempts).where(eq(schema.workflowRecordAttempts.selectionId, selectionId)).all()
    const selected = tx.select().from(schema.workflowSelectedRecords).where(eq(schema.workflowSelectedRecords.selectionId, selectionId)).orderBy(asc(schema.workflowSelectedRecords.position)).all()
    return selected.flatMap(row => {
      const attempt = attempts.find(attempt => attempt.id === row.attemptId)
      return attempt ? [tx.select().from(schema.workflowDispatches).where(eq(schema.workflowDispatches.id, attempt.dispatchId)).get()!] : []
    })
  }
}
