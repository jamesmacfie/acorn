import { execFile } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { WorktreeResult } from '../shared/terminal'
import { isContainedPath, isDirty, worktreeBranchDirName } from './terminalUtils'

const exec = promisify(execFile)

// Workspace worktrees (docs/workspaces 05): a workspace edits its branch in an isolated git
// worktree instead of dirtying the main checkout, and we get a clean cleanup affordance. Worktrees
// live under the app data dir, keyed by branch. All git runs in the *main checkout* (it owns the
// .git the worktree links to). execFile with arg arrays — no shell; owner/repo are validated
// upstream, the branch is slugged for the dir name and isContainedPath guards the result.

async function branchExists(checkout: string, branch: string): Promise<boolean> {
  try {
    await exec('git', ['-C', checkout, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], { timeout: 10_000 })
    return true
  } catch {
    return false
  }
}

// Lazy on first terminal (Flow C). For a PR workspace, check out the PR head detached (robust for
// forks). For a local-first workspace, reuse the branch if it exists else create it from HEAD.
// A branch name safe to pass to git as a positional: no leading dash (so it can't be read as a
// flag) and only git-legal ref chars. The dir name is slugged separately; this guards the *git arg*.
const isValidBranch = (branch: string): boolean => !branch.startsWith('-') && /^[A-Za-z0-9._/-]+$/.test(branch)

export async function ensureWorktree(
  worktreesRoot: string,
  checkout: string,
  owner: string,
  repo: string,
  branch: string,
  pullNumber: number | null,
): Promise<WorktreeResult> {
  if (!isValidBranch(branch)) return { ok: false, reason: 'Invalid branch name.' }
  const path = join(worktreesRoot, worktreeBranchDirName(owner, repo, branch))
  // Defense in depth: never operate on a path that escaped the worktrees root (handler validates
  // identifiers too, vNext §11).
  if (!isContainedPath(worktreesRoot, path)) return { ok: false, reason: 'Invalid worktree path.' }
  if (existsSync(path)) return { ok: true, path } // reuse

  mkdirSync(worktreesRoot, { recursive: true })

  if (pullNumber != null) {
    // PR workspace: fetch the head (uses the checkout's git credentials) and check it out detached —
    // no branch name to collide with the main checkout. `--` ends option parsing before positionals.
    try {
      await exec('git', ['-C', checkout, 'fetch', 'origin', `pull/${pullNumber}/head`], { timeout: 60_000 })
    } catch {
      return { ok: false, reason: `Could not fetch pull/${pullNumber}/head.` }
    }
    try {
      await exec('git', ['-C', checkout, 'worktree', 'add', '--detach', '--', path, 'FETCH_HEAD'], { timeout: 60_000 })
    } catch {
      return { ok: false, reason: 'Could not create the worktree.' }
    }
    return { ok: true, path }
  }

  // Local-first workspace: add a worktree on the branch, creating it from HEAD if it's new. `--`
  // ends option parsing so a branch/path can never be mistaken for a flag (argv-injection guard).
  const args = (await branchExists(checkout, branch))
    ? ['-C', checkout, 'worktree', 'add', '--', path, branch]
    : ['-C', checkout, 'worktree', 'add', '-b', branch, '--', path]
  try {
    await exec('git', args, { timeout: 60_000 })
  } catch {
    return { ok: false, reason: `Could not create a worktree for ${branch}.` }
  }
  return { ok: true, path }
}

export async function worktreeDirty(path: string): Promise<boolean> {
  try {
    const { stdout } = await exec('git', ['-C', path, 'status', '--porcelain'], { timeout: 10_000 })
    return isDirty(stdout)
  } catch {
    return false
  }
}

// Dirty flag + changed-file count for the live rail/footer markers (docs/workspaces 02/05).
export async function worktreePorcelain(path: string): Promise<{ dirty: boolean; count: number }> {
  try {
    const { stdout } = await exec('git', ['-C', path, 'status', '--porcelain'], { timeout: 10_000 })
    const count = stdout.split('\n').filter((l) => l.trim().length > 0).length
    return { dirty: count > 0, count }
  } catch {
    return { dirty: false, count: 0 }
  }
}

// Remove a worktree via the main checkout. Refuses a dirty worktree unless force is set (which
// discards uncommitted changes) — surfaced to the UI so removal is never silently destructive.
export async function removeWorktree(checkout: string, path: string, force = false): Promise<WorktreeResult> {
  if (!force && (await worktreeDirty(path))) {
    return { ok: false, reason: 'Worktree has uncommitted changes — confirm to discard.' }
  }
  const args = ['-C', checkout, 'worktree', 'remove', ...(force ? ['--force'] : []), path]
  try {
    await exec('git', args, { timeout: 30_000 })
  } catch {
    return { ok: false, reason: 'Could not remove the worktree.' }
  }
  return { ok: true, path }
}
