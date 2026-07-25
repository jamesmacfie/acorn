// Task and review-note writes (docs/workspaces-and-tasks.md, docs/panes.md). Core owns tasks — they are
// the workspace's unit of work, not a GitHub concept — and every route helper below already lives in
// core/shared/api.ts. Callers invalidate tasksKey / reviewNotesKey(taskId) after.
//
import { postJson, writeJson } from '../apiClient'
import {
  reviewNoteRoute,
  reviewNotesRoute,
  reviewNotesSentRoute,
  type ReviewNote,
  type ReviewNoteSeed,
  type Task,
  type TaskSeed,
  taskLinksRoute,
  taskRoute,
  tasksRoute,
  type TaskLink,
  type TaskLinkSeed,
} from '../../shared/api'
import { taskBridge } from './taskBridge'

// Create from a seed (docs/workspaces-and-tasks.md). Callers invalidate tasksKey after.
export const createTask = async (seed: TaskSeed) => {
  const task = await postJson<Task>(tasksRoute, seed)
  // Desktop: let main run the repo's setup script now if it's configured to run on task creation
  // (no-op otherwise). Fire-and-forget so task creation isn't blocked on git/worktree.
  void taskBridge()?.task.onCreated(task.id)
  return task
}

// Create a task that borrows the mapped checkout (current dir + current branch) instead of an
// isolated worktree. Awaits useCheckout (not onCreated) so no worktree is ever created; without the
// desktop bridge it degrades to a normal local task on the seed branch. Callers invalidate tasksKey.
export const createCheckoutTask = async (seed: TaskSeed) => {
  const task = await postJson<Task>(tasksRoute, seed)
  const patch = await taskBridge()?.task.useCheckout(task.id)
  return patch ? { ...task, ...patch } : task
}

export async function patchTask(id: string, body: { title?: string; status?: 'active' | 'archived'; pullNumber?: number | null }) {
  return writeJson<unknown>(taskRoute(id), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, (res) => `task ${res.status}`)
}

export const renameTask = async (id: string, title: string) => patchTask(id, { title })
export const archiveTask = async (id: string) => patchTask(id, { status: 'archived' })
// Back-fill (or clear, with null) the PR linked to a task. Callers invalidate tasksKey after so
// pathForTask starts routing the task to its PR.
export const setTaskPull = async (id: string, pullNumber: number | null) => patchTask(id, { pullNumber })

// Grow/shrink a task's links after creation (docs/workspaces-and-tasks.md). Callers invalidate tasksKey after.
export const addTaskLink = (id: string, link: TaskLinkSeed) => postJson<{ ok: boolean }>(taskLinksRoute(id), link)
export const removeTaskLink = (id: string, ref: Pick<TaskLink, 'connectionId' | 'identifier'>) =>
  writeJson<{ ok: boolean }>(taskLinksRoute(id), {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ref),
  })

// Local review notes (docs/panes.md): task-scoped, never sent to GitHub until the review is submitted.
export const addReviewNote = (taskId: string, seed: ReviewNoteSeed) => postJson<ReviewNote>(reviewNotesRoute(taskId), seed)
export const editReviewNote = (taskId: string, noteId: string, body: string) =>
  writeJson<{ ok: true }>(reviewNoteRoute(taskId, noteId), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body }) })
export const deleteReviewNote = (taskId: string, noteId: string) =>
  writeJson<{ ok: true }>(reviewNoteRoute(taskId, noteId), { method: 'DELETE' })
export const markReviewNotesSent = (taskId: string, ids: string[]) => postJson<{ ok: true }>(reviewNotesSentRoute(taskId), { ids })
