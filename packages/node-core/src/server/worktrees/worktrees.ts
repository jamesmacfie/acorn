import { gitOrThrow, gitText } from '../core/git'
import { ProcessError } from '../core/proc'
import { constants, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { rename, rm } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { isValidBranch } from '@acorn/protocol/branch.ts'
import { isContainedPath, worktreeBranchDirName } from './pathGuards'
import { resolveInRoot } from '../core/fs'
import { invalidateWorktreeStatus, worktreeStatus, type WorktreeStatus } from './worktreeStatus'
import { createLogger, describeError } from '../telemetry/logger'

const log = createLogger('worktrees')

// Workspace worktrees. docs/workspaces-and-tasks/worktrees.md § Worktrees and setup owns why they exist and
// how their paths are derived and revalidated.
//
// Every git command here runs in the main checkout, which owns the .git the worktree links to.
// execFile takes an argument array, never a shell. The branch is slugged for the directory name and
// isContainedPath guards the result.

export async function branchExists(checkout: string, branch: string): Promise<boolean> {
  try {
    await gitOrThrow(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], { cwd: checkout, timeoutMs: 10_000 })
    return true
  } catch {
    return false
  }
}

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
// path runs setup (docs/workspaces-and-tasks/worktrees.md § Worktrees and setup).
type EnsureWorktreeResult = { ok: true; path: string; created: boolean } | { ok: false; reason: string }

// Git stderr can contain remote URLs with credentials. Surface the one actionable local setup
// failure without forwarding arbitrary command output to a task pane or plugin caller.
const gitFailure = (summary: string, error: unknown): string =>
  error instanceof ProcessError && /You have not agreed to the Xcode license agreements/.test(error.result.stderr)
    ? `${summary} Accept the Xcode license in Terminal, or install the standalone Command Line Tools.`
    : summary

// The linked worktrees git knows for this checkout, each on a branch. Git lists the main checkout
// first, so it is skipped, along with bare, detached, and prunable entries, since none of them has a
// branch a task could own.
export async function listWorktrees(checkout: string): Promise<Array<{ path: string; branch: string }>> {
  const roster = await gitText(['worktree', 'list', '--porcelain', '-z'], { cwd: checkout, timeoutMs: 10_000 })
  const out: Array<{ path: string; branch: string }> = []
  // Entries are separated by an empty field.
  for (const entry of roster.split('\0\0').slice(1)) {
    const fields = entry.split('\0')
    const path = fields.find((f) => f.startsWith('worktree '))?.slice('worktree '.length)
    const branch = fields.find((f) => f.startsWith('branch refs/heads/'))?.slice('branch refs/heads/'.length)
    if (
      path &&
      branch &&
      !fields.some((f) => f === 'bare' || f === 'locked' || f.startsWith('locked ') || f.startsWith('prunable'))
    )
      out.push({ path, branch })
  }
  return out
}

// Read structured local metadata after a failed add. Git's stderr can contain credentials, so
// expose the occupied branch and path without forwarding arbitrary command output.
async function worktreeCreationFailure(
  checkout: string,
  branch: string,
  summary: string,
  error: unknown,
): Promise<string> {
  try {
    const roster = await gitText(['worktree', 'list', '--porcelain', '-z'], { cwd: checkout, timeoutMs: 10_000 })
    let path = ''
    for (const field of roster.split('\0')) {
      if (field.startsWith('worktree ')) path = field.slice('worktree '.length)
      else if (field === `branch refs/heads/${branch}` && path) {
        return `${summary} Branch '${branch}' is already checked out at '${path}'. Release the branch in that worktree, then reopen this task. Setup runs after Acorn creates its worktree.`
      }
    }
  } catch {
    // A diagnostic read must preserve the original failure when Git itself is unavailable.
  }
  return gitFailure(summary, error)
}

