import { createEffect, createSignal, on, onCleanup, onMount, Show } from 'solid-js'
import * as monaco from 'monaco-editor'
import { activeTaskId, clientEvents, consumePaneIntent, debounce, focusedPane, formatFileReference, onClosePaneWithin, type PaneIntent, registerCommands, sendReferenceToAgent, type Task } from '@acorn/plugin-api/client'
import { Alert, Button, DocumentTabs, EmptyState, ListDetail, Tabs } from '@acorn/plugin-api/ui'
import { MONACO_THEME, monacoLanguageForPath, watchMonacoTheme } from '@acorn/plugin-api/ui/editor'
import { editorApi } from './editorClient'
import { activeFile, editorActivate, editorClose, editorOpen, editorPromote, editorSetDirty, openFiles } from './editorState'
import { editorViewState, rememberEditorViewState } from './editorViewState'
import FileTree from './FileTree'
import { canRevealActiveFile, type FileTreeRevealRequest } from './fileTreeReveal'
import SearchPanel from './search/SearchPanel'
import './editor.css'

// The extension→language map and the Monaco theme both moved to the host
// (@acorn/protocol/languageIds.ts + client-core/editor/), because this file and DatabasePane.tsx were
// each carrying a copy and the theme NAME is a Monaco global — two panes writing the same global and
// agreeing by luck. Same reason the host now owns the whole document surface a loaded plugin gets
// (docs/future/monaco.md).

