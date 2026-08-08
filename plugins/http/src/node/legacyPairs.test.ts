import { sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createProjectService } from '@acorn/node-core/main/core/projects.ts'
import { makeTestDb, makeTestPluginDb, type TestDb, type TestPluginDb } from '@acorn/node-core/testkit/db.ts'
import { schema } from '@acorn/node-core/server/db/index.ts'
import { httpRequests, httpVariables } from './schema'
import { backfillLegacyHttpData, legacyHttpRequestsRekey, legacyHttpVariablesRekey } from './legacyPairs'
import { migrationsDir } from './migrations'

describe('HTTP legacy pair upgrade', () => {
  let pluginDb: TestPluginDb
  let coreDb: TestDb

  beforeEach(async () => {
    pluginDb = makeTestPluginDb('http', migrationsDir())
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

  it('backfills requests and variables through CoreServices and safely retains unmatched nulls', async () => {
    await pluginDb.db.insert(httpRequests).values([
      { id: 'request-match', userId: 'alice', projectId: null, folder: '', taskId: null, name: 'matched', method: 'GET', url: 'sealed-url', headers: 'sealed-headers', bodyMode: 'none', body: 'sealed-body', auth: 'sealed-auth', vars: 'sealed-vars', encrypted: true, createdAt: 1, updatedAt: 1 },
      { id: 'request-miss', userId: 'alice', projectId: null, folder: '', taskId: null, name: 'unmatched', method: 'GET', url: 'sealed-url', headers: 'sealed-headers', bodyMode: 'none', body: 'sealed-body', auth: 'sealed-auth', vars: 'sealed-vars', encrypted: true, createdAt: 2, updatedAt: 2 },
    ])
    await pluginDb.db.insert(httpVariables).values([
      { id: 'variable-match', userId: 'alice', projectId: null, name: 'MATCH', kind: 'value', value: 'sealed', encrypted: true, enabled: true, createdAt: 1, updatedAt: 1 },
      { id: 'variable-miss', userId: 'alice', projectId: null, name: 'MISS', kind: 'value', value: 'sealed', encrypted: true, enabled: true, createdAt: 2, updatedAt: 2 },
    ])
    await pluginDb.db.insert(legacyHttpRequestsRekey).values([
      { id: 'request-match', repoOwner: 'acme', repoName: 'web' },
      { id: 'request-miss', repoOwner: 'gone', repoName: 'repo' },
    ])
    await pluginDb.db.insert(legacyHttpVariablesRekey).values([
      { id: 'variable-match', repoOwner: 'ACME', repoName: 'WEB' },
      { id: 'variable-miss', repoOwner: 'gone', repoName: 'repo' },
    ])

    await backfillLegacyHttpData(pluginDb.db, createProjectService(coreDb.db))

    expect(await pluginDb.db.select({ id: httpRequests.id, projectId: httpRequests.projectId }).from(httpRequests).orderBy(httpRequests.id)).toEqual([
      { id: 'request-match', projectId: 'project-web' },
      { id: 'request-miss', projectId: null },
    ])
    expect(await pluginDb.db.select({ id: httpVariables.id, projectId: httpVariables.projectId }).from(httpVariables).orderBy(httpVariables.id)).toEqual([
      { id: 'variable-match', projectId: 'project-web' },
      { id: 'variable-miss', projectId: null },
    ])
    expect(pluginDb.db.all(sql`SELECT name FROM sqlite_master WHERE name IN ('legacy_http_requests_rekey', 'legacy_http_variables_rekey')`)).toEqual([])
  })

  it('is a no-op on the next boot, when its own first run has already dropped staging', async () => {
    // Init runs on every boot, so this is the ordinary case after one upgrade — and on a fresh install,
    // where the migration made empty staging tables and the first init removed them.
    await backfillLegacyHttpData(pluginDb.db, createProjectService(coreDb.db))
    await expect(backfillLegacyHttpData(pluginDb.db, createProjectService(coreDb.db))).resolves.toBeUndefined()
  })
})
