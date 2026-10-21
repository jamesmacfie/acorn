import type {
  ArchiveOpts,
  ArchiveResult,
  DeleteOpts,
  DeleteResult,
  RestoreOpts,
  RestoreResult,
  TaskArchiveConcern,
  TaskStatus,
} from '@acorn/protocol/task.ts'
import { taskIdsQuery } from '@acorn/protocol/task.ts'
import {
  projectConfigRoute,
  projectRunTargetsRoute,
  taskArchiveConcernsRoute,
  taskArchiveRoute,
  taskDeleteRoute,
  taskOnCreatedRoute,
  taskPreviewUrlRoute,
  taskRestoreRoute,
  taskStatusesRoute,
} from '@acorn/protocol/api.ts'
import type { ProjectConfigPatch, ProjectConfigResponse } from '@acorn/protocol/api.ts'
import { readJson, writeJson, type WriteInit } from '../../infra/node/apiClient'
import { createLogger } from '../../infra/telemetry/logger'

const log = createLogger('tasks')

export type TaskBridge = {
  project: {
    get(id: string): Promise<ProjectConfigResponse | null>
    runTargets(id: string, runTargets: string): Promise<ProjectConfigResponse>
    config(id: string, patch: ProjectConfigPatch): Promise<ProjectConfigResponse>
  }
  // Run a repo's browser-preview script in the task's worktree; stdout (trimmed) is the URL.
  previewUrl(taskId: string, script: string): Promise<{ ok: boolean; url?: string; reason?: string }>
  task: {
    archive(id: string, opts?: ArchiveOpts): Promise<ArchiveResult>
    // Every plugin's answer about archiving this task, asked once when the dialog opens. Never
    // rejects into the caller: a node that cannot answer means no plugin rows, not no dialog.
    archiveConcerns(id: string): Promise<TaskArchiveConcern[]>
    restore(id: string, opts?: RestoreOpts): Promise<RestoreResult>
    // Delete for good (docs/workspaces-and-tasks/archive.md § Deleting a task). An active task is
    // archived first with `opts`, which needs the terminal plugin; without it, archive the task first.
    delete(id: string, opts?: DeleteOpts): Promise<DeleteResult>
    onCreated(id: string, nodeId?: string | null): Promise<void>
    // Every active task's worktree status, or only these tasks'.
    statuses(ids?: readonly string[]): Promise<TaskStatus[]>
  }
}

const post = <T>(url: string, body?: unknown, init: Pick<WriteInit, 'nodeId' | 'long'> = {}) =>
  writeJson<T>(url, {
    method: 'POST',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    ...init,
  })
const put = <T>(url: string, body: unknown) =>
  writeJson<T>(url, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

// Every route below is ordinary `/v1` against the node, so this is available wherever a node is
// and there is nothing to probe for. The folder picker lives on the platform seam as
// `pickFolder()`, so this is a plain accessor.
export const taskBridge = (): TaskBridge => {
  return {
    project: {
      get: (id) => readJson<ProjectConfigResponse | null>(projectConfigRoute(id)),
      runTargets: (id, runTargets) => put<ProjectConfigResponse>(projectRunTargetsRoute(id), { runTargets }),
      config: (id, patch) => put<ProjectConfigResponse>(projectConfigRoute(id), { patch }),
    },
    previewUrl: (taskId, script) =>
      post<{ ok: boolean; url?: string; reason?: string }>(taskPreviewUrlRoute(taskId), { script }),
    task: {
      // Archive tears down a whole task tree and removes each worktree, which can take minutes, so it
      // goes through the broker's long pool.
      archive: (id, opts) => post<ArchiveResult>(taskArchiveRoute(id), opts ?? {}, { long: true }),
      archiveConcerns: (id) =>
        readJson<{ concerns?: TaskArchiveConcern[] }>(taskArchiveConcernsRoute(id))
          .then((body) => body?.concerns ?? [])
          .catch((error) => {
            log.warn('archive concerns unavailable', error)
            return []
          }),
      restore: (id, opts) => post<RestoreResult>(taskRestoreRoute(id), opts ?? {}),
      delete: (id, opts) => post<DeleteResult>(taskDeleteRoute(id), opts ?? {}),
      onCreated: (id, nodeId) =>
        post<{ ok: boolean }>(taskOnCreatedRoute(id), undefined, { nodeId }).then(() => undefined),
      statuses: (ids) => readJson<TaskStatus[]>(ids ? `${taskStatusesRoute}?${taskIdsQuery(ids)}` : taskStatusesRoute),
    },
  }
}
