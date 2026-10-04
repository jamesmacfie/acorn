import { batch, createEffect, createResource, createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import {
  Alert, Badge, Button, DetailColumn, EmptyState, formatChord, Grid, Heading,
  IconButton, Input, ListColumn, ListDetail, Picker, Row, SectionHeader, Stack, Text, Toolbar, ToolbarSpacer,
} from '@acorn/plugin-api/ui/tree'
import type { AcornBridge } from '@acorn/plugin-api/ui/sdk'
import type { DbCell, DbSavedQuery, DbTable } from '../shared/database'
import { SCRATCH_SELECT_ID } from '../shared/database'
import { createDatabaseClient } from './databaseClient'
import { quoteIdentifier, savedQueryLabel } from './databaseModel'
import GenerateSqlModal from './GenerateSqlModal'
import SaveQueryModal from './SaveQueryModal'
import RowDetail from './RowDetail'
import { createDatabaseWorkspace, databaseWorkspace, loadDatabaseWorkspace, rememberDatabaseWorkspace, saveDatabaseWorkspace } from './databaseWorkspaceStore'

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
// The shared Grid owns virtualization and row geometry.

const count = (n: number): string => new Intl.NumberFormat().format(n)

export default function DatabasePanel(props: { bridge: AcornBridge; taskId: string }) {
  const client = createDatabaseClient(props.bridge.api)
  const { connectDb, deleteRow, deleteSavedQuery, disconnectDb, insertRow, listColumns, listModelBackends, listRows, listSavedQueries, listTables, readScratch, runQuery, updateCell } = client
  const nodeId = props.bridge.context.nodeId
  const restored = databaseWorkspace(nodeId, props.taskId)
  const [status, setStatus] = createSignal<'connecting' | 'connected' | 'error'>('connecting')
  const workspaceModel = createDatabaseWorkspace(restored)
  const {
    dbName, setDbName, tables, setTables, filter, setFilter, selected, setSelected, columns, setColumns,
    result, setResult, resultTable, setResultTable, footer, setFooter, activeRow, setActiveRow,
    inserting, setInserting, rowDraft, setRowDraft, loadedName, setLoadedName,
  } = workspaceModel
  const [error, setError] = createSignal('')
  const [busy, setBusy] = createSignal(false)
  const [generating, setGenerating] = createSignal<{ expectedText: string; generation: number }>()
  const [saving, setSaving] = createSignal<string | null>(null) // the SQL being saved (null = modal closed)

  const [restoredState, setRestoredState] = createSignal(!!restored)
  let userChanged = false
  let disposed = false
  let selectionGeneration = 0
  onCleanup(() => { disposed = true; selectionGeneration++ })

  const fail = (e: unknown) => { if (!disposed) setError(e instanceof Error ? e.message : String(e)) }

  // AI SQL generation is offered only when there is something to spend: a connected model-provider
  // key, or an agent CLI installed on this machine. Read from this plugin's own route, because a frame
  // cannot see core's integrations. See databaseClient.ts.
  const [modelBackends] = createResource(
    () => props.taskId,
    (taskId) => listModelBackends(taskId).catch(() => restored?.modelBackends ?? []),
    { initialValue: restored?.modelBackends ?? [] },
  )
  const backends = () => modelBackends() ?? []

  // Saved queries are project-scoped, so they outlive this task, and the route resolves the project
  // from the task id. Failures land in the pane's error line rather than rejecting: a resource in an
  // error state re-throws on read, taking the whole panel down over a missing list of snippets.
  const [saved, { refetch: refetchSaved, mutate: restoreSaved }] = createResource(
    () => props.taskId,
    (taskId) => listSavedQueries(taskId).catch((e: unknown) => (fail(e), restored?.savedQueries ?? [])),
    { initialValue: restored?.savedQueries ?? [] },
  )
  const savedList = (): DbSavedQuery[] => saved() ?? []
  // The name a Save would default to: whatever was last loaded, so load → tweak → Save updates in place.
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
    if (disposed) return
    if (!res.ok) return setStatus('error'), setError(res.error)
    if (dbName() && dbName() !== res.database) {
      batch(() => { setSelected(null); setColumns([]); setResult(null); setResultTable(null); setActiveRow(null); setRowDraft(null); setInserting(false); setFooter('') })
    }
    setDbName(res.database)
    setStatus('connected')
    await loadTables()
  }

  async function loadTables() {
    const res = await listTables(props.taskId).catch((cause: unknown) => ({ error: cause instanceof Error ? cause.message : String(cause) }))
    if (disposed) return
    if ('error' in res) return setError(res.error)
    setTables(res.tables)
  }

  async function openTable(t: DbTable) {
    if (busy() || disposed || status() !== 'connected') return
    userChanged = true
    const generation = ++selectionGeneration
    setBusy(true)
    try {
      // Browsing rows remains available even when the sibling document is in recovery.
      const expectedText = await props.bridge.document.read().catch((cause: unknown) => { fail(cause); return undefined })
      if (disposed || generation !== selectionGeneration) return
      batch(() => {
        setSelected(t)
        setActiveRow(null)
        setRowDraft(null)
        setInserting(false)
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
    if (busy() || disposed || status() !== 'connected') return
    userChanged = true
    setBusy(true)
    try {
      await props.bridge.document.flush()
      if (disposed) return
      const sql = (await props.bridge.document.read()).trim()
      if (disposed || !sql) return
      const res = await runQuery(props.taskId, sql)
      if (disposed) return
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
        setRowDraft(null)
        setInserting(false)
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
    if (t && !disposed) {
      setBusy(false)
      await openTable(t)
    }
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

  const snapshot = () => workspaceModel.snapshot(savedList(), backends())
  const restore = async () => {
    try {
      const workspace = await loadDatabaseWorkspace(props.bridge.state, props.taskId)
      if (disposed || userChanged || !workspace) return
      batch(() => {
        workspaceModel.restore(workspace)
        if (!savedList().length) restoreSaved(workspace.savedQueries)
      })
    } catch (cause) { fail(cause) }
    finally { if (!disposed) setRestoredState(true) }
  }
  createEffect(() => {
    if (!restoredState()) return
    const workspace = snapshot()
    rememberDatabaseWorkspace(nodeId, props.taskId, workspace)
    void saveDatabaseWorkspace(props.bridge.state, props.taskId, workspace).catch(fail)
  })

  onMount(() => {
    // The host's half of a composed pane resolved a surface-scoped chord and sent it across. There is
    // one command today; the switch is here rather than an `if` because a second one is a manifest row
    // and this is where it would land.
    onCleanup(props.bridge.onSurfaceAction((command) => {
      if (command === 'execute') void execute()
    }))
    // The selection that opened this pane rides in `context`; every later one is a message
    // (docs/plugins/tree-contract.md § The tree contract). Both land in the same signal.
    setRequested(props.bridge.context.item)
    onCleanup(props.bridge.onSelect((item) => { selectionGeneration++; setRequested(item) }))
    void (async () => { if (!restored) await restore(); if (!disposed) await connect() })()
  })
  onCleanup(() => {
    // Keep data, never the retired bridge or an in-flight operation. The editor owns SQL custody.
    if (restoredState()) rememberDatabaseWorkspace(nodeId, props.taskId, snapshot())
    void disconnectDb(props.taskId).catch(() => {})
  })

  // Loading a saved query is the picker's whole job, and it writes into the host's editor. Kept as an
  // effect-free handler rather than a signal→document sync, because the document is not this frame's
  // state. It is a thing on the other side of the port that the reader may also be typing into.
  const loadSaved = (q: DbSavedQuery) => {
    userChanged = true
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
          {/* Last-known tables remain visible while the connection check runs. */}
          <Show when={connected() || tables().length > 0}>
            <Toolbar size="sm" ariaLabel="Filter tables">
              <Input kind="filter" label="Filter tables" placeholder="Filter tables…" value={filter()} onChange={(value: string) => { userChanged = true; setFilter(value) }} />
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
                <Button size="sm" variant="ghost" disabled={busy()} onPress={() => batch(() => { setRowDraft(null); setInserting(true) })}>Add row</Button>
              </Show>
            </Toolbar>
          </Show>
          <Show when={activeRow() === null && !inserting() ? result() : null} fallback={<Show when={!error() && !result()}><EmptyState title="Choose a table, or run a query" /></Show>}>
            {(r) => (
              <Grid
                ariaLabel="Query results"
                columns={r().columns}
                // The kit's Grid takes strings, so a SQL NULL is spelled here rather than styled. It was
                // a dimmed cell with a class; it is the word now, which is what the terminal projection
                // of this node says anyway.
                rows={r().rows.map((row) => row.map((cell) => cell ?? 'NULL'))}
                selected={activeRow()}
                onSelect={(i: number) => batch(() => { setInserting(false); setRowDraft(null); setActiveRow(i) })}
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
              busy={busy() || !connected()}
              initialDraft={rowDraft()}
              onDraft={setRowDraft}
              onClose={() => setInserting(false)}
              onInsert={async (values) => {
                const t = resultTable()
                if (!t) return
                setBusy(true)
                try {
                  const res = await insertRow(props.taskId, t.schema, t.name, values)
                  if (disposed) return
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
              busy={busy() || !connected()}
              initialDraft={rowDraft()}
              onDraft={setRowDraft}
              onClose={() => setActiveRow(null)}
              onSave={async (edits) => {
                const t = resultTable()
                if (!t) return
                const pk = primaryKey()
                setBusy(true)
                try {
                  for (const [col, val] of edits) {
                    const res = await updateCell(props.taskId, t.schema, t.name, col, val, pk)
                    if (disposed) return
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
                  if (disposed) return
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
