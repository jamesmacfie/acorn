import { desc, eq, inArray, sql } from 'drizzle-orm'
import type { PluginDatabase } from '@acorn/plugin-api/node'
import * as schema from '../../../node/schema'
import type { WorkflowRunProjection, WorkflowUsageSummary } from '../../../shared/api'

const admissionFields = {
  rootRunId: schema.workflowTurnAdmissions.rootRunId, runId: schema.workflowTurnAdmissions.runId,
  costUsd: schema.workflowTurnAdmissions.costUsd, inputTokens: schema.workflowTurnAdmissions.inputTokens,
  outputTokens: schema.workflowTurnAdmissions.outputTokens,
}
type Admission = Pick<typeof schema.workflowTurnAdmissions.$inferSelect, keyof typeof admissionFields>

const runFields = {
  id: schema.workflowRuns.id, taskId: schema.workflowRuns.taskId, name: schema.workflowRuns.name,
  status: schema.workflowRuns.status, posture: schema.workflowRuns.posture, trigger: schema.workflowRuns.trigger,
  defJson: schema.workflowRuns.defJson, rootRunId: schema.workflowRuns.rootRunId,
  parentRunId: schema.workflowRuns.parentRunId, parentStepId: schema.workflowRuns.parentStepId,
  depth: schema.workflowRuns.depth, invocationKey: schema.workflowRuns.invocationKey,
  payloadFingerprint: schema.workflowRuns.payloadFingerprint, error: schema.workflowRuns.error,
  createdAt: schema.workflowRuns.createdAt, updatedAt: schema.workflowRuns.updatedAt,
}

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
  return usageSummary(await db.select(admissionFields).from(schema.workflowTurnAdmissions)
    .where(eq(schema.workflowTurnAdmissions.runId, runId)))
}

/** Builds the task-scoped run read model, including explicit lineage and tree usage. */
export async function workflowRunsForTask(db: PluginDatabase, taskId: string): Promise<WorkflowRunProjection[]> {
  const rows = await db.select(runFields).from(schema.workflowRuns).where(eq(schema.workflowRuns.taskId, taskId))
    .orderBy(desc(schema.workflowRuns.createdAt), sql`${schema.workflowRuns}.rowid`)
  if (!rows.length) return []

  const lineageIds = [...new Set(rows.flatMap((row) => [row.rootRunId, row.parentRunId]).filter((id): id is string => !!id))]
  const lineage = lineageIds.length
    ? await db.select({ id: schema.workflowRuns.id, taskId: schema.workflowRuns.taskId, name: schema.workflowRuns.name })
      .from(schema.workflowRuns).where(inArray(schema.workflowRuns.id, lineageIds))
    : []
  const runById = new Map([...rows, ...lineage].map((row) => [row.id, row]))
  const rootIds = [...new Set(rows.map((row) => row.rootRunId ?? row.id))]
  const admissions = await db.select(admissionFields).from(schema.workflowTurnAdmissions)
    .where(inArray(schema.workflowTurnAdmissions.rootRunId, rootIds))
  const treeAdmissions = new Map<string, Admission[]>()
  const ownAdmissions = new Map<string, Admission[]>()
  for (const admission of admissions) {
    const tree = treeAdmissions.get(admission.rootRunId) ?? []
    tree.push(admission)
    treeAdmissions.set(admission.rootRunId, tree)
    const own = ownAdmissions.get(admission.runId) ?? []
    own.push(admission)
    ownAdmissions.set(admission.runId, own)
  }

  return rows.map((row): WorkflowRunProjection => {
    const root = runById.get(row.rootRunId ?? row.id)
    const parent = row.parentRunId ? runById.get(row.parentRunId) : undefined
    const usageRows = row.depth === 0
      ? treeAdmissions.get(row.id) ?? []
      : ownAdmissions.get(row.id) ?? []
    return {
      ...row,
      status: row.status as WorkflowRunProjection['status'],
      rootTaskId: root?.taskId ?? row.taskId,
      rootRunName: root?.name ?? row.name,
      parentTaskId: parent?.taskId ?? null,
      parentRunName: parent?.name ?? null,
      usage: usageSummary(usageRows),
    }
  })
}

/** Address one durable run without making the client enumerate tasks. */
export async function workflowRunById(db: PluginDatabase, runId: string): Promise<WorkflowRunProjection | null> {
  const [row] = await db.select({ taskId: schema.workflowRuns.taskId }).from(schema.workflowRuns)
    .where(eq(schema.workflowRuns.id, runId)).limit(1)
  if (!row) return null
  return (await workflowRunsForTask(db, row.taskId)).find((run) => run.id === runId) ?? null
}

/** Bounded status-only read for clients polling a run without transferring step results. */
export async function workflowStepStatuses(db: PluginDatabase, runId: string): Promise<{ steps: { id: string; status: string }[]; truncated: boolean }> {
  const rows = await db.select({ id: schema.workflowSteps.id, status: schema.workflowSteps.status })
    .from(schema.workflowSteps).where(eq(schema.workflowSteps.runId, runId))
    .orderBy(schema.workflowSteps.idx).limit(201)
  return { steps: rows.slice(0, 200), truncated: rows.length > 200 }
}
