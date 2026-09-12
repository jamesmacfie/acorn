// How a workflow run's own status projects onto the merged run list (@acorn/protocol/runs.ts).
import type { RunStatus } from '@acorn/protocol/runs.ts'

// How many runs this plugin offers the merged list. It is a "what is happening on this node" surface,
// not an archive: the owner's own workflow pane is where a full history is read, addressed by task.
export const RUN_LIST_LIMIT = 100

// A workflow run has eight states and the merged list has five (@acorn/protocol/runs.ts). Both
// `gated` and `cancelling` are waits — one on a person, one on a child process — and `safety-rail` is
// a failure with a specific cause, which the row's `detail` carries.
export const TERMINAL_WORKFLOW_STATUSES = new Set(['done', 'failed', 'cancelled', 'safety-rail'])

export const toRunStatus = (status: string): RunStatus => {
  if (status === 'done') return 'done'
  if (status === 'cancelled') return 'cancelled'
  if (status === 'failed' || status === 'safety-rail') return 'failed'
  if (status === 'gated' || status === 'cancelling') return 'waiting'
  return 'running'
}
