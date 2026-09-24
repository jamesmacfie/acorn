import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SqliteDatabase } from './sqlite'

export class MigrationHistoryError extends Error {
  override readonly name = 'MigrationHistoryError'
}

type JournalEntry = { tag: string; when: number }
type AppliedMigration = { hash: string; created_at: number }

const resetInstruction = 'This database uses an older schema. Use the recoverable reset in docs/local-development.md, then start with a fresh data root.'

/** Check Drizzle's applied prefix before its migrator reads only the newest timestamp. */
export function assertMigrationHistory(owner: string, dir: string, sqlite: Pick<SqliteDatabase, 'prepare'>): void {
  const table = sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'").get()
  const ownedTables = sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != '__drizzle_migrations' LIMIT 1").get()
  if (!table) {
    if (ownedTables) throw new MigrationHistoryError(`${owner} has tables without a migration history. ${resetInstruction}`)
    return
  }

  let applied: AppliedMigration[]
  let journal: JournalEntry[]
  try {
    applied = sqlite.prepare('SELECT hash, created_at FROM __drizzle_migrations ORDER BY rowid ASC').all() as AppliedMigration[]
    const entries: unknown = JSON.parse(readFileSync(join(dir, 'meta/_journal.json'), 'utf8')).entries
    if (!Array.isArray(entries)) throw new Error('entries must be an array')
    journal = entries.map((entry: unknown, index) => {
      const { tag, when } = entry as { tag?: unknown; when?: unknown }
      if (typeof tag !== 'string' || !tag || typeof when !== 'number' || !Number.isFinite(when)) {
        throw new Error(`invalid journal entry at index ${index}`)
      }
      return { tag, when }
    })
  } catch (error) {
    throw new MigrationHistoryError(`${owner} migration history could not be checked: ${String(error)}. ${resetInstruction}`)
  }

  if (applied.length === 0 && ownedTables) {
    throw new MigrationHistoryError(`${owner} has tables without applied migrations. ${resetInstruction}`)
  }

  if (applied.length > journal.length) {
    throw new MigrationHistoryError(`${owner} has ${applied.length} applied migrations but this package has ${journal.length}. ${resetInstruction}`)
  }

  for (const [index, actual] of applied.entries()) {
    const entry = journal[index]
    let expectedHash: string
    try {
      expectedHash = createHash('sha256').update(readFileSync(join(dir, `${entry.tag}.sql`), 'utf8')).digest('hex')
    } catch {
      throw new MigrationHistoryError(`${owner} migration '${entry.tag}' is missing from '${dir}'.`)
    }
    if (actual.hash === expectedHash && Number(actual.created_at) === entry.when) continue
    throw new MigrationHistoryError(`${owner} migration '${entry.tag}' at applied index ${index} no longer matches this database. ${resetInstruction}`)
  }
}
