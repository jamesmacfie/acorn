import { and, count, eq } from 'drizzle-orm'
import type { CoreServices, PluginDatabase } from '@acorn/plugin-api/node'
import type { MirroredPullRequest } from '../contract/mirror'
import { checks, comments, prFiles, pullRequests, repos, reviews, reviewThreads, syncState } from '../node/schema'
import { repoMatches } from './repoMatch'

// A mirrored repo row's GitHub id, for a (userId, owner, name). The mirror is keyed by the numeric
// GitHub repo id everywhere below, and nothing outside this plugin can resolve owner/name to that
// id. That is why the GitHub plugin owns mirror-related repository state, pinned repositories and
// viewed files included.
async function mirroredRepoId(db: PluginDatabase, userId: string, repoOwner: string, repoName: string): Promise<number | null> {
  const [row] = await db
    .select({ id: repos.id })
    .from(repos)
    .where(and(eq(repos.userId, userId), repoMatches(repoOwner, repoName)))
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
 * Which mirrored pull request a task is about. The task lookup goes through CoreServices because tasks
 * are core-owned, and the repo id is this plugin's, so this is the one place the two meet.
 *
 * Null covers every way there is nothing to read: no task, no PR on it, no GitHub project, no mirrored
 * repo, and no owner. Callers must not read that as "nothing wrong" — see `failingChecksFor` for why
 * the distinction is load-bearing there.
 */
async function mirroredTaskPull(
  db: PluginDatabase,
  core: Pick<CoreServices, 'tasks' | 'projects'>,
  userId: string | null,
  taskId: string,
): Promise<{ userId: string; repoId: number; number: number } | null> {
  const task = await core.tasks.load(taskId)
  if (!task || task.pullNumber == null || !userId) return null
  const project = await core.projects.byId(task.projectId)
  if (!project?.github) return null
  const repoId = await mirroredRepoId(db, userId, project.github.owner, project.github.name)
  if (repoId == null) return null
  return { userId, repoId, number: task.pullNumber }
}

// The failure rule, in one place because the ci-loop prompt and the `pr_checks` agent tool must not
// disagree about what a red PR is. A check with no status yet is not a failure: it has not run.
export const checkFailed = (status: string | null): boolean =>
  !!status && !['success', 'neutral', 'skipped'].includes(status.toLowerCase())

/**
 * Every mirrored check on the task's PR, newest mirror state, for the `pr_checks` agent tool. Null for
 * the same reasons `mirroredTaskPull` returns null, so an unmirrored repo is never a green one.
 */
export async function taskChecks(
  db: PluginDatabase,
  core: Pick<CoreServices, 'tasks' | 'projects'>,
  userId: string | null,
  taskId: string,
): Promise<{ number: number; checks: { name: string; status: string | null; url: string | null; runId: number | null }[] } | null> {
  const pull = await mirroredTaskPull(db, core, userId, taskId)
  if (!pull) return null
  const rows = await db
    .select({ name: checks.name, status: checks.status, url: checks.url, runId: checks.runId })
    .from(checks)
    .where(and(eq(checks.userId, pull.userId), eq(checks.repoId, pull.repoId), eq(checks.number, pull.number)))
  if (!rows.length) return null
  return { number: pull.number, checks: [...rows].sort((a, b) => a.name.localeCompare(b.name)) }
}

// How many rows of each kind `taskReviewFeedback` will hand an agent. A PR under review has tens of
// comments, not hundreds, and the cap is what stops the one that does from filling the context window.
const FEEDBACK_LIMIT = 100

export type ReviewFeedback = {
  number: number
  // A submitted review: its verdict and its summary prose, without the inline comments, which are the
  // threads below.
  reviews: { author: string | null; state: string | null; body: string | null; submittedAt: number | null }[]
  // Inline comments, grouped back into the threads the mirror denormalized them out of.
  threads: {
    threadId: string
    path: string | null
    line: number | null
    side: string | null
    resolved: boolean
    comments: { author: string | null; body: string | null; createdAt: number | null }[]
  }[]
  // Comments on the PR itself rather than on a line of it.
  comments: { author: string | null; body: string | null; createdAt: number | null }[]
  omitted: number
}

/**
 * What reviewers said about the task's PR, from the local mirror: the submitted reviews, the inline
 * threads, and the conversation comments. For the `pr_review_comments` agent tool.
 *
 * Resolved threads are left out by default. An agent asked to address feedback wants the open half,
 * and a long-lived PR carries more settled threads than live ones.
 */
export async function taskReviewFeedback(
  db: PluginDatabase,
  core: Pick<CoreServices, 'tasks' | 'projects'>,
  userId: string | null,
  taskId: string,
  options: { includeResolved?: boolean } = {},
): Promise<ReviewFeedback | null> {
  const pull = await mirroredTaskPull(db, core, userId, taskId)
  if (!pull) return null
  // Spelled out per table rather than through a generic `owns(table)` helper: the three columns are
  // the same but their Drizzle types are not, and the helper only typechecked with a cast that threw
  // away the column check it was there to keep.
  const [reviewRows, threadRows, commentRows] = await Promise.all([
    db.select().from(reviews)
      .where(and(eq(reviews.userId, pull.userId), eq(reviews.repoId, pull.repoId), eq(reviews.number, pull.number))),
    db.select().from(reviewThreads)
      .where(and(eq(reviewThreads.userId, pull.userId), eq(reviewThreads.repoId, pull.repoId), eq(reviewThreads.number, pull.number))),
    db.select().from(comments)
      .where(and(eq(comments.userId, pull.userId), eq(comments.repoId, pull.repoId), eq(comments.number, pull.number))),
  ])

  const byThread = new Map<string, ReviewFeedback['threads'][number]>()
  for (const row of [...threadRows].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))) {
    if (row.resolved && !options.includeResolved) continue
    const thread = byThread.get(row.threadId) ?? {
      threadId: row.threadId, path: row.path, line: row.line, side: row.side, resolved: row.resolved, comments: [],
    }
    thread.comments.push({ author: row.author, body: row.body, createdAt: row.createdAt })
    byThread.set(row.threadId, thread)
  }

  const threads = [...byThread.values()]
  const all = { reviews: reviewRows.length, threads: threads.length, comments: commentRows.length }
  return {
    number: pull.number,
    reviews: [...reviewRows]
      .sort((a, b) => (a.submittedAt ?? 0) - (b.submittedAt ?? 0))
      .slice(0, FEEDBACK_LIMIT)
      .map((row) => ({ author: row.author, state: row.state, body: row.body, submittedAt: row.submittedAt })),
    threads: threads.slice(0, FEEDBACK_LIMIT),
    comments: [...commentRows]
      .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
      .slice(0, FEEDBACK_LIMIT)
      .map((row) => ({ author: row.author, body: row.body, createdAt: row.createdAt })),
    omitted: Object.values(all).reduce((total, count) => total + Math.max(0, count - FEEDBACK_LIMIT), 0),
  }
}

