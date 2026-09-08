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
import type { WorkflowGenerateRequest, WorkflowGenerateResult } from '../shared/api'
import type { WorkflowCatalog } from '../shared/workflowContracts'

/** How long the generate route may take: two model calls at the runtime's 60-second ceiling, and
 *  half a minute for the prompt, the checker and the wire. Not the broker's 30-second default, which
 *  one model call already outlives. */
const GENERATE_TIMEOUT_MS = 150_000

export type { WorkflowDefRow, WorkflowDefSummary, WorkflowRunRow, WorkflowStepRow } from '@acorn/protocol/workflow.ts'

// Task-scoped defs/start/runs and run-scoped steps/gates.
export const workflowTaskDefsRoute = (taskId: string) => `/v2/p/workflows/tasks/${taskId}/workflows`
export const workflowStartRoute = (taskId: string) => `/v2/p/workflows/tasks/${taskId}/workflows`
export const workflowRunsRoute = (taskId: string) => `/v2/p/workflows/tasks/${taskId}/workflows/runs`
export const workflowStepsRoute = (runId: string) => `/v2/p/workflows/workflows/runs/${runId}/steps`
export const workflowGateRoute = (runId: string) => `/v2/p/workflows/workflows/runs/${runId}/gate`
export const workflowCancelRoute = (runId: string) => `/v2/p/workflows/workflows/runs/${runId}/cancel`
export const workflowKillRoute = (runId: string) => `/v2/p/workflows/workflows/runs/${runId}/kill`
export const workflowRetryRoute = (runId: string) => `/v2/p/workflows/workflows/runs/${runId}/retry`
// Which run a managed agent session belongs to, for the agent pane's chip.
export const workflowSessionRunRoute = (sessionId: string) => `/v2/p/workflows/sessions/${sessionId}/run`
// Every run on this node, the same route core's merged run list reads.
export const workflowAllRunsRoute = '/v2/p/workflows/runs'
// Definitions stored as rows (docs/workflows.md § Database definitions). Device-only on the node, so
// these answer 403 to anything but the app.
export const workflowDefsRoute = '/v2/p/workflows/defs'
export const workflowDefRoute = (id: string) => `${workflowDefsRoute}/${id}`
export const workflowDefValidateRoute = `${workflowDefsRoute}/validate`
// A whole definition written from a description (docs/workflows.md § Authoring).
export const workflowDefGenerateRoute = `${workflowDefsRoute}/generate`
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

// A read addressed at one node rather than the active one. The attention inbox fans out over the
// whole fleet, so its source must say which node it is asking (client-core registries/attention.ts).
type At = { nodeId?: string; signal?: AbortSignal }

export const workflowApi = {
  defs: (taskId: string) => readJson<Defs>(workflowTaskDefsRoute(taskId)),
  runs: (taskId: string) => readJson<WorkflowRunRow[]>(workflowRunsRoute(taskId)),
  steps: (runId: string, at: At = {}) => readJson<WorkflowStepRow[]>(workflowStepsRoute(runId), at),
  gate: (runId: string, stepId: string, approved: boolean) => post<{ ok: boolean }>(workflowGateRoute(runId), { stepId, approved }),
  cancel: (runId: string) => writeJson<{ ok: boolean }>(workflowCancelRoute(runId), { method: 'POST' }),
  kill: (runId: string, stepId: string) => post<{ ok: boolean }>(workflowKillRoute(runId), { stepId }),
  // A failed or safety-railed node, back to pending, and the run back to running. Device-only on the
  // node: a retry that an agent could ask for is a loop around the rail that stopped it.
  retry: (runId: string, stepId: string, prompt?: string) =>
    post<{ ok: boolean; error?: string }>(workflowRetryRoute(runId), { stepId, ...(prompt ? { prompt } : {}) }),
  runForSession: (sessionId: string) =>
    readJson<{ run: WorkflowRunRow; step: WorkflowStepRow } | null>(workflowSessionRunRoute(sessionId)),
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
  allRuns: (at: At = {}) => readJson<{ runs: RunRowInput[] }>(workflowAllRunsRoute, at),
  // A select field's own options, from the route its `describe` named. The host substitutes the two
  // placeholders and the contributing plugin answers `{ options }` (docs/workflows.md § Contributed
  // step kinds).
  fieldOptions: (route: string) => readJson<{ options: { value: string; label: string; description?: string }[] }>(route),
  createDef: (input: { workspaceId: string; projectId?: string; def: unknown }) => post<WorkflowDefRow>(workflowDefsRoute, input),
  updateDef: (id: string, def: unknown, revision: number) => post<WorkflowDefRow>(workflowDefRoute(id), { def, revision }, 'PUT'),
  deleteDef: (id: string) => writeJson<{ ok: boolean }>(workflowDefRoute(id), { method: 'DELETE' }),
  validateDef: (def: unknown, projectId?: string) => post<{ problems: string[] }>(workflowDefValidateRoute, { def, projectId }),
  saveDefToRepo: (id: string, opts: { taskId?: string; keepRow?: boolean }) => post<{ path: string }>(workflowSaveToRepoRoute(id), opts),
  // The one call here that says how long it may take, because the broker's default kills it first.
  generateDef: (input: WorkflowGenerateRequest) =>
    writeJson<WorkflowGenerateResult>(workflowDefGenerateRoute, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
      timeoutMs: GENERATE_TIMEOUT_MS,
    }),
}
