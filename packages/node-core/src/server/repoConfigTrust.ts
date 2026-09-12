// Trust gate for the executable configuration a task can run: the repo's own `.acorn` files, and the
// project row's script columns. A checkout is untrusted input even on a trusted machine — cloning it
// must not be sufficient to execute committed commands — and the row is in the snapshot as the belt
// behind the device-only gate on the write path (docs/security.md § Process, path, and configuration
// controls).
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { and, desc, eq, isNotNull } from 'drizzle-orm'
import type { AppDatabase } from './db'
import { schema } from './db'
import type { RepoConfigTrustReview } from '@acorn/protocol/api.ts'
import { isDir, loadTask, projectForTask } from './worktrees/taskWorktree'

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

// The project row's executable columns: commands acorn runs later, on worktree creation, a dev run, an
// archive, or a database connect. Every one of them is a shell command, which is why they belong in a
// snapshot the owner acknowledges rather than only in a settings form.
//
// `runTargets` is here with the other five even though it is a JSON blob rather than a single command,
// because what the blob holds is `command`, `stop` and `restart` strings that the run pane executes.
// Leaving it out would put the same hole one column over.
export type ProjectExecutableConfig = Partial<Pick<
  typeof schema.projects.$inferSelect,
  'setupScript' | 'devScript' | 'devRestartScript' | 'teardownScript' | 'dbUrlScript' | 'runTargets'
>>

// The pseudo-path the project row is snapshotted under. Not a file, and named so it cannot collide
// with one: everything else in a snapshot is a real path relative to the checkout.
const PROJECT_ROW_PATH = '(project settings)'

const PROJECT_ROW_FIELDS = ['setupScript', 'devScript', 'devRestartScript', 'teardownScript', 'dbUrlScript', 'runTargets'] as const

// Fixed field order and only the fields that are set, so the same configuration hashes the same way
// whatever order the columns arrive in and an unset column never differs from an empty one.
function projectRowText(project: ProjectExecutableConfig): string | null {
  const lines = PROJECT_ROW_FIELDS
    .map((field) => [field, project[field]?.trim()] as const)
    .filter((entry): entry is readonly [typeof PROJECT_ROW_FIELDS[number], string] => !!entry[1])
    .map(([field, value]) => `${field} = ${value}`)
  return lines.length ? lines.join('\n') : null
}

// Snapshot every piece of executable configuration this task could run: the repo-owned files, and the
// project row's script columns. Keeping the verbatim text makes the approval inspectable and diffable;
// sorting paths makes the hash deterministic across platforms.
//
// The row is in here because the gate's original premise — the checkout is untrusted, the database is
// trusted — only holds while nothing but the owner can write the database. `PUT /v2/core/projects/:id/config`
// is device-only now (server/index.ts), so that premise is true again; this is the belt behind it. A
// write the owner did not make still changes the hash, and the next thing that asks for trust shows the
// owner the script rather than running it.
export function readRepoConfigSnapshot(repoDir: string, project?: ProjectExecutableConfig | null): Snapshot | null {
  const paths: string[] = []
  const config = join(repoDir, '.acorn', 'config.toml')
  if (existsSync(config)) paths.push('.acorn/config.toml')
  const workflowsDir = join(repoDir, '.acorn', 'workflows')
  if (existsSync(workflowsDir)) {
    for (const name of readdirSync(workflowsDir).filter((entry) => entry.endsWith('.toml')).sort()) {
      paths.push(`.acorn/workflows/${name}`)
    }
  }
  const files = paths.map((path) => ({ path, content: readFileSync(join(repoDir, path), 'utf8') }))
  const row = project ? projectRowText(project) : null
  if (row) files.push({ path: PROJECT_ROW_PATH, content: row })
  if (!files.length) return null
  const text = files.map((file) => `### ${file.path}\n${file.content.replace(/\s+$/, '')}\n`).join('\n')
  return { files, text, hash: createHash('sha256').update(text).digest('hex') }
}

async function taskSnapshot(db: AppDatabase, taskId: string): Promise<{ projectId: string; snapshot: Snapshot } | null> {
  const task = await loadTask(db, taskId)
  if (!task) return null
  const project = await projectForTask(db, task)
  const repoDir = task.worktreePath && isDir(task.worktreePath) ? task.worktreePath : project?.path && isDir(project.path) ? project.path : null
  if (!repoDir) return null
  const snapshot = readRepoConfigSnapshot(repoDir, project)
  return snapshot && project ? { projectId: project.id, snapshot } : null
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

export async function assertRepoConfigTrusted(db: AppDatabase, taskId: string): Promise<void> {
  const review = await repoConfigTrustReview(db, taskId)
  if (!review.trusted) throw new RepoConfigTrustError(taskId)
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
