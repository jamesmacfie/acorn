// Database-pane adapter over the host-owned data capability. This loaded plugin never imports a
// driver, opens a socket, resolves DATABASE_URL or sees a credential.
import { pluginChannel } from '@acorn/protocol/plugin/state.ts'
import type { CoreServices, DataColumn, DataTable } from '@acorn/plugin-api/node'
import { qid } from './formatSchema'
import type {
  DbCatalogResult,
  DbCatalogTable,
  DbCell,
  DbColumn,
  DbConnectResult,
  DbColumnsResult,
  DbPk,
  DbQueryResult,
  DbRowsResult,
  DbSchemaResult,
  DbTablesResult,
  DbWriteResult,
} from '../shared/database'

export type DatabaseBridge = {
  connect(taskId: string): Promise<DbConnectResult>
  disconnect(taskId: string): Promise<{ ok: true }>
  tables(taskId: string): Promise<DbTablesResult>
  columns(taskId: string, schema: string, name: string): Promise<DbColumnsResult>
  rows(taskId: string, schema: string, name: string, offset?: number): Promise<DbRowsResult>
  query(taskId: string, sql: string, options?: { readOnly?: boolean }): Promise<DbQueryResult>
  update(taskId: string, schema: string, name: string, column: string, value: DbCell, pk: DbPk): Promise<DbWriteResult>
  insert(taskId: string, schema: string, name: string, values: Record<string, DbCell>): Promise<DbWriteResult>
  remove(taskId: string, schema: string, name: string, pk: DbPk): Promise<DbWriteResult>
  schema(taskId: string): Promise<DbSchemaResult>
  catalog(taskId: string): Promise<DbCatalogResult>
  dispose(): Promise<void>
}

export type DatabaseCoreServices = Pick<CoreServices, 'data'>

const ROW_CAP = 500
const errText = (error: unknown): string => error instanceof Error ? error.message : String(error)

const findTable = (tables: readonly DataTable[], schema: string, name: string): DataTable => {
  const table = tables.find((candidate) => candidate.schema === schema && candidate.name === name)
  if (!table) throw new Error(`Unknown table ${schema}.${name}`)
  return table
}

const assertColumns = (table: DataTable, columns: readonly string[]): Map<string, DataColumn> => {
  const byName = new Map(table.columns.map((column) => [column.name, column]))
  for (const column of columns) {
    if (!byName.has(column)) throw new Error(`Unknown column ${column} on ${table.schema}.${table.name}`)
  }
  return byName
}

const catalogTable = (table: DataTable): DbCatalogTable => ({
  schema: table.schema,
  name: table.name,
  columns: table.columns.map(({ name, dataType }) => ({ name, dataType })),
})

