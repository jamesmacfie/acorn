// Task and review-note writes (docs/workspaces-and-tasks.md, docs/panes.md). Core owns tasks — they are
// the workspace's unit of work, not a GitHub concept — and every route helper below already lives in
// core/shared/api.ts. Callers invalidate tasksKey / reviewNotesKey(taskId) after.
//
// createTask / createCheckoutTask live with the desktop task bridge instead: they have to reach the
// main process after the row is written (setup script, checkout borrow).
import { postJson, writeJson } from '../apiClient'
import {
  reviewNoteRoute,
  reviewNotesRoute,
  reviewNotesSentRoute,
  type ReviewNote,
  type ReviewNoteSeed,
  taskLinksRoute,
  taskRoute,
  type TaskLink,
  type TaskLinkSeed,
} from '../../shared/api'

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
