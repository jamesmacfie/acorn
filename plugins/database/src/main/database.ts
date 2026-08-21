// Database pane backing: docs/data-layer.md § Database plugin: the Postgres pane. Was the `db:*` IPC
// channels; now the DatabaseBridge behind the HTTP routes in server/routes/database.ts. Pure-Node (pg).
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import pg from 'pg'
import type { QueryResult, QueryResultRow } from 'pg'
import { type CoreServices, loadRepoConfig } from '@acorn/plugin-api/node'
import type { DbCatalogResult, DbCatalogTable, DbCell, DbColumn, DbConnectResult, DbColumnsResult, DbPk, DbQueryResult, DbResultSet, DbRowsResult, DbSchemaResult, DbTablesResult, DbWriteResult } from '../shared/database'

// The Postgres surface this plugin's routes call. Declared beside the implementation rather than in
// the route file that consumes it: a route capability provided at init and resolved per request used
// to carry this across the old main/renderer boundary, and this plugin has had none since it became
// loopback HTTP. A test that wants a fake passes one to the route factory.
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
  catalog(taskId: string): Promise<DbCatalogResult>
}

const { Pool } = pg
const exec = promisify(execFile)

export type DatabaseCoreServices = Pick<CoreServices, 'tasks' | 'projects' | 'fs'>

const pools = new Map<string, { pool: InstanceType<typeof Pool>; url: string; database: string }>()

const ROW_CAP = 500 // Bound table browsing until the UI exposes paging.

// pg returns numbers/bigints/dates/json as their native JS types; flatten every cell to string|null
// so the grid renders uniformly and NULL stays distinct.
function cell(v: unknown): DbCell {
  if (v === null || v === undefined) return null
  if (typeof v === 'string') return v
  if (v instanceof Date) return v.toISOString()
  if (typeof v === 'object' || Array.isArray(v)) return JSON.stringify(v)
  return String(v)
}

function toResultSet(res: QueryResult<QueryResultRow>): DbResultSet {
  const columns = res.fields?.map((f) => f.name) ?? []
  const rows = (res.rows ?? []).map((r) => columns.map((c) => cell((r as Record<string, unknown>)[c])))
  return { columns, rows, rowCount: res.rowCount ?? null, command: res.command ?? '' }
}

// Double-quote an identifier (escaping embedded quotes). Only ever called on identifiers already
// checked against the introspected schema.
const qid = (id: string): string => `"${id.replace(/"/g, '""')}"`

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e))

