import { capabilityId } from '@acorn/plugin-api/node'

// workflows.runner: the one method the composition root needs off the runner after init.
//
// Reconciliation can't happen inside init and must not. It sweeps every 'running' step back to
// 'pending' and re-ticks its run, so it has to run after the listener binds, because a resumed step
// calls the node's own loopback context route, and before the composition root resolves its
// `reconciled` promise, which `start`, `gate` and `cancel` all await so a run can't be started into the
// sweep.
//
// In contract/ for the same reason as agents.runtime: the roots reach it through a declared surface
// rather than deep-importing main/workflowRunner.ts.
export type WorkflowsRunnerHandle = { reconcile(): Promise<void> }
export const WORKFLOWS_RUNNER = capabilityId<WorkflowsRunnerHandle>('workflows.runner')
