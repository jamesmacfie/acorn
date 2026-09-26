import { measure, recordSample } from '../../infra/telemetry/emitter'
import { batch, createEffect, createMemo, createSignal, on, onCleanup, onMount, Show } from 'solid-js'
import { createStore, unwrap } from 'solid-js/store'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { segmentContentKey, type DiffSearchMatch } from '@acorn/diff-document/document'
import { tokenizeDocument } from '../../infra/highlight/worker'
import { diffWordsDocument } from '../../infra/highlight/wordDiffWorker'
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
import { annotationsFor, requestAnnotations } from '../../host/annotations/annotations'
import { DiffToolbar } from './DiffToolbar'
import { createDiffFindController } from './findController'
import {
  DIFF_LINE_HEIGHT,
  enrichDiffRows,
  expandGapAsync,
  isCodeRow,
  maxLineCols,
  type CodeRow,
  type DiffRow,
  type DiffThread,
  type GapRow,
  type Row,
  type ThreadRowT,
  type ViewMode,
} from '../../kit/diff/diffModel'
import { createDiffScrollRestoration } from './scrollRestoration'
import type { CommentSide, DiffSource } from './source'
import { createDiffStickyFile } from './stickyFile'
import { diffCollapsed, rememberDiffCollapsed } from './viewState'
import { createDiffHealth } from './diffHealth'
import { bandBlock, createDiffLayout, lineBlock, rowBlocks, threadBlock, type DiffBlockInputs } from './diffLayout'
import { createDocumentView, threadAnchor, type DiffItem, type GapOverlay, type SegmentRef } from './documentView'
import { createSegmentLoader } from './segmentLoader'
import { createLogger } from '../../infra/telemetry/logger'

const log = createLogger('diff')

// The diff shell: every changed file stacked in one virtualized list, in unified or split mode, with
// find, a sticky file header, per-file collapse, gap expansion, and an inline comment layer
// (docs/diff-rendering.md). Each file opens with a header, and the source's selected path is a
// scroll target rather than a file picker.
//
// The list is of segments, not rows. The source's topology lays out every file and segment exactly
// before any row exists; the segment loader fetches the rows of the segments near the reader and
// nothing else, paints them plain, and colours them after (./segmentLoader.ts). A row object exists
// only for a segment that is on screen or about to be.
//
// Everything specific to a provider arrives through DiffSource, so this component names no product:
// the GitHub plugin fills it in from a pull request or a comparison, the changes plugin from a
// working tree.

type ContentItem = Extract<DiffItem, { kind: 'segment' | 'overlay' }>

/** Segments either side of the virtual range that load ahead of the reader, so a scroll arrives at
 *  rows rather than at placeholders. Colour follows the same range. */
const PREFETCH_SEGMENTS = 2

const rejectUnsupported = async () => {
  throw new Error('Not supported here.')
}

const lineKey = (path: string, side: 'old' | 'new', line: number) => `${path}\u0000${side}\u0000${line}`

