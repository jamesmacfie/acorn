import { batch, createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import { createQuery } from '@tanstack/solid-query'
import * as monaco from 'monaco-editor'
import '../../editor/client/monacoSetup'
import { integrationsOptions, type Task } from '../../../core/client/queries'
import { availableModelConnections } from '../../../core/shared/modelProviders'
import { isAppDark, token, watchTheme } from '../../terminal/client/theme'
import type { DbCell, DbColumn, DbResultSet, DbTable } from '../shared/database'
import { databaseApi } from './databaseClient'
import GenerateSqlModal from './GenerateSqlModal'
import ResultGrid from './ResultGrid'
import './database.css'

// Monaco ignores CSS custom properties, so it gets an explicit theme built from the live app tokens
// — same recipe as EditorPane.tsx (mirrored here to keep that pane untouched).
function applyMonacoTheme() {
  monaco.editor.defineTheme('app', {
    base: isAppDark() ? 'vs-dark' : 'vs',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': token('--bg'),
      'editor.foreground': token('--text'),
      'editorCursor.foreground': token('--text'),
      'editorLineNumber.foreground': token('--text-faint'),
      'editorLineNumber.activeForeground': token('--text-muted'),
      'editor.lineHighlightBackground': token('--bg-hover'),
      'editor.selectionBackground': token('--bg-selected'),
    },
  })
  monaco.editor.setTheme('app')
}

const qid = (id: string): string => `"${id.replace(/"/g, '""')}"`

type Selected = { schema: string; name: string } | null

