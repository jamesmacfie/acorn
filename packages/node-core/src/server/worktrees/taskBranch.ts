import { dedupeBranch, isValidBranch } from '@acorn/protocol/branch.ts'
import type { WorktreeAvailability } from '@acorn/protocol/api.ts'
import type { AppDatabase } from '../db'
import { getProject, type ProjectRow } from '../projects'
import { git, gitOrThrow, gitText } from '../core/git'
import { branchExists } from './worktrees'
import { worktreeAvailability, worktreeNameConflict } from './worktreeAvailability'
import { localBranches } from './branches'
import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'

export type TaskBranchSeed = {
  branch: string | null
  branchSource?: 'derived' | 'exact'
  baseBranch?: string
  baseCommit?: string
  targetIdentity?: string
}

// An opaque observation of both the mapped checkout and its Git object store. A draft made before
// a project remap must not be admitted against another repository with the same commit object.
export async function projectTargetIdentity(project: ProjectRow): Promise<string> {
  try {
    const common = await gitText(['rev-parse', '--git-common-dir'], { cwd: project.path!, timeoutMs: 10_000 })
    return createHash('sha256')
      .update(JSON.stringify([realpathSync(project.path!), realpathSync(resolve(project.path!, common))]))
      .digest('hex')
  } catch {
    throw new TaskBranchError(409, 'The project repository is unavailable. Reopen the task draft.')
  }
}

export class TaskBranchError extends Error {
  constructor(
    public readonly status: 400 | 409,
    message: string,
  ) {
    super(message)
  }
}

const occupied = 'This branch name already exists in another worktree'
const queues = new WeakMap<AppDatabase, Map<string, Promise<void>>>()

export async function repositoryMetadataKey(project: ProjectRow): Promise<string> {
  if (project.vcs !== 'git' || !project.path) return `project:${project.id}`
  try {
    const common = await gitText(['rev-parse', '--git-common-dir'], { cwd: project.path, timeoutMs: 10_000 })
    return realpathSync(resolve(project.path, common))
  } catch {
    throw new TaskBranchError(409, 'The project repository is unavailable. Reopen the action.')
  }
}

// Serialize task reservations and metadata writes across project aliases sharing an object store.
// The callback completes its write before releasing the queue.
export async function withBranchReservation<T>(
  db: AppDatabase,
  project: ProjectRow,
  action: () => Promise<T>,
  allowUnavailable = false,
): Promise<T> {
  const keyFor = async (mapped: ProjectRow) => {
    try {
      return await repositoryMetadataKey(mapped)
    } catch (error) {
      if (!allowUnavailable) throw error
      // A task whose worktree is created lazily reserves a database branch even when Git cannot inspect
      // the checkout. Metadata writes and tasks with a pinned base still require the verified common
      // directory.
      try {
        return `checkout:${realpathSync(mapped.path!)}`
      } catch {
        return `checkout:${resolve(mapped.path!)}`
      }
    }
  }
  const key = await keyFor(project)
  const entries = queues.get(db) ?? new Map<string, Promise<void>>()
  queues.set(db, entries)
  const previous = entries.get(key) ?? Promise.resolve()
  let release!: () => void
  const next = new Promise<void>((resolve) => {
    release = resolve
  })
  entries.set(key, next)
  await previous
  try {
    const current = await getProject(db, project.id)
    if (!current || current.path !== project.path || current.vcs !== project.vcs || (await keyFor(current)) !== key) {
      throw new TaskBranchError(409, 'The project repository changed. Reopen the action.')
    }
    return await action()
  } finally {
    release()
    if (entries.get(key) === next) entries.delete(key)
  }
}

