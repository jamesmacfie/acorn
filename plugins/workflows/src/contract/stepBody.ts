import type { DataValue } from '@acorn/protocol/dataValues.ts'
import type { WorkflowStepRow } from './wire.ts'

// Another plugin's drawing of one step's result in the run pane (docs/workflows/routes-and-ui.md
// § Contributed step bodies).
//
// A `remote`, `replace` point keyed by the step's exact kind, such as `http:request`. The plugin that
// runs a kind knows best what its output means, so it may draw that output. Everything else stays this
// plugin's: the step header and its status, Stop, Retry, the lineage and child runs, the alerts, and
// the events fold. A waiting gate's form and an agent step's live conversation are never handed over.
//
// Data only. The props are a bounded copy of what the run pane already shows, with no callbacks and
// no actions. A provider that needs more reads its own Node records through its own routes.

/** The result body of a selected workflow step. `replace`, keyed by the step's exact kind. */
export const WORKFLOW_STEP_BODY_POINT = 'workflows:step-body'

/** The most of `inputs` or `output`, serialized, that a provider is given. Past it the field is `null`
 *  and its `…Truncated` flag is set. */
export const MAX_STEP_BODY_JSON_BYTES = 64 * 1024

/** The most live output lines a provider is given: the newest ones. */
export const MAX_STEP_BODY_TAIL_LINES = 200

export type WorkflowStepBodyProps = {
  taskId: string
  projectId: string
  runId: string
  stepId: string
  /** The point's key. */
  kind: string
  status: WorkflowStepRow['status']
  /** What the step was handed, parsed. `null` when it has none, when it isn't JSON, or when it's too big. */
  inputs: DataValue | null
  inputsTruncated: boolean
  /** What the step answered with, parsed. `null` when it has none yet, when it isn't JSON, or when
   *  it's too big. */
  output: DataValue | null
  outputTruncated: boolean
  /** The step's live output, newest last, while the run pane holds some. */
  tail?: string[]
  /** Rises on every change to these props while the run pane stays open. A lower number is stale. */
  revision: number
}
