import { randomUUID } from 'node:crypto'
import { DEFAULT_PROFILE_ID, type PluginDatabase } from '@acorn/plugin-api/node'
import { eq } from 'drizzle-orm'
import * as schema from '../node/schema'
import type {
  ResolvedWorkflowGraph,
  ToolCeiling,
  WorkflowBudget,
  WorkflowDef,
  WorkflowRunRow,
} from '../shared/workflowContracts'
import { resolveWorkflowInputs } from './workflowValidation'

export type WorkflowInvocationIdentity = {
  callerKey: string
  payloadFingerprint: string
  rootRunId: string
  parentRunId: string | null
  parentStepId: string | null
  depth: number
}

export type WorkflowStartOptions = {
  trigger?: string
  inputs?: Record<string, string>
  intendedRunId?: string
  invocation?: WorkflowInvocationIdentity
  resolvedGraph?: ResolvedWorkflowGraph
  effectiveTools?: ToolCeiling
  effectiveBudget?: WorkflowBudget
  deadlineAt?: number
  requiresRepoTrust?: boolean
}

export type PersistedWorkflowStart = {
  runId: string
  created: boolean
  deadlineAt: number | null
  invocationParent?: WorkflowRunRow
}

function assertInvocationIdentity(options: WorkflowStartOptions | undefined): void {
  if (!!options?.intendedRunId !== !!options?.invocation) {
    throw new Error('An intended workflow run ID and invocation identity must be supplied together.')
  }
  const invocation = options?.invocation
  if (!invocation) return
  if (!invocation.callerKey.trim() || !invocation.payloadFingerprint.trim() || !invocation.rootRunId.trim()) {
    throw new Error('A workflow invocation requires a caller key, payload fingerprint, and root run ID.')
  }
  if (!Number.isSafeInteger(invocation.depth) || invocation.depth < 0) {
    throw new Error('A workflow invocation depth must be a nonnegative integer.')
  }
  if ((invocation.parentRunId == null) !== (invocation.parentStepId == null)) {
    throw new Error('A workflow invocation must supply both parent IDs or neither parent ID.')
  }
  if (invocation.parentRunId == null && invocation.depth !== 0) {
    throw new Error('A root workflow run must have depth zero.')
  }
}

/** Reserves a run and its complete step roster before the runner starts any effects. */
export async function persistWorkflowStart(
  db: PluginDatabase,
  taskId: string,
  def: WorkflowDef,
  options?: WorkflowStartOptions,
): Promise<PersistedWorkflowStart> {
  assertInvocationIdentity(options)
  let invocationParent: WorkflowRunRow | undefined
  if (options?.invocation?.parentRunId != null) {
    const [parent] = await db.select().from(schema.workflowRuns)
      .where(eq(schema.workflowRuns.id, options.invocation.parentRunId))
    if (!parent || options.invocation.depth !== parent.depth + 1 || options.invocation.depth > 1) {
      throw new Error('A child workflow run must be a direct depth-one descendant of its parent.')
    }
    if ((parent.rootRunId ?? parent.id) !== options.invocation.rootRunId) {
      throw new Error('A child workflow run must keep its parent tree accounting owner.')
    }
    invocationParent = parent
  }

  const inputs = resolveWorkflowInputs(def, options?.inputs)
  const frozen: WorkflowDef = def.inputs?.length
    ? { ...def, inputs: def.inputs.map((input) => ({ ...input, default: inputs[input.name] ?? '' })) }
    : def
  const runId = options?.intendedRunId ?? randomUUID()
  const at = Date.now()
  const [existingIntendedRun] = options?.intendedRunId
    ? await db.select().from(schema.workflowRuns).where(eq(schema.workflowRuns.id, options.intendedRunId))
    : []
  const defJson = JSON.stringify(frozen)
  const resolvedGraphJson = options?.resolvedGraph ? JSON.stringify(options.resolvedGraph) : null
  const trigger = options?.trigger ?? def.trigger ?? 'manual'
  const effectiveTools = options?.effectiveTools ?? def.tools ?? {}
  const effectiveBudget = options?.effectiveBudget ?? def.budget ?? {}
  const deadlineAt = options?.deadlineAt
    ?? existingIntendedRun?.deadlineAt
    ?? (effectiveBudget.maxWallTimeMs == null ? null : at + effectiveBudget.maxWallTimeMs)
  const requiresRepoTrust = options?.requiresRepoTrust ?? options?.resolvedGraph?.requiresRepoTrust ?? false
  const created = db.transaction((tx) => {
    const byId = tx.select().from(schema.workflowRuns).where(eq(schema.workflowRuns.id, runId)).get()
    const byInvocation = options?.invocation
      ? tx.select().from(schema.workflowRuns).where(eq(schema.workflowRuns.invocationKey, options.invocation.callerKey)).get()
      : undefined
    const existing = byId ?? byInvocation
    if (existing) {
      const matches = existing.id === runId
        && existing.taskId === taskId
        && existing.defJson === defJson
        && existing.resolvedGraphJson === resolvedGraphJson
        && existing.trigger === trigger
        && existing.invocationKey === (options?.invocation?.callerKey ?? null)
        && existing.payloadFingerprint === (options?.invocation?.payloadFingerprint ?? null)
        && existing.rootRunId === (options?.invocation?.rootRunId ?? runId)
        && existing.parentRunId === (options?.invocation?.parentRunId ?? null)
        && existing.parentStepId === (options?.invocation?.parentStepId ?? null)
        && existing.depth === (options?.invocation?.depth ?? 0)
        && existing.effectiveToolsJson === JSON.stringify(effectiveTools)
        && existing.effectiveBudgetJson === JSON.stringify(effectiveBudget)
        && existing.deadlineAt === deadlineAt
        && existing.requiresRepoTrust === requiresRepoTrust
      if (!matches) throw new Error(`Workflow invocation '${options?.invocation?.callerKey ?? runId}' conflicts with an existing run.`)
      return false
    }

    tx.insert(schema.workflowRuns).values({
      id: runId,
      taskId,
      name: def.name,
      status: 'running',
      posture: def.posture ?? 'gated',
      trigger,
      defJson,
      resolvedGraphJson,
      rootRunId: options?.invocation?.rootRunId ?? runId,
      parentRunId: options?.invocation?.parentRunId ?? null,
      parentStepId: options?.invocation?.parentStepId ?? null,
      depth: options?.invocation?.depth ?? 0,
      invocationKey: options?.invocation?.callerKey ?? null,
      payloadFingerprint: options?.invocation?.payloadFingerprint ?? null,
      effectiveToolsJson: JSON.stringify(effectiveTools),
      effectiveBudgetJson: JSON.stringify(effectiveBudget),
      requiresRepoTrust,
      deadlineAt,
      createdAt: at,
      updatedAt: at,
    }).run()
    for (const [idx, step] of def.steps.entries()) {
      tx.insert(schema.workflowSteps).values({
        id: randomUUID(),
        runId,
        idx,
        name: step.name,
        kind: step.kind ?? 'agent',
        mode: step.kind === 'decide' ? 'ai' : 'headless',
        profileId: step.profileId ?? DEFAULT_PROFILE_ID,
        model: step.model ?? null,
        status: 'pending',
        createdAt: at,
        updatedAt: at,
      }).run()
    }
    return true
  })
  return { runId, created, deadlineAt, invocationParent }
}