async function baseCommit(project: ProjectRow, seed: TaskBranchSeed): Promise<string | undefined> {
  if (seed.baseBranch !== undefined && seed.baseCommit !== undefined)
    throw new TaskBranchError(400, 'Choose one starting point.')
  if (seed.baseBranch === undefined && seed.baseCommit === undefined) return undefined
  if (project.vcs !== 'git' || !project.path || !seed.branch) {
    throw new TaskBranchError(400, 'A starting commit requires a new Git worktree task.')
  }
  if (seed.baseCommit !== undefined) {
    if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(seed.baseCommit))
      throw new TaskBranchError(400, 'Use a full commit ID.')
    try {
      const actual = await gitText(['cat-file', '-t', seed.baseCommit], { cwd: project.path, timeoutMs: 10_000 })
      if (actual === 'commit') return seed.baseCommit
    } catch {
      /* Missing or unavailable object. */
    }
    throw new TaskBranchError(400, 'The starting commit is not available in this repository.')
  }
  if (!seed.baseBranch || !isValidBranch(seed.baseBranch)) throw new TaskBranchError(400, 'Invalid base branch name.')
  try {
    return await gitText(['rev-parse', '--verify', `refs/heads/${seed.baseBranch}^{commit}`], {
      cwd: project.path,
      timeoutMs: 10_000,
    })
  } catch {
    throw new TaskBranchError(400, 'The base must be an existing local branch.')
  }
}

export async function taskBranchAvailability(
  db: AppDatabase,
  project: ProjectRow,
  seed: TaskBranchSeed,
): Promise<WorktreeAvailability> {
  await baseCommit(project, seed)
  const available = await availableTaskBranch(db, project, seed)
  return seed.baseCommit ? { ...available, targetIdentity: await projectTargetIdentity(project) } : available
}

async function availableTaskBranch(
  db: AppDatabase,
  project: ProjectRow,
  seed: TaskBranchSeed,
  excluded: ReadonlySet<string> = new Set(),
): Promise<WorktreeAvailability> {
  if (project.vcs !== 'git' || !seed.branch) return { available: true }
  const existing =
    seed.baseBranch !== undefined || seed.baseCommit !== undefined
      ? new Set((await localBranches(project.path!)).map((branch) => branch.name))
      : new Set<string>()
  const rejected = new Set(excluded)
  let branch = dedupeBranch(seed.branch, rejected)
  for (;;) {
    const result = await worktreeAvailability(db, project, branch)
    const conflict = existing.has(branch) ? occupied : !result.available ? result.reason : null
    if (!conflict) return { available: true, branch }
    if (seed.branchSource !== 'derived' || conflict !== occupied) return { available: false, reason: conflict, branch }
    rejected.add(branch)
    branch = dedupeBranch(seed.branch, rejected)
  }
}

// Called under withBranchReservation. A selected base is captured as a commit before saving; the
// worktree remains lazy. Git's exclusive branch creation also catches changes made outside Acorn.
export async function saveTaskBranch<T>(
  db: AppDatabase,
  project: ProjectRow,
  seed: TaskBranchSeed,
  save: (branch: string | null) => T,
): Promise<T> {
  const commit = await baseCommit(project, seed)
  if (seed.baseCommit && (!seed.targetIdentity || (await projectTargetIdentity(project)) !== seed.targetIdentity)) {
    throw new TaskBranchError(409, 'The project repository changed. Reopen the task draft.')
  }
  if (project.vcs !== 'git' || !seed.branch) return save(null)
  const rejected = new Set<string>()
  for (;;) {
    const available = await availableTaskBranch(db, project, seed, rejected)
    if (!available.available) throw new TaskBranchError(409, available.reason)
    const branch = available.branch ?? seed.branch
    let created = false
    if (commit) {
      const result = await git(['branch', '--', branch, commit], { cwd: project.path!, timeoutMs: 10_000 })
      if (result.code !== 0) {
        if (await branchExists(project.path!, branch)) {
          if (seed.branchSource === 'derived') {
            rejected.add(branch)
            continue
          }
          throw new TaskBranchError(409, occupied)
        }
        throw new TaskBranchError(409, 'Could not create the task branch from its base.')
      }
      created = true
    }
    try {
      const conflict = worktreeNameConflict(db, project, branch)
      if (conflict) throw new TaskBranchError(409, conflict)
      return save(branch)
    } catch (error) {
      if (created) await gitOrThrow(['branch', '-D', '--', branch], { cwd: project.path!, timeoutMs: 10_000 })
      if (error instanceof TaskBranchError && error.message === occupied && seed.branchSource === 'derived') {
        rejected.add(branch)
        continue
      }
      throw error
    }
  }
}