export async function ensureWorktree(
  worktreesRoot: string,
  checkout: string,
  owner: string,
  repo: string,
  branch: string,
  pullNumber: number | null,
): Promise<EnsureWorktreeResult> {
  if (!isValidBranch(branch)) return { ok: false, reason: 'Invalid branch name.' }
  const path = join(worktreesRoot, worktreeBranchDirName(owner, repo, branch))
  // Defence in depth. Never operate on a path that escaped the worktrees root, even though the
  // handler validates identifiers too (docs/security.md).
  if (!isContainedPath(worktreesRoot, path)) return { ok: false, reason: 'Invalid worktree path.' }
  if (existsSync(path)) {
    // Reuse only a live worktree still on this branch. docs/workspaces-and-tasks/worktrees.md § Worktrees and
    // setup covers why, and what happens otherwise.
    const on = worktreeBranch(path)
    if (on === branch) return { ok: true, path, created: false }
    return { ok: false, reason: staleWorktreeReason(path, branch, on) }
  }

  const { prepareWorktreePhase } = await import('./preparationTelemetry')
  mkdirSync(worktreesRoot, { recursive: true })

  if (pullNumber != null) {
    // PR workspace. Fetch the head with the checkout's git credentials, then check it out on the
    // PR's branch, where `branch` equals pr.headRef, so the worktree tracks a real branch and not a
    // detached commit. `--` ends option parsing before positionals.
    //
    // Fetch into a private per-PR ref, never FETCH_HEAD. FETCH_HEAD lives in the repo's common dir,
    // shared by the checkout and every worktree, so any other fetch in this repo between the two
    // commands below can rewrite it first, and a branch would be born at another PR's head: right name,
    // clean status, no diff, wrong tree. The ref is kept afterwards, since it costs 41 bytes and
    // records what the branch came from.
    const head = `refs/acorn/pull/${pullNumber}`
    try {
      await prepareWorktreePhase('git.fetch', () =>
        gitOrThrow(['fetch', '--no-tags', '--quiet', 'origin', `+pull/${pullNumber}/head:${head}`], {
          cwd: checkout,
          timeoutMs: 60_000,
        }),
      )
    } catch (error) {
      return { ok: false, reason: gitFailure(`Could not fetch pull/${pullNumber}/head.`, error) }
    }
    const exists = await branchExists(checkout, branch)
    const args = exists ? ['worktree', 'add', '--', path, branch] : ['worktree', 'add', '-b', branch, '--', path, head]
    try {
      await prepareWorktreePhase('git.worktree.add', () => gitOrThrow(args, { cwd: checkout, timeoutMs: 60_000 }))
    } catch (error) {
      return {
        ok: false,
        reason: await worktreeCreationFailure(checkout, branch, 'Could not create the worktree.', error),
      }
    }
    invalidateWorktreeStatus(path)
    return { ok: true, path, created: true }
  }

  // Local-first workspace. Add a worktree on the branch, and start a new branch from the project
  // checkout's HEAD (docs/workspaces-and-tasks/worktrees.md § Worktrees and setup). Omitting a start point
  // makes Git resolve HEAD in `checkout`, so the task inherits local commits even when origin's
  // remote-tracking ref is stale. `--` ends option parsing so a branch or path cannot be read as a
  // flag.
  const exists = await branchExists(checkout, branch)
  const args = exists ? ['worktree', 'add', '--', path, branch] : ['worktree', 'add', '-b', branch, '--', path]
  try {
    await prepareWorktreePhase('git.worktree.add', () => gitOrThrow(args, { cwd: checkout, timeoutMs: 60_000 }))
  } catch (error) {
    return {
      ok: false,
      reason: await worktreeCreationFailure(checkout, branch, `Could not create a worktree for ${branch}.`, error),
    }
  }
  invalidateWorktreeStatus(path)
  return { ok: true, path, created: true }
}

