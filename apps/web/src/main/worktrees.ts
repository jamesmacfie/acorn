import { execFile } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { WorktreeResult } from '../shared/terminal'
import { isContainedPath, isDirty, worktreeDirName } from './terminalUtils'

const exec = promisify(execFile)

// PR worktrees (vNext §9): an agent edits a PR in an isolated git worktree instead of dirtying the
// main checkout, and we get a clean cleanup affordance. Worktrees live under the app data dir, not
// the user's source tree. All git runs in the *main checkout* (it owns the .git the worktree links
// to). execFile with arg arrays — no shell; owner/repo/number are validated upstream.

export async function ensureWorktree(
  worktreesRoot: string,
  checkout: string,
  owner: string,
  repo: string,
  number: number,
): Promise<WorktreeResult> {
  const path = join(worktreesRoot, worktreeDirName(owner, repo, number))
  // Defense in depth: never operate on a path that escaped the worktrees root (handler validates
  // identifiers too, vNext §11).
  if (!isContainedPath(worktreesRoot, path)) return { ok: false, reason: 'Invalid worktree path.' }
  if (existsSync(path)) return { ok: true, path } // reuse

  // Fetch the PR head (uses the user's existing git credentials for this checkout).
  try {
    await exec('git', ['-C', checkout, 'fetch', 'origin', `pull/${number}/head`], { timeout: 60_000 })
  } catch {
    return { ok: false, reason: `Could not fetch pull/${number}/head.` }
  }

  mkdirSync(worktreesRoot, { recursive: true })
  // Detached checkout of the fetched head — no branch name to collide with the main checkout.
  try {
    await exec('git', ['-C', checkout, 'worktree', 'add', '--detach', path, 'FETCH_HEAD'], { timeout: 60_000 })
  } catch {
    return { ok: false, reason: 'Could not create the worktree.' }
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
