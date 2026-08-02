// Path and checkout guards for worktree-backed tasks. Pure string functions — no electron / node-pty
// imports, so they're unit-testable under plain Node (pathGuards.test.ts). Core owns the worktree
// primitives (see core/main/worktrees.ts), so the guards that protect them live here rather than in
// the terminal plugin that also happens to use them.

import { resolve, sep } from 'node:path'

// PR worktree directory name (docs/workspaces-and-tasks.md): `<owner>-<repo>-pr-<number>` under the worktrees root.
export const worktreeDirName = (owner: string, repo: string, number: number | string) => `${owner}-${repo}-pr-${number}`

// The filesystem/DNS-safe branch slug (docs/terminal-and-agents.md): shared by the worktree dir name and the
// ACORN_TASK_SLUG env var — the isolation handle for parallel tasks (compose -p, derived names).
// NB: plugins/docker/main/matcher.ts deliberately duplicates this one-liner to keep its plugin
// boundary frozen; keep the two in sync.
export const branchSlug = (branch: string) => branch.replace(/[^A-Za-z0-9._-]/g, '-')

// Workspace worktree directory name (docs/workspaces-and-tasks.md): keyed by branch, since a workspace is
// branch-first (local-first workspaces have no PR number). The branch slug replaces any char that
// isn't filesystem-safe (`feat/login` → `feat-login`); isContainedPath still guards the result.
export const worktreeBranchDirName = (owner: string, repo: string, branch: string) =>
  `${owner}-${repo}-${branchSlug(branch)}`

// Guard repo identifiers before they reach a filesystem path (docs/terminal-and-agents.md: validate every IPC
// payload at the boundary). Allow only GitHub-legal chars and forbid a leading dot, so `..`, `/`,
// and absolute/relative traversal can't escape the worktrees root.
export const isValidRepoIdent = (s: string): boolean => /^[A-Za-z0-9._-]+$/.test(s) && !s.startsWith('.')

// Is `candidate` the same as, or strictly inside, `root`? Both are resolved first, so a
// renderer-supplied path with `..` segments can't point outside the worktrees dir.
export const isContainedPath = (root: string, candidate: string): boolean => {
  const r = resolve(root)
  const c = resolve(candidate)
  return c === r || c.startsWith(r + sep)
}

// A checkout is dirty when `git status --porcelain` prints anything.
export const isDirty = (porcelain: string): boolean => porcelain.trim().length > 0
