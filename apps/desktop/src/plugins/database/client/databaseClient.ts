// Per-task Postgres browse/edit (docs/pg.md). Was the `window.acorn.database` preload bridge; now
// loopback HTTP routes. The connection URL is resolved server-side and never persisted.
// The accessor shape is unchanged so DatabasePane keeps its call sites; it just never returns null.
import { databaseActionRoute, databaseColumnsRoute, databaseRowsRoute, databaseTablesRoute } from '../../../core/shared/api'
import { readJson, writeJson } from '../../../core/client/apiClient'
import type { DbCell, DbColumnsResult, DbConnectResult, DbGenerateResult, DbPk, DbQueryResult, DbRowsResult, DbTablesResult, DbWriteResult } from '../shared/database'

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
  generate(taskId: string, body: { connectionId: string; modelId?: string; prompt: string }): Promise<DbGenerateResult>
}

const post = <T>(url: string, body?: unknown) =>
  writeJson<T>(url, { method: 'POST', headers: body === undefined ? undefined : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })

const api: DatabaseApi = {
  connect: (taskId) => post<DbConnectResult>(databaseActionRoute(taskId, 'connect')),
  disconnect: (taskId) => post<{ ok: true }>(databaseActionRoute(taskId, 'disconnect')),
  tables: (taskId) => readJson<DbTablesResult>(databaseTablesRoute(taskId)),
  columns: (taskId, schema, name) => readJson<DbColumnsResult>(databaseColumnsRoute(taskId, schema, name)),
  rows: (taskId, schema, name, offset) => readJson<DbRowsResult>(databaseRowsRoute(taskId, schema, name, offset)),
  query: (taskId, sql) => post<DbQueryResult>(databaseActionRoute(taskId, 'query'), { sql }),
  update: (taskId, schema, name, column, value, pk) => post<DbWriteResult>(databaseActionRoute(taskId, 'update'), { schema, name, column, value, pk }),
  insert: (taskId, schema, name, values) => post<DbWriteResult>(databaseActionRoute(taskId, 'insert'), { schema, name, values }),
  remove: (taskId, schema, name, pk) => post<DbWriteResult>(databaseActionRoute(taskId, 'delete'), { schema, name, pk }),
  generate: (taskId, body) => post<DbGenerateResult>(databaseActionRoute(taskId, 'generate'), body),
}

export const databaseApi = (): DatabaseApi => api
