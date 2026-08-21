// Routes for the Database pane, mounted at /v2/p/database by this plugin's init (node/index.ts):
// per-task Postgres browse and edit, the project's saved queries, the task's scratch document, and
// table/column completions.
//
// database ships loaded, so these routes run on the one tier a loaded plugin gets (docs/plugins.md §
// Loaded plugins): the host gets `router.fetch` (createDatabaseFetch at the bottom), and identity rides
// in through `c.env` rather than `ownerId(c)`/`c.get('principal')`, which a loaded bundle's Hono stack
// never sets.
//
// The route capability this file used to declare (`routeCapability<DatabaseBridge>`, resolved through
// `viaBridge`) is gone: it existed to cross the old main/renderer process boundary, and the pane has
// been loopback HTTP for a while. The bridge is now a plain closure argument, which also makes a fake
// injectable without a global registry.
//
// SQL-injection posture is main/database.ts's: docs/data-layer.md § Database plugin: the Postgres pane.
import { randomUUID } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'
import { Hono, type Context } from 'hono'
import { z } from 'zod'
import {
  type AppEnv,
  type CoreServices,
  type PluginDatabase,
  type PluginFetchHandler,
  portableCarrier,
  ProviderOperationError,
  respondError,
} from '@acorn/plugin-api/node'
import { MAX_COMPLETION_ITEMS } from '@acorn/protocol/documentSurface.ts'
import type { PluginCompletionResponse, PluginDocumentBody } from '@acorn/protocol/documentSurface.ts'
import { GENERATE_MAX_PROMPT_CHARS } from '../../shared/database'
import type { DbGenerateResult, DbSavedQuery } from '../../shared/database'
import { dbSavedQueries, dbScratch } from '../../node/schema'
import type { DatabaseBridge } from '../../main/database'
import { buildSystemPrompt, GENERATE_MAX_OUTPUT_TOKENS, stripSqlFences } from '../generateSql'
import { completeSql } from '../completions'
import { MAX_CONTEXT_QUERIES, savedQueryOption, savedQuerySnapshot } from '../agentContext'

// The carrier is the host's (@acorn/plugin-api/node); a request arriving without the context is a
// wiring bug, and saying so beats answering it from host handles this bundle should no longer touch.
const { requestContext, portableFetch } = portableCarrier('database')

const owner = (c: Context<AppEnv>): string => requestContext(c).userId

// AI generation spends the owner's provider key, billed to the owner, so a task-scoped agent credential
// must not reach it. The host's `canUseProviderCredential` reads `c.get('principal')`, which a loaded
// bundle does not have, so this is the same rule read off the request context instead.
const isInteractiveOwner = (c: Context<AppEnv>): boolean => {
  const { principal } = requestContext(c)
  return principal.kind === 'device' || principal.scope === 'service'
}

// Everything that reaches SQL is validated (the privileged-boundary contract). DbCell is string | null
// on the wire.
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
// The document surface's write body. The host defines this shape, and the cap matches the one it
// enforces on the way in and the bridge enforces on the way back.
const scratchBody = z.object({ text: z.string().max(2 * 1024 * 1024) })
const completionsBody = z.object({
  text: z.string().max(2 * 1024 * 1024),
  position: z.object({ line: z.number().int().min(1), column: z.number().int().min(1) }),
})
const contextCaptureBody = z.object({ taskId: z.string().min(1), optionIds: z.array(z.string()).optional() })

const id = (c: { req: { param(k: string): string } }) => c.req.param('taskId')

type SavedRow = typeof dbSavedQueries.$inferSelect
const rowToQuery = (r: SavedRow): DbSavedQuery => ({ id: r.id, name: r.name, notes: r.notes, sql: r.sql, updatedAt: r.updatedAt })

export type DatabaseRouteServices = Pick<CoreServices, 'tasks' | 'models' | 'projects'>

