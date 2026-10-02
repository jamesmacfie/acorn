import { dedupeBranch, isValidBranch } from '@acorn/protocol/branch.ts'
import type { WorktreeAvailability } from '@acorn/protocol/api.ts'
import type { AppDatabase } from '../db'
import type { ProjectRow } from '../projects'
import { git, gitOrThrow, gitText } from '../core/git'
import { branchExists } from './worktrees'
import { worktreeAvailability, worktreeNameConflict } from './worktreeAvailability'
import { localBranches } from './branches'

export type TaskBranchSeed = { branch: string | null; branchSource?: 'derived' | 'exact'; baseBranch?: string }

export class TaskBranchError extends Error {
  constructor(public readonly status: 400 | 409, message: string) { super(message) }
}

const occupied = 'This branch name already exists in another worktree'
const queues = new WeakMap<AppDatabase, Promise<void>>()

// Serialize Git checks and row reservation across projects on this Node: different projects can
// map to the same worktree directory. The callback must save synchronously before releasing it.
export async function withBranchReservation<T>(db: AppDatabase, action: () => Promise<T>): Promise<T> {
  const previous = queues.get(db) ?? Promise.resolve()
  let release!: () => void
  const next = new Promise<void>((resolve) => { release = resolve })
  queues.set(db, next)
  await previous
  try { return await action() }
  finally {
    release()
    if (queues.get(db) === next) queues.delete(db)
  }
}

async function baseCommit(project: ProjectRow, seed: TaskBranchSeed): Promise<string | undefined> {
  if (seed.baseBranch === undefined) return undefined
  if (project.vcs !== 'git' || !project.path || !seed.branch) {
    throw new TaskBranchError(400, 'A base branch requires a new Git worktree task.')
  }
  if (!isValidBranch(seed.baseBranch)) throw new TaskBranchError(400, 'Invalid base branch name.')
  try {
    return await gitText(['rev-parse', '--verify', `refs/heads/${seed.baseBranch}^{commit}`], { cwd: project.path, timeoutMs: 10_000 })
  } catch {
    throw new TaskBranchError(400, 'The base must be an existing local branch.')
  }
}

export async function taskBranchAvailability(db: AppDatabase, project: ProjectRow, seed: TaskBranchSeed): Promise<WorktreeAvailability> {
  await baseCommit(project, seed)
  return availableTaskBranch(db, project, seed)
}

async function availableTaskBranch(db: AppDatabase, project: ProjectRow, seed: TaskBranchSeed, excluded: ReadonlySet<string> = new Set()): Promise<WorktreeAvailability> {
  if (project.vcs !== 'git' || !seed.branch) return { available: true }
  const existing = seed.baseBranch !== undefined ? new Set((await localBranches(project.path!)).map((branch) => branch.name)) : new Set<string>()
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
export async function saveTaskBranch<T>(db: AppDatabase, project: ProjectRow, seed: TaskBranchSeed, save: (branch: string | null) => T): Promise<T> {
  const commit = await baseCommit(project, seed)
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
          if (seed.branchSource === 'derived') { rejected.add(branch); continue }
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