// The Database pane (docs/pg.md): a searchable table list, a Monaco SQL editor over a
// virtualized results grid, and a row-detail panel that doubles as the edit/insert/delete surface.
export default function DatabasePane(props: { task: Task }) {
  const api = databaseApi()
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
  const [deleteArmed, setDeleteArmed] = createSignal(false)
  const [generating, setGenerating] = createSignal(false)

  // AI SQL generation: available only when a model-provider key is connected (docs/pg.md).
  const integrations = createQuery(() => integrationsOptions(true))
  const modelConnections = createMemo(() => (integrations.data ? availableModelConnections(integrations.data) : []))

  let editorHost: HTMLDivElement | undefined
  let editor: monaco.editor.IStandaloneCodeEditor | undefined
  let stopTheme: (() => void) | undefined
  const [editorH, setEditorH] = createSignal(200)

  const filtered = createMemo(() => {
    const q = filter().trim().toLowerCase()
    const list = tables()
    return q ? list.filter((t) => `${t.schema}.${t.name}`.toLowerCase().includes(q)) : list
  })

  async function connect() {
    if (!api) return setStatus('error'), setError('Database bridge unavailable (desktop only).')
    setStatus('connecting')
    setError('')
    const res = await api.connect(props.task.id)
    if (!res.ok) return setStatus('error'), setError(res.error)
    setDbName(res.database)
    setStatus('connected')
    void loadTables()
  }

  async function loadTables() {
    if (!api) return
    const res = await api.tables(props.task.id)
    if ('error' in res) return setError(res.error)
    setTables(res.tables)
  }

  async function openTable(t: DbTable) {
    if (!api || busy()) return
    setBusy(true)
    try {
      batch(() => {
        setSelected(t)
        setActiveRow(null)
      })
      const cols = await api.columns(props.task.id, t.schema, t.name)
      setColumns('error' in cols ? [] : cols.columns)
      const rows = await api.rows(props.task.id, t.schema, t.name)
      if ('error' in rows) return setError(rows.error)
      batch(() => {
        setResult({ columns: rows.columns, rows: rows.rows, rowCount: rows.rowCount, command: rows.command })
        setResultTable(t)
        setFooter(`${rows.rows.length} of ${rows.total ?? '?'} rows`)
        setError('')
      })
      if (editor) editor.setValue(`SELECT * FROM ${qid(t.schema)}.${qid(t.name)} LIMIT 500;`)
    } finally {
      setBusy(false)
    }
  }

  async function execute() {
    if (!api || busy()) return
    const sql = editor?.getValue().trim()
    if (!sql) return
    setBusy(true)
    try {
      const res = await api.query(props.task.id, sql)
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
    } finally {
      setBusy(false)
    }
  }

  // After a write, re-open the current table to reflect it.
  async function reloadTable() {
    const t = resultTable()
    if (t) await openTable(t)
  }

  const onSplitDown = (e: PointerEvent) => {
    e.preventDefault()
    const startY = e.clientY
    const startH = editorH()
    const onMove = (ev: PointerEvent) => setEditorH(Math.min(Math.max(startH + (ev.clientY - startY), 80), window.innerHeight * 0.7))
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  onMount(() => {
    if (editorHost) {
      applyMonacoTheme()
      editor = monaco.editor.create(editorHost, {
        value: '',
        language: 'sql',
        theme: 'app',
        automaticLayout: true,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        fontSize: 13,
      })
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => void execute())
      stopTheme = watchTheme(applyMonacoTheme)
    }
    void connect()
  })
  onCleanup(() => {
    stopTheme?.()
    editor?.dispose()
    void api?.disconnect(props.task.id)
  })

  return (
    <section class="pane db-pane">
      <div class="section-header db-head">
        <span>Database</span>
        <span class="db-status" classList={{ err: status() === 'error', ok: status() === 'connected' }}>
          {status() === 'connected' ? dbName() || 'connected' : status() === 'connecting' ? 'connecting…' : 'error'}
        </span>
        <button type="button" class="db-icon-btn" title="Reconnect" onClick={() => void connect()}>⟳</button>
      </div>

      <Show when={error()}>
        <div class="db-error">{error()}</div>
      </Show>

      <div class="db-body">
        <aside class="db-sidebar">
          <input class="pr-filter db-filter" placeholder="Filter tables…" value={filter()} onInput={(e) => setFilter(e.currentTarget.value)} />
          <div class="db-table-list">
            <For each={filtered()} fallback={<p class="placeholder">{status() === 'connected' ? 'No tables.' : ''}</p>}>
              {(t) => (
                <button
                  type="button"
                  class="db-table-row"
                  classList={{ active: selected()?.schema === t.schema && selected()?.name === t.name }}
                  onClick={() => void openTable(t)}
                  title={`${t.schema}.${t.name}`}
                >
                  {t.schema === 'public' ? t.name : `${t.schema}.${t.name}`}
                </button>
              )}
            </For>
          </div>
        </aside>

        <div class="db-main">
          <div class="db-editor" style={{ height: `${editorH()}px` }}>
            <div class="db-editor-host" ref={editorHost} />
            <div class="db-editor-bar">
              <span class="muted db-hint">⌘↵ to run</span>
              <Show when={modelConnections().length}>
                <button type="button" class="db-run-btn" disabled={busy() || status() !== 'connected'} onClick={() => setGenerating(true)}>Generate</button>
              </Show>
              <button type="button" class="db-run-btn" disabled={busy() || status() !== 'connected'} onClick={() => void execute()}>Execute</button>
            </div>
          </div>
          <div class="db-split" onPointerDown={onSplitDown} />
          <div class="db-result">
            <div class="db-result-bar">
              <span class="db-footer">{footer()}</span>
              <Show when={resultTable() && columns().some((c) => c.isPk)}>
                <button type="button" class="db-icon-btn" title="Insert row" disabled={busy()} onClick={() => setInserting(true)}>+ Row</button>
              </Show>
            </div>
            <Show when={result()} fallback={<p class="placeholder">Select a table or run a query.</p>}>
              {(r) => <ResultGrid columns={r().columns} rows={r().rows} activeRow={activeRow()} onRowClick={(i) => batch(() => { setInserting(false); setActiveRow(i) })} />}
            </Show>
          </div>
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
              if (!t || !api) return
              setBusy(true)
              try {
                const res = await api.insert(props.task.id, t.schema, t.name, values)
                if (!res.ok) { setError(res.error); return }
                batch(() => { setInserting(false); setError('') })
                await reloadTable()
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
            onClose={() => { setActiveRow(null); setDeleteArmed(false) }}
            onSave={async (edits) => {
              const t = resultTable()
              if (!t || !api) return
              const pkMeta = columns().filter((c) => c.isPk)
              const pk = Object.fromEntries(pkMeta.map((c) => [c.name, result()!.rows[activeRow()!][result()!.columns.indexOf(c.name)]]))
              setBusy(true)
              try {
                for (const [col, val] of edits) {
                  const res = await api.update(props.task.id, t.schema, t.name, col, val, pk)
                  if (!res.ok) { setError(res.error); return }
                }
                setError('')
                await reloadTable()
              } finally {
                setBusy(false)
              }
            }}
            onDelete={async () => {
              const t = resultTable()
              if (!t || !api) return
              if (!deleteArmed()) {
                setDeleteArmed(true)
                setError('Click Delete again to permanently remove this row.')
                return
              }
              setDeleteArmed(false)
              const pkMeta = columns().filter((c) => c.isPk)
              const pk = Object.fromEntries(pkMeta.map((c) => [c.name, result()!.rows[activeRow()!][result()!.columns.indexOf(c.name)]]))
              setBusy(true)
              try {
                const res = await api.remove(props.task.id, t.schema, t.name, pk)
                if (!res.ok) { setError(res.error); return }
                setActiveRow(null)
                setError('')
                await reloadTable()
              } finally {
                setBusy(false)
              }
            }}
          />
        </Show>

        <Show when={generating()}>
          <GenerateSqlModal
            taskId={props.task.id}
            connections={modelConnections()}
            onClose={() => setGenerating(false)}
            onGenerated={(sql) => editor?.setValue(sql)}
          />
        </Show>
      </div>
    </section>
  )
}

// Row viewer + editor (docs/pg.md): column→value fields; editable when the rows belong to a
// single table with a primary key (ad-hoc SQL results are read-only). Save commits changed columns;
// Delete removes by PK. In `insert` mode the fields start blank and Save inserts a new row.
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
                  disabled={!editable() || draft()[col].isNull}
                  value={draft()[col].isNull ? '' : draft()[col].value}
                  placeholder={draft()[col].isNull ? 'NULL' : ''}
                  onInput={(e) => set(col, { value: e.currentTarget.value })}
                />
                {/* Insert mode always offers the null toggle (columns start null so untouched ones
                    take their DB default); edit mode only for nullable columns. */}
                <Show when={editable() && (props.insert || (m?.nullable ?? true))}>
                  <label class="db-null-toggle">
                    <input type="checkbox" checked={draft()[col].isNull} onChange={(e) => set(col, { isNull: e.currentTarget.checked })} /> null
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
            <button type="button" class="db-del-btn" disabled={props.busy} onClick={() => void props.onDelete?.()}>Delete</button>
          </Show>
        </Show>
      </div>
    </aside>
  )
}