/**
 * Three values, all load-bearing. '' means every check passed. Text is the rendered failure list that
 * becomes the fix prompt. Null means there is nothing to check, which the ci-loop step treats as a
 * hard failure rather than success, so `!userId` and no rows both return null: an unmirrored repo
 * must not be mistaken for a green one.
 *
 * The task lookup goes through CoreServices because tasks are core-owned. Cross-plugin references
 * stay plain ids, validated by the owning service when dereferenced.
 */
export async function failingChecksFor(
  db: PluginDatabase,
  core: Pick<CoreServices, 'tasks' | 'projects'>,
  userId: string | null,
  taskId: string,
): Promise<string | null> {
  const mirrored = await taskChecks(db, core, userId, taskId)
  if (!mirrored) return null
  const bad = mirrored.checks.filter((row) => checkFailed(row.status))
  return bad.length ? bad.map((r) => `- ${r.name}: ${r.status}${r.url ? ` (${r.url})` : ''}`).join('\n') : ''
}

/**
 * Row counts for core's boot-time storage log (server/storage/footprint.ts), which cannot see these
 * tables. The two mirror parents plus this plugin's freshness table, so the log line reports the same
 * facts it always did.
 */
export async function mirrorFootprint(db: PluginDatabase): Promise<Record<string, number>> {
  const [repoRows, pullRows, syncRows] = await Promise.all([
    db.select({ value: count() }).from(repos),
    db.select({ value: count() }).from(pullRequests),
    db.select({ value: count() }).from(syncState),
  ])
  return { repos: repoRows[0]?.value ?? 0, pulls: pullRows[0]?.value ?? 0, sync: syncRows[0]?.value ?? 0 }
}
