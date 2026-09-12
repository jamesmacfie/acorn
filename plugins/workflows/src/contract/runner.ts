import { capabilityId } from '@acorn/protocol/plugin/ids.ts'
import type { WorkflowDef } from '../shared/workflowContracts'

// workflows.runner: the lifecycle methods the composition root and Node-owned schedulers need after
// plugin initialization.
//
// Reconciliation cannot run inside init. It sweeps every 'running' step back to 'pending' and re-ticks
// its run, so it has to run after the listener binds, because a resumed step calls the node's own
// loopback context route. It also has to run before the composition root resolves `reconciled`, which
// `start`, `gate`, and `cancel` await so a run cannot start into the sweep.
//
// Lives in contract/ for the same reason as agents.runtime: the composition root reaches it through a
// declared surface rather than a deep import of server/workflowRunner.ts.
type WorkflowInternalStartBase = {
  taskId: string
  inputs?: Record<string, string>
  intendedRunId: string
  callerKey: string
  payloadFingerprint: string
  trigger: string
}

export type WorkflowInternalStart = WorkflowInternalStartBase & (
  | { workflow: WorkflowDef }
  | { workflowId: string }
)

export type WorkflowsRunnerHandle = {
  reconcile(): Promise<void>
  // Internal callers must reserve the run ID and invocation identity before this call. The plugin
  // resolves and freezes the full graph, then the runner verifies replays against both values.
  start(request: WorkflowInternalStart): Promise<string>
}
export const WORKFLOWS_RUNNER = capabilityId<WorkflowsRunnerHandle>('workflows.runner')
