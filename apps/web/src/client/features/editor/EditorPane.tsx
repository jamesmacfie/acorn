import { createEffect, createSignal, For, on, onCleanup, onMount, Show } from 'solid-js'
import * as monaco from 'monaco-editor'
import './monacoSetup'
import type { Task } from '../../queries'
import { editorApi, type EditorEntry } from './editorClient'
import { formatFileReference, sendReferenceToAgent } from '../agent/reference'
import { isAppDark, watchTheme } from '../terminal/theme'
import { activeFile, editorActivate, editorClose, editorOpen, editorPromote, editorSetDirty, openFiles } from './editorState'
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

// The Monaco editor pane (docs/next 07): a lazy file tree on the left, a file TAB BAR + one reused
// Monaco instance on the right. Single-click opens an ephemeral (italic) preview tab; editing or
// double-click promotes it. ⌘S saves; dirty dot on the tab; reload-on-focus with a dirty guard
// (the agent and the human share the worktree).
export default function EditorPane(props: { task: Task }) {
  const api = editorApi()
  const [root, setRoot] = createSignal<string | null | undefined>(undefined) // undefined = loading
  const [saveErr, setSaveErr] = createSignal('')

  let host: HTMLDivElement | undefined
  let editor: monaco.editor.IStandaloneCodeEditor | undefined
  let stopTheme: (() => void) | undefined
  // ONE Monaco instance reused across tab switches, with the current path tracked EXPLICITLY
  // rather than trusting props/signals mid-swap (verne's documented gotcha: a stale model write
  // lands in the wrong file without this). Models are kept per path and disposed on tab close.
  let currentPath: string | null = null
  const models = new Map<string, monaco.editor.ITextModel>()
  const savedVersion = new Map<string, number>() // alternativeVersionId at last load/save

  const files = () => openFiles(props.task.id)
  const active = () => activeFile(props.task.id)

  onMount(() => {
    onCleanup(() => {
      stopTheme?.()
      for (const m of models.values()) m.dispose()
      models.clear()
      editor?.dispose()
      window.removeEventListener('focus', onFocus)
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
      window.addEventListener('focus', onFocus)
      const restore = active()
      if (restore) void show(restore)
    })()
  })

  async function modelFor(relPath: string): Promise<monaco.editor.ITextModel> {
    let model = models.get(relPath)
    if (model) return model
    const content = (await api?.read(props.task.id, relPath).catch(() => '')) ?? ''
    model = monaco.editor.createModel(content, langFor(relPath))
    savedVersion.set(relPath, model.getAlternativeVersionId())
    model.onDidChangeContent(() => {
      // Dirty derives from the version id vs the last saved one — undo back to saved clears it.
      const dirty = model!.getAlternativeVersionId() !== savedVersion.get(relPath)
      editorSetDirty(props.task.id, relPath, dirty)
    })
    models.set(relPath, model)
    return model
  }

  // Swap the reused instance to a path. THE only place currentPath changes.
  async function show(relPath: string) {
    if (!editor) return
    setSaveErr('')
    const model = await modelFor(relPath)
    currentPath = relPath
    editor.setModel(model)
    editor.updateOptions({ readOnly: false })
    editorActivate(props.task.id, relPath)
  }

  function openPath(relPath: string, ephemeral: boolean) {
    editorOpen(props.task.id, relPath, ephemeral)
    void show(relPath)
  }

  async function save() {
    const p = currentPath
    const model = p ? models.get(p) : undefined
    if (!api || !p || !model) return
    const res = await api.write(props.task.id, p, model.getValue())
    if (!res.ok) return setSaveErr(res.reason ?? 'Save failed')
    savedVersion.set(p, model.getAlternativeVersionId())
    editorSetDirty(props.task.id, p, false)
  }

  function close(relPath: string) {
    const file = files().find((x) => x.path === relPath)
    if (file?.dirty && !window.confirm(`${relPath} has unsaved changes — close anyway?`)) return
    editorClose(props.task.id, relPath)
    models.get(relPath)?.dispose()
    models.delete(relPath)
    savedVersion.delete(relPath)
    if (currentPath === relPath) {
      currentPath = null
      const next = activeFile(props.task.id)
      if (next) void show(next)
      else editor?.setModel(null)
    }
  }

  // External-change reload on window focus (docs/next 07 P2): the agent edits the same worktree.
  // A clean model reloads silently; a dirty one is guarded (never clobber unsaved human edits).
  async function onFocus() {
    const p = currentPath
    const model = p ? models.get(p) : undefined
    if (!api || !p || !model) return
    const file = files().find((x) => x.path === p)
    if (file?.dirty) return
    const disk = await api.read(props.task.id, p).catch(() => null)
    if (disk != null && disk !== model.getValue()) {
      model.setValue(disk)
      savedVersion.set(p, model.getAlternativeVersionId())
      editorSetDirty(props.task.id, p, false)
    }
  }

  // Task switch within a mounted pane: re-sync the surface to that task's active tab.
  createEffect(
    on(
      () => props.task.id,
      () => {
        const next = activeFile(props.task.id)
        if (editor) {
          if (next) void show(next)
          else {
            currentPath = null
            editor.setModel(null)
          }
        }
      },
      { defer: true },
    ),
  )

  return (
    <section class="pane editor-pane" style={{ 'grid-column': '1 / 3' }}>
      <Show when={root() !== undefined} fallback={<div class="editor-empty muted">Loading…</div>}>
        <Show when={root()} fallback={<div class="editor-empty muted">Open a terminal first to map this repo's checkout.</div>}>
          <div class="editor-layout">
            <div class="editor-tree">
              <Tree taskId={props.task.id} relPath="" onOpen={(p) => openPath(p, true)} openPath={active()} />
            </div>
            <div class="editor-main">
              <div class="editor-tabs">
                <For each={files()}>
                  {(file) => (
                    <div class="editor-tab" classList={{ active: active() === file.path, ephemeral: file.ephemeral }}>
                      <button
                        type="button"
                        class="editor-tab-name"
                        title={file.path}
                        onClick={() => void show(file.path)}
                        onDblClick={() => editorPromote(props.task.id, file.path)}
                      >
                        {file.path.split('/').pop()}
                        {file.dirty ? ' ●' : ''}
                      </button>
                      <button type="button" class="editor-tab-close" title="Close" onClick={() => close(file.path)}>✕</button>
                    </div>
                  )}
                </For>
                <div class="editor-tab-actions">
                  <Show when={active()}>
                    <button type="button" class="editor-save" onClick={() => void save()}>Save ⌘S</button>
                    <button
                      type="button"
                      class="editor-save"
                      title="Add file/selection reference to the agent composer"
                      onClick={() => {
                        const p = currentPath
                        if (!p) return
                        const sel = editor?.getSelection()
                        const ref = sel && !sel.isEmpty() ? formatFileReference(p, sel.startLineNumber, sel.endLineNumber) : formatFileReference(p)
                        void sendReferenceToAgent(props.task.id, ref).then((r) => {
                          if (!r.ok && r.reason) window.alert(r.reason)
                        })
                      }}
                    >→ agent</button>
                  </Show>
                  <Show when={saveErr()}><span class="action-error">{saveErr()}</span></Show>
                </div>
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
