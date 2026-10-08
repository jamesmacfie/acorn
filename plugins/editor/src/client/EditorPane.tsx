import { createEffect, createMemo, createSignal, lazy, on, onCleanup, onMount, Show } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import type { EditorState, Extension } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { activeNodeId, queryOwner, activeTaskId, clientEvents, consumePaneIntent, createLogger, debounce, focusedPane, formatFileReference, onClosePaneWhen, type PaneIntent, paneModel, prefsOptions, registerCommands, sendReferenceToAgent, telemetryFor, toast, type Task, wsOnNodeEvent, wsOnPluginsChanged, wsOnReconnect } from '@acorn/plugin-api/client'
import { Alert, Button, ConfirmButton, copyText, DocumentTabs, EmptyState, Icon, IconButton, Input, ListDetail, Menu, Only, paneCollapseKey, Rectangle, sidebarCollapse, TabPanel, Tabs, ToggleButton } from '@acorn/plugin-api/ui'
import { documentCustody, recoverDocumentCustody, type DocumentCustody, applyViewState, captureViewState, editorTheme, languageForPath, refreshEditorTheme, shouldHighlightDocument, watchEditorTheme } from '@acorn/plugin-api/ui/editor'
import { assertCanRebindEditorFile, createEditorDocumentPool, flushEditorDocument, rebindEditorFile, type EditorPool, type PooledFile } from './editorDocumentPool'
import { captureFileDecision, createEditorRefreshQueue, fileDecisionIsCurrent, reconcileEditorDisk, type FileDecision } from './editorDocumentLifecycle'
import { editorApi, editorRootKey, EDITOR_ROOT_STALE_MS } from './editorClient'
import { readEditorMode, saveEditorMode } from './editorPrefs'
import { activeFile, editorActivate, editorClose, editorOpen, editorPromote, editorReopen, editorSetDirty, editorTabIdentity, openFiles, requestEditorReveal } from './editorState'
import { editorViewState, forgetEditorViewState, rememberEditorViewState } from './editorViewState'
import FileTree from './FileTree'
import { createFileActionModel } from './fileActionModel'
import { persistCapturedEditorOpenFiles } from './openFilesSlice'
import { canRevealActiveFile, type FileTreeRevealRequest } from './fileTreeReveal'
import { HOST } from '@acorn/plugin-api/ui/tokens'
import SearchPanel from './search/SearchPanel'
import { imageTypeForPath } from '../contract/imagePreview'
import { markerRevision } from './markerRevision'
import type { EditorReadResult } from '../contract/api'
import { createFileStatusReader } from './fileStatusReader'
import { historyIsCurrent, historyStep, navigate, nextClosed, noteActivated, noteClosed, takeClosedIfCurrent, type EditorLocation } from './editorNavigation'
import { tabLabels } from './tabLabels'

// Only ever mounted in terminal mode, and it drags xterm in with it.
const EditorTerminal = lazy(() => import('./EditorTerminal'))
const ImagePreview = lazy(() => import('./ImagePreview'))
const EditorComparison = lazy(() => import('./EditorComparison'))
const log = createLogger('editor', 'editor')
const telemetry = telemetryFor('editor')

// The extension-to-language map and the editor theme live in the host (docs/editor.md § The shared surface).

