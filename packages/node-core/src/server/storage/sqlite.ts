import { backup as sqliteBackup, DatabaseSync } from 'node:sqlite'
import type { StatementSync, SQLInputValue } from 'node:sqlite'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { BetterSQLiteSession } from 'drizzle-orm/better-sqlite3/session'
import { entityKind } from 'drizzle-orm/entity'
import { createTableRelationsHelpers, extractTablesRelationalConfig } from 'drizzle-orm/relations'
import { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core/db'
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core/dialect'
import { PERF, recordDuration } from '../perf'

// SQLite through the runtime's own `node:sqlite`, shaped like the slice of better-sqlite3 that
// Drizzle's driver and this package call.
//
// Drizzle publishes no `node:sqlite` driver, but its better-sqlite3 driver needs a small surface:
// `prepare`, `transaction`, and `run`, `all`, `get`, and `raw` on a statement. Each has a
// `node:sqlite` equivalent, so meeting that shape here costs less than moving to the async proxy
// driver.
//
// better-sqlite3 is a native module compiled for one ABI at a time. `node:sqlite` ships with the
// runtime, so it works on whichever host loads it, and it drops one native dependency from a
// standalone node download. The on-disk format is the same SQLite, so an existing data root opens.
//
// `@types/better-sqlite3` stays a devDependency. Drizzle's driver declarations import from it, and
// so does the one cast at each call site.

// The two mismatches that would change behaviour without saying so, pinned here rather than found
// later in a route:
//
//   Foreign keys. `node:sqlite` enforces them by default and better-sqlite3 does not. Core's schema
//   declares none, but a plugin's might, and enforcement appearing underneath one is a behaviour
//   change nobody asked for.
//
//   Row prototypes. `node:sqlite` hands back null-prototype objects, which work right up to the
//   first `row.hasOwnProperty(...)`. Rows are rebuilt as ordinary objects below, one shallow copy on
//   a path Drizzle rarely takes, since typed selects go through array mode.
const OPEN_OPTIONS = { enableForeignKeyConstraints: false } as const

const plainRow = (row: unknown): unknown =>
  row && typeof row === 'object' && !Array.isArray(row) ? { ...row } : row

export type SqliteRunResult = { changes: number | bigint; lastInsertRowid: number | bigint }

export type SqliteStatement = {
  run(...params: unknown[]): SqliteRunResult
  all(...params: unknown[]): unknown[]
  get(...params: unknown[]): unknown
  // better-sqlite3's toggle. It switches this statement to array rows and returns itself, and
  // Drizzle needs both halves: it calls `stmt.raw().all(...)` and expects the same statement back.
  raw(toggle?: boolean): SqliteStatement
}

// The transaction handle better-sqlite3 returns: callable, and carrying the three locking behaviours
// as properties. Drizzle reads `nativeTx[config.behavior ?? 'deferred']`, so all three exist.
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

// Every statement, timed by its first two words, behind `ACORN_PERF=1`. This loop is synchronous and
// shared with terminal emulation and git spawns, and the performance programme refused to split it into
// threads without numbers (docs/performance.md § Splitting the node), so this is where
// the numbers come from.
//
// The whole statement text is not the key: bound parameters are out of it already, but a hundred
// distinct `SELECT`s would be a hundred histograms nobody reads. The verb and the word after it is a
// coarse grouping and a deliberate one — it answers "is this node's time going into reads, writes or
// transactions", which is the question worth asking before anyone tunes a statement. Finding the
// statement itself is what the request duration and a debugger are for.
const sqlSeam = (sql: string): string => `sqlite ${sql.trim().split(/\s+/, 2).join(' ').toLowerCase()}`

const timeStatement = (stmt: SqliteStatement, sql: string): SqliteStatement => {
  const seam = sqlSeam(sql)
  const time = <T>(run: () => T): T => {
    const started = process.hrtime.bigint()
    try {
      return run()
    } finally {
      recordDuration(seam, Number(process.hrtime.bigint() - started) / 1e6)
    }
  }
  const timedStatement: SqliteStatement = {
    run: (...params) => time(() => stmt.run(...params)),
    all: (...params) => time(() => stmt.all(...params)),
    get: (...params) => time(() => stmt.get(...params)),
    // Drizzle calls `stmt.raw().all(...)` and expects the same statement back, so this has to return
    // the timed one rather than the handle underneath it.
    raw(toggle = true) {
      stmt.raw(toggle)
      return timedStatement
    },
  }
  return timedStatement
}

export function openSqlite(path: string, options: { readonly?: boolean } = {}): SqliteDatabase {
  const db = new DatabaseSync(path, { ...OPEN_OPTIONS, readOnly: options.readonly ?? false })

  // Depth-tracked, so a nested transaction becomes a SAVEPOINT instead of a second BEGIN, which
  // SQLite rejects. better-sqlite3 did this for us, and `batch()` in server/bindings.ts is a
  // transaction a caller can reach from inside another one.
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
          // Unwind to the point this call opened. Rolling the whole transaction back from a nested
          // failure discards work the outer caller has not finished deciding about.
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
    // `prepare` is where the timing wrapper goes on, not `openSqlite`, so a node with the switch off
    // hands out exactly the statement it always did.
    prepare: (sql) => (PERF ? timeStatement(wrapStatement(db.prepare(sql)), sql) : wrapStatement(db.prepare(sql))),
    exec: (sql) => db.exec(sql),
    // better-sqlite3 had a `.pragma()` helper and `node:sqlite` does not. Every caller sets a value
    // and ignores the result, so this covers it.
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
// Never call `drizzle()` from `drizzle-orm/better-sqlite3`. That module opens with a bare
// `import Client from 'better-sqlite3'`, which puts the native package back on the runtime
// dependency list to satisfy the convenience form `drizzle('/path/to.db')` that nothing here uses.
//
// This is `construct()` from that module without the import. Every piece is a published export
// subpath and the session is drizzle's own, so this is the driver's client-object path entered
// directly.
class NodeSqliteDatabase<TSchema extends Record<string, unknown>> extends BaseSQLiteDatabase<'sync', unknown, TSchema> {
  // Matched to what the better-sqlite3 driver declares, so drizzle's `is()` checks see the class they
  // expect.
  static override readonly [entityKind]: string = 'BetterSQLite3Database'
}

// Drizzle's own type, plus the handle under it. Declared as what it is rather than as
// better-sqlite3's class, so a caller reaching for `$client` gets the real API.
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
  // `as never` twice. Drizzle types the client as better-sqlite3's class and the relational config
  // with internal generics it does not export. The shapes are right, the names cannot be spelled
  // from out here.
  const session = new BetterSQLiteSession(client as never, dialect, relational as never, { logger: undefined })
  const db = new NodeSqliteDatabase('sync', dialect, session as never, relational as never) as unknown as SqliteDrizzle<TSchema>
  // Drizzle's driver exposes the underlying handle here, and code that reaches for it, such as the
  // test that checks journal mode, expects to find it.
  db.$client = client
  return db
}
