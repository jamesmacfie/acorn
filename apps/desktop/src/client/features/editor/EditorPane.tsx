import { createEffect, createSignal, For, on, onCleanup, onMount, Show } from 'solid-js'
import * as monaco from 'monaco-editor'
import './monacoSetup'
import type { Task } from '../../queries'
import { debounce } from '../../autosave'
import { editorApi, type EditorEntry } from './editorClient'
import { formatFileReference, sendReferenceToAgent } from '../agent/reference'
import { isAppDark, token, watchTheme } from '../terminal/theme'
import { onClosePaneWithin } from '../../lib/onClosePaneWithin'
import { activeFile, editorActivate, editorClose, editorOpen, editorPromote, editorSetDirty, openFiles } from './editorState'
import { clientEvents, consumePaneIntent, type PaneIntent } from '../../registries/clientEvents'
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

// Scroll + cursor + selection per file, keyed `${taskId}:${path}`. Module-level so it survives the
// pane unmounting on task/workspace switch — you return to the same spot. Session-only (content
// isn't persisted, so restoring scroll after relaunch would be against a possibly-changed file).
const viewStates = new Map<string, monaco.editor.ICodeEditorViewState>()
const viewKey = (taskId: string, path: string): string => `${taskId}:${path}`

// Monaco (like xterm) ignores CSS custom properties, so it gets an explicit theme: base vs/vs-dark
// supplies the syntax colours, chrome colours come from the live app tokens (tokens-layout.css) —
// the same recipe terminal/theme.ts uses. Re-defining 'app' on theme change updates in place; the
// name is global, so every editor instance follows.
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

// The Monaco editor pane (docs/panes.md): a lazy file tree on the left, a file TAB BAR + one reused
// Monaco instance on the right. Single-click opens an ephemeral (italic) preview tab; editing or
// double-click promotes it. ⌘S saves; dirty dot on the tab; reload-on-focus with a dirty guard
// (the agent and the human share the worktree).
export default function EditorPane(props: { task: Task }) {
  const api = editorApi()
  const [root, setRoot] = createSignal<string | null | undefined>(undefined) // undefined = loading
  const [saveErr, setSaveErr] = createSignal('')
  const [pendingReveal, setPendingReveal] = createSignal<{ path: string; line: number } | null>(null)

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

  // Cmd/Ctrl+W closes the active file tab when focus is inside this pane.
  let paneRef: HTMLElement | undefined
  onClosePaneWithin(() => paneRef, () => {
    const p = active()
    if (p) void close(p)
  })

  // Autosave (no Save button): debounce while typing, flush on blur / tab-switch / close.
  const scheduleSave = debounce((p: string) => void save(p), 1500)

  // Stash the current file's scroll/cursor so it can be restored after a tab swap or a remount.
  const saveViewState = () => {
    if (editor && currentPath) {
      const vs = editor.saveViewState()
      if (vs) viewStates.set(viewKey(props.task.id, currentPath), vs)
    }
  }

  onMount(() => {
    onCleanup(() => {
      saveViewState() // pane unmounting (task/workspace switch) — remember where we were
      scheduleSave.flush()
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
      applyMonacoTheme()
      editor = monaco.editor.create(host, {
        automaticLayout: true,
        theme: 'app',
        readOnly: true, // until a file is opened
        minimap: { enabled: false },
      })
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => void save()) // explicit flush; autosave still runs
      editor.onDidBlurEditorText(() => scheduleSave.flush())
      stopTheme = watchTheme(applyMonacoTheme)
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
      if (dirty) scheduleSave(relPath)
    })
    models.set(relPath, model)
    return model
  }

  // Swap the reused instance to a path. THE only place currentPath changes.
  async function show(relPath: string) {
    if (!editor) return
    scheduleSave.flush() // persist the outgoing file (pending arg is its path) before the swap
    saveViewState() // remember the outgoing file's scroll/cursor before we swap models
    setSaveErr('')
    const model = await modelFor(relPath)
    currentPath = relPath
    editor.setModel(model)
    const vs = viewStates.get(viewKey(props.task.id, relPath))
    if (vs) editor.restoreViewState(vs)
    editor.updateOptions({ readOnly: false })
    editorActivate(props.task.id, relPath)
    maybeReveal(relPath)
  }

  // Consume a pending find-in-files reveal for the just-shown file: scroll to the match line and put
  // the cursor there. One-shot — cleared once applied so it doesn't re-fire on the next tab switch.
  function maybeReveal(relPath: string) {
    const r = pendingReveal()
    if (!editor || !r || r.path !== relPath) return
    const line = Math.max(1, r.line)
    editor.revealLineInCenter(line)
    editor.setPosition({ lineNumber: line, column: 1 })
    editor.focus()
    setPendingReveal(null)
  }

  const applyPaneIntent = (intent: PaneIntent | undefined) => {
    if (!intent || intent.kind !== 'editor:reveal') return
    setPendingReveal({ path: intent.path, line: intent.line })
    if (currentPath === intent.path) maybeReveal(intent.path)
  }
  onMount(() => {
    const off = clientEvents.on('presentation:pane-intent', ({ taskId, paneId, intent }) => {
      if (taskId === props.task.id && paneId === 'editor') applyPaneIntent(intent)
    })
    onCleanup(off)
  })
  createEffect(() => applyPaneIntent(consumePaneIntent(props.task.id, 'editor')))

  function openPath(relPath: string, ephemeral: boolean) {
    editorOpen(props.task.id, relPath, ephemeral) // the active() effect swaps the surface
  }

  async function save(p: string | null = currentPath) {
    const model = p ? models.get(p) : undefined
    if (!api || !p || !model) return
    const version = model.getAlternativeVersionId() // snapshot: the value we're about to write
    const res = await api.write(props.task.id, p, model.getValue())
    if (!res.ok) return setSaveErr(res.reason ?? 'Save failed')
    savedVersion.set(p, version)
    // Still-dirty if the user typed more during the async write.
    editorSetDirty(props.task.id, p, model.getAlternativeVersionId() !== version)
  }

  async function close(relPath: string) {
    scheduleSave.cancel()
    await save(relPath) // autosave: persist before we discard the model
    editorClose(props.task.id, relPath) // active() moves to the neighbour; the effect swaps the surface
    models.get(relPath)?.dispose()
    models.delete(relPath)
    savedVersion.delete(relPath)
  }

  // External-change reload on window focus (docs/panes.md): the agent edits the same worktree.
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

  // Single driver for the reused Monaco surface: whenever the active file changes — task switch,
  // tree click, tab close, or the ⌘P quick-open palette (a separate component writing editorState) —
  // swap the model here. Deferred so onMount owns the first paint.
  createEffect(
    on(active, (next) => {
      if (!editor) return
      if (next && next !== currentPath) void show(next)
      else if (!next) {
        currentPath = null
        editor.setModel(null)
      }
    }, { defer: true }),
  )

  return (
    <section ref={paneRef} class="pane editor-pane" style={{ 'grid-column': '1 / 3' }}>
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
                      <button type="button" class="editor-tab-close" title="Close" onClick={() => void close(file.path)}>✕</button>
                    </div>
                  )}
                </For>
                <div class="editor-tab-actions">
                  <Show when={active()}>
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
                          if (!r.ok && r.reason) setSaveErr(r.reason)
                          else setSaveErr('')
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
