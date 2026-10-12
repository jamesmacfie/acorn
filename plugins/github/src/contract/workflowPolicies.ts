import { extensionPointId } from '@acorn/protocol/plugin/ids.ts'

// What this plugin contributes to the workflows plugin's `workflows:policy` point
// (docs/workflows/step-kinds.md § Gate policies), declared here rather than imported from that package.
//
// plugins/workflows already depends on this one, for this file among others, and the workspace graph
// has to stay acyclic. So the point is named by the string the two packages agree on, and the shapes
// below mirror as much of `@acorn/plugin-workflows/contract/extensions.ts` as these policies use. A test
// in that package holds the mirror against the real types.

/** One setting in a policy's form, as `StepField` in plugins/workflows spells it. */
type PolicyField = {
  id: string
  label: string
  type: 'text' | 'number' | 'boolean' | 'select'
  required?: boolean
  hint?: string
  options?: { value: string; label: string; description?: string }[]
}

export type PolicyVerdict = { verdict: 'pass' | 'wait' | 'fail'; detail?: string; value?: unknown }

type PolicyContext = {
  taskId: string
  with: Record<string, unknown>
  since: number
  previous?: PolicyVerdict
  signal: AbortSignal
}

export type GithubWorkflowPolicy = {
  evaluate(ctx: PolicyContext): Promise<PolicyVerdict>
  describe: { label: string; description: string; icon: string; fields: PolicyField[]; minIntervalMs?: number }
  validate?: (settings: Record<string, unknown>) => string[]
}

export const WORKFLOW_POLICY = extensionPointId<GithubWorkflowPolicy>('workflows:policy')

/** The host-minted id of the CI policy, which `ci-loop` and the `checks-green` name both ask. */
export const CI_SETTLED_POLICY = 'github:ci-settled'

/** The `value` the CI policy answers with: every check that failed, and every one still running. */
export type CiSettledValue = {
  failing: { name: string; status: string | null; url: string | null }[]
  pending: string[]
  total: number
}
