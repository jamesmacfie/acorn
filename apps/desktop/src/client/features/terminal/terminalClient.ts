// Typed accessor for the preload's `window.acorn.terminal` bridge (vNext §5). The global is declared
// here so anything importing it (App's flag check, TerminalPanel) sees the same shape.
import type { ArchiveOpts, ArchiveResult, CreateOpts, LocalChange, RepoPath, RepoPathResult, RunStatus, RunTargetInfo, ServerMsg, TerminalProfile, TerminalSession, TaskStatus } from '../../../shared/terminal'

export type TerminalApi = {
  list(): Promise<TerminalSession[]>
  profiles(): Promise<TerminalProfile[]>
  create(opts: CreateOpts): Promise<TerminalSession>
  kill(id: string): Promise<boolean>
  interrupt(id: string): Promise<boolean>
  remove(id: string): Promise<boolean>
  resize(id: string, cols: number, rows: number): Promise<boolean>
  write(id: string, data: string): void
  // Bracketed-paste delivery into an agent PTY (docs/next 04 §D): one block, three submit modes.
  sendToAgent(sessionId: string, text: string, submit: 'now' | 'after-ready' | 'draft'): Promise<{ ok: boolean; queued?: boolean; reason?: string }>
  onStatus(cb: () => void): () => void
  attach(id: string, on: (m: ServerMsg) => void): () => void
  repoPath: {
    get(owner: string, repo: string): Promise<RepoPath | null>
    set(owner: string, repo: string, path: string): Promise<RepoPathResult>
    pick(): Promise<string | null>
    runTargets(owner: string, repo: string, runTargets: string): Promise<RepoPathResult>
  }
  // Run targets (docs/next 13 §A): list with live status, start/stop/status, and the default
  // target's URL for the browser/preview home.
  run: {
    targets(taskId: string): Promise<
      | {
          targets: RunTargetInfo[]
          errors: { source: string; message: string }[]
          layouts: { id: string; panes: string[]; terminal?: string; browser?: string }[]
        }
      | { error: string }
    >
    start(taskId: string, targetId: string): Promise<{ ok: boolean; reason?: string; sessionId?: string }>
    stop(taskId: string, targetId: string): Promise<{ ok: boolean; reason?: string }>
    status(taskId: string, targetId: string): Promise<RunStatus>
    defaultUrl(taskId: string): Promise<string | undefined>
  }
  // Run a workspace's browser-preview script in the task's worktree; stdout (trimmed) is the URL.
  previewUrl(taskId: string, script: string): Promise<{ ok: boolean; url?: string; reason?: string }>
  // Local-changes review (docs/next 04): working-tree status/diffs/blobs for the ChangesPane.
  local: {
    changes(taskId: string): Promise<LocalChange[]>
    diff(taskId: string, path: string, scope: 'unstaged' | 'staged'): Promise<{ patch: string } | { error: string }>
    blob(taskId: string, path: string, ref?: string): Promise<{ text: string } | { error: string }>
    stage(taskId: string, path: string): Promise<{ ok: boolean; reason?: string }>
    unstage(taskId: string, path: string): Promise<{ ok: boolean; reason?: string }>
    discard(taskId: string, path: string, untracked?: boolean): Promise<{ ok: boolean; reason?: string }>
    commit(taskId: string, message: string): Promise<{ ok: boolean; reason?: string }>
    push(taskId: string): Promise<{ ok: boolean; reason?: string }>
  }

  task: {
    archive(id: string, opts?: ArchiveOpts): Promise<ArchiveResult>
    onCreated(id: string): Promise<void>
    statuses(): Promise<TaskStatus[]>
  }
  // Workflows (docs/next 14): the runner's IPC surface + gate/run-done notices for the bell.
  workflow: {
    defs(taskId: string): Promise<{ workflows: WorkflowDefSummary[]; errors: { source: string; message: string }[] }>
    start(taskId: string, def: unknown): Promise<{ runId?: string; error?: string }>
    runs(taskId: string): Promise<WorkflowRunRow[]>
    steps(runId: string): Promise<WorkflowStepRow[]>
    gate(runId: string, stepId: string, approved: boolean): Promise<{ ok: boolean }>
    onNotice(cb: (n: { taskId: string; kind: 'gate' | 'run-done'; title: string }) => void): () => void
  }
}

// A committed/user workflow definition as loadWorkflowFiles returns it (docs/next 14 P5): what the
// palette launches and the settings inspector lists. `source` is the layer it was found in.
export type WorkflowDefSummary = {
  id: string
  name: string
  source: 'repo' | 'user'
  posture?: 'gated' | 'autonomous'
  steps: { name: string; kind?: string }[]
}

// Renderer-side projections of the workflow rows (docs/next 14).
export type WorkflowRunRow = {
  id: string
  taskId: string
  name: string
  status: 'running' | 'gated' | 'done' | 'failed' | 'safety-rail'
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
  status: 'pending' | 'running' | 'waiting-gate' | 'done' | 'failed' | 'skipped'
  resultJson: string | null
  structuredJson: string | null
  sessionId: string | null
  costUsd: number | null
  iteration: number
  error: string | null
  createdAt: number
  updatedAt: number
}

declare global {
  interface Window {
    acorn?: {
      desktop?: boolean
      platform?: string
      // Cmd/Ctrl+W → close the focused pane. Returns an unsubscribe.
      onClosePane?: (cb: () => void) => () => void
      terminal?: TerminalApi
      editor?: import('../editor/editorClient').EditorApi
      notes?: import('../notes/notesClient').NotesApi
      memory?: import('../memory/memoryClient').MemoryApi
      browser?: {
        bind(taskId: string, webContentsId: number): Promise<boolean>
      }
      mcp?: {
        inspect(taskId: string): Promise<{ file: string; servers: import('../../../shared/mcp').McpServerSummary[] }[]>
        createStarter(taskId: string): Promise<{ ok: boolean; reason?: string }>
      }
    }
  }
}

export const terminalApi = (): TerminalApi | null => window.acorn?.terminal ?? null