// Resolves the connection URL for a task without persisting it: docs/data-layer.md § Database plugin:
// the Postgres pane states the fallback order. Exported for database.test.ts, since this is the only
// place the "did the untrusted script execute?" question can be asked without a live Postgres.
export async function resolveDbUrl(core: DatabaseCoreServices, taskId: string): Promise<string | null> {
  const t = await core.tasks.load(taskId)
  if (!t) return null
  const root = await core.tasks.root(taskId) // the task worktree (created lazily), or null
  const project = t.projectId ? await core.projects.byId(t.projectId) : null
  const config = t.projectId ? await core.projects.config(t.projectId) : null
  const cfg = loadRepoConfig(root ?? project?.path ?? null, homedir(), { dbUrlScript: config?.config.dbUrlScript })
  const script = cfg.dbUrlScript?.trim()
  if (script && root) {
    // Executable content from the checkout, so it carries the same trust gate as other repo-authored
    // run targets (docs/data-layer.md § Database plugin: the Postgres pane; core/main/repoConfigTrust.ts).
    //
    // This check sits outside the try block below: a trust failure must propagate to the caller rather
    // than fall through to the .env/env fallbacks as if the script had merely errored.
    if (cfg.dbUrlFromRepo) await core.projects.assertConfigTrusted(taskId)
    try {
      const { stdout } = await exec('bash', ['-lc', script], { cwd: root, timeout: 15_000, maxBuffer: 1 << 20 })
      // Scripts may echo noise before the URL. Strip ANSI escapes, since some CLIs emit them even when
      // piped, and take the last non-empty line.
      const line = stdout.replace(/\x1b(?:\[[0-9;]*[A-Za-z]|\(B)/g, '').split('\n').map((l) => l.trim()).filter(Boolean).pop()
      if (line) return line
    } catch {
      // fall through to auto-detect
    }
  }
  if (root) {
    const fromEnv = await readEnvUrl(join(root, '.env'))
    if (fromEnv) return fromEnv
  }
  return process.env.DATABASE_URL?.trim() || null
}

// Pull DATABASE_URL out of a .env file, tolerating `export ` and quotes. Best effort: a missing file
// returns null.
async function readEnvUrl(envPath: string): Promise<string | null> {
  try {
    const text = await readFile(envPath, 'utf8')
    for (const raw of text.split('\n')) {
      const m = raw.match(/^\s*(?:export\s+)?DATABASE_URL\s*=\s*(.+)\s*$/)
      if (m) {
        let v = m[1].trim()
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
        if (v) return v
      }
    }
  } catch {
    // no .env / unreadable
  }
  return null
}

const getPool = (taskId: string): InstanceType<typeof Pool> | null => pools.get(taskId)?.pool ?? null

// The introspected catalog behind table/column completions, cached per task. Monaco asks its provider
// once per completion session and filters client-side as the reader types, so this is one lookup per
// trigger rather than per keystroke, and a full introspection per trigger would still stall on a
// remote node.
//
// Invalidated on connect/disconnect and after a non-read/write statement: docs/data-layer.md §
// Database plugin: the Postgres pane.
const catalogs = new Map<string, DbCatalogTable[]>()
const DML_COMMANDS = new Set(['SELECT', 'INSERT', 'UPDATE', 'DELETE'])

// Introspect the non-system tables in the current database.
async function listTables(pool: InstanceType<typeof Pool>): Promise<{ schema: string; name: string }[]> {
  const res = await pool.query<{ table_schema: string; table_name: string }>(
    `SELECT table_schema, table_name FROM information_schema.tables
     WHERE table_type = 'BASE TABLE' AND table_schema NOT IN ('pg_catalog', 'information_schema')
     ORDER BY table_schema, table_name`,
  )
  return res.rows.map((r) => ({ schema: r.table_schema, name: r.table_name }))
}

// Columns + PK flags for one table. PK columns come from pg_index on the table's regclass.
async function tableColumns(pool: InstanceType<typeof Pool>, schema: string, name: string): Promise<DbColumn[]> {
  const cols = await pool.query<{ column_name: string; data_type: string; is_nullable: string }>(
    `SELECT column_name, data_type, is_nullable FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position`,
    [schema, name],
  )
  const pk = await pool.query<{ attname: string }>(
    `SELECT a.attname FROM pg_index i
       JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
     WHERE i.indrelid = $1::regclass AND i.indisprimary`,
    [`${qid(schema)}.${qid(name)}`],
  )
  const pkSet = new Set(pk.rows.map((r) => r.attname))
  return cols.rows.map((r) => ({ name: r.column_name, dataType: r.data_type, nullable: r.is_nullable === 'YES', isPk: pkSet.has(r.column_name) }))
}

// Cap on the AI-generation schema text: docs/data-layer.md § Database plugin: the Postgres pane.
const SCHEMA_CHAR_CAP = 80_000

const capSchema = (text: string): string =>
  text.length <= SCHEMA_CHAR_CAP ? text : `${text.slice(0, SCHEMA_CHAR_CAP)}\n-- (schema truncated)`

// Compact CREATE TABLE-ish text from introspected tables, for the AI prompt rather than execution.
export function formatSchema(tables: { schema: string; name: string; columns: DbColumn[] }[]): string {
  return tables
    .map((t) => {
      const cols = t.columns
        .map((c) => `  ${qid(c.name)} ${c.dataType}${c.nullable ? '' : ' NOT NULL'}${c.isPk ? ', -- PK' : ','}`)
        .join('\n')
      return `CREATE TABLE ${qid(t.schema)}.${qid(t.name)} (\n${cols}\n);`
    })
    .join('\n\n')
}

// Validates a renderer-supplied table against the live schema, returning the matched {schema,name} or
// throwing. Only names Postgres itself reported are ever quoted, which prevents identifier injection.
async function assertTable(pool: InstanceType<typeof Pool>, schema: string, name: string): Promise<{ schema: string; name: string }> {
  const match = (await listTables(pool)).find((t) => t.schema === schema && t.name === name)
  if (!match) throw new Error(`Unknown table ${schema}.${name}`)
  return match
}

// Validate renderer-supplied column names against the table; returns the column metadata by name.
async function assertColumns(pool: InstanceType<typeof Pool>, schema: string, name: string, cols: string[]): Promise<Map<string, DbColumn>> {
  const meta = new Map((await tableColumns(pool, schema, name)).map((c) => [c.name, c]))
  for (const c of cols) if (!meta.has(c)) throw new Error(`Unknown column ${c} on ${schema}.${name}`)
  return meta
}

// Shutdown disposal, composition-root owned: ends every open pg pool so quit doesn't leak connections.
// Called by the composition root's reverse-order teardown. Idempotent, since an empty map is a no-op.
export async function endDbPools(): Promise<void> {
  for (const [taskId, { pool }] of pools) {
    await pool.end().catch(() => {})
    pools.delete(taskId)
  }
  catalogs.clear()
}

export function databaseBridge(core: DatabaseCoreServices): DatabaseBridge {
  return {
    // Connect: resolve the URL on demand, (re)build the pool, confirm reachability. Never persists the URL.
    connect: async (taskId): Promise<DbConnectResult> => {
      try {
        const url = await resolveDbUrl(core, taskId)
        if (!url) return { ok: false, error: 'No database found. Set a connection script in Workspace Settings, or add DATABASE_URL to the worktree .env.' }
        await pools.get(taskId)?.pool.end().catch(() => {})
        const pool = new Pool({ connectionString: url, max: 4, connectionTimeoutMillis: 8_000 })
        pool.on('error', () => {}) // idle-client errors shouldn't crash main
        const res = await pool.query<{ database: string }>('SELECT current_database() AS database')
        const database = res.rows[0]?.database ?? ''
        pools.set(taskId, { pool, url, database })
        catalogs.delete(taskId) // a reconnect may be pointing at a different database entirely
        return { ok: true, database }
      } catch (e) {
        return { ok: false, error: errText(e) }
      }
    },

    tables: async (taskId): Promise<DbTablesResult> => {
      const pool = getPool(taskId)
      if (!pool) return { error: 'Not connected.' }
      try {
        return { tables: await listTables(pool) }
      } catch (e) {
        return { error: errText(e) }
      }
    },

    columns: async (taskId, schema, name): Promise<DbColumnsResult> => {
      const pool = getPool(taskId)
      if (!pool) return { error: 'Not connected.' }
      try {
        const t = await assertTable(pool, schema, name)
        return { columns: await tableColumns(pool, t.schema, t.name) }
      } catch (e) {
        return { error: errText(e) }
      }
    },

    // Browse a table: first page ordered by PK (if any), capped at ROW_CAP, plus the total row count.
    rows: async (taskId, schema, name, offset): Promise<DbRowsResult> => {
      const pool = getPool(taskId)
      if (!pool) return { error: 'Not connected.' }
      try {
        const t = await assertTable(pool, schema, name)
        const cols = await tableColumns(pool, t.schema, t.name)
        const pkCols = cols.filter((c) => c.isPk).map((c) => c.name)
        const rel = `${qid(t.schema)}.${qid(t.name)}`
        const order = pkCols.length ? ` ORDER BY ${pkCols.map(qid).join(', ')}` : ''
        const off = Number.isFinite(offset) && offset! > 0 ? Math.floor(offset!) : 0
        const res = await pool.query(`SELECT * FROM ${rel}${order} LIMIT $1 OFFSET $2`, [ROW_CAP, off])
        const cnt = await pool.query<{ n: string }>(`SELECT count(*) AS n FROM ${rel}`)
        return { ...toResultSet(res), total: Number(cnt.rows[0]?.n ?? 0) }
      } catch (e) {
        return { error: errText(e) }
      }
    },

    // Arbitrary SQL from the Monaco editor, run verbatim since writes are wanted. Timed for the footer.
    query: async (taskId, sql): Promise<DbQueryResult> => {
      const pool = getPool(taskId)
      if (!pool) return { error: 'Not connected.' }
      if (typeof sql !== 'string' || !sql.trim()) return { error: 'Empty query.' }
      const started = process.hrtime.bigint()
      try {
        const res = await pool.query(sql)
        const ms = Number(process.hrtime.bigint() - started) / 1e6
        // A multi-statement string yields an array; report the last result set (psql-like).
        const last = Array.isArray(res) ? res[res.length - 1] : res
        const set = toResultSet(last as QueryResult<QueryResultRow>)
        // Anything that was not a plain read or write may have changed the shape of the database, and
        // the completion popup is the thing that would go on claiming otherwise. A multi-statement
        // string is judged on its last command, which is the same simplification the row report makes.
        if (!DML_COMMANDS.has(set.command.toUpperCase())) catalogs.delete(taskId)
        return { ...set, ms: Math.round(ms) }
      } catch (e) {
        return { error: errText(e) }
      }
    },

    // Row edits happen in the detail panel: update one column, insert a row, or delete by PK. All
    // identifiers validated; all values parameterized.
    update: async (taskId, schema, name, column, value, pk): Promise<DbWriteResult> => {
      const pool = getPool(taskId)
      if (!pool) return { ok: false, error: 'Not connected.' }
      try {
        const t = await assertTable(pool, schema, name)
        const pkCols = Object.keys(pk)
        if (!pkCols.length) return { ok: false, error: 'This table has no primary key — editing is disabled.' }
        await assertColumns(pool, t.schema, t.name, [column, ...pkCols])
        const where = pkCols.map((c, i) => `${qid(c)} = $${i + 2}`).join(' AND ')
        const res = await pool.query(`UPDATE ${qid(t.schema)}.${qid(t.name)} SET ${qid(column)} = $1 WHERE ${where}`, [value, ...pkCols.map((c) => pk[c])])
        return { ok: true, rowCount: res.rowCount ?? 0 }
      } catch (e) {
        return { ok: false, error: errText(e) }
      }
    },

    insert: async (taskId, schema, name, values): Promise<DbWriteResult> => {
      const pool = getPool(taskId)
      if (!pool) return { ok: false, error: 'Not connected.' }
      try {
        const t = await assertTable(pool, schema, name)
        const cols = Object.keys(values)
        if (!cols.length) return { ok: false, error: 'No values to insert.' }
        await assertColumns(pool, t.schema, t.name, cols)
        const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ')
        const res = await pool.query(`INSERT INTO ${qid(t.schema)}.${qid(t.name)} (${cols.map(qid).join(', ')}) VALUES (${placeholders})`, cols.map((c) => values[c]))
        return { ok: true, rowCount: res.rowCount ?? 0 }
      } catch (e) {
        return { ok: false, error: errText(e) }
      }
    },

    remove: async (taskId, schema, name, pk): Promise<DbWriteResult> => {
      const pool = getPool(taskId)
      if (!pool) return { ok: false, error: 'Not connected.' }
      try {
        const t = await assertTable(pool, schema, name)
        const pkCols = Object.keys(pk)
        if (!pkCols.length) return { ok: false, error: 'This table has no primary key — delete is disabled.' }
        await assertColumns(pool, t.schema, t.name, pkCols)
        const where = pkCols.map((c, i) => `${qid(c)} = $${i + 1}`).join(' AND ')
        const res = await pool.query(`DELETE FROM ${qid(t.schema)}.${qid(t.name)} WHERE ${where}`, pkCols.map((c) => pk[c]))
        return { ok: true, rowCount: res.rowCount ?? 0 }
      } catch (e) {
        return { ok: false, error: errText(e) }
      }
    },

    // Schema text for AI query generation: per-repo source (repo-level settings), a shell script's
    // stdout, a worktree file, or by default live introspection of the connected pool.
    schema: async (taskId): Promise<DbSchemaResult> => {
      try {
        const t = await core.tasks.load(taskId)
        if (!t) return { error: 'Task not found.' }
        const config = t.projectId ? (await core.projects.config(t.projectId))?.config : null
        const mode = config?.dbSchemaMode === 'script' || config?.dbSchemaMode === 'file' ? config.dbSchemaMode : 'auto'
        const value = config?.dbSchemaValue?.trim()
        // Free-form project notes ride along with every source so the route needs no second lookup.
        const notesText = config?.dbSchemaNotes?.trim()
        const notes = notesText ? { notes: notesText } : {}
        if (mode === 'script') {
          if (!value) return { error: 'No schema script configured in the repo settings.' }
          const root = await core.tasks.root(taskId)
          if (!root) return { error: 'No worktree for this task yet.' }
          const { stdout } = await exec('bash', ['-lc', value], { cwd: root, timeout: 15_000, maxBuffer: 4 << 20 })
          const text = stdout.replace(/\x1b(?:\[[0-9;]*[A-Za-z]|\(B)/g, '').trim()
          return text ? { schema: capSchema(text), source: 'script', ...notes } : { error: 'Schema script produced no output.' }
        }
        if (mode === 'file') {
          if (!value) return { error: 'No schema file configured in the repo settings.' }
          const root = await core.tasks.root(taskId)
          if (!root) return { error: 'No worktree for this task yet.' }
          const abs = core.fs.resolveInRoot(root, value)
          if (!abs) return { error: 'Schema file path escapes the worktree.' }
          const text = (await readFile(abs, 'utf8')).trim()
          return text ? { schema: capSchema(text), source: 'file', ...notes } : { error: 'Schema file is empty.' }
        }
        const pool = getPool(taskId)
        if (!pool) return { error: 'Not connected.' }
        const tables = await listTables(pool)
        if (!tables.length) return { error: 'No tables found in the connected database.' }
        const withCols = await Promise.all(tables.map(async (table) => ({ ...table, columns: await tableColumns(pool, table.schema, table.name) })))
        return { schema: capSchema(formatSchema(withCols)), source: 'auto', ...notes }
      } catch (e) {
        return { error: errText(e) }
      }
    },

    // Structured tables + columns for the completion provider. Cached (see `catalogs` above) because
    // the same answer is wanted on every trigger and introspection is two queries per table.
    catalog: async (taskId): Promise<DbCatalogResult> => {
      const cached = catalogs.get(taskId)
      if (cached) return { tables: cached }
      const pool = getPool(taskId)
      if (!pool) return { error: 'Not connected.' }
      try {
        const tables = await listTables(pool)
        const withCols = await Promise.all(tables.map(async (table) => ({
          ...table,
          columns: (await tableColumns(pool, table.schema, table.name)).map((c) => ({ name: c.name, dataType: c.dataType })),
        })))
        catalogs.set(taskId, withCols)
        return { tables: withCols }
      } catch (e) {
        return { error: errText(e) }
      }
    },

    disconnect: async (taskId): Promise<{ ok: true }> => {
      catalogs.delete(taskId)
      const entry = pools.get(taskId)
      if (entry) {
        pools.delete(taskId)
        await entry.pool.end().catch(() => {})
      }
      return { ok: true }
    },
  }
}
