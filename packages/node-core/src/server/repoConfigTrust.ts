// Trust gate for the executable configuration a task can run: the repo's own `.acorn` files, and the
// project row's script columns. A checkout is untrusted input even on a trusted machine — cloning it
// must not be sufficient to execute committed commands — and the row is in the snapshot as the belt
// behind the device-only gate on the write path (docs/security.md § Process, path, and configuration
// controls).
import { and, desc, eq, isNotNull } from 'drizzle-orm'
import type { AppDatabase } from './db'
import { schema } from './db'
import type { RepoConfigTrustReview } from '@acorn/protocol/api.ts'
import { isDir, loadTask, projectForTask } from './worktrees/taskWorktree'
import { readRepoConfigSnapshot, type RepoConfigSnapshot } from './repoConfigSnapshot'
export { readRepoConfigSnapshot, type ProjectExecutableConfig } from './repoConfigSnapshot'

export const NEEDS_CONFIG_TRUST = 'needs-trust'

export class RepoConfigTrustError extends Error {
  readonly code = NEEDS_CONFIG_TRUST
  constructor(public readonly taskId: string) {
    super('Repo configuration must be reviewed and trusted before it can run.')
    this.name = 'RepoConfigTrustError'
  }
}

export const isRepoConfigTrustError = (error: unknown): error is RepoConfigTrustError =>
  error instanceof RepoConfigTrustError ||
  (!!error && typeof error === 'object' && 'code' in error && error.code === NEEDS_CONFIG_TRUST)

async function taskSnapshot(db: AppDatabase, taskId: string): Promise<{ projectId: string; snapshot: RepoConfigSnapshot } | null> {
  const task = await loadTask(db, taskId)
  if (!task) return null
  const project = await projectForTask(db, task)
  const repoDir = task.worktreePath && isDir(task.worktreePath) ? task.worktreePath : project?.path && isDir(project.path) ? project.path : null
  if (!repoDir) return null
  const snapshot = readRepoConfigSnapshot(repoDir, project)
  return snapshot && project ? { projectId: project.id, snapshot } : null
}

async function projectSnapshot(db: AppDatabase, projectId: string): Promise<{ projectId: string; snapshot: RepoConfigSnapshot } | null> {
  const project = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).get()
  if (!project) throw new Error('Project not found.')
  if (!project.path || !isDir(project.path)) return null
  const snapshot = readRepoConfigSnapshot(project.path, project)
  return snapshot ? { projectId, snapshot } : null
}

export async function assertProjectRepoConfigTrusted(db: AppDatabase, projectId: string): Promise<void> {
  const current = await projectSnapshot(db, projectId)
  if (!current) return
  const ack = await db.select({ hash: schema.configAcks.hash }).from(schema.configAcks).where(and(
    eq(schema.configAcks.projectId, current.projectId), eq(schema.configAcks.hash, current.snapshot.hash),
  )).get()
  if (!ack) throw new Error('Repository configuration must be reviewed and trusted before this schedule can dispatch.')
}

export async function repoConfigTrustReview(db: AppDatabase, taskId: string): Promise<RepoConfigTrustReview> {
  const current = await taskSnapshot(db, taskId)
  if (!current) return { taskId, projectId: null, trusted: true, current: null, previous: null }
  const [ack] = await db
    .select()
    .from(schema.configAcks)
    .where(and(isNotNull(schema.configAcks.projectId), eq(schema.configAcks.projectId, current.projectId), eq(schema.configAcks.hash, current.snapshot.hash)))
    .limit(1)
  const [previous] = await db
    .select()
    .from(schema.configAcks)
    .where(and(isNotNull(schema.configAcks.projectId), eq(schema.configAcks.projectId, current.projectId)))
    .orderBy(desc(schema.configAcks.ackedAt))
    .limit(1)
  return {
    taskId,
    projectId: current.projectId,
    trusted: !!ack,
    current: current.snapshot,
    previous: previous && previous.hash !== current.snapshot.hash ? { hash: previous.hash, text: previous.snapshot, ackedAt: previous.ackedAt } : null,
  }
}

export async function assertRepoConfigTrusted(db: AppDatabase, taskId: string, expectedHash?: string): Promise<void> {
  const review = await repoConfigTrustReview(db, taskId)
  if (!review.trusted || (expectedHash !== undefined && review.current?.hash !== expectedHash)) throw new RepoConfigTrustError(taskId)
}

export async function acknowledgeRepoConfig(db: AppDatabase, taskId: string, hash: string): Promise<RepoConfigTrustReview> {
  const review = await repoConfigTrustReview(db, taskId)
  if (!review.current || !review.projectId) return review
  if (review.current.hash !== hash) throw new Error('Repo configuration changed while it was being reviewed. Review the new diff before trusting it.')
  await db
    .insert(schema.configAcks)
    .values({ projectId: review.projectId, hash, snapshot: review.current.text, ackedAt: Date.now() })
    .onConflictDoUpdate({
      target: [schema.configAcks.projectId, schema.configAcks.hash],
      set: { snapshot: review.current.text, ackedAt: Date.now() },
    })
  return repoConfigTrustReview(db, taskId)
}
