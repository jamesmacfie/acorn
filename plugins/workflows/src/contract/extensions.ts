import { extensionPointId } from '@acorn/plugin-api/node'
import type { PolicyEvaluator, StepKindContribution, WorkflowTriggerContribution } from './workflowContracts'

// What another plugin may add to a workflow run, and the only way in (docs/workflows.md § Contributed
// step kinds). These are node extension points rather than capabilities because each of the three is
// many-to-many: any number of plugins add step kinds, and one owner would be an arbitrary winner.
//
// Addressing, and why a contributed kind is not a bare word. A built-in kind is `agent` or `join`; a
// contributed one is the host-minted `<pluginId>:<entryId>`, so a `.acorn/workflows/*.toml` that says
// `kind = "http:request"` names the package that will run the step. Two plugins can both call their
// entry `request` and neither shadows the other, and the workflow file says which one it meant.

export type { PolicyEvaluator, StepHandler, StepHandlerContext, StepHandlerOutcome, StepKindContribution, StepValidationContext, StepValidator, WorkflowDef, WorkflowStepDef, WorkflowTriggerContribution, WorkflowTriggerMatch } from './workflowContracts'

/** A step kind the runner will dispatch to. Entry id becomes the second half of `kind`. */
export const WORKFLOW_STEP_KIND = extensionPointId<StepKindContribution>('workflows:step-kind')

/** A `gate-policy` verdict source. Entry id becomes the second half of `policy`. */
export const WORKFLOW_POLICY = extensionPointId<PolicyEvaluator>('workflows:policy')

/** Something that decides, on each sweep, which workflows should start. The sweep runs on the node's
 *  scheduler, so a trigger fires with no client attached (docs/schedules.md). */
export const WORKFLOW_TRIGGER = extensionPointId<WorkflowTriggerContribution>('workflows:trigger')
