import { batch, createSignal } from 'solid-js'
import { z } from 'zod'
import type { AcornBridge } from '@acorn/plugin-api/ui/sdk'
import type { ModelBackend } from '@acorn/protocol/modelProviders.ts'
import type { RowDraft } from './RowDetail'
import type { DbColumn, DbResultSet, DbSavedQuery, DbTable } from '../shared/database'

export type DatabaseWorkspace = {
  dbName: string
  tables: DbTable[]
  filter: string
  selected: DbTable | null
  columns: DbColumn[]
  result: DbResultSet | null
  resultTable: DbTable | null
  footer: string
  activeRow: number | null
  loadedName: string
  savedQueries: DbSavedQuery[]
  modelBackends: ModelBackend[]
  inserting: boolean
  rowDraft: RowDraft | null
}

// Snapshots contain data only, so a returning pane uses its newly granted bridge. Worker reuse can
// restore immediately; worker retirement falls back to host state. Keep eight recent Node/task pairs.
// SQL text belongs to the host's scratch document, not this cache.
const workspaces = new Map<string, DatabaseWorkspace>()
const key = (nodeId: string, taskId: string): string => JSON.stringify([nodeId, taskId])

export const databaseWorkspace = (nodeId: string, taskId: string): DatabaseWorkspace | undefined =>
  workspaces.get(key(nodeId, taskId))

export function rememberDatabaseWorkspace(nodeId: string, taskId: string, workspace: DatabaseWorkspace): void {
  const id = key(nodeId, taskId)
  workspaces.delete(id)
  workspaces.set(id, workspace)
  if (workspaces.size > 8) workspaces.delete(workspaces.keys().next().value!)
}

const table = z.object({ schema: z.string(), name: z.string() })
const cell = z.string().nullable()
const workspaceSchema = z.object({
  dbName: z.string(), tables: z.array(table), filter: z.string(), selected: table.nullable(),
  columns: z.array(z.object({ name: z.string(), dataType: z.string(), nullable: z.boolean(), isPk: z.boolean() })),
  result: z.object({ columns: z.array(z.string()), rows: z.array(z.array(cell)), rowCount: z.number().nullable(), command: z.string() }).nullable(),
  resultTable: table.nullable(), footer: z.string(), activeRow: z.number().int().nonnegative().nullable(),
  loadedName: z.string(), inserting: z.boolean(),
  rowDraft: z.record(z.string(), z.object({ value: z.string(), isNull: z.boolean() })).nullable(),
  savedQueries: z.array(z.object({ id: z.string(), name: z.string(), notes: z.string().nullable(), sql: z.string(), updatedAt: z.number() })),
})

// Even JSON escaping every character fits below the bridge's 1 MiB value limit. Result sets can be
// larger than one value, so split their serialized snapshot without truncating any cells.
const CHUNK_CHARS = 128 * 1024
const stateKey = (taskId: string): string => `workspace:v1:${taskId}`
const storedSchema = z.union([
  z.object({ version: z.literal(1), text: z.string() }),
  z.object({ version: z.literal(1), revision: z.string(), chunks: z.number().int().min(1).max(256) }),
])
let revisionSequence = 0

export async function loadDatabaseWorkspace(state: AcornBridge['state'], taskId: string): Promise<DatabaseWorkspace | undefined> {
  const id = stateKey(taskId)
  const stored = storedSchema.safeParse(await state.get(id))
  if (!stored.success) return undefined
  let text: string
  if ('text' in stored.data) text = stored.data.text
  else {
    const manifest = stored.data
    const parts = await Promise.all(Array.from({ length: manifest.chunks }, (_, i) => state.get<{ revision: string; text: string }>(`${id}:part:${i}`)))
    // A held or interrupted save must never combine rows from different snapshots.
    if (parts.some((part) => !part || part.revision !== manifest.revision || typeof part.text !== 'string' || part.text.length > CHUNK_CHARS)) return undefined
    text = parts.map((part) => part!.text).join('')
  }
  if (new TextEncoder().encode(text).byteLength > 32 * 1024 * 1024) return undefined
  let value: unknown
  try { value = JSON.parse(text) } catch { return undefined }
  const parsed = workspaceSchema.safeParse(value)
  if (!parsed.success) return undefined
  const workspace = parsed.data
  if (workspace.activeRow !== null && (!workspace.result || workspace.activeRow >= workspace.result.rows.length)) return undefined
  // Provider availability is refreshed from the Node, rather than restored from an old snapshot.
  return { ...workspace, modelBackends: [] }
}

