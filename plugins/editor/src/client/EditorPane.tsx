import { createEffect, createMemo, createSignal, lazy, on, onCleanup, onMount, Show } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import type { EditorState, Extension } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { activeNodeId, queryOwner, activeTaskId, clientEvents, consumePaneIntent, createLogger, debounce, focusedPane, formatFileReference, onClosePaneWhen, type PaneIntent, paneModel, prefsOptions, registerCommands, sendReferenceToAgent, telemetryFor, toast, type Task } from '@acorn/plugin-api/client'
import { Alert, DocumentTabs, EmptyState, Icon, IconButton, ListDetail, Only, paneCollapseKey, Rectangle, sidebarCollapse, TabPanel, Tabs, ToggleButton } from '@acorn/plugin-api/ui'
import { documentCustody, recoverDocumentCustody, type DocumentCustody, applyViewState, captureViewState, editorTheme, languageForPath, refreshEditorTheme, shouldHighlightDocument, watchEditorTheme } from '@acorn/plugin-api/ui/editor'
import { createEditorDocumentPool, flushEditorDocument, type EditorPool, type PooledFile } from './editorDocumentPool'
import { editorApi, editorRootKey, EDITOR_ROOT_STALE_MS } from './editorClient'
import { readEditorMode, saveEditorMode } from './editorPrefs'
import { activeFile, editorActivate, editorClose, editorOpen, editorPromote, editorSetDirty, openFiles } from './editorState'
import { editorViewState, forgetEditorViewState, rememberEditorViewState } from './editorViewState'
import FileTree from './FileTree'
import { canRevealActiveFile, type FileTreeRevealRequest } from './fileTreeReveal'
import { HOST } from '@acorn/plugin-api/ui/tokens'
import SearchPanel from './search/SearchPanel'
import { imageTypeForPath } from '../contract/imagePreview'
import { markerRevision } from './markerRevision'

// Only ever mounted in terminal mode, and it drags xterm in with it.
const EditorTerminal = lazy(() => import('./EditorTerminal'))
const ImagePreview = lazy(() => import('./ImagePreview'))
const log = createLogger('editor', 'editor')
const telemetry = telemetryFor('editor')

// The extension-to-language map and the editor theme live in the host (docs/editor.md § Status).

