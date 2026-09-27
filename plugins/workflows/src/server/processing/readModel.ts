import { and, asc, desc, eq, gt, inArray, or } from 'drizzle-orm'
import type { PluginDatabase } from '@acorn/plugin-api/node'
import * as schema from '../../node/schema'
import type {
  WorkflowNamedOutput,
  WorkflowRecordAttempt,
  WorkflowRecordCounts,
  WorkflowRecordFilter,
  WorkflowRecordHistory,
  WorkflowRecordPage,
  WorkflowSelectionProvenance,
} from '../../shared/workflowProcessing'
import type { WorkflowTransaction } from '../dispatch/dispatcher'
import { workflowOutputs } from '../validation/values'
import type { WorkflowDef } from '../../shared/workflowContracts'

const terminal = new Set(['done', 'completed-with-failures', 'failed', 'safety-rail', 'cancelled'])
const failed = new Set(['completed-with-failures', 'failed', 'safety-rail', 'cancelled'])
const running = new Set(['reserved', 'task-created', 'run-started', 'running', 'cancelling'])
const OUTPUT_COUNT = 20
const OUTPUT_CHARS = 2_000
const SUMMARY_CHARS = 500
const RESULT_CHARS = 160

const bounded = (value: string | null | undefined, limit = SUMMARY_CHARS): string | null => {
  if (!value) return null
  return value.length <= limit ? value : `${value.slice(0, limit - 3)}...`
}

const parseObject = (raw: string | null | undefined): Record<string, unknown> | null => {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as unknown
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
  } catch { return null }
}

const namedOutputs = (
  run: typeof schema.workflowRuns.$inferSelect | undefined,
  steps: readonly (typeof schema.workflowSteps.$inferSelect)[],
): WorkflowNamedOutput[] => {
  if (!run) return []
  try {
    const values = workflowOutputs(JSON.parse(run.defJson) as WorkflowDef, steps)
    return Object.entries(values).slice(0, OUTPUT_COUNT).map(([name, value]) => {
      const raw = JSON.stringify(value)
      return { name: name.slice(0, 200), preview: bounded(raw, OUTPUT_CHARS) ?? 'null', truncated: raw.length > OUTPUT_CHARS }
    })
  } catch { return [] }
}

const runResult = (steps: readonly (typeof schema.workflowSteps.$inferSelect)[]): string | null => {
  const row = [...steps].reverse().find(step => !step.parentStepId && (step.structuredJson || step.resultJson))
  return bounded(row?.structuredJson ?? row?.resultJson, RESULT_CHARS)
}

const retryStep = (steps: readonly (typeof schema.workflowSteps.$inferSelect)[]): string | null =>
  steps.find(step => step.status === 'failed' || step.status === 'safety-rail')?.id ?? null

const recordHistory = (
  row: typeof schema.workflowSelectedRecords.$inferSelect,
  attempt: typeof schema.workflowRecordAttempts.$inferSelect | undefined,
  dispatch: typeof schema.workflowDispatches.$inferSelect | undefined,
  run: typeof schema.workflowRuns.$inferSelect | undefined,
  steps: readonly (typeof schema.workflowSteps.$inferSelect)[],
  detail = false,
): WorkflowRecordHistory => {
  const snapshot = parseObject(row.snapshotJson)
  const display = snapshot ? parseObject(JSON.stringify(snapshot.display)) : null
  const payload = dispatch ? parseObject(dispatch.payloadJson) : null
  const task = payload ? parseObject(JSON.stringify(payload.task)) : null
  const status = run?.status ?? (dispatch ? dispatch.state === 'terminal' ? 'cancelled' : dispatch.state : null)
  return {
    id: row.id,
    position: row.position,
    recordKey: row.recordKey,
    decision: row.decision as WorkflowRecordHistory['decision'],
    title: String(task?.title ?? display?.title ?? row.recordKey).slice(0, 500),
    attemptId: row.attemptId,
    taskId: dispatch?.taskId ?? null,
    runId: dispatch?.runId ?? null,
    status,
    reason: bounded(run?.error ?? dispatch?.error ?? (row.decision === 'seen' ? 'Previously processed' : row.decision === 'unchanged' ? 'Tracked fields are unchanged' : row.decision === 'active' ? running.has(status ?? '') ? 'A prior attempt is still active' : 'A prior attempt was active when this run checked it' : row.decision === 'baseline' ? 'Recorded by the initial baseline' : null)),
    result: runResult(steps),
    retryStepId: retryStep(steps),
    outputs: detail ? namedOutputs(run, steps) : [],
  }
}

