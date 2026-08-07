import {
  workflowCancelRoute,
  workflowDefsRoute,
  workflowGateRoute,
  workflowKillRoute,
  workflowRunsRoute,
  workflowStartRoute,
  workflowStepsRoute,
  workflowTriggerPollRoute,
} from '@acorn/protocol/api.ts'
import { readJson, writeJson } from '../apiClient'
import type { WorkflowDefSummary, WorkflowRunRow, WorkflowStepRow } from '@acorn/protocol/workflow.ts'
import { openRepoConfigTrust } from '../configTrust/configTrust'

export type { WorkflowDefSummary, WorkflowRunRow, WorkflowStepRow } from '@acorn/protocol/workflow.ts'

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
