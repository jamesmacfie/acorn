import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import type { PluginDatabase } from '@acorn/plugin-api/node'
import { parseToolCeiling } from '@acorn/protocol/workflow.ts'
import type { ToolCeiling, WorkflowBudget, WorkflowRunRow, WorkflowStepRow } from '../shared/workflowContracts'
import * as schema from '../node/schema'
import { intersectToolCeilings } from './workflowTools'

export const MAX_WORKFLOW_DESCENDANTS = 12

export type WorkflowUsage = { costUsd: number; inputTokens: number; outputTokens: number }

const EMPTY_USAGE: WorkflowUsage = { costUsd: 0, inputTokens: 0, outputTokens: 0 }

const minDefined = (...values: Array<number | undefined>): number | undefined => {
  const present = values.filter((value): value is number => value != null)
  return present.length ? Math.min(...present) : undefined
}

export function intersectWorkflowBudgets(...budgets: Array<WorkflowBudget | undefined>): WorkflowBudget {
  return {
    maxWallTimeMs: minDefined(...budgets.map((budget) => budget?.maxWallTimeMs)),
    maxCostUsd: minDefined(...budgets.map((budget) => budget?.maxCostUsd)),
    maxInputTokens: minDefined(...budgets.map((budget) => budget?.maxInputTokens)),
    maxOutputTokens: minDefined(...budgets.map((budget) => budget?.maxOutputTokens)),
    maxTurns: minDefined(...budgets.map((budget) => budget?.maxTurns)),
  }
}

export function parseEffectiveTools(run: WorkflowRunRow): ToolCeiling {
  try {
    return parseToolCeiling(JSON.parse(run.effectiveToolsJson) as unknown) ?? { allow: [] }
  } catch {
    return { allow: [] }
  }
}

export function parseEffectiveBudget(run: WorkflowRunRow): WorkflowBudget {
  try {
    const value = JSON.parse(run.effectiveBudgetJson) as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {
      maxWallTimeMs: 0,
      maxCostUsd: 0,
      maxInputTokens: 0,
      maxOutputTokens: 0,
      maxTurns: 0,
    }
    const budget = value as Record<string, unknown>
    const parsed: WorkflowBudget = {}
    for (const field of ['maxWallTimeMs', 'maxCostUsd', 'maxInputTokens', 'maxOutputTokens', 'maxTurns'] as const) {
      const candidate = budget[field]
      if (candidate == null) continue
      if (typeof candidate !== 'number' || !Number.isFinite(candidate) || candidate <= 0
        || (field !== 'maxCostUsd' && !Number.isSafeInteger(candidate))) {
        return { maxTurns: 0 }
      }
      parsed[field] = candidate
    }
    return parsed
  } catch {
    return { maxTurns: 0 }
  }
}

export function childSafetyEnvelope(
  parent: WorkflowRunRow,
  dispatchStep: { tools?: ToolCeiling; budget?: WorkflowBudget },
  child: { tools?: ToolCeiling; budget?: WorkflowBudget },
  at: number,
): { tools: ToolCeiling; budget: WorkflowBudget; deadlineAt?: number } {
  const budget = intersectWorkflowBudgets(parseEffectiveBudget(parent), dispatchStep.budget, child.budget)
  const localDeadline = minDefined(dispatchStep.budget?.maxWallTimeMs, child.budget?.maxWallTimeMs)
  const deadlineAt = minDefined(parent.deadlineAt ?? undefined, localDeadline == null ? undefined : at + localDeadline)
  return {
    tools: intersectToolCeilings(parseEffectiveTools(parent), dispatchStep.tools, child.tools),
    budget,
    ...(deadlineAt == null ? {} : { deadlineAt }),
  }
}

function usageOf(rows: Array<typeof schema.workflowTurnAdmissions.$inferSelect>): WorkflowUsage {
  return rows.reduce((total, row) => ({
    costUsd: total.costUsd + row.costUsd,
    inputTokens: total.inputTokens + row.inputTokens,
    outputTokens: total.outputTokens + row.outputTokens,
  }), { ...EMPTY_USAGE })
}

function budgetViolation(budget: WorkflowBudget, usage: WorkflowUsage, admission: boolean): string | null {
  const crossed = (spent: number, limit: number) => admission ? spent >= limit : spent > limit
  if (budget.maxCostUsd != null && crossed(usage.costUsd, budget.maxCostUsd)) {
    return `cost budget ${admission ? 'exhausted' : 'exceeded'} (${usage.costUsd.toFixed(4)} of ${budget.maxCostUsd.toFixed(4)} USD reported)`
  }
  if (budget.maxInputTokens != null && crossed(usage.inputTokens, budget.maxInputTokens)) {
    return `input-token budget ${admission ? 'exhausted' : 'exceeded'} (${usage.inputTokens} of ${budget.maxInputTokens} reported)`
  }
  if (budget.maxOutputTokens != null && crossed(usage.outputTokens, budget.maxOutputTokens)) {
    return `output-token budget ${admission ? 'exhausted' : 'exceeded'} (${usage.outputTokens} of ${budget.maxOutputTokens} reported)`
  }
  return null
}

export class WorkflowSafetyRailError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorkflowSafetyRailError'
  }
}

/** Owns persistent, tree-wide turn admission and provider usage accounting. */
export class WorkflowTreeSafety {
  constructor(
    private readonly db: PluginDatabase,
    private readonly id: () => string = randomUUID,
  ) {}

