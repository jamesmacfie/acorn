import { and, eq, isNull, sql } from 'drizzle-orm'
import type { ProjectService } from '@acorn/node-core/main/core/index.ts'
import type { PluginDatabase } from '@acorn/node-core/main/pluginStorage.ts'
import { sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { httpRequests, httpVariables } from './schema'

// These tables exist only between migration 0002 and the awaited plugin init. Pair resolution is a
// CoreServices operation, so the plugin keeps the upgrade bytes locally until core has stamped IDs.
export const legacyHttpRequestsRekey = sqliteTable('legacy_http_requests_rekey', {
  id: text('id').primaryKey(),
  repoOwner: text('repo_owner'),
  repoName: text('repo_name'),
})

export const legacyHttpVariablesRekey = sqliteTable('legacy_http_variables_rekey', {
  id: text('id').primaryKey(),
  repoOwner: text('repo_owner'),
  repoName: text('repo_name'),
})

// Init runs on EVERY boot, and the first one drops the staging tables — so "are they still there?" is
// the no-op guard. Without it the second boot dies on `no such table` before the plugin finishes
// starting. Both tables are created by the same migration, so one check answers for both.
const stagingExists = async (db: PluginDatabase): Promise<boolean> =>
  (await db.all(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'legacy_http_requests_rekey'`)).length > 0

export async function backfillLegacyHttpData(db: PluginDatabase, projects: Pick<ProjectService, 'byGithub'>): Promise<void> {
  if (!(await stagingExists(db))) return

  const [requestStage, variableStage] = await Promise.all([
    db.select().from(legacyHttpRequestsRekey),
    db.select().from(legacyHttpVariablesRekey),
  ])
  const resolved = new Map<string, string | null>()
  const projectFor = async (owner: string | null, name: string | null): Promise<string | null> => {
    if (!owner || !name) return null
    const key = `${owner}\u0000${name}`
    if (!resolved.has(key)) resolved.set(key, (await projects.byGithub(owner, name))?.id ?? null)
    return resolved.get(key) ?? null
  }

  for (const row of requestStage) {
    const projectId = await projectFor(row.repoOwner, row.repoName)
    if (!projectId) continue
    await db
      .update(httpRequests)
      .set({ projectId })
      .where(and(eq(httpRequests.id, row.id), isNull(httpRequests.projectId)))
  }
  for (const row of variableStage) {
    const projectId = await projectFor(row.repoOwner, row.repoName)
    if (!projectId) continue
    await db
      .update(httpVariables)
      .set({ projectId })
      .where(and(eq(httpVariables.id, row.id), isNull(httpVariables.projectId)))
  }

  // As with the database plugin, keep the upgrade-only bytes until all stamping succeeds. An init
  // failure leaves staging available for a retry; unmatched rows are safely dropped as inert data.
  await db.run(sql`DROP TABLE IF EXISTS legacy_http_requests_rekey`)
  await db.run(sql`DROP TABLE IF EXISTS legacy_http_variables_rekey`)
}
