// Typed accessor for the preload's `window.acorn.terminal` bridge (docs/terminal-and-agents.md). The global is declared
// here so anything importing it (App's flag check, TerminalPanel) sees the same shape.
import type { ArchiveOpts, ArchiveResult, CreateOpts, RepoPath, RepoPathResult, ServerMsg, TerminalProfile, TerminalSession, TaskStatus } from '../../../core/shared/terminal'
import {
  taskArchiveRoute,
  taskOnCreatedRoute,
  taskPreviewUrlRoute,
  taskUseCheckoutRoute,
  terminalProfilesRoute,
  terminalRepoPathRoute,
  terminalRepoPathRunTargetsRoute,
  terminalRepoPathSetRoute,
  terminalSessionActionRoute,
  terminalSessionsRoute,
  terminalTaskStatusesRoute,
} from '../../../core/shared/api'
import { readJson, writeJson } from '../../../core/client/apiClient'
import { wsAttach, wsOnNotice, wsOnStatus, wsOnWorkflowStepEvent, wsWrite } from '../../../core/client/wsClient'

export type TerminalApi = {
  list(): Promise<TerminalSession[]>
  profiles(): Promise<TerminalProfile[]>
  create(opts: CreateOpts): Promise<TerminalSession>
  kill(id: string): Promise<boolean>
  interrupt(id: string): Promise<boolean>
  remove(id: string): Promise<boolean>
  resize(id: string, cols: number, rows: number): Promise<boolean>
  write(id: string, data: string): void
  // Bracketed-paste delivery into an agent PTY (docs/panes.md): one block, three submit modes.
  sendToAgent(sessionId: string, text: string, submit: 'now' | 'after-ready' | 'draft'): Promise<{ ok: boolean; queued?: boolean; reason?: string }>
  onStatus(cb: () => void): () => void
  attach(id: string, on: (m: ServerMsg) => void): () => void
  repoPath: {
    get(owner: string, repo: string): Promise<RepoPath | null>
    set(owner: string, repo: string, path: string): Promise<RepoPathResult>
    pick(): Promise<string | null>
    runTargets(owner: string, repo: string, runTargets: string): Promise<RepoPathResult>
  }
  // Run a workspace's browser-preview script in the task's worktree; stdout (trimmed) is the URL.
  previewUrl(taskId: string, script: string): Promise<{ ok: boolean; url?: string; reason?: string }>
  task: {
    archive(id: string, opts?: ArchiveOpts): Promise<ArchiveResult>
    onCreated(id: string): Promise<void>
    useCheckout(id: string): Promise<{ worktreePath: string; branch: string } | null>
    statuses(): Promise<TaskStatus[]>
  }
  // Workflow commands use workflowClient's HTTP routes; notices and live step events use WebSocket.
  workflow: {
    onNotice(cb: (n: { taskId: string; kind: 'gate' | 'run-done' | 'repo-config-trust'; title: string; action?: 'review-config' }) => void): () => void
    onStepEvent(cb: (event: { runId: string; stepId: string; event: unknown }) => void): () => void
  }
}

// A committed/user workflow definition as loadWorkflowFiles returns it (docs/workflows.md): what the
// palette launches and the settings inspector lists. `source` is the layer it was found in.
export type WorkflowDefSummary = {
  id: string
  name: string
  source: 'repo' | 'user'
  posture?: 'gated' | 'autonomous'
  steps: { name: string; kind?: string }[]
}

// Renderer-side projections of the workflow rows (docs/workflows.md).
export type WorkflowRunRow = {
  id: string
  taskId: string
  name: string
  status: 'running' | 'gated' | 'cancelling' | 'done' | 'failed' | 'safety-rail' | 'cancelled'
  posture: string
  error: string | null
  createdAt: number
  updatedAt: number
}
export type WorkflowStepRow = {
  id: string
  runId: string
  idx: number
  name: string
  kind: string
  mode: string
  profileId: string | null
  model: string | null
  status: 'pending' | 'running' | 'waiting-gate' | 'done' | 'failed' | 'skipped' | 'safety-rail' | 'cancelled'
  resultJson: string | null
  structuredJson: string | null
  sessionId: string | null
  costUsd: number | null
  iteration: number
  error: string | null
  createdAt: number
  updatedAt: number
  resumeCommand?: string | null
}

