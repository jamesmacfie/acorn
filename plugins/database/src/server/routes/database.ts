import { randomUUID } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { GENERATE_MAX_PROMPT_CHARS } from '../../shared/database'
import type { DbCell, DbColumnsResult, DbConnectResult, DbGenerateResult, DbPk, DbQueryResult, DbRowsResult, DbSavedQuery, DbSchemaResult, DbTablesResult, DbWriteResult } from '../../shared/database'
import { bridgeSlot, viaBridge } from '@acorn/node-core/server/bridge.ts'
import type { CoreServices } from '@acorn/node-core/main/core/index.ts'
import type { PluginDatabase } from '@acorn/node-core/main/pluginStorage.ts'
import { ProviderOperationError } from '@acorn/node-core/server/integrations/types.ts'
import type { AppEnv } from '@acorn/node-core/server/middleware/auth.ts'
import { canUseProviderCredential, ownerId } from '@acorn/node-core/server/middleware/requireUser.ts'
import { respondError } from '@acorn/node-core/server/respond.ts'
import { dbSavedQueries } from '../../node/schema'
import { buildSystemPrompt, GENERATE_MAX_OUTPUT_TOKENS, stripSqlFences } from '../generateSql'

// Database pane (docs/pg.md): per-task Postgres browse + edit. Was the `db:*` IPC channels
//; now task-scoped HTTP behind the DatabaseBridge (main/database.ts). The
// connection URL is resolved server-side per connect and never persisted; identifiers in generated
// SQL are validated against the live schema; every value is parameterized. Needs a reachable pg —
// 503 when the bridge isn't wired (dev:node with no DB).
//
// A FACTORY over the plugin's own database, not a module-scope router reading getDb(c.env): saved
// queries live in <data-root>/plugins/database.sqlite now, and c.env deliberately does not carry
// per-plugin handles (docs/vNext/data.md § Plugin DBs). The handle arrives at plugin init, so no
// request can reach an unmigrated database.

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
  queryIds: z.array(z.string()).max(10).optional(), // saved queries to include as worked examples
})
const savedQueryBody = z.object({
  name: z.string().trim().min(1).max(80),
  notes: z.string().max(2000),
  sql: z.string().trim().min(1).max(20_000),
})

const id = (c: { req: { param(k: string): string } }) => c.req.param('id')

type SavedRow = typeof dbSavedQueries.$inferSelect
const rowToQuery = (r: SavedRow): DbSavedQuery => ({ id: r.id, name: r.name, notes: r.notes, sql: r.sql, updatedAt: r.updatedAt })

// The core services this router needs. `tasks` resolves the (repoOwner, repoName) a saved query is
// scoped to — it used to be a join against core's `tasks` in this file, and cannot be one across two
// SQLite files. `models` is provider access for AI generation: the plugin owns the prompt, core owns
// the credential.
type DatabaseRouteServices = Pick<CoreServices, 'tasks' | 'models'>

export const databaseRoutes = (db: PluginDatabase, core: DatabaseRouteServices) => {
  // Saved queries are repo-scoped but addressed through the task, like everything else in this pane —
  // the task is what the renderer has.
  const repoOf = (taskId: string) => core.tasks.load(taskId)

  const repoScope = (t: { repoOwner: string; repoName: string }) =>
    and(eq(dbSavedQueries.repoOwner, t.repoOwner), eq(dbSavedQueries.repoName, t.repoName))

  // The saved queries a generate call asked to include as examples, scoped to the task's repo so an id
  // from another repo can't be smuggled into the prompt.
  const loadExamples = async (taskId: string, ids: readonly string[]): Promise<DbSavedQuery[]> => {
    if (!ids.length) return []
    const t = await repoOf(taskId)
    if (!t) return []
    const rows = await db
      .select()
      .from(dbSavedQueries)
      .where(and(repoScope(t), inArray(dbSavedQueries.id, [...ids])))
      .orderBy(dbSavedQueries.name)
    return rows.map(rowToQuery)
  }

  return new Hono<AppEnv>()
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
    // --- saved queries (repo-scoped, this plugin's own table — no bridge) ---
    .get('/:id/database/queries', async (c) => {
      const t = await repoOf(id(c))
      if (!t) return respondError(c, 404, 'not_found')
      const rows = await db.select().from(dbSavedQueries).where(repoScope(t)).orderBy(dbSavedQueries.name)
      return c.json(rows.map(rowToQuery))
    })
    // Save = upsert on (repo, name): re-saving under an existing name overwrites it, which is also how
    // a query is edited or renamed. ponytail: no PATCH route, add one if renaming without retyping matters.
    .post('/:id/database/queries', async (c) => {
      const p = savedQueryBody.safeParse(await c.req.json().catch(() => null))
      if (!p.success) return respondError(c, 400, 'bad_request')
      // The taskId is a plain ID into core's tables, so core validates it — this was a join in this
      // file, and cannot be one across two SQLite files.
      const t = await repoOf(id(c))
      if (!t) return respondError(c, 404, 'not_found')
      const now = Date.now()
      const row: SavedRow = {
        id: randomUUID(),
        repoOwner: t.repoOwner,
        repoName: t.repoName,
        name: p.data.name.trim(),
        notes: p.data.notes.trim() || null,
        sql: p.data.sql.trim(),
        createdAt: now,
        updatedAt: now,
      }
      const [saved] = await db
        .insert(dbSavedQueries)
        .values(row)
        .onConflictDoUpdate({
          target: [dbSavedQueries.repoOwner, dbSavedQueries.repoName, dbSavedQueries.name],
          set: { notes: row.notes, sql: row.sql, updatedAt: now },
        })
        .returning()
      return c.json(rowToQuery(saved))
    })
    .delete('/:id/database/queries/:queryId', async (c) => {
      const t = await repoOf(id(c))
      if (!t) return respondError(c, 404, 'not_found')
      await db.delete(dbSavedQueries).where(and(eq(dbSavedQueries.id, c.req.param('queryId')), repoScope(t)))
      return c.json({ ok: true })
    })
    // Generate a PostgreSQL query from a natural-language description via a connected model provider
    // (docs/pg.md). The plugin owns the route + prompt; the core runtime owns provider access. The
    // prompt carries the schema, the repo's schema notes, and any saved queries picked as examples.
    .post('/:id/database/generate', async (c) => {
      const p = generateBody.safeParse(await c.req.json().catch(() => null))
      if (!p.success) return respondError(c, 400, 'bad_request')
      const bridge = databaseBridgeSlot.get()
      if (!bridge) return respondError(c, 503, 'bridge-unavailable')
      // AI SQL generation spends the owner's OpenAI/Anthropic key, billed to the owner. A task-scoped
      // agent credential must not reach it (server/middleware/requireUser.ts § canUseProviderCredential).
      if (!canUseProviderCredential(c)) return respondError(c, 403, 'interactive_user_required')
      const schemaRes = await bridge.schema(id(c))
      if ('error' in schemaRes) return respondError(c, 422, 'db_schema_unavailable', [schemaRes.error])
      // Unknown/foreign ids just don't resolve — a stale pick shouldn't fail the whole generate.
      const examples = await loadExamples(id(c), p.data.queryIds ?? [])
      try {
        const result = await core.models.generateText({
          userId: ownerId(c),
          connectionId: p.data.connectionId,
          input: {
            system: buildSystemPrompt(schemaRes.schema, { ...(schemaRes.notes ? { notes: schemaRes.notes } : {}), examples }),
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
}
