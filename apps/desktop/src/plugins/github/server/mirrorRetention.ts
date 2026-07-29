import type { BatchItem } from 'drizzle-orm/batch'
import { and, eq, inArray } from 'drizzle-orm'
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core'
import type { AppDatabase } from '../../../core/server/db'
import { schema } from '../../../core/server/db'

export type MirrorPullKey = { userId: string; repoId: number; number: number }

const wherePull = (table: { userId: SQLiteColumn; repoId: SQLiteColumn; number: SQLiteColumn }, key: MirrorPullKey) =>
  and(eq(table.userId, key.userId), eq(table.repoId, key.repoId), eq(table.number, key.number))

// The schema intentionally has no foreign keys, so every parent eviction must carry its inverse
// writes explicitly. Keep the full GitHub mirror lineage in one helper so a new child table cannot
// be forgotten independently by repo-list refresh, pull-list refresh, and startup repair.
export function deletePullMirrorStatements(db: AppDatabase, keys: MirrorPullKey[]): BatchItem<'sqlite'>[] {
  return keys.flatMap((key) => [
    db.delete(schema.prFiles).where(wherePull(schema.prFiles, key)),
    db.delete(schema.prLabels).where(wherePull(schema.prLabels, key)),
    db.delete(schema.reviews).where(wherePull(schema.reviews, key)),
    db.delete(schema.reviewRequests).where(wherePull(schema.reviewRequests, key)),
    db.delete(schema.comments).where(wherePull(schema.comments, key)),
    db.delete(schema.prCommits).where(wherePull(schema.prCommits, key)),
    db.delete(schema.checks).where(wherePull(schema.checks, key)),
    db.delete(schema.reviewThreads).where(wherePull(schema.reviewThreads, key)),
    db.delete(schema.pullRequests).where(wherePull(schema.pullRequests, key)),
  ])
}

export function deleteRepoMirrorStatements(db: AppDatabase, userId: string, repoIds: number[]): BatchItem<'sqlite'>[] {
  if (!repoIds.length) return []
  const whereRepo = (table: { userId: SQLiteColumn; repoId: SQLiteColumn }) =>
    and(eq(table.userId, userId), inArray(table.repoId, repoIds))
  return [
    db.delete(schema.prFiles).where(whereRepo(schema.prFiles)),
    db.delete(schema.prLabels).where(whereRepo(schema.prLabels)),
    db.delete(schema.reviews).where(whereRepo(schema.reviews)),
    db.delete(schema.reviewRequests).where(whereRepo(schema.reviewRequests)),
    db.delete(schema.comments).where(whereRepo(schema.comments)),
    db.delete(schema.prCommits).where(whereRepo(schema.prCommits)),
    db.delete(schema.checks).where(whereRepo(schema.checks)),
    db.delete(schema.reviewThreads).where(whereRepo(schema.reviewThreads)),
    db.delete(schema.pullRequests).where(whereRepo(schema.pullRequests)),
  ]
}

const keyString = (key: MirrorPullKey): string => `${key.userId}\0${key.repoId}\0${key.number}`
const repoKey = (key: { userId: string; repoId: number }): string => `${key.userId}\0${key.repoId}`

export type MirrorRepairResult = { removedPulls: number }

// Repair installations affected by historic parent-only eviction. This is a bounded startup
// reconciliation over the local derived mirror: GitHub remains the source of truth, and deleted
// rows are re-fetched normally if their parent becomes visible again.
export async function pruneOrphanedGithubMirror(db: AppDatabase): Promise<MirrorRepairResult> {
  const [repos, pulls, files, labels, reviews, requests, comments, commits, checks, threads] = await Promise.all([
    db.select({ userId: schema.repos.userId, repoId: schema.repos.id }).from(schema.repos),
    db.select({ userId: schema.pullRequests.userId, repoId: schema.pullRequests.repoId, number: schema.pullRequests.number }).from(schema.pullRequests),
    db.select({ userId: schema.prFiles.userId, repoId: schema.prFiles.repoId, number: schema.prFiles.number }).from(schema.prFiles),
    db.select({ userId: schema.prLabels.userId, repoId: schema.prLabels.repoId, number: schema.prLabels.number }).from(schema.prLabels),
    db.select({ userId: schema.reviews.userId, repoId: schema.reviews.repoId, number: schema.reviews.number }).from(schema.reviews),
    db.select({ userId: schema.reviewRequests.userId, repoId: schema.reviewRequests.repoId, number: schema.reviewRequests.number }).from(schema.reviewRequests),
    db.select({ userId: schema.comments.userId, repoId: schema.comments.repoId, number: schema.comments.number }).from(schema.comments),
    db.select({ userId: schema.prCommits.userId, repoId: schema.prCommits.repoId, number: schema.prCommits.number }).from(schema.prCommits),
    db.select({ userId: schema.checks.userId, repoId: schema.checks.repoId, number: schema.checks.number }).from(schema.checks),
    db.select({ userId: schema.reviewThreads.userId, repoId: schema.reviewThreads.repoId, number: schema.reviewThreads.number }).from(schema.reviewThreads),
  ])

  const repoKeys = new Set(repos.map(repoKey))
  const validPulls = new Set(pulls.filter((pull) => repoKeys.has(repoKey(pull))).map(keyString))
  const orphaned = new Map<string, MirrorPullKey>()
  for (const pull of pulls) {
    if (!repoKeys.has(repoKey(pull))) orphaned.set(keyString(pull), pull)
  }
  for (const row of [...files, ...labels, ...reviews, ...requests, ...comments, ...commits, ...checks, ...threads]) {
    if (!validPulls.has(keyString(row))) orphaned.set(keyString(row), row)
  }

  const keys = [...orphaned.values()]
  const statements = deletePullMirrorStatements(db, keys)
  if (statements.length) await db.batch(statements as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]])
  return { removedPulls: keys.length }
}
