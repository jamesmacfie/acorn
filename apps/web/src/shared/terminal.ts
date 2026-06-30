// Shared terminal protocol (vNext §5). Imported by main, preload, and renderer — so it holds the
// wire contract only, never node-pty types: main owns the PTY, this just describes what crosses IPC.

export type TerminalSession = {
  id: string
  title: string
  kind: 'shell' | 'agent'
  profileId: string
  backend: 'node-pty' | 'tmux'
  status: 'running' | 'exited'
  idle: boolean // agent has produced no output for a while (vNext §3); always false for shells
  isWorktree: boolean // cwd is an isolated PR worktree (vNext §9); in-memory only, not persisted
  taskId: string // → tasks.id (docs/workspaces); a session always belongs to a task
  cwd: string
  command: string
  tmuxSession?: string
  repo?: { owner: string; name: string } // derived from the task join (main process)
  pull?: { number: number } // derived from the task join (main process)
  cols: number
  rows: number
  createdAt: number
  exitCode: number | null
}

export type CreateOpts = {
  taskId: string // → tasks.id (docs/workspaces); repo / branch / PR derive from it
  profileId?: string // defaults to the built-in 'shell'
  cwd?: string
  cols?: number
  rows?: number
  title?: string
  isWorktree?: boolean
  // Dev-server pane (docs/workspaces P5): run this command line via the user's shell instead of a
  // profile binary, with `env` merged in (e.g. PORT). The command is user-configured per repo.
  command?: string
  env?: Record<string, string>
}

// Result of creating/removing a worktree (vNext §9). `reason` explains a failure for the UI.
export type WorktreeResult = { ok: true; path: string } | { ok: false; reason: string }

// Result of archiving a task (docs/workspaces 05). `reason` carries the guard refusal
// (running sessions / dirty worktree) for the UI to surface.
export type ArchiveResult = { ok: true } | { ok: false; reason: string }

// Live worktree status for a task (docs/workspaces 02/05). `missing` = the task has a
// worktreePath but the directory is gone (removed outside acorn) → needs repair. Computed in main
// (git status --porcelain + an existence check) and polled by the rail / task footer.
export type TaskStatus = {
  taskId: string
  worktreePath: string | null
  dirty: boolean
  dirtyCount: number
  missing: boolean
}

// A launchable profile as the renderer sees it (vNext §8). `available` is false when the command
// isn't on PATH — the UI disables it. command/backend stay in main.
export type TerminalProfile = {
  id: string
  label: string
  kind: 'shell' | 'agent'
  available: boolean
}

// Local checkout mapping for a repo (vNext §9). Returned by repoPath.get / set. runCommand / devPort
// are the per-repo dev-server config (docs/workspaces P5), null until configured.
export type RepoPath = { owner: string; repo: string; path: string; runCommand: string | null; devPort: number | null }

// Result of validating/saving a checkout path. `reason` explains a rejection for the UI.
export type RepoPathResult = { ok: true; repoPath: RepoPath } | { ok: false; reason: string }

// Pushed from main to a subscribed renderer over `term:out:<id>` (see preload `attach`).
export type ServerMsg =
  | { type: 'ready'; session: TerminalSession; replayed: boolean }
  | { type: 'output'; data: string }
  | { type: 'exit'; exitCode: number | null; signal: string | null }
  | { type: 'error'; code: string; message: string }
