import { createEffect, createSignal, on, onCleanup, onMount, Show } from 'solid-js'
import { basicSetup } from 'codemirror'
import { EditorState, Prec, type Extension, type Text } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { activeTaskId, clientEvents, consumePaneIntent, debounce, focusedPane, formatFileReference, onClosePaneWhen, type PaneIntent, registerCommands, sendReferenceToAgent, type Task } from '@acorn/plugin-api/client'
import { Alert, Button, DocumentTabs, EmptyState, ListDetail, Rectangle, TabPanel, Tabs } from '@acorn/plugin-api/ui'
import { applyViewState, captureViewState, editorTheme, languageForPath, refreshEditorTheme, watchEditorTheme } from '@acorn/plugin-api/ui/editor'
import { editorApi } from './editorClient'
import { activeFile, editorActivate, editorClose, editorOpen, editorPromote, editorSetDirty, openFiles } from './editorState'
import { editorViewState, rememberEditorViewState } from './editorViewState'
import FileTree from './FileTree'
import { canRevealActiveFile, type FileTreeRevealRequest } from './fileTreeReveal'
import SearchPanel from './search/SearchPanel'

// The extension-to-language map and the editor theme live in the host (docs/editor.md § Status).

// The editor pane: a lazy file tree on the left, a file tab bar and one reused CodeMirror instance
// on the right. Single-click opens an ephemeral (italic) preview tab; editing or double-click
// promotes it. Cmd+S saves; a dirty dot marks the tab; reload-on-focus with a dirty guard, since the
// agent and the human share the worktree.
export default function EditorPane(props: { task: Task }) {
  const api = editorApi()
  const taskId = props.task.id
  const [root, setRoot] = createSignal<string | null | undefined>(undefined) // undefined = loading
  const [saveErr, setSaveErr] = createSignal('')
  const [pendingReveal, setPendingReveal] = createSignal<{ path: string; line: number; column?: number } | null>(null)
  const [treeReveal, setTreeReveal] = createSignal<FileTreeRevealRequest | null>(null)
  const [side, setSide] = createSignal<'files' | 'search'>('files')
  let treeRevealRevision = 0

  let host: HTMLElement | undefined
  let view: EditorView | undefined
  let stopTheme: (() => void) | undefined
  // One CodeMirror instance reused across tab switches, with the current path tracked explicitly
  // rather than read off props or signals mid-swap. Without that, a stale write lands in the wrong
  // file. A state per path is what a Monaco model used to be — text, undo history and the file's own
  // language — and unlike a model it needs no disposing, so closing a tab is a delete.
  let currentPath: string | null = null
  const states = new Map<string, EditorState>()
  const saved = new Map<string, Text>() // the document as last loaded or written

  const files = () => openFiles(taskId)
  const active = () => activeFile(taskId)
  let disposed = false

  // Cmd/Ctrl+W closes the active file tab when this pane is the focused one. The pane draws no
  // element of its own to test containment against, so it asks the host which pane has focus.
  onClosePaneWhen(() => focusedPane(taskId) === 'editor', () => {
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

  const isDirty = (path: string): boolean => {
    const was = saved.get(path)
    return !!view && !!was && !view.state.doc.eq(was)
  }

  // Stash the current file's scroll/cursor so it can be restored after a tab swap or a remount.
  const saveViewState = () => {
    if (view && currentPath) rememberEditorViewState(taskId, currentPath, captureViewState(view))
  }

  // Everything a file's own state carries beyond its text: the grammar, the theme, autosave, and the
  // explicit-flush chord. Built per path, because the language is the file's and the update listener
  // has to name the file it is reporting on.
  const perFile = (path: string): Extension[] => [
    basicSetup,
    editorTheme(),
    languageForPath(path),
    EditorView.updateListener.of((update) => {
      if (!update.docChanged) return
      // Dirty derives from the text versus the last saved text, so undoing back to the saved state
      // clears it.
      const dirty = isDirty(path)
      editorSetDirty(taskId, path, dirty)
      if (dirty) scheduleSave(path)
    }),
    EditorView.domEventHandlers({ blur: () => { scheduleSave.flush(); return false } }),
    // Highest precedence so the explicit flush wins over anything the library binds to the chord;
    // autosave still runs either way.
    Prec.highest(keymap.of([{ key: 'Mod-s', run: () => { void save(path); return true } }])),
  ]

  onMount(() => {
    onCleanup(() => {
      saveViewState() // pane unmounting (task/workspace switch), remember where we were
      disposed = true
      scheduleSave.flush()
      stopTheme?.()
      states.clear()
      saved.clear()
      view?.destroy()
      window.removeEventListener('focus', onFocus)
    })
    void (async () => {
      if (!api) return setRoot(null)
      const r = await api.root(taskId)
      if (disposed) return
      setRoot(r) // renders the host div synchronously when truthy
      if (!r || !host) return
      // An empty read-only state until a file is opened: the view always has one, so "no file" is a
      // document with nothing in it rather than a special case in every handler below.
      view = new EditorView({
        state: EditorState.create({ extensions: [basicSetup, editorTheme(), EditorState.readOnly.of(true)] }),
        parent: host,
      })
      stopTheme = watchEditorTheme(view)
      window.addEventListener('focus', onFocus)
      const restore = active()
      if (restore) void show(restore)
    })()
  })

  async function stateFor(relPath: string): Promise<EditorState | null> {
    if (disposed) return null
    const cached = states.get(relPath)
    if (cached) return cached
    const content = (await api?.read(taskId, relPath).catch(() => '')) ?? ''
    if (disposed) return null
    const state = EditorState.create({ doc: content, extensions: perFile(relPath) })
    saved.set(relPath, state.doc)
    states.set(relPath, state)
    return state
  }

  // Swaps the reused instance to a path. The only place currentPath changes.
  async function show(relPath: string) {
    if (!view) return
    scheduleSave.flush() // persist the outgoing file (pending arg is its path) before the swap
    saveViewState() // remember the outgoing file's scroll/cursor before we swap states
    setSaveErr('')
    // The outgoing file's state, with whatever the reader typed in it. `setState` hands the view a
    // new one, so the old instance is what has to go back in the cache.
    if (currentPath) states.set(currentPath, view.state)
    const state = await stateFor(relPath)
    if (disposed || !view || !state) return
    currentPath = relPath
    view.setState(state)
    // A cached state carries the theme it was built with, so a file opened before a theme change
    // comes back wearing the old one until this line.
    refreshEditorTheme(view)
    const remembered = editorViewState(taskId, relPath)
    if (remembered) applyViewState(view, remembered)
    editorActivate(taskId, relPath)
    maybeReveal(relPath)
  }

  // Consumes a pending cross-pane reveal for the file just shown: centers the target position and
  // places the cursor there. One-shot, cleared once applied so it does not re-fire on the next tab
  // switch.
  function maybeReveal(relPath: string) {
    const r = pendingReveal()
    if (!view || !r || r.path !== relPath) return
    const doc = view.state.doc
    const line = doc.line(Math.min(Math.max(1, r.line), doc.lines))
    const pos = Math.min(line.from + Math.max(0, (r.column ?? 1) - 1), line.to)
    view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'center' }) })
    view.focus()
    setPendingReveal(null)
  }

  const applyPaneIntent = (intent: PaneIntent | undefined) => {
    if (!intent) return
    // ⌘⇧F and the "Find in files…" palette row.
    if (intent.kind === 'editor:search') {
      setSide('search')
      return
    }
    if (intent.kind !== 'editor:reveal') return
    setPendingReveal({ path: intent.path, line: intent.line, column: intent.column })
    // Reveal implies open: cross-pane senders such as find-in-files and stack frames reach this only
    // through the core intent bus and cannot call editorOpen. No-op when the tab is already current.
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

  // The document for a path, which is the live view's when that path is the one on screen and the
  // cached state's otherwise. A debounced save can land after a tab swap, so this is not always the
  // file the reader is looking at.
  const docFor = (path: string): Text | undefined =>
    (view && path === currentPath ? view.state.doc : states.get(path)?.doc)

  async function save(p: string | null = currentPath) {
    const doc = p ? docFor(p) : undefined
    if (!api || !p || !doc) return
    const res = await api.write(taskId, p, doc.toString())
    if (disposed) return
    if (!res.ok) return setSaveErr(res.reason ?? 'Save failed')
    saved.set(p, doc)
    // Still-dirty if the user typed more during the async write.
    editorSetDirty(taskId, p, !docFor(p)?.eq(doc))
  }

  async function close(relPath: string) {
    scheduleSave.cancel()
    await save(relPath) // autosave: persist before we discard the state
    if (disposed) return
    editorClose(taskId, relPath) // active() moves to the neighbour; the effect swaps the surface
    states.delete(relPath)
    saved.delete(relPath)
  }

  // External-change reload on window focus: the agent edits the same worktree. A clean document
  // reloads silently; a dirty one is guarded so it never clobbers unsaved human edits.
  //
  // A raw window listener, and it stays one: this is a desktop-host fact about the app regaining
  // focus, the platform seam carries no signal for it, and it is the same rectangle-adjacent
  // territory as the editor's own DOM (docs/editor.md § Reload on focus).
  async function onFocus() {
    const p = currentPath
    const doc = p ? docFor(p) : undefined
    if (!api || !p || !doc || !view) return
    const file = files().find((x) => x.path === p)
    if (file?.dirty) return
    const disk = await api.read(taskId, p).catch(() => null)
    if (disposed || !view || disk == null || currentPath !== p || disk === view.state.doc.toString()) return
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: disk } })
    saved.set(p, view.state.doc)
    editorSetDirty(taskId, p, false)
  }

  // Single driver for the reused surface. The state swaps here whenever the active file changes,
  // whether from a task switch, a tree click, a tab close, or the quick-open palette. Deferred so
  // onMount owns the first paint.
  createEffect(
    on(active, (next) => {
      if (!view) return
      if (next && next !== currentPath) void show(next)
      else if (!next) {
        if (currentPath) states.set(currentPath, view.state)
        currentPath = null
        view.setState(EditorState.create({ extensions: [basicSetup, editorTheme(), EditorState.readOnly.of(true)] }))
      }
    }, { defer: true }),
  )

  return (
    <Show when={root() !== undefined} fallback={<EmptyState busy>Loading…</EmptyState>}>
      <Show when={root()} fallback={<EmptyState>Open a terminal first to map this repo's checkout.</EmptyState>}>
        <ListDetail
          listLabel="Editor sidebar"
          list={
            <>
              <Tabs
                tabs={[{ id: 'files', label: 'Files' }, { id: 'search', label: 'Search' }]}
                active={side()}
                onChange={(id) => setSide(id === 'search' ? 'search' : 'files')}
                idPrefix="editor-side"
                ariaLabel="Editor sidebar"
              />
              {/* Both stay mounted; the hidden one keeps its scroll, its open folders and its results.
                  `TabPanel` owns the hidden-but-mounted half, which this pane used to spell as an
                  inline `display: none` beside six hand-written tab attributes. */}
              <TabPanel idPrefix="editor-side" id="files" active={side()}>
                <FileTree
                  taskId={taskId}
                  onOpen={(p) => openPath(p, true)}
                  openPath={active()}
                  reveal={treeReveal()}
                  onRevealed={(revision) => {
                    setTreeReveal((request) => request?.revision === revision ? null : request)
                  }}
                />
              </TabPanel>
              <SearchPanel taskId={taskId} active={side() === 'search'} />
            </>
          }
        >
          {/* Was a hand-rolled strip: the dirty state was a string-concatenated ●, the close
              button was mouse-only, and there were no arrow keys. */}
          <DocumentTabs
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
                    tip="Add file/selection reference to the agent composer"
                    onPress={() => {
                      const p = currentPath
                      if (!p || !view) return
                      const range = view.state.selection.main
                      const doc = view.state.doc
                      const ref = range.empty
                        ? formatFileReference(p)
                        : formatFileReference(p, doc.lineAt(range.from).number, doc.lineAt(range.to).number)
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
          {/* CodeMirror owns these pixels — its own DOM, its own keyboard, its own scrolling — so the
              pane hands it a box rather than a tree. `mount` is the element it attaches to, drawn by
              the host (ui/Rectangle.tsx). */}
          <Rectangle kind="editor" label="Editor" mount={(element) => { host = element }} />
        </ListDetail>
      </Show>
    </Show>
  )
}
