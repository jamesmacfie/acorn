import { and, count, desc, eq } from 'drizzle-orm'
import type { CoreServices } from '@acorn/node-core/main/core/index.ts'
import type { PluginDatabase } from '@acorn/node-core/main/pluginStorage.ts'
import type { MirroredPullRequest } from '../contract/mirror'
import { checks, prFiles, pullRequests, repos, syncState } from '../node/schema'

// A mirrored repo row's GitHub id, for a (userId, owner, name). The mirror is keyed by the numeric GitHub
// repo id everywhere below, and nothing outside this plugin can resolve owner/name → that id — which is
// The GitHub plugin owns mirror-related repository state, including pinned repositories and viewed files.
async function mirroredRepoId(db: PluginDatabase, userId: string, repoOwner: string, repoName: string): Promise<number | null> {
  const [row] = await db
    .select({ id: repos.id })
    .from(repos)
    .where(and(eq(repos.userId, userId), eq(repos.owner, repoOwner), eq(repos.name, repoName)))
  return row?.id ?? null
}

/**
 * Source for the `pr` context section. The section renders a capped, comma-joined changed-file list, so
 * this capability owns the file lookup and returns paths in a stable order.
 */
export async function mirroredPullRequest(
  db: PluginDatabase,
  userId: string,
  repoOwner: string,
  repoName: string,
  pullNumber: number,
): Promise<MirroredPullRequest | null> {
  const repoId = await mirroredRepoId(db, userId, repoOwner, repoName)
  if (repoId == null) return null
  const [pr] = await db
    .select()
    .from(pullRequests)
    .where(and(eq(pullRequests.userId, userId), eq(pullRequests.repoId, repoId), eq(pullRequests.number, pullNumber)))
  if (!pr) return null
  const files = await db
    .select({ path: prFiles.path })
    .from(prFiles)
    .where(and(eq(prFiles.userId, userId), eq(prFiles.repoId, repoId), eq(prFiles.number, pullNumber)))
  return { number: pr.number, title: pr.title, body: pr.body, changedFiles: files.map((file) => file.path).sort() }
}

/**
 * The three-valued contract is unchanged and is load-bearing — '' means every check passed, text is the
 * rendered failure list that becomes the fix prompt, and null means there is nothing to check, which the
 * ci-loop step treats as a hard failure rather than as success. The `!userId` and no-rows cases both fall
 * into null for exactly that reason: an unmirrored repo must not be mistaken for a green one.
 *
 * The task lookup goes through CoreServices because tasks are core-owned. Cross-plugin references remain
 * plain IDs and are validated by the owning service when dereferenced.
 */
export async function failingChecksFor(
  db: PluginDatabase,
  core: Pick<CoreServices, 'tasks'>,
  userId: string | null,
  taskId: string,
): Promise<string | null> {
  const task = await core.tasks.load(taskId)
  if (!task || task.pullNumber == null || !userId) return null
  const repoId = await mirroredRepoId(db, userId, task.repoOwner, task.repoName)
  if (repoId == null) return null
  const rows = await db
    .select()
    .from(checks)
    .where(and(eq(checks.userId, userId), eq(checks.repoId, repoId), eq(checks.number, task.pullNumber)))
  if (!rows.length) return null
  const bad = rows.filter((r) => r.status && !['success', 'neutral', 'skipped'].includes(r.status.toLowerCase()))
  return bad.length ? bad.map((r) => `- ${r.name}: ${r.status}${r.url ? ` (${r.url})` : ''}`).join('\n') : ''
}

/**
 * The candidate repo list behind core's workspace bootstrap and the onboarding master toggle. Ordered by
 * the mirror's own `pushedAt` desc / name, so the Default workspace's `sort` column comes out in the same
 * most-recently-pushed-first order the repo selector shows — bootstrap assigns `sort: i` from this list.
 */
export async function mirroredRepoList(db: PluginDatabase, userId: string): Promise<{ owner: string; name: string }[]> {
  return db
    .select({ owner: repos.owner, name: repos.name })
    .from(repos)
    .where(eq(repos.userId, userId))
    .orderBy(desc(repos.pushedAt), repos.name)
}

/** GitHub's default branch for a mirrored repo, for core's `repo_info` tool. */
export async function mirroredDefaultBranch(
  db: PluginDatabase,
  userId: string,
  owner: string,
  name: string,
): Promise<string | null> {
  const [row] = await db
    .select({ defaultBranch: repos.defaultBranch })
    .from(repos)
    .where(and(eq(repos.userId, userId), eq(repos.owner, owner), eq(repos.name, name)))
  return row?.defaultBranch ?? null
}

/**
 * Distinct owner logins with mirror rows, for `CoreServices.identity.sole()`. Deliberately the whole table
 * rather than a count: `sole()` has to distinguish one identity from two, and a count of rows would answer
 * neither.
 */
export async function mirroredIdentities(db: PluginDatabase): Promise<string[]> {
  const rows = await db.selectDistinct({ userId: repos.userId }).from(repos)
  return rows.map((row) => row.userId)
}

/**
 * Row counts for core's boot-time storage log (main/storageFootprint.ts), which can no longer see these
 * tables. The three counted here are the three it counted before — the two mirror parents plus this
 * plugin's freshness table — so the log line keeps reporting the same facts about the same data.
 */
export async function mirrorFootprint(db: PluginDatabase): Promise<Record<string, number>> {
  const [repoRows, pullRows, syncRows] = await Promise.all([
    db.select({ value: count() }).from(repos),
    db.select({ value: count() }).from(pullRequests),
    db.select({ value: count() }).from(syncState),
  ])
  return { repos: repoRows[0]?.value ?? 0, pulls: pullRows[0]?.value ?? 0, sync: syncRows[0]?.value ?? 0 }
}