  reserveTurn(run: WorkflowRunRow, step: WorkflowStepRow, stepBudget: WorkflowBudget): string {
    return this.db.transaction((tx) => {
      const currentRun = tx.select().from(schema.workflowRuns).where(eq(schema.workflowRuns.id, run.id)).get()
      const root = tx.select().from(schema.workflowRuns).where(eq(schema.workflowRuns.id, run.rootRunId ?? run.id)).get()
      if (!currentRun || !root
        || !['running', 'gated'].includes(currentRun.status)
        || !['running', 'gated'].includes(root.status)) {
        throw new WorkflowSafetyRailError('Workflow turn admission stopped because the run tree is not running.')
      }
      const at = Date.now()
      if (currentRun.deadlineAt != null && currentRun.deadlineAt <= at) {
        throw new WorkflowSafetyRailError('Workflow deadline exhausted before turn admission.')
      }
      const rows = tx.select().from(schema.workflowTurnAdmissions)
        .where(eq(schema.workflowTurnAdmissions.rootRunId, root.id)).all()
      const rootBudget = parseEffectiveBudget(root)
      const runBudget = parseEffectiveBudget(currentRun)
      const rootUsage = usageOf(rows)
      const runRows = rows.filter((row) => row.runId === currentRun.id)
      const stepRows = rows.filter((row) => row.stepId === step.id)
      const violation = budgetViolation(rootBudget, rootUsage, true)
        ?? (rootBudget.maxTurns != null && rows.length >= rootBudget.maxTurns
          ? `turn budget exhausted (${rows.length} of ${rootBudget.maxTurns} admitted)` : null)
        ?? budgetViolation(runBudget, usageOf(runRows), true)
        ?? (currentRun.id !== root.id && runBudget.maxTurns != null && runRows.length >= runBudget.maxTurns
          ? `child turn budget exhausted (${runRows.length} of ${runBudget.maxTurns} admitted)` : null)
        ?? budgetViolation(stepBudget, usageOf(stepRows), true)
        ?? (stepBudget.maxTurns != null && stepRows.length >= stepBudget.maxTurns
          ? `step turn budget exhausted (${stepRows.length} of ${stepBudget.maxTurns} admitted)` : null)
      if (violation) throw new WorkflowSafetyRailError(`Safety rail: ${violation}.`)

      const admissionId = this.id()
      tx.insert(schema.workflowTurnAdmissions).values({
        id: admissionId,
        rootRunId: root.id,
        runId: currentRun.id,
        stepId: step.id,
        state: 'reserved',
        createdAt: at,
      }).run()
      return admissionId
    })
  }

  async settleTurn(
    admissionId: string,
    usage: Partial<WorkflowUsage>,
    error?: string,
    stepBudget: WorkflowBudget = {},
  ): Promise<string | null> {
    const clean = {
      costUsd: Number.isFinite(usage.costUsd) && (usage.costUsd ?? 0) > 0 ? usage.costUsd! : 0,
      inputTokens: Number.isSafeInteger(usage.inputTokens) && (usage.inputTokens ?? 0) > 0 ? usage.inputTokens! : 0,
      outputTokens: Number.isSafeInteger(usage.outputTokens) && (usage.outputTokens ?? 0) > 0 ? usage.outputTokens! : 0,
    }
    await this.db.update(schema.workflowTurnAdmissions).set({
      state: 'settled',
      ...clean,
      error: error ?? null,
      settledAt: Date.now(),
    }).where(and(
      eq(schema.workflowTurnAdmissions.id, admissionId),
      eq(schema.workflowTurnAdmissions.state, 'reserved'),
    ))
    const [admission] = await this.db.select().from(schema.workflowTurnAdmissions)
      .where(eq(schema.workflowTurnAdmissions.id, admissionId))
    if (!admission) return 'Safety rail: workflow turn admission disappeared before settlement.'
    const [root] = await this.db.select().from(schema.workflowRuns).where(eq(schema.workflowRuns.id, admission.rootRunId))
    const [run] = await this.db.select().from(schema.workflowRuns).where(eq(schema.workflowRuns.id, admission.runId))
    if (!root || !run) return 'workflow accounting owner disappeared before settlement'
    const rows = await this.db.select().from(schema.workflowTurnAdmissions)
      .where(eq(schema.workflowTurnAdmissions.rootRunId, root.id))
    return budgetViolation(parseEffectiveBudget(root), usageOf(rows), false)
      ?? (run.id === root.id ? null : budgetViolation(
        parseEffectiveBudget(run),
        usageOf(rows.filter((row) => row.runId === run.id)),
        false,
      ))
      ?? budgetViolation(stepBudget, usageOf(rows.filter((row) => row.stepId === admission.stepId)), false)
  }

  async usage(rootRunId: string): Promise<WorkflowUsage> {
    return usageOf(await this.db.select().from(schema.workflowTurnAdmissions)
      .where(eq(schema.workflowTurnAdmissions.rootRunId, rootRunId)))
  }

  async recover(): Promise<number> {
    const reserved = await this.db.select().from(schema.workflowTurnAdmissions)
      .where(eq(schema.workflowTurnAdmissions.state, 'reserved'))
    if (!reserved.length) return 0
    const at = Date.now()
    for (const row of reserved) {
      await this.db.update(schema.workflowTurnAdmissions).set({
        state: 'settled',
        error: 'Provider usage was unavailable after restart; the admitted turn remains counted.',
        settledAt: at,
      }).where(and(
        eq(schema.workflowTurnAdmissions.id, row.id),
        eq(schema.workflowTurnAdmissions.state, 'reserved'),
      ))
    }
    return reserved.length
  }
}
