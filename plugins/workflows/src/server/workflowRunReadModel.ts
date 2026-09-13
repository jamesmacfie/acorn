import { eq, inArray } from 'drizzle-orm'
import type { PluginDatabase } from '@acorn/plugin-api/node'
import * as schema from '../node/schema'
import type { WorkflowRunProjection, WorkflowUsageSummary } from '../shared/api'

type Admission = typeof schema.workflowTurnAdmissions.$inferSelect

const usageSummary = (rows: readonly Admission[]): WorkflowUsageSummary | null => {
  if (!rows.length) return null
  return rows.reduce<WorkflowUsageSummary>((total, row) => ({
    costUsd: total.costUsd + row.costUsd,
    inputTokens: total.inputTokens + row.inputTokens,
    outputTokens: total.outputTokens + row.outputTokens,
    turns: total.turns + 1,
  }), { costUsd: 0, inputTokens: 0, outputTokens: 0, turns: 0 })
}

/** Reads one run's own provider turns for child cards and child-run footers. */
export async function workflowRunUsage(db: PluginDatabase, runId: string): Promise<WorkflowUsageSummary | null> {
  return usageSummary(await db.select().from(schema.workflowTurnAdmissions)
    .where(eq(schema.workflowTurnAdmissions.runId, runId)))
}

/** Builds the task-scoped run read model, including explicit lineage and tree usage. */
export async function workflowRunsForTask(db: PluginDatabase, taskId: string): Promise<WorkflowRunProjection[]> {
  const rows = (await db.select().from(schema.workflowRuns).where(eq(schema.workflowRuns.taskId, taskId)))
    .sort((left, right) => right.createdAt - left.createdAt)
  if (!rows.length) return []

  const lineageIds = [...new Set(rows.flatMap((row) => [row.rootRunId, row.parentRunId]).filter((id): id is string => !!id))]
  const lineage = lineageIds.length
    ? await db.select().from(schema.workflowRuns).where(inArray(schema.workflowRuns.id, lineageIds))
    : []
  const runById = new Map([...rows, ...lineage].map((row) => [row.id, row]))
  const rootIds = [...new Set(rows.map((row) => row.rootRunId ?? row.id))]
  const admissions = await db.select().from(schema.workflowTurnAdmissions)
    .where(inArray(schema.workflowTurnAdmissions.rootRunId, rootIds))

  return rows.map((row): WorkflowRunProjection => {
    const {
      resolvedGraphJson: _resolvedGraphJson,
      effectiveToolsJson: _effectiveToolsJson,
      effectiveBudgetJson: _effectiveBudgetJson,
      requiresRepoTrust: _requiresRepoTrust,
      deadlineAt: _deadlineAt,
      ...visible
    } = row
    const root = runById.get(row.rootRunId ?? row.id)
    const parent = row.parentRunId ? runById.get(row.parentRunId) : undefined
    const usageRows = row.depth === 0
      ? admissions.filter((admission) => admission.rootRunId === row.id)
      : admissions.filter((admission) => admission.runId === row.id)
    return {
      ...visible,
      status: row.status as WorkflowRunProjection['status'],
      rootTaskId: root?.taskId ?? row.taskId,
      rootRunName: root?.name ?? row.name,
      parentTaskId: parent?.taskId ?? null,
      parentRunName: parent?.name ?? null,
      usage: usageSummary(usageRows),
    }
  })
}
