import type { ArchiveOpts, ArchiveResult, TaskStatus } from '@acorn/protocol/terminal.ts'
import {
  projectConfigRoute,
  projectRunTargetsRoute,
  taskArchiveRoute,
  taskOnCreatedRoute,
  taskPreviewUrlRoute,
  taskStatusesRoute,
} from '@acorn/protocol/api.ts'
import type { ProjectConfigPatch, ProjectConfigResponse } from '@acorn/protocol/api.ts'
import { readJson, writeJson } from '../apiClient'
import { acornGlobal } from '../capabilities'

// plugins/terminal owns these paths (plugins/terminal/src/contract/routes.ts). They are duplicated
// here as literals because client-core is a shared library and may not import a plugin — the arch
// suite enforces that, and it is the rule that keeps the shell from depending on features.
//
// This file is deliberately core: it is platform state (which agent sessions exist on this node),
// not terminal-drawer internals, and its own header says so. Two duplicated strings is the cheaper
// side of that trade against inventing a capability seam for a GET. Collected as debt against
// finding 10 (de-GitHub the shell), which reworks how the shell reaches feature routes.
const terminalSessionActionRoute = (sid: string, action: 'send') => `/v2/p/terminal/sessions/${encodeURIComponent(sid)}/${action}`

export type TaskBridge = {
  project: {
    get(id: string): Promise<ProjectConfigResponse | null>
    runTargets(id: string, runTargets: string): Promise<ProjectConfigResponse>
    config(id: string, patch: ProjectConfigPatch): Promise<ProjectConfigResponse>
  }
  folderPath: {
    pick(): Promise<string | null>
  }
  // Run a repo's browser-preview script in the task's worktree; stdout (trimmed) is the URL.
  previewUrl(taskId: string, script: string): Promise<{ ok: boolean; url?: string; reason?: string }>
  // Bracketed-paste delivery into an agent PTY (docs/panes.md): one block, three submit modes.
  sendToAgent(sessionId: string, text: string, submit: 'now' | 'after-ready' | 'draft'): Promise<{ ok: boolean; queued?: boolean; reason?: string }>
  task: {
    archive(id: string, opts?: ArchiveOpts): Promise<ArchiveResult>
    onCreated(id: string): Promise<void>
    statuses(): Promise<TaskStatus[]>
  }
}

const post = <T>(url: string, body?: unknown) =>
  writeJson<T>(url, { method: 'POST', headers: body === undefined ? undefined : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
const put = <T>(url: string, body: unknown) =>
  writeJson<T>(url, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

export const taskBridge = (): TaskBridge | null => {
  const bridge = acornGlobal()?.terminal
  if (!bridge) return null
  return {
    project: {
      get: (id) => readJson<ProjectConfigResponse | null>(projectConfigRoute(id)),
      runTargets: (id, runTargets) => put<ProjectConfigResponse>(projectRunTargetsRoute(id), { runTargets }),
      config: (id, patch) => put<ProjectConfigResponse>(projectConfigRoute(id), { patch }),
    },
    folderPath: {
      pick: () => bridge.folderPath.pick(),
    },
    previewUrl: (taskId, script) => post<{ ok: boolean; url?: string; reason?: string }>(taskPreviewUrlRoute(taskId), { script }),
    sendToAgent: (sessionId, text, submit) => post<{ ok: boolean; queued?: boolean; reason?: string }>(terminalSessionActionRoute(sessionId, 'send'), { text, submit }),
    task: {
      archive: (id, opts) => post<ArchiveResult>(taskArchiveRoute(id), opts ?? {}),
      onCreated: (id) => post<{ ok: boolean }>(taskOnCreatedRoute(id)).then(() => undefined),
      statuses: () => readJson<TaskStatus[]>(taskStatusesRoute),
    },
  }
}
