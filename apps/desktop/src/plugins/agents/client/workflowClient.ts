// Workflow control over loopback HTTP: was `window.acorn.terminal.workflow`'s
// defs/start/runs/steps/gate. The `onNotice` push stays on the terminal bridge until the WebSocket
// lands (the WebSocket transport). Needs the main-process WorkflowRunner, so it 503s in dev:node (desktop-only).
import {
  workflowCancelRoute,
  workflowDefsRoute,
  workflowGateRoute,
  workflowKillRoute,
  workflowRunsRoute,
  workflowStartRoute,
  workflowStepsRoute,
  workflowTriggerPollRoute,
} from '../../../core/shared/api'
import { readJson, writeJson } from '../../../core/client/apiClient'
import type { WorkflowDefSummary, WorkflowRunRow, WorkflowStepRow } from '../../terminal/client/terminalClient'
import { openRepoConfigTrust } from '../../../core/client/configTrust/configTrust'

export type { WorkflowDefSummary, WorkflowRunRow, WorkflowStepRow } from '../../terminal/client/terminalClient'

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