// The preload `window.acorn.terminal` bridge exposes only the native folder
// picker — a true Electron capability (dialog.showOpenDialog) that can't be HTTP. Its presence is
// also how the renderer detects desktop mode (terminalApi() → null without it). All request/response
// verbs are HTTP; all streams (PTY input/output/status, workflow notices) are the WebSocket
// (wsClient.ts).
export type TerminalStreamBridge = {
  repoPath: { pick(): Promise<string | null> }
}

// Chrome state pushed from main for the active preview view (PreviewPane consumes it).
export type PreviewState = { taskId: string; url: string; loading: boolean; canGoBack: boolean; canGoForward: boolean }

declare global {
  interface Window {
    acorn?: {
      desktop?: boolean
      platform?: string
      // Cmd/Ctrl+W → close the focused pane. Returns an unsubscribe.
      onClosePane?: (cb: () => void) => () => void
      // App quit lifecycle concern collection. Returns an unsubscribe.
      onWillQuit?: (cb: () => boolean | Promise<boolean>) => () => void
      terminal?: TerminalStreamBridge
      // Browser-preview surface: drive the task's main-owned WebContentsView.
      preview?: {
        ensure(taskId: string, url: string): Promise<boolean>
        setBounds(taskId: string, rect: { x: number; y: number; width: number; height: number }): void
        show(taskId: string): void
        hide(): void
        load(taskId: string, url: string): void
        command(taskId: string, action: 'back' | 'forward' | 'reload' | 'stop'): void
        evict(taskId: string): void
        onEvent(cb: (s: PreviewState) => void): () => void
      }
    }
  }
}

const post = <T>(url: string, body?: unknown) =>
  writeJson<T>(url, { method: 'POST', headers: body === undefined ? undefined : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
const put = <T>(url: string, body: unknown) =>
  writeJson<T>(url, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

// The renderer's terminal client composes loopback HTTP for commands, WebSocket for streams, and
// the residual preload bridge for the native folder picker. Returns null off-desktop
// (no bridge) exactly as before, so every consumer's `if (!api)` desktop guard is unchanged.
export const terminalApi = (): TerminalApi | null => {
  const bridge = window.acorn?.terminal
  if (!bridge) return null
  return {
    list: () => readJson<TerminalSession[]>(terminalSessionsRoute),
    profiles: () => readJson<TerminalProfile[]>(terminalProfilesRoute),
    create: (opts) => post<TerminalSession>(terminalSessionsRoute, opts),
    kill: (id) => post<boolean>(terminalSessionActionRoute(id, 'kill')),
    interrupt: (id) => post<boolean>(terminalSessionActionRoute(id, 'interrupt')),
    remove: (id) => post<boolean>(terminalSessionActionRoute(id, 'remove')),
    resize: (id, cols, rows) => post<boolean>(terminalSessionActionRoute(id, 'resize'), { cols, rows }),
    sendToAgent: (sessionId, text, submit) => post<{ ok: boolean; queued?: boolean; reason?: string }>(terminalSessionActionRoute(sessionId, 'send'), { text, submit }),
    write: wsWrite,
    onStatus: wsOnStatus,
    attach: wsAttach,
    repoPath: {
      get: (owner, repo) => readJson<RepoPath | null>(terminalRepoPathRoute(owner, repo)),
      set: (owner, repo, path) => put<RepoPathResult>(terminalRepoPathSetRoute, { owner, repo, path }),
      runTargets: (owner, repo, runTargets) => put<RepoPathResult>(terminalRepoPathRunTargetsRoute, { owner, repo, runTargets }),
      pick: () => bridge.repoPath.pick(),
    },
    previewUrl: (taskId, script) => post<{ ok: boolean; url?: string; reason?: string }>(taskPreviewUrlRoute(taskId), { script }),
    task: {
      archive: (id, opts) => post<ArchiveResult>(taskArchiveRoute(id), opts ?? {}),
      onCreated: (id) => post<{ ok: boolean }>(taskOnCreatedRoute(id)).then(() => undefined),
      useCheckout: (id) => post<{ result: { worktreePath: string; branch: string } | null }>(taskUseCheckoutRoute(id)).then((r) => r.result),
      statuses: () => readJson<TaskStatus[]>(terminalTaskStatusesRoute),
    },
    workflow: { onNotice: wsOnNotice, onStepEvent: wsOnWorkflowStepEvent },
  }
}
