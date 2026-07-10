// Workflow control over loopback HTTP (Phase 3): was `window.acorn.terminal.workflow`'s
// defs/start/runs/steps/gate. The `onNotice` push stays on the terminal bridge until the WebSocket
// lands (slice 6). Needs the main-process WorkflowRunner, so it 503s in dev:node (desktop-only).
import { workflowDefsRoute, workflowGateRoute, workflowRunsRoute, workflowStartRoute, workflowStepsRoute } from '../../../shared/api'
import { readJson, writeJson } from '../../apiClient'
import type { WorkflowDefSummary, WorkflowRunRow, WorkflowStepRow } from '../terminal/terminalClient'

export type { WorkflowDefSummary, WorkflowRunRow, WorkflowStepRow } from '../terminal/terminalClient'

type Defs = { workflows: WorkflowDefSummary[]; errors: { source: string; message: string }[] }

export const workflowApi = {
  defs: (taskId: string) => readJson<Defs>(workflowDefsRoute(taskId)),
  runs: (taskId: string) => readJson<WorkflowRunRow[]>(workflowRunsRoute(taskId)),
  steps: (runId: string) => readJson<WorkflowStepRow[]>(workflowStepsRoute(runId)),
  gate: (runId: string, stepId: string, approved: boolean) =>
    writeJson<{ ok: boolean }>(workflowGateRoute(runId), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ stepId, approved }) }),
  // Keeps the {runId?, error?} contract the palette expects — a thrown HTTP error becomes {error}.
  start: async (taskId: string, def: unknown): Promise<{ runId?: string; error?: string }> => {
    try {
      return await writeJson<{ runId?: string }>(workflowStartRoute(taskId), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ def }),
      })
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'Failed to start workflow.' }
    }
  },
}
