import type { ACORN_BASELINE } from '@acorn/protocol/baseline.ts'
// The two row types come from this plugin's schema (node/schema.ts), not core's. `$inferSelect`
// against the local tables keeps every handler, the bridge, and the client's row shape in step with
// one migration chain.
import type * as schema from '../node/schema'
import type { ToolCeiling } from '@acorn/protocol/toolPolicy.ts'
import type { DataValue } from '@acorn/protocol/dataValues.ts'
import type { DataSchema } from '@acorn/protocol/dataSchemas.ts'
import type { DataBinding } from '@acorn/protocol/dataBindings.ts'

export type WorkflowPosture = 'gated' | 'autonomous'
export type { ToolCeiling, ToolRisk } from '@acorn/protocol/toolPolicy.ts'

export type WorkflowBudget = {
  maxWallTimeMs?: number
  maxCostUsd?: number
  maxInputTokens?: number
  maxOutputTokens?: number
  maxTurns?: number
}

// A value the person starting the run supplies. `${inputs.<name>}` reaches it from a prompt, a child
// prompt, and any string inside `with` (docs/workflows/execution.md § Execution model). A run freezes the
// values it started with into its own copy of the definition, so `default` on a frozen run reads as
// "what this run was given".
export type WorkflowInput = import('../contract/wire').WorkflowInput

export type WorkflowDefinitionRef =
  | { source: 'database'; id: string }
  | { source: 'repo'; path: string }
  | { source: 'user'; id: string }

/** Untrusted drafts remain wide enough to produce a field-located diagnostic. Runtime readers parse
 * the DataBinding branch and never translate another object shape. */
export type WorkflowValueBinding = DataBinding | Record<string, unknown>
export type WorkflowOutput = { name: string; label?: string; schema: DataSchema; required?: boolean; binding: DataBinding }

export type WorkflowBoundTemplate = {
  template: string
  bindings?: Record<string, WorkflowValueBinding>
}

export type ChildWorkflowConfig = {
  ref: WorkflowDefinitionRef
  inputs?: Record<string, WorkflowValueBinding>
}

/** An editable form on a `gate-human` step. Fields are declared the way workflow inputs are, and
 *  each binding proposes a field's value from run inputs or transitive predecessors. The reviewer
 *  can correct the proposal before approving it, and the step's output is what they approved. */
export type WorkflowGateForm = {
  fields: WorkflowInput[]
  values?: Record<string, WorkflowValueBinding>
}

export type WorkflowMapSource = {
  step: string
  pointer: string
}

export type WorkflowStepDef = {
  repeat?: import('./workflowProcessing').WorkflowRepeatPolicy
  incremental?: boolean
  query?: import('@acorn/protocol/dataQueries.ts').QueryReference
  record?: import('@acorn/protocol/dataBindings.ts').DataBinding
  condition?: import('@acorn/protocol/dataBindings.ts').DataPredicate
  projection?: string[]
  dataset?: { id: string; version: number; rows: import('@acorn/protocol/dataBindings.ts').DataBinding }
  id?: string
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
  // Runtime child workflows use a separate key from static `workflow` file composition. Resolution
  // freezes the referenced definition before any child task exists.
  childWorkflow?: ChildWorkflowConfig
  // `workflow-map` reads an array from one predecessor's structured result. The item key is a JSON
  // Pointer within each item, and the title template can read only its declared bindings.
  items?: WorkflowMapSource
  itemKey?: string
  // `gate-human` only. Absent means the gate is a plain approve-or-reject with no output values.
  form?: WorkflowGateForm
  title?: WorkflowBoundTemplate
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
  baseline: typeof ACORN_BASELINE
  maxDescendants?: number
  maxConcurrency?: number
  formatVersion: 1
  name: string
  posture?: WorkflowPosture
  trigger?: string
  tools?: ToolCeiling
  budget?: WorkflowBudget
  inputs?: WorkflowInput[]
  outputs?: WorkflowOutput[]
  steps: WorkflowStepDef[]
}

export type WorkflowRunRow = typeof schema.workflowRuns.$inferSelect
export type WorkflowStepRow = typeof schema.workflowSteps.$inferSelect

