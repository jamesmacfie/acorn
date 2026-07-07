// Typed accessor for the preload's `window.acorn.database` bridge — a per-task Postgres connection
// (docs/pg.md), resolved on demand from the worktree and never persisted. Mirrors editorClient.ts.
import type {
  DbCell,
  DbColumnsResult,
  DbConnectResult,
  DbPk,
  DbQueryResult,
  DbRowsResult,
  DbTablesResult,
  DbWriteResult,
} from '../../../shared/database'

export type DatabaseApi = {
  connect(taskId: string): Promise<DbConnectResult>
  disconnect(taskId: string): Promise<{ ok: true }>
  tables(taskId: string): Promise<DbTablesResult>
  columns(taskId: string, schema: string, name: string): Promise<DbColumnsResult>
  rows(taskId: string, schema: string, name: string, offset?: number): Promise<DbRowsResult>
  query(taskId: string, sql: string): Promise<DbQueryResult>
  update(taskId: string, schema: string, name: string, column: string, value: DbCell, pk: DbPk): Promise<DbWriteResult>
  insert(taskId: string, schema: string, name: string, values: Record<string, DbCell>): Promise<DbWriteResult>
  remove(taskId: string, schema: string, name: string, pk: DbPk): Promise<DbWriteResult>
}

export const databaseApi = (): DatabaseApi | null => window.acorn?.database ?? null
