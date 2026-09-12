// Path and checkout guards for worktree-backed tasks. Pure string functions, so pathGuards.test.ts
// runs them under plain Node. Core owns the worktree primitives (server/worktrees/worktrees.ts), so the guards
// that protect them live here rather than in the terminal plugin that also uses them.

import { resolve, sep } from 'node:path'

// PR worktree directory name (docs/workspaces-and-tasks.md): `<owner>-<repo>-pr-<number>` under the worktrees root.
export const worktreeDirName = (owner: string, repo: string, number: number | string) => `${owner}-${repo}-pr-${number}`

// The filesystem and DNS-safe branch slug (docs/terminal-and-agents.md), shared by the worktree dir
// name and the ACORN_TASK_SLUG env var that isolates parallel tasks.
// plugins/docker/main/matcher.ts duplicates this one-liner to keep its plugin boundary frozen. Keep
// the two in sync.
export const branchSlug = (branch: string) => branch.replace(/[^A-Za-z0-9._-]/g, '-')

// Workspace worktree directory name (docs/workspaces-and-tasks.md), keyed by branch because a
// local-first workspace has no PR number. isContainedPath still guards the result.
export const worktreeBranchDirName = (owner: string, repo: string, branch: string) =>
  `${owner}-${repo}-${branchSlug(branch)}`

// Guard repo identifiers before they reach a filesystem path. Allow only GitHub-legal characters and
// forbid a leading dot, so `..` and `/` cannot escape the worktrees root.
export const isValidRepoIdent = (s: string): boolean => /^[A-Za-z0-9._-]+$/.test(s) && !s.startsWith('.')

// Is `candidate` the same as, or strictly inside, `root`? Both are resolved first, so a caller's
// path with `..` segments cannot point outside the worktrees dir.
export const isContainedPath = (root: string, candidate: string): boolean => {
  const r = resolve(root)
  const c = resolve(candidate)
  return c === r || c.startsWith(r + sep)
}

