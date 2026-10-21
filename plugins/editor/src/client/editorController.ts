import { createEffect, createMemo, createSignal, on, onCleanup, onMount } from 'solid-js'
import type { QueryClient } from '@tanstack/solid-query'
import type { EditorState, Extension } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { languageIdForPath } from '@acorn/protocol/languageIds.ts'
import {
  activeNodeId,
  activeTaskId,
  createLogger,
  debounce,
  documentSelection,
  featureUsable,
  formatFileReference,
  latestSignal,
  paneModel,
  queryOwner,
  resolveDocumentServices,
  sendReferenceToAgent,
  slotFills,
  telemetryFor,
  toast,
  wsOnNodeEvent,
  wsOnPluginsChanged,
  wsOnReconnect,
  type ContentSelectionTarget,
  type Task,
} from '@acorn/plugin-api/client'
import { HOST } from '@acorn/plugin-api/ui/tokens'
import {
  documentCustody,
  recoverDocumentCustody,
  type DocumentCustody,
  applyViewState,
  captureViewState,
  editorSearch,
  editorTheme,
  languageForPath,
  languageServices,
  refreshEditorTheme,
  refreshLanguageServices,
  shouldHighlightDocument,
  watchEditorTheme,
} from '@acorn/plugin-api/ui/editor'
import { EDITOR_DOCUMENT_POINT, type EditorDocumentProps } from '@acorn/protocol/extensionPoints.ts'
import {
  assertCanRebindEditorFile,
  createEditorDocumentPool,
  flushEditorDocument,
  rebindEditorFile,
  type EditorPool,
  type PooledFile,
} from './editorDocumentPool'
import {
  captureFileDecision,
  createEditorRefreshQueue,
  fileDecisionIsCurrent,
  reconcileEditorDisk,
  type FileDecision,
} from './editorDocumentLifecycle'
import { editorRootKey, EDITOR_ROOT_STALE_MS, type EditorApi } from './editorClient'
import {
  type EditorMode,
  readEditorIndentation,
  readEditorLineBlame,
  readEditorMode,
  readEditorWordWrap,
} from './editorPrefs'
import { createLineAnnotations } from './lineAnnotations'
import {
  activeFile,
  editorActivate,
  editorClose,
  editorOpen,
  editorReopen,
  editorSetDirty,
  editorTabIdentity,
  openFiles,
  requestEditorReveal,
} from './editorState'
import { editorViewState, forgetEditorViewState, rememberEditorViewState } from './editorViewState'
import { createFileActionModel } from './fileActionModel'
import { persistCapturedEditorOpenFiles } from './openFilesSlice'
import { imageTypeForPath } from '../contract/imagePreview'
import { markerRevision } from './markerRevision'
import type { EditorReadResult } from '../contract/api'
import { createFileStatusReader } from './fileStatusReader'
import {
  historyIsCurrent,
  historyStep,
  navigate,
  nextClosed,
  noteActivated,
  noteClosed,
  takeClosedIfCurrent,
  type EditorLocation,
} from './editorNavigation'
import { actionAvailable, runEditorAction, type EditorAction } from './editorActions'
import {
  forgetPresentation,
  inferIndentation,
  presentationFor,
  saveLabel,
  setPresentation,
  type Indentation,
} from './editorPresentation'
import { admitGraphicalEditor } from './editorAdmission'

const log = createLogger('editor', 'editor')
const telemetry = telemetryFor('editor')

type EditorEngine = typeof import('./editorEngine')
export type DiskState = 'changed' | 'deleted' | 'read-failed' | 'unknown' | 'recovered'
export type EditorReveal = { path: string; line: number; column?: number }

export type EditorControllerInput = {
  task: Pick<Task, 'id' | 'projectId'>
  api: EditorApi
  queryClient: QueryClient
  prefs: () => Record<string, string> | undefined
}

