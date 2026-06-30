// PR write actions. Same-origin POST (cookie auth; the Worker's csrf() checks Origin). Throws the
// structured error code on failure so callers can branch (e.g. merge_failed, reauth).
import { apiError, writeJson } from './apiClient'
import {
  autoMergeRoute,
  createPullRoute,
  type IntegrationsStatus,
  type LinearCommentRequest,
  linearCommentsRoute,
  linearIntegrationRoute,
  pinsRoute,
  prefsRoute,
  pullRoute,
  taskRoute,
  tasksRoute,
  type Task,
  type TaskSeed,
  type Workspace,
  workspaceRoute,
  workspacesRoute,
  workspaceBootstrapRoute,
  workspaceReposRoute,
  workspaceIgnoreRepoRoute,
  workspaceUnignoreRepoRoute,
  workspaceIgnoreAllRoute,
  workspaceLinearProjectsRoute,
  rerunFailedRoute,
  requestedReviewersRoute,
  resolveThreadRoute,
} from '../shared/api'

const post = async <T>(url: string, body?: unknown): Promise<T> => {
  return writeJson<T>(url, {
    method: 'POST',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

export const createPr = (o: string, r: string, input: { title: string; body: string; base: string; head: string; draft: boolean }) =>
  post<{ number: number }>(createPullRoute(o, r), input)

export const mergePr = (o: string, r: string, n: string, method: string) => post(pullRoute(o, r, n, 'merge'), { method })
export const enableAutoMerge = (o: string, r: string, n: string, method: string) => post(autoMergeRoute(o, r, n), { method })
export const disableAutoMerge = async (o: string, r: string, n: string) => {
  const res = await fetch(autoMergeRoute(o, r, n), { method: 'DELETE' })
  if (!res.ok) throw new Error(await apiError(res, `${res.status}`))
  return res.json()
}
export const closePr = (o: string, r: string, n: string) => post(pullRoute(o, r, n, 'close'))
export const reopenPr = (o: string, r: string, n: string) => post(pullRoute(o, r, n, 'reopen'))
export const setDraft = (o: string, r: string, n: string, draft: boolean) => post(pullRoute(o, r, n, 'draft'), { draft })
export const addComment = (o: string, r: string, n: string, body: string) => post<{ id: string }>(pullRoute(o, r, n, 'comments'), { body })
export const submitReview = (o: string, r: string, n: string, event: string, body: string) =>
  post(pullRoute(o, r, n, 'reviews'), { event, body })

export const addLabel = (o: string, r: string, n: string, name: string) => post(pullRoute(o, r, n, 'labels'), { name })

// Save a Linear API key (server validates it against Linear before storing). Throws 'invalid_key'.
export const connectLinear = (apiKey: string) => post<IntegrationsStatus>(linearIntegrationRoute, { apiKey })
export const disconnectLinear = async () => {
  const res = await fetch(linearIntegrationRoute, { method: 'DELETE' })
  if (!res.ok) throw new Error(await apiError(res, `${res.status}`))
}
// Add a comment / threaded reply to a Linear ticket; caller refetches the issue after.
export const postLinearComment = (identifier: string, body: string, parentId?: string) =>
  post<{ ok: true }>(linearCommentsRoute(identifier), { body, parentId } satisfies LinearCommentRequest)
export const removeLabel = async (o: string, r: string, n: string, name: string) => {
  const res = await fetch(pullRoute(o, r, n, 'labels'), {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  if (!res.ok) throw new Error(await apiError(res, `${res.status}`))
  return res.json()
}

export const requestReviewer = (o: string, r: string, n: string, login: string) =>
  post(requestedReviewersRoute(o, r, n), { login })
export const removeReviewer = async (o: string, r: string, n: string, login: string) => {
  const res = await fetch(requestedReviewersRoute(o, r, n), {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login }),
  })
  if (!res.ok) throw new Error(await apiError(res, `${res.status}`))
  return res.json()
}

// Inline review threads.
export const addReviewComment = (o: string, r: string, n: string, body: string, path: string, line: number, side: string) =>
  post(pullRoute(o, r, n, 'review-comments'), { body, path, line, side })
export const replyReview = (o: string, r: string, n: string, commentDatabaseId: number, body: string) =>
  post(pullRoute(o, r, n, `review-comments/${commentDatabaseId}/replies`), { body })
export const resolveThread = (o: string, r: string, n: string, threadId: string, resolved: boolean) =>
  post(resolveThreadRoute(o, r, n, threadId), { resolved })

export const setViewed = (o: string, r: string, n: string, path: string, viewed: boolean) =>
  post(pullRoute(o, r, n, 'viewed'), { path, viewed })

// Rerun a check's failed Actions jobs. Repo-scoped (keyed by the workflow run id, not the PR).
export const rerunFailed = (o: string, r: string, runId: number) => post(rerunFailedRoute(o, r, runId))

export const setPin = async (repoId: number, pinned: boolean) => {
  return writeJson<{ repoId: number; pinned: boolean }>(pinsRoute, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repoId, pinned }),
  }, (res) => `pins ${res.status}`)
}

// Workspaces (named groups of repos). Callers invalidate workspacesKey after.
export const bootstrapWorkspaces = () => post<Workspace[]>(workspaceBootstrapRoute)
export const createWorkspace = (name: string) => post<Workspace>(workspacesRoute, { name })
export const renameWorkspace = async (id: string, name: string) =>
  writeJson<{ ok: true }>(workspaceRoute(id), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }, (res) => `workspace ${res.status}`)
export const deleteWorkspace = async (id: string) =>
  writeJson<{ ok: true }>(workspaceRoute(id), { method: 'DELETE' }, (res) => `workspace ${res.status}`)
// Move a repo into a workspace (partition; upsert on owner/repo). Also un-ignores it.
export const setRepoWorkspace = (workspaceId: string, owner: string, name: string) =>
  post<{ ok: true }>(workspaceReposRoute(workspaceId), { owner, name })
// Hide a repo (keeps its workspace membership; excluded from selector/rail/scoping). Reversible.
export const ignoreRepo = (owner: string, name: string) => post<{ ok: true }>(workspaceIgnoreRepoRoute, { owner, name })
export const unignoreRepo = (owner: string, name: string) => post<{ ok: true }>(workspaceUnignoreRepoRoute, { owner, name })
// Hide or show every repo at once (onboarding master toggle).
export const setAllReposIgnored = (ignored: boolean) => post<{ ok: true }>(workspaceIgnoreAllRoute, { ignored })
export const setWorkspaceLinearProjects = async (workspaceId: string, projectIds: string[]) =>
  writeJson<{ ok: true }>(workspaceLinearProjectsRoute(workspaceId), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectIds }) }, (res) => `linear-projects ${res.status}`)

// Tasks (docs/workspaces). Create from a seed; rename/archive via PATCH. Callers invalidate
// tasksKey after.
export const createTask = (seed: TaskSeed) => post<Task>(tasksRoute, seed)
export const renameTask = async (id: string, title: string) => patchTask(id, { title })
export const archiveTask = async (id: string) => patchTask(id, { status: 'archived' })
async function patchTask(id: string, body: { title?: string; status?: 'active' | 'archived' }) {
  return writeJson<unknown>(taskRoute(id), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, (res) => `task ${res.status}`)
}

export const setPref = async (key: string, value: string) => {
  return writeJson<{ key: string; value: string }>(prefsRoute, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, value }),
  }, (res) => `prefs ${res.status}`)
}
