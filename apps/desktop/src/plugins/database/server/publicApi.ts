import { z } from 'zod'
import { PublicApiError, type ErrorCode } from '../../../core/shared/publicApi/errors'
import { IdSchema } from '../../../core/shared/publicApi/primitives'
import {
  DbColumnsSchema,
  DbConnectionSchema,
  DbDeleteSchema,
  DbInsertSchema,
  DbQueryResultSchema,
  DbQuerySchema,
  DbRowsQuerySchema,
  DbRowsSchema,
  DbTableParams,
  DbTablesSchema,
  DbUpdateSchema,
  DbWriteResultSchema,
} from '../../../core/shared/publicApi/database'
import { NO_CONTENT, defineEndpoint, type PluginApiContribution } from '../../../core/server/publicApi/defineEndpoint'
import type { DatabaseBridge } from './routes/database'

// Database plugin public API (docs/public-api.md). Base /plugins/database/tasks/:taskId.
// The bridge returns {error}/{ok:false} unions; here they become non-2xx domain errors. The
// connection URL never leaves the server — only the database name is returned.

const PLUGIN = 'database'
const TaskParams = z.strictObject({ taskId: IdSchema })

// Any bridge result carrying an `error` becomes a typed PublicApiError; the success branch is
// returned narrowed.
function unwrap<T extends object>(result: T, code: ErrorCode = 'provider_validation_failed'): Exclude<T, { error: string }> {
  if ('error' in result && typeof (result as { error?: unknown }).error === 'string') {
    throw new PublicApiError(code, (result as { error: string }).error)
  }
  return result as Exclude<T, { error: string }>
}

export function buildDatabasePublicApi(database: DatabaseBridge): PluginApiContribution {
  return {
    pluginId: PLUGIN,
    endpoints: [
      defineEndpoint({
        operationId: 'database.connection.open',
        pluginId: PLUGIN,
        method: 'POST',
        path: '/tasks/:taskId/connection',
        scope: 'write',
        risk: 'execute',
        summary: 'Open the task database connection',
        params: TaskParams,
        body: z.undefined(),
        response: DbConnectionSchema,
        handler: async (_ctx, { params }) => {
          const res = await database.connect(params.taskId)
          if (!res.ok) throw new PublicApiError('provider_unavailable', res.error)
          return { database: res.database }
        },
      }),
      defineEndpoint({
        operationId: 'database.connection.close',
        pluginId: PLUGIN,
        method: 'DELETE',
        path: '/tasks/:taskId/connection',
        scope: 'write',
        risk: 'execute',
        summary: 'Close the task database connection',
        params: TaskParams,
        response: z.undefined(),
        status: 204,
        handler: async (_ctx, { params }) => {
          await database.disconnect(params.taskId)
          return NO_CONTENT
        },
      }),
      defineEndpoint({
        operationId: 'database.tables.list',
        pluginId: PLUGIN,
        method: 'GET',
        path: '/tasks/:taskId/tables',
        scope: 'read',
        risk: 'read',
        summary: 'List tables',
        params: TaskParams,
        response: DbTablesSchema,
        handler: async (_ctx, { params }) => {
          const res = unwrap(await database.tables(params.taskId))
          return { items: res.tables }
        },
      }),
      defineEndpoint({
        operationId: 'database.columns.list',
        pluginId: PLUGIN,
        method: 'GET',
        path: '/tasks/:taskId/tables/:schema/:name/columns',
        scope: 'read',
        risk: 'read',
        summary: 'List table columns',
        params: DbTableParams,
        response: DbColumnsSchema,
        handler: async (_ctx, { params }) => {
          const res = unwrap(await database.columns(params.taskId, params.schema, params.name))
          return { items: res.columns }
        },
      }),
      defineEndpoint({
        operationId: 'database.rows.list',
        pluginId: PLUGIN,
        method: 'GET',
        path: '/tasks/:taskId/tables/:schema/:name/rows',
        scope: 'read',
        risk: 'read',
        summary: 'Read a page of rows',
        params: DbTableParams,
        query: DbRowsQuerySchema,
        response: DbRowsSchema,
        handler: async (_ctx, { params, query }) => {
          const offset = query.cursor ? Number(query.cursor) || 0 : 0
          const res = unwrap(await database.rows(params.taskId, params.schema, params.name, offset))
          const next = res.total !== null && offset + res.rows.length < res.total ? String(offset + res.rows.length) : null
          return { columns: res.columns, rows: res.rows, rowCount: res.rowCount, command: res.command, total: res.total, nextCursor: next }
        },
      }),
      defineEndpoint({
        operationId: 'database.query',
        pluginId: PLUGIN,
        method: 'POST',
        path: '/tasks/:taskId/query',
        scope: 'write', // write even for SELECT — read-only SQL detection is not a security boundary
        risk: 'execute',
        summary: 'Run a SQL query',
        params: TaskParams,
        body: DbQuerySchema,
        response: DbQueryResultSchema,
        handler: async (_ctx, { params, body }) => {
          const res = unwrap(await database.query(params.taskId, body.sql))
          return { columns: res.columns, rows: res.rows, rowCount: res.rowCount, command: res.command, durationMs: Math.round(res.ms) }
        },
      }),
      defineEndpoint({
        operationId: 'database.rows.insert',
        pluginId: PLUGIN,
        method: 'POST',
        path: '/tasks/:taskId/tables/:schema/:name/rows',
        scope: 'write',
        risk: 'execute',
        summary: 'Insert a row',
        params: DbTableParams,
        body: DbInsertSchema,
        response: DbWriteResultSchema,
        handler: async (_ctx, { params, body }) => {
          const res = await database.insert(params.taskId, params.schema, params.name, body.values)
          if (!res.ok) throw new PublicApiError('provider_validation_failed', res.error)
          return { rowCount: res.rowCount }
        },
      }),
      defineEndpoint({
        operationId: 'database.rows.update',
        pluginId: PLUGIN,
        method: 'PATCH',
        path: '/tasks/:taskId/tables/:schema/:name/rows',
        scope: 'write',
        risk: 'execute',
        summary: 'Update a cell by primary key',
        params: DbTableParams,
        body: DbUpdateSchema,
        response: DbWriteResultSchema,
        handler: async (_ctx, { params, body }) => {
          const res = await database.update(params.taskId, params.schema, params.name, body.column, body.value, body.pk)
          if (!res.ok) throw new PublicApiError('provider_validation_failed', res.error)
          return { rowCount: res.rowCount }
        },
      }),
      defineEndpoint({
        operationId: 'database.rows.delete',
        pluginId: PLUGIN,
        method: 'POST',
        path: '/tasks/:taskId/tables/:schema/:name/rows/delete',
        scope: 'write',
        risk: 'execute',
        summary: 'Delete a row by primary key',
        params: DbTableParams,
        body: DbDeleteSchema,
        response: DbWriteResultSchema,
        handler: async (_ctx, { params, body }) => {
          const res = await database.remove(params.taskId, params.schema, params.name, body.pk)
          if (!res.ok) throw new PublicApiError('provider_validation_failed', res.error)
          return { rowCount: res.rowCount }
        },
      }),
    ],
  }
}