export const databaseRoutes = (db: PluginDatabase, core: DatabaseRouteServices, bridge: DatabaseBridge) => {
  // Saved queries are project-scoped but addressed through the task, like everything else in this
  // pane. The frame holds the task and core resolves its project without a cross-file join.
  const taskOf = (taskId: string) => core.tasks.load(taskId)
  const projectOf = async (t: { projectId: string }) => core.projects.byId(t.projectId)
  const projectScope = (projectId: string) => eq(dbSavedQueries.projectId, projectId)

  const savedFor = async (taskId: string, limit?: number): Promise<DbSavedQuery[] | null> => {
    const t = await taskOf(taskId)
    if (!t) return null
    const project = t.projectId ? await projectOf(t) : null
    if (!project) return []
    const rows = await db.select().from(dbSavedQueries).where(projectScope(project.id)).orderBy(dbSavedQueries.name)
    return (limit ? rows.slice(0, limit) : rows).map(rowToQuery)
  }

  // The saved queries a generate call asked to include as examples, scoped to the task's project so an
  // id from another project cannot be smuggled into the prompt.
  const loadExamples = async (taskId: string, ids: readonly string[]): Promise<DbSavedQuery[]> => {
    if (!ids.length) return []
    const t = await taskOf(taskId)
    const project = t?.projectId ? await projectOf(t) : null
    if (!project) return []
    const rows = await db
      .select()
      .from(dbSavedQueries)
      .where(and(projectScope(project.id), inArray(dbSavedQueries.id, [...ids])))
      .orderBy(dbSavedQueries.name)
    return rows.map(rowToQuery)
  }

  return new Hono<AppEnv>()
    .post('/tasks/:taskId/connect', async (c) => c.json(await bridge.connect(id(c))))
    .post('/tasks/:taskId/disconnect', async (c) => c.json(await bridge.disconnect(id(c))))
    .get('/tasks/:taskId/tables', async (c) => c.json(await bridge.tables(id(c))))
    .get('/tasks/:taskId/columns', async (c) => {
      const schema = c.req.query('schema')
      const name = c.req.query('name')
      if (!schema || !name) return respondError(c, 400, 'bad_request')
      return c.json(await bridge.columns(id(c), schema, name))
    })
    .get('/tasks/:taskId/rows', async (c) => {
      const schema = c.req.query('schema')
      const name = c.req.query('name')
      if (!schema || !name) return respondError(c, 400, 'bad_request')
      const offsetRaw = c.req.query('offset')
      const offset = offsetRaw ? Number(offsetRaw) : undefined
      return c.json(await bridge.rows(id(c), schema, name, offset))
    })
    .post('/tasks/:taskId/query', async (c) => {
      const p = queryBody.safeParse(await c.req.json().catch(() => null))
      if (!p.success) return respondError(c, 400, 'bad_request')
      return c.json(await bridge.query(id(c), p.data.sql))
    })
    .post('/tasks/:taskId/update', async (c) => {
      const p = updateBody.safeParse(await c.req.json().catch(() => null))
      if (!p.success) return respondError(c, 400, 'bad_request')
      return c.json(await bridge.update(id(c), p.data.schema, p.data.name, p.data.column, p.data.value, p.data.pk))
    })
    .post('/tasks/:taskId/insert', async (c) => {
      const p = insertBody.safeParse(await c.req.json().catch(() => null))
      if (!p.success) return respondError(c, 400, 'bad_request')
      return c.json(await bridge.insert(id(c), p.data.schema, p.data.name, p.data.values))
    })
    .post('/tasks/:taskId/delete', async (c) => {
      const p = deleteBody.safeParse(await c.req.json().catch(() => null))
      if (!p.success) return respondError(c, 400, 'bad_request')
      return c.json(await bridge.remove(id(c), p.data.schema, p.data.name, p.data.pk))
    })

    // The document surface: docs/third-party/monaco.md. This plugin owns a column of text; the host
    // owns the editor, its theme, workers, autosave, and the flush before unmount.
    //
    // It persists, unlike the compiled pane's unbacked Monaco, because a scratch buffer is task-scoped:
    // what you meant to keep has a Save button (node/schema.ts § dbScratch).
    .get('/tasks/:taskId/scratch', async (c) => {
      const taskId = id(c)
      if (!await taskOf(taskId)) return respondError(c, 404, 'not_found')
      const [row] = await db.select().from(dbScratch).where(eq(dbScratch.taskId, taskId)).limit(1)
      return c.json({ text: row?.sql ?? '' } satisfies PluginDocumentBody)
    })
    .put('/tasks/:taskId/scratch', async (c) => {
      const p = scratchBody.safeParse(await c.req.json().catch(() => null))
      if (!p.success) return respondError(c, 400, 'bad_request')
      const taskId = id(c)
      // The taskId is a plain ID into core's tables, so core validates it. Checked on the write as well
      // as the read: an autosave for an archived task should not quietly create a row nothing will
      // ever read again.
      if (!await taskOf(taskId)) return respondError(c, 404, 'not_found')
      const now = Date.now()
      await db
        .insert(dbScratch)
        .values({ taskId, sql: p.data.text, updatedAt: now })
        .onConflictDoUpdate({ target: dbScratch.taskId, set: { sql: p.data.text, updatedAt: now } })
      return c.json({ ok: true })
    })

    // Table/column completions, the first LSP-shaped capability. The host POSTs a position and maps
    // what comes back onto its editor; every judgement about SQL is in ../completions.ts, on this side.
    .post('/tasks/:taskId/completions', async (c) => {
      const p = completionsBody.safeParse(await c.req.json().catch(() => null))
      if (!p.success) return respondError(c, 400, 'bad_request')
      const catalog = await bridge.catalog(id(c))
      // Not connected is not an error here. A reader typing in the editor before the pane has reached
      // the database wants an empty popup, not a red line.
      if ('error' in catalog) return c.json({ items: [] } satisfies PluginCompletionResponse)
      const items = completeSql(p.data.text, p.data.position, catalog.tables)
      return c.json({ items: items.slice(0, MAX_COMPLETION_ITEMS) } satisfies PluginCompletionResponse)
    })

    // --- saved queries (project-scoped, this plugin's own table, no database connection needed) ---
    .get('/tasks/:taskId/queries', async (c) => {
      const saved = await savedFor(id(c))
      if (!saved) return respondError(c, 404, 'not_found')
      return c.json(saved)
    })
    .post('/tasks/:taskId/queries', async (c) => {
      const p = savedQueryBody.safeParse(await c.req.json().catch(() => null))
      if (!p.success) return respondError(c, 400, 'bad_request')
      const t = await taskOf(id(c))
      if (!t) return respondError(c, 404, 'not_found')
      const project = t.projectId ? await projectOf(t) : null
      if (!project) return respondError(c, 400, 'project_not_found')
      const now = Date.now()
      const row: typeof dbSavedQueries.$inferInsert = {
        id: randomUUID(),
        projectId: project.id,
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
          target: [dbSavedQueries.projectId, dbSavedQueries.name],
          set: { notes: row.notes, sql: row.sql, updatedAt: now },
        })
        .returning()
      return c.json(rowToQuery(saved))
    })
    .delete('/tasks/:taskId/queries/:queryId', async (c) => {
      const t = await taskOf(id(c))
      if (!t) return respondError(c, 404, 'not_found')
      const project = t.projectId ? await projectOf(t) : null
      if (!project) return c.json({ ok: true })
      await db.delete(dbSavedQueries).where(and(eq(dbSavedQueries.id, c.req.param('queryId')), projectScope(project.id)))
      return c.json({ ok: true })
    })

    // Which model connections this owner could generate with. The frame cannot ask core directly:
    // `/v2/core/integrations` has no bridge scope, and minting one would hand every installed plugin the
    // whole connection roster to serve one dropdown. This answers ids and labels; the key stays on the
    // node and is resolved inside `models.generateText`.
    .get('/tasks/:taskId/model-connections', async (c) => {
      if (!isInteractiveOwner(c)) return respondError(c, 403, 'interactive_user_required')
      const connections = await core.models.available(owner(c))
      return c.json({ connections })
    })

    // Generate a PostgreSQL query from a natural-language description through a connected model
    // provider. The plugin owns the route and the prompt; core owns provider access. The prompt carries
    // the schema, the repo's schema notes, and any saved queries picked as examples.
    .post('/tasks/:taskId/generate', async (c) => {
      const p = generateBody.safeParse(await c.req.json().catch(() => null))
      if (!p.success) return respondError(c, 400, 'bad_request')
      if (!isInteractiveOwner(c)) return respondError(c, 403, 'interactive_user_required')
      const schemaRes = await bridge.schema(id(c))
      if ('error' in schemaRes) return respondError(c, 422, 'db_schema_unavailable', [schemaRes.error])
      // Unknown/foreign ids just do not resolve; a stale pick should not fail the whole generate.
      const examples = await loadExamples(id(c), p.data.queryIds ?? [])
      try {
        const result = await core.models.generateText({
          userId: owner(c),
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

    // --- the agent composer's "Saved database queries" entry (../agentContext.ts) ---
    .get('/context-options', async (c) => {
      const taskId = c.req.query('taskId')
      if (!taskId) return respondError(c, 404, 'not_found')
      const saved = await savedFor(taskId, MAX_CONTEXT_QUERIES)
      if (!saved) return respondError(c, 404, 'not_found')
      return c.json(saved.map(savedQueryOption))
    })
    .post('/context-capture', async (c) => {
      const p = contextCaptureBody.safeParse(await c.req.json().catch(() => null))
      if (!p.success) return respondError(c, 400, 'bad_request', p.error.issues.map((i) => i.message))
      const saved = await savedFor(p.data.taskId, MAX_CONTEXT_QUERIES)
      if (!saved) return respondError(c, 404, 'not_found')
      const chosen = p.data.optionIds ? saved.filter((query) => p.data.optionIds?.includes(query.id)) : saved
      return c.json(chosen.map(savedQuerySnapshot))
    })
}

/** The portable carrier. A Hono instance cannot cross a process boundary and a (Request) → Response
 * function can, so this is what `ctx.routes.fetch` is handed. */
export const createDatabaseFetch = (db: PluginDatabase, core: DatabaseRouteServices, bridge: DatabaseBridge): PluginFetchHandler =>
  portableFetch(databaseRoutes(db, core, bridge))
