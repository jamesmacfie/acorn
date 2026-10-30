import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { makeTestPluginDb, type TestPluginDb } from '@acorn/plugin-api/testkit'
import { reviewGuides } from '../node/schema'

const MIGRATIONS = fileURLToPath(new URL('../../migrations', import.meta.url))

/** The chain as a Node had it before the progress column, in a folder the test extends later. */
function chainBeforeProgress(): string {
  const folder = mkdtempSync(join(tmpdir(), 'acorn-review-guide-chain-'))
  cpSync(MIGRATIONS, folder, { recursive: true })
  const journalPath = join(folder, 'meta', '_journal.json')
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { idx: number; tag: string }[] }
  for (const entry of journal.entries.slice(1)) rmSync(join(folder, `${entry.tag}.sql`))
  writeFileSync(journalPath, JSON.stringify({ ...journal, entries: journal.entries.slice(0, 1) }))
  return folder
}

let database: TestPluginDb | undefined
let folder: string | undefined
afterEach(() => {
  database?.cleanup()
  if (folder) rmSync(folder, { recursive: true, force: true })
})

it('keeps an existing guide and gives it no progress', () => {
  folder = chainBeforeProgress()
  database = makeTestPluginDb('review-guide', folder)
  database.db.run(sql`
    INSERT INTO review_guides (task_id, base_sha, head_sha, base_ref, profile_id, status, guide, created_at, updated_at)
    VALUES ('task-1', 'b', 'h', 'main', 'codex', 'ready', '{"summary":"Old."}', 1, 1)
  `)
  database.db.close()
  cpSync(MIGRATIONS, folder, { recursive: true })
  const migrated = database.openConnection()
  try {
    expect(migrated.select().from(reviewGuides).all()).toMatchObject([
      { taskId: 'task-1', status: 'ready', guide: '{"summary":"Old."}', progress: null },
    ])
  } finally {
    migrated.close()
  }
})
