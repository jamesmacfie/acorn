import { gitOrThrow } from '../core/git'
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import type { WorktreeResult } from '@acorn/protocol/terminal.ts'
import { isContainedPath, worktreeBranchDirName } from './pathGuards'
import { invalidateWorktreeStatus, worktreeStatus, type WorktreeStatus } from './worktreeStatus'


// Workspace worktrees. docs/workspaces-and-tasks.md § Worktrees and setup owns why they exist and
// how their paths are derived and revalidated.
//
// Every git command here runs in the main checkout, which owns the .git the worktree links to.
// execFile takes an argument array, never a shell. The branch is slugged for the directory name and
// isContainedPath guards the result.

async function branchExists(checkout: string, branch: string): Promise<boolean> {
  try {
    await gitOrThrow(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], { cwd: checkout, timeoutMs: 10_000 })
    return true
  } catch {
    return false
  }
}

// Any commit-ish (branch, remote ref, sha) that resolves in the checkout.
async function refExists(checkout: string, ref: string): Promise<boolean> {
  if (ref.startsWith('-')) return false // never let a ref be read as a flag
  try {
    await gitOrThrow(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { cwd: checkout, timeoutMs: 10_000 })
    return true
  } catch {
    return false
  }
}

// Base-ref precedence for a new branch: docs/workspaces-and-tasks.md § Worktrees and setup.
export async function resolveBaseRef(checkout: string, preferred?: string | null): Promise<string | null> {
  for (const candidate of [...(preferred?.trim() ? [preferred.trim()] : []), 'origin/main', 'origin/master']) {
    if (await refExists(checkout, candidate)) return candidate
  }
  return null
}

// A branch name safe to pass to git as a positional: no leading dash, so it cannot be read as a
// flag, and only git-legal ref characters. The directory name is slugged separately. This guards the
// git argument.
const isValidBranch = (branch: string): boolean => !branch.startsWith('-') && /^[A-Za-z0-9._/-]+$/.test(branch)

// The branch a linked worktree has checked out, read off disk. `<dir>/.git` is a file pointing at
// the repo's admin dir for that worktree, whose HEAD holds the ref. `null` means the directory is
// not a live linked worktree: pruned, moved, or on a detached HEAD.
//
// Read rather than shelled out to `git branch --show-current`, because resolveTaskCwd calls this on
// every task-to-cwd resolution, once per editor file read rather than once per session.
//
// It trusts the pointer file, so a worktree relinked to a different repo with the same owner, repo,
// and branch still passes. Compare the admin dir against the checkout if that ever matters.
export function worktreeBranch(dir: string): string | null {
  try {
    const pointer = readFileSync(join(dir, '.git'), 'utf8').trim()
    if (!pointer.startsWith('gitdir:')) return null
    const admin = resolve(dir, pointer.slice('gitdir:'.length).trim())
    const head = readFileSync(join(admin, 'HEAD'), 'utf8').trim()
    return head.startsWith('ref: refs/heads/') ? head.slice('ref: refs/heads/'.length) : null
  } catch {
    return null
  }
}

// Why a worktree directory cannot go to the task that owns it. Shared with the reuse check below and
// the persisted-path shortcut in taskWorktree.ts, so both callers give the same reason.
export const staleWorktreeReason = (path: string, branch: string, on: string | null): string =>
  `${path} is ${on ? `checked out on '${on}', not '${branch}'` : `no longer a live git worktree for '${branch}'`}. Remove the directory and reopen the task.`

// `created` tells a fresh `git worktree add` from reuse of an existing directory. Only the fresh
// path runs setup (docs/terminal-and-agents.md).
type EnsureWorktreeResult = { ok: true; path: string; created: boolean } | { ok: false; reason: string }

