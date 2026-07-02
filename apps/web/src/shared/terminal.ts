// Shared terminal protocol (vNext §5). Imported by main, preload, and renderer — so it holds the
// wire contract only, never node-pty types: main owns the PTY, this just describes what crosses IPC.

// The ONE AgentState vocabulary (docs/next 05, README decision 15) — defined here, reused verbatim
// by the agent surfaces (15); no other module redeclares it. Each transport emits only the subset
// it can detect: PTY sessions 'working|idle|blocked|unknown'; managed/headless agents the full set.
export type AgentState = 'starting' | 'working' | 'waiting' | 'idle' | 'blocked' | 'permission' | 'done' | 'unknown'

export type TerminalSession = {
  id: string
  title: string
  kind: 'shell' | 'agent'
  profileId: string
  backend: 'node-pty' | 'tmux'
  status: 'running' | 'exited'
  idle: boolean // agent has produced no output for a while (vNext §3); always false for shells
  agentState: AgentState // docs/next 05 — PTY tier emits working|idle|blocked|unknown
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
// (running sessions / dirty worktree) for the UI to surface. A failed teardown script
// (docs/next 02) sets teardownFailed so the UI can offer continue (re-archive with
// skipTeardown) or abort; `output` is the script's tail for display.
export type ArchiveResult = { ok: true } | { ok: false; reason: string; teardownFailed?: boolean; output?: string }

export type ArchiveOpts = { deleteWorktree?: boolean; force?: boolean; skipTeardown?: boolean }

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
// are the per-repo dev-server config (docs/workspaces P5), null until configured. editorCommand is
// the external editor for this repo's worktrees (docs/next 01 P2); null → global default → 'code'.
export type RepoPath = {
  owner: string
  repo: string
  path: string
  runCommand: string | null
  devPort: number | null
  editorCommand: string | null
  runTargets: string | null // JSON RunTarget[] (docs/next 13 §A) — the DB fallback config surface
}

// Run targets as the renderer sees them (docs/next 13 §A): the merged config list + live status.
export type RunTargetInfo = {
  id: string
  command: string
  stop?: string
  url?: string
  urlCommand?: string
  icon?: string
  default?: boolean
  running: boolean
}
export type RunStatus = { running: boolean; url?: string; exitCode?: number | null }

// Result of validating/saving a checkout path. `reason` explains a rejection for the UI.
export type RepoPathResult = { ok: true; repoPath: RepoPath } | { ok: false; reason: string }

// Local-changes review (docs/next 04 §A): one working-tree change as the ChangesPane sees it.
// A file changed in both the index and the worktree appears once per scope (staged flag).
export type LocalChange = {
  path: string
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked'
  oldPath?: string // for renames
  staged: boolean
  additions: number | null
  deletions: number | null
}

// Pushed from main to a subscribed renderer over `term:out:<id>` (see preload `attach`).
export type ServerMsg =
  | { type: 'ready'; session: TerminalSession; replayed: boolean }
  | { type: 'output'; data: string }
  | { type: 'exit'; exitCode: number | null; signal: string | null }
  | { type: 'error'; code: string; message: string }