export function DiffPane(props: {
  source: DiffSource
  /**
   * The qualified id of an `annotation` extension point this pane draws marks for, when its owner
   * declared one (docs/plugins.md § Cooperative extension points).
   *
   * A prop rather than something the source supplies, because the marks are drawn inside the
   * virtualized item and their height has to be measured with it — that is this component's
   * business, not a source's. The two owners are the changes pane and the GitHub pane, and each names
   * its own point.
   */
  annotations?: string
}) {
  // First, so its cleanup runs after every other one here and its final reading sees them done
  // (./diffHealth.ts).
  const health = createDiffHealth()
  onCleanup(health.dispose)
  const queryClient = useQueryClient()
  const prefs = createQuery(() => prefsOptions(true))
  // A memo, because a prop is a getter: `source={makeSource()}` in a caller's JSX would otherwise build
  // a new source, and with it a new topology, on every read.
  const source = createMemo(() => props.source)
  const topology = () => source().topology()
  const signature = createMemo(() => source().signature())
  const revision = createMemo(() => topology()?.revision ?? '')
  const selectedPath = createMemo(() => source().selectedPath())
  const threads = () => source().threads?.()
  const mentionsList = () => source().mentions?.() ?? []
  const canComment = () => source().canComment()
  const invalidate = () => source().invalidate()
  let lastTarget = ''

  const viewMode = (): ViewMode => (prefs.data?.[PrefKeys.diffView] === 'split' ? 'split' : 'unified')
  const setViewMode = async (mode: ViewMode) => {
    await savePref(queryClient, PrefKeys.diffView, mode)
  }

  // Context lines revealed by clicking a gap, keyed by the content of the segment the gap was in, so
  // a new revision of that file leaves them behind by construction.
  const [overlays, setOverlays] = createSignal<ReadonlyMap<string, GapOverlay[]>>(new Map())
  const [lineComposer, setLineComposer] = createSignal<{ key: string; body: string } | null>(null)
  // Collapsed files keep their header and drop their segments from the list. Remembered per scope for
  // the session, like the scroll position, and reseeded by the signature effect below so navigating
  // away and back keeps a file collapsed.
  const [collapsedFiles, setCollapsedFiles] = createSignal<ReadonlySet<string>>(new Set())
  // Keyed by thread id: one key per thread, set to a boolean, never an object merged by path.
  const [threadCollapsed, setThreadCollapsed] = createStore<Record<string, boolean | undefined>>({})

  const view = createDocumentView({ topology, collapsed: collapsedFiles, overlays, threads })
  const items = view.items

  // Spans per batch and per coloured segment, and the batch size as a sample: what reading near the
  // viewport costs, rather than what the whole document would (docs/telemetry.md § Rendered-surface
  // health). Counts and times only.
  const loader = createSegmentLoader({
    load: (requests, signal) => {
      recordSample('core', 'diff.segments.requested', requests.length)
      return measure('core', 'diff.segments.load', () => source().loadSegments(requests, signal))
    },
    enrich: (rows) => measure('core', 'diff.segments.enrich', () => enrichDiffRows(rows, tokenizeDocument, diffWordsDocument)),
    prepared: health.prepared,
  })
  onCleanup(loader.dispose)

  // Threads by file and line, and one row object per thread so a segment redrawn for its colour keeps
  // the same thread rows under the same index.
  const threadsAt = createMemo(() => {
    const byLine = new Map<string, DiffThread[]>()
    for (const thread of threads() ?? []) {
      const anchor = threadAnchor(thread)
      if (!anchor || !thread.path) continue
      const key = lineKey(thread.path, anchor.side, anchor.line)
      const bucket = byLine.get(key)
      if (bucket) bucket.push(thread)
      else byLine.set(key, [thread])
    }
    return byLine
  })
  const threadRows = new WeakMap<DiffThread, ThreadRowT>()
  const threadRow = (thread: DiffThread) => {
    let row = threadRows.get(thread)
    if (!row) threadRows.set(thread, (row = { kind: 'thread', thread }))
    return row
  }
  const withThreads = (rows: readonly (DiffRow | CodeRow)[]): Row[] => {
    const byLine = threadsAt()
    if (!byLine.size) return rows as Row[]
    const out: Row[] = []
    for (const row of rows) {
      out.push(row)
      if (!isCodeRow(row)) continue
      if (row.newNo != null) for (const thread of byLine.get(lineKey(row.path, 'new', row.newNo)) ?? []) out.push(threadRow(thread))
      if (row.oldNo != null) for (const thread of byLine.get(lineKey(row.path, 'old', row.oldNo)) ?? []) out.push(threadRow(thread))
    }
    return out
  }
  const itemRows = (item: ContentItem): readonly Row[] | undefined => {
    if (item.kind === 'overlay') return withThreads(item.rows)
    const loaded = loader.rows(item.segment.contentKey)
    if (!loaded) return undefined
    return withThreads(loaded.slice(item.skipFirst ? 1 : 0, item.skipLast ? loaded.length - 1 : loaded.length))
  }

  // What the source draws under a line, known up front, plus any other plugin's marks. As a
  // fingerprint, because whether a line's block can reuse a height measured earlier depends on it.
  const extraLines = createMemo(() => new Set((source().lineExtra?.anchors() ?? []).map((anchor) => lineKey(anchor.path, anchor.side, anchor.line))))
  const lineExtraPrint = (row: CodeRow): string | null => {
    const side = row.kind === 'delete' ? 'old' : 'new'
    const line = side === 'old' ? row.oldNo : row.newNo
    const own = line != null && extraLines().has(lineKey(row.path, side, line))
    const point = props.annotations
    const marks = point ? annotationsFor(point, annotationKey(row)).length : 0
    return own || marks ? `${own ? 1 : 0}.${marks}` : null
  }
  const hasLineExtra = (row: CodeRow) => lineExtraPrint(row) != null
  const lineExtra = (row: CodeRow) => {
    const point = props.annotations
    return [source().lineExtra?.render(row), point ? <AnnotationMarks point={point} itemKey={annotationKey(row)} /> : null]
  }

  // The dynamic blocks: threads, and whatever a line draws under itself (./diffLayout.ts).
  const openComposer = createMemo(() => lineComposer()?.key ?? null)
  const blockInputs: DiffBlockInputs = {
    extra: lineExtraPrint,
    composer: (row, side) => {
      const open = openComposer()
      if (!open) return false
      if (side === null) {
        const comment = lineComment(row)
        return comment.canAdd && comment.key === open
      }
      const lineNo = side === 'LEFT' ? row.oldNo : row.newNo
      return canComment() && lineNo != null && commentTargetKey(row.path, side, lineNo) === open
    },
    collapsed: (thread) => threadCollapsed[thread.threadId] ?? thread.resolved,
  }
  const itemBlocks = (item: DiffItem, mode: ViewMode) => {
    if (item.kind !== 'segment' && item.kind !== 'overlay') return []
    const rows = itemRows(item)
    if (rows) return rowBlocks(rows, mode, blockInputs)
    // Not loaded yet: the segment's threads, known from their line numbers, reserved at its end until
    // its rows say where each one goes.
    const at = view.fixedHeight(item, mode)
    return (view.threadsIn().get(item.key) ?? []).map((thread) => threadBlock(thread, at, blockInputs.collapsed(thread)))
  }
  const sourceItems = createMemo(() => [...view.threadsIn().keys()])

  // Scroll element as a signal so the layout re-attaches when it (re)mounts; it lives behind a
  // `<Show>` (no files, or split mode) so it is absent at this component's onMount. Published inside
  // requestAnimationFrame, after layout, so the viewport's height is real when it is first read.
  const [scrollEl, setScrollEl] = createSignal<HTMLDivElement>()
  const layout = createDiffLayout({
    items,
    mode: viewMode,
    fixedHeight: view.fixedHeight,
    blocks: itemBlocks,
    sourceItems,
    scrollEl,
  })

  // A different set of files: nothing about the old view survives.
  createEffect(on(signature, (next, previous) => {
    lastTarget = ''
    health.reset()
    loader.reset()
    layout.reset()
    setOverlays(new Map())
    // Restore the scope's collapsed files if they were saved against this same file set; a changed
    // signature means a different diff, and a collapse decision about the old one does not carry over.
    const savedCollapsed = diffCollapsed(source().scope)
    setCollapsedFiles(new Set(savedCollapsed?.filesSignature === next ? savedCollapsed.paths : []))
    setLineComposer(null)
    // The empty → populated transition is initial query hydration, not a changed diff. A genuine
    // signature change invalidates the old pixel position because the diff's geometry changed.
    if (previous && next !== previous) resetScrollPosition(true)
  }))
  // The same files, saying something new: a new revision. Requests for the old one stop; any segment
  // whose content key survived keeps its rows, so an agent saving one file reloads that file's
  // segments and leaves the reader where they were.
  createEffect(on(revision, (_next, previous) => {
    if (previous !== undefined) loader.reset()
  }))
  createEffect(() => {
    if (topology() && !source().loading()) health.ready()
  })
  createEffect(on(revision, () => {
    const totals = topology()?.totals
    if (!totals) return
    recordSample('core', 'diff.files', totals.files)
    recordSample('core', 'diff.document.segments', totals.segments)
  }))
  createEffect(() => health.threads(threads()))

  const toggleFileCollapse = (path: string) => {
    const next = new Set(collapsedFiles())
    if (!next.delete(path)) next.add(path)
    setCollapsedFiles(next)
    rememberDiffCollapsed(source().scope, { filesSignature: signature(), paths: [...next] })
    // Collapsing a file from the sticky header removes the item the reader was in, and the layout
    // puts them on the file's header instead, so they stay on the file they collapsed.
  }

  // What the reader can see, what is near, and nothing else: the loader's whole demand. Recomputed as
  // the range moves, which drops queued work the reader has scrolled away from.
  createEffect(() => {
    const all = items()
    const range = layout.range()
    if (!range.length) return
    const first = range[0]!.index
    const last = range[range.length - 1]!.index
    const refs = (from: number, to: number, step: number, limit: number) => {
      const out: SegmentRef[] = []
      for (let index = from; index !== to && out.length < limit; index += step) {
        const item = all[index]
        if (item?.kind === 'segment') out.push(item.segment)
      }
      return out
    }
    const visible = refs(first, last + 1, 1, Infinity)
    const near = [...refs(last + 1, all.length, 1, PREFETCH_SEGMENTS), ...refs(first - 1, -1, -1, PREFETCH_SEGMENTS)]
    loader.demand(visible, near)
  })

  // Other plugins' marks, asked for the code rows near the reader only. `requestAnnotations` compares
  // the key set and does nothing when it has already asked, so a scroll within the same segments
  // costs a string compare (plugins/annotations).
  createEffect(() => {
    const point = props.annotations
    if (!point) return
    const all = items()
    const keys = []
    for (const vi of layout.range()) {
      const item = all[vi.index]
      if (item?.kind !== 'segment' && item?.kind !== 'overlay') continue
      for (const row of itemRows(item) ?? []) if (isCodeRow(row)) keys.push(annotationKey(row))
    }
    requestAnnotations(point, keys)
  })

  // The canvas is as wide as the widest line in the document, from the topology, and as any gap the
  // reader opened.
  const maxCols = createMemo(() => {
    let widest = topology()?.totals.columns ?? 0
    for (const opened of overlays().values()) for (const overlay of opened) widest = Math.max(widest, maxLineCols(overlay.rows))
    return widest
  })

  // Read the file's new side once, slice the gap's hidden lines, and put them beside the segment the
  // gap sat at the edge of. A source with no fileText renders the gap inert.
  const handleExpand = async (gap: GapRow) => {
    const fileText = source().fileText
    const file = view.fileByPath().get(gap.path)
    if (gap.sha == null || !fileText || !file?.patchKey) return
    const at = gapPosition(gap)
    if (!at) return
    try {
      const lines = await expandGapAsync(gap, await fileText({ path: gap.path, sha: gap.sha }), tokenizeDocument)
      // A newer revision of the file arrived while the body was being read: this gap is gone.
      if (!loader.rows(at.contentKey)) return
      setOverlays((current) => {
        const next = new Map(current)
        next.set(at.contentKey, [...(current.get(at.contentKey) ?? []), { edge: at.edge, rows: lines }])
        return next
      })
    } catch (error) {
      // The gap goes back to being a gap. A read can fail for reasons the row cannot fix (the file
      // moved out from under a working-tree diff), and a rejection here would otherwise escape the
      // row's click handler entirely.
      log.error('gap expansion failed', error)
    }
  }
  const gapPosition = (gap: GapRow): { contentKey: string; edge: GapOverlay['edge'] } | null => {
    const file = view.fileByPath().get(gap.path)
    if (!file?.patchKey) return null
    for (let ordinal = 0; ordinal < file.segments.length; ordinal++) {
      const contentKey = segmentContentKey(file.patchKey, ordinal)
      const rows = loader.rows(contentKey)
      const index = rows?.findIndex((row) => row.kind === 'gap' && row.side === gap.side && row.oldStart === gap.oldStart && row.newStart === gap.newStart) ?? -1
      if (index >= 0) return { contentKey, edge: index === 0 ? 'first' : 'last' }
    }
    return null
  }

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

  // Take the reader to a match: its segment's item, then the row inside it by the fixed row height,
  // below whatever blocks sit above it. The segment loads because it is now on screen; the highlight
  // draws when its rows arrive.
  const revealMatch = (match: DiffSearchMatch) => {
    const index = view.indexByKey().get(`s:${match.path}:${match.ordinal}`)
    const at = index == null ? null : layout.offsetOf(index, match.row * DIFF_LINE_HEIGHT)
    const element = scrollEl()
    if (at == null || !element) return
    layout.scrollToOffset(at - element.clientHeight / 2)
  }
  const findController = createDiffFindController({ search: (request, signal) => source().search(request, signal), revision, reveal: revealMatch })
  const findHighlight = (row: CodeRow) => {
    const place = loader.place(row)
    return place ? findController.findHighlight(place.contentKey, place.index) : undefined
  }

  health.attach({
    topology,
    items,
    placedThreads: view.placedThreads,
    threads,
    layout,
    scrollEl,
    loader,
    itemRows,
    hasLineExtra,
  })

  const stickyFile = createDiffStickyFile({ items, range: layout.range, scrollTop: layout.scrollTop })
  const stickyHead = () => (
    <Show when={stickyFile()}>
      {(f) => (
        <div class="diff-sticky-file">
          <FileHead file={f()} collapsed={collapsedFiles().has(f().path)} onToggleCollapse={toggleFileCollapse} />
        </div>
      )}
    </Show>
  )

  const threadCollapseFor = (thread: DiffThread): ThreadCollapseController => ({
    collapsed: () => threadCollapsed[thread.threadId] ?? thread.resolved,
    setCollapsed: (collapsed) => setThreadCollapsed(thread.threadId, collapsed),
  })
  let serverThreadResolved = new Map<string, boolean>()
  createEffect(() => {
    const list = threads() ?? []
    const ids = new Set(list.map((thread) => thread.threadId))
    const resolvedChanges = new Map<string, boolean>()
    for (const thread of list) {
      const previous = serverThreadResolved.get(thread.threadId)
      if (previous != null && previous !== thread.resolved) resolvedChanges.set(thread.threadId, thread.resolved)
    }
    serverThreadResolved = new Map(list.map((thread) => [thread.threadId, thread.resolved]))
    // `undefined` rather than a delete: every read of this store falls back to the thread's own
    // resolved flag, so forgetting an override and never having had one are the same state.
    batch(() => {
      for (const id of Object.keys(unwrap(threadCollapsed))) {
        if (!ids.has(id)) setThreadCollapsed(id, undefined)
      }
      for (const [id, resolved] of resolvedChanges) setThreadCollapsed(id, resolved ? true : undefined)
    })
  })

  const scrollRestoration = createDiffScrollRestoration({
    scope: props.source.scope,
    viewMode,
    filesSignature: signature,
    selectedPath,
    scrollEl,
    setScrollEl,
    layout,
  })
  const resetScrollPosition = scrollRestoration.reset
  // The document's layout is known from the first topology, but a place saved before the topology
  // arrived waits for it rather than landing on an empty canvas.
  createEffect(() => {
    items()
    scrollRestoration.retry()
  })

  const scrollToFile = (path: string, force = false) => {
    const index = view.indexByKey().get(`f:${path}`)
    if (index == null) return false
    if (!force && path === lastTarget) return true
    lastTarget = path
    layout.scrollToIndex(index)
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

  // Scroll to the selected file once its header exists, which is as soon as the topology does: its
  // offset is exact before any of its rows load (docs/diff-rendering.md § Review threads and state).
  createEffect(() => {
    const path = selectedPath()
    items()
    if (!path) {
      lastTarget = ''
      return
    }
    scrollToFile(path)
  })

  const commentTargetKey = (path: string, side: CommentSide, lineNo: number) => JSON.stringify([path, side, lineNo])
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
      when={topology()?.files.length}
      fallback={<EmptyState align="start" busy={source().loading()}>{source().loading() ? 'Loading…' : 'No files.'}</EmptyState>}
    >
      <DiffToolbar find={findController} viewMode={viewMode} setViewMode={setViewMode} />
      <DiffCanvas
        viewMode={viewMode}
        items={items}
        layout={layout}
        stickyHead={stickyHead}
        publishScrollEl={(element) => scrollRestoration.publish(element)}
        onScroll={(element) => scrollRestoration.onScroll(element)}
        maxCols={maxCols}
        itemRows={itemRows}
        segmentStatus={loader.status}
        retrySegment={loader.retry}
        fileCollapsed={(path) => collapsedFiles().has(path)}
        onToggleFileCollapse={toggleFileCollapse}
        rows={{
          onMutated: invalidate,
          resolveThread: (threadId, resolved) => source().resolveThread?.(threadId, resolved) ?? rejectUnsupported(),
          replyReview: (databaseId, body) => source().reply?.(databaseId, body) ?? rejectUnsupported(),
          expandGap: handleExpand,
          mentions: mentionsList,
          threadCollapse: threadCollapseFor,
          lineComment,
          addComment: (body, row, side, lineNo) => source().addComment?.(body, { row, side, lineNo }) ?? rejectUnsupported(),
          composerFor,
          splitComposer,
          canComment,
          findHighlight,
          hasLineExtra,
          lineExtra,
          lineAction: source().lineAction,
          openLine: source().openLine,
          lineBlock: (row) => lineBlock(row, blockInputs)?.id ?? null,
          bandBlock: (left, right) => bandBlock(left, right, blockInputs)?.id ?? null,
          observeBlock: layout.observeBlock,
        }}
      />
    </Show>
  )
}