// The editor pane: a lazy file tree on the left, a file tab bar and one reused CodeMirror instance
// on the right. Single-click opens an ephemeral (italic) preview tab; editing or double-click
// promotes it. Cmd+S saves; a dirty dot marks the tab; reload-on-focus with a dirty guard, since the
// agent and the human share the worktree.
//
// A reader who lives in vim can have the same box hold `$EDITOR` in a throwaway PTY instead
// (docs/editor/editor-pane.md § Editing in your own editor). One device preference switches it, graphical is the
// default, and everything to the left of the box is untouched either way.
export default function EditorPane(props: { task: Task }) {
  let engine: typeof import('./editorEngine') | undefined
  let surfaceGeneration = 0
  const warmedText = new Map<string, Promise<EditorReadResult>>()
  const graphical = HOST === 'dom'
  const queryClient = useQueryClient()
  const registeredNode = queryOwner(queryClient)
  const nodeId = registeredNode === undefined ? activeNodeId() : registeredNode
  const api = editorApi(queryClient)
  const taskId = props.task.id
  const fileStatus = createFileStatusReader(api, taskId, () => !disposed && activeNodeId() === nodeId)
  const [root, setRoot] = createSignal<string | null | undefined>(undefined) // undefined = loading
  const [saveErr, setSaveErr] = createSignal('')
  const [diskState, setDiskState] = createSignal<'changed' | 'deleted' | 'read-failed' | 'unknown' | 'recovered' | null>(null)
  const [armedDecision, setArmedDecision] = createSignal<FileDecision | null>(null)
  const [compare, setCompare] = createSignal(false)
  const [comparisonDisk, setComparisonDisk] = createSignal<EditorReadResult | null>(null)
  const [comparisonDraft, setComparisonDraft] = createSignal('')
  const [saveAsPath, setSaveAsPath] = createSignal('')
  const [pendingReveal, setPendingReveal] = createSignal<{ path: string; line: number; column?: number } | null>(null)
  const [treeReveal, setTreeReveal] = createSignal<FileTreeRevealRequest | null>(null)
  const [side, setSide] = createSignal<'files' | 'search'>('files')
  const [bulkRun, setBulkRun] = createSignal<{ cancel: () => void } | null>(null)
  const sidebarKey = paneCollapseKey('editor')
  const [, setSidebarCollapsed] = sidebarCollapse(sidebarKey)
  let treeRevealRevision = 0
  let replayScroll: number | null = null
  let replayPath: string | null = null
  let navigationGeneration = 0

  let view: EditorView | undefined
  let stopTheme: (() => void) | undefined
  // One CodeMirror instance reused across tab switches, with the current path tracked explicitly
  // rather than read off props or signals mid-swap. Without that, a stale write lands in the wrong
  // file.
  let currentPath: string | null = null
  let currentCustody: DocumentCustody | undefined
  let showGeneration = 0
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
  const activeTab = () => files().find((file) => file.path === active())
  // Keep tab definitions stable when only the active path changes. DocumentTabs reconciles by tab
  // object identity, so rebuilding every definition here would replace the focused tab on each
  // keyboard move even though the open files themselves had not changed.
  const documentTabs = createMemo(() => {
    const labels = tabLabels(files().map((file) => file.path))
    return files().map((file) => ({
    id: file.path,
    label: labels.get(file.path) ?? file.path,
    title: fileStatus.projection().files.get(file.path)
      ? `${file.path} — ${fileStatus.projection().files.get(file.path)!.label}${fileStatus.stale() ? ' (Git status may be stale)' : ''}`
      : file.path,
    fileStatus: fileStatus.projection().files.get(file.path),
    dirty: file.dirty,
    ephemeral: file.ephemeral,
    }))
  })
  let disposed = false
  let applyingAcknowledgement = false
  let reloadGeneration = 0
  const subscriptions = new Map<string, () => void>()
  const live = () => !disposed && !pool.retired && activeNodeId() === nodeId
  const refreshQueue = createEditorRefreshQueue(async (path) => {
    if (path === active()) await revalidate(path)
  })

  const captureDecision = (action: FileDecision['action'], destination?: string): FileDecision | null => {
    const path = active()
    const entry = path ? pool.files.get(path) : undefined
    if (!path || !entry || !live()) return null
    return captureFileDecision(action, nodeId, taskId, path, entry, destination)
  }
  const armDecision = (action: FileDecision['action']) => setArmedDecision(captureDecision(action))
  const confirmDecision = (action: FileDecision['action']): FileDecision | null => {
    const decision = armedDecision()
    setArmedDecision(null)
    if (decision && live() && fileDecisionIsCurrent(decision, action, nodeId, taskId, active(), pool.files.get(decision.path))) return decision
    setSaveErr('The document or disk version changed. Review it and confirm again.')
    return null
  }

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
    void copyText(text).then((copied) => toast(copied ? `Copied ${text}` : text))
  }

  const replay = async (direction: -1 | 1) => {
    const invocation = ++navigationGeneration
    while (live() && invocation === navigationGeneration) {
      const place = historyStep(nodeId, taskId, direction, location(active()))
      if (!place) return
      try { await api.read(taskId, place.path) }
      catch (cause) {
        if (!live() || invocation !== navigationGeneration || !historyIsCurrent(nodeId, taskId, place)) return
        if ((cause as { status?: number })?.status === 404) {
          toast(`Skipped unavailable file: ${place.path}`)
          continue
        }
        historyStep(nodeId, taskId, direction === 1 ? -1 : 1)
        toast(`Could not navigate to ${place.path}: ${cause instanceof Error ? cause.message : 'read failed'}`)
        return
      }
      if (!live() || invocation !== navigationGeneration || !historyIsCurrent(nodeId, taskId, place)) return
      replayPath = place.path
      replayScroll = place.scroll
      requestEditorReveal(taskId, place.path, place.line, place.column)
      return
    }
  }
  const reopen = async () => {
    if (!live()) return
    const invocation = ++navigationGeneration
    const closed = nextClosed(nodeId, taskId)
    if (!closed) return
    try { await api.read(taskId, closed.path) }
    catch (cause) {
      if (live() && invocation === navigationGeneration && nextClosed(nodeId, taskId) === closed) {
        if ((cause as { status?: number })?.status === 404) takeClosedIfCurrent(nodeId, taskId, closed)
        toast(`Could not reopen ${closed.path}: ${cause instanceof Error ? cause.message : 'file unavailable'}`)
      }
      return
    }
    if (!live() || invocation !== navigationGeneration || !takeClosedIfCurrent(nodeId, taskId, closed)) return
    recordNavigation(closed.path)
    editorReopen(taskId, closed.path, closed.index)
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
    }, {
      id: 'editor.tabs.reopen-closed', title: 'Reopen closed file', category: 'navigation', palette: true,
      when: () => activeTaskId() === taskId && focusedPane(taskId) === 'editor',
      run: () => { void reopen() },
    }, {
      id: 'editor.navigation.back', title: 'Go back in editor', category: 'navigation', palette: true,
      when: () => activeTaskId() === taskId && focusedPane(taskId) === 'editor',
      run: () => { void replay(-1) },
    }, {
      id: 'editor.navigation.forward', title: 'Go forward in editor', category: 'navigation', palette: true,
      when: () => activeTaskId() === taskId && focusedPane(taskId) === 'editor',
      run: () => { void replay(1) },
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
  const location = (path: string | null): EditorLocation | null => {
    if (!path) return null
    const state = currentPath === path && view ? view.state : pool.files.get(path)?.state
    const place = currentPath === path && view ? captureViewState(view) : editorViewState(taskId, path, nodeId)
    const head = Math.min(place?.head ?? 0, state?.doc.length ?? 0)
    const line = state?.doc.lineAt(head)
    return { path, line: line?.number ?? 1, column: line ? head - line.from + 1 : 1, scroll: place?.scrollTop ?? 0 }
  }
  const recordNavigation = (path: string, line?: number, column?: number) => {
    navigationGeneration++
    const from = location(active())
    const to = location(path) ?? { path, line: 1, column: 1, scroll: 0 }
    if (line) { to.line = line; to.column = column ?? 1 }
    if (!from || from.path !== path || line !== undefined) navigate(nodeId, taskId, from, to)
  }
  const activatePath = (path: string) => {
    if (path === active()) return
    recordNavigation(path)
    editorActivate(taskId, path)
  }
  const fileActions = createFileActionModel(api, pool, taskId, nodeId, () => {
    scheduleSave.cancel()
    saveViewState()
    if (view && currentPath) remember(currentPath, view.state)
  }, (state) => persistCapturedEditorOpenFiles(queryClient, nodeId, taskId, state))

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
      if (compare() && currentPath === path) setComparisonDraft(update.state.doc.toString())
      // Dirty derives from the text versus the last saved text, so undoing back to the saved state
      // clears it.
      const dirty = isDirty(path)
      editorSetDirty(taskId, path, dirty)
      if ((dirty || entry.custody.writing) && !entry.custody.writeBlock) {
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
    fileStatus.refresh()
    onCleanup(() => {
      fileStatus.stop()
      // Flush first, then mark this mount gone: the flush is a save, and `save` below finishes its
      // bookkeeping either way now that the bookkeeping outlives the mount.
      scheduleSave.flush()
      disposed = true
      for (const held of menuHolds.values()) held.release()
      menuHolds.clear()
      menuTargets.clear()
      refreshQueue.stop()
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
      // (docs/editor/editor-pane.md § One round trip to text).
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
  createEffect(on(active, (path) => {
    if (!path || graphical && !imageTypeForPath(path)) return
    void api.entry(taskId, path).then(() => {
      if (live() && active() === path) noteActivated(nodeId, taskId, path)
    }).catch(() => {})
  }))
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
    if (previous) { pool.externalEditors.delete(previous); forget(previous) } // the PTY stopped owning this path
    if (path) pool.externalEditors.add(path)
    setPtyPath(path)
  }))

  const onEditorExit = (path: string, code: number) => {
    pool.externalEditors.delete(path)
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
    const loaded = recovery?.dirty ? undefined : await (warmedText.get(relPath) ?? api.read(taskId, relPath))
    const content = loaded?.text ?? recovery!.acknowledged.toString()
    warmedText.delete(relPath)
    if (!live() || !view || admitted !== surfaceGeneration || !files().some((file) => file.path === relPath)) return null
    // Optional grammar and marker work never gate usable text.
    const custody = recovery ?? documentCustody(address, content, loaded?.revision)
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
    if (recovery?.dirty) {
      custody.requiresResolution = true
      custody.writeBlock = 'Recovered draft: compare with disk before saving.'
      if (active() === relPath) setDiskState('unknown')
      void revalidate(relPath)
    }
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
      if (entry.custody.writeBlock && currentPath === path) scheduleSave.cancel()
      if (view && currentPath === path && !view.state.doc.eq(entry.custody.current)) {
        applyingAcknowledgement = true
        try { view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: entry.custody.current } }) }
        finally { applyingAcknowledgement = false }
        entry.state = entry.custody.state = view.state
      }
      editorSetDirty(taskId, path, entry.custody.dirty)
      if (!entry.custody.dirty) void refreshLineMarkers(path)
      if (entry.stale && !entry.custody.writing) void revalidate(path)
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
    const admitted = ++showGeneration
    scheduleSave.flush() // persist the outgoing file (pending arg is its path) before the swap
    saveViewState() // remember the outgoing file's scroll/cursor before we swap states
    setSaveErr('')
    setDiskState(null)
    setCompare(false)
    setComparisonDisk(null)
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
    if (disposed || !view || active() !== relPath || admitted !== showGeneration) return
    if (!state) { view.setState(emptyState()); return }
    const entryAtShow = pool.files.get(relPath)
    if (!entryAtShow) return
    if (entryAtShow.stale) await revalidate(relPath)
    if (!live() || !view || active() !== relPath || pool.files.get(relPath) !== entryAtShow || admitted !== showGeneration) return
    currentPath = relPath
    currentCustody = entryAtShow.custody
    noteActivated(nodeId, taskId, relPath)
    view.setState(adopt(relPath, entryAtShow))
    // A cached state carries the theme it was built with, so a file opened before a theme change
    // comes back wearing the old one until this line.
    refreshEditorTheme(view)
    const remembered = pool.files.get(relPath)?.custody.viewState ?? editorViewState(taskId, relPath, nodeId)
    if (remembered) applyViewState(view, remembered)
    maybeReveal(relPath)
    const entry = pool.files.get(relPath)
    if (entry && Date.now() - entry.markersReadAt > 2_000) void refreshLineMarkers(relPath)
    if (entry?.custody.writeBlock) void revalidate(relPath)
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
    if (replayScroll !== null) { view.scrollDOM.scrollTop = replayScroll; replayScroll = null }
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
    if (replayPath === intent.path) replayPath = null
    else recordNavigation(intent.path, intent.line, intent.column)
    setPendingReveal({ path: intent.path, line: intent.line, column: intent.column })
    // Reveal implies open: cross-pane senders such as find-in-files and stack frames reach this only
    // through the core intent bus and cannot call editorOpen. No-op when the tab is already current.
    editorOpen(taskId, intent.path, true)
    if (currentPath === intent.path) { maybeReveal(intent.path); noteActivated(nodeId, taskId, intent.path) }
  }
  onMount(() => {
    const off = clientEvents.on('presentation:pane-intent', ({ taskId: targetTaskId, paneId, intent }) => {
      if (targetTaskId === taskId && paneId === 'editor') applyPaneIntent(intent)
    })
    onCleanup(off)
  })
  createEffect(() => applyPaneIntent(consumePaneIntent(taskId, 'editor')))

  function openPath(relPath: string, ephemeral: boolean) {
    recordNavigation(relPath)
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
      if (live()) fileStatus.refresh()
      return !custody.dirty
    } catch (cause) {
      if (live()) setSaveErr(custody.writeBlock ? '' : cause instanceof Error ? cause.message : "Couldn't save this file.")
      if (custody.writeBlock && live()) void revalidate(p)
      return false
    }
  }

  function applyDiskRead(path: string, entry: PooledFile, disk: EditorReadResult, discardDraft: boolean): void {
    const custody = entry.custody
    const place = view && currentPath === path ? captureViewState(view) : custody.viewState
    const outcome = reconcileEditorDisk(entry, disk, discardDraft)
    setComparisonDisk(disk)
    if (outcome.kind === 'held') {
      setDiskState(outcome.status)
      if (custody.writeBlock) scheduleSave.cancel()
      return
    }
    if (outcome.kind === 'replace') {
      const state = engine!.EditorState.create({ doc: disk.text, extensions: perFile(path, entry.language) })
      entry.state = custody.state = state
      if (view && currentPath === path) {
        view.setState(state)
        if (place) applyViewState(view, place)
        remember(path, view.state)
      }
      void refreshLineMarkers(path)
    }
    saved.set(path, custody.acknowledged)
    editorSetDirty(taskId, path, false)
    setDiskState(null)
    setCompare(false)
    setSaveErr('')
  }

  async function reloadFromDisk(decision: FileDecision): Promise<void> {
    const { path, entry } = decision
    const generation = ++reloadGeneration
    try {
      const disk = await api.read(taskId, path)
      if (!live() || generation !== reloadGeneration || !fileDecisionIsCurrent(decision, 'reload', nodeId, taskId, active(), pool.files.get(path))) return
      if (entry.custody.writing) { entry.stale = true; return }
      if (disk.revision !== decision.disk?.revision) {
        entry.stale = true
        setSaveErr('The disk changed after confirmation was shown. Review it and confirm again.')
        void revalidate(path)
        return
      }
      applyDiskRead(path, entry, disk, true)
    } catch (cause) {
      if (live() && generation === reloadGeneration && fileDecisionIsCurrent(decision, 'reload', nodeId, taskId, active(), pool.files.get(path)))
        setSaveErr(cause instanceof Error ? cause.message : 'Unable to reload the file.')
    }
  }

  async function resolveWrite(decision: FileDecision): Promise<void> {
    const { path, destination, entry } = decision
    if (!live() || !fileDecisionIsCurrent(decision, decision.action, nodeId, taskId, active(), pool.files.get(path))) {
      setSaveErr('The document or disk version changed. Review it and confirm again.')
      return
    }
    if (decision.action === 'overwrite' && !decision.disk) { await revalidate(path); return }
    const destinationAddress = [nodeId, 'file', taskId, destination]
    try {
      if (destination !== path) assertCanRebindEditorFile(pool, path, destination, destinationAddress)
    } catch (cause) {
      setSaveErr(cause instanceof Error ? cause.message : 'The destination document is unavailable.')
      return
    }
    const resume = await entry.custody.suspendWrites()
    try {
      if (!fileDecisionIsCurrent(decision, decision.action, nodeId, taskId, active(), pool.files.get(path))) {
        setSaveErr('The document or disk version changed. Review it and confirm again.')
        return
      }
      if (destination !== path) assertCanRebindEditorFile(pool, path, destination, destinationAddress)
      const admitted = entry.custody.revision
      const draft = entry.custody.current.toString()
      const expected = decision.action === 'overwrite' ? decision.disk!.revision : null
      const result = await api.write(taskId, destination, draft, expected)
      if (!live() || pool.files.get(path) !== entry) return
      if (!result.ok) {
        setSaveErr(result.reason)
        if (destination === path) await revalidate(path)
        return
      }
      if (destination !== path) {
        // Rebinding can still lose a race to another open tab during the request. Keep source
        // recovery untouched until the new address is actually ours.
        rebindEditorFile(pool, path, destination, destinationAddress)
      }
      entry.custody.acknowledgeResolved(result.text, result.revision, admitted)
      entry.disk = { text: result.text, revision: result.revision }
      if (destination === path) {
        if (active() === path) { setDiskState(null); setCompare(false); setSaveErr('') }
        editorSetDirty(taskId, path, entry.custody.dirty)
      } else {
        const activeAtCompletion = active()
        subscriptions.get(path)?.()
        subscriptions.delete(path)
        editorClose(taskId, path)
        editorOpen(taskId, destination, false)
        if (activeAtCompletion && activeAtCompletion !== path) editorActivate(taskId, activeAtCompletion)
        setSaveAsPath('')
        if (activeAtCompletion === path) { setDiskState(null); setSaveErr('') }
      }
    } catch (cause) {
      if (live()) setSaveErr(cause instanceof Error ? cause.message : 'Unable to write the file.')
    } finally { resume() }
  }

  async function close(relPath: string, options: { identity?: object; canCommit?: () => boolean; focus?: boolean } = {}): Promise<boolean> {
    const tab = files().find((file) => file.path === relPath)
    if (!tab) return false
    const index = files().indexOf(tab)
    const identity = 'identity' in options ? options.identity : editorTabIdentity(taskId, relPath)
    if (!identity || editorTabIdentity(taskId, relPath) !== identity) return false
    scheduleSave.cancel()
    const entry = pool.files.get(relPath)
    const revision = entry?.custody.revision
    if (entry && !await save(relPath)) return false
    if (!live() || pool.files.get(relPath) !== entry || entry?.custody.revision !== revision || entry?.custody.dirty
      || editorTabIdentity(taskId, relPath) !== identity || options.canCommit?.() === false) return false
    noteClosed(nodeId, taskId, { path: relPath, index })
    editorClose(taskId, relPath)
    subscriptions.get(relPath)?.()
    subscriptions.delete(relPath)
    entry?.release()
    pool.files.delete(relPath)
    saved.delete(relPath)
    forgetEditorViewState(taskId, relPath, nodeId)
    if (options.focus !== false && HOST === 'dom') queueMicrotask(focusSurvivor)
    return true
  }

  const focusSurvivor = () => {
    if (!live() || HOST !== 'dom') return
    const path = active()
    if (path) document.getElementById(`editor-tab-${path}`)?.focus()
    else view?.focus()
  }

  const closeMany = async (paths: readonly string[]) => {
    if (bulkRun()) return
    const targets = paths.map((path) => ({ path, identity: editorTabIdentity(taskId, path) }))
    let canceled = false
    const run = { cancel: () => { canceled = true } }
    setBulkRun(run)
    let closed = 0
    try {
      for (const target of targets) {
        if (canceled || !await close(target.path, { identity: target.identity, canCommit: () => !canceled, focus: false })) {
          if (live()) {
            const message = `Closed ${closed} of ${targets.length} files. ${canceled ? 'Canceled' : `Stopped at ${target.path}; review its draft or disk state`}.`
            setSaveErr(message)
            toast(message)
          }
          return
        }
        closed++
      }
    } finally {
      if (!disposed && bulkRun() === run) setBulkRun(null)
      if (live() && HOST === 'dom') queueMicrotask(focusSurvivor)
    }
  }
  const tabMenu = (path: string, control?: { open: () => boolean; onOpenChange: (open: boolean) => void }) => {
    const owner = {}
    onCleanup(() => releaseTabMenu(path, owner))
    if (control) {
      createEffect(() => { if (control.open()) prepareTabMenu(path, owner) })
    }
    return <Menu ariaLabel={`Actions for ${path}`} maxVisibleRows={9} open={control?.open} onBeforeOpen={() => prepareTabMenu(path, owner)}
      onOpenChange={(open) => { control?.onOpenChange(open); if (open) prepareTabMenu(path, owner); else releaseTabMenu(path, owner) }} trigger={({ toggle }) =>
      <IconButton icon="ellipsis" label={`Actions for ${path}`} onPress={toggle} />}
    >{(menu) => <>
      <Show when={files().find((file) => file.path === path)?.ephemeral}>
        <Menu.Item context={menu} onSelect={() => withTabTarget(path, () => editorPromote(taskId, path))}>Keep open</Menu.Item>
      </Show>
      <Menu.Item context={menu} onSelect={() => withTabTarget(path, (identity) => { void close(path, { identity }) })}>Close</Menu.Item>
      <Menu.Item context={menu} onSelect={() => withTabTarget(path, () => { void closeMany(files().filter((file) => file.path !== path).map((file) => file.path)) })}>Close others</Menu.Item>
      <Menu.Item context={menu} onSelect={() => withTabTarget(path, () => { void closeMany(files().slice(files().findIndex((file) => file.path === path) + 1).map((file) => file.path)) })}>Close to the right</Menu.Item>
      <Menu.Item context={menu} onSelect={() => withTabTarget(path, () => { void closeMany(files().map((file) => file.path)) })}>Close all</Menu.Item>
      <Menu.Separator />
      <Menu.Item context={menu} onSelect={() => withTabTarget(path, () => copyTabPath(path, false))}>Copy relative path</Menu.Item>
      <Menu.Item context={menu} onSelect={() => withTabTarget(path, () => copyTabPath(path, true))}>Copy absolute path</Menu.Item>
      <Menu.Item context={menu} onSelect={() => withTabTarget(path, () => revealTab(path))}>Reveal in file tree</Menu.Item>
    </>}</Menu>
  }
  const menuHolds = new Map<string, { owner: object; target: { identity: object | undefined }; release: () => void }>()
  const menuTargets = new Map<string, { identity: object | undefined }>()
  const withTabTarget = (path: string, action: (identity: object | undefined) => void) => {
    const identity = menuTargets.get(path)?.identity
    menuTargets.delete(path)
    if (!identity || editorTabIdentity(taskId, path) !== identity || !live()) return
    // The menu held this document before focus left CodeMirror. Release that hold before a
    // selected Close can enter the existing save guard; otherwise flush sees a suspended writer.
    const held = menuHolds.get(path)
    if (held) releaseTabMenu(path, held.owner)
    action(identity)
  }
  const prepareTabMenu = (path: string, owner: object) => {
    if (!live() || menuHolds.has(path)) return
    const identity = editorTabIdentity(taskId, path)
    const target = { identity }
    menuTargets.set(path, target)
    menuHolds.set(path, { owner, target, release: pool.files.get(path)?.custody.holdWrites() ?? (() => {}) })
  }
  const releaseTabMenu = (path: string, owner: object) => {
    const held = menuHolds.get(path)
    if (!held || held.owner !== owner) return
    menuHolds.delete(path)
    held.release()
    if (isDirty(path)) scheduleSave(path)
    queueMicrotask(() => { if (menuTargets.get(path) === held.target) menuTargets.delete(path) })
  }
  const copyTabPath = (path: string, absolute: boolean) => {
    const text = absolute && root() ? `${root()}/${path}` : path
    void copyText(text).then((copied) => toast(copied ? `Copied ${text}` : text))
  }
  const revealTab = (path: string) => {
    setSidebarCollapsed(false)
    setSide('files')
    setTreeReveal({ path, revision: ++treeRevealRevision })
  }

  // Worktree events have no path. Keep inactive entries stale and read only the visible file.
  // A generation rejects late responses after a newer request, tab switch, or pane retirement.
  async function revalidate(path: string): Promise<void> {
    const entry = pool.files.get(path)
    if (!entry || !live()) return
    if (entry.custody.writing) { entry.stale = true; return }
    const generation = ++reloadGeneration
    const editRevision = entry.custody.revision
    let disk: EditorReadResult
    try { disk = await api.read(taskId, path) }
    catch (cause) {
      if (!live() || generation !== reloadGeneration || pool.files.get(path) !== entry || active() !== path) return
      const missing = typeof cause === 'object' && cause !== null && 'status' in cause && cause.status === 404
        && 'code' in cause && cause.code === 'not_found'
      if (missing) entry.custody.writeBlock = 'Deleted on disk.'
      setDiskState(missing ? 'deleted' : 'read-failed')
      setCompare(false)
      setComparisonDisk(null)
      setSaveErr(missing ? '' : cause instanceof Error ? cause.message : 'Could not read this file.')
      return
    }
    if (!live() || generation !== reloadGeneration || pool.files.get(path) !== entry || active() !== path
      || entry.custody.revision !== editRevision) { entry.stale = true; return }
    entry.stale = false
    applyDiskRead(path, entry, disk, false)
  }

  const invalidate = () => {
    for (const entry of pool.files.values()) entry.stale = true
    const path = currentPath
    if (path) refreshQueue.request(path)
  }
  function onFocus() { invalidate(); fileStatus.refresh() }

  onMount(() => {
    const offWorktree = wsOnNodeEvent('worktree:status-changed', (event) => {
      if (event.taskId === taskId && activeNodeId() === nodeId) { invalidate(); fileStatus.refresh() }
    })
    const offReconnect = wsOnReconnect(() => { if (activeNodeId() === nodeId) { invalidate(); fileStatus.refresh() } })
    const offPlugins = wsOnPluginsChanged(() => { if (activeNodeId() === nodeId) fileStatus.providerChanged() })
    onCleanup(() => { offWorktree(); offReconnect(); offPlugins() })
  })

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
                  fileStatus={fileStatus.projection}
                  statusStale={fileStatus.stale}
                  onStatusChanged={fileStatus.refresh}
                  actions={fileActions}
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
            onActivate={activatePath}
            onClose={(path) => void close(path)}
            onPromote={(path) => editorPromote(taskId, path)}
            menu={tabMenu}
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
                  <Show when={activeTab()?.dirty} fallback={
                    <Button size="sm" variant="bare" onPress={() => { const path = active(); if (path) void revalidate(path) }}>Reload from disk</Button>
                  }>
                    <ConfirmButton size="sm" variant="bare" timeoutMs={10_000}
                      confirmLabel={`Discard ${armedDecision()?.path ?? active()} and reload?`}
                      onArm={() => armDecision('reload')}
                      onConfirm={() => { const decision = confirmDecision('reload'); if (decision) void reloadFromDisk(decision) }}
                    >Reload from disk</ConfirmButton>
                  </Show>
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
          <Show when={bulkRun()}>{(run) => <Alert variant="banner" tone="warn">Closing files… <Button onPress={() => run().cancel()}>Cancel close</Button></Alert>}</Show>
          <Show when={saveErr()}><Alert variant="banner" tone="danger">{saveErr()}</Alert></Show>
          <Show when={active() && diskState()}>
            <Alert variant="banner" tone="warn">
              {diskState() === 'deleted' ? 'Deleted on disk' : diskState() === 'read-failed' ? 'Could not read disk' : diskState() === 'recovered' ? 'Recovered draft' : 'Changed on disk'}
              <Button onPress={() => { const path = active(); if (path) void revalidate(path) }}>Reload status</Button>
              <Show when={diskState() !== 'deleted' && diskState() !== 'read-failed'}>
                <Button onPress={() => { setComparisonDisk(pool.files.get(active()!)?.disk ?? null); setComparisonDraft(pool.files.get(active()!)?.custody.current.toString() ?? ''); setCompare((shown) => !shown) }}>Compare</Button>
              </Show>
              <ConfirmButton timeoutMs={10_000}
                confirmLabel={`Discard ${armedDecision()?.path ?? active()} and reload from disk?`}
                onArm={() => armDecision('reload')}
                onConfirm={() => { const decision = confirmDecision('reload'); if (decision) void reloadFromDisk(decision) }}
              >Reload from disk</ConfirmButton>
              <Show when={diskState() === 'changed' || diskState() === 'unknown' || diskState() === 'recovered'}>
                <ConfirmButton timeoutMs={10_000}
                  confirmLabel={`Overwrite ${armedDecision()?.path ?? active()} at the shown disk version?`}
                  onArm={() => armDecision('overwrite')}
                  onConfirm={() => { const decision = confirmDecision('overwrite'); if (decision) void resolveWrite(decision) }}
                >Overwrite disk…</ConfirmButton>
              </Show>
              <Show when={diskState() === 'deleted'}>
                <ConfirmButton timeoutMs={10_000}
                  confirmLabel={`Recreate ${armedDecision()?.path ?? active()}?`}
                  onArm={() => armDecision('recreate')}
                  onConfirm={() => { const decision = confirmDecision('recreate'); if (decision) void resolveWrite(decision) }}
                >Recreate file…</ConfirmButton>
                <Input label="Save as path" value={saveAsPath()} onInput={setSaveAsPath} />
                <Button onPress={() => { const decision = saveAsPath() && captureDecision('save-as', saveAsPath()); if (decision) void resolveWrite(decision) }}>Save as…</Button>
              </Show>
            </Alert>
          </Show>
          <Show when={active() && saveErr() && !diskState()}><Button onPress={() => void save(active())}>Retry save</Button></Show>
          <Show when={compare() ? comparisonDisk() : undefined}>
            {(snapshot) => <EditorComparison path={active()!} disk={snapshot().text} draft={comparisonDraft()} />}
          </Show>
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
