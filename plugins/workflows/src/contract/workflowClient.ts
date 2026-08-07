// The workflow control client, and the routes it drives.
//
// In contract/ rather than client/ because two other plugins call it — plugins/agents' task sidebar
// and this plugin's own palette rows — and contract/ is the one sanctioned cross-plugin surface
// (docs/plugins.md § Package shape). It reads only client-core and protocol's workflow row types,
// never this plugin's own client/, so transitive contract purity holds.
//
// The whole module moved here from @acorn/client-core/tasks/workflowClient.ts, and the eight route
// builders came with it out of @acorn/protocol/api.ts — verbatim, since a retyped route template
// compiles fine and 404s at runtime. Commands use HTTP; workflow notices and step events use the
// shared WebSocket.

import { readJson, writeJson } from '@acorn/client-core/apiClient.ts'
import type { WorkflowDefSummary, WorkflowRunRow, WorkflowStepRow } from '@acorn/protocol/workflow.ts'
import { openRepoConfigTrust } from '@acorn/client-core/configTrust/configTrust.ts'

export type { WorkflowDefSummary, WorkflowRunRow, WorkflowStepRow } from '@acorn/protocol/workflow.ts'

// Task-scoped defs/start/runs and run-scoped steps/gates.
export const workflowDefsRoute = (taskId: string) => `/v2/p/workflows/tasks/${taskId}/workflows`
export const workflowStartRoute = (taskId: string) => `/v2/p/workflows/tasks/${taskId}/workflows`
export const workflowRunsRoute = (taskId: string) => `/v2/p/workflows/tasks/${taskId}/workflows/runs`
export const workflowStepsRoute = (runId: string) => `/v2/p/workflows/workflows/runs/${runId}/steps`
export const workflowGateRoute = (runId: string) => `/v2/p/workflows/workflows/runs/${runId}/gate`
export const workflowCancelRoute = (runId: string) => `/v2/p/workflows/workflows/runs/${runId}/cancel`
export const workflowKillRoute = (runId: string) => `/v2/p/workflows/workflows/runs/${runId}/kill`
export const workflowTriggerPollRoute = '/v2/p/workflows/workflows/triggers/poll'

type Defs = { workflows: WorkflowDefSummary[]; errors: { source: string; message: string }[] }

export const workflowApi = {
  defs: (taskId: string) => readJson<Defs>(workflowDefsRoute(taskId)),
  runs: (taskId: string) => readJson<WorkflowRunRow[]>(workflowRunsRoute(taskId)),
  steps: (runId: string) => readJson<WorkflowStepRow[]>(workflowStepsRoute(runId)),
  gate: (runId: string, stepId: string, approved: boolean) =>
    writeJson<{ ok: boolean }>(workflowGateRoute(runId), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ stepId, approved }) }),
  cancel: (runId: string) => writeJson<{ ok: boolean }>(workflowCancelRoute(runId), { method: 'POST' }),
  kill: (runId: string, stepId: string) =>
    writeJson<{ ok: boolean }>(workflowKillRoute(runId), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ stepId }),
    }),
  pollTriggers: () => writeJson<{ started: number; errors: string[] }>(workflowTriggerPollRoute, { method: 'POST' }),
  // Keeps the {runId?, error?} contract the palette expects — a thrown HTTP error becomes {error}.
  start: async (taskId: string, def: unknown): Promise<{ runId?: string; error?: string }> => {
    const execute = () => writeJson<{ runId?: string; error?: string }>(workflowStartRoute(taskId), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ def }),
    })
    try {
      const result = await execute()
      if (result.error === 'needs-trust') openRepoConfigTrust(taskId, execute)
      return result
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'Failed to start workflow.' }
    }
  },
}
