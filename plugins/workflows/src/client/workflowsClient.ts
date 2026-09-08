// The workflow control client, and the routes it drives.
//
// Lives in contract/ rather than client/ because plugins/agents' task sidebar calls it as well as
// this plugin's own palette rows, and contract/ is the one sanctioned cross-plugin surface
// (docs/plugins.md § Package shape). It reads only client-core and protocol's workflow row types,
// never this plugin's own client/, so transitive contract purity holds.
//
// Commands use HTTP. Workflow notices and step events use the shared WebSocket.

import { openRepoConfigTrust, readJson, writeJson } from '@acorn/plugin-api/client'
import type { AgentProviderDescriptor } from '@acorn/protocol/managedAgents.ts'
import type { RunRowInput } from '@acorn/protocol/runs.ts'
import type { WorkflowDefRow, WorkflowDefSummary, WorkflowRunRow, WorkflowStepRow } from '@acorn/protocol/workflow.ts'
import type { WorkflowCatalog } from '../shared/workflowContracts'

export type { WorkflowDefRow, WorkflowDefSummary, WorkflowRunRow, WorkflowStepRow } from '@acorn/protocol/workflow.ts'

// Task-scoped defs/start/runs and run-scoped steps/gates.
export const workflowTaskDefsRoute = (taskId: string) => `/v2/p/workflows/tasks/${taskId}/workflows`
export const workflowStartRoute = (taskId: string) => `/v2/p/workflows/tasks/${taskId}/workflows`
export const workflowRunsRoute = (taskId: string) => `/v2/p/workflows/tasks/${taskId}/workflows/runs`
export const workflowStepsRoute = (runId: string) => `/v2/p/workflows/workflows/runs/${runId}/steps`
export const workflowGateRoute = (runId: string) => `/v2/p/workflows/workflows/runs/${runId}/gate`
export const workflowCancelRoute = (runId: string) => `/v2/p/workflows/workflows/runs/${runId}/cancel`
export const workflowKillRoute = (runId: string) => `/v2/p/workflows/workflows/runs/${runId}/kill`
// Every run on this node, the same route core's merged run list reads.
export const workflowAllRunsRoute = '/v2/p/workflows/runs'
// Definitions stored as rows (docs/workflows.md § Database definitions). Device-only on the node, so
// these answer 403 to anything but the app.
export const workflowDefsRoute = '/v2/p/workflows/defs'
export const workflowDefRoute = (id: string) => `${workflowDefsRoute}/${id}`
export const workflowDefValidateRoute = `${workflowDefsRoute}/validate`
export const workflowSaveToRepoRoute = (id: string) => `${workflowDefsRoute}/${id}/save-to-repo`
// Every step kind, policy and profile this node can run, with the form each kind draws. The editor's
// Add menu and its inspector are both built from it (../shared/workflowContracts.ts § WorkflowCatalog).
export const workflowCatalogRoute = '/v2/p/workflows/catalog'
// The harnesses, with the config options each one advertises. Read from the agents plugin's own route
// rather than copied into the catalog, so the editor's model and reasoning lists are the same lists the
// agent pane offers (docs/managed-agents.md § Providers).
export const agentProvidersRoute = '/v2/p/agents/providers'

type Defs = { workflows: WorkflowDefSummary[]; errors: { source: string; message: string }[] }

const post = <T>(path: string, body: unknown, method: 'POST' | 'PUT' = 'POST') =>
  writeJson<T>(path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

export const workflowApi = {
  defs: (taskId: string) => readJson<Defs>(workflowTaskDefsRoute(taskId)),
  runs: (taskId: string) => readJson<WorkflowRunRow[]>(workflowRunsRoute(taskId)),
  steps: (runId: string) => readJson<WorkflowStepRow[]>(workflowStepsRoute(runId)),
  gate: (runId: string, stepId: string, approved: boolean) => post<{ ok: boolean }>(workflowGateRoute(runId), { stepId, approved }),
  cancel: (runId: string) => writeJson<{ ok: boolean }>(workflowCancelRoute(runId), { method: 'POST' }),
  kill: (runId: string, stepId: string) => post<{ ok: boolean }>(workflowKillRoute(runId), { stepId }),
  // Keeps the {runId?, error?} contract the palette expects. A thrown HTTP error becomes {error}.
  // `body` is either the whole definition or `{ defId }`; the node resolves the second itself, which
  // is what lets it apply the repo trust snapshot to a committed file.
  start: async (taskId: string, body: { def: unknown } | { defId: string }, inputs?: Record<string, string>): Promise<{ runId?: string; error?: string }> => {
    const execute = () => post<{ runId?: string; error?: string }>(workflowStartRoute(taskId), { ...body, ...(inputs ? { inputs } : {}) })
    try {
      const result = await execute()
      if (result.error === 'needs-trust') openRepoConfigTrust(taskId, execute)
      return result
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'Failed to start workflow.' }
    }
  },
  // The merged list for a workspace: rows, every project's committed files, and the user layer.
  defsList: (workspaceId: string) => readJson<Defs>(`${workflowDefsRoute}?workspaceId=${encodeURIComponent(workspaceId)}`),
  // A row by id, or a committed file addressed as `repo:<fileId>` / `user:<fileId>`. A file answers
  // with `revision: 0`, which is how the editor knows it is read-only.
  def: (id: string, projectId?: string) =>
    readJson<WorkflowDefRow>(`${workflowDefRoute(encodeURIComponent(id))}${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''}`),
  catalog: (projectId?: string) =>
    readJson<WorkflowCatalog>(`${workflowCatalogRoute}${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''}`),
  providers: () => readJson<AgentProviderDescriptor[]>(agentProvidersRoute),
  // Every run on this node, as this plugin's contribution to the merged run list. The rail narrows it
  // to the workspace's tasks, because the route is node-wide by construction (@acorn/protocol/runs.ts).
  allRuns: () => readJson<{ runs: RunRowInput[] }>(workflowAllRunsRoute),
  // A select field's own options, from the route its `describe` named. The host substitutes the two
  // placeholders and the contributing plugin answers `{ options }` (docs/workflows.md § Contributed
  // step kinds).
  fieldOptions: (route: string) => readJson<{ options: { value: string; label: string; description?: string }[] }>(route),
  createDef: (input: { workspaceId: string; projectId?: string; def: unknown }) => post<WorkflowDefRow>(workflowDefsRoute, input),
  updateDef: (id: string, def: unknown, revision: number) => post<WorkflowDefRow>(workflowDefRoute(id), { def, revision }, 'PUT'),
  deleteDef: (id: string) => writeJson<{ ok: boolean }>(workflowDefRoute(id), { method: 'DELETE' }),
  validateDef: (def: unknown, projectId?: string) => post<{ problems: string[] }>(workflowDefValidateRoute, { def, projectId }),
  saveDefToRepo: (id: string, opts: { taskId?: string; keepRow?: boolean }) => post<{ path: string }>(workflowSaveToRepoRoute(id), opts),
}