// The Monaco editor pane (docs/panes.md): a lazy file tree on the left, a file TAB BAR + one reused
// Monaco instance on the right. Single-click opens an ephemeral (italic) preview tab; editing or
// double-click promotes it. ⌘S saves; dirty dot on the tab; reload-on-focus with a dirty guard
// (the agent and the human share the worktree).
export default function EditorPane(props: { task: Task }) {
  const api = editorApi()
  const taskId = props.task.id
  const [root, setRoot] = createSignal<string | null | undefined>(undefined) // undefined = loading
  const [saveErr, setSaveErr] = createSignal('')
  const [pendingReveal, setPendingReveal] = createSignal<{ path: string; line: number; column?: number } | null>(null)
  const [treeReveal, setTreeReveal] = createSignal<FileTreeRevealRequest | null>(null)
  const [side, setSide] = createSignal<'files' | 'search'>('files')
  let treeRevealRevision = 0

  let host: HTMLDivElement | undefined
  let editor: monaco.editor.IStandaloneCodeEditor | undefined
  let stopTheme: (() => void) | undefined
  // ONE Monaco instance reused across tab switches, with the current path tracked EXPLICITLY
  // rather than trusting props/signals mid-swap (verne's documented gotcha: a stale model write
  // lands in the wrong file without this). Models are kept per path and disposed on tab close.
  let currentPath: string | null = null
  const models = new Map<string, monaco.editor.ITextModel>()
  const savedVersion = new Map<string, number>() // alternativeVersionId at last load/save

  const files = () => openFiles(taskId)
  const active = () => activeFile(taskId)
  let disposed = false

  // Cmd/Ctrl+W closes the active file tab when focus is inside this pane.
  let paneRef: HTMLElement | undefined
  onClosePaneWithin(() => paneRef, () => {
    const p = active()
    if (p) void close(p)
  })

  const revealActiveFile = () => {
    const path = active()
    if (!path) return
    setSide('files') // the tree is one of two things the sidebar shows; revealing into a hidden one is a no-op
    setTreeReveal({ path, revision: ++treeRevealRevision })
  }

  onMount(() => {
    const commands = registerCommands([{
      id: 'editor.tree.reveal-active-file',
      title: 'Reveal active file in editor tree',
      category: 'navigation',
      hint: () => active() ?? undefined,
      palette: true,
      when: () => canRevealActiveFile({
        paneTaskId: taskId,
        activeTaskId: activeTaskId(),
        focusedPane: focusedPane(taskId),
        activeFile: active(),
        treeAvailable: !!root(),
      }),
      run: revealActiveFile,
    }])
    onCleanup(() => commands.dispose())
  })

  // Autosave (no Save button): debounce while typing, flush on blur / tab-switch / close.
  const scheduleSave = debounce((p: string) => void save(p), 1500)

  // Stash the current file's scroll/cursor so it can be restored after a tab swap or a remount.
  const saveViewState = () => {
    if (editor && currentPath) {
      const vs = editor.saveViewState()
      if (vs) rememberEditorViewState(taskId, currentPath, vs)
    }
  }

  onMount(() => {
    onCleanup(() => {
      saveViewState() // pane unmounting (task/workspace switch) — remember where we were
      disposed = true
      scheduleSave.flush()
      stopTheme?.()
      for (const m of models.values()) m.dispose()
      models.clear()
      editor?.dispose()
      window.removeEventListener('focus', onFocus)
    })
    void (async () => {
      if (!api) return setRoot(null)
      const r = await api.root(taskId)
      if (disposed) return
      setRoot(r) // renders the host div synchronously when truthy
      if (!r || !host) return
      stopTheme = watchMonacoTheme()
      editor = monaco.editor.create(host, {
        automaticLayout: true,
        theme: MONACO_THEME,
        readOnly: true, // until a file is opened
        minimap: { enabled: false },
      })
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => void save()) // explicit flush; autosave still runs
      editor.onDidBlurEditorText(() => scheduleSave.flush())
      window.addEventListener('focus', onFocus)
      const restore = active()
      if (restore) void show(restore)
    })()
  })

  async function modelFor(relPath: string): Promise<monaco.editor.ITextModel | null> {
    if (disposed) return null
    let model = models.get(relPath)
    if (model) return model
    const content = (await api?.read(taskId, relPath).catch(() => '')) ?? ''
    if (disposed) return null
    model = monaco.editor.createModel(content, monacoLanguageForPath(relPath))
    savedVersion.set(relPath, model.getAlternativeVersionId())
    model.onDidChangeContent(() => {
      // Dirty derives from the version id vs the last saved one — undo back to saved clears it.
      const dirty = model!.getAlternativeVersionId() !== savedVersion.get(relPath)
      editorSetDirty(taskId, relPath, dirty)
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
    if (disposed || !editor || !model) return
    currentPath = relPath
    editor.setModel(model)
    const vs = editorViewState(taskId, relPath)
    if (vs) editor.restoreViewState(vs)
    editor.updateOptions({ readOnly: false })
    editorActivate(taskId, relPath)
    maybeReveal(relPath)
  }

  // Consume a pending cross-pane reveal for the just-shown file: center the target position and put
  // the cursor there. One-shot — cleared once applied so it doesn't re-fire on the next tab switch.
  function maybeReveal(relPath: string) {
    const r = pendingReveal()
    if (!editor || !r || r.path !== relPath) return
    const requested = { lineNumber: Math.max(1, r.line), column: Math.max(1, r.column ?? 1) }
    const position = editor.getModel()?.validatePosition(requested) ?? requested
    editor.setPosition(position)
    editor.revealPositionInCenter(position)
    editor.focus()
    setPendingReveal(null)
  }

  const applyPaneIntent = (intent: PaneIntent | undefined) => {
    if (!intent) return
    // ⌘⇧F and the "Find in files…" palette row, which used to open a pane of their own.
    if (intent.kind === 'editor:search') {
      setSide('search')
      return
    }
    if (intent.kind !== 'editor:reveal') return
    setPendingReveal({ path: intent.path, line: intent.line, column: intent.column })
    // Reveal implies open: cross-pane senders (find-in-files, stack frames) go through the core
    // intent bus alone and can't call editorOpen themselves. No-op when the tab is already current.
    openPath(intent.path, true)
    if (currentPath === intent.path) maybeReveal(intent.path)
  }
  onMount(() => {
    const off = clientEvents.on('presentation:pane-intent', ({ taskId: targetTaskId, paneId, intent }) => {
      if (targetTaskId === taskId && paneId === 'editor') applyPaneIntent(intent)
    })
    onCleanup(off)
  })
  createEffect(() => applyPaneIntent(consumePaneIntent(taskId, 'editor')))

  function openPath(relPath: string, ephemeral: boolean) {
    editorOpen(taskId, relPath, ephemeral) // the active() effect swaps the surface
  }

  async function save(p: string | null = currentPath) {
    const model = p ? models.get(p) : undefined
    if (!api || !p || !model) return
    const version = model.getAlternativeVersionId() // snapshot: the value we're about to write
    const res = await api.write(taskId, p, model.getValue())
    if (disposed) return
    if (!res.ok) return setSaveErr(res.reason ?? 'Save failed')
    savedVersion.set(p, version)
    // Still-dirty if the user typed more during the async write.
    editorSetDirty(taskId, p, model.getAlternativeVersionId() !== version)
  }

  async function close(relPath: string) {
    scheduleSave.cancel()
    await save(relPath) // autosave: persist before we discard the model
    if (disposed) return
    editorClose(taskId, relPath) // active() moves to the neighbour; the effect swaps the surface
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
    const disk = await api.read(taskId, p).catch(() => null)
    if (!disposed && disk != null && disk !== model.getValue()) {
      model.setValue(disk)
      savedVersion.set(p, model.getAlternativeVersionId())
      editorSetDirty(taskId, p, false)
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
      <Show when={root() !== undefined} fallback={<EmptyState busy>Loading…</EmptyState>}>
        <Show when={root()} fallback={<EmptyState>Open a terminal first to map this repo's checkout.</EmptyState>}>
          <ListDetail
            listLabel="Editor sidebar"
            listClass="editor-side"
            detailClass="editor-main"
            list={
              <>
                <Tabs
                  tabs={[{ id: 'files', label: 'Files' }, { id: 'search', label: 'Search' }]}
                  active={side()}
                  onChange={(id) => setSide(id === 'search' ? 'search' : 'files')}
                  idPrefix="editor-side"
                  ariaLabel="Editor sidebar"
                />
                {/* Both stay mounted; the hidden one keeps its scroll, its open folders and its results. */}
                <div
                  id="editor-side-panel-files"
                  role="tabpanel"
                  aria-labelledby="editor-side-tab-files"
                  class="editor-tree"
                  style={{ display: side() === 'files' ? undefined : 'none' }}
                >
                  <FileTree
                    taskId={taskId}
                    onOpen={(p) => openPath(p, true)}
                    openPath={active()}
                    reveal={treeReveal()}
                    onRevealed={(revision) => {
                      setTreeReveal((request) => request?.revision === revision ? null : request)
                    }}
                  />
                </div>
                <SearchPanel taskId={taskId} active={side() === 'search'} />
              </>
            }
          >
            {/* Was a hand-rolled strip: the dirty state was a string-concatenated ●, the close
                button was mouse-only, and there were no arrow keys. */}
            <DocumentTabs
              class="editor-tabs"
              idPrefix="editor"
              ariaLabel="Open files"
              active={active() ?? ''}
              onActivate={(path) => void show(path)}
              onClose={(path) => void close(path)}
              onPromote={(path) => editorPromote(taskId, path)}
              tabs={files().map((file) => ({
                id: file.path,
                label: file.path.split('/').pop() ?? file.path,
                title: file.path,
                dirty: file.dirty,
                ephemeral: file.ephemeral,
              }))}
              actions={
                <>
                  <Show when={active()}>
                    <Button
                      variant="bare"
                      size="sm"
                      class="editor-save"
                      data-tip="Add file/selection reference to the agent composer"
                      onClick={() => {
                        const p = currentPath
                        if (!p) return
                        const sel = editor?.getSelection()
                        const ref = sel && !sel.isEmpty() ? formatFileReference(p, sel.startLineNumber, sel.endLineNumber) : formatFileReference(p)
                        void sendReferenceToAgent(taskId, ref).then((r) => {
                          if (!r.ok && r.reason) setSaveErr(r.reason)
                          else setSaveErr('')
                        })
                      }}
                    >→ agent</Button>
                  </Show>
                  <Show when={saveErr()}><Alert>{saveErr()}</Alert></Show>
                </>
              }
            />
            <div class="editor-host" ref={host} />
          </ListDetail>
        </Show>
      </Show>
    </section>
  )
}
