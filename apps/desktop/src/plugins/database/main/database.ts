// Database pane backing (docs/pg.md): a per-task Postgres connection for browsing + editing the
// task's dev database. Mirrors the local-git/editor surfaces — the taskId is the capability, and
// everything is re-derived from the DB per call. Was the `db:*` IPC channels; now the
// DatabaseBridge behind the HTTP routes in server/routes/database.ts. Pure-Node (pg).
//
// SQL-injection posture: values are ALWAYS parameterized ($1…). Identifiers (schema/table/column
// names) can't be parameterized, so every identifier used in generated SQL is validated against
// the live introspected schema (assertTable / assertColumns) and double-quoted (qid). Arbitrary SQL
// from the editor (query) runs verbatim — it's the user's own DB and writes are wanted.
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import pg from 'pg'
import type { QueryResult, QueryResultRow } from 'pg'
import type { AppDatabase } from '../../../core/server/db'
import type { DatabaseBridge } from '../server/routes/database'
import type { DbCell, DbColumn, DbConnectResult, DbColumnsResult, DbPk, DbQueryResult, DbResultSet, DbRowsResult, DbSchemaResult, DbTablesResult, DbWriteResult } from '../shared/database'
import { loadTask, resolveInRoot, taskRoot, workspaceConfigRow } from '../../../core/main/taskWorktree'

const { Pool } = pg
const exec = promisify(execFile)

// One pool per task, torn down on disconnect/reconnect. ponytail: keyed by taskId, not by URL —
// a task points at one database; reconnect ends the old pool first.
const pools = new Map<string, { pool: InstanceType<typeof Pool>; url: string; database: string }>()

const ROW_CAP = 500 // ponytail: browse cap; raise / add real paging when a table dwarfs this.

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

