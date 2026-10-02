import { getProfile, resolveCommand, type PluginDatabase } from '@acorn/plugin-api/node'
import { desc, eq, inArray, isNotNull, or, sql, sum } from 'drizzle-orm'
import type { WorkflowRunner } from '../runner'
import type { WorkflowStepProjection } from '../../../shared/api'
import { RUN_LIST_LIMIT, TERMINAL_WORKFLOW_STATUSES, toRunStatus } from '../../../shared/runStatus'
import { workflowDispatches, workflowRuns, workflowTurnAdmissions } from '../../../node/schema'

/** Projects workflow rows into the Node-wide run list without double-counting child usage. */
export async function workflowRunList(db: PluginDatabase) {
  const rows = await db.select({
    id: workflowRuns.id, name: workflowRuns.name, status: workflowRuns.status,
    createdAt: workflowRuns.createdAt, updatedAt: workflowRuns.updatedAt,
    taskId: workflowRuns.taskId, depth: workflowRuns.depth, rootRunId: workflowRuns.rootRunId,
    error: workflowRuns.error,
  }).from(workflowRuns).orderBy(desc(workflowRuns.createdAt), sql`${workflowRuns}.rowid`).limit(RUN_LIST_LIMIT)
  const treeCostRows = rows.length
    ? await db
      .select({ id: workflowTurnAdmissions.rootRunId, costUsd: sum(workflowTurnAdmissions.costUsd) })
      .from(workflowTurnAdmissions)
      .where(inArray(workflowTurnAdmissions.rootRunId, rows.map((row) => row.rootRunId ?? row.id)))
      .groupBy(workflowTurnAdmissions.rootRunId)
    : []
  const runCostRows = rows.length
    ? await db
      .select({ id: workflowTurnAdmissions.runId, costUsd: sum(workflowTurnAdmissions.costUsd) })
      .from(workflowTurnAdmissions)
      .where(inArray(workflowTurnAdmissions.runId, rows.map((row) => row.id)))
      .groupBy(workflowTurnAdmissions.runId)
    : []
  const treeCosts = new Map(treeCostRows.map((row) => [row.id, Number(row.costUsd ?? 0)]))
  const runCosts = new Map(runCostRows.map((row) => [row.id, Number(row.costUsd ?? 0)]))
  return {
    runs: rows.map((row) => ({
      id: row.id,
      title: row.name,
      status: toRunStatus(row.status),
      startedAt: row.createdAt,
      endedAt: TERMINAL_WORKFLOW_STATUSES.has(row.status) ? row.updatedAt : null,
      taskId: row.taskId,
      costUsd: row.depth === 0
        ? treeCosts.get(row.id) ?? null
        : runCosts.get(row.id) ?? null,
      ...(row.error ? { detail: row.error.slice(0, 200) } : {}),
    })),
  }
}

/** Compact task-rail aggregate. Task visibility still comes from core; this only describes runs. */
export async function workflowTaskNavigation(db: PluginDatabase) {
  const children = await db.select({
    id: workflowRuns.id, taskId: workflowRuns.taskId, status: workflowRuns.status,
    parentRunId: workflowRuns.parentRunId, rootRunId: workflowRuns.rootRunId, trigger: workflowRuns.trigger,
  }).from(workflowRuns)
    .where(or(isNotNull(workflowRuns.parentRunId), eq(workflowRuns.trigger, 'reprocess')))
    // Keep the full-scan insertion order for timestamp ties explicit as projections evolve.
    .orderBy(desc(workflowRuns.updatedAt), sql`${workflowRuns}.rowid`)
  const latestByTask = new Map<string, typeof children[number]>()
  for (const run of children) if (!latestByTask.has(run.taskId)) latestByTask.set(run.taskId, run)
  const reprocessRuns = [...latestByTask.values()].filter(run => run.trigger === 'reprocess' && !run.parentRunId)
  const reprocessDispatches = reprocessRuns.length
    ? await db.select({ runId: workflowDispatches.runId, parentRunId: workflowDispatches.parentRunId })
      .from(workflowDispatches).where(inArray(workflowDispatches.runId, reprocessRuns.map(run => run.id)))
    : []
  const sourceRunIds = reprocessDispatches.map(dispatch => dispatch.parentRunId)
  const sourceRuns = sourceRunIds.length
    ? await db.select({ id: workflowRuns.id, rootRunId: workflowRuns.rootRunId })
      .from(workflowRuns).where(inArray(workflowRuns.id, sourceRunIds))
    : []
  const sourceById = new Map(sourceRuns.map(run => [run.id, run]))
  const sourceRootByReprocess = new Map(reprocessDispatches.flatMap(dispatch => {
    const source = sourceById.get(dispatch.parentRunId)
    return source ? [[dispatch.runId, source.rootRunId ?? source.id] as const] : []
  }))
  const ownerRunId = (run: typeof children[number]) => sourceRootByReprocess.get(run.id) ?? run.rootRunId
  const rootIds = [...new Set([...latestByTask.values()].map(ownerRunId).filter((id): id is string => !!id))]
  const roots = rootIds.length ? await db.select({ id: workflowRuns.id, taskId: workflowRuns.taskId })
    .from(workflowRuns).where(inArray(workflowRuns.id, rootIds)) : []
  const rootTaskByRun = new Map(roots.map(run => [run.id, run.taskId]))
  const groups = new Map<string, { rootTaskId: string; descendants: number; running: number; attention: number }>()
  for (const run of latestByTask.values()) {
    const root = ownerRunId(run)
    const rootTaskId = root ? rootTaskByRun.get(root) : undefined
    if (!rootTaskId) continue
    const group = groups.get(rootTaskId) ?? { rootTaskId, descendants: 0, running: 0, attention: 0 }
    group.descendants += 1
    if (run.status === 'running' || run.status === 'cancelling') group.running += 1
    if (run.status === 'gated' || run.status === 'failed' || run.status === 'safety-rail' || run.status === 'completed-with-failures') group.attention += 1
    groups.set(rootTaskId, group)
  }
  return { groups: [...groups.values()] }
}

/** Adds child relationships and a safe resume command to persisted step rows. */
export async function workflowStepProjections(
  runner: WorkflowRunner,
  runId: string,
): Promise<WorkflowStepProjection[]> {
  return Promise.all((await runner.steps(runId)).map(async (step): Promise<WorkflowStepProjection> => {
    // Record loops have their own paged projection. Putting up to 500 child summaries on every step
    // refresh made the supposedly compact run read eagerly load the entire batch.
    const children = step.kind === 'workflow-map' ? [] : await runner.childRuns(step.id)
    const projected = { ...step, status: step.status as WorkflowStepProjection['status'], children }
    if (!step.sessionId || !step.profileId || /[^A-Za-z0-9_-]/.test(step.sessionId)) return projected
    const profile = getProfile(step.profileId)
    if (profile.id !== step.profileId) return { ...projected, resumeCommand: null }
    const resume = profile.resumeArgv?.(resolveCommand(profile), step.sessionId)
    return { ...projected, resumeCommand: resume ? [resume.file, ...resume.args].join(' ') : null }
  }))
}
