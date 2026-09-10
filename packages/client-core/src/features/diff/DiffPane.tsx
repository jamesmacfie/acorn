import { measure, recordSample } from '../../infra/telemetry/emitter'
import { batch, createEffect, createMemo, createSignal, on, onCleanup, onMount, Show } from 'solid-js'
import { createStore, reconcile, unwrap } from 'solid-js/store'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { tokenizeDocument } from '../../infra/highlight/worker'
import { readDraft, writeDraft } from '../../kit/lib/draftState'
import { PrefKeys } from '../../infra/persistence/prefKeys'
import { prefsOptions } from '../../infra/queries'
import { clientEvents } from '../../host/registries/commands/clientEvents'
import { registerCommands } from '../../host/registries/commands/commands'
import { registerKeybindings } from '../../host/registries/commands/keybindings'
import { savePref } from '../settings/savePref'
import { EmptyState } from '../../kit/components/primitives'
import { DiffCanvas } from './DiffCanvas'
import { FileHead, type LineComposerController, type ThreadCollapseController } from '../../kit/diff/DiffRows'
import { AnnotationMarks } from '../../host/annotations/AnnotationMarks'
import { annotationKey } from '../../host/annotations/annotationKey'
import { annotationSignature, annotationsFor, requestAnnotations } from '../../host/annotations/annotations'
import { DiffToolbar } from './DiffToolbar'
import { createDiffFindController } from './findController'
import { createDiffHydrator } from '../../kit/diff/hydration'
import {
  buildDiffRows,
  buildDiffRowsAsync,
  buildRenderableRows,
  DIFF_LOAD_ROW_HEIGHT,
  estimateRowSize,
  estimateSplitBandSize,
  expandGapAsync,
  gapId,
  isCodeRow,
  maxLineCols,
  plainTokenize,
  rowIdentityKeys,
  splitBandIdentityKeys,
  toBands,
  type CodeRow,
  type DiffFile,
  type DiffThread,
  type GapRow,
  type ParsedFile,
  type Row,
  type SplitBand,
  type ViewMode,
} from '../../kit/diff/diffModel'
import { createDiffScrollRestoration } from './scrollRestoration'
import type { CommentSide, DiffSource } from './source'
import { createDiffStickyFile } from './stickyFile'
import { diffCollapsed, rememberDiffCollapsed } from './viewState'
import { createDiffMeasureSchedulers, createDiffVirtualizer } from '../../kit/diff/virtualization'
import { createLogger } from '../../infra/telemetry/logger'

const log = createLogger('diff')

// The diff shell: every changed file's diff stacked in one virtualized list, in unified or split
// mode, with find, a sticky file header, per-file collapse, gap expansion, and an inline comment
// layer (docs/diff-rendering.md). Each file opens with a header row, and the source's selected path
// is a scroll target rather than a file picker.
//
// Everything specific to a provider arrives through DiffSource, so this component names no product:
// the GitHub plugin fills it in from a pull request, the changes plugin from a working tree. Threads
// interleave at render time (matched by path), so a thread mutation rerenders without re-tokenizing.
const HIGHLIGHT_MAX_PATCH_CHARS = 120_000
const HIGHLIGHT_MAX_PATCH_LINES = 2_000

const rejectUnsupported = async () => {
  throw new Error('Not supported here.')
}

