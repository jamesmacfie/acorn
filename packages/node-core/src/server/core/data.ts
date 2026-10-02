import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { QueryResult, QueryResultRow } from 'pg'
import { loadRepoConfig } from '../runConfig'
import type { ProjectService } from './projectRefs'
import type { ProcResult, ProcSpec } from './proc'
import type { TaskService } from './tasks'
import { taskDataPools } from './dataPools'
import { dataCatalog, invalidateDataCatalog } from './dataCatalog'

export type DataCell = string | null
export type DataColumn = { name: string; dataType: string; nullable: boolean; isPk: boolean }
export type DataTable = { schema: string; name: string; columns: DataColumn[] }
export type DataSchemaSource = 'auto' | 'script' | 'file'

export type DataQueryOptions = {
  maxRows?: number
  /** Reads are the default. A permission-scoped service refuses `false` without `data:write`. */
  readOnly?: boolean
  timeoutMs?: number
  parameters?: DataCell[]
}

export type DataQueryResult = {
  columns: string[]
  rows: DataCell[][]
  rowCount: number | null
  command: string
  truncated: boolean
  ms: number
}

export type DataSchemaResult = {
  tables: DataTable[]
  text: string
  source: DataSchemaSource
  notes?: string
}

export type DataSourceService = {
  /** Whether the task has a database source at all (see hasTaskDataSource). Connects to nothing. */
  configured(taskId: string): Promise<boolean>
  connect(taskId: string): Promise<{ database: string }>
  disconnect(taskId: string): Promise<void>
  query(taskId: string, sql: string, options?: DataQueryOptions): Promise<DataQueryResult>
  catalog(taskId: string): Promise<DataTable[]>
  schema(taskId: string): Promise<DataSchemaResult>
}

export const DATA_MAX_QUERY_ROWS = 500
export const DATA_DEFAULT_TIMEOUT_MS = 15_000
export const DATA_MAX_TIMEOUT_MS = 60_000

const SCHEMA_CHAR_CAP = 80_000
type DataCore = {
  tasks: TaskService
  projects: ProjectService
  fs: { resolveInRoot(root: string, relPath: string): string | null }
  proc: { runProcessOrThrow(spec: ProcSpec): Promise<ProcResult> }
}

const cell = (value: unknown): DataCell => {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

const capSchema = (text: string): string =>
  text.length <= SCHEMA_CHAR_CAP ? text : `${text.slice(0, SCHEMA_CHAR_CAP)}\n-- (schema truncated)`

const qid = (id: string): string => `"${id.replace(/"/g, '""')}"`

const formatSchema = (tables: readonly DataTable[]): string =>
  tables
    .map((table) => {
      const columns = table.columns
        .map((column) => `  ${qid(column.name)} ${column.dataType}${column.nullable ? '' : ' NOT NULL'}${column.isPk ? ', -- PK' : ','}`)
        .join('\n')
      return `CREATE TABLE ${qid(table.schema)}.${qid(table.name)} (\n${columns}\n);`
    })
    .join('\n\n')

const boundedRows = (value: number | undefined): number => {
  if (value === undefined || !Number.isFinite(value)) return DATA_MAX_QUERY_ROWS
  return Math.max(1, Math.min(Math.floor(value), DATA_MAX_QUERY_ROWS))
}

const boundedTimeout = (value: number | undefined): number => {
  if (value === undefined || !Number.isFinite(value)) return DATA_DEFAULT_TIMEOUT_MS
  return Math.max(1, Math.min(Math.floor(value), DATA_MAX_TIMEOUT_MS))
}

const READ_ONLY_LEAD = new Set(['select', 'with', 'show', 'explain', 'table', 'values'])
const WRITES = /\b(insert|update|delete|merge|create|drop|alter|truncate|grant|revoke|copy|call|refresh|vacuum|lock|set)\b/i

/** A useful early refusal; the read-only transaction below is the enforcement boundary. */
export function dataReadOnlyRefusal(sql: string): string | null {
  const statements = sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean)
  if (!statements.length) return 'there is nothing to run'
  for (const statement of statements) {
    const lead = statement.split(/\s+/)[0]?.toLowerCase() ?? ''
    if (!READ_ONLY_LEAD.has(lead)) return `'${lead.slice(0, 20)}' writes, and this query only reads`
    if (lead === 'with' && WRITES.test(statement)) return 'this WITH statement writes, and this query only reads'
  }
  return null
}

