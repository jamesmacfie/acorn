import { createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import * as monaco from 'monaco-editor'
import './monacoSetup'
import type { Task } from '../../queries'
import { editorApi, type EditorEntry } from './editorClient'
import { isAppDark, watchTheme } from '../terminal/theme'
import './editor.css'

// Minimal filename → Monaco language id. Anything unmapped falls back to plaintext (still editable,
// no highlighting). ponytail: extend the map when a language you use is missing.
const EXT_LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', mjs: 'javascript',
  json: 'json', css: 'css', scss: 'scss', less: 'less', html: 'html', xml: 'xml',
  md: 'markdown', py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java', c: 'c', cpp: 'cpp',
  sh: 'shell', bash: 'shell', yml: 'yaml', yaml: 'yaml', sql: 'sql', toml: 'ini', ini: 'ini',
}
const langFor = (name: string): string => EXT_LANG[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'plaintext'

// The Monaco editor pane: a lazy file tree over the task's worktree on the left, one editable file
// on the right. Save on ⌘/Ctrl+S. Theming is deferred — just vs / vs-dark to match the app.
export default function EditorPane(props: { task: Task }) {
  const api = editorApi()
  const [root, setRoot] = createSignal<string | null | undefined>(undefined) // undefined = loading
  const [openPath, setOpenPath] = createSignal<string | null>(null)
  const [dirty, setDirty] = createSignal(false)
  const [saveErr, setSaveErr] = createSignal('')

  let host: HTMLDivElement | undefined
  let editor: monaco.editor.IStandaloneCodeEditor | undefined
  let stopTheme: (() => void) | undefined

  onMount(() => {
    // Register cleanup synchronously (after the awaits below the Solid owner is gone).
    onCleanup(() => {
      stopTheme?.()
      editor?.getModel()?.dispose()
      editor?.dispose()
    })
    void (async () => {
      if (!api) return setRoot(null)
      const r = await api.root(props.task.id)
      setRoot(r) // renders the host div synchronously when truthy
      if (!r || !host) return
      editor = monaco.editor.create(host, {
        automaticLayout: true,
        theme: isAppDark() ? 'vs-dark' : 'vs',
        readOnly: true, // until a file is opened
        minimap: { enabled: false },
      })
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => void save())
      stopTheme = watchTheme(() => monaco.editor.setTheme(isAppDark() ? 'vs-dark' : 'vs'))
    })()
  })

  async function open(relPath: string) {
    if (!api || !editor) return
    setSaveErr('')
    const content = await api.read(props.task.id, relPath).catch(() => '')
    const old = editor.getModel()
    const model = monaco.editor.createModel(content, langFor(relPath))
    model.onDidChangeContent(() => setDirty(true))
    editor.setModel(model)
    editor.updateOptions({ readOnly: false })
    old?.dispose()
    setOpenPath(relPath)
    setDirty(false)
  }

  async function save() {
    const p = openPath()
    if (!api || !editor || !p) return
    const res = await api.write(props.task.id, p, editor.getValue())
    if (!res.ok) return setSaveErr(res.reason ?? 'Save failed')
    setDirty(false)
  }

  return (
    <section class="pane editor-pane" style={{ 'grid-column': '1 / 3' }}>
      <Show when={root() !== undefined} fallback={<div class="editor-empty muted">Loading…</div>}>
        <Show when={root()} fallback={<div class="editor-empty muted">Open a terminal first to map this repo's checkout.</div>}>
          <div class="editor-layout">
            <div class="editor-tree">
              <Tree taskId={props.task.id} relPath="" onOpen={open} openPath={openPath()} />
            </div>
            <div class="editor-main">
              <div class="editor-bar">
                <span class="editor-file">{openPath() ?? 'Select a file'}{dirty() ? ' ●' : ''}</span>
                <Show when={openPath()}>
                  <button type="button" class="editor-save" onClick={() => void save()}>Save ⌘S</button>
                </Show>
                <Show when={saveErr()}><span class="action-error">{saveErr()}</span></Show>
              </div>
              <div class="editor-host" ref={host} />
            </div>
          </div>
        </Show>
      </Show>
    </section>
  )
}

// A directory's children, listed lazily on mount (so a folder's contents load only when expanded).
function Tree(props: { taskId: string; relPath: string; onOpen: (p: string) => void; openPath: string | null }) {
  const api = editorApi()
  const [entries, setEntries] = createSignal<EditorEntry[]>([])
  onMount(() => {
    void (async () => {
      if (api) setEntries(await api.list(props.taskId, props.relPath))
    })()
  })
  return (
    <ul class="tree">
      <For each={entries()}>
        {(e) => <TreeNode taskId={props.taskId} parent={props.relPath} entry={e} onOpen={props.onOpen} openPath={props.openPath} />}
      </For>
    </ul>
  )
}

function TreeNode(props: { taskId: string; parent: string; entry: EditorEntry; onOpen: (p: string) => void; openPath: string | null }) {
  const [open, setOpen] = createSignal(false)
  const path = () => (props.parent ? `${props.parent}/${props.entry.name}` : props.entry.name)
  return (
    <li>
      <Show
        when={props.entry.dir}
        fallback={
          <button type="button" class="tree-file" classList={{ active: props.openPath === path() }} onClick={() => props.onOpen(path())}>
            <span class="tree-twist" />
            {props.entry.name}
          </button>
        }
      >
        <button type="button" class="tree-dir" onClick={() => setOpen(!open())}>
          <span class="tree-twist">{open() ? '▾' : '▸'}</span>
          {props.entry.name}
        </button>
        <Show when={open()}>
          <Tree taskId={props.taskId} relPath={path()} onOpen={props.onOpen} openPath={props.openPath} />
        </Show>
      </Show>
    </li>
  )
}