export function DiffPane(props: {
  source: DiffSource
  /**
   * The qualified id of an `annotation` extension point this pane draws marks for, when its owner
   * declared one (docs/plugins.md § Cooperative extension points).
   *
   * A prop rather than something the source supplies, because the marks are drawn inside the
   * virtualized row and their height has to be measured with the row's — that is this component's
   * business, not a source's. The two owners are the changes pane and the GitHub pane, and each names
   * its own point.
   */
  annotations?: string
}) {
  const queryClient = useQueryClient()
  const prefs = createQuery(() => prefsOptions(true))
  // Marks compose with whatever the source already draws under a row: the changes pane's review notes
  // and a coverage plugin's marks appear together, in that order, because the source's own annotation
  // is the one the person using the pane wrote.
  const annotatedSource = createMemo<DiffSource>(() => {
    const point = props.annotations
    const base = props.source
    if (!point) return base
    return {
      ...base,
      lineExtra: (row) => [
        base.lineExtra?.(row),
        <AnnotationMarks point={point} itemKey={annotationKey(row)} />,
      ],
      hasLineExtra: (row) => (base.hasLineExtra?.(row) ?? false) || annotationsFor(point, annotationKey(row)).length > 0,
      lineExtraSignature: () => `${base.lineExtraSignature?.() ?? ''}\u0000${annotationSignature(point)}`,
    }
  })
  const source = () => annotatedSource()
  const files = () => source().files() ?? []
  const filesSignature = createMemo(() => source().signature())
  const contentSignature = createMemo(() => source().contentSignature?.() ?? filesSignature())
  const selectedPath = createMemo(() => source().selectedPath())
  const mentionsList = () => source().mentions?.() ?? []
  const canComment = () => source().canComment()
  const invalidate = () => source().invalidate()
  let lastTarget = ''

  const viewMode = (): ViewMode => (prefs.data?.[PrefKeys.diffView] === 'split' ? 'split' : 'unified')
  const setViewMode = async (mode: ViewMode) => {
    await savePref(queryClient, PrefKeys.diffView, mode)
  }

  // Patch bodies come from the source. Hydration then parses and tokenizes in priority order:
  // selected or visible file first, the rest in small idle batches.
  // Keyed by path, written one key at a time. It used to be a signal holding a `Map`, copied whole on
  // every parse, which is one full copy per file in the diff (docs/diff-rendering.md § Parsing and
  // highlighting).
  const [parsedByPath, setParsedByPath] = createStore<Record<string, ParsedFile>>({})
  // Context lines revealed by clicking a gap, keyed by that gap's stable identity. Reset when the
  // file set changes.
  const [expanded, setExpanded] = createSignal<Map<string, CodeRow[]>>(new Map())
  const [lineComposer, setLineComposer] = createSignal<{ key: string; body: string } | null>(null)
  // Collapsed diff files (header row stays, body rows are dropped from the row model). Remembered
  // per scope for the session, like the scroll position, and reseeded by the filesSignature effect
  // below so navigating away and back keeps a file collapsed.
  const [collapsedFiles, setCollapsedFiles] = createSignal<Set<string>>(new Set())
  const toggleFileCollapse = (path: string) => {
    const next = new Set(collapsedFiles())
    if (!next.delete(path)) next.add(path)
    setCollapsedFiles(next)
    rememberDiffCollapsed(source().scope, { filesSignature: filesSignature(), paths: [...next] })
  }
  // Keyed by thread id, for the same reason `parsedByPath` above is keyed by path.
  const [threadCollapsed, setThreadCollapsed] = createStore<Record<string, boolean | undefined>>({})
  const shouldUsePlainTokenizer = (file: DiffFile) => {
    const patch = file.patch ?? ''
    if (patch.length > HIGHLIGHT_MAX_PATCH_CHARS) return true
    let lines = 1
    for (let i = 0; i < patch.length; i++) {
      if (patch.charCodeAt(i) === 10 && ++lines > HIGHLIGHT_MAX_PATCH_LINES) return true
    }
    return false
  }

  const hydrator = createDiffHydrator({
    parseFile: (file) => measure('core', 'diff.parse', async () => ({
      file,
      diff: shouldUsePlainTokenizer(file) ? buildDiffRows(file, plainTokenize) : await buildDiffRowsAsync(file, tokenizeDocument),
    })),
    onParsed: (parsedFile) => setParsedByPath(parsedFile.file.path, parsedFile),
    cachedFile: (path) => source().cachedFile(path),
    fetchPatches: (paths, signal) => source().fetchPatches?.(paths, signal) ?? Promise.resolve([]),
  })
  onCleanup(hydrator.dispose)

  const parsed = createMemo<ParsedFile[]>(() =>
    files().map((file) => {
      // `unwrap`, because everything downstream of here walks tens of thousands of row objects and a
      // store proxy would mint a signal per property read on every one of them. The tracked read is
      // the lookup above it, which is the point: this memo depends on the files it has, not on a
      // counter every file shares.
      const parsedFile = parsedByPath[file.path]
      if (parsedFile) return unwrap(parsedFile)
      // The placeholder says "loading" and stays saying it. Whether this file failed is read live by
      // the row itself (`loadStatus` on the canvas below), so an error does not rebuild the row model
      // for every other file, and the row's identity key does not change under the virtualizer.
      return { file, diff: [{ kind: 'load', file, status: 'loading' }] }
    }))

  // A different set of files: nothing about the old view survives.
  createEffect(on(filesSignature, (signature, previous) => {
    lastTarget = ''
    setParsedByPath(reconcile({}))
    setExpanded(new Map())
    // Restore the scope's collapsed files if they were saved against this same file set; a changed
    // signature means a different diff, and a collapse decision about the old one does not carry over.
    const savedCollapsed = diffCollapsed(source().scope)
    setCollapsedFiles(new Set(savedCollapsed?.filesSignature === signature ? savedCollapsed.paths : []))
    setLineComposer(null)
    // The empty → populated transition is initial query hydration, not a changed diff. A genuine
    // signature change invalidates the old pixel position because the diff's geometry changed.
    if (previous && signature !== previous) resetScrollPosition(true)
  }))

  // The same files, saying something new. Re-read every patch, but keep `parsedByPath`: clearing it
  // would drop every file to a 36px placeholder for a frame, and a virtual canvas that collapses to a
  // tenth of its height has its scrollTop clamped by the browser before the rows come back. The old
  // rows stay on screen until each file's new parse replaces it.
  //
  // ponytail: re-reads every file in the set, not the ones that moved. The hydrator has retry(path)
  // if the spawn count ever matters; it would need a per-file content key on the port to know which.
  createEffect(on(contentSignature, () => {
    recordSample('core', 'diff.hydrator.reset', 1)
    recordSample('core', 'diff.files', files().length)
    hydrator.reset(files(), selectedPath() || undefined)
  }))

  createEffect(on(
    () => [filesSignature(), selectedPath()] as const,
    ([, path]) => {
      const list = files()
      if (!list.length) return
      const selected = path ? list.find((file) => file.path === path) : undefined
      const target = selected ?? list[0]
      if (target) hydrator.prioritize(target.path)
    },
  ))

  const rows = createMemo<Row[]>(() => {
    const result = measure('core', 'diff.rows', () => buildRenderableRows(parsed(), source().threads?.(), expanded(), collapsedFiles()))
    recordSample('core', 'diff.row_count', result.length)
    return result
  })

  // Every code row on screen, asked about in one request per contributor rather than one per line. The
  // effect re-runs when the rows do; `requestAnnotations` compares the key set and does nothing when it
  // has already asked, so a scroll or a thread toggle costs a string compare (plugins/annotations).
  createEffect(() => {
    const point = props.annotations
    if (!point) return
    requestAnnotations(point, rows().flatMap((row) => (isCodeRow(row) ? [annotationKey(row)] : [])))
  })

  const rowKeys = createMemo(() => rowIdentityKeys(rows()))
  const maxCols = createMemo(() => maxLineCols(rows()))

  // Fetch the file's head body once, slice the gap's hidden lines, and splice them into the row
  // stream by recording them in `expanded`. A source with no fileText renders the gap inert.
  const handleExpand = async (gap: GapRow) => {
    const fileText = source().fileText
    if (gap.sha == null || !fileText) return
    try {
      const lines = await expandGapAsync(gap, await fileText({ path: gap.path, sha: gap.sha }), tokenizeDocument)
      // The one full copy left in this file, and it stays: `buildRenderableRows` takes a `Map` and is
      // published on the plugin API (@acorn/plugin-api/ui/diff), and this write happens once per gap a
      // reader clicks open rather than once per file in the diff.
      setExpanded((prev) => new Map(prev).set(gapId(gap), lines))
    } catch (error) {
      // The gap goes back to being a gap. A read can fail for reasons the row cannot fix (the file
      // moved out from under a working-tree diff), and a rejection here would otherwise escape the
      // row's click handler entirely.
      log.error('gap expansion failed', error)
    }
  }

  // Split bands from the same interleaved rows (see toBands). Keep this cold in unified mode:
  // building and keying split bands is pure overhead while the main diff list is active.
  const bands = createMemo<SplitBand[]>(() => (viewMode() === 'split' ? toBands(rows()) : []))
  const bandKeys = createMemo(() => splitBandIdentityKeys(bands()))

  // Scroll element as a signal so the virtualizer re-attaches when it (re)mounts; it lives behind a
  // `<Show>` (no files, or split mode) so it is absent at this component's onMount. The virtualizer
  // reads the element's size only when getScrollElement first returns it. Publishing the ref inside
  // requestAnimationFrame guarantees that read happens after layout, when offsetHeight is real,
  // rather than in the same tick a cached query fills rows(); otherwise it freezes a 0-height
  // viewport and the range stays empty. measure() then drives the post-layout re-read.
  const [scrollEl, setScrollEl] = createSignal<HTMLDivElement>()
  const virt = createDiffVirtualizer({
    items: rows,
    keys: rowKeys,
    keyPrefix: 'row',
    estimateSize: (row) => (row ? estimateRowSize(row) : DIFF_LOAD_ROW_HEIGHT),
    scrollEl,
  })
  const splitVirt = createDiffVirtualizer({
    items: bands,
    keys: bandKeys,
    keyPrefix: 'band',
    estimateSize: estimateSplitBandSize,
    scrollEl,
  })

  const { scheduleVirtualMeasure, scheduleElementMeasure, cancel: cancelMeasures } = createDiffMeasureSchedulers(
    { unified: virt, split: splitVirt },
    scrollEl,
  )

  onMount(() => {
    const find = source().find
    const commands = registerCommands([
      { id: find.commandId, title: find.description, category: 'navigation', run: findController.openFind },
    ])
    const bindings = registerKeybindings([{
      id: find.commandId, command: find.commandId, description: find.description, category: find.category,
      defaultChord: 'meta+f', when: find.pane ? 'pane' : 'typing-exempt',
      ...(find.pane ? { pane: find.pane } : {}),
    }])
    onCleanup(() => { bindings.dispose(); commands.dispose() })
  })

  // Threads are measured (docs/diff-rendering.md § Row geometry): every code row is exactly
  // DIFF_LINE_HEIGHT, so there is nothing left to correct after the estimate. A code row carrying
  // one of the source's own annotations is the other exception, for the same reason.
  const hasLineExtra = (row: Row) => isCodeRow(row) && (source().hasLineExtra?.(row) ?? false)
  const shouldMeasureRow = (row: Row) => row.kind === 'thread' || hasLineExtra(row)
  const shouldMeasureBand = (band: SplitBand) =>
    band.kind === 'full'
      ? band.row.kind === 'thread'
      : (!!band.left && hasLineExtra(band.left)) || (!!band.right && hasLineExtra(band.right))

  const findController = createDiffFindController({ rows, bands, viewMode, unified: virt, split: splitVirt })

  const [scrollTop, setScrollTop] = createSignal(0)
  const { virtualRows, virtualBands, stickyFile } = createDiffStickyFile({
    rows,
    bands,
    viewMode,
    virt,
    splitVirt,
    scrollTop,
    files,
  })
  const stickyHead = () => (
    <Show when={stickyFile()}>
      {(f) => (
        <div class="diff-sticky-file">
          <FileHead file={f()} collapsed={collapsedFiles().has(f().path)} onToggleCollapse={toggleFileCollapse} />
        </div>
      )}
    </Show>
  )

  const threadLayoutSignature = createMemo(() =>
    (source().threads?.() ?? [])
      .map((thread) => `${thread.threadId}:${thread.resolved}:${threadCollapsed[thread.threadId] ?? thread.resolved}`)
      .join('\0'))
  const threadCollapseFor = (thread: DiffThread): ThreadCollapseController => ({
    collapsed: () => threadCollapsed[thread.threadId] ?? thread.resolved,
    setCollapsed: (collapsed) => setThreadCollapsed(thread.threadId, collapsed),
  })
  let serverThreadResolved = new Map<string, boolean>()
  createEffect(() => {
    const threads = source().threads?.() ?? []
    const ids = new Set(threads.map((thread) => thread.threadId))
    const resolvedChanges = new Map<string, boolean>()
    for (const thread of threads) {
      const previous = serverThreadResolved.get(thread.threadId)
      if (previous != null && previous !== thread.resolved) resolvedChanges.set(thread.threadId, thread.resolved)
    }
    serverThreadResolved = new Map(threads.map((thread) => [thread.threadId, thread.resolved]))
    // `undefined` rather than a delete: every read of this store falls back to the thread's own
    // resolved flag, so forgetting an override and never having had one are the same state.
    batch(() => {
      for (const id of Object.keys(unwrap(threadCollapsed))) {
        if (!ids.has(id)) setThreadCollapsed(id, undefined)
      }
      for (const [id, resolved] of resolvedChanges) setThreadCollapsed(id, resolved ? true : undefined)
    })
  })
  createEffect(() => {
    const paths = new Set<string>()
    if (viewMode() === 'split') {
      for (const { band } of virtualBands()) {
        if (band.kind === 'pair') {
          if (band.left) paths.add(band.left.path)
          if (band.right) paths.add(band.right.path)
        } else if (band.row.kind === 'file' || band.row.kind === 'load') {
          paths.add(band.row.file.path)
        } else if (band.row.kind === 'gap') {
          paths.add(band.row.path)
        }
      }
    } else {
      for (const { row } of virtualRows()) {
        if (row.kind === 'file' || row.kind === 'load') paths.add(row.file.path)
        else if (isCodeRow(row) || row.kind === 'gap') paths.add(row.path)
      }
    }
    if (paths.size) hydrator.prioritize([...paths])
  })
  createEffect(() => {
    if (scrollEl()) {
      virt.measure()
      if (viewMode() === 'split') splitVirt.measure()
    }
  })
  createEffect(() => {
    rows().length
    if (scrollEl()) scheduleVirtualMeasure('unified')
  })
  createEffect(() => {
    if (viewMode() !== 'split') return
    bands().length
    if (scrollEl()) scheduleVirtualMeasure('split')
  })
  // Depend on the composer's *key* through a memo (equality-checked), not the composer object: the
  // object is replaced on every keystroke, and re-measuring per keystroke remounts the virtual rows,
  // which destroys the focused textarea (flicker and lost selection). Only opening, closing, or
  // moving the composer changes row heights.
  const lineComposerKey = createMemo(() => lineComposer()?.key ?? null)
  createEffect(() => {
    lineComposerKey()
    if (!scrollEl()) return
    scheduleVirtualMeasure('unified')
    if (viewMode() === 'split') scheduleVirtualMeasure('split')
  })
  createEffect(() => {
    threadLayoutSignature()
    if (!scrollEl()) return
    scheduleVirtualMeasure('unified')
    if (viewMode() === 'split') scheduleVirtualMeasure('split')
  })
  // Same argument as the two effects above, for the source's own annotations.
  createEffect(() => {
    source().lineExtraSignature?.()
    if (!scrollEl()) return
    scheduleVirtualMeasure('unified')
    if (viewMode() === 'split') scheduleVirtualMeasure('split')
  })
  const scrollRestoration = createDiffScrollRestoration({
    scope: props.source.scope,
    viewMode,
    filesSignature,
    selectedPath,
    scrollEl,
    setScrollEl,
    setScrollTop,
    measure: (mode) => mode === 'split' ? splitVirt.measure() : virt.measure(),
  })
  onCleanup(() => {
    cancelMeasures()
  })
  const resetScrollPosition = scrollRestoration.reset
  // Every progressive hydration pass changes the virtual content height. A pending position is
  // retried after the row model updates so a deep saved offset is not lost to placeholder clamping.
  createEffect(() => {
    rows()
    if (viewMode() === 'split') bands()
    scrollRestoration.retry()
  })

  const scrollToFile = (path: string, force = false) => {
    const all = rows()
    const idx = all.findIndex((r) => r.kind === 'file' && r.file.path === path)
    if (idx < 0) return false
    hydrator.prioritize(path)
    if (!force && path === lastTarget) return true
    lastTarget = path
    if (viewMode() === 'split') {
      const bandIdx = bands().findIndex((band) => band.kind === 'full' && band.row.kind === 'file' && band.row.file.path === path)
      if (bandIdx < 0) return false
      splitVirt.scrollToIndex(bandIdx, { align: 'start' })
    } else {
      virt.scrollToIndex(idx, { align: 'start' })
    }
    return true
  }

  onMount(() => {
    const off = clientEvents.on('presentation:file-scroll', (detail) => {
      if (!detail || detail.routeKey !== source().scope.routeKey) return
      lastTarget = ''
      scrollToFile(detail.path, true)
    })
    onCleanup(off)
  })

  // Scroll to the selected file once the file headers exist (docs/diff-rendering.md § Review threads
  // and state). Loading that file's patch is prioritized separately so navigation doesn't wait for
  // tokenization.
  createEffect(() => {
    const path = selectedPath()
    if (!path) {
      lastTarget = ''
      return
    }
    scrollToFile(path)
  })

  const lineComment = (r: CodeRow) => {
    const side = r.oldNo != null && r.newNo == null ? 'LEFT' : 'RIGHT'
    const lineNo = side === 'LEFT' ? r.oldNo : r.newNo
    return {
      side: side as CommentSide,
      lineNo: lineNo ?? 0,
      key: lineNo == null ? '' : commentTargetKey(r.path, side, lineNo),
      canAdd: canComment() && lineNo != null,
    }
  }

  const commentTargetKey = (path: string, side: CommentSide, lineNo: number) => JSON.stringify([path, side, lineNo])
  // Persist an in-progress new-line comment per line so it survives navigation and reload. The
  // composer is single-slot (one open line at a time), so this seeds body from the draft when it
  // opens and writes back on edit; submitting sets body to '' which removes the key.
  const lineDraftKey = (key: string) => `line-comment:${source().draftPrefix}:${key}`
  const composerFor = (key: string): LineComposerController => ({
    isOpen: () => lineComposer()?.key === key,
    body: () => {
      const current = lineComposer()
      return current?.key === key ? current.body : ''
    },
    setOpen: (open) => {
      setLineComposer((current) => {
        if (open) return { key, body: current?.key === key ? current.body : readDraft(lineDraftKey(key)) }
        return current?.key === key ? null : current
      })
    },
    setBody: (body) => {
      writeDraft(lineDraftKey(key), body)
      setLineComposer({ key, body })
    },
  })

  const splitComposer = (r: CodeRow | null, side: CommentSide) => {
    const lineNo = side === 'LEFT' ? r?.oldNo : r?.newNo
    return r && lineNo != null ? composerFor(commentTargetKey(r.path, side, lineNo)) : undefined
  }

  return (
    <Show
      when={files().length}
      fallback={<EmptyState align="start" busy={source().loading()}>{source().loading() ? 'Loading…' : 'No files.'}</EmptyState>}
    >
      <DiffToolbar find={findController} viewMode={viewMode} setViewMode={setViewMode} />
      <DiffCanvas
        viewMode={viewMode}
        rows={rows}
        bands={bands}
        virt={virt}
        splitVirt={splitVirt}
        stickyHead={stickyHead}
        publishScrollEl={(element, mode) => scrollRestoration.publish(element, mode)}
        onScroll={(element) => scrollRestoration.onScroll(element)}
        maxCols={maxCols}
        scheduleElementMeasure={scheduleElementMeasure}
        shouldMeasureRow={shouldMeasureRow}
        shouldMeasureBand={shouldMeasureBand}
        onMutated={invalidate}
        resolveThread={(threadId, resolved) => source().resolveThread?.(threadId, resolved) ?? rejectUnsupported()}
        replyReview={(databaseId, body) => source().reply?.(databaseId, body) ?? rejectUnsupported()}
        expandGap={handleExpand}
        retryDiff={(path) => hydrator.retry(path)}
        loadStatus={(path) => (hydrator.status(path) === 'error' ? 'error' : 'loading')}
        mentions={mentionsList}
        threadCollapse={threadCollapseFor}
        fileCollapsed={(path) => collapsedFiles().has(path)}
        onToggleFileCollapse={toggleFileCollapse}
        lineComment={lineComment}
        addComment={(body, row, side, lineNo) => source().addComment?.(body, { row, side, lineNo }) ?? rejectUnsupported()}
        composerFor={composerFor}
        splitComposer={splitComposer}
        canComment={canComment}
        invalidate={invalidate}
        findHighlight={findController.findHighlight}
        lineExtra={source().lineExtra}
        lineAction={source().lineAction}
      />
    </Show>
  )
}
