// The two row types come from THIS plugin's schema now (node/schema.ts), not core's. `$inferSelect`
// against the local tables is what keeps every handler, the bridge and the client's row shape in step
// with one migration chain.
import type * as schema from '../node/schema'
import type { ToolCeiling } from '@acorn/protocol/workflow.ts'

export type WorkflowPosture = 'gated' | 'autonomous'
export type { ToolCeiling, ToolRisk } from '@acorn/protocol/workflow.ts'

export type WorkflowBudget = {
  maxWallTimeMs?: number
  maxCostUsd?: number
  maxInputTokens?: number
  maxOutputTokens?: number
  maxTurns?: number
}

export type WorkflowChildStepDef = {
  name?: string
  profileId?: string
  model?: string
  prompt?: string
  schema?: object
  tools?: ToolCeiling
  budget?: WorkflowBudget
}

export type WorkflowStepDef = {
  name: string
  kind?: string
  profileId?: string
  model?: string
  prompt?: string
  schema?: object
  policy?: string
  maxIterations?: number
  requiresRun?: string
  childStep?: WorkflowChildStepDef
  joins?: string
  branches?: Record<string, string>
  tools?: ToolCeiling
  budget?: WorkflowBudget
}

export type WorkflowDef = {
  name: string
  posture?: WorkflowPosture
  trigger?: string
  tools?: ToolCeiling
  budget?: WorkflowBudget
  steps: WorkflowStepDef[]
}

export type WorkflowRunRow = typeof schema.workflowRuns.$inferSelect
export type WorkflowStepRow = typeof schema.workflowSteps.$inferSelect

export type WorkflowStepEvent = {
  at: number
  event: Record<string, unknown>
}

export type StepHandlerContext = {
  run: WorkflowRunRow
  step: WorkflowStepRow
  def: WorkflowStepDef
  renderedPrompt: string
  tools: ToolCeiling
  budget: WorkflowBudget
  signal: AbortSignal
  emit(event: WorkflowStepEvent): void
}

type StepHandlerData = {
  inputs?: unknown
  result?: unknown
  structured?: unknown
  sessionId?: string | null
  agentSessionId?: string | null
  costUsd?: number | null
  usage?: { inputTokens?: number; outputTokens?: number; cachedInputTokens?: number }
  events?: Record<string, unknown>[]
  handoff?: string
}

export type StepHandlerOutcome =
  | ({ status: 'done' } & StepHandlerData)
  | ({ status: 'failed'; error: string } & StepHandlerData)
  | ({ status: 'safety-rail'; error: string } & StepHandlerData)
  | { status: 'waiting-gate' }
  | { status: 'cancelled'; error?: string }

export type StepHandler = (ctx: StepHandlerContext) => Promise<StepHandlerOutcome>
export type StepValidationContext = {
  label: string
  index: number
  indexes: ReadonlyMap<string, number>
  stepAt(name: string): WorkflowStepDef | undefined
  policies: ReadonlySet<string>
}
export type StepValidator = (step: WorkflowStepDef, context: StepValidationContext) => string[]
export type StepKindContribution = { handler: StepHandler; validate?: StepValidator }
export type PolicyEvaluator = (taskId: string) => Promise<{ pass: boolean; detail?: string }>

export type WorkflowTriggerMatch = {
  taskId: string
  workflow: WorkflowDef
}

export type WorkflowTriggerContribution = {
  id: string
  evaluate(): Promise<WorkflowTriggerMatch[]>
}
