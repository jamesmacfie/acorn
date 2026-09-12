// The isolated worker's SQLite adapter. It mirrors server/storage/sqlite.ts without importing the
// host telemetry graph: the worker must be bootable from a small, explicitly granted runtime root.
import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { BetterSQLiteSession } from 'drizzle-orm/better-sqlite3/session'
import { entityKind } from 'drizzle-orm/entity'
import { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core/db'
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core/dialect'
import { assertPluginMigrationHistory } from './migrations.ts'

type Statement = {
  run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint }
  all(...params: unknown[]): unknown[]
  get(...params: unknown[]): unknown
  raw(toggle?: boolean): Statement
}

type Client = {
  prepare(sql: string): Statement
  exec(sql: string): void
  pragma(statement: string): void
  transaction<A extends unknown[], R>(fn: (...args: A) => R): ((...args: A) => R) & {
    deferred(...args: A): R
    immediate(...args: A): R
    exclusive(...args: A): R
  }
  close(): void
}

const plainRow = (row: unknown): unknown =>
  row && typeof row === 'object' && !Array.isArray(row) ? { ...row } : row

const wrapStatement = (statement: StatementSync): Statement => {
  const wrapped: Statement = {
    run: (...params) => statement.run(...params as SQLInputValue[]) as { changes: number | bigint; lastInsertRowid: number | bigint },
    all: (...params) => statement.all(...params as SQLInputValue[]).map(plainRow),
    get: (...params) => plainRow(statement.get(...params as SQLInputValue[])),
    raw(toggle = true) {
      statement.setReturnArrays(toggle)
      return wrapped
    },
  }
  return wrapped
}

const openClient = (path: string): Client => {
  const sqlite = new DatabaseSync(path, { enableForeignKeyConstraints: false })
  let depth = 0
  const transaction = <A extends unknown[], R>(fn: (...args: A) => R) => {
    const run = (begin: string) => (...args: A): R => {
      const nested = depth > 0
      const name = `acorn_sp_${depth}`
      sqlite.exec(nested ? `SAVEPOINT ${name}` : begin)
      depth += 1
      try {
        const result = fn(...args)
        sqlite.exec(nested ? `RELEASE ${name}` : 'COMMIT')
        return result
      } catch (error) {
        sqlite.exec(nested ? `ROLLBACK TO ${name}` : 'ROLLBACK')
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
    prepare: (sql) => wrapStatement(sqlite.prepare(sql)),
    exec: (sql) => sqlite.exec(sql),
    pragma: (statement) => sqlite.exec(`PRAGMA ${statement}`),
    transaction,
    close: () => sqlite.close(),
  }
}

class WorkerDatabase extends BaseSQLiteDatabase<'sync', unknown, Record<string, never>> {
  static override readonly [entityKind] = 'BetterSQLite3Database'
}

export type WorkerPluginDatabase = WorkerDatabase & {
  $client: Client
  batch: <T extends readonly unknown[]>(statements: T) => Promise<unknown[]>
  close(): void
}

export function openWorkerPluginDb(path: string, plugin: string, migrationsFolder: string): WorkerPluginDatabase {
  const client = openClient(path)
  try {
    client.pragma('journal_mode = WAL')
    client.pragma('busy_timeout = 5000')
    const dialect = new SQLiteSyncDialect()
    const session = new BetterSQLiteSession(client as never, dialect, undefined, { logger: undefined })
    const db = new WorkerDatabase('sync', dialect, session as never, undefined) as WorkerPluginDatabase
    db.$client = client
    assertPluginMigrationHistory(plugin, migrationsFolder, client as never)
    migrate(db as never, { migrationsFolder })
    db.batch = (async (statements: ReadonlyArray<{ run(): unknown }>) =>
      db.transaction(() => statements.map((statement) => statement.run()))) as WorkerPluginDatabase['batch']
    db.close = () => client.close()
    return db
  } catch (error) {
    // Construction has no owner yet. Do not leave a rejected history or failed migration holding a
    // WAL handle that neither the plugin lifecycle nor the host can reach to close.
    try {
      client.close()
    } catch {
      // Preserve the validation/migration error; it is the actionable failure.
    }
    throw error
  }
}
