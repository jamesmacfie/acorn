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
    runConfig(owner: string, repo: string, runCommand: string, devPort: number): Promise<RepoPathResult>
    editorCommand(owner: string, repo: string, editorCommand: string): Promise<RepoPathResult>
    runTargets(owner: string, repo: string, runTargets: string): Promise<RepoPathResult>
  }
  // Run targets (docs/next 13 §A): list with live status, start/stop/status, and the default
  // target's URL for the browser/preview home.
  run: {
    targets(taskId: string): Promise<
      | {
          targets: RunTargetInfo[]
          errors: { source: string; message: string }[]
          layouts: { id: string; panes: string[]; ratio?: number; terminal?: string; browser?: string }[]
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
  // Open the task's worktree (or base checkout) in the external editor (docs/next 01 P2).
  openInEditor(taskId: string): Promise<{ ok: boolean; reason?: string }>
  // Local-changes review (docs/next 04): working-tree status/diffs/blobs for the ChangesPane.
  local: {
    changes(taskId: string): Promise<LocalChange[]>
    diff(taskId: string, path: string, scope: 'unstaged' | 'staged'): Promise<{ patch: string } | { error: string }>
    blob(taskId: string, path: string, ref?: string): Promise<{ text: string } | { error: string }>
    stage(taskId: string, path: string): Promise<{ ok: boolean; reason?: string }>
    unstage(taskId: string, path: string): Promise<{ ok: boolean; reason?: string }>
    discard(taskId: string, path: string, untracked?: boolean): Promise<{ ok: boolean; reason?: string }>
    commit(taskId: string, message: string): Promise<{ ok: boolean; reason?: string }>
  }

  task: {
    archive(id: string, opts?: ArchiveOpts): Promise<ArchiveResult>
    onCreated(id: string): Promise<void>
    statuses(): Promise<TaskStatus[]>
  }
}

declare global {
  interface Window {
    acorn?: {
      desktop?: boolean
      platform?: string
      terminal?: TerminalApi
      editor?: import('../editor/editorClient').EditorApi
      notes?: import('../notes/notesClient').NotesApi
      memory?: import('../memory/memoryClient').MemoryApi
      mcp?: {
        inspect(taskId: string): Promise<{ file: string; servers: import('../../../shared/mcp').McpServerSummary[] }[]>
        createStarter(taskId: string): Promise<{ ok: boolean; reason?: string }>
      }
    }
  }
}

export const terminalApi = (): TerminalApi | null => window.acorn?.terminal ?? null
