// PR write actions. Same-origin POST (cookie auth; the Worker's csrf() checks Origin). Throws the
// structured error code on failure so callers can branch (e.g. merge_failed, reauth).
import { ApiError, apiError, writeJson } from '../../../core/client/apiClient'
import { terminalApi } from '../../terminal/client/terminalClient'
import {
  autoMergeRoute,
  createPullRoute,
  type LinearCommentRequest,
  linearCommentsRoute,
  pinsRoute,
  prefsRoute,
  pullRoute,
  reviewNoteRoute,
  reviewNotesRoute,
  reviewNotesSentRoute,
  type ReviewNote,
  type ReviewNoteSeed,
  taskLinksRoute,
  taskRoute,
  tasksRoute,
  type TaskLink,
  type TaskLinkSeed,
  type BrowserRule,
  type DbSchemaMode,
  type PreviewMode,
  type SetupTrigger,
  type Task,
  type TaskSeed,
  type Workspace,
  type WorkspaceIcon,
  workspaceRoute,
  workspacesRoute,
  workspaceBootstrapRoute,
  workspaceReposRoute,
  workspaceIgnoreRepoRoute,
  workspaceUnignoreRepoRoute,
  workspaceIgnoreAllRoute,
  rerunFailedRoute,
  requestedReviewersRoute,
  resolveThreadRoute,
} from '../../../core/shared/api'

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
  if (!res.ok) throw new ApiError(await apiError(res, `${res.status}`), res.status)
  return res.json()
}
export const closePr = (o: string, r: string, n: string) => post(pullRoute(o, r, n, 'close'))
export const reopenPr = (o: string, r: string, n: string) => post(pullRoute(o, r, n, 'reopen'))
export const setDraft = (o: string, r: string, n: string, draft: boolean) => post(pullRoute(o, r, n, 'draft'), { draft })
export const addComment = (o: string, r: string, n: string, body: string) => post<{ id: string }>(pullRoute(o, r, n, 'comments'), { body })
export const submitReview = (o: string, r: string, n: string, event: string, body: string) =>
  post(pullRoute(o, r, n, 'reviews'), { event, body })

export const addLabel = (o: string, r: string, n: string, name: string) => post(pullRoute(o, r, n, 'labels'), { name })

// Add a comment / threaded reply to a Linear ticket; caller refetches the issue after.
export const postLinearComment = (identifier: string, body: string, parentId?: string, connectionId?: string) =>
  post<{ ok: true }>(linearCommentsRoute(identifier, connectionId), { body, parentId } satisfies LinearCommentRequest)
export const removeLabel = async (o: string, r: string, n: string, name: string) => {
  const res = await fetch(pullRoute(o, r, n, 'labels'), {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  if (!res.ok) throw new ApiError(await apiError(res, `${res.status}`), res.status)
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
  if (!res.ok) throw new ApiError(await apiError(res, `${res.status}`), res.status)
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
// Per-workspace worktree setup script (blank ⇒ cleared server-side).
export const setWorkspaceSetupScript = async (id: string, setupScript: string) =>
  writeJson<{ ok: true }>(workspaceRoute(id), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ setupScript }) }, (res) => `workspace ${res.status}`)
// Per-workspace "run dev" command → a `dev` run target in the pane-switcher (blank ⇒ cleared, no button).
export const setWorkspaceDevScript = async (id: string, devScript: string) =>
  writeJson<{ ok: true }>(workspaceRoute(id), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ devScript }) }, (res) => `workspace ${res.status}`)
// Per-workspace restart command for the `dev` run target (blank ⇒ cleared server-side → run_restart falls back to stop+start).
export const setWorkspaceDevRestartScript = async (id: string, devRestartScript: string) =>
  writeJson<{ ok: true }>(workspaceRoute(id), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ devRestartScript }) }, (res) => `workspace ${res.status}`)
// Per-workspace worktree teardown script (docs/terminal-and-agents.md; blank ⇒ cleared server-side).
export const setWorkspaceTeardownScript = async (id: string, teardownScript: string) =>
  writeJson<{ ok: true }>(workspaceRoute(id), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ teardownScript }) }, (res) => `workspace ${res.status}`)
// Per-workspace Database-pane connection script (docs/pg.md; blank ⇒ cleared → auto-detect).
export const setWorkspaceDbUrlScript = async (id: string, dbUrlScript: string) =>
  writeJson<{ ok: true }>(workspaceRoute(id), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dbUrlScript }) }, (res) => `workspace ${res.status}`)
