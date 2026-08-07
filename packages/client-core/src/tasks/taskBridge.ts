import type { ArchiveOpts, ArchiveResult, RepoConfigPatch, RepoPath, RepoPathResult, TaskStatus } from '@acorn/protocol/terminal.ts'
import {
  taskArchiveRoute,
  taskOnCreatedRoute,
  taskPreviewUrlRoute,
  taskUseCheckoutRoute,
  repoPathConfigRoute,
  repoPathRoute,
  repoPathRunTargetsRoute,
  repoPathSetRoute,
  taskStatusesRoute,
} from '@acorn/protocol/api.ts'
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
  repoPath: {
    get(owner: string, repo: string): Promise<RepoPath | null>
    set(owner: string, repo: string, path: string): Promise<RepoPathResult>
    pick(): Promise<string | null>
    runTargets(owner: string, repo: string, runTargets: string): Promise<RepoPathResult>
    config(owner: string, repo: string, patch: RepoConfigPatch): Promise<RepoPathResult>
  }
  // Run a repo's browser-preview script in the task's worktree; stdout (trimmed) is the URL.
  previewUrl(taskId: string, script: string): Promise<{ ok: boolean; url?: string; reason?: string }>
  // Bracketed-paste delivery into an agent PTY (docs/panes.md): one block, three submit modes.
  sendToAgent(sessionId: string, text: string, submit: 'now' | 'after-ready' | 'draft'): Promise<{ ok: boolean; queued?: boolean; reason?: string }>
  task: {
    archive(id: string, opts?: ArchiveOpts): Promise<ArchiveResult>
    onCreated(id: string): Promise<void>
    useCheckout(id: string): Promise<{ worktreePath: string; branch: string } | null>
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
    repoPath: {
      get: (owner, repo) => readJson<RepoPath | null>(repoPathRoute(owner, repo)),
      set: (owner, repo, path) => put<RepoPathResult>(repoPathSetRoute, { owner, repo, path }),
      runTargets: (owner, repo, runTargets) => put<RepoPathResult>(repoPathRunTargetsRoute, { owner, repo, runTargets }),
      config: (owner, repo, patch) => put<RepoPathResult>(repoPathConfigRoute, { owner, repo, patch }),
      pick: () => bridge.repoPath.pick(),
    },
    previewUrl: (taskId, script) => post<{ ok: boolean; url?: string; reason?: string }>(taskPreviewUrlRoute(taskId), { script }),
    sendToAgent: (sessionId, text, submit) => post<{ ok: boolean; queued?: boolean; reason?: string }>(terminalSessionActionRoute(sessionId, 'send'), { text, submit }),
    task: {
      archive: (id, opts) => post<ArchiveResult>(taskArchiveRoute(id), opts ?? {}),
      onCreated: (id) => post<{ ok: boolean }>(taskOnCreatedRoute(id)).then(() => undefined),
      useCheckout: (id) => post<{ result: { worktreePath: string; branch: string } | null }>(taskUseCheckoutRoute(id)).then((r) => r.result),
      statuses: () => readJson<TaskStatus[]>(taskStatusesRoute),
    },
  }
}
