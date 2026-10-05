// Task writes (docs/workspaces-and-tasks.md). Core owns tasks: they are the workspace's unit of
// work, not a GitHub concept, and every route helper below lives in protocol. Callers invalidate
// tasksKey after.
//
// The review-note writes that used to sit alongside these moved to
// plugins/changes/src/client/reviewNoteMutations.ts: they are the changes pane's, and keeping them
// here meant core held that plugin's routes.
import { postJson, writeJson } from '../../infra/node/apiClient'
import {
  type Task,
  type TaskSeed,
  taskLinksRoute,
  taskRoute,
  tasksRoute,
  type TaskLink,
  type TaskLinkSeed,
} from '@acorn/protocol/api.ts'
import { taskBridge } from './taskBridge'

// Create from a seed (docs/workspaces-and-tasks.md). Callers invalidate tasksKey after.
export const createTask = async (seed: TaskSeed, nodeId?: string | null) => {
  const task = await writeJson<Task>(tasksRoute, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(seed), nodeId,
  })
  // Let the node run the repo's setup script now if it's configured to run on task creation (no-op
  // otherwise). Fire-and-forget so task creation isn't blocked on git/worktree.
  void taskBridge().task.onCreated(task.id, nodeId)
  return task
}

export async function patchTask(id: string, body: { title?: string; icon?: string | null; status?: 'active' | 'archived'; pullNumber?: number | null }, nodeId?: string | null) {
  return writeJson<unknown>(taskRoute(id), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    nodeId,
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