const provenance = (raw: string): WorkflowSelectionProvenance | null => {
  const value = parseObject(raw)
  if (!value) return null
  const query = parseObject(JSON.stringify(value.query))
  const source = parseObject(JSON.stringify(value.source ?? query?.source))
  const scope = parseObject(JSON.stringify(query?.scope))
  const published = parseObject(JSON.stringify(value.savedQuery ?? value.published))
  const completeness = parseObject(JSON.stringify(value.completeness))
  const sourceValue = source && typeof source.pluginId === 'string' && typeof source.sourceId === 'string'
    ? { pluginId: source.pluginId, sourceId: source.sourceId }
    : null
  const kind = completeness && ['complete', 'bounded', 'more', 'incomplete'].includes(String(completeness.kind))
    ? String(completeness.kind) as 'complete' | 'bounded' | 'more' | 'incomplete'
    : null
  return {
    source: sourceValue,
    connectionId: typeof value.connectionId === 'string' ? value.connectionId : typeof scope?.connectionId === 'string' ? scope.connectionId : null,
    sourceRevision: typeof value.sourceRevision === 'string' ? value.sourceRevision : null,
    savedQuery: published && typeof (published.id ?? published.queryId) === 'string' && Number.isInteger(published.revision)
      ? { id: String(published.id ?? published.queryId), revision: Number(published.revision) }
      : null,
    evaluationTime: typeof value.evaluationTime === 'number' ? value.evaluationTime : null,
    readTime: typeof value.readTime === 'number' ? value.readTime : null,
    completeness: kind ? { kind, ...(typeof completeness?.cause === 'string' ? { cause: completeness.cause } : {}) } : null,
  }
}

export function processingAttemptActive(db: PluginDatabase | WorkflowTransaction, attemptId: string | null): boolean {
  if (!attemptId) return false
  const attempt = db.select().from(schema.workflowRecordAttempts).where(eq(schema.workflowRecordAttempts.id, attemptId)).get()
  if (!attempt) throw new Error('Processing attempt is missing')
  const dispatch = db.select().from(schema.workflowDispatches).where(eq(schema.workflowDispatches.id, attempt.dispatchId)).get()
  if (!dispatch) throw new Error('Processing dispatch is missing')
  const run = db.select().from(schema.workflowRuns).where(eq(schema.workflowRuns.id, dispatch.runId)).get()
  return run ? !terminal.has(run.status) : dispatch.state !== 'terminal'
}

const category = (row: WorkflowRecordHistory): Exclude<WorkflowRecordFilter, 'all'> | 'completed' => {
  if (row.decision !== 'admitted') return row.decision === 'active' && running.has(row.status ?? '') ? 'running' : 'skipped'
  if (running.has(row.status ?? '')) return 'running'
  if (row.status === 'gated') return 'attention'
  if (row.status && failed.has(row.status)) return 'failed'
  return 'completed'
}

const emptyCounts = (): WorkflowRecordCounts => ({ total: 0, running: 0, attention: 0, failed: 0, skipped: 0, completed: 0 })

export function workflowSelectionPage(
  db: PluginDatabase,
  runId: string,
  selectionId?: string,
  after = -1,
  limit = 100,
  stepId?: string,
  filter: WorkflowRecordFilter = 'all',
): WorkflowRecordPage {
  const selection = db.select().from(schema.workflowSelections).where(and(eq(schema.workflowSelections.runId, runId),
    ...(selectionId ? [eq(schema.workflowSelections.id, selectionId)] : []),
    ...(stepId ? [eq(schema.workflowSelections.stepId, stepId)] : []))).orderBy(desc(schema.workflowSelections.createdAt)).get()
  if (!selection) return { selectionId: null, stepId: null, records: [], next: null, counts: emptyCounts(), emptyReason: 'no-matches', provenance: null }

  const selected = db.select().from(schema.workflowSelectedRecords)
    .where(eq(schema.workflowSelectedRecords.selectionId, selection.id))
    .orderBy(asc(schema.workflowSelectedRecords.position)).all()
  const attemptIds = selected.flatMap(row => row.attemptId ? [row.attemptId] : [])
  const attempts = attemptIds.length ? db.select().from(schema.workflowRecordAttempts).where(inArray(schema.workflowRecordAttempts.id, attemptIds)).all() : []
  const dispatchIds = attempts.map(attempt => attempt.dispatchId)
  const dispatches = dispatchIds.length ? db.select().from(schema.workflowDispatches).where(inArray(schema.workflowDispatches.id, dispatchIds)).all() : []
  const runIds = dispatches.map(dispatch => dispatch.runId)
  const runs = runIds.length ? db.select().from(schema.workflowRuns).where(inArray(schema.workflowRuns.id, runIds)).all() : []
  const steps = runIds.length ? db.select().from(schema.workflowSteps).where(inArray(schema.workflowSteps.runId, runIds)).all() : []
  const attemptById = new Map(attempts.map(row => [row.id, row]))
  const dispatchById = new Map(dispatches.map(row => [row.id, row]))
  const runById = new Map(runs.map(row => [row.id, row]))

  const all = selected.map((row): WorkflowRecordHistory => {
    const attempt = row.attemptId ? attemptById.get(row.attemptId) : undefined
    const dispatch = attempt ? dispatchById.get(attempt.dispatchId) : undefined
    const run = dispatch ? runById.get(dispatch.runId) : undefined
    const runSteps = run ? steps.filter(step => step.runId === run.id) : []
    return recordHistory(row, attempt, dispatch, run, runSteps)
  })
  const counts = all.reduce((total, row) => {
    const key = category(row)
    total.total += 1
    total[key] += 1
    return total
  }, emptyCounts())
  const eligible = all.filter(row => row.position > after && (filter === 'all' || category(row) === filter))
  const count = Math.min(100, Math.max(1, limit))
  const records = eligible.slice(0, count)
  return {
    selectionId: selection.id,
    stepId: selection.stepId,
    records,
    next: eligible.length > count ? records.at(-1)!.position : null,
    counts,
    emptyReason: counts.total === 0 ? 'no-matches' : counts.total === counts.skipped ? 'all-skipped' : null,
    provenance: provenance(selection.snapshotJson),
  }
}