async function readEnvUrl(envPath: string): Promise<string | null> {
  try {
    const text = await readFile(envPath, 'utf8')
    for (const raw of text.split('\n')) {
      const match = raw.match(/^\s*(?:export\s+)?DATABASE_URL\s*=\s*(.+)\s*$/)
      if (!match) continue
      let value = match[1].trim()
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      if (value) return value
    }
  } catch {
    // A missing or unreadable worktree .env is simply not a configured source.
  }
  return null
}

// Where a task's database URL could come from, read without running anything. `null` for no task.
async function taskDataSources(core: DataCore, taskId: string) {
  const task = await core.tasks.load(taskId)
  if (!task) return null
  const root = await core.tasks.root(taskId)
  const project = task.projectId ? await core.projects.byId(task.projectId) : null
  const config = task.projectId ? await core.projects.config(task.projectId) : null
  const repo = loadRepoConfig(root ?? project?.path ?? null, homedir(), { dbUrlScript: config?.config.dbUrlScript })
  return { root, repo, script: repo.dbUrlScript?.trim() }
}

/**
 * Does this task have any database source: a connection script, a worktree `.env` DATABASE_URL, or
 * the node's own? It runs no script, so it cannot say whether the database is up, only whether there
 * is one to try.
 */
export async function hasTaskDataSource(core: DataCore, taskId: string): Promise<boolean> {
  const sources = await taskDataSources(core, taskId)
  if (!sources) return false
  const { root, script } = sources
  if (script && root) return true
  if (root && await readEnvUrl(join(root, '.env'))) return true
  return !!process.env.DATABASE_URL?.trim()
}

