import { sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createProjectService } from '@acorn/node-core/main/core/projects.ts'
import { makeTestDb, makeTestPluginDb, type TestDb, type TestPluginDb } from '@acorn/node-core/testkit/db.ts'
import { schema } from '@acorn/node-core/server/db/index.ts'
import { dbSavedQueries } from './schema'
import { backfillLegacySavedQueries, legacyDbSavedQueriesRekey } from './legacyPairs'
import { migrationsDir } from './migrations'

describe('database legacy pair upgrade', () => {
  let pluginDb: TestPluginDb
  let coreDb: TestDb

  beforeEach(async () => {
    pluginDb = makeTestPluginDb('database', migrationsDir())
    coreDb = makeTestDb()
    await coreDb.db.insert(schema.workspaces).values({ id: 'workspace-1', name: 'Default', isDefault: true, sort: 0, createdAt: 1, updatedAt: 1 })
    await coreDb.db.insert(schema.projects).values({
      id: 'project-web', name: 'web', path: null, workspaceId: 'workspace-1', githubOwner: 'Acme', githubName: 'Web',
      createdAt: 1, updatedAt: 1,
    })
  })

  afterEach(() => {
    pluginDb.cleanup()
    coreDb.cleanup()
  })

  it('backfills resolvable saved queries before dropping staging and leaves unmatched rows inert', async () => {
    await pluginDb.db.insert(dbSavedQueries).values([
      { id: 'query-match', projectId: null, name: 'matched', notes: null, sql: 'select 1', createdAt: 1, updatedAt: 1 },
      { id: 'query-miss', projectId: null, name: 'unmatched', notes: null, sql: 'select 2', createdAt: 2, updatedAt: 2 },
    ])
    await pluginDb.db.insert(legacyDbSavedQueriesRekey).values([
      { id: 'query-match', repoOwner: 'acme', repoName: 'web' },
      { id: 'query-miss', repoOwner: 'gone', repoName: 'repo' },
    ])

    expect(pluginDb.db.all(sql`SELECT name FROM sqlite_master WHERE name = 'legacy_db_saved_queries_rekey'`)).toEqual([{ name: 'legacy_db_saved_queries_rekey' }])
    await backfillLegacySavedQueries(pluginDb.db, createProjectService(coreDb.db))

    expect(await pluginDb.db.select({ id: dbSavedQueries.id, projectId: dbSavedQueries.projectId }).from(dbSavedQueries).orderBy(dbSavedQueries.id)).toEqual([
      { id: 'query-match', projectId: 'project-web' },
      { id: 'query-miss', projectId: null },
    ])
    expect(pluginDb.db.all(sql`SELECT name FROM sqlite_master WHERE name = 'legacy_db_saved_queries_rekey'`)).toEqual([])
  })

  it('is a no-op on the next boot, when its own first run has already dropped staging', async () => {
    // Init runs on every boot, so this is the ordinary case after one upgrade — and on a fresh install,
    // where the migration made an empty staging table and the first init removed it.
    await backfillLegacySavedQueries(pluginDb.db, createProjectService(coreDb.db))
    await expect(backfillLegacySavedQueries(pluginDb.db, createProjectService(coreDb.db))).resolves.toBeUndefined()
  })
})