/** The caller must authorize the selected row's run before reading its retained automation history. */
export function workflowRecordAttemptPage(db: PluginDatabase, runId: string, recordRowId: string, after = '', limit = 100): { attempts: WorkflowRecordAttempt[]; next: string | null } {
  const selected = db.select().from(schema.workflowSelectedRecords).where(eq(schema.workflowSelectedRecords.id, recordRowId)).get()
  const selection = selected && db.select().from(schema.workflowSelections).where(and(eq(schema.workflowSelections.id, selected.selectionId), eq(schema.workflowSelections.runId, runId))).get()
  if (!selected || !selection) return { attempts: [], next: null }
  const state = db.select().from(schema.workflowRecordStates).where(and(eq(schema.workflowRecordStates.scopeKey, selection.scopeKey), eq(schema.workflowRecordStates.recordKey, selected.recordKey))).get()
  if (!state) return { attempts: [], next: null }
  const count = Math.min(100, Math.max(1, limit))
  const cursor = after ? JSON.parse(after) as { at: number; id: string } : undefined
  if (cursor && (!Number.isFinite(cursor.at) || typeof cursor.id !== 'string')) throw new Error('Invalid history cursor')
  const rows = db.select().from(schema.workflowRecordAttempts).where(and(eq(schema.workflowRecordAttempts.stateId, state.id),
    ...(cursor ? [or(gt(schema.workflowRecordAttempts.createdAt, cursor.at), and(eq(schema.workflowRecordAttempts.createdAt, cursor.at), gt(schema.workflowRecordAttempts.id, cursor.id)))] : [])))
    .orderBy(asc(schema.workflowRecordAttempts.createdAt), asc(schema.workflowRecordAttempts.id)).limit(count + 1).all()
  const dispatches = rows.length ? db.select().from(schema.workflowDispatches).where(inArray(schema.workflowDispatches.id, rows.map(row => row.dispatchId))).all() : []
  const runs = dispatches.length ? db.select().from(schema.workflowRuns).where(inArray(schema.workflowRuns.id, dispatches.map(row => row.runId))).all() : []
  const steps = runs.length ? db.select().from(schema.workflowSteps).where(inArray(schema.workflowSteps.runId, runs.map(row => row.id))).all() : []
  const attempts = rows.slice(0, count).map((attempt): WorkflowRecordAttempt => {
    const dispatch = dispatches.find(row => row.id === attempt.dispatchId)!
    const run = runs.find(row => row.id === dispatch.runId)
    const runSteps = run ? steps.filter(step => step.runId === run.id) : []
    return {
      id: attempt.id,
      previousAttemptId: attempt.previousAttemptId,
      createdAt: attempt.createdAt,
      taskId: dispatch.taskId,
      runId: dispatch.runId,
      status: run?.status ?? (dispatch.state === 'terminal' ? 'cancelled' : dispatch.state),
      error: bounded(run?.error ?? dispatch.error),
      retryStepId: retryStep(runSteps),
      result: runResult(runSteps),
      outputs: namedOutputs(run, runSteps),
    }
  })
  return { attempts, next: rows.length > count ? JSON.stringify({ at: attempts.at(-1)!.createdAt, id: attempts.at(-1)!.id }) : null }
}

export function workflowRecordSnapshot(db: PluginDatabase, runId: string, recordRowId: string) {
  const selected = db.select().from(schema.workflowSelectedRecords).where(eq(schema.workflowSelectedRecords.id, recordRowId)).get()
  if (!selected) return null
  const selection = db.select().from(schema.workflowSelections).where(and(eq(schema.workflowSelections.id, selected.selectionId), eq(schema.workflowSelections.runId, runId))).get()
  if (!selection) return null
  const attempt = selected.attemptId
    ? db.select().from(schema.workflowRecordAttempts).where(eq(schema.workflowRecordAttempts.id, selected.attemptId)).get()
    : undefined
  const dispatch = attempt
    ? db.select().from(schema.workflowDispatches).where(eq(schema.workflowDispatches.id, attempt.dispatchId)).get()
    : undefined
  const run = dispatch
    ? db.select().from(schema.workflowRuns).where(eq(schema.workflowRuns.id, dispatch.runId)).get()
    : undefined
  const steps = run
    ? db.select().from(schema.workflowSteps).where(eq(schema.workflowSteps.runId, run.id)).all()
    : []
  return {
    snapshot: JSON.parse(selected.snapshotJson),
    provenance: provenance(selection.snapshotJson),
    record: recordHistory(selected, attempt, dispatch, run, steps, true),
  }
}