// Copy files into a fresh worktree without a setup script (docs/workspaces-and-tasks/worktrees.md § Worktrees
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
    const src = resolveInRoot(checkout, entry)
    const dst = resolveInRoot(worktree, entry)
    if (!src || !dst) {
      warnings.push(`copy: '${entry}' rejected, it escapes the repo`)
      continue
    }
    try {
      const source = statSync(src, { throwIfNoEntry: false })
      if (!source) {
        warnings.push(`copy: '${entry}' is missing in the checkout, skipped`)
        continue
      }
      if (!source.isFile()) {
        warnings.push(`copy: '${entry}' is not a regular file, skipped`)
        continue
      }
      if (lstatSync(dst, { throwIfNoEntry: false })) continue // never overwrite an entry, even a link
      mkdirSync(dirname(dst), { recursive: true })
      copyFileSync(src, dst, constants.COPYFILE_EXCL)
      copied.push(entry)
    } catch (e) {
      warnings.push(`copy: '${entry}' failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return { copied, warnings }
}

// Does this worktree have uncommitted changes?
//
// `fresh: true`, always. This is what `setWorktreeAside` below decides on, and a cached "clean" would
// let a destructive deletion past the guard and lose somebody's uncommitted work. The cache in
// ./worktreeStatus.ts serves reads and never a refusal, and this is the refusal
// (docs/workspaces-and-tasks/worktrees.md § Worktrees and setup).
export async function worktreeDirty(path: string): Promise<boolean> {
  return (await worktreeStatus(path, { fresh: true })).dirty
}

// Dirty flag and changed-file count for the rail and footer markers (docs/workspaces-and-tasks.md).
// A read, so it takes the coalesced answer: one `git status` per worktree per two seconds however many
// clients are asking (./worktreeStatus.ts).
export async function worktreePorcelain(path: string): Promise<WorktreeStatus> {
  return worktreeStatus(path)
}

// Archive renames a worktree to a sibling with this suffix and deletes it after the task is archived.
// The timestamp lets a task archived, restored, and archived again set aside a second folder while
// the first is still being deleted.
const ASIDE_SUFFIX = /-\d+-acorn-archive$/

/** The folder an aside came from, or null for a name archive didn't make. */
export const asideOriginal = (aside: string): string | null =>
  ASIDE_SUFFIX.test(aside) ? aside.replace(ASIDE_SUFFIX, '') : null

// Move a worktree aside for archive. Refuses a dirty worktree unless force is set, which discards
// uncommitted changes. The UI surfaces that, so removal is never quietly destructive.
//
// Nothing is deleted here. `git worktree remove` deleted in place, and a big folder ran past git's
// time limit and was left half deleted on an active task. A rename is instant. The caller marks the
// task archived and then calls `discardWorktree`, or renames the folder back if it couldn't. A folder
// still set aside at boot is finished or put back by `reconcileWorktrees`.
//
// `aside` is null when there is nothing to move: a folder that is already gone, or one git no longer
// tracks that sits outside the worktrees folder and so belongs to the user.
export async function setWorktreeAside(
  path: string,
  force = false,
  worktreesRoot?: string,
): Promise<{ ok: true; aside: string | null } | { ok: false; reason: string }> {
  if (!existsSync(path)) return { ok: true, aside: null }
  if (isUnlinkedWorktree(path)) {
    if (!force) return { ok: false, reason: 'The worktree folder is no longer linked to git. Confirm to delete it.' }
    if (!worktreesRoot || !isContainedPath(worktreesRoot, path) || resolve(path) === resolve(worktreesRoot)) {
      return { ok: true, aside: null }
    }
  } else if (!force && (await worktreeDirty(path))) {
    return { ok: false, reason: 'Worktree has uncommitted changes. Confirm to discard.' }
  }
  const aside = `${path}-${Date.now()}-acorn-archive`
  try {
    await rename(path, aside)
  } catch {
    return { ok: false, reason: 'Could not remove the worktree.' }
  }
  invalidateWorktreeStatus(path)
  return { ok: true, aside }
}

// After the task is archived: drop git's record of the folder, so restoring the task can check its
// branch out again, then delete the folder in the background.
export async function discardWorktree(checkout: string, aside: string | null): Promise<void> {
  try {
    await gitOrThrow(['worktree', 'prune'], { cwd: checkout, timeoutMs: 30_000 })
  } catch {
    // The record outlives a failed prune. Restoring the task then fails until a later prune clears it.
  }
  if (aside) deleteAside(aside)
}

const deleting = new Set<string>()

/** Delete a set-aside folder in the background. Boot's sweep and an archive can both ask for one. */
export function deleteAside(aside: string): void {
  if (deleting.has(aside)) return
  deleting.add(aside)
  void rm(aside, { recursive: true, force: true })
    .catch((error) => log.warn(`could not delete ${aside}: ${describeError(error).message}`))
    .finally(() => deleting.delete(aside))
}

export const isDeletingAside = (aside: string): boolean => deleting.has(aside)

// A task folder that git no longer tracks: its `.git` link file is missing, or points at an entry
// `git worktree prune` already removed. A `.git` folder is a full repository, not ours to delete, so
// it never counts.
function isUnlinkedWorktree(dir: string): boolean {
  const link = lstatSync(join(dir, '.git'), { throwIfNoEntry: false })
  if (!link) return true
  if (!link.isFile()) return false
  const pointer = readFileSync(join(dir, '.git'), 'utf8').trim()
  return pointer.startsWith('gitdir:') && !existsSync(resolve(dir, pointer.slice('gitdir:'.length).trim()))
}
