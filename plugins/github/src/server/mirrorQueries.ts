import { and, count, eq, gt } from 'drizzle-orm'
import type { CoreServices, PluginDatabase } from '@acorn/plugin-api/node'
import type { ChangeRequestFeedback } from '@acorn/protocol/plugin/contract.ts'
import type { MirroredPullRequest } from '../contract/mirror'
import { checks, comments, prFiles, pullRequests, repos, reviews, reviewThreads, syncState } from '../node/schema'
import { repoMatches } from './repoMatch'

// A mirrored repo row's GitHub id, for a (userId, owner, name). The mirror is keyed by the numeric
// GitHub repo id everywhere below, and nothing outside this plugin can resolve owner/name to that
// id. That is why the GitHub plugin owns mirror-related repository state, pinned repositories and
// viewed files included.
async function mirroredRepoId(
  db: PluginDatabase,
  userId: string,
  repoOwner: string,
  repoName: string,
): Promise<number | null> {
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
 * Which mirrored pull request a task is about: `number`, or the task's own pull request when it names
 * none. The task lookup goes through CoreServices because tasks are core-owned, and the repo id is this
 * plugin's, so this is the one place the two meet.
 *
 * Null covers every way there is nothing to read: no task, no PR on it, no GitHub project, no mirrored
 * repo, and no owner. Callers must not read that as "nothing wrong": an unmirrored repo is not a green
 * one, and the CI workflow policy fails closed on it.
 */
export async function mirroredTaskPull(
  db: PluginDatabase,
  core: Pick<CoreServices, 'tasks' | 'projects'>,
  userId: string | null,
  taskId: string,
  number?: number,
): Promise<MirroredTaskPull | null> {
  const task = await core.tasks.load(taskId)
  const pullNumber = number ?? task?.pullNumber
  if (!task || pullNumber == null || !userId) return null
  const project = await core.projects.byId(task.projectId)
  if (!project?.github) return null
  const { owner, name: repo } = project.github
  const repoId = await mirroredRepoId(db, userId, owner, repo)
  if (repoId == null) return null
  return { userId, repoId, number: pullNumber, owner, repo }
}

export type MirroredTaskPull = { userId: string; repoId: number; number: number; owner: string; repo: string }

/** Scoped comparison facts and identity for GitHub's active marker waves. */
export async function taskPullComparison(
  db: PluginDatabase,
  core: Pick<CoreServices, 'tasks' | 'projects'>,
  userId: string | null,
  taskId: string,
): Promise<{ userId: string; repoId: number; number: number; baseRef: string | null; headSha: string | null } | null> {
  const pull = await mirroredTaskPull(db, core, userId, taskId)
  if (!pull) return null
  const [row] = await db
    .select({ baseRef: pullRequests.baseRef, headSha: pullRequests.headSha })
    .from(pullRequests)
    .where(
      and(
        eq(pullRequests.userId, pull.userId),
        eq(pullRequests.repoId, pull.repoId),
        eq(pullRequests.number, pull.number),
      ),
    )
  return row ? { ...pull, ...row } : null
}

// The mirror stores a check run's `conclusion ?? status` and a status context's `state`, so a check
// that has not finished reads as one of these. A check with no status yet has not run either.
const PENDING_CHECK = new Set(['queued', 'in_progress', 'pending', 'waiting', 'requested', 'expected'])
const PASSED_CHECK = new Set(['success', 'neutral', 'skipped'])

export const checkPending = (status: string | null): boolean => !status || PENDING_CHECK.has(status.toLowerCase())

// The failure rule, in one place because the CI workflow policy and the checks route behind the
// `pr_checks` agent tool must not disagree about what a red PR is. A check that is still running has not failed.
export const checkFailed = (status: string | null): boolean =>
  !checkPending(status) && !PASSED_CHECK.has(status!.toLowerCase())

/**
 * Every mirrored check on the PR, newest mirror state, for the checks route and the CI policy. Null when
 * none are mirrored, so an unmirrored PR is never a green one.
 */
export async function taskChecks(
  db: PluginDatabase,
  pull: { userId: string; repoId: number; number: number },
): Promise<{
  number: number
  checks: { name: string; status: string | null; url: string | null; runId: number | null }[]
} | null> {
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

/**
 * What reviewers said about the PR, from the local mirror: the submitted reviews, the inline threads,
 * and the conversation comments. For the feedback route behind the `pr_review_comments` agent tool.
 *
 * Resolved threads are left out by default. An agent asked to address feedback wants the open half,
 * and a long-lived PR carries more settled threads than live ones.
 */
export async function taskReviewFeedback(
  db: PluginDatabase,
  pull: { userId: string; repoId: number; number: number },
  options: { includeResolved?: boolean } = {},
): Promise<ChangeRequestFeedback> {
  // Spelled out per table rather than through a generic `owns(table)` helper: the three columns are
  // the same but their Drizzle types are not, and the helper only typechecks with a cast that throws
  // away the column check it is there to keep.
  const [reviewRows, threadRows, commentRows] = await Promise.all([
    db
      .select()
      .from(reviews)
      .where(and(eq(reviews.userId, pull.userId), eq(reviews.repoId, pull.repoId), eq(reviews.number, pull.number))),
    db
      .select()
      .from(reviewThreads)
      .where(
        and(
          eq(reviewThreads.userId, pull.userId),
          eq(reviewThreads.repoId, pull.repoId),
          eq(reviewThreads.number, pull.number),
        ),
      ),
    db
      .select()
      .from(comments)
      .where(and(eq(comments.userId, pull.userId), eq(comments.repoId, pull.repoId), eq(comments.number, pull.number))),
  ])

  const byThread = new Map<string, ChangeRequestFeedback['threads'][number]>()
  for (const row of [...threadRows].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))) {
    if (row.resolved && !options.includeResolved) continue
    const thread = byThread.get(row.threadId) ?? {
      threadId: row.threadId,
      path: row.path,
      line: row.outdated == null ? null : row.line,
      originalLine: row.originalLine,
      outdated: row.outdated,
      side: row.side,
      resolved: row.resolved,
      comments: [],
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

export type ReviewActivity = {
  kind: 'review' | 'thread-comment' | 'comment'
  author: string | null
  body: string | null
  at: number
  /** A review's verdict, such as APPROVED or CHANGES_REQUESTED. */
  state?: string | null
  /** An inline comment's file. */
  path?: string | null
}

/**
 * Reviews, inline comments, and conversation comments on the task's PR made after `since`, oldest
 * first, with the PR's state and author. For the review-received workflow policy.
 *
 * Its own query rather than `taskReviewFeedback`, which keeps the oldest hundred of each and drops
 * resolved threads. A long-lived PR would lose exactly the new comments this looks for.
 */
export async function reviewActivitySince(
  db: PluginDatabase,
  pull: { userId: string; repoId: number; number: number },
  since: number,
  options: { includeBots: boolean },
): Promise<{ state: string; author: string | null; activity: ReviewActivity[] } | null> {
  const [pr] = await db
    .select({ state: pullRequests.state, author: pullRequests.author })
    .from(pullRequests)
    .where(
      and(
        eq(pullRequests.userId, pull.userId),
        eq(pullRequests.repoId, pull.repoId),
        eq(pullRequests.number, pull.number),
      ),
    )
  if (!pr) return null
  const [reviewRows, threadRows, commentRows] = await Promise.all([
    db
      .select()
      .from(reviews)
      .where(
        and(
          eq(reviews.userId, pull.userId),
          eq(reviews.repoId, pull.repoId),
          eq(reviews.number, pull.number),
          gt(reviews.submittedAt, since),
        ),
      ),
    db
      .select()
      .from(reviewThreads)
      .where(
        and(
          eq(reviewThreads.userId, pull.userId),
          eq(reviewThreads.repoId, pull.repoId),
          eq(reviewThreads.number, pull.number),
          gt(reviewThreads.createdAt, since),
        ),
      ),
    db
      .select()
      .from(comments)
      .where(
        and(
          eq(comments.userId, pull.userId),
          eq(comments.repoId, pull.repoId),
          eq(comments.number, pull.number),
          gt(comments.createdAt, since),
        ),
      ),
  ])
  // The PR's author answering their own reviewers is not a review.
  const counts = (row: { author: string | null; authorIsBot: boolean | null }) =>
    row.author !== pr.author && (options.includeBots || row.authorIsBot !== true)
  const activity: ReviewActivity[] = [
    ...reviewRows.filter(counts).map((row) => ({
      kind: 'review' as const,
      author: row.author,
      body: row.body,
      at: row.submittedAt!,
      state: row.state,
    })),
    ...threadRows.filter(counts).map((row) => ({
      kind: 'thread-comment' as const,
      author: row.author,
      body: row.body,
      at: row.createdAt!,
      path: row.path,
    })),
    ...commentRows
      .filter(counts)
      .map((row) => ({ kind: 'comment' as const, author: row.author, body: row.body, at: row.createdAt! })),
  ]
  return { state: pr.state, author: pr.author, activity: activity.sort((a, b) => a.at - b.at) }
}

/**
 * Row counts for core's boot-time storage log (`logStorageFootprint`), which cannot see these tables:
 * the two mirror parents plus this plugin's freshness table.
 */
export async function mirrorFootprint(db: PluginDatabase): Promise<Record<string, number>> {
  const [repoRows, pullRows, syncRows] = await Promise.all([
    db.select({ value: count() }).from(repos),
    db.select({ value: count() }).from(pullRequests),
    db.select({ value: count() }).from(syncState),
  ])
  return { repos: repoRows[0]?.value ?? 0, pulls: pullRows[0]?.value ?? 0, sync: syncRows[0]?.value ?? 0 }
}
