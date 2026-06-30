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
  cwd: string
  command: string
  tmuxSession?: string
  repo?: { owner: string; name: string }
  pull?: { number: number }
  cols: number
  rows: number
  createdAt: number
  exitCode: number | null
}

export type CreateOpts = {
  profileId?: string // defaults to the built-in 'shell'
  cwd?: string
  cols?: number
  rows?: number
  title?: string
  isWorktree?: boolean
  repo?: { owner: string; name: string }
  pull?: { number: number }
}

// Result of creating/removing a PR worktree (vNext §9). `reason` explains a failure for the UI.
export type WorktreeResult = { ok: true; path: string } | { ok: false; reason: string }

// A launchable profile as the renderer sees it (vNext §8). `available` is false when the command
// isn't on PATH — the UI disables it. command/backend stay in main.
export type TerminalProfile = {
  id: string
  label: string
  kind: 'shell' | 'agent'
  available: boolean
}

// Local checkout mapping for a repo (vNext §9). Returned by repoPath.get / set.
export type RepoPath = { owner: string; repo: string; path: string }

// Result of validating/saving a checkout path. `reason` explains a rejection for the UI.
export type RepoPathResult = { ok: true; repoPath: RepoPath } | { ok: false; reason: string }

// Pushed from main to a subscribed renderer over `term:out:<id>` (see preload `attach`).
export type ServerMsg =
  | { type: 'ready'; session: TerminalSession; replayed: boolean }
  | { type: 'output'; data: string }
  | { type: 'exit'; exitCode: number | null; signal: string | null }
  | { type: 'error'; code: string; message: string }