// The editor pane: a lazy file tree on the left, a file tab bar and one reused CodeMirror instance
// on the right. Single-click opens an ephemeral (italic) preview tab; editing or double-click
// promotes it. Cmd+S saves; a dirty dot marks the tab; reload-on-focus with a dirty guard, since the
// agent and the human share the worktree.
//
// A reader who lives in vim can have the same box hold `$EDITOR` in a throwaway PTY instead
// (docs/editor.md § Editing in your own editor). One device preference switches it, graphical is the
// default, and everything to the left of the box is untouched either way.
export default function EditorPane(props: { task: Task }) {
  let engine: typeof import('./editorEngine') | undefined
  let surfaceGeneration = 0
  const warmedText = new Map<string, Promise<string>>()
  const graphical = HOST === 'dom'
  const queryClient = useQueryClient()
  const registeredNode = queryOwner(queryClient)
  const nodeId = registeredNode === undefined ? activeNodeId() : registeredNode
  const api = editorApi(queryClient)
  const taskId = props.task.id
  const [root, setRoot] = createSignal<string | null | undefined>(undefined) // undefined = loading
  const [saveErr, setSaveErr] = createSignal('')
  const [pendingReveal, setPendingReveal] = createSignal<{ path: string; line: number; column?: number } | null>(null)
  const [treeReveal, setTreeReveal] = createSignal<FileTreeRevealRequest | null>(null)
  const [side, setSide] = createSignal<'files' | 'search'>('files')
  const sidebarKey = paneCollapseKey('editor')
  const [, setSidebarCollapsed] = sidebarCollapse(sidebarKey)
  let treeRevealRevision = 0

  let view: EditorView | undefined
  let stopTheme: (() => void) | undefined
  // One CodeMirror instance reused across tab switches, with the current path tracked explicitly
  // rather than read off props or signals mid-swap. Without that, a stale write lands in the wrong
  // file.
  let currentPath: string | null = null
  let currentCustody: DocumentCustody | undefined
  // The pane model retains open view states; the document owner retains failed dirty work.
  const pool = paneModel<EditorPool>('editor', taskId, () => createEditorDocumentPool(api, taskId))
  const saved = pool.saved
  // This mount's identity. A pooled state carries extensions — the update listener, the save chord —
  // that close over the mount that built them, and after a remount those closures point at a
  // destroyed view: typing would derive "not dirty" and never autosave. So a state built by an
  // earlier mount is reconfigured before it goes on screen, which keeps the document and the undo
  // history (both live in state fields that survive a reconfigure) and replaces the closures.
  const mountToken = {}

  const files = createMemo(() => openFiles(taskId))
  const active = () => activeFile(taskId)
  // Keep tab definitions stable when only the active path changes. DocumentTabs reconciles by tab
  // object identity, so rebuilding every definition here would replace the focused tab on each
  // keyboard move even though the open files themselves had not changed.
  const documentTabs = createMemo(() => files().map((file) => ({
    id: file.path,
    label: file.path.split('/').pop() ?? file.path,
    title: file.path,
    dirty: file.dirty,
    ephemeral: file.ephemeral,
  })))
  let disposed = false
  let applyingAcknowledgement = false
  let reloadGeneration = 0
  const subscriptions = new Map<string, () => void>()
  const live = () => !disposed && !pool.retired && activeNodeId() === nodeId

  /** Put a file's live state back in the pool. Only for a file still open: `close()` deletes its
   *  entry after flushing it, and re-adding it there would keep a closed file's text forever. */
  const remember = (path: string, state: EditorState) => {
    const entry = pool.files.get(path)
    if (!entry || pool.retired || !files().some((file) => file.path === path)) return
    entry.custody.state = state
    entry.state = state
    entry.mount = mountToken
  }

  /** A pooled state, made this mount's own. Cheap and synchronous when it already is. */
  const adopt = (path: string, entry: PooledFile): EditorState => {
    watchCustody(path, entry)
    entry.state = entry.custody.state ?? entry.state
    if (entry.mount === mountToken) return entry.state
    entry.state = entry.state.update({ effects: engine!.StateEffect.reconfigure.of(perFile(path, entry.language)) }).state
    entry.mount = mountToken
    entry.custody.state = entry.state
    return entry.state
  }

  // Cmd/Ctrl+W closes the active file tab when this pane is the focused one. The pane draws no
  // element of its own to test containment against, so it asks the host which pane has focus.
  onClosePaneWhen(() => focusedPane(taskId) === 'editor', () => {
    const p = active()
    if (p) void close(p)
  })

  const revealActiveFile = () => {
    const path = active()
    if (!path) return
    setSidebarCollapsed(false)
    setSide('files') // the tree is one of two things the sidebar shows; revealing into a hidden one is a no-op
    setTreeReveal({ path, revision: ++treeRevealRevision })
  }

  // The open file's path is relative to the checkout, and the root is the checkout's absolute path.
  const copyPath = (absolute: boolean) => {
    const path = active()
    const checkout = root()
    if (!path || !checkout) return
    const text = absolute ? `${checkout}/${path}` : path
    void navigator.clipboard.writeText(text)
    toast(`Copied ${text}`)
  }

  onMount(() => {
    // All three need the same thing: this task on screen, the editor focused, a file open, and a
    // checkout mapped.
    const when = () => canRevealActiveFile({
      paneTaskId: taskId,
      activeTaskId: activeTaskId(),
      focusedPane: focusedPane(taskId),
      activeFile: active(),
      treeAvailable: !!root(),
    })
    const commands = registerCommands([{
      id: 'editor.tree.reveal-active-file',
      title: 'Reveal active file in editor tree',
      category: 'navigation',
      hint: () => active() ?? undefined,
      palette: true,
      when,
      run: revealActiveFile,
    }, {
      id: 'editor.copy-relative-path',
      title: 'Copy relative path of active file',
      category: 'action',
      hint: () => active() ?? undefined,
      palette: true,
      when,
      run: () => copyPath(false),
    }, {
      id: 'editor.copy-absolute-path',
      title: 'Copy absolute path of active file',
      category: 'action',
      hint: () => active() ?? undefined,
      palette: true,
      when,
      run: () => copyPath(true),
    }])
    onCleanup(() => commands.dispose())
  })

  // Autosave (no Save button): debounce while typing, flush on blur / tab-switch / close.
  const scheduleSave = debounce((p: string) => void save(p), 1500)

  const isDirty = (path: string): boolean => pool.files.get(path)?.custody.dirty ?? false

  // Stash the current file's scroll/cursor so it can be restored after a tab swap or a remount.
  const saveViewState = () => {
    if (view && currentPath) {
      if (!files().some((file) => file.path === currentPath) && !currentCustody?.dirty && !currentCustody?.writing) {
        forgetEditorViewState(taskId, currentPath, nodeId)
        return
      }
      const state = captureViewState(view)
      rememberEditorViewState(taskId, currentPath, state, nodeId)
      const custody = currentCustody ?? pool.files.get(currentPath)?.custody
      if (custody) { custody.state = view.state; custody.viewState = state; custody.flushRecovery() }
    }
  }

  // Everything a file's own state carries beyond its text: the grammar, the theme, autosave, and the
  // explicit-flush chord. Built per path, because the language is the file's and the update listener
  // has to name the file it is reporting on.
  // Grammar installation follows usable text and stays within the same document entry.
  const perFile = (path: string, language: Extension): Extension[] => [
    engine!.basicSetup,
    editorTheme(),
    engine!.lineMarkerExtension(),
    language,
    engine!.EditorView.updateListener.of((update) => {
      if (!update.docChanged || applyingAcknowledgement || !live()) return
      const entry = pool.files.get(path)
      if (!entry) return
      entry.state = entry.custody.state = update.state
      entry.custody.edit(update.state.doc)
      // Dirty derives from the text versus the last saved text, so undoing back to the saved state
      // clears it.
      const dirty = isDirty(path)
      editorSetDirty(taskId, path, dirty)
      if (dirty || entry.custody.writing) {
        scheduleSave(path)
      } else {
        scheduleSave.cancel()
        void refreshLineMarkers(path)
      }
    }),
    engine!.EditorView.domEventHandlers({ blur: () => { scheduleSave.flush(); return false } }),
    // Highest precedence so the explicit flush wins over anything the library binds to the chord;
    // autosave still runs either way.
    engine!.Prec.highest(engine!.keymap.of([{ key: 'Mod-s', run: () => { void save(path); return true } }])),
  ]

  // An empty read-only state until a file is opened: the view always has one, so "no file" is a
  // document with nothing in it rather than a special case in every handler below.
  const emptyState = () => engine!.EditorState.create({ extensions: [engine!.basicSetup, editorTheme(), engine!.EditorState.readOnly.of(true)] })

  // The graphical editor is built and torn down with its rectangle, because terminal mode replaces
  // that rectangle rather than hiding it. Nothing is lost across the swap: the per-file states stay in
  // the cache, so coming back restores the text, the undo history and the cursor.
  const mountEditor = (element: HTMLElement) => {
    if (!graphical) return
    const admitted = ++surfaceGeneration
    void import('./editorEngine').then((loaded) => {
      if (!live() || admitted !== surfaceGeneration) return
      engine = loaded
      view = new loaded.EditorView({ state: emptyState(), parent: element })
      stopTheme = watchEditorTheme(view)
      const restore = active()
      if (restore) void show(restore)
    }).catch((cause: unknown) => {
      if (live() && admitted === surfaceGeneration) setSaveErr(cause instanceof Error ? cause.message : 'Unable to load editor.')
    })
    onCleanup(() => {
      surfaceGeneration++
      scheduleSave.flush()
      saveViewState()
      if (view && currentPath) remember(currentPath, view.state)
      currentPath = null
      currentCustody = undefined
      stopTheme?.()
      stopTheme = undefined
      view?.destroy()
      view = undefined
    })
  }

  // Reload-on-focus, where there is a window to lose focus. A host without one — the terminal client
  // runs this pane under Node — has nothing to listen to, and reaching for the listener took the whole
  // pane down: the throw landed inside the mount and the pane drew nothing at all
  // (docs/tui.md). The agent and the human still share the worktree
  // there; what a reader gets instead of the automatic reload is the pane's own refetch.
  const watchFocus = (add: boolean): void => {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return
    if (add) window.addEventListener('focus', onFocus)
    else window.removeEventListener('focus', onFocus)
  }

  onMount(() => {
    onCleanup(() => {
      // Flush first, then mark this mount gone: the flush is a save, and `save` below finishes its
      // bookkeeping either way now that the bookkeeping outlives the mount.
      scheduleSave.flush()
      disposed = true
      warmedText.clear()
      for (const unsubscribe of subscriptions.values()) unsubscribe()
      subscriptions.clear()
      // A pane replaced during navigation must not leave its remembered-file warm-up owning later
      // renderer work. The request may still finish, but `readFile` drops it before CodeMirror state
      // creation; removing its entry lets a new mount start a read that belongs to the visible pane.
      for (const [path, reading] of pool.reading) {
        if (reading.mount === mountToken) pool.reading.delete(path)
      }
      // The pool stays: it belongs to the task, not to this mount (see EditorPool above).
      watchFocus(false)
    })
    void (async () => {
      if (!api) return setRoot(null)
      // Opening this pane used to be three steps in a row — read the root, mount the rectangle the
      // root gated, read the file — of which two are requests. The file the reader left open does not
      // depend on the root, so it is read now, beside it, and `show()` finds it already in the pool
      // (docs/editor.md § One round trip to text).
      // Warm text under the host capability; imports and document state wait for surface admission.
      const remembered = active()
      if (graphical && mode() === 'graphical' && remembered && !imageTypeForPath(remembered)) {
        const read = api.read(taskId, remembered)
        warmedText.set(remembered, read)
        void read.catch(() => { if (warmedText.get(remembered) === read) warmedText.delete(remembered) })
      }
      // A checkout path already in the cache paints the rectangle in this tick, and the fetch below
      // returns it without a request while it is fresh. An absent root is never painted from the
      // cache: "no checkout yet" is the one thing that changes, so it is always awaited.
      const cached = queryClient.getQueryData<string | null>(editorRootKey(taskId))
      if (cached) setRoot(cached)
      const r = await queryClient.fetchQuery({
        queryKey: editorRootKey(taskId),
        queryFn: () => api.root(taskId),
        staleTime: EDITOR_ROOT_STALE_MS,
      }).catch(() => null)
      if (disposed) return
      setRoot(r) // renders the rectangle synchronously when truthy, and `mountEditor` builds the view
      if (!r) return
      watchFocus(true)
    })()
  })

  // Which editor draws an open file, and the one it is drawing right now. `on` re-fires on identity
  // rather than value, so its source is a memo and not an inline getter.
  const prefs = createQuery(() => prefsOptions(true))
  const mode = createMemo(() => readEditorMode(prefs.data))
  const imagePath = createMemo(() => mode() === 'graphical' && imageTypeForPath(active() ?? '') ? active() : null)
  const wantsTerminal = createMemo(() => (mode() === 'terminal' ? active() : null))
  const [ptyPath, setPtyPath] = createSignal<string | null>(null)

  // Whatever `$EDITOR` was pointed at is no longer what this pane has cached, so the cached state goes
  // and the graphical view reads the file back off disk when it next shows it. That is the whole
  // refresh contract: the editor in the PTY owned the buffer, and the pane never guessed at it.
  const forget = (path: string) => {
    const entry = pool.files.get(path)
    if (entry?.custody.dirty || entry?.custody.writing) return
    entry?.release()
    pool.files.delete(path)
    saved.delete(path)
    editorSetDirty(taskId, path, false)
  }

  createEffect(on(wantsTerminal, (path, previous) => {
    if (previous) forget(previous) // left mid-edit: the pref was flipped, or the reader changed tabs
    setPtyPath(path)
  }))

  const onEditorExit = (path: string, code: number) => {
    forget(path)
    setPtyPath(null)
    setSaveErr(code ? `Your editor exited with status ${code}.` : '')
  }

  // The pane's own read, deduplicated within this mount: the warm-up and the first `show()` ask for
  // the same file in the same tick, and one of them has to be the request. An unmounted pane's read
  // is deliberately not shared with its successor; its CodeMirror extensions close over this mount.
  function stateFor(relPath: string): Promise<EditorState | null> {
    if (!graphical || !view || !engine) return Promise.resolve(null)
    const cached = pool.files.get(relPath)
    if (cached) return Promise.resolve(adopt(relPath, cached))
    const inFlight = pool.reading.get(relPath)
    if (inFlight?.mount === mountToken) return inFlight.run
    let entry: { mount: object; run: Promise<EditorState | null> }
    const run = readFile(relPath).finally(() => {
      if (pool.reading.get(relPath) === entry) pool.reading.delete(relPath)
    })
    entry = { mount: mountToken, run }
    pool.reading.set(relPath, entry)
    return run
  }

  async function readFile(relPath: string): Promise<EditorState | null> {
    if (!api) throw new Error('Editor API is unavailable.')
    const admitted = surfaceGeneration
    const address = [nodeId, 'file', taskId, relPath]
    const recovery = recoverDocumentCustody(address)
    const content = recovery?.dirty ? recovery.acknowledged.toString() : await (warmedText.get(relPath) ?? api.read(taskId, relPath))
    warmedText.delete(relPath)
    if (!live() || !view || admitted !== surfaceGeneration || !files().some((file) => file.path === relPath)) return null
    // Optional grammar and marker work never gate usable text.
    const custody = recovery ?? documentCustody(address, content)
    const language: Extension = []
    const pooled = pool.files.get(relPath)
    if (pooled) return adopt(relPath, pooled) // a concurrent read got there first
    const highlighted = shouldHighlightDocument(content.length)
    if (!highlighted) telemetry.observe('editor.syntax.skipped', content.length, 'character', { reason: 'document-size' })
    let activeLanguage: Extension = highlighted ? language : []
    let state: EditorState
    try {
      state = telemetry.measure('editor.state.create', () => engine!.EditorState.create({
        doc: custody.current,
        extensions: perFile(relPath, activeLanguage),
      }), { highlighted })
    } catch (error) {
      // A grammar is optional presentation. If a parser rejects ordinary-sized input, keep the file
      // usable and report one bounded failure instead of rejecting `show()` into the window handler.
      if (!highlighted) throw error
      log.warn('syntax parser failed; opening the document as plain text', error, {
        'document.characters': content.length,
      })
      activeLanguage = []
      state = engine!.EditorState.create({ doc: custody.current, extensions: perFile(relPath, activeLanguage) })
    }
    if (custody.state) state = custody.state.update({ effects: engine!.StateEffect.reconfigure.of(perFile(relPath, activeLanguage)) }).state
    custody.state = state
    const entry: PooledFile = { state, custody, release: custody.retain(), language: activeLanguage, mount: mountToken, markersReadAt: 0, markersGeneration: 0 }
    saved.set(relPath, custody.acknowledged)
    pool.files.set(relPath, entry)
    watchCustody(relPath, entry)
    if (live()) editorSetDirty(taskId, relPath, custody.dirty)
    void refreshLineMarkers(relPath)
    if (highlighted) void languageForPath(relPath).then((grammar) => {
      if (!live() || pool.files.get(relPath) !== entry || (Array.isArray(grammar) && !grammar.length)) return
      entry.language = grammar
      if (!view) { entry.mount = {}; return }
      const effects = engine!.StateEffect.reconfigure.of(perFile(relPath, grammar))
      if (view && currentPath === relPath) {
        view.dispatch({ effects })
        remember(relPath, view.state)
      } else entry.state = custody.state = entry.state.update({ effects }).state
    }).catch(() => {})
    return state
  }

  function watchCustody(path: string, entry: PooledFile): void {
    if (subscriptions.has(path)) return
    subscriptions.set(path, entry.custody.subscribe(() => {
      if (pool.files.get(path) !== entry || pool.retired) return
      saved.set(path, entry.custody.acknowledged)
      entry.state = entry.custody.state ?? entry.state
      if (!live()) return
      if (entry.custody.error) setSaveErr(entry.custody.error)
      if (view && currentPath === path && !view.state.doc.eq(entry.custody.current)) {
        applyingAcknowledgement = true
        try { view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: entry.custody.current } }) }
        finally { applyingAcknowledgement = false }
        entry.state = entry.custody.state = view.state
      }
      editorSetDirty(taskId, path, entry.custody.dirty)
      if (!entry.custody.dirty) void refreshLineMarkers(path)
    }))
  }

  async function refreshLineMarkers(relPath: string): Promise<void> {
    const entry = pool.files.get(relPath)
    if (!api || !entry || entry.custody.dirty || entry.custody.writing) return
    entry.markersReadAt = Date.now()
    const generation = ++entry.markersGeneration
    const doc = entry.custody.current
    const revision = entry.custody.revision
    const bodyRevision = await markerRevision(doc.toString()).catch(() => null)
    if (!bodyRevision || !live() || generation !== entry.markersGeneration || entry.custody.revision !== revision) return
    const response = await api.lineMarkers(taskId, relPath, bodyRevision).catch(() => null)
    if (!response || response.revision !== bodyRevision || !live() || pool.files.get(relPath) !== entry || entry.custody.dirty || entry.custody.writing
      || generation !== entry.markersGeneration || entry.custody.revision !== revision || !entry.custody.current.eq(doc)) return
    const markers = response.markers
    if (view && currentPath === relPath) {
      view.dispatch({ effects: engine!.lineMarkerEffect(markers) })
      remember(relPath, view.state)
    } else entry.state = entry.custody.state = entry.state.update({ effects: engine!.lineMarkerEffect(markers) }).state
    entry.markersReadAt = Date.now()
  }

  // Swaps the reused instance to a path. The only place currentPath changes.
  async function show(relPath: string) {
    if (!view) return
    scheduleSave.flush() // persist the outgoing file (pending arg is its path) before the swap
    saveViewState() // remember the outgoing file's scroll/cursor before we swap states
    setSaveErr('')
    // The outgoing file's state, with whatever the reader typed in it. `setState` hands the view a
    // new one, so the old instance is what has to go back in the cache.
    if (currentPath) remember(currentPath, view.state)
    currentPath = null
    currentCustody = undefined
    if (!view.state.readOnly) view.dispatch({ effects: engine!.StateEffect.appendConfig.of([engine!.EditorState.readOnly.of(true), engine!.EditorView.editable.of(false)]) })
    const state = await stateFor(relPath).catch((cause: unknown) => {
      if (live() && active() === relPath) setSaveErr(cause instanceof Error ? cause.message : 'Could not load this file.')
      return null
    })
    // A read may finish after the reader chose another tab. Active state changes synchronously at
    // the interaction boundary; a stale read must not put its document on screen afterward.
    if (disposed || !view || active() !== relPath) return
    if (!state) { view.setState(emptyState()); return }
    currentPath = relPath
    currentCustody = pool.files.get(relPath)?.custody
    const entryAtShow = pool.files.get(relPath)
    if (!entryAtShow) return
    view.setState(adopt(relPath, entryAtShow))
    // A cached state carries the theme it was built with, so a file opened before a theme change
    // comes back wearing the old one until this line.
    refreshEditorTheme(view)
    const remembered = pool.files.get(relPath)?.custody.viewState ?? editorViewState(taskId, relPath, nodeId)
    if (remembered) applyViewState(view, remembered)
    maybeReveal(relPath)
    const entry = pool.files.get(relPath)
    if (entry && Date.now() - entry.markersReadAt > 2_000) void refreshLineMarkers(relPath)
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
    view.dispatch({ selection: { anchor: pos }, effects: engine!.EditorView.scrollIntoView(pos, { y: 'center' }) })
    view.focus()
    setPendingReveal(null)
  }

  const applyPaneIntent = (intent: PaneIntent | undefined) => {
    if (!intent) return
    // ⌘⇧F and the "Find in files…" palette row.
    if (intent.kind === 'editor:search') {
      setSidebarCollapsed(false)
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

  async function save(p: string | null = currentPath): Promise<boolean> {
    const entry = p ? pool.files.get(p) : undefined
    if (!api || !p || !entry) return false
    const custody = entry.custody
    const needsMarkers = custody.dirty || custody.writing
    try {
      await flushEditorDocument(custody, api, taskId, p)
      if (!pool.retired && pool.files.get(p) === entry) {
        saved.set(p, custody.acknowledged)
        if (activeNodeId() === nodeId) editorSetDirty(taskId, p, custody.dirty)
      }
      if (live()) setSaveErr('')
      if (needsMarkers && live() && !custody.dirty) void refreshLineMarkers(p)
      return !custody.dirty
    } catch (cause) {
      if (live()) setSaveErr(cause instanceof Error ? cause.message : "Couldn't save this file.")
      return false
    }
  }

  async function close(relPath: string) {
    scheduleSave.cancel()
    const entry = pool.files.get(relPath)
    const revision = entry?.custody.revision
    if (entry && !await save(relPath)) return
    if (!live() || pool.files.get(relPath) !== entry || entry?.custody.revision !== revision || entry?.custody.dirty) return
    editorClose(taskId, relPath)
    subscriptions.get(relPath)?.()
    subscriptions.delete(relPath)
    entry?.release()
    pool.files.delete(relPath)
    saved.delete(relPath)
    forgetEditorViewState(taskId, relPath, nodeId)
  }

  // External-change reload on window focus: the agent edits the same worktree. A clean document
  // reloads silently; a dirty one is guarded so it never clobbers unsaved human edits.
  //
  // A raw window listener, and it stays one: this is a desktop-host fact about the app regaining
  // focus, the platform seam carries no signal for it, and it is the same rectangle-adjacent
  // territory as the editor's own DOM (docs/editor.md § Reload on focus).
  async function onFocus() {
    const p = currentPath
    const entry = p ? pool.files.get(p) : undefined
    if (!api || !p || !entry || !view || entry.custody.dirty || entry.custody.writing) return
    const generation = ++reloadGeneration
    const revision = entry.custody.revision
    const doc = view.state.doc
    const disk = await api.read(taskId, p).catch(() => null)
    if (!live() || !view || disk == null || currentPath !== p || pool.files.get(p) !== entry
      || generation !== reloadGeneration || revision !== entry.custody.revision || entry.custody.dirty || !view.state.doc.eq(doc)) return
    if (disk !== view.state.doc.toString()) {
      entry.custody.reload(disk)
      applyingAcknowledgement = true
      try { view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: disk } }) }
      finally { applyingAcknowledgement = false }
      remember(p, view.state)
      saved.set(p, entry.custody.acknowledged)
      editorSetDirty(taskId, p, false)
    }
    void refreshLineMarkers(p)
  }

  createEffect(() => {
    const open = new Set(files().map((file) => file.path))
    for (const [path, entry] of pool.files) {
      if (open.has(path) || entry.custody.dirty || entry.custody.writing) continue
      subscriptions.get(path)?.()
      subscriptions.delete(path)
      entry.release()
      pool.files.delete(path)
      saved.delete(path)
      forgetEditorViewState(taskId, path, nodeId)
    }
  })

  // Single driver for the reused surface. The state swaps here whenever the active file changes,
  // whether from a task switch, a tree click, a tab close, or the quick-open palette. Deferred so
  // onMount owns the first paint.
  createEffect(
    on(active, (next) => {
      if (!view) return
      if (next && next !== currentPath) void show(next)
      else if (!next) {
        if (currentPath) remember(currentPath, view.state)
        currentPath = null
        currentCustody = undefined
        view.setState(emptyState())
      }
    }, { defer: true }),
  )

  return (
    <Show when={root() !== undefined} fallback={<EmptyState busy>Loading…</EmptyState>}>
      <Show when={root()} fallback={<EmptyState title="Can't find this task's files">Open a terminal in this task, then try again.</EmptyState>}>
        <ListDetail
          listLabel="Editor sidebar"
          collapseKey={sidebarKey}
          collapseContent="empty"
          list={
            <>
              <Tabs
                level="pane"
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
                  onOpen={openPath}
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
            level="pane"
            idPrefix="editor"
            ariaLabel="Open files"
            active={active() ?? ''}
            onActivate={(path) => editorActivate(taskId, path)}
            onClose={(path) => void close(path)}
            onPromote={(path) => editorPromote(taskId, path)}
            tabs={documentTabs()}
            actions={
              <>
                {/* Two glyphs rather than two words, which read as one phrase: a mode switch, and a
                    send. */}
                <ToggleButton
                  iconOnly
                  variant="bare"
                  size="sm"
                  label="Edit in your terminal editor"
                  tip="Edit in your terminal editor"
                  tipSub="Uses $EDITOR"
                  pressed={mode() === 'terminal'}
                  onPressedChange={(pressed) => void saveEditorMode(queryClient, pressed ? 'terminal' : 'graphical')}
                ><Icon name="square-terminal" /></ToggleButton>
                <Show when={active() && !imagePath()}>
                  <IconButton
                    icon="send"
                    label="Add to your message to the agent"
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
                  />
                </Show>
              </>
            }
          />
          {/* Under the strip rather than in it: a sentence does not fit a 48-pixel bar. */}
          <Show when={saveErr()}><Alert variant="banner" tone="danger">{saveErr()}</Alert></Show>
          {/* CodeMirror owns these pixels — its own DOM, its own keyboard, its own scrolling — so the
              pane hands it a box rather than a tree. `mount` is the element it attaches to, drawn by
              the host (ui/Rectangle.tsx). In terminal mode the same box holds the reader's own editor
              instead, keyed on the path so switching tabs starts a new one. */}
          <Show when={ptyPath()} fallback={
            <Show when={imagePath()} fallback={<Rectangle kind="editor" label="Editor" mount={mountEditor} />} keyed>
              {(path) => <>
                <Only hosts={['dom']}><ImagePreview taskId={taskId} path={path} /></Only>
                <Only hosts={['tui']}><EmptyState>Image preview is available in the desktop editor: {path}</EmptyState></Only>
              </>}
            </Show>
          } keyed>
            {(path) => <EditorTerminal taskId={taskId} path={path} onExit={(code) => onEditorExit(path, code)} />}
          </Show>
        </ListDetail>
      </Show>
    </Show>
  )
}