export async function saveDatabaseWorkspace(state: AcornBridge['state'], taskId: string, workspace: DatabaseWorkspace): Promise<void> {
  const id = stateKey(taskId)
  const text = JSON.stringify(workspace)
  if (text.length <= CHUNK_CHARS) {
    await state.set(id, { version: 1, text })
    return
  }
  const revision = `${Date.now()}:${++revisionSequence}:${Math.random()}`
  const chunks = Math.ceil(text.length / CHUNK_CHARS)
  if (chunks > 256 || new TextEncoder().encode(text).byteLength > 32 * 1024 * 1024) throw new Error('The database workspace exceeds the 32 MiB restoration limit.')
  // Admit every write while this mount's bridge is live. The host processes messages in order and
  // saves values through its own preference queue; no later callback borrows a retired bridge.
  await Promise.all([
    ...Array.from({ length: chunks }, (_, i) => state.set(`${id}:part:${i}`, { revision, text: text.slice(i * CHUNK_CHARS, (i + 1) * CHUNK_CHARS) })),
    state.set(id, { version: 1, revision, chunks }),
  ])
}

/** One owner for the view's data and restoration. Requests and the editor stay with the mounted pane. */
export function createDatabaseWorkspace(initial?: DatabaseWorkspace) {
  const [dbName, setDbName] = createSignal(initial?.dbName ?? '')
  const [tables, setTables] = createSignal<DbTable[]>(initial?.tables ?? [])
  const [filter, setFilter] = createSignal(initial?.filter ?? '')
  const [selected, setSelected] = createSignal<DbTable | null>(initial?.selected ?? null)
  const [columns, setColumns] = createSignal<DbColumn[]>(initial?.columns ?? []) // of the selected table (drives editing/PK)
  const [result, setResult] = createSignal<DbResultSet | null>(initial?.result ?? null)
  const [resultTable, setResultTable] = createSignal<DbTable | null>(initial?.resultTable ?? null) // table the grid rows belong to (null = ad-hoc SQL)
  const [footer, setFooter] = createSignal(initial?.footer ?? '')
  const [activeRow, setActiveRow] = createSignal<number | null>(initial?.activeRow ?? null)
  const [inserting, setInserting] = createSignal(initial?.inserting ?? false)
  const [rowDraft, setRowDraft] = createSignal<RowDraft | null>(initial?.rowDraft ?? null)
  const [loadedName, setLoadedName] = createSignal(initial?.loadedName ?? '')
  const snapshot = (savedQueries: DbSavedQuery[], modelBackends: ModelBackend[]): DatabaseWorkspace => ({
    dbName: dbName(), tables: tables(), filter: filter(), selected: selected(), columns: columns(),
    result: result(), resultTable: resultTable(), footer: footer(), activeRow: activeRow(), loadedName: loadedName(),
    savedQueries, modelBackends, inserting: inserting(), rowDraft: rowDraft(),
  })
  const restore = (workspace: DatabaseWorkspace) => batch(() => {
    setDbName(workspace.dbName); setTables(workspace.tables); setFilter(workspace.filter)
    setSelected(workspace.selected); setColumns(workspace.columns); setResult(workspace.result)
    setResultTable(workspace.resultTable); setFooter(workspace.footer); setActiveRow(workspace.activeRow)
    setLoadedName(workspace.loadedName); setInserting(workspace.inserting); setRowDraft(workspace.rowDraft)
  })
  return {
    dbName, setDbName, tables, setTables, filter, setFilter, selected, setSelected, columns, setColumns,
    result, setResult, resultTable, setResultTable, footer, setFooter, activeRow, setActiveRow,
    inserting, setInserting, rowDraft, setRowDraft, loadedName, setLoadedName, snapshot, restore,
  }
}
