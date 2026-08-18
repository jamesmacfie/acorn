import { gitOrThrow } from './core/git'
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import type { WorktreeResult } from '@acorn/protocol/terminal.ts'
import { isContainedPath, isDirty, worktreeBranchDirName } from './pathGuards'


// Workspace worktrees (docs/workspaces-and-tasks.md): a workspace edits its branch in an isolated git
// worktree instead of dirtying the main checkout, and we get a clean cleanup affordance. Worktrees
// live under the app data dir, keyed by branch. All git runs in the *main checkout* (it owns the
// .git the worktree links to). execFile with arg arrays — no shell; owner/repo are validated
// upstream, the branch is slugged for the dir name and isContainedPath guards the result.

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

// Base-ref precedence for a NEW branch (docs/terminal-and-agents.md, verne's order): per-project
// preferred ref (prefs key `base_ref:<projectId>`, resolved by the caller) → origin/main →
// origin/master → null (= HEAD, today's behaviour).
export async function resolveBaseRef(checkout: string, preferred?: string | null): Promise<string | null> {
  for (const candidate of [...(preferred?.trim() ? [preferred.trim()] : []), 'origin/main', 'origin/master']) {
    if (await refExists(checkout, candidate)) return candidate
  }
  return null
}

// Lazy on first terminal (Flow C). For a PR workspace, check out the PR head detached (robust for
// forks). For a local-first workspace, reuse the branch if it exists else create it from HEAD.
// A branch name safe to pass to git as a positional: no leading dash (so it can't be read as a
// flag) and only git-legal ref chars. The dir name is slugged separately; this guards the *git arg*.
const isValidBranch = (branch: string): boolean => !branch.startsWith('-') && /^[A-Za-z0-9._/-]+$/.test(branch)

// The branch a linked worktree actually has checked out, read straight off disk: `<dir>/.git` is a
// file pointing at the repo's admin dir for that worktree, whose HEAD holds the ref. `null` means
// the directory is not a live linked worktree — pruned, moved, or on a detached HEAD.
//
// Read rather than shelled out to `git branch --show-current` because resolveTaskCwd calls this on
// EVERY task→cwd resolution, which is once per editor file read, not once per session.
// Trusts the pointer file: a worktree relinked to a DIFFERENT repo with the same owner/name/branch
// still passes. Compare the admin dir against the checkout if that ever matters.
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

// Why a worktree directory can't be handed to the task that owns it. Shared so the two callers —
// reuse below and the persisted-path shortcut in taskWorktree — say the same thing.
export const staleWorktreeReason = (path: string, branch: string, on: string | null): string =>
  `${path} is ${on ? `checked out on '${on}', not '${branch}'` : `no longer a live git worktree for '${branch}'`}. Remove the directory and reopen the task.`

// `created` distinguishes a fresh `git worktree add` from reuse of an existing dir — the caller
// runs the workspace setup script only on the fresh path (docs/workspaces-and-tasks.md).
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
  // Defense in depth: never operate on a path that escaped the worktrees root (handler validates
  // identifiers too, docs/security.md).
  if (!isContainedPath(worktreesRoot, path)) return { ok: false, reason: 'Invalid worktree path.' }
  if (existsSync(path)) {
    // Reuse — but only a LIVE worktree still on this branch. The directory name is keyed by
    // owner/repo/branch alone, and a `git worktree prune`, a manual checkout inside it or a moved
    // repo all leave the folder behind holding some other branch's files. Handing that back is how
    // a task's agent ended up reading, editing and reporting on a tree that was not its own.
    const on = worktreeBranch(path)
    if (on === branch) return { ok: true, path, created: false }
    return { ok: false, reason: staleWorktreeReason(path, branch, on) }
  }

  mkdirSync(worktreesRoot, { recursive: true })

  if (pullNumber != null) {
    // PR workspace: fetch the head (uses the checkout's git credentials) and check it out on the
    // PR's branch (`branch` == pr.headRef) so the worktree tracks a real branch, not a detached
    // commit — new branch from the fetched head, or reuse the branch if it already exists locally.
    // `--` ends option parsing before positionals.
    //
    // Into a PRIVATE PER-PR REF, never FETCH_HEAD. That file lives in the repo's COMMON dir, shared
    // by the checkout and every worktree, and `git fetch` rewrites it — so anything else fetching in
    // this repo between the two commands below (another task resolving its worktree, the PR-conflicts
    // route) decided which commit this branch was created at. The branch then carried another PR's
    // tree under the right name, with a clean status and no diff, and the bad ref outlived the
    // worktree. The ref is kept afterwards: it costs 41 bytes and records what the branch came from.
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
    return { ok: true, path, created: true }
  }

  // Local-first workspace: add a worktree on the branch. A NEW branch starts from the resolved
  // base ref (per-repo preference → origin/main → origin/master → HEAD, docs/terminal-and-agents.md). `--`
  // ends option parsing so a branch/path can never be mistaken for a flag (argv-injection guard).
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
  return { ok: true, path, created: true }
}

// Files-to-copy (docs/workflows.md §2): carry gitignored files (.env.local, …) from the source
// checkout into a freshly-created worktree without a setup script. Repo-relative paths only
// (absolute / traversal entries are rejected), missing sources warn, existing targets are never
// overwritten. Best-effort: a bad entry never fails worktree creation.
export type CopyFilesResult = { copied: string[]; warnings: string[] }

export function copyWorktreeFiles(checkout: string, worktree: string, entries: string[]): CopyFilesResult {
  const copied: string[] = []
  const warnings: string[] = []
  for (const entry of entries) {
    if (isAbsolute(entry) || entry.split(/[\\/]/).includes('..')) {
      warnings.push(`copy: '${entry}' rejected — repo-relative paths only`)
      continue
    }
    const src = resolve(checkout, entry)
    const dst = resolve(worktree, entry)
    // Defense in depth after the lexical check above.
    if (!isContainedPath(checkout, src) || !isContainedPath(worktree, dst)) {
      warnings.push(`copy: '${entry}' rejected — escapes the repo`)
      continue
    }
    if (!existsSync(src)) {
      warnings.push(`copy: '${entry}' missing in the checkout — skipped`)
      continue
    }
    if (existsSync(dst)) continue // never overwrite what's already there
    try {
      mkdirSync(dirname(dst), { recursive: true })
      copyFileSync(src, dst)
      copied.push(entry)
    } catch (e) {
      warnings.push(`copy: '${entry}' failed — ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return { copied, warnings }
}

export async function worktreeDirty(path: string): Promise<boolean> {
  try {
    const { stdout } = await gitOrThrow(['status', '--porcelain'], { cwd: path, timeoutMs: 10_000 })
    return isDirty(stdout)
  } catch {
    return false
  }
}

// Dirty flag + changed-file count for the live rail/footer markers (docs/workspaces-and-tasks.md/05).
export async function worktreePorcelain(path: string): Promise<{ dirty: boolean; count: number }> {
  try {
    const { stdout } = await gitOrThrow(['status', '--porcelain'], { cwd: path, timeoutMs: 10_000 })
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
  const args = ['worktree', 'remove', ...(force ? ['--force'] : []), path]
  try {
    await gitOrThrow(args, { cwd: checkout, timeoutMs: 30_000 })
  } catch {
    return { ok: false, reason: 'Could not remove the worktree.' }
  }
  return { ok: true, path }
}
