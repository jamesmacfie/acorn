import { and, eq, isNull, sql } from 'drizzle-orm'
import type { ProjectService } from '@acorn/node-core/main/core/index.ts'
import type { PluginDatabase } from '@acorn/node-core/main/pluginStorage.ts'
import { sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { dbSavedQueries } from './schema'

// This table exists only between migration 0002 and the awaited plugin init. It is deliberately not
// part of the live schema: pair resolution belongs to core's ProjectService, not to this SQLite file.
export const legacyDbSavedQueriesRekey = sqliteTable('legacy_db_saved_queries_rekey', {
  id: text('id').primaryKey(),
  repoOwner: text('repo_owner'),
  repoName: text('repo_name'),
})

// Init runs on EVERY boot, and the first one drops the staging table — so "is it still there?" is the
// no-op guard. Without it the second boot dies on `no such table` before the plugin finishes starting.
const stagingExists = async (db: PluginDatabase): Promise<boolean> =>
  (await db.all(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'legacy_db_saved_queries_rekey'`)).length > 0

export async function backfillLegacySavedQueries(db: PluginDatabase, projects: Pick<ProjectService, 'byGithub'>): Promise<void> {
  if (!(await stagingExists(db))) return

  const staged = await db.select().from(legacyDbSavedQueriesRekey)
  for (const row of staged) {
    if (!row.repoOwner || !row.repoName) continue
    const project = await projects.byGithub(row.repoOwner, row.repoName)
    if (!project) continue
    await db
      .update(dbSavedQueries)
      .set({ projectId: project.id })
      .where(and(eq(dbSavedQueries.id, row.id), isNull(dbSavedQueries.projectId)))
  }

  // The staging table is dropped only after every resolvable row has been attempted. There is no
  // cross-file transaction: a failure leaves the staging data in place so the next boot can retry.
  await db.run(sql`DROP TABLE IF EXISTS legacy_db_saved_queries_rekey`)
}
