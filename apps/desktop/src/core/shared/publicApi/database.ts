import { z } from 'zod'

// Database plugin public schemas (docs/public-api.md). The connection URL stays
// server-only; only the database name is ever returned. Every SQL query is write-scoped.

export const DbCellSchema = z.string().nullable()
export const DbPkSchema = z.record(z.string().min(1).max(128), DbCellSchema)

export const DbResultSetSchema = z.strictObject({
  columns: z.array(z.string()).max(1000),
  rows: z.array(z.array(DbCellSchema)).max(10_000),
  rowCount: z.number().int().nullable(),
  command: z.string(),
})

export const DbColumnSchema = z.strictObject({
  name: z.string(),
  dataType: z.string(),
  nullable: z.boolean(),
  isPk: z.boolean(),
})

export const DbConnectionSchema = z.strictObject({ database: z.string() })
export const DbTablesSchema = z.strictObject({ items: z.array(z.strictObject({ schema: z.string(), name: z.string() })) })
export const DbColumnsSchema = z.strictObject({ items: z.array(DbColumnSchema) })
export const DbRowsSchema = DbResultSetSchema.extend({ total: z.number().int().nullable(), nextCursor: z.string().nullable() })
export const DbQueryResultSchema = DbResultSetSchema.extend({ durationMs: z.number().int().nonnegative() })
export const DbWriteResultSchema = z.strictObject({ rowCount: z.number().int().nonnegative() })

export const DbQuerySchema = z.strictObject({ sql: z.string().trim().min(1).max(1_048_576) })
export const DbInsertSchema = z.strictObject({ values: z.record(z.string().min(1).max(128), DbCellSchema) })
export const DbUpdateSchema = z.strictObject({ column: z.string().min(1).max(128), value: DbCellSchema, pk: DbPkSchema })
export const DbDeleteSchema = z.strictObject({ pk: DbPkSchema })

export const DbRowsQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  cursor: z.string().max(64).optional(),
})

export const DbTableParams = z.strictObject({
  taskId: z.uuid(),
  schema: z.string().min(1).max(128),
  name: z.string().min(1).max(128),
})
