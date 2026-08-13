import { batch, createEffect, createResource, createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import { Alert, Checkbox, createArmedConfirm, EmptyState, Input, ListDetail, Picker, Row, Toolbar } from '@acorn/plugin-api/ui'
import type { AcornBridge } from '@acorn/plugin-api/ui/sdk'
import type { DbCell, DbColumn, DbResultSet, DbSavedQuery, DbTable } from '../shared/database'
import {
  connectDb,
  deleteRow,
  deleteSavedQuery,
  disconnectDb,
  insertRow,
  listColumns,
  listModelConnections,
  listRows,
  listSavedQueries,
  listTables,
  runQuery,
  updateCell,
} from './databaseClient'
import { filterSavedQueries, quoteIdentifier, savedQueryLabel } from './databaseModel'
import GenerateSqlModal from './GenerateSqlModal'
import ResultGrid from './ResultGrid'
import SaveQueryModal from './SaveQueryModal'

// The Database pane's plugin half: a searchable table list, the button bar, a virtualized results grid,
// and a row-detail panel that doubles as the edit/insert/delete surface.
//
// WHAT IS NOT HERE ANY MORE, which is the entire point of the move: the SQL editor. It is the host's, in
// the region above this frame, and this file reaches it through three bridge methods —
// `document.read()` behind Execute, `document.write()` when the picker or Generate loads a query in, and
// `document.flush()` which the host has already called by the time a surface action arrives. Gone with
// it: `monaco.editor.create` and its options, the theme application, the appearance subscription for it,
// the ⌘Enter `addCommand`, the splitter signal and its pointer handlers, and 7.9 MiB of editor this
// bundle would otherwise have had to carry without language services.
//
// ⌘Enter still runs the query, and that is the acceptance test for the whole design: the chord is
// pressed with focus in the host's editor, where this frame has no keyboard at all. The host resolves it
// against the manifest's surface-scoped keybinding, flushes the document, and posts `execute` here —
// which is handled below exactly as the Execute button's click is, because the frame does not care which
// one it was.

type Selected = { schema: string; name: string } | null

export default function DatabasePanel(props: { bridge: AcornBridge; taskId: string }) {
  const [status, setStatus] = createSignal<'connecting' | 'connected' | 'error'>('connecting')
  const [dbName, setDbName] = createSignal('')
  const [error, setError] = createSignal('')
  const [tables, setTables] = createSignal<DbTable[]>([])
  const [filter, setFilter] = createSignal('')
  const [selected, setSelected] = createSignal<Selected>(null)
  const [columns, setColumns] = createSignal<DbColumn[]>([]) // of the selected table (drives editing/PK)
  const [result, setResult] = createSignal<DbResultSet | null>(null)
  const [resultTable, setResultTable] = createSignal<Selected>(null) // table the grid rows belong to (null = ad-hoc SQL)
  const [footer, setFooter] = createSignal('')
  const [activeRow, setActiveRow] = createSignal<number | null>(null)
  const [inserting, setInserting] = createSignal(false)
  const [busy, setBusy] = createSignal(false)
  // The armed button is the prompt; this used to be written into the error banner.
  const deleteArmed = createArmedConfirm()
  const [generating, setGenerating] = createSignal(false)
  const [saving, setSaving] = createSignal<string | null>(null) // the SQL being saved (null = modal closed)

  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e))

  // AI SQL generation is offered only when a model-provider key is connected. Read from this plugin's own
  // route, because a frame cannot see core's integrations — see databaseClient.ts.
  const [modelConnections] = createResource(
    () => props.taskId,
    (taskId) => listModelConnections(taskId).catch(() => []),
  )
  const connections = () => modelConnections() ?? []

  // Saved queries are project-scoped, so they outlive this task; the route resolves the project from the
  // task id. Failures surface in the pane's error line rather than rejecting — a resource in an error
  // state re-throws on read, which would take the whole panel down over a missing list of snippets.
  const [saved, { refetch: refetchSaved }] = createResource(
    () => props.taskId,
    (taskId) => listSavedQueries(taskId).catch((e: unknown) => (fail(e), [] as DbSavedQuery[])),
  )
  const savedList = (): DbSavedQuery[] => saved() ?? []
  // The name a Save would default to: whatever was last loaded, so load → tweak → Save updates in place.
  const [loadedName, setLoadedName] = createSignal('')
  const matchSaved = (query: string) => filterSavedQueries(savedList(), query)
  const deleteSaved = async (q: DbSavedQuery) => {
    try {
      await deleteSavedQuery(props.taskId, q.id)
    } catch (e) {
      return fail(e)
    }
    if (loadedName() === q.name) setLoadedName('')
    await refetchSaved()
  }

  const filtered = () => {
    const q = filter().trim().toLowerCase()
    const list = tables()
    return q ? list.filter((t) => `${t.schema}.${t.name}`.toLowerCase().includes(q)) : list
  }

  // The shared document, written through the host. Every one of these used to be `editor.setValue(…)`.
  const writeSql = (sql: string) => void props.bridge.document.write(sql).catch(fail)

  async function connect() {
    setStatus('connecting')
    setError('')
    const res = await connectDb(props.taskId).catch((e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }))
    if (!res.ok) return setStatus('error'), setError(res.error)
    setDbName(res.database)
    setStatus('connected')
    void loadTables()
  }

  async function loadTables() {
    const res = await listTables(props.taskId)
    if ('error' in res) return setError(res.error)
    setTables(res.tables)
  }

  async function openTable(t: DbTable) {
    if (busy()) return
    setBusy(true)
    try {
      batch(() => {
        setSelected(t)
        setActiveRow(null)
      })
      const cols = await listColumns(props.taskId, t.schema, t.name)
      setColumns('error' in cols ? [] : cols.columns)
      const rows = await listRows(props.taskId, t.schema, t.name)
      if ('error' in rows) return setError(rows.error)
      batch(() => {
        setResult({ columns: rows.columns, rows: rows.rows, rowCount: rows.rowCount, command: rows.command })
        setResultTable(t)
        setFooter(`${rows.rows.length} of ${rows.total ?? '?'} rows`)
        setError('')
      })
      writeSql(`SELECT * FROM ${quoteIdentifier(t.schema)}.${quoteIdentifier(t.name)} LIMIT 500;`)
    } finally {
      setBusy(false)
    }
  }

  async function execute() {
    if (busy()) return
    // The document as the reader currently sees it, including keystrokes the host's autosave has not
    // written yet. When this ran from ⌘Enter the host has already flushed, so the plugin's own scratch
    // route agrees with what comes back here.
    const sql = (await props.bridge.document.read().catch(() => '')).trim()
    if (!sql) return
    setBusy(true)
    try {
      const res = await runQuery(props.taskId, sql)
      if ('error' in res) {
        batch(() => { setError(res.error); setFooter('') })
        return
      }
      batch(() => {
        setResult({ columns: res.columns, rows: res.rows, rowCount: res.rowCount, command: res.command })
        setResultTable(null) // ad-hoc query → rows aren't tied to one table, so no row editing
        setActiveRow(null)
        setError('')
        setFooter(`${res.command || 'OK'} · ${res.rows.length ? `${res.rows.length} rows` : `${res.rowCount ?? 0} affected`} · ${res.ms}ms`)
      })
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  // After a write, re-open the current table to reflect it.
  async function reloadTable() {
    const t = resultTable()
    if (t) await openTable(t)
  }

  const primaryKey = (): Record<string, DbCell> => {
    const set = result()
    const index = activeRow()
    if (!set || index === null) return {}
    return Object.fromEntries(columns().filter((c) => c.isPk).map((c) => [c.name, set.rows[index][set.columns.indexOf(c.name)]]))
  }

  onMount(() => {
    // The host's half of a composed pane resolved a surface-scoped chord and sent it across. There is
    // one command today; the switch is here rather than an `if` because a second one is a manifest row
    // and this is where it would land.
    onCleanup(props.bridge.onSurfaceAction((command) => {
      if (command === 'execute') void execute()
    }))
    void connect()
  })
  onCleanup(() => void disconnectDb(props.taskId).catch(() => {}))

  // Loading a saved query is the picker's whole job, and it writes into the host's editor. Kept as an
  // effect-free handler rather than a signal→document sync, because the document is not this frame's
  // state — it is a thing on the other side of the port that the reader may also be typing into.
  const loadSaved = (q: DbSavedQuery) => {
    writeSql(q.sql)
    setLoadedName(q.name)
  }

  return (
    <section class="db-frame">
      <div class="section-header db-head">
        <span>Database</span>
        <span class="db-status" classList={{ err: status() === 'error', ok: status() === 'connected' }}>
          {status() === 'connected' ? dbName() || 'connected' : status() === 'connecting' ? 'connecting…' : 'error'}
        </span>
        <button type="button" class="db-icon-btn" title="Reconnect" onClick={() => void connect()}>⟳</button>
      </div>

      <Show when={error()}>
        <Alert class="db-error">{error()}</Alert>
      </Show>

      <ListDetail
        listLabel="Tables"
        list={
          <>
            <Input class="db-filter" kind="filter" placeholder="Filter tables…" value={filter()} onInput={(e) => setFilter(e.currentTarget.value)} />
            <div class="db-table-list">
              <For each={filtered()} fallback={<EmptyState align="start">{status() === 'connected' ? 'No tables.' : ''}</EmptyState>}>
                {(t) => (
                  <Row
                    density="compact"
                    selected={selected()?.schema === t.schema && selected()?.name === t.name}
                    onActivate={() => void openTable(t)}
                    title={`${t.schema}.${t.name}`}
                  >
                    {t.schema === 'public' ? t.name : `${t.schema}.${t.name}`}
                  </Row>
                )}
              </For>
            </div>
          </>
        }
      >
        {/* The bar moved from above the splitter to below it, and that is the only visible change the
            move makes to this pane. It stays the PLUGIN's because it is a searchable picker with
            per-row delete chips and a conditionally-visible button — common, not impossible, which is
            the bar a host-drawn region has to clear (docs/plugins.md § Document surfaces). */}
        <Toolbar class="db-editor-bar" variant="actions" ariaLabel="Query actions">
          <span class="muted db-hint">⌘↵ to run</span>
          <Picker<DbSavedQuery>
            label={loadedName() || 'Queries'}
            placeholder="Filter saved queries…"
            emptyText="No saved queries yet."
            buttonClass="db-run-btn"
            results={matchSaved}
            // Notes are searchable, so show their first line to explain why a row matched.
            rowLabel={savedQueryLabel}
            isActive={(q) => q.name === loadedName()}
            leading={(q) => (
              <button type="button" class="db-chip-x" title="Delete query" onClick={() => void deleteSaved(q)}>✕</button>
            )}
            onSelect={loadSaved}
          />
          {/* The editor's content is on the other side of a port, so this cannot be
              disabled-when-empty without polling it — an empty document just makes the click a
              no-op. Same trade the compiled version made against a Monaco model that was not a signal. */}
          <button
            type="button"
            class="db-run-btn"
            onClick={() => void props.bridge.document.read().then((sql) => sql.trim() && setSaving(sql.trim()), fail)}
          >
            Save
          </button>
          <Show when={connections().length}>
            <button type="button" class="db-run-btn" disabled={busy() || status() !== 'connected'} onClick={() => setGenerating(true)}>Generate</button>
          </Show>
          <button type="button" class="db-run-btn" disabled={busy() || status() !== 'connected'} onClick={() => void execute()}>Execute</button>
        </Toolbar>

        <div class="db-result">
          <Toolbar class="db-result-bar" size="sm" ariaLabel="Result actions">
            <span class="db-footer">{footer()}</span>
            <Show when={resultTable() && columns().some((c) => c.isPk)}>
              <button type="button" class="db-icon-btn" title="Insert row" disabled={busy()} onClick={() => setInserting(true)}>+ Row</button>
            </Show>
          </Toolbar>
          <Show when={result()} fallback={<EmptyState align="start">Select a table or run a query.</EmptyState>}>
            {(r) => (
              <ResultGrid
                columns={r().columns}
                rows={r().rows}
                activeRow={activeRow()}
                onRowClick={(i) => batch(() => { setInserting(false); setActiveRow(i) })}
                onAppearance={(listener) => props.bridge.onAppearance(() => listener())}
              />
            )}
          </Show>
        </div>

        <Show when={inserting() && resultTable()}>
          <RowDetail
            insert
            columns={result()?.columns ?? columns().map((c) => c.name)}
            row={[]}
            table={resultTable()}
            meta={columns()}
            busy={busy()}
            onClose={() => setInserting(false)}
            onInsert={async (values) => {
              const t = resultTable()
              if (!t) return
              setBusy(true)
              try {
                const res = await insertRow(props.taskId, t.schema, t.name, values)
                if (!res.ok) { setError(res.error); return }
                batch(() => { setInserting(false); setError('') })
                await reloadTable()
              } catch (e) {
                fail(e)
              } finally {
                setBusy(false)
              }
            }}
          />
        </Show>

        <Show when={!inserting() && activeRow() !== null && result()}>
          <RowDetail
            columns={result()!.columns}
            row={result()!.rows[activeRow()!]}
            table={resultTable()}
            meta={columns()}
            busy={busy()}
            onClose={() => { setActiveRow(null); deleteArmed.disarm() }}
            onSave={async (edits) => {
              const t = resultTable()
              if (!t) return
              const pk = primaryKey()
              setBusy(true)
              try {
                for (const [col, val] of edits) {
                  const res = await updateCell(props.taskId, t.schema, t.name, col, val, pk)
                  if (!res.ok) { setError(res.error); return }
                }
                setError('')
                await reloadTable()
              } catch (e) {
                fail(e)
              } finally {
                setBusy(false)
              }
            }}
            deleteArmed={!!deleteArmed.armed()}
            onDelete={async () => {
              const t = resultTable()
              if (!t) return
              if (!deleteArmed.request('row')) return
              const pk = primaryKey()
              setBusy(true)
              try {
                const res = await deleteRow(props.taskId, t.schema, t.name, pk)
                if (!res.ok) { setError(res.error); return }
                setActiveRow(null)
                setError('')
                await reloadTable()
              } catch (e) {
                fail(e)
              } finally {
                setBusy(false)
              }
            }}
          />
        </Show>

        <Show when={generating()}>
          <GenerateSqlModal
            taskId={props.taskId}
            connections={connections()}
            queries={savedList()}
            onClose={() => setGenerating(false)}
            onGenerated={writeSql}
          />
        </Show>

        <Show when={saving() !== null}>
          <SaveQueryModal
            taskId={props.taskId}
            sql={saving() ?? ''}
            name={loadedName()}
            existing={savedList()}
            onClose={() => setSaving(null)}
            onSaved={(q) => { setLoadedName(q.name); void refetchSaved() }}
          />
        </Show>
      </ListDetail>
    </section>
  )
}

// Row viewer + editor: column→value fields; editable when the rows belong to a single table with a
// primary key (ad-hoc SQL results are read-only). Save commits changed columns; Delete removes by PK. In
// `insert` mode the fields start blank and Save inserts a new row.
function RowDetail(props: {
  insert?: boolean
  columns: string[]
  row: DbCell[]
  table: Selected
  meta: DbColumn[]
  busy: boolean
  onClose: () => void
  onSave?: (edits: [string, DbCell][]) => void | Promise<void>
  onDelete?: () => void | Promise<void>
  deleteArmed?: boolean
  onInsert?: (values: Record<string, DbCell>) => void | Promise<void>
}) {
  const metaByName = new Map(props.meta.map((c) => [c.name, c]))
  const editable = () => !!props.table && props.meta.some((c) => c.isPk)
  // Draft state per column: value + explicit-null flag. Edit mode seeds from the row; insert mode
  // starts every column null (so untouched columns take their DB default / are omitted).
  const [draft, setDraft] = createSignal<Record<string, { value: string; isNull: boolean }>>(
    Object.fromEntries(props.columns.map((c, i) => [c, props.insert ? { value: '', isNull: true } : { value: props.row[i] ?? '', isNull: props.row[i] === null }])),
  )
  // Reseed when the reader clicks a different row: the component is reused rather than remounted, so
  // without this the draft would still hold the previous row's values.
  createEffect(() => {
    const columns = props.columns
    const row = props.row
    setDraft(Object.fromEntries(columns.map((c, i) => [c, props.insert ? { value: '', isNull: true } : { value: row[i] ?? '', isNull: row[i] === null }])))
  })
  const set = (col: string, patch: Partial<{ value: string; isNull: boolean }>) =>
    setDraft((d) => ({ ...d, [col]: { ...d[col], ...patch } }))

  const save = () => {
    const d = draft()
    if (props.insert) {
      // Only send columns the user actually set (non-null) — everything else takes its DB default.
      const values: Record<string, DbCell> = {}
      for (const c of props.columns) if (!d[c].isNull) values[c] = d[c].value
      void props.onInsert?.(values)
      return
    }
    const edits: [string, DbCell][] = []
    props.columns.forEach((c, i) => {
      const cur: DbCell = d[c].isNull ? null : d[c].value
      const orig = props.row[i]
      if (cur !== orig) edits.push([c, cur])
    })
    if (edits.length) void props.onSave?.(edits)
  }

  return (
    <aside class="db-detail">
      <div class="db-detail-head">
        <span>{props.insert ? `${props.table?.name ?? ''} · new row` : props.table ? `${props.table.name} · row` : 'Row'}</span>
        <button type="button" class="db-icon-btn" title="Close" onClick={props.onClose}>✕</button>
      </div>
      <div class="db-detail-fields">
        <For each={props.columns}>
          {(col) => {
            const m = metaByName.get(col)
            return (
              <label class="db-field">
                <span class="db-field-label">
                  {col}
                  <Show when={m?.isPk}><em class="db-pk">PK</em></Show>
                  <span class="db-field-type">{m?.dataType}</span>
                </span>
                <textarea
                  class="db-field-input"
                  rows="1"
                  spellcheck={false}
                  disabled={!editable() || draft()[col]?.isNull}
                  value={draft()[col]?.isNull ? '' : draft()[col]?.value ?? ''}
                  placeholder={draft()[col]?.isNull ? 'NULL' : ''}
                  onInput={(e) => set(col, { value: e.currentTarget.value })}
                />
                {/* Insert mode always offers the null toggle (columns start null so untouched ones
                    take their DB default); edit mode only for nullable columns. */}
                <Show when={editable() && (props.insert || (m?.nullable ?? true))}>
                  <label class="db-null-toggle">
                    <Checkbox label="null" checked={draft()[col]?.isNull} onChange={(e) => set(col, { isNull: e.currentTarget.checked })} />
                  </label>
                </Show>
              </label>
            )
          }}
        </For>
      </div>
      <div class="db-detail-actions">
        <Show when={editable()} fallback={<span class="muted db-hint">Read-only (no single-table PK).</span>}>
          <button type="button" class="db-run-btn" disabled={props.busy} onClick={save}>Save</button>
          <Show when={!props.insert}>
            <button type="button" class="db-del-btn" data-armed={props.deleteArmed ? '' : undefined} disabled={props.busy} onClick={() => void props.onDelete?.()}>{props.deleteArmed ? 'Delete?' : 'Delete'}</button>
          </Show>
        </Show>
      </div>
    </aside>
  )
}
