// The two row types come from this plugin's schema (node/schema.ts), not core's. `$inferSelect`
// against the local tables keeps every handler, the bridge, and the client's row shape in step with
// one migration chain.
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

// A value the person starting the run supplies. `${inputs.<name>}` reaches it from a prompt, a child
// prompt, and any string inside `with` (docs/workflows.md § Execution model). A run freezes the
// values it started with into its own copy of the definition, so `default` on a frozen run reads as
// "what this run was given".
export type WorkflowInput = {
  name: string
  description?: string
  required?: boolean
  default?: string
}

export type WorkflowStepDef = {
  name: string
  kind?: string
  // The steps this one waits on, by name. Absent means the step declared before it; an empty list
  // means a root. Edges are derived from this and never stored, so a file written before the graph
  // existed still runs as the chain it always was.
  after?: string[]
  // Agent kinds only. 'worktree' gives the step a child task with a checkout of its own; 'shared'
  // runs it on the run's task beside its siblings.
  isolation?: 'shared' | 'worktree'
  // Agent kinds only. 'append' puts every incoming edge's output under a heading after the prompt,
  // 'template' expects the prompt to place `${steps.x.output}` itself, 'none' sends the prompt alone.
  inputs?: 'append' | 'template' | 'none'
  // Agent kinds only. A provider option id to the value the step wants, as the provider advertises
  // them (`model`, `reasoning`, and whatever else its descriptor lists).
  configOptions?: Record<string, string>
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
  // A contributed kind's own configuration, straight off the workflow file's `[steps.with]` table
  // (../contract/extensions.ts). The runner never looks inside it: the plugin that contributed the
  // kind validates it in its `validate` and reads it in its handler. Built-in kinds do not use it —
  // their inputs are named fields above, which is what keeps them checkable by the host.
  with?: Record<string, unknown>
  tools?: ToolCeiling
  budget?: WorkflowBudget
}

export type WorkflowDef = {
  name: string
  posture?: WorkflowPosture
  trigger?: string
  tools?: ToolCeiling
  budget?: WorkflowBudget
  inputs?: WorkflowInput[]
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
  // The values this run started with, by declared input name. `${inputs.<name>}` in the prompt is
  // already substituted; a handler needs these only to render something of its own, as fan-out does
  // for its child prompt.
  inputs: Readonly<Record<string, string>>
  // The outputs of this step's incoming edges, in `after` order, already rendered the way
  // `${steps.<name>.output}` would render them. Only steps that finished `done` appear.
  upstream: readonly { name: string; output: string }[]
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
  /** The steps this one waits on, with the "absent means the previous step" rule already applied. */
  after(name: string): readonly string[]
  /** Whether `candidate` runs before `step` on every path, meaning it is a transitive predecessor. */
  precedes(candidate: string, step: string): boolean
}
export type StepValidator = (step: WorkflowStepDef, context: StepValidationContext) => string[]
export type StepKindContribution = { handler: StepHandler; validate?: StepValidator }
export type PolicyEvaluator = (taskId: string) => Promise<{ pass: boolean; detail?: string }>

export type WorkflowTriggerMatch = {
  taskId: string
  workflow: WorkflowDef
}

// The id is the extension entry's, minted by the host (../contract/extensions.ts), so a trigger does
// not carry one of its own.
export type WorkflowTriggerContribution = {
  evaluate(): Promise<WorkflowTriggerMatch[]>
}
