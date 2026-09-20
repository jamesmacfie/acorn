// This plugin's two workflow step kinds and the capability behind them
// (docs/database.md § Workflow steps).
//
// They live here for the reason the http step gives: the connection resolution, the pool, the schema
// introspection and the SQL prompt are all in this package. What a workflow adds is a cap and a
// refusal — 200 rows, 256 KB, reads only — and both steps go through one path so neither can forget.
import { eq } from 'drizzle-orm'
import type { CoreServices, PluginDatabase } from '@acorn/plugin-api/node'
import type { StepField, StepHandlerContext, StepHandlerOutcome, StepKindContribution, StepValidator } from '@acorn/plugin-workflows/contract/extensions.ts'
import { dbSavedQueries } from '../node/schema'
import { MAX_QUERY_ROWS, readOnlyRefusal, type DatabaseQuery, type DatabaseQueryResult } from '../contract/query'
import type { DatabaseBridge } from './database'
import { buildSystemPrompt, GENERATE_MAX_OUTPUT_TOKENS, stripSqlFences } from './generateSql'

/** A step's output is interpolated into the next step's prompt, so a result too big to read is a
 *  failure rather than something to quietly cut. */
export const MAX_QUERY_BYTES = 256 * 1024

/** The bridge's own words for "this task has no pool yet". */
const NOT_CONNECTED = 'Not connected.'

type QueryConfig = { savedQueryId?: unknown; sql?: unknown; maxRows?: unknown }
type GenerateConfig = { prompt?: unknown; connectionId?: unknown; maxRows?: unknown }

type DatabaseStepServices = {
  db: PluginDatabase
  core: Pick<CoreServices, 'tasks' | 'projects' | 'models' | 'identity'>
  bridge: DatabaseBridge
  query: DatabaseQuery
}

const MAX_ROWS_FIELD: StepField = { id: 'maxRows', label: 'Row cap', type: 'number', min: 1, max: MAX_QUERY_ROWS, hint: `Defaults to ${MAX_QUERY_ROWS}, which is also the ceiling.` }

const QUERY_FIELDS: StepField[] = [
  { id: 'savedQueryId', label: 'Saved query', type: 'select', optionsRoute: '/v2/p/database/projects/{projectId}/saved-queries', hint: 'One of a saved query and inline SQL, not both.' },
  { id: 'sql', label: 'SQL', type: 'textarea', templates: true, placeholder: 'select count(*) from orders where created_at > now() - interval \'7 days\'' },
  MAX_ROWS_FIELD,
]

const GENERATE_FIELDS: StepField[] = [
  { id: 'prompt', label: 'Ask for', type: 'prompt', required: true, placeholder: 'the ten most recent orders with the customer’s email' },
  // The id and the label disagree on purpose. The label is what a backend is now called; the id stays
  // `connectionId` because every `database:generate` step already saved holds its pick under that key,
  // and a definition whose field id moved would validate as "names no backend" the next time it ran.
  // The value it holds is a bare connection uuid, which still resolves — a prefix-less backend id is a
  // connection (@acorn/protocol/modelProviders.ts § parseBackendId).
  { id: 'connectionId', label: 'Generate with', type: 'select', required: true, optionsRoute: '/v2/p/database/tasks/{taskId}/model-connections' },
  MAX_ROWS_FIELD,
]

const validateQuery: StepValidator = (step, { label }) => {
  const config = (step.with ?? {}) as QueryConfig
  const saved = typeof config.savedQueryId === 'string' && config.savedQueryId.trim()
  const sql = typeof config.sql === 'string' && config.sql.trim()
  if (saved && sql) return [`${label} sets both a saved query and inline SQL; keep one`]
  if (!saved && !sql) return [`${label} needs either a saved query or inline SQL`]
  return []
}

const validateGenerate: StepValidator = (step, { label }) => {
  const config = (step.with ?? {}) as GenerateConfig
  const errors: string[] = []
  if (typeof config.prompt !== 'string' || !config.prompt.trim()) errors.push(`${label} has nothing to ask for`)
  if (typeof config.connectionId !== 'string' || !config.connectionId.trim()) errors.push(`${label} names no backend to generate with`)
  return errors
}

const rowCap = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(1, Math.min(Math.floor(value), MAX_QUERY_ROWS)) : MAX_QUERY_ROWS

/**
 * The `database.query` capability: the bridge's own query with the cap and the read-only refusal
 * applied. Connects first when the task has no pool yet, because a workflow step has no pane to have
 * pressed Connect in.
 */
export function databaseQuery(bridge: DatabaseBridge): DatabaseQuery {
  return {
    query: async (taskId, sql, options) => {
      const refusal = readOnlyRefusal(sql)
      if (refusal) throw new Error(`This query is refused: ${refusal}.`)
      let result = await bridge.query(taskId, sql, { readOnly: true })
      // A step has no pane to have pressed Connect in, so the first "not connected" opens the pool and
      // tries once more. Any other error is the query's own and is handed straight back.
      if ('error' in result && result.error === NOT_CONNECTED) {
        const connected = await bridge.connect(taskId)
        if (!connected.ok) throw new Error(connected.error)
        result = await bridge.query(taskId, sql, { readOnly: true })
      }
      if ('error' in result) throw new Error(result.error)
      const max = rowCap(options?.maxRows)
      return {
        columns: result.columns,
        rows: result.rows.slice(0, max),
        rowCount: result.rowCount ?? result.rows.length,
        truncated: result.rows.length > max,
      } satisfies DatabaseQueryResult
    },
  }
}

