import { batch, createEffect, createResource, createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import {
  Alert, Button, Checkbox, createArmedConfirm, DetailColumn, EmptyState, Grid, Input, Inline,
  ListColumn, ListDetail, Picker, Row, SectionHeader, Stack, Text, Textarea, Toolbar, ToolbarSpacer,
} from '@acorn/plugin-api/ui/tree'
import type { AcornBridge } from '@acorn/plugin-api/ui/sdk'
import type { DbCell, DbColumn, DbResultSet, DbSavedQuery, DbTable } from '../shared/database'
import { SCRATCH_SELECT_ID } from '../shared/database'
import {
  connectDb,
  deleteRow,
  deleteSavedQuery,
  disconnectDb,
  insertRow,
  listColumns,
  listModelBackends,
  listRows,
  listSavedQueries,
  listTables,
  readScratch,
  runQuery,
  updateCell,
} from './databaseClient'
import { quoteIdentifier, savedQueryLabel } from './databaseModel'
import GenerateSqlModal from './GenerateSqlModal'
import SaveQueryModal from './SaveQueryModal'

// The Database pane's plugin half: a searchable table list, the button bar, a virtualized results grid,
// and a row-detail panel that doubles as the edit/insert/delete surface.
//
// The SQL editor lives in the host, in the region above this frame (docs/editor.md §
// Composed panes: decided). This file reaches it through three bridge methods: `document.read()`
// behind Execute, `document.write()` when the picker or Generate loads a query in, and
// `document.flush()`, which the host has already called by the time a surface action arrives.
//
// ⌘Enter runs the query even though it is pressed with focus in the host's editor, where this plugin
// has no keyboard. The host resolves it against the manifest's surface-scoped keybinding, flushes the
// document, and posts `execute` here, handled below exactly as the Execute button's click is.
//
// The results grid is the kit's `Grid` now, not a virtualizer this plugin shipped. It was the same
// component twice — a sticky header, a fixed row height read from the density token, an overscan of
// sixteen — and one of the two had to go.

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
  const deleteArmed = createArmedConfirm()
  const [generating, setGenerating] = createSignal(false)
  const [saving, setSaving] = createSignal<string | null>(null) // the SQL being saved (null = modal closed)

  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e))

  // AI SQL generation is offered only when there is something to spend: a connected model-provider
  // key, or an agent CLI installed on this machine. Read from this plugin's own route, because a frame
  // cannot see core's integrations. See databaseClient.ts.
  const [modelBackends] = createResource(
    () => props.taskId,
    (taskId) => listModelBackends(taskId).catch(() => []),
  )
  const backends = () => modelBackends() ?? []

  // Saved queries are project-scoped, so they outlive this task, and the route resolves the project
  // from the task id. Failures land in the pane's error line rather than rejecting: a resource in an
  // error state re-throws on read, taking the whole panel down over a missing list of snippets.
  const [saved, { refetch: refetchSaved }] = createResource(
    () => props.taskId,
    (taskId) => listSavedQueries(taskId).catch((e: unknown) => (fail(e), [] as DbSavedQuery[])),
  )
  const savedList = (): DbSavedQuery[] => saved() ?? []
  // The name a Save would default to: whatever was last loaded, so load → tweak → Save updates in place.
  const [loadedName, setLoadedName] = createSignal('')
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

  // The shared document, written through the host.
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
    // The document as the reader sees it, including keystrokes the host's autosave has not written.
    // On the ⌘Enter path the host has already flushed, so the plugin's scratch route agrees with this.
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

  // What the palette picked, when it picked something. Two ids arrive on this channel and they are two
  // different questions: a saved query's own id, which loads that query, and the scratch sentinel,
  // which the `Generate SQL` command sends because it wrote the document on the node and this pane may
  // already have loaded the old text (../shared/database.ts).
  //
  // A signal rather than acting on arrival, because a saved-query id can land before the list it names:
  // the pane opens and the row and the list are two round trips racing each other.
  const [requested, setRequested] = createSignal<string | undefined>()

  onMount(() => {
    // The host's half of a composed pane resolved a surface-scoped chord and sent it across. There is
    // one command today; the switch is here rather than an `if` because a second one is a manifest row
    // and this is where it would land.
    onCleanup(props.bridge.onSurfaceAction((command) => {
      if (command === 'execute') void execute()
    }))
    // The selection that opened this pane rides in `context`; every later one is a message
    // (docs/plugins.md § The tree contract). Both land in the same signal.
    setRequested(props.bridge.context.item)
    onCleanup(props.bridge.onSelect((item) => setRequested(item)))
    void connect()
  })
  onCleanup(() => void disconnectDb(props.taskId).catch(() => {}))

  // Loading a saved query is the picker's whole job, and it writes into the host's editor. Kept as an
  // effect-free handler rather than a signal→document sync, because the document is not this frame's
  // state. It is a thing on the other side of the port that the reader may also be typing into.
  const loadSaved = (q: DbSavedQuery) => {
    writeSql(q.sql)
    setLoadedName(q.name)
  }

  createEffect(() => {
    const id = requested()
    if (!id) return
    if (id === SCRATCH_SELECT_ID) {
      setRequested(undefined)
      // Read the row, not the editor: this runs because the node wrote SQL the editor has not seen.
      // Loading a generated query is not running it, exactly as picking a saved one is not.
      void readScratch(props.taskId).then((sql) => sql && writeSql(sql), fail)
      return
    }
    const q = savedList().find((candidate) => candidate.id === id)
    if (!q) return
    setRequested(undefined)
    loadSaved(q)
  })

  return (
    <Stack gap="row">
      <Toolbar variant="bar" size="sm" ariaLabel="Connection">
        <SectionHeader>Database</SectionHeader>
        <Text tone={status() === 'error' ? 'danger' : status() === 'connected' ? 'ok' : 'muted'}>
          {status() === 'connected' ? dbName() || 'connected' : status() === 'connecting' ? 'connecting…' : 'error'}
        </Text>
        <ToolbarSpacer />
        <Button size="sm" title="Reconnect" label="Reconnect" onPress={() => void connect()}>⟳</Button>
      </Toolbar>

      <Show when={error()}>
        <Alert>{error()}</Alert>
      </Show>

      <ListDetail split listLabel="Tables">
        <ListColumn label="Tables">
          <Input kind="filter" placeholder="Filter tables…" value={filter()} onChange={(value: string) => setFilter(value)} />
          <For each={filtered()} fallback={<EmptyState align="start">{status() === 'connected' ? 'No tables.' : ''}</EmptyState>}>
            {(t) => (
              <Row
                density="compact"
                selected={selected()?.schema === t.schema && selected()?.name === t.name}
                onPress={() => void openTable(t)}
                title={`${t.schema}.${t.name}`}
              >
                {t.schema === 'public' ? t.name : `${t.schema}.${t.name}`}
              </Row>
            )}
          </For>
        </ListColumn>

        <DetailColumn>
          {/* The bar sits below the splitter. It stays the PLUGIN's because it is a searchable picker
              with per-row delete controls and a conditionally-visible button — common, not impossible,
              which is the bar a host-drawn region has to clear (docs/plugins.md § Document surfaces). */}
          <Toolbar variant="actions" ariaLabel="Query actions">
            <Text tone="muted">⌘↵ to run</Text>
            {/* The data form of the picker: rows as items, filtering in the host. A tree cannot hand
                over a `results(query)` callback, because a function does not cross a message port. */}
            <Picker
              label={loadedName() || 'Queries'}
              placeholder="Filter saved queries…"
              emptyText="No saved queries yet."
              items={savedList().map((q) => ({
                id: q.id,
                label: savedQueryLabel(q),
                active: q.name === loadedName(),
                removable: true,
              }))}
              onPick={(id: string) => {
                const q = savedList().find((candidate) => candidate.id === id)
                if (q) loadSaved(q)
              }}
              onRemove={(id: string) => {
                const q = savedList().find((candidate) => candidate.id === id)
                if (q) void deleteSaved(q)
              }}
            />
            {/* The editor's content is on the other side of a port, so this cannot be
                disabled-when-empty without polling it — an empty document just makes the click a
                no-op. Same trade the compiled version made against an editor document that was not a signal. */}
            <Button
              variant="solid"
              onPress={() => void props.bridge.document.read().then((sql) => sql.trim() && setSaving(sql.trim()), fail)}
            >
              Save
            </Button>
            <Show when={backends().length}>
              <Button variant="solid" disabled={busy() || status() !== 'connected'} onPress={() => setGenerating(true)}>Generate</Button>
            </Show>
            <Button variant="solid" disabled={busy() || status() !== 'connected'} onPress={() => void execute()}>Execute</Button>
          </Toolbar>

          <Toolbar size="sm" ariaLabel="Result actions">
            <Text tone="muted">{footer()}</Text>
            <ToolbarSpacer />
            <Show when={resultTable() && columns().some((c) => c.isPk)}>
              <Button size="sm" disabled={busy()} onPress={() => setInserting(true)}>+ Row</Button>
            </Show>
          </Toolbar>
          <Show when={result()} fallback={<EmptyState align="start">Select a table or run a query.</EmptyState>}>
            {(r) => (
              <Grid
                ariaLabel="Query results"
                columns={r().columns}
                // The kit's Grid takes strings, so a SQL NULL is spelled here rather than styled. It was
                // a dimmed cell with a class; it is the word now, which is what the terminal projection
                // of this node says anyway.
                rows={r().rows.map((row) => row.map((cell) => cell ?? 'NULL'))}
                selected={activeRow()}
                onSelect={(i: number) => batch(() => { setInserting(false); setActiveRow(i) })}
              />
            )}
          </Show>

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
              backends={backends()}
              queries={savedList()}
              onDismiss={() => setGenerating(false)}
              onGenerated={writeSql}
            />
          </Show>

          <Show when={saving() !== null}>
            <SaveQueryModal
              taskId={props.taskId}
              sql={saving() ?? ''}
              name={loadedName()}
              existing={savedList()}
              onDismiss={() => setSaving(null)}
              onSaved={(q) => { setLoadedName(q.name); void refetchSaved() }}
            />
          </Show>
        </DetailColumn>
      </ListDetail>
    </Stack>
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
      // Only send columns the user actually set (non-null); everything else takes its DB default.
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
    <Stack gap="row">
      <Toolbar variant="bar" size="sm">
        <SectionHeader>
          {props.insert ? `${props.table?.name ?? ''} · new row` : props.table ? `${props.table.name} · row` : 'Row'}
        </SectionHeader>
        <ToolbarSpacer />
        <Button size="sm" title="Close" label="Close" onPress={props.onClose}>✕</Button>
      </Toolbar>
      <For each={props.columns}>
        {(col) => {
          const m = metaByName.get(col)
          return (
            <Stack gap="none">
              <Inline>
                <Text emphasis="eyebrow">{col}</Text>
                <Show when={m?.isPk}><Text emphasis="eyebrow" tone="accent">PK</Text></Show>
                <Text tone="muted">{m?.dataType}</Text>
              </Inline>
              <Textarea
                rows={1}
                assist={false}
                disabled={!editable() || draft()[col]?.isNull}
                value={draft()[col]?.isNull ? '' : draft()[col]?.value ?? ''}
                placeholder={draft()[col]?.isNull ? 'NULL' : ''}
                onChange={(value: string) => set(col, { value })}
              />
              {/* Insert mode always offers the null toggle (columns start null so untouched ones take
                  their DB default); edit mode only for nullable columns. */}
              <Show when={editable() && (props.insert || (m?.nullable ?? true))}>
                <Checkbox label="null" checked={draft()[col]?.isNull} onChange={(checked: boolean) => set(col, { isNull: checked })} />
              </Show>
            </Stack>
          )
        }}
      </For>
      <Toolbar variant="actions" size="sm">
        <Show when={editable()} fallback={<Text tone="muted">Read-only (no single-table PK).</Text>}>
          <Button variant="solid" disabled={props.busy} onPress={save}>Save</Button>
          <Show when={!props.insert}>
            <Button tone="danger" disabled={props.busy} onPress={() => void props.onDelete?.()}>{props.deleteArmed ? 'Delete?' : 'Delete'}</Button>
          </Show>
        </Show>
      </Toolbar>
    </Stack>
  )
}
