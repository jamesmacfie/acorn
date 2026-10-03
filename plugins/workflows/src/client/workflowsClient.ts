import type { AuthoringTurnRequest, AuthoringTurnResult } from '@acorn/protocol/authoring.ts'
import type { DataValue } from '@acorn/protocol/dataValues.ts'
// The workflow control client, and the routes it drives.
//
// Lives in contract/ rather than client/ because plugins/agents' task sidebar calls it as well as
// this plugin's own palette rows, and contract/ is the one sanctioned cross-plugin surface
// (docs/plugins/package-shape.md § Package shape). It reads only client-core and protocol's workflow row types,
// never this plugin's own client/, so transitive contract purity holds.
//
// Commands use HTTP. Workflow notices and step events use the shared WebSocket.

import type { QueryClient } from '@tanstack/solid-query'
import { activeNodeId, queryOwner, openRepoConfigTrust, readJson as readWorkflowJson, writeJson as writeWorkflowJson } from '@acorn/plugin-api/client'
import type { AgentProviderDescriptor } from '@acorn/plugin-agents/contract/wire.ts'
import type { RunRowInput } from '@acorn/protocol/runs.ts'
import type { WorkflowDefRow, WorkflowDefSummary, WorkflowRunRow, WorkflowStepRow } from '../contract/wire.ts'
import type { ModelBackend } from '@acorn/protocol/modelProviders.ts'
import type { WorkflowGenerateRequest, WorkflowGenerateResult, WorkflowRunProjection, WorkflowStepProjection, WorkflowTaskGroup } from '../shared/api'
import type { WorkflowCatalog } from '../shared/workflowContracts'
import type { WorkflowRecordAttempt, WorkflowRecordFilter, WorkflowRecordPage } from '../shared/workflowProcessing'
import type {
  WorkflowScheduleDraftInput,
  WorkflowScheduleFirstCheck,
  WorkflowSchedulePreparation,
  WorkflowScheduleView,
} from '../shared/workflowSchedules'

/** How long the generate route may take.
 *
 *  Two model calls, each held to 60 seconds by the model runtime, and on top of them the prompt
 *  build, the worked-example read, two checker passes and the wire. The slack is deliberate: being a
 *  few seconds short throws away a generation at the moment it would have landed. Nothing above here
 *  shortens it either. The broker honours the number it is handed and only falls back to 30 seconds,
 *  which one model call already outlives. */
const GENERATE_TIMEOUT_MS = 240_000

export type { WorkflowDefRow, WorkflowDefSummary, WorkflowRunRow, WorkflowStepRow } from '../contract/wire.ts'

// Task-scoped defs/start/runs and run-scoped steps/gates.
export const workflowTaskDefsRoute = (taskId: string) => `/v1/p/workflows/tasks/${taskId}/workflows`
export const workflowStartRoute = (taskId: string) => `/v1/p/workflows/tasks/${taskId}/workflows`
export const workflowRunsRoute = (taskId: string) => `/v1/p/workflows/tasks/${taskId}/workflows/runs`
export const workflowStepsRoute = (runId: string) => `/v1/p/workflows/workflows/runs/${runId}/steps`
export const workflowGateRoute = (runId: string) => `/v1/p/workflows/workflows/runs/${runId}/gate`
export const workflowCancelRoute = (runId: string) => `/v1/p/workflows/workflows/runs/${runId}/cancel`
export const workflowKillRoute = (runId: string) => `/v1/p/workflows/workflows/runs/${runId}/kill`
export const workflowRetryRoute = (runId: string) => `/v1/p/workflows/workflows/runs/${runId}/retry`
export const workflowRecordsRoute = (runId: string) => `/v1/p/workflows/workflows/runs/${runId}/records`
export const workflowRecordRoute = (runId: string, recordId: string) => `${workflowRecordsRoute(runId)}/${encodeURIComponent(recordId)}`
// Which run a managed agent session belongs to, for the agent pane's chip.
export const workflowSessionRunRoute = (sessionId: string) => `/v1/p/workflows/sessions/${sessionId}/run`
// Every run on this node, the same route core's merged run list reads.
export const workflowAllRunsRoute = '/v1/p/workflows/runs'
export const workflowTaskNavigationRoute = '/v1/p/workflows/workflows/task-navigation'
// Definitions stored as rows (docs/workflows/definitions.md § Database definitions). Device-only on the node, so
// these answer 403 to anything but the app.
export const workflowDefsRoute = '/v1/p/workflows/defs'
export const workflowDefRoute = (id: string) => `${workflowDefsRoute}/${id}`
export const workflowDefValidateRoute = `${workflowDefsRoute}/validate`
// A whole definition written from a description or edited from the current graph
// (docs/workflows/authoring.md § Authoring).
export const workflowDefGenerateRoute = `${workflowDefsRoute}/generate`
// What the owner can generate with — a stored key, or an agent CLI installed on this machine — for
// the Generate modal's picker. Device-only like the rest of `/defs`, and ids and labels only: no key
// ever leaves the node. The path keeps its old spelling, which only this client reads.
export const workflowModelBackendsRoute = `${workflowDefsRoute}/model-connections`
export const workflowSaveToRepoRoute = (id: string) => `${workflowDefsRoute}/${id}/save-to-repo`
// Every step kind, policy and profile this node can run, with the form each kind draws. The editor's
// Add menu and its inspector are both built from it (../shared/workflowContracts.ts § WorkflowCatalog).
export const workflowCatalogRoute = '/v1/p/workflows/catalog'
export const workflowSchedulesRoute = '/v1/p/workflows/workflows/schedules'
export const workflowScheduleRoute = (id: string) => `${workflowSchedulesRoute}/${encodeURIComponent(id)}`
// The harnesses, with the config options each one advertises. Read from the agents plugin's own route
// rather than copied into the catalog, so the editor's model and reasoning lists are the same lists the
// agent pane offers (docs/managed-agents/providers.md § Providers).
export const agentProvidersRoute = '/v1/p/agents/providers'

