import { backup as sqliteBackup, DatabaseSync } from 'node:sqlite'
import type { StatementSync, SQLInputValue } from 'node:sqlite'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { BetterSQLiteSession } from 'drizzle-orm/better-sqlite3/session'
import { entityKind } from 'drizzle-orm/entity'
import { createTableRelationsHelpers, extractTablesRelationalConfig } from 'drizzle-orm/relations'
import { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core/db'
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core/dialect'

// SQLite via the runtime's own `node:sqlite`, shaped like the slice of better-sqlite3 that Drizzle's
// driver and this package actually call.
//
// Drizzle publishes no `node:sqlite` driver (0.45.2 ships better-sqlite3, bun, expo, op and proxy).
// Its better-sqlite3 driver needs a small surface though: `prepare`, `transaction`, and
// `run`/`all`/`get`/`raw` on a statement, and every one of those has a `node:sqlite` equivalent.
// Meeting that shape here is far less code and far less behaviour change than moving to the generic
// async proxy driver.
//
// better-sqlite3 is a native module compiled for one ABI at a time, which is why this repo has two
// rebuild scripts and a test runner that rebuilds before it runs. `node:sqlite` is part of the
// runtime, so it works on whichever host loads it: Electron 42 bundles Node 24.17 and has it. It
// also reduces the number of native dependencies a future standalone node download would need.
//
// On-disk files are untouched: this is the same SQLite, so an existing data root just opens.
//
// `@types/better-sqlite3` stays a devDependency after the runtime package is gone. Drizzle's driver
// declarations import from it, and so does the one cast at each call site. Types compile; they do
// not need a compiler.

// The two mismatches that would silently change behaviour, both pinned here rather than discovered
// later in a route:
//
//   Foreign keys. `node:sqlite` enforces them by default; better-sqlite3 does not. Core's schema
//   declares none, but a plugin's might, and having enforcement appear underneath one would be a
//   behaviour change nobody asked for. This matches the old default explicitly.
//
//   Row prototypes. `node:sqlite` hands back null-prototype objects. Almost everything works on
//   those, right up to the first `row.hasOwnProperty(...)`. Rows are rebuilt as ordinary objects
//   below, which costs one shallow copy on a path Drizzle rarely takes (typed selects go through
//   array mode, where there is nothing to rebuild).
const OPEN_OPTIONS = { enableForeignKeyConstraints: false } as const

const plainRow = (row: unknown): unknown =>
  row && typeof row === 'object' && !Array.isArray(row) ? { ...row } : row

export type SqliteRunResult = { changes: number | bigint; lastInsertRowid: number | bigint }

export type SqliteStatement = {
  run(...params: unknown[]): SqliteRunResult
  all(...params: unknown[]): unknown[]
  get(...params: unknown[]): unknown
  // better-sqlite3's toggle: switches this statement to array rows and returns itself. Drizzle
  // relies on both halves: it calls `stmt.raw().all(...)` and expects the same statement back.
  raw(toggle?: boolean): SqliteStatement
}

// The transaction handle better-sqlite3 returns: callable, and carrying the three locking behaviours
// as properties. Drizzle reaches for `nativeTx[config.behavior ?? 'deferred']`, so all three exist.
export type SqliteTransaction<A extends unknown[], R> = ((...args: A) => R) & {
  deferred(...args: A): R
  immediate(...args: A): R
  exclusive(...args: A): R
}

export type SqliteDatabase = {
  prepare(sql: string): SqliteStatement
  exec(sql: string): void
  pragma(statement: string): void
  transaction<A extends unknown[], R>(fn: (...args: A) => R): SqliteTransaction<A, R>
  backup(destination: string): Promise<void>
  close(): void
}

const wrapStatement = (stmt: StatementSync): SqliteStatement => {
  const wrapped: SqliteStatement = {
    run: (...params) => stmt.run(...(params as SQLInputValue[])) as SqliteRunResult,
    all: (...params) => stmt.all(...(params as SQLInputValue[])).map(plainRow),
    get: (...params) => plainRow(stmt.get(...(params as SQLInputValue[]))),
    raw(toggle = true) {
      stmt.setReturnArrays(toggle)
      return wrapped
    },
  }
  return wrapped
}

export function openSqlite(path: string, options: { readonly?: boolean } = {}): SqliteDatabase {
  const db = new DatabaseSync(path, { ...OPEN_OPTIONS, readOnly: options.readonly ?? false })

  // Depth-tracked so a nested transaction becomes a SAVEPOINT instead of a second BEGIN, which SQLite
  // rejects outright. better-sqlite3 did this for us, and `batch()` (main/bindings.ts) is a
  // transaction that a caller could plausibly reach from inside another one.
  let depth = 0
  const transaction = <A extends unknown[], R>(fn: (...args: A) => R): SqliteTransaction<A, R> => {
    const run = (begin: string) =>
      (...args: A): R => {
        const nested = depth > 0
        const name = `acorn_sp_${depth}`
        db.exec(nested ? `SAVEPOINT ${name}` : begin)
        depth += 1
        try {
          const result = fn(...args)
          db.exec(nested ? `RELEASE ${name}` : 'COMMIT')
          return result
        } catch (error) {
          // Unwind to exactly the point this call opened. Rolling the whole transaction back from a
          // nested failure would discard work the outer caller has not finished deciding about.
          db.exec(nested ? `ROLLBACK TO ${name}` : 'ROLLBACK')
          throw error
        } finally {
          depth -= 1
        }
      }
    return Object.assign(run('BEGIN'), {
      deferred: run('BEGIN'),
      immediate: run('BEGIN IMMEDIATE'),
      exclusive: run('BEGIN EXCLUSIVE'),
    })
  }

  return {
    prepare: (sql) => wrapStatement(db.prepare(sql)),
    exec: (sql) => db.exec(sql),
    // better-sqlite3 had a `.pragma()` helper; `node:sqlite` does not. Every caller here sets a value
    // and ignores the result, so this is the whole of it.
    pragma: (statement) => db.exec(`PRAGMA ${statement}`),
    transaction,
    // SQLite's online-backup API, which is a module-level function here rather than a method.
    backup: async (destination) => {
      await sqliteBackup(db, destination)
    },
    close: () => db.close(),
  }
}

// Drizzle over one of these handles.
//
// Assembled here rather than by calling `drizzle()` from `drizzle-orm/better-sqlite3`, because that
// module opens with a bare `import Client from 'better-sqlite3'`. That static import exists only
// for the convenience form `drizzle('/path/to.db')`, which nothing here uses; importing it would
// put the native package back on the runtime dependency list to satisfy a binding this file never
// touches, which is the entire thing it exists to remove.
//
// This is `construct()` from that module, minus that import. Every piece is a published export
// subpath, and the session is drizzle's own: the driver's client-object path, entered directly
// instead of through a front door that loads a compiler on the way past.
class NodeSqliteDatabase<TSchema extends Record<string, unknown>> extends BaseSQLiteDatabase<'sync', unknown, TSchema> {
  // Matched to what the better-sqlite3 driver declares, so drizzle's own `is()` checks see the class
  // they expect rather than a stranger.
  static override readonly [entityKind]: string = 'BetterSQLite3Database'
}

// Drizzle's own type, plus the handle under it. Declared as what it actually is here, rather than
// as better-sqlite3's class, so a caller reaching for `$client` gets the real API and not a
// fiction.
export type SqliteDrizzle<TSchema extends Record<string, unknown>> = BetterSQLite3Database<TSchema> & {
  $client: SqliteDatabase
}

export function drizzleOverSqlite<TSchema extends Record<string, unknown> = Record<string, never>>(
  client: SqliteDatabase,
  schema?: TSchema,
): SqliteDrizzle<TSchema> {
  const dialect = new SQLiteSyncDialect()
  const relational = schema
    ? (() => {
        const tables = extractTablesRelationalConfig(schema, createTableRelationsHelpers)
        return { fullSchema: schema, schema: tables.tables, tableNamesMap: tables.tableNamesMap }
      })()
    : undefined
  // `as never` twice: drizzle types the client as better-sqlite3's class and the relational config
  // with internal generics it does not export. The shapes are right; the names are what cannot be
  // spelled from out here.
  const session = new BetterSQLiteSession(client as never, dialect, relational as never, { logger: undefined })
  const db = new NodeSqliteDatabase('sync', dialect, session as never, relational as never) as unknown as SqliteDrizzle<TSchema>
  // Drizzle's driver exposes the underlying handle here, and code that reaches for it (the test that
  // checks journal mode, for one) expects to find it.
  db.$client = client
  return db
}
