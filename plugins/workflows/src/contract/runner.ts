import { capabilityId } from '@acorn/node-core/server/plugin/capabilities.ts'

// workflows.runner — the ONE method the composition root needs off the runner after init.
//
// Reconciliation cannot happen inside init and must not: it sweeps every 'running' step back to
// 'pending' and re-ticks its run, so it has to run AFTER the listener binds (a resumed step calls the
// node's own loopback context route) and BEFORE the composition root resolves its `reconciled` promise,
// which `start`/`gate`/`cancel` all await precisely so a run cannot be started into the sweep.
//
// In contract/ for the same reason as agents.runtime: the roots reach it through a declared surface
// rather than deep-importing main/workflowRunner.ts.
export type WorkflowsRunnerHandle = { reconcile(): Promise<void> }
export const WORKFLOWS_RUNNER = capabilityId<WorkflowsRunnerHandle>('workflows.runner')
