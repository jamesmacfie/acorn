import { Buffer } from 'node:buffer'
import { and, asc, desc, eq, gt, inArray, or, sql } from 'drizzle-orm'
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
// A byte prefix preserves embedded NULs. Four UTF-8 bytes per preview character leave enough
// decoded UTF-16 units for bounded(), including its length check and surrogate-pair slicing.
const resultPrefix = (column: typeof schema.workflowSteps.structuredJson | typeof schema.workflowSteps.resultJson) =>
  sql<Uint8Array | null>`case when ${column} = '' then cast('' as blob) else substr(cast(${column} as blob), 1, ${RESULT_CHARS * 4}) end`
type HistoryDispatch = Pick<typeof schema.workflowDispatches.$inferSelect, 'taskMode' | 'payloadJson' | 'taskId' | 'runId' | 'state' | 'error'>
type HistoryRun = Pick<typeof schema.workflowRuns.$inferSelect, 'id' | 'status' | 'error'>
type HistoryStep = Pick<typeof schema.workflowSteps.$inferSelect, 'agentSessionId' | 'id' | 'runId' | 'status' | 'parentStepId' | 'structuredJson' | 'resultJson'>

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

const runResult = (steps: readonly HistoryStep[]): string | null => {
  const row = [...steps].reverse().find(step => !step.parentStepId && (step.structuredJson || step.resultJson))
  return bounded(row?.structuredJson ?? row?.resultJson, RESULT_CHARS)
}

const retryStep = (steps: readonly HistoryStep[]): string | null =>
  steps.find(step => step.status === 'failed' || step.status === 'safety-rail')?.id ?? null

