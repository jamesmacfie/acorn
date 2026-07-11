import { homedir } from 'node:os'
import { and, eq } from 'drizzle-orm'
import type { z } from 'zod'
import { type AppDatabase, schema } from '../../../core/server/db'
import { taskRoot } from '../../../core/main/taskWorktree'
import { PublicApiError } from '../../../core/shared/publicApi/errors'
import type {
  ResolveGateSchema,
  RunsQuerySchema,
  WorkflowDefinitionsResponseSchema,
  WorkflowRunSchema,
  WorkflowStepSchema,
} from '../../../core/shared/publicApi/workflows'
import type { WorkflowDef } from './workflowContracts'
import { loadWorkflowFiles } from './workflowFiles'

// WorkflowService (docs/public-api.md). Public runs start by registered definitionId
// (never a submitted graph, so file validation/trust can't be bypassed). Reads parse the durable
// JSON columns into typed values.

type Run = z.infer<typeof WorkflowRunSchema>
type Step = z.infer<typeof WorkflowStepSchema>

// The subset of the runner the public surface drives.
export interface WorkflowRunnerLike {
  start(taskId: string, def: WorkflowDef, opts?: { trigger?: string }): Promise<string>
  resolveGate(runId: string, stepId: string, approved: boolean): Promise<void>
  cancelRun(runId: string): Promise<void>
  killStep(runId: string, stepId: string): Promise<void>
  pollTriggers(): Promise<{ started: number; errors: string[] }>
}

function parseJson(text: string | null): unknown {
  if (text === null) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export class WorkflowService {
  constructor(
    private readonly db: AppDatabase,
    private readonly runner: WorkflowRunnerLike,
  ) {}

  async definitions(taskId: string): Promise<z.infer<typeof WorkflowDefinitionsResponseSchema>> {
    const repoDir = await taskRoot(this.db, taskId)
    const { workflows, errors } = loadWorkflowFiles(repoDir, homedir())
    return {
      items: workflows.map((w) => ({
        id: w.id,
        name: w.name,
        source: w.source,
        posture: w.posture ?? null,
        trigger: w.trigger ?? null,
        steps: w.steps.map((s) => ({ name: s.name, kind: s.kind ?? 'agent' })),
      })),
      errors: errors.map((e) => ({ source: e.source, message: e.message })),
    }
  }

  async startRun(taskId: string, definitionId: string, posture?: 'gated' | 'autonomous'): Promise<Run> {
    const repoDir = await taskRoot(this.db, taskId)
    const { workflows } = loadWorkflowFiles(repoDir, homedir())
    const def = workflows.find((w) => w.id === definitionId)
    if (!def) throw new PublicApiError('not_found', `No workflow definition "${definitionId}"`)
    const withPosture: WorkflowDef = posture ? { ...def, posture } : def
    let runId: string
    try {
      runId = await this.runner.start(taskId, withPosture, { trigger: 'manual' })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (/trust|config/i.test(msg)) throw new PublicApiError('config_trust_required', msg)
      throw new PublicApiError('conflict', msg)
    }
    return this.getRun(runId)
  }

  async listRuns(taskId: string, status?: string): Promise<Run[]> {
    const rows = await this.db
      .select()
      .from(schema.workflowRuns)
      .where(status ? and(eq(schema.workflowRuns.taskId, taskId), eq(schema.workflowRuns.status, status)) : eq(schema.workflowRuns.taskId, taskId))
    return rows.sort((a, b) => b.createdAt - a.createdAt).map((r) => this.rowToRun(r))
  }

  async getRun(runId: string): Promise<Run> {
    const [row] = await this.db.select().from(schema.workflowRuns).where(eq(schema.workflowRuns.id, runId)).limit(1)
    if (!row) throw new PublicApiError('not_found', 'Workflow run not found')
    return this.rowToRun(row)
  }

  async getSteps(runId: string): Promise<Step[]> {
    await this.getRun(runId) // 404 if the run is unknown
    const rows = await this.db.select().from(schema.workflowSteps).where(eq(schema.workflowSteps.runId, runId))
    return rows.sort((a, b) => a.idx - b.idx).map((s) => this.rowToStep(s))
  }

  async resolveGate(runId: string, stepId: string, approved: boolean): Promise<{ run: Run; step: Step }> {
    await this.getRun(runId)
    await this.runner.resolveGate(runId, stepId, approved)
    return { run: await this.getRun(runId), step: await this.getStep(stepId) }
  }

  // Evaluate registered trigger predicates; matching ones start a run (write-scoped, §11).
  async evaluateTriggers(): Promise<{ started: number; errors: string[] }> {
    return this.runner.pollTriggers()
  }

  async cancel(runId: string): Promise<Run> {
    await this.getRun(runId)
    await this.runner.cancelRun(runId)
    return this.getRun(runId)
  }

  async killStep(runId: string, stepId: string): Promise<Step> {
    await this.getRun(runId)
    await this.runner.killStep(runId, stepId)
    return this.getStep(stepId)
  }

  private async getStep(stepId: string): Promise<Step> {
    const [row] = await this.db.select().from(schema.workflowSteps).where(eq(schema.workflowSteps.id, stepId)).limit(1)
    if (!row) throw new PublicApiError('not_found', 'Workflow step not found')
    return this.rowToStep(row)
  }

  private rowToRun(row: typeof schema.workflowRuns.$inferSelect): Run {
    return {
      id: row.id,
      taskId: row.taskId,
      name: row.name,
      status: row.status as Run['status'],
      posture: row.posture as Run['posture'],
      trigger: row.trigger,
      error: row.error,
      def: parseJson(row.defJson),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }
  }

  private rowToStep(row: typeof schema.workflowSteps.$inferSelect): Step {
    return {
      id: row.id,
      runId: row.runId,
      idx: row.idx,
      name: row.name,
      kind: row.kind,
      mode: row.mode,
      status: row.status as Step['status'],
      worktreePath: row.worktreePath,
      profileId: row.profileId,
      model: row.model,
      error: row.error,
      structured: parseJson(row.structuredJson),
      result: parseJson(row.resultJson),
      costUsd: row.costUsd,
      iteration: row.iteration,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }
  }
}
