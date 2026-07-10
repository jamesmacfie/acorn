// Shared terminal protocol (docs/terminal-and-agents.md). Imported by main, preload, and renderer — so it holds the
// wire contract only, never node-pty types: main owns the PTY, this just describes what crosses IPC.

// The ONE AgentState vocabulary (docs/terminal-and-agents.md, README decision 15) — defined here, reused verbatim
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
  idle: boolean // agent has produced no output for a while (docs/terminal-and-agents.md); always false for shells
  agentState: AgentState // docs/terminal-and-agents.md — PTY tier emits working|idle|blocked|unknown
  // cwd is the task's isolated worktree. DERIVED, never stored: tasks.worktreePath is the truth
  // (docs/workspaces-and-tasks.md) and main computes cwd === task.worktreePath at session create AND during
  // reconcileTmux, so the flag survives app restarts. It stays on the wire as a denormalized copy
  // so the renderer doesn't need the task join for a per-session badge/cleanup affordance.
  isWorktree: boolean
  taskId: string // → tasks.id (docs/workspaces-and-tasks.md); a session always belongs to a task
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
  taskId: string // → tasks.id (docs/workspaces-and-tasks.md); repo / branch / PR derive from it
  profileId?: string // defaults to the built-in 'shell'
  cwd?: string
  cols?: number
  rows?: number
  title?: string
  isWorktree?: boolean
  // Dev-server pane (docs/workspaces-and-tasks.md): run this command line via the user's shell instead of a
  // profile binary, with `env` merged in (e.g. PORT). The command is user-configured per repo.
  command?: string
  env?: Record<string, string>
}

// Result of creating/removing a worktree (docs/workspaces-and-tasks.md). `reason` explains a failure for the UI.
export type WorktreeResult = { ok: true; path: string } | { ok: false; reason: string }

// Result of archiving a task (docs/workspaces-and-tasks.md). `reason` carries the guard refusal
// (running sessions / dirty worktree) for the UI to surface. A failed teardown script
// (docs/terminal-and-agents.md) sets teardownFailed so the UI can offer continue (re-archive with
// skipTeardown) or abort; `output` is the script's tail for display.
export type ArchiveResult = { ok: true } | { ok: false; reason: string; teardownFailed?: boolean; output?: string }

export type ArchiveOpts = { deleteWorktree?: boolean; force?: boolean; skipTeardown?: boolean }

// Live worktree status for a task (docs/workspaces-and-tasks.md/05). `missing` = the task has a
// worktreePath but the directory is gone (removed outside acorn) → needs repair. Computed in main
// (git status --porcelain + an existence check) and polled by the rail / task footer.
export type TaskStatus = {
  taskId: string
  worktreePath: string | null
  dirty: boolean
  dirtyCount: number
  missing: boolean
}

// A launchable profile as the renderer sees it (docs/terminal-and-agents.md). `available` is false when the command
// isn't on PATH — the UI disables it. command/backend stay in main. `tmuxMissing` is true when the
// profile prefers the durable tmux backend but tmux isn't installed, so a session would silently
// degrade to node-pty (no restart survival) — the drawer surfaces the hint.
export type TerminalProfile = {
  id: string
  label: string
  kind: 'shell' | 'agent'
  available: boolean
  tmuxMissing?: boolean
}

// Local checkout mapping for a repo (docs/workspaces-and-tasks.md). Returned by repoPath.get / set.
export type RepoPath = {
  owner: string
  repo: string
  path: string
  runTargets: string | null // JSON RunTarget[] (docs/workflows.md §2) — the DB fallback config surface
}

// Run targets as the renderer sees them (docs/workflows.md §2): the merged config list + live status.
// CANONICAL shapes for the run surface — main/runtime.ts imports these; nothing redeclares them.
export type RunTargetInfo = {
  id: string
  command: string
  stop?: string
  restart?: string
  url?: string
  urlCommand?: string
  icon?: string
  default?: boolean
  running: boolean
}
export type RunStatus = { running: boolean; url?: string; exitCode?: number | null }

// Result of validating/saving a checkout path. `reason` explains a rejection for the UI.
export type RepoPathResult = { ok: true; repoPath: RepoPath } | { ok: false; reason: string }

// Local-changes review (docs/panes.md): one working-tree change as the ChangesPane sees it.
// A file changed in both the index and the worktree appears once per scope (staged flag).
export type LocalChange = {
  path: string
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked'
  oldPath?: string // for renames
  staged: boolean
  additions: number | null
  deletions: number | null
}

// Pushed from main to a subscribed renderer inside a `term:out` WebSocket frame (shared/ws.ts;
// wsHub → wsClient). Was per-session IPC (`term:out:<id>`) before the WebSocket transport.
export type ServerMsg =
  | { type: 'ready'; session: TerminalSession; replayed: boolean }
  | { type: 'output'; data: string }
  | { type: 'exit'; exitCode: number | null; signal: string | null }
  | { type: 'error'; code: string; message: string }