export async function ensureWorktree(
  worktreesRoot: string,
  checkout: string,
  owner: string,
  repo: string,
  branch: string,
  pullNumber: number | null,
  preferredBaseRef?: string | null,
): Promise<EnsureWorktreeResult> {
  if (!isValidBranch(branch)) return { ok: false, reason: 'Invalid branch name.' }
  const path = join(worktreesRoot, worktreeBranchDirName(owner, repo, branch))
  // Defence in depth. Never operate on a path that escaped the worktrees root, even though the
  // handler validates identifiers too (docs/security.md).
  if (!isContainedPath(worktreesRoot, path)) return { ok: false, reason: 'Invalid worktree path.' }
  if (existsSync(path)) {
    // Reuse only a live worktree still on this branch. docs/workspaces-and-tasks.md § Worktrees and
    // setup covers why, and what happens otherwise.
    const on = worktreeBranch(path)
    if (on === branch) return { ok: true, path, created: false }
    return { ok: false, reason: staleWorktreeReason(path, branch, on) }
  }

  mkdirSync(worktreesRoot, { recursive: true })

  if (pullNumber != null) {
    // PR workspace. Fetch the head with the checkout's git credentials, then check it out on the
    // PR's branch, where `branch` equals pr.headRef, so the worktree tracks a real branch and not a
    // detached commit. `--` ends option parsing before positionals.
    //
    // Fetch into a private per-PR ref, never FETCH_HEAD. FETCH_HEAD lives in the repo's common dir,
    // shared by the checkout and every worktree, so any other fetch in this repo between the two
    // commands below can rewrite it first. That created branches from another PR's head: right name,
    // clean status, no diff, wrong tree. The ref is kept afterwards, since it costs 41 bytes and
    // records what the branch came from.
    const head = `refs/acorn/pull/${pullNumber}`
    try {
      await gitOrThrow(['fetch', '--no-tags', '--quiet', 'origin', `+pull/${pullNumber}/head:${head}`], { cwd: checkout, timeoutMs: 60_000 })
    } catch {
      return { ok: false, reason: `Could not fetch pull/${pullNumber}/head.` }
    }
    const exists = await branchExists(checkout, branch)
    const args = exists
      ? ['worktree', 'add', '--', path, branch]
      : ['worktree', 'add', '-b', branch, '--', path, head]
    try {
      await gitOrThrow(args, { cwd: checkout, timeoutMs: 60_000 })
    } catch {
      return { ok: false, reason: 'Could not create the worktree.' }
    }
    invalidateWorktreeStatus(path)
    return { ok: true, path, created: true }
  }

  // Local-first workspace. Add a worktree on the branch, and start a new branch from the resolved
  // base ref (docs/workspaces-and-tasks.md § Worktrees and setup). `--` ends option parsing so a
  // branch or path cannot be read as a flag.
  const exists = await branchExists(checkout, branch)
  const baseRef = exists ? null : await resolveBaseRef(checkout, preferredBaseRef)
  const args = exists
    ? ['worktree', 'add', '--', path, branch]
    : ['worktree', 'add', '-b', branch, '--', path, ...(baseRef ? [baseRef] : [])]
  try {
    await gitOrThrow(args, { cwd: checkout, timeoutMs: 60_000 })
  } catch {
    return { ok: false, reason: `Could not create a worktree for ${branch}.` }
  }
  invalidateWorktreeStatus(path)
  return { ok: true, path, created: true }
}

// Copy files into a fresh worktree without a setup script (docs/workspaces-and-tasks.md § Worktrees
// and setup). Repo-relative paths only, missing sources warn, existing targets are never
// overwritten, and a bad entry never fails worktree creation.
export type CopyFilesResult = { copied: string[]; warnings: string[] }

export function copyWorktreeFiles(checkout: string, worktree: string, entries: string[]): CopyFilesResult {
  const copied: string[] = []
  const warnings: string[] = []
  for (const entry of entries) {
    if (isAbsolute(entry) || entry.split(/[\\/]/).includes('..')) {
      warnings.push(`copy: '${entry}' rejected, repo-relative paths only`)
      continue
    }
    const src = resolve(checkout, entry)
    const dst = resolve(worktree, entry)
    // Defence in depth after the lexical check above.
    if (!isContainedPath(checkout, src) || !isContainedPath(worktree, dst)) {
      warnings.push(`copy: '${entry}' rejected, it escapes the repo`)
      continue
    }
    if (!existsSync(src)) {
      warnings.push(`copy: '${entry}' is missing in the checkout, skipped`)
      continue
    }
    if (existsSync(dst)) continue // never overwrite what is already there
    try {
      mkdirSync(dirname(dst), { recursive: true })
      copyFileSync(src, dst)
      copied.push(entry)
    } catch (e) {
      warnings.push(`copy: '${entry}' failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return { copied, warnings }
}

// Does this worktree have uncommitted changes?
//
// `fresh: true`, always. This is what `removeWorktree` below decides on, and a cached "clean" would
// let a destructive deletion past the guard and lose somebody's uncommitted work. The cache in
// ./worktreeStatus.ts serves reads and never a refusal, and this is the refusal
// (docs/workspaces-and-tasks.md § Worktrees and setup).
export async function worktreeDirty(path: string): Promise<boolean> {
  return (await worktreeStatus(path, { fresh: true })).dirty
}

// Dirty flag and changed-file count for the rail and footer markers (docs/workspaces-and-tasks.md).
// A read, so it takes the coalesced answer: one `git status` per worktree per two seconds however many
// clients are asking (./worktreeStatus.ts).
export async function worktreePorcelain(path: string): Promise<WorktreeStatus> {
  return worktreeStatus(path)
}

// Remove a worktree through the main checkout. Refuses a dirty worktree unless force is set, which
// discards uncommitted changes. The UI surfaces that, so removal is never quietly destructive.
export async function removeWorktree(checkout: string, path: string, force = false): Promise<WorktreeResult> {
  if (!force && (await worktreeDirty(path))) {
    return { ok: false, reason: 'Worktree has uncommitted changes. Confirm to discard.' }
  }
  const args = ['worktree', 'remove', ...(force ? ['--force'] : []), path]
  try {
    await gitOrThrow(args, { cwd: checkout, timeoutMs: 30_000 })
  } catch {
    return { ok: false, reason: 'Could not remove the worktree.' }
  }
  // The directory is gone, so whatever we remembered about it is a lie about a path that may be
  // recreated on the same name by the next `ensureWorktree`.
  invalidateWorktreeStatus(path)
  return { ok: true, path }
}