// Where the Database pane's AI-generation schema comes from: '' (live introspection), 'script', or 'file'.
export const setWorkspaceDbSchemaSource = async (id: string, dbSchemaMode: DbSchemaMode | '', dbSchemaValue: string) =>
  writeJson<{ ok: true }>(workspaceRoute(id), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dbSchemaMode, dbSchemaValue }) }, (res) => `workspace ${res.status}`)
// When the setup script runs: off / on task creation / on first terminal open.
export const setWorkspaceSetupTrigger = async (id: string, setupScriptTrigger: SetupTrigger) =>
  writeJson<{ ok: true }>(workspaceRoute(id), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ setupScriptTrigger }) }, (res) => `workspace ${res.status}`)
// How the browser-preview pane resolves its URL: '' (dev-server port), 'url', 'port', or 'script'.
export const setWorkspacePreview = async (id: string, previewMode: PreviewMode | '', previewValue: string) =>
  writeJson<{ ok: true }>(workspaceRoute(id), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ previewMode, previewValue }) }, (res) => `workspace ${res.status}`)
// Preview-browser page rules (docs/panes.md): whole-array replace; empty ⇒ cleared server-side.
export const setWorkspaceBrowserRules = async (id: string, browserRules: BrowserRule[]) =>
  writeJson<{ ok: true }>(workspaceRoute(id), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ browserRules }) }, (res) => `workspace ${res.status}`)
// Workspace identity (docs/workspaces-and-tasks.md): icon (null clears) + colour (preset token or hex; null clears).
export const setWorkspaceIcon = async (id: string, icon: WorkspaceIcon | null) =>
  writeJson<{ ok: true }>(workspaceRoute(id), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ icon }) }, (res) => `workspace ${res.status}`)
export const setWorkspaceColor = async (id: string, color: string | null) =>
  writeJson<{ ok: true }>(workspaceRoute(id), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ color }) }, (res) => `workspace ${res.status}`)
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
// Tasks (docs/workspaces-and-tasks.md). Create from a seed; rename/archive via PATCH. Callers invalidate
// tasksKey after.
export const createTask = async (seed: TaskSeed) => {
  const task = await post<Task>(tasksRoute, seed)
  // Desktop: let main run the workspace's setup script now if it's configured to run on task
  // creation (no-op otherwise). Fire-and-forget so task creation isn't blocked on git/worktree.
  void terminalApi()?.task.onCreated(task.id)
  return task
}
// Create a task that borrows the mapped checkout (current dir + current branch) instead of an
// isolated worktree. Awaits useCheckout (not onCreated) so no worktree is ever created; without the
// desktop bridge it degrades to a normal local task on the seed branch. Callers invalidate tasksKey.
export const createCheckoutTask = async (seed: TaskSeed) => {
  const task = await post<Task>(tasksRoute, seed)
  const patch = await terminalApi()?.task.useCheckout(task.id)
  return patch ? { ...task, ...patch } : task
}
// Local review notes (docs/panes.md). Callers invalidate reviewNotesKey(taskId) after.
export const addReviewNote = (taskId: string, seed: ReviewNoteSeed) => post<ReviewNote>(reviewNotesRoute(taskId), seed)
export const editReviewNote = (taskId: string, noteId: string, body: string) =>
  writeJson<{ ok: true }>(reviewNoteRoute(taskId, noteId), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body }) })
export const deleteReviewNote = (taskId: string, noteId: string) =>
  writeJson<{ ok: true }>(reviewNoteRoute(taskId, noteId), { method: 'DELETE' })
export const markReviewNotesSent = (taskId: string, ids: string[]) => post<{ ok: true }>(reviewNotesSentRoute(taskId), { ids })

// Grow/shrink a task's links after creation (docs/workspaces-and-tasks.md). Callers invalidate tasksKey after.
export const addTaskLink = (id: string, link: TaskLinkSeed) => post<{ ok: boolean }>(taskLinksRoute(id), link)
export const removeTaskLink = (id: string, ref: Pick<TaskLink, 'connectionId' | 'identifier'>) =>
  writeJson<{ ok: boolean }>(taskLinksRoute(id), {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ref),
  })
export const renameTask = async (id: string, title: string) => patchTask(id, { title })
export const archiveTask = async (id: string) => patchTask(id, { status: 'archived' })
// Back-fill (or clear, with null) the PR linked to a task. Callers invalidate tasksKey after so
// pathForTask starts routing the task to its PR.
export const setTaskPull = async (id: string, pullNumber: number | null) => patchTask(id, { pullNumber })
async function patchTask(id: string, body: { title?: string; status?: 'active' | 'archived'; pullNumber?: number | null }) {
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
