// Post-db:generate guard (docs/local-development.md): apply the FULL migration chain to a fresh,
// throwaway SQLite DB, statement by statement, and fail with the offending file + statement.
//
// Why: drizzle's SQLite dialect handles "add a NOT NULL column to a populated table" as a
// table-rebuild — CREATE `__new_<table>` + `INSERT INTO __new_… SELECT <cols> FROM <table>` — and
// the generated SELECT lists the NEW column, which doesn't exist in the source table. That copy is
// invalid SQL even on an empty DB ("no such column"), so a fresh-DB replay catches it the moment
// it's generated instead of at db:migrate/app-startup time. It must be hand-trimmed from the
// SELECT (see docs/local-development.md).
//
// Usage: pnpm --filter @acorn/desktop db:check   (also chained onto db:generate)
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const migrationsDir = resolve(dirname(fileURLToPath(import.meta.url)), '../migrations')

type JournalEntry = { idx: number; tag: string }
const journal = JSON.parse(readFileSync(join(migrationsDir, 'meta/_journal.json'), 'utf8')) as { entries: JournalEntry[] }

// Same lazy native load as main/bindings.ts — a wrong-ABI better-sqlite3 should say so.
const Database = (await import('better-sqlite3')).default

const dir = mkdtempSync(join(tmpdir(), 'acorn-migrations-check-'))
const db = new Database(join(dir, 'check.sqlite'))

let failed = false
try {
  for (const entry of journal.entries.sort((a, b) => a.idx - b.idx)) {
    const file = `${entry.tag}.sql`
    const sql = readFileSync(join(migrationsDir, file), 'utf8')
    // drizzle separates statements with `--> statement-breakpoint` when breakpoints are on.
    for (const statement of sql.split('--> statement-breakpoint')) {
      const trimmed = statement.trim()
      if (!trimmed) continue
      try {
        db.exec(trimmed)
      } catch (e) {
        failed = true
        const msg = e instanceof Error ? e.message : String(e)
        console.error(`\n✗ migrations/${file} fails on a fresh DB:\n  ${msg}\n\n  Statement:\n${trimmed.replace(/^/gm, '    ')}\n`)
        if (/INSERT INTO\s+["`]?__new_/i.test(trimmed) && /no such column/i.test(msg)) {
          console.error(
            '  This is the drizzle NOT-NULL table-rebuild quirk: the INSERT INTO __new_… SELECT\n' +
              '  copies a column that does not exist in the source table. Hand-trim the new column\n' +
              '  from the SELECT list (see docs/local-development.md → "Schema change workflow").',
          )
        }
        break // later statements in this file depend on this one; later files on this file
      }
    }
    if (failed) break
  }
} finally {
  db.close()
  rmSync(dir, { recursive: true, force: true })
}

if (failed) process.exit(1)
console.log(`✓ migration chain (${journal.entries.length} files) applies cleanly to a fresh DB`)
