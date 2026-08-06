import type { BatchItem } from 'drizzle-orm/batch'
import { and, eq, inArray } from 'drizzle-orm'
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core'
import { checks as checksTable, comments as commentsTable, prCommits, prFiles, prLabels, pullRequests, repos as reposTable, reviewRequests, reviewThreads, reviews as reviewsTable } from '../node/schema'
import type { PluginDatabase } from '@acorn/node-core/main/pluginStorage.ts'

export type MirrorPullKey = { userId: string; repoId: number; number: number }

const wherePull = (table: { userId: SQLiteColumn; repoId: SQLiteColumn; number: SQLiteColumn }, key: MirrorPullKey) =>
  and(eq(table.userId, key.userId), eq(table.repoId, key.repoId), eq(table.number, key.number))

// The schema intentionally has no foreign keys, so every parent eviction must carry its inverse
// writes explicitly. Keep the full GitHub mirror lineage in one helper so a new child table cannot
// be forgotten independently by repo-list refresh, pull-list refresh, and startup repair.
export function deletePullMirrorStatements(db: PluginDatabase, keys: MirrorPullKey[]): BatchItem<'sqlite'>[] {
  return keys.flatMap((key) => [
    db.delete(prFiles).where(wherePull(prFiles, key)),
    db.delete(prLabels).where(wherePull(prLabels, key)),
    db.delete(reviewsTable).where(wherePull(reviewsTable, key)),
    db.delete(reviewRequests).where(wherePull(reviewRequests, key)),
    db.delete(commentsTable).where(wherePull(commentsTable, key)),
    db.delete(prCommits).where(wherePull(prCommits, key)),
    db.delete(checksTable).where(wherePull(checksTable, key)),
    db.delete(reviewThreads).where(wherePull(reviewThreads, key)),
    db.delete(pullRequests).where(wherePull(pullRequests, key)),
  ])
}

export function deleteRepoMirrorStatements(db: PluginDatabase, userId: string, repoIds: number[]): BatchItem<'sqlite'>[] {
  if (!repoIds.length) return []
  const whereRepo = (table: { userId: SQLiteColumn; repoId: SQLiteColumn }) =>
    and(eq(table.userId, userId), inArray(table.repoId, repoIds))
  return [
    db.delete(prFiles).where(whereRepo(prFiles)),
    db.delete(prLabels).where(whereRepo(prLabels)),
    db.delete(reviewsTable).where(whereRepo(reviewsTable)),
    db.delete(reviewRequests).where(whereRepo(reviewRequests)),
    db.delete(commentsTable).where(whereRepo(commentsTable)),
    db.delete(prCommits).where(whereRepo(prCommits)),
    db.delete(checksTable).where(whereRepo(checksTable)),
    db.delete(reviewThreads).where(whereRepo(reviewThreads)),
    db.delete(pullRequests).where(whereRepo(pullRequests)),
  ]
}

const keyString = (key: MirrorPullKey): string => `${key.userId}\0${key.repoId}\0${key.number}`
const repoKey = (key: { userId: string; repoId: number }): string => `${key.userId}\0${key.repoId}`

export type MirrorRepairResult = { removedPulls: number }

// Repair installations affected by historic parent-only eviction. This is a bounded startup
// reconciliation over the local derived mirror: GitHub remains the source of truth, and deleted
// rows are re-fetched normally if their parent becomes visible again.
export async function pruneOrphanedGithubMirror(db: PluginDatabase): Promise<MirrorRepairResult> {
  const [repos, pulls, files, labels, reviews, requests, comments, commits, checks, threads] = await Promise.all([
    db.select({ userId: reposTable.userId, repoId: reposTable.id }).from(reposTable),
    db.select({ userId: pullRequests.userId, repoId: pullRequests.repoId, number: pullRequests.number }).from(pullRequests),
    db.select({ userId: prFiles.userId, repoId: prFiles.repoId, number: prFiles.number }).from(prFiles),
    db.select({ userId: prLabels.userId, repoId: prLabels.repoId, number: prLabels.number }).from(prLabels),
    db.select({ userId: reviewsTable.userId, repoId: reviewsTable.repoId, number: reviewsTable.number }).from(reviewsTable),
    db.select({ userId: reviewRequests.userId, repoId: reviewRequests.repoId, number: reviewRequests.number }).from(reviewRequests),
    db.select({ userId: commentsTable.userId, repoId: commentsTable.repoId, number: commentsTable.number }).from(commentsTable),
    db.select({ userId: prCommits.userId, repoId: prCommits.repoId, number: prCommits.number }).from(prCommits),
    db.select({ userId: checksTable.userId, repoId: checksTable.repoId, number: checksTable.number }).from(checksTable),
    db.select({ userId: reviewThreads.userId, repoId: reviewThreads.repoId, number: reviewThreads.number }).from(reviewThreads),
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