const recordHistory = (
  row: typeof schema.workflowSelectedRecords.$inferSelect,
  dispatch: HistoryDispatch | undefined,
  run: HistoryRun | undefined,
  steps: readonly HistoryStep[],
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
    status: dispatch?.taskMode === 'parent' && status === 'reserved' ? 'waiting' : status,
    ...(dispatch?.taskMode === 'parent' ? { taskMode: 'parent', agentSessionId: steps.find(step => step.agentSessionId)?.agentSessionId ?? null } : {}),
    reason: bounded(run?.error ?? dispatch?.error ?? (row.decision === 'seen' ? 'Previously processed' : row.decision === 'unchanged' ? 'Tracked fields are unchanged' : row.decision === 'active' ? running.has(status ?? '') ? 'A prior attempt is still active' : 'A prior attempt was active when this run checked it' : row.decision === 'baseline' ? 'Recorded by the initial baseline' : null)),
    result: runResult(steps),
    retryStepId: retryStep(steps),
    outputs: [],
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

const category = (row: Pick<WorkflowRecordHistory, 'decision' | 'status'>): Exclude<WorkflowRecordFilter, 'all'> | 'completed' => {
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
  const selection = db.select({
    id: schema.workflowSelections.id, stepId: schema.workflowSelections.stepId, snapshotJson: schema.workflowSelections.snapshotJson,
  }).from(schema.workflowSelections).where(and(eq(schema.workflowSelections.runId, runId),
    ...(selectionId ? [eq(schema.workflowSelections.id, selectionId)] : []),
    ...(stepId ? [eq(schema.workflowSelections.stepId, stepId)] : []))).orderBy(desc(schema.workflowSelections.createdAt)).get()
  if (!selection) return { selectionId: null, stepId: null, records: [], next: null, counts: emptyCounts(), emptyReason: 'no-matches', provenance: null }

  const selected = db.select({
    id: schema.workflowSelectedRecords.id, position: schema.workflowSelectedRecords.position,
    decision: schema.workflowSelectedRecords.decision, status: schema.workflowRuns.status,
    dispatchState: schema.workflowDispatches.state, taskMode: schema.workflowDispatches.taskMode,
  }).from(schema.workflowSelectedRecords)
    .leftJoin(schema.workflowRecordAttempts, eq(schema.workflowRecordAttempts.id, schema.workflowSelectedRecords.attemptId))
    .leftJoin(schema.workflowDispatches, eq(schema.workflowDispatches.id, schema.workflowRecordAttempts.dispatchId))
    .leftJoin(schema.workflowRuns, eq(schema.workflowRuns.id, schema.workflowDispatches.runId))
    .where(eq(schema.workflowSelectedRecords.selectionId, selection.id))
    .orderBy(asc(schema.workflowSelectedRecords.position)).all()
  const all = selected.map(row => ({ ...row,
    decision: row.decision as WorkflowRecordHistory['decision'],
    status: row.status ?? (row.dispatchState === 'terminal' ? 'cancelled' : row.dispatchState),
  }))
  const counts = all.reduce((total, row) => {
    const key = category(row)
    total.total += 1
    if (row.taskMode !== 'parent' || row.status !== 'reserved') total[key] += 1
    return total
  }, emptyCounts())
  const eligible = all.filter(row => row.position > after && (filter === 'all' || (!(row.taskMode === 'parent' && row.status === 'reserved') && category(row) === filter)))
  const count = Math.min(100, Math.max(1, limit))
  const pageIds = eligible.slice(0, count).map(row => row.id)
  const details = pageIds.length ? db.select({
    selected: schema.workflowSelectedRecords,
    dispatch: {
      taskMode: schema.workflowDispatches.taskMode, payloadJson: schema.workflowDispatches.payloadJson, taskId: schema.workflowDispatches.taskId,
      runId: schema.workflowDispatches.runId, state: schema.workflowDispatches.state, error: schema.workflowDispatches.error,
    },
    run: { id: schema.workflowRuns.id, status: schema.workflowRuns.status, error: schema.workflowRuns.error },
  }).from(schema.workflowSelectedRecords)
    .leftJoin(schema.workflowRecordAttempts, eq(schema.workflowRecordAttempts.id, schema.workflowSelectedRecords.attemptId))
    .leftJoin(schema.workflowDispatches, eq(schema.workflowDispatches.id, schema.workflowRecordAttempts.dispatchId))
    .leftJoin(schema.workflowRuns, eq(schema.workflowRuns.id, schema.workflowDispatches.runId))
    .where(inArray(schema.workflowSelectedRecords.id, pageIds))
    .orderBy(asc(schema.workflowSelectedRecords.position)).all() : []
  const pageRunIds = [...new Set(details.flatMap(row => row.run ? [row.run.id] : []))]
  const steps = pageRunIds.length ? db.select({
    id: schema.workflowSteps.id, runId: schema.workflowSteps.runId, status: schema.workflowSteps.status,
    agentSessionId: schema.workflowSteps.agentSessionId, parentStepId: schema.workflowSteps.parentStepId,
    structuredJson: resultPrefix(schema.workflowSteps.structuredJson), resultJson: resultPrefix(schema.workflowSteps.resultJson),
  }).from(schema.workflowSteps).where(inArray(schema.workflowSteps.runId, pageRunIds)).all() : []
  const stepsByRun = new Map<string, HistoryStep[]>()
  for (const step of steps) {
    const group = stepsByRun.get(step.runId) ?? []
    group.push({ ...step,
      structuredJson: step.structuredJson === null ? null : Buffer.from(step.structuredJson).toString('utf8'),
      resultJson: step.resultJson === null ? null : Buffer.from(step.resultJson).toString('utf8'),
    })
    stepsByRun.set(step.runId, group)
  }
  const records = details.map(row => recordHistory(row.selected, row.dispatch ?? undefined, row.run ?? undefined,
    row.run ? stepsByRun.get(row.run.id) ?? [] : []))
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
      ...(dispatch.taskMode === 'parent' ? { taskMode: 'parent', agentSessionId: runSteps.find(step => step.agentSessionId)?.agentSessionId ?? null } : {}),
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
    record: { ...recordHistory(selected, dispatch, run, steps), outputs: namedOutputs(run, steps) },
  }
}
