import { getTableColumns, sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeTestDb, type TestDb } from '../routes/testDb'
import { memories } from './schema'

// memories_fts is a hand-written FTS5 virtual table (drizzle can't model it), kept in sync with
// `memories` by migration discipline alone. This guard opens a real migrated DB and asserts the
// FTS column set still matches what main/memory.ts indexes, so a drifted migration edit fails CI.
describe('memories_fts schema drift guard', () => {
  let t: TestDb

  beforeEach(() => {
    t = makeTestDb()
  })

  afterEach(() => t.cleanup())

  it('FTS5 columns match the indexed memories columns', async () => {
    const ftsColumns = (await t.db.all<{ name: string }>(sql`SELECT name FROM pragma_table_info('memories_fts') ORDER BY cid`)).map(
      (r) => r.name,
    )
    // id is UNINDEXED (the join key back to memories); name/description/body are the search surface.
    expect(ftsColumns).toEqual(['id', 'name', 'description', 'body'])

    // Every FTS column must still exist on memories (schema.ts is what the migrations mirror).
    const memoryColumns = new Set(Object.values(getTableColumns(memories)).map((c) => c.name))
    for (const column of ftsColumns) expect(memoryColumns).toContain(column)
  })
})