/** The result as a step's output, or a failure when it is too big to put in a prompt. */
function asOutcome(result: DatabaseQueryResult, extra: Record<string, unknown> = {}): { ok: true; structured: Record<string, unknown> } | { ok: false; error: string } {
  const structured = { ...extra, columns: result.columns, rows: result.rows, rowCount: result.rowCount, truncated: result.truncated }
  const bytes = Buffer.byteLength(JSON.stringify(structured), 'utf8')
  if (bytes > MAX_QUERY_BYTES) {
    return { ok: false, error: `The result is ${Math.round(bytes / 1024)} KB, over the ${MAX_QUERY_BYTES / 1024} KB a step may hand on. Ask for fewer columns or a lower row cap.` }
  }
  return { ok: true, structured }
}

/** `database:query`: a saved query or inline SQL, run against the task's database. */
export function queryStep(services: DatabaseStepServices): StepKindContribution {
  return {
    describe: {
      label: 'Run a query',
      description: 'Run a saved query or inline SQL against the task’s database and hand the rows on.',
      icon: 'database',
      fields: QUERY_FIELDS,
      output: { description: 'The columns, the rows, how many there were, and whether the cap cut them.' },
    },
    validate: validateQuery,
    handler: async (ctx) => {
      const config = (ctx.def.with ?? {}) as QueryConfig
      let sql = typeof config.sql === 'string' ? config.sql : ''
      if (typeof config.savedQueryId === 'string' && config.savedQueryId) {
        const saved = await loadSavedQuery(services, ctx.run.taskId, config.savedQueryId)
        if (!saved) return { status: 'failed', error: `This project has no saved query '${config.savedQueryId}'.` }
        sql = saved
      }
      return runAndReport(services, ctx, sql, { sql })
    },
  }
}

/** `database:generate`: describe the query in words, let a model write the SQL, then run it. */
export function generateStep(services: DatabaseStepServices): StepKindContribution {
  return {
    describe: {
      label: 'Generate and run a query',
      description: 'Describe the query in words, let a connected model write the SQL, then run it.',
      icon: 'sparkles',
      fields: GENERATE_FIELDS,
      output: { description: 'The SQL the model wrote, and the rows it returned.' },
    },
    validate: validateGenerate,
    handler: async (ctx) => {
      const config = (ctx.def.with ?? {}) as GenerateConfig
      const userId = services.core.identity.active()
      if (!userId) return { status: 'failed', error: 'This node has no bound owner, so it cannot generate SQL.' }
      const schema = await services.bridge.schema(ctx.run.taskId)
      if ('error' in schema) return { status: 'failed', error: `The database schema could not be read: ${schema.error}` }
      ctx.emit({ at: Date.now(), event: { type: 'progress', text: 'Writing the SQL' } })
      let sql: string
      try {
        const generated = await services.core.models.generateText({
          userId,
          backendId: String(config.connectionId),
          input: {
            system: buildSystemPrompt(schema.schema, { ...(schema.notes ? { notes: schema.notes } : {}), examples: [] }),
            prompt: String(config.prompt),
            maxOutputTokens: GENERATE_MAX_OUTPUT_TOKENS,
          },
        })
        sql = stripSqlFences(generated.text)
      } catch (error) {
        return { status: 'failed', error: `The model could not write the SQL: ${error instanceof Error ? error.message : 'the provider refused'}` }
      }
      // A generated write is a failure that carries the SQL, because the interesting question is what
      // the model thought it was asked for.
      const refusal = readOnlyRefusal(sql)
      if (refusal) return { status: 'failed', error: `The generated SQL is refused: ${refusal}.\n\n${sql}`, structured: { sql } }
      return runAndReport(services, ctx, sql, { sql })
    },
  }
}

async function loadSavedQuery(services: DatabaseStepServices, taskId: string, savedQueryId: string): Promise<string | null> {
  const task = await services.core.tasks.load(taskId)
  const project = task?.projectId ? await services.core.projects.byId(task.projectId) : null
  if (!project) return null
  const [row] = await services.db.select().from(dbSavedQueries).where(eq(dbSavedQueries.id, savedQueryId)).limit(1)
  // Scoped to the task's own project, so an id from another repository cannot be run here.
  return row && row.projectId === project.id ? row.sql : null
}

async function runAndReport(
  services: DatabaseStepServices,
  ctx: StepHandlerContext,
  sql: string,
  extra: Record<string, unknown>,
): Promise<StepHandlerOutcome> {
  const config = (ctx.def.with ?? {}) as QueryConfig
  if (!sql.trim()) return { status: 'failed', error: 'This step has no SQL to run.' }
  let result: DatabaseQueryResult
  try {
    result = await services.query.query(ctx.run.taskId, sql, { maxRows: rowCap(config.maxRows) })
  } catch (error) {
    return { status: 'failed', error: error instanceof Error ? error.message : 'The query failed.', structured: extra }
  }
  ctx.emit({ at: Date.now(), event: { type: 'rows', count: result.rows.length } })
  const outcome = asOutcome(result, extra)
  if (!outcome.ok) return { status: 'failed', error: outcome.error, structured: extra }
  return { status: 'done', structured: outcome.structured, handoff: JSON.stringify(outcome.structured, null, 2) }
}
