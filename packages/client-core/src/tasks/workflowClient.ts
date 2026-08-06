// Workflow control over loopback HTTP: was `window.acorn.terminal.workflow`'s
// defs/start/runs/steps/gate. The `onNotice` push stays on the terminal bridge until the WebSocket
// lands (the WebSocket transport). Needs the main-process WorkflowRunner, so it 503s in dev:node (desktop-only).
//
// It lived in plugins/agents until Phase 3, which made `workflows -> agents` a coupling edge for the
// plugin that owns these very routes. The obvious home — `plugins/workflows/src/contract/` — is NOT
// available, and the reason is worth recording rather than rediscovering: workflows already imports
// agents' `sessionExecute` contract on the node side, so an agents -> workflows edge closes a package
// CYCLE. tools/arch/boundaries.test.ts rejects that outright, and turbo's `topo` transit node needs an
// acyclic graph to order tasks at all. Contract status does not help: the acyclicity rule reads the raw
// package graph, as it must.
//
// So it sits beside runClient.ts, on the same reasoning that keeps every one of these route strings in
// @acorn/protocol/api.ts already: the wire surface is shared vocabulary, and three plugins plus the shell
// drive workflows. What is NOT settled by this move is which plugin should be FETCHING workflow data in
// the first place — plugins/agents' task sidebar still merges workflow steps into its own roster, which
// plugins.md says belongs in a task-activity slot. That is the coupling this file's location works around;
// closing it properly is the slot work, not a file move.
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
