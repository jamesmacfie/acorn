import { capabilityId } from '@acorn/protocol/pluginIds.ts'

// workflows.runner: the one method the composition root needs off the runner after init.
//
// Reconciliation cannot run inside init. It sweeps every 'running' step back to 'pending' and re-ticks
// its run, so it has to run after the listener binds, because a resumed step calls the node's own
// loopback context route. It also has to run before the composition root resolves `reconciled`, which
// `start`, `gate`, and `cancel` await so a run cannot start into the sweep.
//
// Lives in contract/ for the same reason as agents.runtime: the composition root reaches it through a
// declared surface rather than a deep import of server/workflowRunner.ts.
export type WorkflowsRunnerHandle = { reconcile(): Promise<void> }
export const WORKFLOWS_RUNNER = capabilityId<WorkflowsRunnerHandle>('workflows.runner')