/** Resolve a task's transient database URL without storing or returning it to a plugin. */
export async function resolveTaskDataUrl(core: DataCore, taskId: string): Promise<string | null> {
  const sources = await taskDataSources(core, taskId)
  if (!sources) return null
  const { root, repo, script } = sources
  if (script && root) {
    // Keep this outside the catch: refusing untrusted executable repo configuration must not quietly
    // fall through to another credential source.
    if (repo.dbUrlFromRepo) await core.projects.assertConfigTrusted(taskId)
    try {
      const { stdout } = await core.proc.runProcessOrThrow({
        file: 'bash',
        args: ['-lc', script],
        cwd: root,
        timeoutMs: DATA_DEFAULT_TIMEOUT_MS,
        maxOutputBytes: 1 << 20,
      })
      const line = stdout
        .replace(/\x1b(?:\[[0-9;]*[A-Za-z]|\(B)/g, '')
        .split('\n')
        .map((candidate) => candidate.trim())
        .filter(Boolean)
        .pop()
      if (line) return line
    } catch {
      // A failing helper falls through to the worktree and node environment sources.
    }
  }
  if (root) {
    const fromEnv = await readEnvUrl(join(root, '.env'))
    if (fromEnv) return fromEnv
  }
  return process.env.DATABASE_URL?.trim() || null
}

const resultSet = (result: QueryResult<QueryResultRow>, maxRows: number, ms: number): DataQueryResult => {
  const columns = result.fields?.map((field) => field.name) ?? []
  const driverRows = result.rows ?? []
  const rows = driverRows.slice(0, maxRows).map((row) =>
    columns.map((column) => cell((row as Record<string, unknown>)[column])),
  )
  return {
    columns,
    rows,
    rowCount: result.rowCount ?? null,
    command: result.command ?? '',
    truncated: driverRows.length > maxRows,
    ms,
  }
}

// Permission projections share the manager but receive distinct consumer claims. This private
// factory keeps pool ownership out of the loaded-plugin API and its wire surface.
const consumerServices = new WeakMap<DataSourceService, () => DataSourceService>()

export function createDataSourceService(core: DataCore): DataSourceService {
  const pools = taskDataPools((taskId) => resolveTaskDataUrl(core, taskId))
  const forConsumer = (administrative = false): DataSourceService => {
    const owner = {}
    const catalog = (taskId: string) => pools.use(taskId, owner, dataCatalog)
    const service: DataSourceService = {
      configured: (taskId) => hasTaskDataSource(core, taskId),
      connect: async (taskId) => ({ database: (await pools.connect(taskId, owner, true)).database }),
      disconnect: (taskId) => pools.disconnect(taskId, owner, administrative),
      query: async (taskId, sql, options = {}) => {
        if (typeof sql !== 'string' || !sql.trim()) throw new Error('Empty query.')
        const readOnly = options.readOnly !== false
        if (readOnly) {
          const refusal = dataReadOnlyRefusal(sql)
          if (refusal) throw new Error(`This query is refused: ${refusal}.`)
        }
        const timeoutMs = boundedTimeout(options.timeoutMs)
        const maxRows = boundedRows(options.maxRows)
        return pools.use(taskId, owner, async (entry) => {
          const pool = entry.pool
          const started = process.hrtime.bigint()
          let raw: QueryResult<QueryResultRow> | QueryResult<QueryResultRow>[]
          const client = await pool.connect()
          try {
            await client.query(readOnly ? 'BEGIN READ ONLY' : 'BEGIN')
            await client.query(`SET LOCAL statement_timeout = ${timeoutMs}`)
            raw = await client.query(sql, options.parameters ?? []) as QueryResult<QueryResultRow> | QueryResult<QueryResultRow>[]
            await client.query(readOnly ? 'ROLLBACK' : 'COMMIT')
          } catch (error) {
            await client.query('ROLLBACK').catch(() => {})
            throw error
          } finally {
            client.release()
          }
          const ms = Math.round(Number(process.hrtime.bigint() - started) / 1e6)
          const last = Array.isArray(raw) ? raw[raw.length - 1] : raw
          if (!last) throw new Error('The database returned no result.')
          const result = resultSet(last, maxRows, ms)
          if (!new Set(['SELECT', 'INSERT', 'UPDATE', 'DELETE']).has(result.command.toUpperCase())) {
            invalidateDataCatalog(entry)
          }
          return result
        })
      },
      catalog,
      schema: async (taskId) => {
        const valid = pools.claim(taskId, owner)
        const task = await core.tasks.load(taskId)
        if (!task) throw new Error('Task not found.')
        const config = task.projectId ? (await core.projects.config(task.projectId))?.config : null
        const mode = config?.dbSchemaMode === 'script' || config?.dbSchemaMode === 'file' ? config.dbSchemaMode : 'auto'
        const value = config?.dbSchemaValue?.trim()
        const notesText = config?.dbSchemaNotes?.trim()
        const notes = notesText ? { notes: notesText } : {}
        if (mode === 'script') {
          if (!value) throw new Error('No schema script configured in the repo settings.')
          const root = await core.tasks.root(taskId)
          if (!root) throw new Error('No worktree for this task yet.')
          await core.projects.assertConfigTrusted(taskId)
          const { stdout } = await core.proc.runProcessOrThrow({
            file: 'bash',
            args: ['-lc', value],
            cwd: root,
            timeoutMs: DATA_DEFAULT_TIMEOUT_MS,
            maxOutputBytes: 4 << 20,
          })
          const text = stdout.replace(/\x1b(?:\[[0-9;]*[A-Za-z]|\(B)/g, '').trim()
          if (!text) throw new Error('Schema script produced no output.')
          return { tables: [], text: capSchema(text), source: 'script', ...notes }
        }
        if (mode === 'file') {
          if (!value) throw new Error('No schema file configured in the repo settings.')
          const root = await core.tasks.root(taskId)
          if (!root) throw new Error('No worktree for this task yet.')
          const path = core.fs.resolveInRoot(root, value)
          if (!path) throw new Error('Schema file path escapes the worktree.')
          const text = (await readFile(path, 'utf8')).trim()
          if (!text) throw new Error('Schema file is empty.')
          return { tables: [], text: capSchema(text), source: 'file', ...notes }
        }
        if (!valid()) throw new Error('Database connection retired. Connect again.')
        const tables = await catalog(taskId)
        if (!tables.length) throw new Error('No tables found in the connected database.')
        return { tables, text: capSchema(formatSchema(tables)), source: 'auto', ...notes }
      },
    }
    consumerServices.set(service, () => forConsumer())
    return service
  }
  return forConsumer(true)
}

/** Apply the loaded-plugin permission boundary without exposing a second service implementation. */
export function dataSourceFor(service: DataSourceService, canWrite: boolean): DataSourceService {
  service = consumerServices.get(service)?.() ?? service
  return {
    configured: (taskId) => service.configured(taskId),
    connect: (taskId) => service.connect(taskId),
    disconnect: (taskId) => service.disconnect(taskId),
    catalog: (taskId) => service.catalog(taskId),
    schema: (taskId) => service.schema(taskId),
    query: async (taskId, sql, options = {}) => {
      if (options.readOnly === false && !canWrite) {
        throw new Error('This plugin has no data:write permission.')
      }
      return await service.query(taskId, sql, { ...options, readOnly: options.readOnly !== false })
    },
  }
}
