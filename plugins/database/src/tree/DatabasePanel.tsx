import { batch, createEffect, createResource, createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import {
  Alert, Badge, Button, Checkbox, ConfirmButton, DetailColumn, EmptyState, Field, formatChord, Grid, Heading,
  IconButton, Input, ListColumn, ListDetail, Picker, Row, SectionHeader, Stack, Text, Textarea, Toolbar, ToolbarSpacer,
} from '@acorn/plugin-api/ui/tree'
import type { AcornBridge } from '@acorn/plugin-api/ui/sdk'
import type { DbCell, DbColumn, DbResultSet, DbSavedQuery, DbTable } from '../shared/database'
import { SCRATCH_SELECT_ID } from '../shared/database'
import { createDatabaseClient } from './databaseClient'
import { quoteIdentifier, savedQueryLabel } from './databaseModel'
import GenerateSqlModal from './GenerateSqlModal'
import SaveQueryModal from './SaveQueryModal'

// The Database pane's plugin half: a searchable table list, the button bar, a virtualized results grid,
// and a row-detail panel that doubles as the edit/insert/delete surface.
//
// The SQL editor lives in the host, in the region above this frame (docs/editor/composed-panes.md §
// Composed panes: decided). This file reaches it through three bridge methods: `document.read()`
// behind Run, `document.write()` when the picker or Generate loads a query in, and
// `document.flush()`, which Run also calls before reading the current SQL.
//
// ⌘Enter runs the query even though it is pressed with focus in the host's editor, where this plugin
// has no keyboard. The host resolves it against the manifest's surface-scoped keybinding, flushes the
// document, and posts `execute` here, handled below exactly as the Run button's click is.
//
// The results grid is the kit's `Grid` now, not a virtualizer this plugin shipped. It was the same
// component twice — a sticky header, a fixed row height read from the density token, an overscan of
// sixteen — and one of the two had to go.

type Selected = { schema: string; name: string } | null

const count = (n: number): string => new Intl.NumberFormat().format(n)

export default function DatabasePanel(props: { bridge: AcornBridge; taskId: string }) {
  const client = createDatabaseClient(props.bridge.api)
  const { connectDb, deleteRow, deleteSavedQuery, disconnectDb, insertRow, listColumns, listModelBackends, listRows, listSavedQueries, listTables, readScratch, runQuery, updateCell } = client
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
  const [generating, setGenerating] = createSignal<{ expectedText: string; generation: number }>()
  const [saving, setSaving] = createSignal<string | null>(null) // the SQL being saved (null = modal closed)

  let disposed = false
  let selectionGeneration = 0
  onCleanup(() => { disposed = true; selectionGeneration++ })

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
  const writeSql = (sql: string) => {
    selectionGeneration++
    return props.bridge.document.write(sql)
  }

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
    const generation = ++selectionGeneration
    setBusy(true)
    try {
      // Browsing rows remains available even when the sibling document is in recovery.
      const expectedText = await props.bridge.document.read().catch((cause: unknown) => { fail(cause); return undefined })
      if (disposed || generation !== selectionGeneration) return
      batch(() => {
        setSelected(t)
        setActiveRow(null)
      })
      const cols = await listColumns(props.taskId, t.schema, t.name)
      if (disposed || generation !== selectionGeneration) return
      setColumns('error' in cols ? [] : cols.columns)
      const rows = await listRows(props.taskId, t.schema, t.name)
      if (disposed || generation !== selectionGeneration) return
      if ('error' in rows) return setError(rows.error)
      batch(() => {
        setResult({ columns: rows.columns, rows: rows.rows, rowCount: rows.rowCount, command: rows.command })
        setResultTable(t)
        setFooter(`${count(rows.rows.length)} of ${rows.total == null ? '?' : count(rows.total)} rows`)
        setError('')
      })
      if (expectedText !== undefined && !disposed && generation === selectionGeneration) {
        await props.bridge.document.write(`SELECT * FROM ${quoteIdentifier(t.schema)}.${quoteIdentifier(t.name)} LIMIT 500;`, { expectedText })
      }
    } catch (e) {
      if (!disposed) fail(e)
    } finally {
      setBusy(false)
    }
  }

  async function execute() {
    if (busy()) return
    setBusy(true)
    try {
      await props.bridge.document.flush()
      if (disposed) return
      const sql = (await props.bridge.document.read()).trim()
      if (disposed || !sql) return
      const res = await runQuery(props.taskId, sql)
      if ('error' in res) {
        batch(() => { setError(res.error); setFooter('') })
        return
      }
      batch(() => {
        setResult({ columns: res.columns, rows: res.rows, rowCount: res.rowCount, command: res.command })
        setResultTable(null) // ad-hoc query → rows aren't tied to one table, so no row editing
        // The grid shows the query's rows now, so the list no longer marks the table opened before, and
        // the row editor no longer describes the query's columns with that table's types.
        setSelected(null)
        setColumns([])
        setActiveRow(null)
        setError('')
        setFooter(`${res.command || 'OK'} · ${res.rows.length ? `${count(res.rows.length)} rows` : `${count(res.rowCount ?? 0)} affected`} · ${res.ms}ms`)
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
    onCleanup(props.bridge.onSelect((item) => { selectionGeneration++; setRequested(item) }))
    void connect()
  })
  onCleanup(() => void disconnectDb(props.taskId).catch(() => {}))

  // Loading a saved query is the picker's whole job, and it writes into the host's editor. Kept as an
  // effect-free handler rather than a signal→document sync, because the document is not this frame's
  // state. It is a thing on the other side of the port that the reader may also be typing into.
  const loadSaved = (q: DbSavedQuery) => {
    const write = writeSql(q.sql)
    const generation = selectionGeneration
    void write.then(() => { if (!disposed && generation === selectionGeneration) setLoadedName(q.name) }).catch(fail)
  }

  createEffect(() => {
    const id = requested()
    if (!id) return
    if (id === SCRATCH_SELECT_ID) {
      setRequested(undefined)
      // Read the row, not the editor: this runs because the node wrote SQL the editor has not seen.
      // Loading a generated query is not running it, exactly as picking a saved one is not.
      const generation = ++selectionGeneration
      void (async () => {
        const expectedText = await props.bridge.document.read()
        const sql = await readScratch(props.taskId)
        if (disposed || generation !== selectionGeneration) return
        await props.bridge.document.write(sql, { expectedText })
      })().catch((cause: unknown) => { if (!disposed && generation === selectionGeneration) fail(cause) })
      return
    }
    const q = savedList().find((candidate) => candidate.id === id)
    if (!q) return
    setRequested(undefined)
    loadSaved(q)
  })

  const connected = () => status() === 'connected'

  // `grow`, so the frame's region gives the list and the grid their height and each scrolls inside
  // it. A plain stack grew past the region, which clipped the table list and the rows below the fold.
  return (
    <Stack gap="none" grow>
      {/* One bar: the pane's title, the connection, and every query action. It sits below the SQL
          editor because a document layout has no header region of its own yet. */}
      <Toolbar variant="bar" ariaLabel="Database">
        <Heading level={2}>Database</Heading>
        <Badge size="xs" tone={connected() ? 'ok' : status() === 'error' ? 'danger' : 'neutral'}>
          {connected() ? dbName() || 'Connected' : status() === 'connecting' ? 'Connecting…' : 'Not connected'}
        </Badge>
        <ToolbarSpacer />
        {/* The data form of the picker: rows as items, filtering in the host. A tree cannot hand
            over a `results(query)` callback, because a function does not cross a message port. The
            trigger keeps one name, so loading a query does not widen it. */}
        <Picker
          size="sm"
          label="Saved queries"
          placeholder="Filter saved queries…"
          emptyText="No saved queries. Use Save to keep the one in the editor."
          removeLabel="Delete saved query"
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
          size="sm"
          onPress={() => void props.bridge.document.read().then((sql) => sql.trim() && setSaving(sql.trim()), fail)}
        >
          Save
        </Button>
        <Show when={backends().length}>
          <Button size="sm" disabled={busy() || !connected()} onPress={() => {
            const generation = ++selectionGeneration
            void props.bridge.document.read().then((expectedText) => {
              if (!disposed && generation === selectionGeneration) setGenerating({ expectedText, generation })
            }, fail)
          }}>Generate</Button>
        </Show>
        <Button size="sm" variant="solid" tip="Run query" tipKey={formatChord('meta+enter')} disabled={busy() || !connected()} onPress={() => void execute()}>
          Run
        </Button>
        <IconButton size="sm" icon="refresh-cw" label="Reconnect" onPress={() => void connect()} />
      </Toolbar>

      <ListDetail split listLabel="Tables">
        <ListColumn label="Tables">
          <SectionHeader count={connected() ? tables().length : undefined}>Tables</SectionHeader>
          {/* With no connection there is nothing to list, and the detail column says why. */}
          <Show when={connected()}>
            <Toolbar size="sm" ariaLabel="Filter tables">
              <Input kind="filter" label="Filter tables" placeholder="Filter tables…" value={filter()} onChange={(value: string) => setFilter(value)} />
            </Toolbar>
            <For each={filtered()} fallback={<EmptyState align="start" size="sm">No tables</EmptyState>}>
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
          </Show>
        </ListColumn>

        <DetailColumn>
          {/* The not-configured error stays an alert until the node sends a code for it. */}
          <Show when={error()}>
            <Alert variant="banner">{error()}</Alert>
          </Show>

          <Show when={result()}>
            <Toolbar size="sm" ariaLabel="Result actions">
              <Text tone="muted">{footer()}</Text>
              <ToolbarSpacer />
              <Show when={resultTable() && columns().some((c) => c.isPk)}>
                <Button size="sm" variant="ghost" disabled={busy()} onPress={() => setInserting(true)}>Add row</Button>
              </Show>
            </Toolbar>
          </Show>
          <Show when={result()} fallback={<Show when={!error()}><EmptyState title="Choose a table, or run a query" /></Show>}>
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
              onClose={() => setActiveRow(null)}
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
              onDelete={async () => {
                const t = resultTable()
                if (!t) return
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
              client={client}
              taskId={props.taskId}
              backends={backends()}
              queries={savedList()}
              onDismiss={() => setGenerating(undefined)}
              onGenerated={(sql) => {
                const loading = generating()
                if (disposed || !loading || loading.generation !== selectionGeneration) throw new Error('The query selection changed while generating. Generate again.')
                return props.bridge.document.write(sql, { expectedText: loading.expectedText })
              }}
            />
          </Show>

          <Show when={saving() !== null}>
            <SaveQueryModal
              client={client}
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
        <Heading level={3}>
          {props.insert ? `New row in ${props.table?.name ?? ''}` : props.table ? `Row in ${props.table.name}` : 'Row'}
        </Heading>
        <ToolbarSpacer />
        <IconButton size="sm" icon="x" label="Close" onPress={props.onClose} />
      </Toolbar>
      <For each={props.columns}>
        {(col) => {
          const m = metaByName.get(col)
          return (
            <Stack gap="none">
              {/* The column's own name as the label, in its own case: `created_at`, not CREATED_AT.
                  The field names the textarea; the null box is a second control beside it. */}
              <Field label={col} hint={[m?.dataType, m?.isPk ? 'Primary key' : ''].filter(Boolean).join(' · ')}>
                <Textarea
                  rows={1}
                  assist={false}
                  disabled={!editable() || draft()[col]?.isNull}
                  value={draft()[col]?.isNull ? '' : draft()[col]?.value ?? ''}
                  placeholder={draft()[col]?.isNull ? 'NULL' : ''}
                  onChange={(value: string) => set(col, { value })}
                />
              </Field>
              {/* Insert mode always offers the null toggle (columns start null so untouched ones take
                  their DB default); edit mode only for nullable columns. */}
              <Show when={editable() && (props.insert || (m?.nullable ?? true))}>
                <Checkbox label="Set to NULL" checked={draft()[col]?.isNull} onChange={(checked: boolean) => set(col, { isNull: checked })} />
              </Show>
            </Stack>
          )
        }}
      </For>
      <Toolbar variant="actions" size="sm">
        <Show
          when={editable()}
          fallback={
            <Text tone="muted">
              {props.table ? "This table has no primary key, so its rows can't be edited here." : 'To edit a row, open its table from the list.'}
            </Text>
          }
        >
          <Button size="sm" variant="solid" disabled={props.busy} onPress={save}>Save</Button>
          <Show when={!props.insert}>
            {/* RowDetail stays mounted when selection changes. Remount the armed control with its
                row so a second press cannot delete a different row. */}
            <Show when={props.row} keyed>
              <ConfirmButton size="sm" tone="danger" disabled={props.busy} confirmLabel="Delete row?" onConfirm={() => void props.onDelete?.()}>
                Delete
              </ConfirmButton>
            </Show>
          </Show>
        </Show>
      </Toolbar>
    </Stack>
  )
}