// What the editor pane does, apart from drawing it. It owns one reused CodeMirror view, the pooled
// documents behind the tabs, disk reads, saves, and navigation (docs/editor.md § Pages). Call it
// from the pane's body or from a test's `createRoot`. Its effects and cleanups belong to the
// caller's owner, so it lives as long as the pane does.
//
// Each async job that a newer one can make stale holds an AbortSignal from its own `latestSignal`
// (docs/conventions.md § Solid and state).
// The job checks its signal after every await.
export function createEditorController(input: EditorControllerInput) {
  const { api, queryClient, prefs } = input
  const taskId = input.task.id
  const graphical = HOST === 'dom'
  const registeredNode = queryOwner(queryClient)
  const nodeId = registeredNode === undefined ? activeNodeId() : registeredNode

  let engine: EditorEngine | undefined
  let wrapCompartment: InstanceType<EditorEngine['Compartment']> | undefined
  let indentationCompartment: InstanceType<EditorEngine['Compartment']> | undefined
  let view: EditorView | undefined
  let stopTheme: (() => void) | undefined
  // One CodeMirror instance reused across tab switches, with the current path tracked explicitly
  // rather than read off props or signals mid-swap. Without that, a stale write lands in the wrong
  // file.
  let currentPath: string | null = null
  let currentCustody: DocumentCustody | undefined
  let releaseAdmission: (() => void) | undefined
  let disposed = false
  let applyingAcknowledgement = false
  // A cross-pane reveal that waits for its file to show, and the scroll that a history step restores.
  let pendingReveal: EditorReveal | null = null
  let replayScroll: number | null = null
  let replayPath: string | null = null
  // The revision handed to a contributed renderer with each fresh set of props.
  let renderedRevision = 0

  // The CodeMirror surface. Unmounting its rectangle aborts it.
  const surface = latestSignal()
  // Putting a file on screen. A newer `show()` aborts an older one.
  const showing = latestSignal()
  // An open, an activation, a reveal, or a history step. Each one aborts a pending history step.
  const navigation = latestSignal()
  // A disk read of the shown file, for a refresh or a confirmed reload. The newest read wins.
  const diskRead = latestSignal()
  // The read behind a contributed renderer's props. A newer read, or a change of path, aborts it.
  const renderedRead = latestSignal()

  const warmedText = new Map<string, Promise<EditorReadResult>>()
  const subscriptions = new Map<string, () => void>()
  const fileStatus = createFileStatusReader(api, taskId, () => !disposed && activeNodeId() === nodeId)
  // The pane model retains open view states; the document owner retains failed dirty work.
  const pool = paneModel<EditorPool>('editor', taskId, () => createEditorDocumentPool(api, taskId))
  // A kept pool missed every worktree event while no mount listened, so each file is read again
  // when it's next shown.
  for (const entry of pool.files.values()) entry.stale = true
  const saved = pool.saved
  // This mount's identity. A pooled state carries extensions — the update listener, the save chord —
  // that close over the mount that built them, and after a remount those closures point at a
  // destroyed view: typing would derive "not dirty" and never autosave. So a state built by an
  // earlier mount is reconfigured before it goes on screen, which keeps the document and the undo
  // history (both live in state fields that survive a reconfigure) and replaces the closures.
  const mountToken = {}

  const [root, setRoot] = createSignal<string | null | undefined>(undefined) // undefined = loading
  const [saveErr, setSaveErr] = createSignal('')
  // Why hover and diagnostics are off for the shown file, such as its size. Not an error.
  const [servicesOff, setServicesOff] = createSignal<string | null>(null)
  const [statusVersion, setStatusVersion] = createSignal(0)
  const updateStatus = () => setStatusVersion((value) => value + 1)
  const [diskState, setDiskState] = createSignal<DiskState | null>(null)
  const [armedDecision, setArmedDecision] = createSignal<FileDecision | null>(null)
  const [compare, setCompare] = createSignal(false)
  const [comparisonDisk, setComparisonDisk] = createSignal<EditorReadResult | null>(null)
  const [comparisonDraft, setComparisonDraft] = createSignal('')
  const [saveAsPath, setSaveAsPath] = createSignal('')
  const [bulkRun, setBulkRun] = createSignal<{ cancel: () => void } | null>(null)

  const files = createMemo(() => openFiles(taskId))
  const active = () => activeFile(taskId)
  const live = () => !disposed && !pool.retired && activeNodeId() === nodeId
  const isDirty = (path: string): boolean => pool.files.get(path)?.custody.dirty ?? false
  const refreshQueue = createEditorRefreshQueue(async (path) => {
    if (path === active()) await revalidate(path)
  })

  // Which editor draws an open file. `on` re-fires on identity rather than value, so its source is a
  // memo and not an inline getter. The terminal client can't draw CodeMirror, so there a file always
  // opens in the reader's own editor and the preference only applies to the desktop.
  const mode = createMemo((): EditorMode => (graphical ? readEditorMode(prefs()) : 'terminal'))
  const imagePath = createMemo(() => (mode() === 'graphical' && imageTypeForPath(active() ?? '') ? active() : null))
  const wantsTerminal = createMemo(() => (mode() === 'terminal' ? active() : null))
  const [ptyPath, setPtyPath] = createSignal<string | null>(null)
  // Who answers hover and diagnostics for a file, by its language, on this pane's Node.
  const servicesFor = (path: string) => resolveDocumentServices(nodeId ?? '', languageIdForPath(path), prefs())

  // Other plugins' marks on the cursor line of a saved document, such as line blame.
  const lineAnnotations = createLineAnnotations({
    taskId,
    enabled: createMemo(() => readEditorLineBlame(prefs())),
    cursorLine: () => {
      const entry = currentPath ? pool.files.get(currentPath) : undefined
      if (!view || !currentPath || !entry || entry.custody.dirty || entry.custody.writing || !live()) return null
      const { doc, selection } = view.state
      const line = doc.lineAt(selection.main.head).number
      if (doc.lineAt(selection.main.anchor).number !== line) return null
      return { path: currentPath, line, body: doc }
    },
    draw: (annotation) => {
      if (!view || !engine) return
      const custody = annotation && pool.files.get(annotation.path)?.custody
      if (annotation && (annotation.path !== currentPath || !custody || custody.dirty || custody.writing)) return
      view.dispatch({ effects: engine.lineAnnotationEffect(annotation) })
    },
  })

  // ── File decisions ────────────────────────────────────────────────────────────────────────────

  const captureDecision = (action: FileDecision['action'], destination?: string): FileDecision | null => {
    const path = active()
    const entry = path ? pool.files.get(path) : undefined
    if (!path || !entry || !live()) return null
    return captureFileDecision(action, nodeId, taskId, path, entry, destination)
  }
  const armDecision = (action: FileDecision['action']) => setArmedDecision(captureDecision(action))
  const takeDecision = (action: FileDecision['action']): FileDecision | null => {
    const decision = armedDecision()
    setArmedDecision(null)
    if (
      decision &&
      live() &&
      fileDecisionIsCurrent(decision, action, nodeId, taskId, active(), pool.files.get(decision.path))
    )
      return decision
    setSaveErr('The document or disk version changed. Review it and confirm again.')
    return null
  }
  /** Run an armed decision once the person confirms it, if what it named is still on screen. */
  const confirmDecision = (action: FileDecision['action']) => {
    const decision = takeDecision(action)
    if (!decision) return
    if (action === 'reload') void reloadFromDisk(decision)
    else void resolveWrite(decision)
  }
  const saveAs = () => {
    const decision = saveAsPath() && captureDecision('save-as', saveAsPath())
    if (decision) void resolveWrite(decision)
  }

  // ── Pooled documents ──────────────────────────────────────────────────────────────────────────

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
    entry.state = entry.state.update({
      effects: engine!.StateEffect.reconfigure.of(perFile(path, entry.language, entry.indentation)),
    }).state
    entry.mount = mountToken
    entry.custody.state = entry.state
    return entry.state
  }

  // Autosave (no Save button): debounce while typing, flush on blur / tab-switch / close.
  const scheduleSave = debounce((p: string) => void save(p), 1500)

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
      if (custody) {
        custody.state = view.state
        custody.viewState = state
        custody.flushRecovery()
      }
    }
  }

  const fileActions = createFileActionModel(
    api,
    pool,
    taskId,
    nodeId,
    () => {
      scheduleSave.cancel()
      saveViewState()
      if (view && currentPath) remember(currentPath, view.state)
    },
    (state) => persistCapturedEditorOpenFiles(queryClient, nodeId, taskId, state),
  )

  // Everything a file's own state carries beyond its text: the grammar, the theme, autosave, and the
  // explicit-flush chord. Built per path, because the language is the file's and the update listener
  // has to name the file it is reporting on.
  // Grammar installation follows usable text and stays within the same document entry.
  const perFile = (path: string, language: Extension, indentation: Indentation): Extension[] => [
    engine!.basicSetup,
    editorSearch(),
    editorTheme(),
    engine!.lineMarkerExtension(),
    engine!.lineAnnotationExtension(),
    // The pane clips anything outside the editor's box, so tooltips measure their room inside it and
    // open below a line near the top instead of being cut off above it.
    engine!.tooltips({ tooltipSpace: (view) => view.dom.getBoundingClientRect() }),
    // Hover and diagnostics from the file-language provider this Node chose. Read at each request, so
    // a provider change needs only the refresh below, and the live buffer is sent, saved or not.
    languageServices({
      nodeId: nodeId ?? '',
      routes: () => servicesFor(path),
      revision: () => pool.files.get(path)?.custody.revision,
      onUnavailable: (reason) => {
        if (currentPath === path && live()) setServicesOff(reason)
      },
    }),
    language,
    wrapCompartment!.of(
      (presentationFor(nodeId, taskId, path).wrap ?? readEditorWordWrap(prefs()))
        ? engine!.EditorView.lineWrapping
        : [],
    ),
    indentationCompartment!.of([
      engine!.indentUnit.of(indentation.mode === 'tabs' ? '\t' : ' '.repeat(indentation.width)),
      engine!.EditorState.tabSize.of(indentation.width),
    ]),
    engine!.EditorView.updateListener.of((update) => {
      if (currentPath === path && (update.docChanged || update.selectionSet)) {
        updateStatus()
        lineAnnotations.moved()
      }
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
    engine!.EditorView.domEventHandlers({
      blur: () => {
        scheduleSave.flush()
        return false
      },
    }),
    // Highest precedence so the explicit flush wins over anything the library binds to the chord;
    // autosave still runs either way.
    engine!.Prec.highest(
      engine!.keymap.of([
        {
          key: 'Mod-s',
          run: () => {
            void save(path)
            return true
          },
        },
      ]),
    ),
  ]

  // An empty read-only state until a file is opened: the view always has one, so "no file" is a
  // document with nothing in it rather than a special case in every handler below.
  const emptyState = () =>
    engine!.EditorState.create({
      extensions: [engine!.basicSetup, editorSearch(), editorTheme(), engine!.EditorState.readOnly.of(true)],
    })

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
    const mounted = surface.signal
    const address = [nodeId, 'file', taskId, relPath]
    const recovery = recoverDocumentCustody(address)
    const loaded = recovery?.dirty ? undefined : await (warmedText.get(relPath) ?? api.read(taskId, relPath))
    const content = loaded?.text ?? recovery!.acknowledged.toString()
    warmedText.delete(relPath)
    if (!live() || !view || mounted.aborted || !files().some((file) => file.path === relPath)) return null
    // Optional grammar and marker work never gate usable text.
    const custody = recovery ?? documentCustody(address, content, loaded?.revision)
    const indentation =
      presentationFor(nodeId, taskId, relPath).indentation ??
      inferIndentation(custody.current.toString(), readEditorIndentation(prefs()))
    const language: Extension = []
    const pooled = pool.files.get(relPath)
    if (pooled) return adopt(relPath, pooled) // a concurrent read got there first
    const highlighted = shouldHighlightDocument(content.length)
    if (!highlighted)
      telemetry.observe('editor.syntax.skipped', content.length, 'character', { reason: 'document-size' })
    let activeLanguage: Extension = highlighted ? language : []
    let state: EditorState
    try {
      state = telemetry.measure(
        'editor.state.create',
        () =>
          engine!.EditorState.create({
            doc: custody.current,
            extensions: perFile(relPath, activeLanguage, indentation),
          }),
        { highlighted },
      )
    } catch (error) {
      // A grammar is optional presentation. If a parser rejects ordinary-sized input, keep the file
      // usable and report one bounded failure instead of rejecting `show()` into the window handler.
      if (!highlighted) throw error
      log.warn('syntax parser failed; opening the document as plain text', error, {
        'document.characters': content.length,
      })
      activeLanguage = []
      state = engine!.EditorState.create({
        doc: custody.current,
        extensions: perFile(relPath, activeLanguage, indentation),
      })
    }
    if (custody.state)
      state = custody.state.update({
        effects: engine!.StateEffect.reconfigure.of(perFile(relPath, activeLanguage, indentation)),
      }).state
    custody.state = state
    const entry: PooledFile = {
      state,
      custody,
      release: custody.retain(),
      language: activeLanguage,
      indentation,
      mount: mountToken,
      markersReadAt: 0,
      markersRead: latestSignal(),
    }
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
    if (highlighted)
      void languageForPath(relPath)
        .then((grammar) => {
          if (!live() || pool.files.get(relPath) !== entry || (Array.isArray(grammar) && !grammar.length)) return
          entry.language = grammar
          if (!view) {
            entry.mount = {}
            return
          }
          const effects = engine!.StateEffect.reconfigure.of(perFile(relPath, grammar, entry.indentation))
          if (view && currentPath === relPath) {
            view.dispatch({ effects })
            remember(relPath, view.state)
          } else entry.state = custody.state = entry.state.update({ effects }).state
        })
        .catch(() => {})
    return state
  }

  function watchCustody(path: string, entry: PooledFile): void {
    if (subscriptions.has(path)) return
    subscriptions.set(
      path,
      entry.custody.subscribe(() => {
        if (pool.files.get(path) !== entry || pool.retired) return
        saved.set(path, entry.custody.acknowledged)
        entry.state = entry.custody.state ?? entry.state
        if (!live()) return
        if (currentPath === path) updateStatus()
        if (entry.custody.error) setSaveErr(entry.custody.error)
        if (entry.custody.writeBlock && currentPath === path) scheduleSave.cancel()
        if (view && currentPath === path && !view.state.doc.eq(entry.custody.current)) {
          applyingAcknowledgement = true
          try {
            view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: entry.custody.current } })
          } finally {
            applyingAcknowledgement = false
          }
          entry.state = entry.custody.state = view.state
        }
        editorSetDirty(taskId, path, entry.custody.dirty)
        if (!entry.custody.dirty) void refreshLineMarkers(path)
        if (entry.stale && !entry.custody.writing) void revalidate(path)
      }),
    )
  }

  const unwatchCustody = (path: string) => {
    subscriptions.get(path)?.()
    subscriptions.delete(path)
  }

  async function refreshLineMarkers(relPath: string): Promise<void> {
    // The same moments can change the saved body under the cursor line.
    if (relPath === currentPath) lineAnnotations.settle()
    const entry = pool.files.get(relPath)
    if (!api || !entry || entry.custody.dirty || entry.custody.writing) return
    entry.markersReadAt = Date.now()
    const markersRead = entry.markersRead.next()
    const doc = entry.custody.current
    const revision = entry.custody.revision
    const bodyRevision = await markerRevision(doc.toString()).catch(() => null)
    if (!bodyRevision || !live() || markersRead.aborted || entry.custody.revision !== revision) return
    const response = await api.lineMarkers(taskId, relPath, bodyRevision).catch(() => null)
    if (
      !response ||
      response.revision !== bodyRevision ||
      !live() ||
      pool.files.get(relPath) !== entry ||
      entry.custody.dirty ||
      entry.custody.writing ||
      markersRead.aborted ||
      entry.custody.revision !== revision ||
      !entry.custody.current.eq(doc)
    )
      return
    const markers = response.markers
    if (view && currentPath === relPath) {
      view.dispatch({ effects: engine!.lineMarkerEffect(markers) })
      remember(relPath, view.state)
    } else entry.state = entry.custody.state = entry.state.update({ effects: engine!.lineMarkerEffect(markers) }).state
    entry.markersReadAt = Date.now()
  }

  // ── The CodeMirror surface ────────────────────────────────────────────────────────────────────

  // The graphical editor is built and torn down with its rectangle, because terminal mode replaces
  // that rectangle rather than hiding it. Nothing is lost across the swap: the per-file states stay in
  // the cache, so coming back restores the text, the undo history and the cursor.
  const mountEditor = (element: HTMLElement) => {
    if (!graphical) return
    const mounted = surface.next()
    void import('./editorEngine')
      .then((loaded) => {
        if (!live() || mounted.aborted) return
        engine = loaded
        wrapCompartment = new loaded.Compartment()
        indentationCompartment = new loaded.Compartment()
        view = new loaded.EditorView({ state: emptyState(), parent: element })
        stopTheme = watchEditorTheme(view)
        const restore = active()
        if (restore) void show(restore)
      })
      .catch((cause: unknown) => {
        if (live() && !mounted.aborted) setSaveErr(cause instanceof Error ? cause.message : 'Unable to load editor.')
      })
    onCleanup(() => {
      surface.abort()
      scheduleSave.flush()
      saveViewState()
      if (view && currentPath) remember(currentPath, view.state)
      currentPath = null
      currentCustody = undefined
      releaseAdmission?.()
      releaseAdmission = undefined
      stopTheme?.()
      stopTheme = undefined
      view?.destroy()
      view = undefined
    })
  }

  /** The live view, while it shows the active file of the task on screen in graphical mode. */
  const graphicalView = (): EditorView | undefined =>
    live() &&
    activeTaskId() === taskId &&
    mode() === 'graphical' &&
    currentPath === active() &&
    !imagePath() &&
    !ptyPath()
      ? view
      : undefined

  const canRunAction = (id: EditorAction): boolean => {
    const admitted = graphicalView()
    return !!admitted && actionAvailable(engine!, admitted, id)
  }
  const runAction = (id: EditorAction) => {
    const admitted = graphicalView()
    if (admitted) runEditorAction(engine!, admitted, id)
  }

  const toggleWrap = () => {
    const admitted = graphicalView()
    const path = currentPath
    if (!admitted || !path) return
    const next = !(presentationFor(nodeId, taskId, path).wrap ?? readEditorWordWrap(prefs()))
    setPresentation(nodeId, taskId, path, { ...presentationFor(nodeId, taskId, path), wrap: next })
    admitted.dispatch({ effects: wrapCompartment!.reconfigure(next ? engine!.EditorView.lineWrapping : []) })
    remember(path, admitted.state)
    updateStatus()
  }
  const setIndentation = (indentation: Indentation) => {
    const path = active()
    const entry = path ? pool.files.get(path) : undefined
    if (!path || !entry || !graphicalView()) return
    entry.indentation = indentation
    setPresentation(nodeId, taskId, path, { ...presentationFor(nodeId, taskId, path), indentation })
    view!.dispatch({
      effects: indentationCompartment!.reconfigure([
        engine!.indentUnit.of(indentation.mode === 'tabs' ? '\t' : ' '.repeat(indentation.width)),
        engine!.EditorState.tabSize.of(indentation.width),
      ]),
    })
    remember(path, view!.state)
    updateStatus()
  }

  // A provider that appears, goes, or is picked in settings asks the shown file again. A different
  // file needs nothing: putting its state on screen asks by itself.
  const shownServices = createMemo(() => {
    const path = active()
    const { hover, diagnostics } = path ? servicesFor(path) : {}
    return `${hover?.pluginId}:${hover?.route}|${diagnostics?.pluginId}:${diagnostics?.route}`
  })
  createEffect(
    on(
      shownServices,
      () => {
        if (view && currentPath) view.dispatch({ effects: refreshLanguageServices.of(null) })
      },
      { defer: true },
    ),
  )
  createEffect(() => {
    const defaultWrap = readEditorWordWrap(prefs())
    const path = currentPath
    if (view && path && presentationFor(nodeId, taskId, path).wrap === undefined)
      view.dispatch({ effects: wrapCompartment!.reconfigure(defaultWrap ? engine!.EditorView.lineWrapping : []) })
  })

  // Swaps the reused instance to a path. The only place currentPath changes.
  async function show(relPath: string) {
    if (!view) return
    const shown = showing.next()
    scheduleSave.flush() // persist the outgoing file (pending arg is its path) before the swap
    saveViewState() // remember the outgoing file's scroll/cursor before we swap states
    setSaveErr('')
    setServicesOff(null)
    setDiskState(null)
    setCompare(false)
    setComparisonDisk(null)
    // The outgoing file's state, with whatever the reader typed in it. `setState` hands the view a
    // new one, so the old instance is what has to go back in the cache.
    if (currentPath) remember(currentPath, view.state)
    currentPath = null
    currentCustody = undefined
    releaseAdmission?.()
    releaseAdmission = undefined
    if (!view.state.readOnly)
      view.dispatch({
        effects: engine!.StateEffect.appendConfig.of([
          engine!.EditorState.readOnly.of(true),
          engine!.EditorView.editable.of(false),
        ]),
      })
    const state = await stateFor(relPath).catch((cause: unknown) => {
      if (live() && active() === relPath)
        setSaveErr(cause instanceof Error ? cause.message : 'Could not load this file.')
      return null
    })
    // A read may finish after the reader chose another tab. Active state changes synchronously at
    // the interaction boundary; a stale read must not put its document on screen afterward.
    if (disposed || !view || active() !== relPath || shown.aborted) return
    if (!state) {
      view.setState(emptyState())
      if (saveErr()) featureUsable('editor', 'error')
      return
    }
    const entryAtShow = pool.files.get(relPath)
    if (!entryAtShow || !live()) return
    currentPath = relPath
    currentCustody = entryAtShow.custody
    releaseAdmission = admitGraphicalEditor(nodeId, taskId, relPath)
    updateStatus()
    noteActivated(nodeId, taskId, relPath)
    view.setState(adopt(relPath, entryAtShow))
    // A pooled state may still carry the label it had when it was last on screen.
    view.dispatch({ effects: engine!.lineAnnotationEffect(null) })
    lineAnnotations.moved()
    featureUsable('editor', 'content')
    updateStatus()
    // A cached state carries the theme it was built with, so a file opened before a theme change
    // comes back wearing the old one until this line.
    refreshEditorTheme(view)
    const remembered = pool.files.get(relPath)?.custody.viewState ?? editorViewState(taskId, relPath, nodeId)
    if (remembered) applyViewState(view, remembered)
    maybeReveal(relPath)
    const entry = pool.files.get(relPath)
    if (entry && Date.now() - entry.markersReadAt > 2_000) void refreshLineMarkers(relPath)
    // The pooled text is on screen already. The disk read that checks it replaces the document in
    // place if the file changed while the pane was away.
    if (entry?.stale || entry?.custody.writeBlock) void revalidate(relPath)
  }

  // Consumes a pending cross-pane reveal for the file just shown: centers the target position and
  // places the cursor there. One-shot, cleared once applied so it does not re-fire on the next tab
  // switch.
  function maybeReveal(relPath: string) {
    const r = pendingReveal
    if (!view || !r || r.path !== relPath) return
    const doc = view.state.doc
    const line = doc.line(Math.min(Math.max(1, r.line), doc.lines))
    const pos = Math.min(line.from + Math.max(0, (r.column ?? 1) - 1), line.to)
    view.dispatch({ selection: { anchor: pos }, effects: engine!.EditorView.scrollIntoView(pos, { y: 'center' }) })
    if (replayScroll !== null) {
      view.scrollDOM.scrollTop = replayScroll
      replayScroll = null
    }
    view.focus()
    pendingReveal = null
  }

  // Single driver for the reused surface. The state swaps here whenever the active file changes,
  // whether from a task switch, a tree click, a tab close, or the quick-open palette. Deferred so
  // the mount owns the first paint.
  createEffect(
    on(
      active,
      (next) => {
        if (!view) return
        if (next && next !== currentPath) void show(next)
        else if (!next) {
          if (currentPath) remember(currentPath, view.state)
          currentPath = null
          currentCustody = undefined
          releaseAdmission?.()
          releaseAdmission = undefined
          view.setState(emptyState())
        }
      },
      { defer: true },
    ),
  )

  // ── Navigation ────────────────────────────────────────────────────────────────────────────────

  const location = (path: string | null): EditorLocation | null => {
    if (!path) return null
    const state = currentPath === path && view ? view.state : pool.files.get(path)?.state
    const place = currentPath === path && view ? captureViewState(view) : editorViewState(taskId, path, nodeId)
    const head = Math.min(place?.head ?? 0, state?.doc.length ?? 0)
    const line = state?.doc.lineAt(head)
    return { path, line: line?.number ?? 1, column: line ? head - line.from + 1 : 1, scroll: place?.scrollTop ?? 0 }
  }
  const recordNavigation = (path: string, line?: number, column?: number) => {
    navigation.next()
    const from = location(active())
    const to = location(path) ?? { path, line: 1, column: 1, scroll: 0 }
    if (line) {
      to.line = line
      to.column = column ?? 1
    }
    if (!from || from.path !== path || line !== undefined) navigate(nodeId, taskId, from, to)
  }
  const activatePath = (path: string) => {
    if (path === active()) return reopenEditor(path)
    recordNavigation(path)
    editorActivate(taskId, path)
  }
  function openPath(relPath: string, ephemeral: boolean) {
    reopenEditor(relPath)
    recordNavigation(relPath)
    editorOpen(taskId, relPath, ephemeral) // the active() effect swaps the surface
  }

  /** Step back or forward through history, skipping places whose file has gone. */
  const replay = async (direction: -1 | 1) => {
    const signal = navigation.next()
    while (live() && !signal.aborted) {
      const place = historyStep(nodeId, taskId, direction, location(active()))
      if (!place) return
      try {
        await api.read(taskId, place.path)
      } catch (cause) {
        if (!live() || signal.aborted || !historyIsCurrent(nodeId, taskId, place)) return
        if ((cause as { status?: number })?.status === 404) {
          toast(`Skipped unavailable file: ${place.path}`)
          continue
        }
        historyStep(nodeId, taskId, direction === 1 ? -1 : 1)
        toast(`Could not navigate to ${place.path}: ${cause instanceof Error ? cause.message : 'read failed'}`)
        return
      }
      if (!live() || signal.aborted || !historyIsCurrent(nodeId, taskId, place)) return
      replayPath = place.path
      replayScroll = place.scroll
      requestEditorReveal(taskId, place.path, place.line, place.column)
      return
    }
  }
  const reopen = async () => {
    if (!live()) return
    const signal = navigation.next()
    const closed = nextClosed(nodeId, taskId)
    if (!closed) return
    try {
      await api.read(taskId, closed.path)
    } catch (cause) {
      if (live() && !signal.aborted && nextClosed(nodeId, taskId) === closed) {
        if ((cause as { status?: number })?.status === 404) takeClosedIfCurrent(nodeId, taskId, closed)
        toast(`Could not reopen ${closed.path}: ${cause instanceof Error ? cause.message : 'file unavailable'}`)
      }
      return
    }
    if (!live() || signal.aborted || !takeClosedIfCurrent(nodeId, taskId, closed)) return
    recordNavigation(closed.path)
    editorReopen(taskId, closed.path, closed.index)
  }

  /** Open a file at a line, for an `editor:reveal` intent. A replay's own reveal isn't recorded again. */
  const reveal = (place: EditorReveal) => {
    if (replayPath === place.path) replayPath = null
    else recordNavigation(place.path, place.line, place.column)
    pendingReveal = place
    // Reveal implies open: cross-pane senders such as find-in-files and stack frames reach this only
    // through the core intent bus and cannot call editorOpen. No-op when the tab is already current.
    editorOpen(taskId, place.path, true)
    if (currentPath === place.path) {
      maybeReveal(place.path)
      noteActivated(nodeId, taskId, place.path)
    }
  }

  createEffect(
    on(active, (path) => {
      if (!path || (graphical && !imageTypeForPath(path))) return
      void api
        .entry(taskId, path)
        .then(() => {
          if (live() && active() === path) noteActivated(nodeId, taskId, path)
        })
        .catch(() => {})
    }),
  )

  // ── Saves and disk ────────────────────────────────────────────────────────────────────────────

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
      if (live())
        setSaveErr(custody.writeBlock ? '' : cause instanceof Error ? cause.message : "Couldn't save this file.")
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
      const state = engine!.EditorState.create({
        doc: disk.text,
        extensions: perFile(path, entry.language, entry.indentation),
      })
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

  // Worktree events have no path. Keep inactive entries stale and read only the visible file.
  // A newer read, a tab switch, or pane retirement makes a late response stale.
  async function revalidate(path: string): Promise<void> {
    const entry = pool.files.get(path)
    if (!entry || !live()) return
    if (entry.custody.writing) {
      entry.stale = true
      return
    }
    const signal = diskRead.next()
    const editRevision = entry.custody.revision
    let disk: EditorReadResult
    try {
      disk = await api.read(taskId, path)
    } catch (cause) {
      if (!live() || signal.aborted || pool.files.get(path) !== entry || active() !== path) return
      const missing =
        typeof cause === 'object' &&
        cause !== null &&
        'status' in cause &&
        cause.status === 404 &&
        'code' in cause &&
        cause.code === 'not_found'
      if (missing) entry.custody.writeBlock = 'Deleted on disk.'
      setDiskState(missing ? 'deleted' : 'read-failed')
      setCompare(false)
      setComparisonDisk(null)
      setSaveErr(missing ? '' : cause instanceof Error ? cause.message : 'Could not read this file.')
      return
    }
    if (
      !live() ||
      signal.aborted ||
      pool.files.get(path) !== entry ||
      active() !== path ||
      entry.custody.revision !== editRevision
    ) {
      entry.stale = true
      return
    }
    entry.stale = false
    applyDiskRead(path, entry, disk, false)
  }

  async function reloadFromDisk(decision: FileDecision): Promise<void> {
    const { path, entry } = decision
    const signal = diskRead.next()
    try {
      const disk = await api.read(taskId, path)
      if (
        !live() ||
        signal.aborted ||
        !fileDecisionIsCurrent(decision, 'reload', nodeId, taskId, active(), pool.files.get(path))
      )
        return
      if (entry.custody.writing) {
        entry.stale = true
        return
      }
      if (disk.revision !== decision.disk?.revision) {
        entry.stale = true
        setSaveErr('The disk changed after confirmation was shown. Review it and confirm again.')
        void revalidate(path)
        return
      }
      applyDiskRead(path, entry, disk, true)
    } catch (cause) {
      if (
        live() &&
        !signal.aborted &&
        fileDecisionIsCurrent(decision, 'reload', nodeId, taskId, active(), pool.files.get(path))
      )
        setSaveErr(cause instanceof Error ? cause.message : 'Unable to reload the file.')
    }
  }

  async function resolveWrite(decision: FileDecision): Promise<void> {
    const { path, destination, entry } = decision
    if (!live() || !fileDecisionIsCurrent(decision, decision.action, nodeId, taskId, active(), pool.files.get(path))) {
      setSaveErr('The document or disk version changed. Review it and confirm again.')
      return
    }
    if (decision.action === 'overwrite' && !decision.disk) {
      await revalidate(path)
      return
    }
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
        if (active() === path) {
          setDiskState(null)
          setCompare(false)
          setSaveErr('')
        }
        editorSetDirty(taskId, path, entry.custody.dirty)
      } else {
        const activeAtCompletion = active()
        unwatchCustody(path)
        editorClose(taskId, path)
        editorOpen(taskId, destination, false)
        if (activeAtCompletion && activeAtCompletion !== path) editorActivate(taskId, activeAtCompletion)
        setSaveAsPath('')
        if (activeAtCompletion === path) {
          setDiskState(null)
          setSaveErr('')
        }
      }
    } catch (cause) {
      if (live()) setSaveErr(cause instanceof Error ? cause.message : 'Unable to write the file.')
    } finally {
      resume()
    }
  }

  /** Show the disk next to the draft, or hide it again. */
  const toggleCompare = () => {
    const entry = pool.files.get(active()!)
    setComparisonDisk(entry?.disk ?? null)
    setComparisonDraft(entry?.custody.current.toString() ?? '')
    setCompare((shown) => !shown)
  }

  const invalidate = () => {
    for (const entry of pool.files.values()) entry.stale = true
    const path = currentPath
    if (path) refreshQueue.request(path)
    const shown = renderedPath()
    if (shown) void readRendered(shown)
  }
  function onFocus() {
    invalidate()
    fileStatus.refresh()
  }

  // Reload-on-focus, where there is a window to lose focus. A host without one — the terminal client
  // runs this pane under Node — has nothing to listen to, and reaching for the listener there throws
  // inside the mount, so the pane draws nothing at all (docs/tui.md). The agent and the human still
  // share the worktree there; what a reader gets instead of the automatic reload is the pane's own refetch.
  const watchFocus = (add: boolean): void => {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return
    if (add) window.addEventListener('focus', onFocus)
    else window.removeEventListener('focus', onFocus)
  }

  onMount(() => {
    const offWorktree = wsOnNodeEvent('worktree:status-changed', (event) => {
      if (event.taskId === taskId && activeNodeId() === nodeId) {
        invalidate()
        fileStatus.refresh()
      }
    })
    const offReconnect = wsOnReconnect(() => {
      if (activeNodeId() === nodeId) {
        invalidate()
        fileStatus.refresh()
      }
    })
    const offPlugins = wsOnPluginsChanged(() => {
      if (activeNodeId() === nodeId) fileStatus.providerChanged()
    })
    onCleanup(() => {
      offWorktree()
      offReconnect()
      offPlugins()
    })
  })

  // ── Closing tabs ──────────────────────────────────────────────────────────────────────────────

  async function close(
    relPath: string,
    options: { identity?: object; canCommit?: () => boolean; focus?: boolean } = {},
  ): Promise<boolean> {
    const tab = files().find((file) => file.path === relPath)
    if (!tab) return false
    const index = files().indexOf(tab)
    const identity = 'identity' in options ? options.identity : editorTabIdentity(taskId, relPath)
    if (!identity || editorTabIdentity(taskId, relPath) !== identity) return false
    scheduleSave.cancel()
    const entry = pool.files.get(relPath)
    const revision = entry?.custody.revision
    if (entry && !(await save(relPath))) return false
    if (
      !live() ||
      pool.files.get(relPath) !== entry ||
      entry?.custody.revision !== revision ||
      entry?.custody.dirty ||
      editorTabIdentity(taskId, relPath) !== identity ||
      options.canCommit?.() === false
    )
      return false
    noteClosed(nodeId, taskId, { path: relPath, index })
    editorClose(taskId, relPath)
    unwatchCustody(relPath)
    entry?.release()
    pool.files.delete(relPath)
    saved.delete(relPath)
    forgetEditorViewState(taskId, relPath, nodeId)
    forgetPresentation(nodeId, taskId, relPath)
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
    const run = {
      cancel: () => {
        canceled = true
      },
    }
    setBulkRun(run)
    let closed = 0
    try {
      for (const target of targets) {
        if (
          canceled ||
          !(await close(target.path, { identity: target.identity, canCommit: () => !canceled, focus: false }))
        ) {
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

  // A tab's menu holds its document's writes while it is open, and captures the tab it was opened
  // on, so an action runs against that tab or not at all.
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
    queueMicrotask(() => {
      if (menuTargets.get(path) === held.target) menuTargets.delete(path)
    })
  }

  // A closed tab's clean document leaves the pool. A dirty or writing one stays until it settles.
  createEffect(() => {
    const open = new Set(files().map((file) => file.path))
    for (const [path, entry] of pool.files) {
      if (open.has(path) || entry.custody.dirty || entry.custody.writing) continue
      unwatchCustody(path)
      entry.release()
      pool.files.delete(path)
      saved.delete(path)
      forgetEditorViewState(taskId, path, nodeId)
      forgetPresentation(nodeId, taskId, path)
    }
  })

  // ── Contributed renderers ─────────────────────────────────────────────────────────────────────

  // Another plugin's view of the open file, in the `editor:document` point (docs/editor/file-renderers.md).
  // The pane's own view draws when nobody stands in, and a Source toggle per tab gets the reader back
  // to it. A contributed view takes the box from CodeMirror the way terminal mode does: the view goes, and
  // the pooled document, its undo history, and any unsaved edits stay for the way back.
  const documentKey = createMemo(() => active()?.split('/').pop()?.toLowerCase())
  const rendererOffered = () =>
    mode() !== 'terminal' && !!documentKey() && slotFills(EDITOR_DOCUMENT_POINT, documentKey())
  const [sourceVersion, setSourceVersion] = createSignal(0)
  const renderedPath = createMemo(() => {
    sourceVersion()
    const path = active()
    return path && rendererOffered() && !presentationFor(nodeId, taskId, path).source ? path : null
  })
  const [rendered, setRendered] = createSignal<EditorDocumentProps | null>(null)
  const [occupied, setOccupied] = createSignal(false)
  // True only while a contributor draws. A tie between two contributors draws the pane's own view.
  const documentRendered = () => !!renderedPath() && !!rendered() && occupied()
  const showSource = (source: boolean) => {
    const path = active()
    if (!path) return
    setPresentation(nodeId, taskId, path, { ...presentationFor(nodeId, taskId, path), source })
    setSourceVersion((value) => value + 1)
  }
  // The props a contributor draws from. The pooled buffer is the live one, unsaved edits included.
  // Without a pooled document, or once the disk moved under a clean one, the disk is the answer.
  async function readRendered(path: string): Promise<void> {
    const signal = renderedRead.next()
    const entry = pool.files.get(path)
    const warmed = warmedText.get(path)
    warmedText.delete(path)
    const text =
      entry && (!entry.stale || entry.custody.dirty)
        ? entry.custody.current.toString()
        : imageTypeForPath(path)
          ? undefined
          : await (warmed ?? api.read(taskId, path)).then(
              (read) => read.text,
              () => undefined,
            )
    if (!live() || signal.aborted || renderedPath() !== path) return
    setRendered({ taskId, path, ...(text === undefined ? {} : { text }), revision: ++renderedRevision })
    featureUsable('editor', 'content')
  }
  createEffect(
    on(renderedPath, (path) => {
      renderedRead.abort()
      setRendered(null)
      // Assume the contributor that matched will draw, so CodeMirror isn't built and torn down in the
      // same tick. The slot corrects this at once when a tie leaves the box to the pane.
      setOccupied(!!path)
      if (path) void readRendered(path)
    }),
  )

  // ── Terminal mode ─────────────────────────────────────────────────────────────────────────────

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

  createEffect(
    on(wantsTerminal, (path, previous) => {
      if (previous) {
        pool.externalEditors.delete(previous)
        forget(previous)
      } // the PTY stopped owning this path
      if (path) pool.externalEditors.add(path)
      setPtyPath(path)
    }),
  )

  // In the terminal client the box is empty once the reader's editor exits. Picking the same file
  // again starts it again, because the active path didn't change and `wantsTerminal` won't re-fire.
  const reopenEditor = (path: string) => {
    if (graphical || mode() !== 'terminal' || path !== active() || ptyPath()) return
    pool.externalEditors.add(path)
    setPtyPath(path)
  }

  const onEditorExit = (path: string, code: number) => {
    pool.externalEditors.delete(path)
    forget(path)
    setPtyPath(null)
    setSaveErr(code ? `Your editor exited with status ${code}.` : '')
  }

  // ── Status bar facts ──────────────────────────────────────────────────────────────────────────

  const status = {
    position: () => {
      statusVersion()
      if (!view || currentPath !== active() || mode() !== 'graphical' || imagePath() || ptyPath()) return undefined
      const head = view.state.selection.main.head
      const line = view.state.doc.lineAt(head)
      return `Ln ${line.number}, Col ${head - line.from + 1}`
    },
    selectedCharacters: () => {
      statusVersion()
      if (!view || currentPath !== active() || mode() !== 'graphical' || imagePath() || ptyPath()) return 0
      // CodeMirror offsets count UTF-16 code units. This stays proportional to selection ranges,
      // even when the reader selects a generated file with millions of characters.
      return view.state.selection.ranges.reduce((count, range) => count + range.to - range.from, 0)
    },
    save: () => {
      statusVersion()
      const entry = active() ? pool.files.get(active()!) : undefined
      if (!entry || ptyPath() || imagePath()) return undefined
      return saveLabel(entry.custody, diskState())
    },
    indentation: () => {
      statusVersion()
      return mode() === 'graphical' && !imagePath() && !ptyPath() && !documentRendered() && active()
        ? pool.files.get(active()!)?.indentation
        : undefined
    },
    wrap: () => {
      statusVersion()
      return presentationFor(nodeId, taskId, active() ?? '').wrap ?? readEditorWordWrap(prefs())
    },
    /** A status bar drawn for `path` acts only while that file is the one on screen. */
    isCurrent: (path: string) => live() && activeTaskId() === taskId && active() === path,
  }

  // ── Selection ─────────────────────────────────────────────────────────────────────────────────

  // Text selected in the open file, for other plugins' actions on it (`content.selection`). Read from the
  // live buffer, saved or not, and only when the person asks. `revision` is the buffer's edit counter,
  // so an edit or a reload after the menu opened refuses the row.
  const selectionTarget = (): ContentSelectionTarget | undefined => {
    const admitted = graphicalView()
    const path = currentPath
    const custody = path ? pool.files.get(path)?.custody : undefined
    const selected = admitted && documentSelection(admitted.state)
    if (!admitted || !path || !custody || !selected) return undefined
    return {
      location: 'content.selection',
      nodeId: nodeId ?? '',
      taskId,
      projectId: input.task.projectId,
      ownerId: 'editor',
      contentKind: 'document',
      languageId: languageIdForPath(path),
      readOnly: admitted.state.readOnly,
      text: selected.text,
      revision: custody.revision,
      resource: { kind: 'file', path },
      range: selected.range,
    }
  }
  const selectionIsCurrent = (target: ContentSelectionTarget): boolean =>
    !!graphicalView() &&
    target.nodeId === (nodeId ?? '') &&
    target.resource?.kind === 'file' &&
    target.resource.path === currentPath &&
    pool.files.get(currentPath)?.custody.revision === target.revision

  /** Add the shown file, or the lines the selection spans, to the person's message to the agent. */
  const sendSelectionToAgent = () => {
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
  }

  // ── Opening and closing the pane ──────────────────────────────────────────────────────────────

  onMount(() => {
    fileStatus.refresh()
    onCleanup(() => {
      fileStatus.stop()
      // Flush first, then mark this mount gone: the flush is a save, and `save` below finishes its
      // bookkeeping either way, because the bookkeeping outlives the mount.
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
      if (!api) {
        setRoot(null)
        return featureUsable('editor', 'error')
      }
      // The file the reader left open does not depend on the root, so it is read now, beside the
      // root, and `show()` finds it already in the pool (docs/editor/editor-pane.md § One round trip
      // to text).
      // Warm text under the host capability; imports and document state wait for surface admission.
      const remembered = active()
      if (graphical && mode() === 'graphical' && remembered && !imageTypeForPath(remembered)) {
        const read = api.read(taskId, remembered)
        warmedText.set(remembered, read)
        void read.catch(() => {
          if (warmedText.get(remembered) === read) warmedText.delete(remembered)
        })
      }
      // A checkout path already in the cache paints the rectangle in this tick, and the fetch below
      // returns it without a request while it is fresh. An absent root is never painted from the
      // cache: "no checkout yet" is the one thing that changes, so it is always awaited.
      const cached = queryClient.getQueryData<string | null>(editorRootKey(taskId))
      if (cached) setRoot(cached)
      const r = await queryClient
        .fetchQuery({
          queryKey: editorRootKey(taskId),
          queryFn: () => api.root(taskId),
          staleTime: EDITOR_ROOT_STALE_MS,
        })
        .catch(() => null)
      if (disposed) return
      setRoot(r) // renders the rectangle synchronously when truthy, and `mountEditor` builds the view
      // Usable now unless a text document is still on its way, which `show()` reports instead
      // (docs/telemetry/renderer.md § Feature openings). No checkout is an actionable error.
      const opening = active()
      if (!r) featureUsable('editor', 'error')
      else if (!opening) featureUsable('editor', 'empty')
      else if (!graphical || mode() !== 'graphical' || imageTypeForPath(opening)) featureUsable('editor', 'content')
      if (!r) return
      watchFocus(true)
    })()
  })

  return {
    nodeId,
    fileStatus,
    fileActions,
    root,
    files,
    active,
    mode,
    imagePath,
    ptyPath,
    servicesFor,
    // The surface
    mountEditor,
    graphicalView,
    canRunAction,
    runAction,
    toggleWrap,
    setIndentation,
    showLineAnnotationDetails: () => !!view && !!engine && engine.showLineAnnotationDetails(view),
    // Navigation
    openPath,
    activatePath,
    replay,
    reopen,
    reveal,
    // Saves, disk, and decisions
    save,
    revalidate,
    saveErr,
    servicesOff,
    diskState,
    armedDecision,
    armDecision,
    confirmDecision,
    compare,
    comparisonDisk,
    comparisonDraft,
    toggleCompare,
    saveAsPath,
    setSaveAsPath,
    saveAs,
    // Tabs
    close,
    closeMany,
    bulkRun,
    withTabTarget,
    prepareTabMenu,
    releaseTabMenu,
    savedRevision: (path: string) => pool.files.get(path)?.custody.savedRevision,
    // Contributed renderers
    documentKey,
    rendererOffered,
    renderedPath,
    rendered,
    occupied,
    setOccupied,
    documentRendered,
    showSource,
    // Terminal mode
    onEditorExit,
    // Status bar and selection
    status,
    selectionTarget,
    selectionIsCurrent,
    sendSelectionToAgent,
  }
}
