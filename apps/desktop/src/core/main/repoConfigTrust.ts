// Trust gate for repo-authored executable configuration. A checkout is untrusted input even on a
// trusted machine: cloning it must not be sufficient to execute committed commands.
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { and, desc, eq } from 'drizzle-orm'
import type { AppDatabase } from '../server/db'
import { schema } from '../server/db'
import type { RepoConfigTrustReview } from '../shared/api'
import { getRepoPath } from './repoPaths'
import { isDir, loadTask } from './taskWorktree'

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

type Snapshot = { hash: string; text: string; files: Array<{ path: string; content: string }> }

// Snapshot every repo-owned executable configuration file. Keeping the verbatim text makes the
// approval inspectable and diffable; sorting paths makes the hash deterministic across platforms.
export function readRepoConfigSnapshot(repoDir: string): Snapshot | null {
  const paths: string[] = []
  const config = join(repoDir, '.acorn', 'config.toml')
  if (existsSync(config)) paths.push('.acorn/config.toml')
  const workflowsDir = join(repoDir, '.acorn', 'workflows')
  if (existsSync(workflowsDir)) {
    for (const name of readdirSync(workflowsDir).filter((entry) => entry.endsWith('.toml')).sort()) {
      paths.push(`.acorn/workflows/${name}`)
    }
  }
  if (!paths.length) return null
  const files = paths.map((path) => ({ path, content: readFileSync(join(repoDir, path), 'utf8') }))
  const text = files.map((file) => `### ${file.path}\n${file.content.replace(/\s+$/, '')}\n`).join('\n')
  return { files, text, hash: createHash('sha256').update(text).digest('hex') }
}

async function taskSnapshot(db: AppDatabase, taskId: string): Promise<{ repo: string; snapshot: Snapshot } | null> {
  const task = await loadTask(db, taskId)
  if (!task) return null
  const mapped = await getRepoPath(db, task.repoOwner, task.repoName)
  const repoDir = task.worktreePath && isDir(task.worktreePath) ? task.worktreePath : mapped?.path && isDir(mapped.path) ? mapped.path : null
  if (!repoDir) return null
  const snapshot = readRepoConfigSnapshot(repoDir)
  return snapshot ? { repo: `${task.repoOwner}/${task.repoName}`, snapshot } : null
}

export async function repoConfigTrustReview(db: AppDatabase, taskId: string): Promise<RepoConfigTrustReview> {
  const current = await taskSnapshot(db, taskId)
  if (!current) return { taskId, repo: null, trusted: true, current: null, previous: null }
  const [ack] = await db
    .select()
    .from(schema.configAcks)
    .where(and(eq(schema.configAcks.repo, current.repo), eq(schema.configAcks.hash, current.snapshot.hash)))
    .limit(1)
  const [previous] = await db
    .select()
    .from(schema.configAcks)
    .where(eq(schema.configAcks.repo, current.repo))
    .orderBy(desc(schema.configAcks.ackedAt))
    .limit(1)
  return {
    taskId,
    repo: current.repo,
    trusted: !!ack,
    current: current.snapshot,
    previous: previous && previous.hash !== current.snapshot.hash ? { hash: previous.hash, text: previous.snapshot, ackedAt: previous.ackedAt } : null,
  }
}

export async function assertRepoConfigTrusted(db: AppDatabase, taskId: string): Promise<void> {
  const review = await repoConfigTrustReview(db, taskId)
  if (!review.trusted) throw new RepoConfigTrustError(taskId)
}

export async function acknowledgeRepoConfig(db: AppDatabase, taskId: string, hash: string): Promise<RepoConfigTrustReview> {
  const review = await repoConfigTrustReview(db, taskId)
  if (!review.current || !review.repo) return review
  if (review.current.hash !== hash) throw new Error('Repo configuration changed while it was being reviewed. Review the new diff before trusting it.')
  await db
    .insert(schema.configAcks)
    .values({ repo: review.repo, hash, snapshot: review.current.text, ackedAt: Date.now() })
    .onConflictDoUpdate({
      target: [schema.configAcks.repo, schema.configAcks.hash],
      set: { snapshot: review.current.text, ackedAt: Date.now() },
    })
  return repoConfigTrustReview(db, taskId)
}
