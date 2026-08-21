import { getTableColumns, sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeTestPluginDb, type TestPluginDb } from '@acorn/plugin-api/testkit'
import { agentEvents } from './schema'

// FTS5 schema drift guard: see docs/data-layer.md § Migrations for why this table and its triggers
// are hand-written into the migration instead of the Drizzle schema, and why this file is the
// pattern to copy for another plugin's virtual table.
//
// Uses a per-plugin database rather than a core one, since the migration chain that creates these
// four objects (migrations/0000_*.sql) is this plugin's own.
describe('agent_events_fts schema drift guard', () => {
  let t: TestPluginDb

  beforeEach(() => {
    t = makeTestPluginDb('agents')
  })

  afterEach(() => t.cleanup())

  it('keeps the append-only event search projection and triggers installed', async () => {
    const columns = await t.db.all<{ name: string }>(
      sql`SELECT name FROM pragma_table_info('agent_events_fts') ORDER BY cid`,
    )
    // event_id and session_id are UNINDEXED (the join keys back to agent_events and agent_sessions);
    // `content` is the search surface, fed from agent_events.search_text by the insert/update triggers.
    expect(columns.map((column) => column.name)).toEqual(['event_id', 'session_id', 'content'])
    const triggers = await t.db.all<{ name: string }>(sql`
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

    // Every column the triggers read must still exist on agent_events (schema.ts is what the migration
    // mirrors). This is the half that catches a rename: the triggers are text inside a .sql file, so
    // renaming `search_text` in schema.ts would generate a table rebuild and leave them pointing at a
    // column that no longer exists.
    const eventColumns = new Set(Object.values(getTableColumns(agentEvents)).map((c) => c.name))
    for (const column of ['id', 'session_id', 'search_text']) expect(eventColumns).toContain(column)
  })

  // The projection is only useful if the triggers actually fire, and a virtual table with no rows answers
  // every MATCH with an empty set, which looks exactly like "nothing matched". So this asserts the whole
  // path: insert an event row through Drizzle, find it through FTS5, then delete it and confirm the
  // projection was swept.
  it('projects and unprojects an event row through the triggers', async () => {
    await t.db.insert(agentEvents).values({
      id: 'event-1',
      sessionId: 'session-1',
      turnId: null,
      seq: 1,
      schemaVersion: 1,
      eventJson: '{}',
      searchText: 'a distinctive haystack needle',
      createdAt: 1,
    })
    const matched = await t.db.all<{ event_id: string }>(
      sql`SELECT event_id FROM agent_events_fts WHERE agent_events_fts MATCH ${'"needle"'}`,
    )
    expect(matched.map((row) => row.event_id)).toEqual(['event-1'])

    await t.db.delete(agentEvents)
    const swept = await t.db.all<{ event_id: string }>(
      sql`SELECT event_id FROM agent_events_fts WHERE agent_events_fts MATCH ${'"needle"'}`,
    )
    expect(swept).toEqual([])
  })
})
