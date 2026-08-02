import { sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeTestDb, type TestDb } from '@acorn/node-core/server/routes/testDb.ts'

describe('managed-agent FTS schema', () => {
  let testDb: TestDb

  beforeEach(() => {
    testDb = makeTestDb()
  })

  afterEach(() => testDb.cleanup())

  it('keeps the append-only event search projection and triggers installed', async () => {
    const columns = await testDb.db.all<{ name: string }>(
      sql`SELECT name FROM pragma_table_info('agent_events_fts') ORDER BY cid`,
    )
    expect(columns.map((column) => column.name)).toEqual(['event_id', 'session_id', 'content'])
    const triggers = await testDb.db.all<{ name: string }>(sql`
      SELECT name
      FROM sqlite_master
      WHERE type = 'trigger' AND name LIKE 'agent_events_fts_%'
      ORDER BY name
    `)
    expect(triggers.map((trigger) => trigger.name)).toEqual([
      'agent_events_fts_delete',
      'agent_events_fts_insert',
      'agent_events_fts_update',
    ])
  })
})
