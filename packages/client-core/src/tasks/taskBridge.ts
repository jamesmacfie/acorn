// The desktop task bridge: task lifecycle, per-repo checkout/config, browser-preview resolution, and
// agent delivery. Core owns this because tasks, repo paths and the preview URL are platform concepts
// — the terminal feature is one consumer among many (settings, the rail, the changes and context
// panes, preview, task creation).
//
// As of Phase 2's scope-shed the ROUTES agree with that: everything here except sendToAgent now
// addresses /v2/core/*. Only the bracketed-paste send still goes to the terminal plugin, because only
// it needs a pseudo-terminal.
//
// Composition mirrors terminalClient: loopback HTTP for commands, the residual preload bridge for the
// one thing that cannot be HTTP (the native folder picker). Returns null off-desktop on exactly the
// same probe (`window.acorn?.terminal`), so every consumer's `if (!api)` guard behaves as before.
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
  terminalSessionActionRoute,
} from '@acorn/protocol/api.ts'
import { readJson, writeJson } from '../apiClient'
import { acornGlobal } from '../capabilities'

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
