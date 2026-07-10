import type { schema } from '../server/db'
import type { ToolCeiling, ToolRisk } from '../shared/workflow'

export type WorkflowPosture = 'gated' | 'autonomous'
export type { ToolCeiling, ToolRisk } from '../shared/workflow'

export type WorkflowChildStepDef = {
  name?: string
  profileId?: string
  model?: string
  prompt?: string
  schema?: object
  tools?: ToolCeiling
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
}

export type WorkflowDef = {
  name: string
  posture?: WorkflowPosture
  trigger?: string
  tools?: ToolCeiling
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
  signal: AbortSignal
  emit(event: WorkflowStepEvent): void
}

type StepHandlerData = {
  inputs?: unknown
  result?: unknown
  structured?: unknown
  sessionId?: string | null
  costUsd?: number | null
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
export type PolicyEvaluator = (taskId: string) => Promise<{ pass: boolean; detail?: string }>

export type WorkflowTriggerMatch = {
  taskId: string
  workflow: WorkflowDef
}

export type WorkflowTriggerContribution = {
  id: string
  evaluate(): Promise<WorkflowTriggerMatch[]>
}