type Defs = { workflows: WorkflowDefSummary[]; errors: { source: string; message: string }[] }

type At = { nodeId?: string | null; signal?: AbortSignal }

/** Capture the QueryClient's Node. A registered null is the browser origin. */
export function createWorkflowApi(queryClient?: QueryClient) {
  const registered = queryClient ? queryOwner(queryClient) : undefined
  return workflowApiAt(registered === undefined ? activeNodeId() : registered)
}

function workflowApiAt(nodeId?: string | null) {
  const readJson: typeof readWorkflowJson = (path, options) =>
    readWorkflowJson(path, { ...options, ...(nodeId !== undefined ? { nodeId } : {}) })
  const writeJson: typeof writeWorkflowJson = (path, options) =>
    writeWorkflowJson(path, { ...options, ...(nodeId !== undefined ? { nodeId } : {}) })
  const post = <T>(path: string, body: unknown, method: 'POST' | 'PUT' = 'POST') =>
    writeJson<T>(path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return {
    schedules: () => readJson<WorkflowScheduleView[]>(workflowSchedulesRoute),
    schedule: (id: string) => readJson<WorkflowScheduleView>(workflowScheduleRoute(id)),
    scheduleDefaults: () => readJson<{ timezone: string }>(`${workflowSchedulesRoute}/defaults`),
    prepareSchedule: (input: WorkflowScheduleDraftInput) => post<WorkflowSchedulePreparation>(`${workflowSchedulesRoute}/prepare`, input),
    saveSchedule: (input: WorkflowScheduleDraftInput) => post<WorkflowScheduleView>(workflowSchedulesRoute, input),
    approveSchedule: (id: string, firstCheck: WorkflowScheduleFirstCheck, freshEpoch: boolean) =>
      post<WorkflowScheduleView>(`${workflowScheduleRoute(id)}/approve`, { firstCheck, freshEpoch }),
    pauseSchedule: (id: string, paused: boolean) => post<WorkflowScheduleView>(`${workflowScheduleRoute(id)}/pause`, { paused }),
    runScheduleNow: (id: string) => post<WorkflowScheduleView>(`${workflowScheduleRoute(id)}/run`, {}),
    deleteSchedule: (id: string) => writeJson<{ deleted: true }>(workflowScheduleRoute(id), { method: 'DELETE' }),
    files: (request: import('../shared/workflowFileAuthoring').WorkflowFileRequest) => post<import('../shared/workflowFileAuthoring').WorkflowFileResult>(`${workflowDefsRoute}/files`, request),
    preparePublication: (input: import('../shared/workflowPublication').WorkflowPublicationSelection) => post<import('../shared/workflowPublication').WorkflowPublication>(`${workflowDefsRoute}/publications/prepare`, input),
    publish: (id: string) => post<import('../shared/workflowPublication').WorkflowPublication>(`${workflowDefsRoute}/publications/${encodeURIComponent(id)}/publish`, {}),
    discardPublication: (id: string) => post<{ ok: boolean }>(`${workflowDefsRoute}/publications/${encodeURIComponent(id)}/discard`, {}),
    publications: (workspaceId: string) => readJson<import('../shared/workflowPublication').WorkflowPublication[]>(`${workflowDefsRoute}/publications?workspaceId=${encodeURIComponent(workspaceId)}`),
    defs: (taskId: string) => readJson<Defs>(workflowTaskDefsRoute(taskId)),
    runs: (taskId: string) => readJson<WorkflowRunProjection[]>(workflowRunsRoute(taskId)),
    steps: (runId: string, at: At = {}) => readJson<WorkflowStepProjection[]>(workflowStepsRoute(runId), at),
    // A 409 means another device answered first, and a 400 names each form field the node refused.
    gate: (runId: string, stepId: string, approved: boolean, values?: Record<string, DataValue | undefined>) =>
      post<{ ok: boolean }>(workflowGateRoute(runId), { stepId, approved, ...(values ? { values } : {}) }),
    cancel: (runId: string) => writeJson<{ ok: boolean }>(workflowCancelRoute(runId), { method: 'POST' }),
    kill: (runId: string, stepId: string) => post<{ ok: boolean }>(workflowKillRoute(runId), { stepId }),
    // A failed or safety-railed node, back to pending, and the run back to running. Device-only on the
    // node: a retry that an agent could ask for is a loop around the rail that stopped it.
    retry: (runId: string, stepId: string, prompt?: string) =>
      post<{ ok: boolean; error?: string }>(workflowRetryRoute(runId), { stepId, ...(prompt ? { prompt } : {}) }),
    records: (runId: string, input: { selectionId?: string; stepId?: string; after?: number; limit?: number; filter?: WorkflowRecordFilter } = {}) => {
      const query = new URLSearchParams()
      if (input.selectionId) query.set('selectionId', input.selectionId)
      if (input.stepId) query.set('stepId', input.stepId)
      if (input.after !== undefined) query.set('after', String(input.after))
      if (input.limit !== undefined) query.set('limit', String(input.limit))
      if (input.filter && input.filter !== 'all') query.set('filter', input.filter)
      const suffix = query.size ? `?${query}` : ''
      return readJson<WorkflowRecordPage>(`${workflowRecordsRoute(runId)}${suffix}`)
    },
    record: (runId: string, recordId: string) =>
      readJson<{ snapshot: DataValue; provenance: WorkflowRecordPage['provenance']; record: WorkflowRecordPage['records'][number] | null } | null>(workflowRecordRoute(runId, recordId)),
    recordAttempts: (runId: string, recordId: string, after?: string) => {
      const query = new URLSearchParams({ limit: '20' })
      if (after) query.set('after', after)
      return readJson<{ attempts: WorkflowRecordAttempt[]; next: string | null }>(`${workflowRecordRoute(runId, recordId)}/attempts?${query}`)
    },
    prepareReprocess: (runId: string, recordId: string) =>
      post<{ recordId: string; digest: string; previousAttemptId: string; title: string }>(`${workflowRecordRoute(runId, recordId)}/prepare-reprocess`, {}),
    reprocess: (runId: string, recordId: string, digest: string, requestId: string) =>
      post<{ selectionId: string; taskId: string; runId: string; state: string }>(`${workflowRecordRoute(runId, recordId)}/reprocess`, { digest, requestId }),
    runForSession: (sessionId: string) =>
      readJson<{ run: WorkflowRunRow; step: WorkflowStepRow } | null>(workflowSessionRunRoute(sessionId)),
    // Keeps the {runId?, error?} contract the palette expects. A thrown HTTP error becomes {error}.
    // `body` is either the whole definition or `{ defId }`; the node resolves the second itself, which
    // is what lets it apply the repo trust snapshot to a committed file.
    start: async (taskId: string, body: { def: unknown } | { defId: string }, inputs?: Record<string, DataValue>): Promise<{ runId?: string; error?: string }> => {
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
    taskNavigation: () => readJson<{ groups: WorkflowTaskGroup[] }>(workflowTaskNavigationRoute),
    // A select field's own options, from the route its `describe` named. The host substitutes the two
    // placeholders and the contributing plugin answers `{ options }` (docs/workflows/step-kinds.md § Contributed
    // step kinds).
    fieldOptions: (route: string) => readJson<{ options: { value: string; label: string; description?: string }[] }>(route),
    createDef: (input: { workspaceId: string; projectId?: string; def: unknown }) => post<WorkflowDefRow>(workflowDefsRoute, input),
    updateDef: (id: string, def: unknown, revision: number) => post<WorkflowDefRow>(workflowDefRoute(id), { def, revision }, 'PUT'),
    deleteDef: (id: string) => writeJson<{ ok: boolean }>(workflowDefRoute(id), { method: 'DELETE' }),
    validateDef: (def: unknown, projectId?: string) => post<{ problems: string[] }>(workflowDefValidateRoute, { def, projectId }),
    saveDefToRepo: (id: string, opts: { taskId?: string; keepRow?: boolean }) => post<{ path: string }>(workflowSaveToRepoRoute(id), opts),
    authoringTurn: (request: AuthoringTurnRequest, signal: AbortSignal) =>
      writeJson<AuthoringTurnResult>(`${workflowDefsRoute}/authoring/turn`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request),
        signal, timeoutMs: 11 * 60_000,
      }),
    modelBackends: () => readJson<ModelBackend[]>(workflowModelBackendsRoute),
    // The one call here that says how long it may take, because the broker's default kills it first.
    generateDef: (input: WorkflowGenerateRequest) =>
      writeJson<WorkflowGenerateResult>(workflowDefGenerateRoute, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
        timeoutMs: GENERATE_TIMEOUT_MS,
      }),
  }
}

// Event-driven callers without a model retain active-Node routing.
export const workflowApi = workflowApiAt()