// Resolve the connection URL for a task WITHOUT persisting it: workspace dbUrlScript (run in the
// worktree) → <worktree>/.env DATABASE_URL → process.env.DATABASE_URL. Returns null if none found.
async function resolveDbUrl(db: AppDatabase, taskId: string): Promise<string | null> {
  const t = await loadTask(db, taskId)
  if (!t) return null
  const root = await taskRoot(db, taskId) // the task worktree (created lazily), or null
  const ws = await workspaceConfigRow(db, t.repoOwner, t.repoName)
  const script = ws?.dbUrlScript?.trim()
  if (script && root) {
    try {
      const { stdout } = await exec('bash', ['-lc', script], { cwd: root, timeout: 15_000, maxBuffer: 1 << 20 })
      // Scripts may echo noise before the URL — strip ANSI escapes (some CLIs emit them even when
      // piped) and take the last non-empty line.
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

// Pull DATABASE_URL out of a .env file (tolerates `export `, quotes). Best-effort — missing file → null.
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

// Cap on the AI-generation schema text (docs/pg.md) — the model runtime rejects system prompts over
// 100k chars, so truncate below that with a visible marker rather than failing the whole request.
const SCHEMA_CHAR_CAP = 80_000

const capSchema = (text: string): string =>
  text.length <= SCHEMA_CHAR_CAP ? text : `${text.slice(0, SCHEMA_CHAR_CAP)}\n-- (schema truncated)`

// Compact CREATE TABLE-ish text from introspected tables — for the AI prompt, not for execution.
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

// Validate a renderer-supplied table against the live schema; returns the matched {schema,name} or
// throws. Prevents identifier injection — we only ever quote names Postgres itself reported.
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

// Shutdown disposal (composition-root ownership): end every open pg pool so quit doesn't leak connections. Called
// by the composition root's reverse-order teardown. Idempotent — an empty map is a no-op.
export async function endDbPools(): Promise<void> {
  for (const [taskId, { pool }] of pools) {
    await pool.end().catch(() => {})
    pools.delete(taskId)
  }
}

export function databaseBridge(db: AppDatabase): DatabaseBridge {
  return {
    // Connect: resolve the URL on demand, (re)build the pool, confirm reachability. Never persists the URL.
    connect: async (taskId): Promise<DbConnectResult> => {
      try {
        const url = await resolveDbUrl(db, taskId)
        if (!url) return { ok: false, error: 'No database found. Set a connection script in Workspace Settings, or add DATABASE_URL to the worktree .env.' }
        await pools.get(taskId)?.pool.end().catch(() => {})
        const pool = new Pool({ connectionString: url, max: 4, connectionTimeoutMillis: 8_000 })
        pool.on('error', () => {}) // idle-client errors shouldn't crash main
        const res = await pool.query<{ database: string }>('SELECT current_database() AS database')
        const database = res.rows[0]?.database ?? ''
        pools.set(taskId, { pool, url, database })
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
        // ponytail: exact count(*); swap to a pg_class estimate if it drags on huge tables.
        const cnt = await pool.query<{ n: string }>(`SELECT count(*) AS n FROM ${rel}`)
        return { ...toResultSet(res), total: Number(cnt.rows[0]?.n ?? 0) }
      } catch (e) {
        return { error: errText(e) }
      }
    },

    // Arbitrary SQL from the Monaco editor — runs verbatim (writes wanted). Timed for the footer.
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
        return { ...toResultSet(last as QueryResult<QueryResultRow>), ms: Math.round(ms) }
      } catch (e) {
        return { error: errText(e) }
      }
    },

    // Row edits happen in the detail panel (docs/pg.md): update one column, insert a row, or
    // delete by PK. All identifiers validated; all values parameterized.
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

    // Schema text for AI query generation (docs/pg.md): per-workspace source — a shell script's
    // stdout, a worktree file, or (default) live introspection of the connected pool.
    schema: async (taskId): Promise<DbSchemaResult> => {
      try {
        const t = await loadTask(db, taskId)
        if (!t) return { error: 'Task not found.' }
        const ws = await workspaceConfigRow(db, t.repoOwner, t.repoName)
        const mode = ws?.dbSchemaMode === 'script' || ws?.dbSchemaMode === 'file' ? ws.dbSchemaMode : 'auto'
        const value = ws?.dbSchemaValue?.trim()
        if (mode === 'script') {
          if (!value) return { error: 'No schema script configured in Workspace Settings.' }
          const root = await taskRoot(db, taskId)
          if (!root) return { error: 'No worktree for this task yet.' }
          const { stdout } = await exec('bash', ['-lc', value], { cwd: root, timeout: 15_000, maxBuffer: 4 << 20 })
          const text = stdout.replace(/\x1b(?:\[[0-9;]*[A-Za-z]|\(B)/g, '').trim()
          return text ? { schema: capSchema(text), source: 'script' } : { error: 'Schema script produced no output.' }
        }
        if (mode === 'file') {
          if (!value) return { error: 'No schema file configured in Workspace Settings.' }
          const root = await taskRoot(db, taskId)
          if (!root) return { error: 'No worktree for this task yet.' }
          const abs = resolveInRoot(root, value)
          if (!abs) return { error: 'Schema file path escapes the worktree.' }
          const text = (await readFile(abs, 'utf8')).trim()
          return text ? { schema: capSchema(text), source: 'file' } : { error: 'Schema file is empty.' }
        }
        const pool = getPool(taskId)
        if (!pool) return { error: 'Not connected.' }
        const tables = await listTables(pool)
        if (!tables.length) return { error: 'No tables found in the connected database.' }
        const withCols = await Promise.all(tables.map(async (table) => ({ ...table, columns: await tableColumns(pool, table.schema, table.name) })))
        return { schema: capSchema(formatSchema(withCols)), source: 'auto' }
      } catch (e) {
        return { error: errText(e) }
      }
    },

    disconnect: async (taskId): Promise<{ ok: true }> => {
      const entry = pools.get(taskId)
      if (entry) {
        pools.delete(taskId)
        await entry.pool.end().catch(() => {})
      }
      return { ok: true }
    },
  }
}
