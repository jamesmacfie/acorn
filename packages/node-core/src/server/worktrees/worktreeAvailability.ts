import { lstatSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { eq } from 'drizzle-orm'
import { isValidBranch } from '@acorn/protocol/branch.ts'
import type { WorktreeAvailability } from '@acorn/protocol/api.ts'
import { schema, type AppDatabase } from '../db'
import type { ProjectRow } from '../projects'
import { gitText } from '../core/git'
import { getWorktreesRoot, isDir, projectWorktreeIdentity } from './taskWorktree'
import { isContainedPath, worktreeBranchDirName } from './pathGuards'

const occupied = 'This branch name already exists in another worktree'

function worktreePath(project: ProjectRow, branch: string): string {
  const { owner, repo } = projectWorktreeIdentity(project)
  return join(getWorktreesRoot(), worktreeBranchDirName(owner, repo, branch))
}

// Task rows reserve a lazy worktree before it exists. Compare directory names too: feature/x and
// feature-x map to the same directory. Keep this check synchronous with the task insert so two
// simultaneous requests cannot both reserve the name after waiting for Git.
export function worktreeNameConflict(db: AppDatabase, project: ProjectRow, branch: string): string | null {
  if (project.vcs !== 'git' || !branch) return null
  const path = worktreePath(project, branch)
  const active = db.select({ task: schema.tasks, project: schema.projects }).from(schema.tasks)
    .innerJoin(schema.projects, eq(schema.tasks.projectId, schema.projects.id))
    .where(eq(schema.tasks.status, 'active')).all()
  if (active.some(({ task, project: owner }) =>
    (task.projectId === project.id && task.branch === branch)
    || (task.worktreePath
      ? resolve(task.worktreePath) === resolve(path)
      : task.branch && owner.vcs === 'git' && resolve(worktreePath(owner, task.branch)) === resolve(path)),
  )) return occupied
  try {
    if (getWorktreesRoot() && lstatSync(path, { throwIfNoEntry: false })) return occupied
  } catch {
    // Availability is best effort. Filesystem access errors surface when the task needs its root.
  }
  return null
}

export async function worktreeAvailability(db: AppDatabase, project: ProjectRow, branch: string): Promise<WorktreeAvailability> {
  if (project.vcs !== 'git' || !branch) return { available: true }
  if (!isValidBranch(branch) || (getWorktreesRoot() && !isContainedPath(getWorktreesRoot(), worktreePath(project, branch)))) {
    return { available: false, reason: 'Invalid branch name.' }
  }
  const conflict = worktreeNameConflict(db, project, branch)
  if (conflict) return { available: false, reason: conflict }
  if (project.path && isDir(project.path)) {
    try {
      const roster = await gitText(['worktree', 'list', '--porcelain', '-z'], { cwd: project.path, timeoutMs: 10_000 })
      if (roster.split('\0').includes(`branch refs/heads/${branch}`)) return { available: false, reason: occupied }
    } catch {
      // A failed Git lookup does not block creation. Task reservations are still checked below.
    }
  }
  const latest = worktreeNameConflict(db, project, branch)
  return latest ? { available: false, reason: latest } : { available: true }
}
