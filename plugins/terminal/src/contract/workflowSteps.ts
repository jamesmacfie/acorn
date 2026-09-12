import { extensionPointId } from '@acorn/protocol/plugin/ids.ts'

// What this plugin contributes to the workflows plugin's `workflows:step-kind` point
// (docs/terminal.md § Workflow steps), declared here rather than imported from that package.
//
// plugins/workflows already depends on this one, directly and through plugins/agents, and the
// workspace graph has to stay acyclic (turbo.json § topo). So the point is named by the string the
// two packages agree on — which docs/workflows.md § Contributed step kinds says is the contract —
// and the shapes below mirror as much of `@acorn/plugin-workflows/contract/extensions.ts` as these
// two kinds use. The mirror is held against the real types by a test in that package, which may
// import this file because a plugin's contract/ is the one cross-plugin surface.

/** One input of a step's form, as `StepField` in plugins/workflows spells it. */
export type StepField = {
  id: string
  label: string
  type: 'text' | 'textarea' | 'number' | 'boolean' | 'select' | 'prompt'
  required?: boolean
  hint?: string
  placeholder?: string
  options?: { value: string; label: string; description?: string }[]
  optionsRoute?: string
  min?: number
  max?: number
  templates?: boolean
}

/** As much of the runner's handler context as these two kinds read. */
export type StepContext = {
  run: { taskId: string }
  def: { with?: Record<string, unknown> }
  signal: AbortSignal
  emit(event: { at: number; event: Record<string, unknown> }): void
}

export type StepOutcome =
  | { status: 'done'; result?: unknown; structured?: unknown; handoff?: string }
  | { status: 'failed'; error: string; result?: unknown; structured?: unknown }
  | { status: 'cancelled'; error?: string }

export type TerminalWorkflowStepKind = {
  describe: { label: string; description?: string; icon?: string; fields: StepField[]; output?: { description: string } }
  validate: (step: { with?: Record<string, unknown> }, context: { label: string }) => string[]
  handler: (ctx: StepContext) => Promise<StepOutcome>
}

export const WORKFLOW_STEP_KIND = extensionPointId<TerminalWorkflowStepKind>('workflows:step-kind')
