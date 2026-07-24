import { Hono } from 'hono'
import { z } from 'zod'
import type { DbCell, DbColumnsResult, DbConnectResult, DbGenerateResult, DbPk, DbQueryResult, DbRowsResult, DbSchemaResult, DbTablesResult, DbWriteResult } from '../../shared/database'
import { bridgeSlot, viaBridge } from '../../../../core/server/bridge'
import { getDb } from '../../../../core/server/db'
import { ProviderOperationError } from '../../../../core/server/integrations/types'
import type { AppEnv } from '../../../../core/server/middleware/auth'
import { getUser } from '../../../../core/server/middleware/requireUser'
import { generateTextForConnection } from '../../../../core/server/modelProviders/runtime'
import { respondError } from '../../../../core/server/respond'
import { buildSystemPrompt, GENERATE_MAX_OUTPUT_TOKENS, GENERATE_MAX_PROMPT_CHARS, stripSqlFences } from '../generateSql'

// Database pane (docs/pg.md): per-task Postgres browse + edit. Was the `db:*` IPC channels
//; now task-scoped HTTP behind the DatabaseBridge (main/database.ts). The
// connection URL is resolved server-side per connect and never persisted; identifiers in generated
// SQL are validated against the live schema; every value is parameterized. Needs a reachable pg —
// 503 when the bridge isn't wired (dev:node with no DB).

export type DatabaseBridge = {
  connect(taskId: string): Promise<DbConnectResult>
  disconnect(taskId: string): Promise<{ ok: true }>
  tables(taskId: string): Promise<DbTablesResult>
  columns(taskId: string, schema: string, name: string): Promise<DbColumnsResult>
  rows(taskId: string, schema: string, name: string, offset?: number): Promise<DbRowsResult>
  query(taskId: string, sql: string): Promise<DbQueryResult>
  update(taskId: string, schema: string, name: string, column: string, value: DbCell, pk: DbPk): Promise<DbWriteResult>
  insert(taskId: string, schema: string, name: string, values: Record<string, DbCell>): Promise<DbWriteResult>
  remove(taskId: string, schema: string, name: string, pk: DbPk): Promise<DbWriteResult>
  schema(taskId: string): Promise<DbSchemaResult>
}

export const databaseBridgeSlot = bridgeSlot<DatabaseBridge>()
export const setDatabaseBridge = databaseBridgeSlot.set

// Everything that reaches SQL is validated (the privileged-boundary contract). DbCell is string | null on the wire.
const cell = z.union([z.string(), z.null()])
const queryBody = z.object({ sql: z.string().min(1) })
const updateBody = z.object({ schema: z.string(), name: z.string(), column: z.string(), value: cell, pk: z.record(z.string(), cell) })
const insertBody = z.object({ schema: z.string(), name: z.string(), values: z.record(z.string(), cell) })
const deleteBody = z.object({ schema: z.string(), name: z.string(), pk: z.record(z.string(), cell) })
const generateBody = z.object({
  connectionId: z.string().min(1),
  modelId: z.string().min(1).optional(),
  prompt: z.string().min(1).max(GENERATE_MAX_PROMPT_CHARS),
})

const id = (c: { req: { param(k: string): string } }) => c.req.param('id')

export const database = new Hono<AppEnv>()
  .post('/:id/database/connect', (c) => viaBridge(c, databaseBridgeSlot, (b) => b.connect(id(c))))
  .post('/:id/database/disconnect', (c) => viaBridge(c, databaseBridgeSlot, (b) => b.disconnect(id(c))))
  .get('/:id/database/tables', (c) => viaBridge(c, databaseBridgeSlot, (b) => b.tables(id(c))))
  .get('/:id/database/columns', (c) => {
    const schema = c.req.query('schema')
    const name = c.req.query('name')
    if (!schema || !name) return respondError(c, 400, 'bad_request')
    return viaBridge(c, databaseBridgeSlot, (b) => b.columns(id(c), schema, name))
  })
  .get('/:id/database/rows', (c) => {
    const schema = c.req.query('schema')
    const name = c.req.query('name')
    if (!schema || !name) return respondError(c, 400, 'bad_request')
    const offsetRaw = c.req.query('offset')
    const offset = offsetRaw ? Number(offsetRaw) : undefined
    return viaBridge(c, databaseBridgeSlot, (b) => b.rows(id(c), schema, name, offset))
  })
  .post('/:id/database/query', async (c) => {
    const p = queryBody.safeParse(await c.req.json().catch(() => null))
    if (!p.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, databaseBridgeSlot, (b) => b.query(id(c), p.data.sql))
  })
  .post('/:id/database/update', async (c) => {
    const p = updateBody.safeParse(await c.req.json().catch(() => null))
    if (!p.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, databaseBridgeSlot, (b) => b.update(id(c), p.data.schema, p.data.name, p.data.column, p.data.value, p.data.pk))
  })
  .post('/:id/database/insert', async (c) => {
    const p = insertBody.safeParse(await c.req.json().catch(() => null))
    if (!p.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, databaseBridgeSlot, (b) => b.insert(id(c), p.data.schema, p.data.name, p.data.values))
  })
  .post('/:id/database/delete', async (c) => {
    const p = deleteBody.safeParse(await c.req.json().catch(() => null))
    if (!p.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, databaseBridgeSlot, (b) => b.remove(id(c), p.data.schema, p.data.name, p.data.pk))
  })
  // Generate a PostgreSQL query from a natural-language description via a connected model provider
  // (docs/pg.md). The plugin owns the route + prompt; the core runtime owns provider access.
  .post('/:id/database/generate', async (c) => {
    const p = generateBody.safeParse(await c.req.json().catch(() => null))
    if (!p.success) return respondError(c, 400, 'bad_request')
    const bridge = databaseBridgeSlot.get()
    if (!bridge) return respondError(c, 503, 'bridge-unavailable')
    const schemaRes = await bridge.schema(id(c))
    if ('error' in schemaRes) return respondError(c, 422, 'db_schema_unavailable', [schemaRes.error])
    try {
      const result = await generateTextForConnection({
        db: getDb(c.env),
        userId: getUser(c).login,
        encryptionKey: c.env.SESSION_ENC_KEY,
        connectionId: p.data.connectionId,
        input: {
          system: buildSystemPrompt(schemaRes.schema),
          prompt: p.data.prompt,
          ...(p.data.modelId ? { modelId: p.data.modelId } : {}),
          maxOutputTokens: GENERATE_MAX_OUTPUT_TOKENS,
        },
      })
      return c.json({ sql: stripSqlFences(result.text), providerId: result.providerId, modelId: result.modelId } satisfies DbGenerateResult)
    } catch (error) {
      if (error instanceof ProviderOperationError) return respondError(c, error.status, error.code)
      return respondError(c, 502, 'provider_unavailable')
    }
  })