/** Keep pane-specific SQL construction here; core owns execution and permission enforcement. */
export function databaseBridge(
  core: DatabaseCoreServices,
  emit?: (frame: { channel: string } & Record<string, unknown>) => void,
): DatabaseBridge {
  // The pane still has an explicit Connect state. The core service can connect on demand for headless
  // consumers, so this adapter records which tasks this pane instance has deliberately opened.
  const connected = new Set<string>()

  const requireConnection = (taskId: string): boolean => connected.has(taskId)
  const liveCatalog = (taskId: string) => core.data.catalog(taskId)

  return {
    connect: async (taskId) => {
      try {
        const result = await core.data.connect(taskId)
        connected.add(taskId)
        return { ok: true, database: result.database }
      } catch (error) {
        return { ok: false, error: errText(error) }
      }
    },

    tables: async (taskId) => {
      if (!requireConnection(taskId)) return { error: 'Not connected.' }
      try {
        return { tables: (await liveCatalog(taskId)).map(({ schema, name }) => ({ schema, name })) }
      } catch (error) {
        return { error: errText(error) }
      }
    },

    columns: async (taskId, schema, name) => {
      if (!requireConnection(taskId)) return { error: 'Not connected.' }
      try {
        return { columns: findTable(await liveCatalog(taskId), schema, name).columns as DbColumn[] }
      } catch (error) {
        return { error: errText(error) }
      }
    },

    rows: async (taskId, schema, name, offset) => {
      if (!requireConnection(taskId)) return { error: 'Not connected.' }
      try {
        const table = findTable(await liveCatalog(taskId), schema, name)
        const primaryKeys = table.columns.filter((column) => column.isPk).map((column) => column.name)
        const relation = `${qid(table.schema)}.${qid(table.name)}`
        const order = primaryKeys.length ? ` ORDER BY ${primaryKeys.map(qid).join(', ')}` : ''
        const resolvedOffset = Number.isFinite(offset) && offset! > 0 ? Math.floor(offset!) : 0
        const [rows, count] = await Promise.all([
          core.data.query(taskId, `SELECT * FROM ${relation}${order} LIMIT $1 OFFSET $2`, {
            maxRows: ROW_CAP,
            parameters: [String(ROW_CAP), String(resolvedOffset)],
          }),
          core.data.query(taskId, `SELECT count(*) AS n FROM ${relation}`, { maxRows: 1 }),
        ])
        return {
          columns: rows.columns,
          rows: rows.rows,
          rowCount: rows.rowCount,
          command: rows.command,
          total: Number(count.rows[0]?.[0] ?? 0),
        }
      } catch (error) {
        return { error: errText(error) }
      }
    },

    query: async (taskId, sql, options) => {
      if (!requireConnection(taskId)) return { error: 'Not connected.' }
      try {
        const result = await core.data.query(taskId, sql, {
          maxRows: ROW_CAP,
          // The interactive SQL pane is intentionally writable. Headless consumers such as workflow
          // steps opt into core's read-only transaction through this private adapter option.
          readOnly: options?.readOnly ?? false,
        })
        if (!new Set(['SELECT', 'INSERT', 'UPDATE', 'DELETE']).has(result.command.toUpperCase())) {
          emit?.({ channel: pluginChannel('database', 'schema-changed'), taskId })
        }
        return {
          columns: result.columns,
          rows: result.rows,
          rowCount: result.rowCount,
          command: result.command,
          ms: result.ms,
        }
      } catch (error) {
        return { error: errText(error) }
      }
    },

    update: async (taskId, schema, name, column, value, pk) => {
      if (!requireConnection(taskId)) return { ok: false, error: 'Not connected.' }
      try {
        const table = findTable(await liveCatalog(taskId), schema, name)
        const primaryKeys = Object.keys(pk)
        if (!primaryKeys.length) return { ok: false, error: 'This table has no primary key — editing is disabled.' }
        assertColumns(table, [column, ...primaryKeys])
        const where = primaryKeys.map((key, index) => `${qid(key)} = $${index + 2}`).join(' AND ')
        const result = await core.data.query(
          taskId,
          `UPDATE ${qid(table.schema)}.${qid(table.name)} SET ${qid(column)} = $1 WHERE ${where}`,
          { readOnly: false, maxRows: 1, parameters: [value, ...primaryKeys.map((key) => pk[key])] },
        )
        return { ok: true, rowCount: result.rowCount ?? 0 }
      } catch (error) {
        return { ok: false, error: errText(error) }
      }
    },

    insert: async (taskId, schema, name, values) => {
      if (!requireConnection(taskId)) return { ok: false, error: 'Not connected.' }
      try {
        const table = findTable(await liveCatalog(taskId), schema, name)
        const columns = Object.keys(values)
        if (!columns.length) return { ok: false, error: 'No values to insert.' }
        assertColumns(table, columns)
        const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ')
        const result = await core.data.query(
          taskId,
          `INSERT INTO ${qid(table.schema)}.${qid(table.name)} (${columns.map(qid).join(', ')}) VALUES (${placeholders})`,
          { readOnly: false, maxRows: 1, parameters: columns.map((column) => values[column]) },
        )
        return { ok: true, rowCount: result.rowCount ?? 0 }
      } catch (error) {
        return { ok: false, error: errText(error) }
      }
    },

    remove: async (taskId, schema, name, pk) => {
      if (!requireConnection(taskId)) return { ok: false, error: 'Not connected.' }
      try {
        const table = findTable(await liveCatalog(taskId), schema, name)
        const primaryKeys = Object.keys(pk)
        if (!primaryKeys.length) return { ok: false, error: 'This table has no primary key — delete is disabled.' }
        assertColumns(table, primaryKeys)
        const where = primaryKeys.map((key, index) => `${qid(key)} = $${index + 1}`).join(' AND ')
        const result = await core.data.query(
          taskId,
          `DELETE FROM ${qid(table.schema)}.${qid(table.name)} WHERE ${where}`,
          { readOnly: false, maxRows: 1, parameters: primaryKeys.map((key) => pk[key]) },
        )
        return { ok: true, rowCount: result.rowCount ?? 0 }
      } catch (error) {
        return { ok: false, error: errText(error) }
      }
    },

    schema: async (taskId) => {
      try {
        const result = await core.data.schema(taskId)
        // Auto schema introspection may have opened the host pool for a headless workflow. Track the
        // task even for configured text so a later query and plugin disposal use one lifecycle.
        connected.add(taskId)
        return {
          schema: result.text,
          source: result.source,
          ...(result.notes ? { notes: result.notes } : {}),
        }
      } catch (error) {
        return { error: errText(error) }
      }
    },

    catalog: async (taskId): Promise<DbCatalogResult> => {
      if (!requireConnection(taskId)) return { error: 'Not connected.' }
      try {
        return { tables: (await liveCatalog(taskId)).map(catalogTable) }
      } catch (error) {
        return { error: errText(error) }
      }
    },

    disconnect: async (taskId) => {
      connected.delete(taskId)
      await core.data.disconnect(taskId)
      return { ok: true }
    },

    dispose: async () => {
      await Promise.all([...connected].map((taskId) => core.data.disconnect(taskId)))
      connected.clear()
    },
  }
}
