import { getProfile, resolveCommand, type PluginDatabase } from '@acorn/plugin-api/node'
import { desc, inArray, sum } from 'drizzle-orm'
import type { WorkflowRunner } from './workflowRunner'
import type { WorkflowStepProjection } from '../shared/api'
import { RUN_LIST_LIMIT, TERMINAL_WORKFLOW_STATUSES, toRunStatus } from '../shared/runStatus'
import { workflowRuns, workflowSteps, workflowTurnAdmissions } from '../node/schema'

/** Projects workflow rows into the Node-wide run list without double-counting child usage. */
export async function workflowRunList(db: PluginDatabase) {
  const rows = await db.select().from(workflowRuns).orderBy(desc(workflowRuns.createdAt)).limit(RUN_LIST_LIMIT)
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
  const legacyCostRows = rows.length
    ? await db
      .select({ id: workflowSteps.runId, costUsd: sum(workflowSteps.costUsd) })
      .from(workflowSteps)
      .where(inArray(workflowSteps.runId, rows.map((row) => row.id)))
      .groupBy(workflowSteps.runId)
    : []
  const treeCosts = new Map(treeCostRows.map((row) => [row.id, Number(row.costUsd ?? 0)]))
  const runCosts = new Map(runCostRows.map((row) => [row.id, Number(row.costUsd ?? 0)]))
  const legacyCosts = new Map(legacyCostRows.map((row) => [row.id, Number(row.costUsd ?? 0)]))
  return {
    runs: rows.map((row) => ({
      id: row.id,
      title: row.name,
      status: toRunStatus(row.status),
      startedAt: row.createdAt,
      endedAt: TERMINAL_WORKFLOW_STATUSES.has(row.status) ? row.updatedAt : null,
      taskId: row.taskId,
      costUsd: row.depth === 0
        ? treeCosts.get(row.id) ?? legacyCosts.get(row.id) ?? null
        : runCosts.get(row.id) ?? legacyCosts.get(row.id) ?? null,
      ...(row.error ? { detail: row.error.slice(0, 200) } : {}),
    })),
  }
}

/** Adds child relationships and a safe resume command to persisted step rows. */
export async function workflowStepProjections(
  runner: WorkflowRunner,
  runId: string,
): Promise<WorkflowStepProjection[]> {
  return Promise.all((await runner.steps(runId)).map(async (step): Promise<WorkflowStepProjection> => {
    const children = await runner.childRuns(step.id)
    const projected = { ...step, status: step.status as WorkflowStepProjection['status'], children }
    if (!step.sessionId || !step.profileId || /[^A-Za-z0-9_-]/.test(step.sessionId)) return projected
    const profile = getProfile(step.profileId)
    if (profile.id !== step.profileId) return { ...projected, resumeCommand: null }
    const resume = profile.resumeArgv?.(resolveCommand(profile), step.sessionId)
    return { ...projected, resumeCommand: resume ? [resume.file, ...resume.args].join(' ') : null }
  }))
}