export type WorkflowDefinitionProvenance =
  | { source: 'inline' }
  | { source: 'database'; id: string; revision: number }
  | { source: 'repo'; path: string }
  | { source: 'user'; id: string }

export type ResolvedWorkflowNode = {
  path: string[]
  depth: number
  definition: WorkflowDef
  provenance: WorkflowDefinitionProvenance
  defaultInputs: Record<string, DataValue>
  fingerprint: string
}

/** The executable definition graph frozen before a root run starts. */
export type ResolvedWorkflowGraph = {
  root: WorkflowDef
  nodes: ResolvedWorkflowNode[]
  fingerprint: string
  requiresRepoTrust: boolean
}

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
  // already substituted; a handler needs these only to render something of its own.
  inputs: Readonly<Record<string, DataValue>>
  predecessorValues?: Readonly<Record<string, DataValue>>
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
  | ({ status: 'completed-with-failures'; error: string } & StepHandlerData)
  | ({ status: 'failed'; error: string } & StepHandlerData)
  | ({ status: 'safety-rail'; error: string; scope?: 'admission' } & StepHandlerData)
  // `inputs` is frozen into the step before it waits, so a gate's proposal cannot move under its
  // reviewer and stays readable after the run ends.
  | { status: 'waiting-gate'; inputs?: unknown }
  | { status: 'waiting-children' }
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

// What a kind's form looks like, as data (docs/workflows/step-kinds.md § Contributed step kinds). The host draws
// it, so a kind can be edited in the UI on either host without the plugin shipping a component.
export type StepFieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'boolean'
  | 'select'
  | 'prompt'
  | 'child-workflow'
  | 'workflow-map-source'
  | 'workflow-json-pointer'
  | 'workflow-title'
  | 'gate-form'

export type StepFieldOption = { value: string; label: string; description?: string }

export type StepField = {
  /** The key inside `with`, or the step's own field for a built-in. ../shared/stepFields.ts says which. */
  id: string
  label: string
  type: StepFieldType
  required?: boolean
  hint?: string
  placeholder?: string
  /** A select whose choices are fixed. The host checks the value against them before `validate` runs. */
  options?: StepFieldOption[]
  /** A select whose choices come from a route in the contributing plugin's own namespace, answering
   *  `{ options }`. Not checked at load time: the node validating the file may not be able to reach
   *  the project the route needs. */
  optionsRoute?: string
  /** Numbers only. Checked by the host before `validate` runs. */
  min?: number
  max?: number
  /** Text kinds only: whether `${inputs.x}` and `${steps.x.output}` are allowed here. Defaults to true
   *  for a prompt field and false everywhere else. */
  templates?: boolean
}

export type StepKindDescription = {
  label: string
  description: string
  /** A Lucide name or a `brand:` mark. */
  icon: string
  /** True for a kind that runs an agent, and so may take `isolation`, `inputs` and `configOptions`.
   *  The editor draws the profile, model and ceiling fields for these from the provider descriptors,
   *  which is why they are not in `fields`. */
  runsAgent?: boolean
  fields: StepField[]
  output: { description: string; schema?: object }
}

export type StepKindContribution = { handler: StepHandler; validate?: StepValidator; describe: StepKindDescription }

/** What the editor and the palette need to offer every kind this node can run
 *  (docs/api-reference/workflow-routes.md § Runs). `pluginId` is null for a built-in. */
export type WorkflowCatalog = {
  kinds: { id: string; pluginId: string | null; describe: StepKindDescription | null }[]
  policies: { id: string; pluginId: string | null }[]
  profiles: { id: string; label: string; managed: boolean; structured: boolean }[]
  /** Saved workflows that the selected project can resolve. This metadata contains no definition
   *  body, input default, credential, or runtime value. */
  workflows?: WorkflowCatalogTarget[]
}

export type WorkflowCatalogTarget = {
  ref: WorkflowDefinitionRef
  name: string
  /** False for an editable database draft that publication will include before it can run. */
  published?: boolean
  inputs: Array<Omit<WorkflowInput, 'default'> & { hasDefault?: boolean }>
  outputs?: { step?: string; name?: string; schema: object }[]
}
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
