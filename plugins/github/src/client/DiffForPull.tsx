import { createEffect, createMemo, createSignal, on, onCleanup, onMount, Show } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { useSearchParams } from '@solidjs/router'
import { filesKey } from '../contract/api'
import { prefsOptions } from '@acorn/client-core/queries.ts'
import { fetchFilePatches, fileBlobOptions, filesOptions, mentionsOptions, pullDetailOptions } from './queries'
import { filePatchKey, pullKey, type PullFile, type Thread } from '../contract/api'
import { addReviewComment, replyReview, resolveThread } from './mutations'
import { getHighlighter } from '@acorn/client-core/highlight/shiki.ts'
import { FileHead, type LineComposerController, type ThreadCollapseController } from '@acorn/client-core/ui/diff/DiffRows.tsx'
import { registerCommands } from '@acorn/client-core/registries/commands.ts'
import { registerKeybindings } from '@acorn/client-core/registries/keybindings.tsx'
import { clientEvents } from '@acorn/client-core/registries/clientEvents.ts'
import { createDiffHydrator } from '@acorn/client-core/ui/diff/hydration.ts'
import { readDraft, writeDraft } from '@acorn/client-core/lib/draftState.ts'
import { createDiffMeasureSchedulers, createDiffVirtualizer } from '@acorn/client-core/ui/diff/virtualization.ts'
import {
  buildDiffRows,
  buildRenderableRows,
  DIFF_LOAD_ROW_HEIGHT,
  estimateRowSize,
  estimateSplitBandSize,
  expandGap,
  gapId,
  highlighterTokenize,
  isCodeRow,
  plainTokenize,
  rowIdentityKeys,
  splitBandIdentityKeys,
  toBands,
  type CodeRow,
  type GapRow,
  type ParsedFile,
  type Row,
  type SplitBand,
  type TokenizeLine,
  type ViewMode,
} from '@acorn/client-core/ui/diff/model.ts'
import { savePref } from '@acorn/client-core/settings/savePref.ts'
import { PrefKeys } from '@acorn/client-core/persistence/prefKeys.ts'
import { createDiffScrollRestoration } from './reviewScrollRestoration'
import type { ReviewViewScope } from './reviewViewState'
import { createDiffFindController } from './DiffFindController'
import { DiffToolbar } from './DiffToolbar'
import { DiffCanvas } from './DiffCanvas'
import { createDiffStickyFile } from './DiffStickyFile'

// Right (Diff) pane: render EVERY changed file's diff stacked one after another in a single
// virtualized list (docs/diff-rendering.md, docs/ui-design.md). Each file opens with a header row;
// `?file=` no longer picks which file is shown — it's the scroll target (the file list, finder,
// and [ / ] all set it), so selecting a file scrolls the combined diff to it.
//
// The files query returns the full changed-file payload, so patch bodies are normally all present
// up front; the hydrator's fetchPatches fallback re-fetches any body that is still missing (a
// leftover of the earlier summaries-first design that now only covers partial/restored caches —
// binary and too-large files legitimately have no patch and render a "No diff" row instead).
// Parsing and Shiki highlighting hydrate in priority order so large PRs do not turn one network
// gap into one giant main-thread block. Review threads are interleaved at render time (matched by
// path) so thread mutations rerender without re-tokenizing patches.
//
export type PullRoute = {
  owner: string
  repo: string
  number: string
  key: string
}
const HIGHLIGHT_MAX_PATCH_CHARS = 120_000
const HIGHLIGHT_MAX_PATCH_LINES = 2_000

export function DiffForPull(props: { route: PullRoute; router: boolean; taskId?: string }) {
  const searchParams = props.router ? useSearchParams()[0] : {}
  const queryClient = useQueryClient()
  const owner = props.route.owner
  const repo = props.route.repo
  const number = props.route.number
  const reviewScope: ReviewViewScope = { taskId: props.taskId, routeKey: props.route.key }

  const files = createQuery(() => filesOptions(owner, repo, number, true))
  const detail = createQuery(() => pullDetailOptions(owner, repo, number, true))
  const prefs = createQuery(() => prefsOptions(true))
  const mentionsQuery = createQuery(() => mentionsOptions(owner, repo, true))
  const mentionsList = () => mentionsQuery.data ?? []
  const headSha = () => detail.data?.pull?.headSha ?? null
  let lastTarget = ''

  const viewMode = (): ViewMode => (prefs.data?.[PrefKeys.diffView] === 'split' ? 'split' : 'unified')
  const setViewMode = async (mode: ViewMode) => {
    await savePref(queryClient, PrefKeys.diffView, mode)
  }

  const invalidate = () => queryClient.invalidateQueries({ queryKey: pullKey(owner, repo, number) })

  // Patch bodies arrive with the PR's files query. Hydration then parses/tokenizes automatically in
  // priority order: selected/visible file first, the rest in small idle batches.
  const [parsedByPath, setParsedByPath] = createSignal<Map<string, ParsedFile>>(new Map())
  // Context lines revealed by clicking a gap, keyed by that gap's stable identity. Reset when the file
  // set changes.
  const [expanded, setExpanded] = createSignal<Map<string, CodeRow[]>>(new Map())
  const [lineComposer, setLineComposer] = createSignal<{ key: string; body: string } | null>(null)
  // Collapsed diff files (header row stays, body rows are dropped from the row model). Session-only.
  const [collapsedFiles, setCollapsedFiles] = createSignal<Set<string>>(new Set())
  const toggleFileCollapse = (path: string) =>
    setCollapsedFiles((prev) => {
      const next = new Set(prev)
      if (!next.delete(path)) next.add(path)
      return next
    })
  const [threadCollapsed, setThreadCollapsed] = createSignal<Map<string, boolean>>(new Map())
  let tokenizerPromise: Promise<TokenizeLine> | null = null
  const loadTokenizer = async () => {
    return (tokenizerPromise ??= getHighlighter().then(highlighterTokenize).catch(() => plainTokenize))
  }

  const shouldUsePlainTokenizer = (file: PullFile) => {
    const patch = file.patch ?? ''
    if (patch.length > HIGHLIGHT_MAX_PATCH_CHARS) return true
    let lines = 1
    for (let i = 0; i < patch.length; i++) {
      if (patch.charCodeAt(i) === 10 && ++lines > HIGHLIGHT_MAX_PATCH_LINES) return true
    }
    return false
  }

  const hydrator = createDiffHydrator({
    tokenizerForFile: (file) => (shouldUsePlainTokenizer(file) ? Promise.resolve(plainTokenize) : loadTokenizer()),
    parseFile: (file, tokenize) => ({ file, diff: buildDiffRows(file, tokenize) }),
    onParsed: (parsedFile) => setParsedByPath((prev) => new Map(prev).set(parsedFile.file.path, parsedFile)),
    // Patch-body source: the query cache first (per-path patch entries, then the warmed files
    // query — which also resolves binary/too-large files to their legitimate null patch)…
    cachedFile: (path) => {
      const direct = queryClient.getQueryData<PullFile>(filePatchKey(owner, repo, number, path))
      if (direct) return direct
      const warmed = queryClient.getQueryData<PullFile[]>(filesKey(owner, repo, number))
      return warmed?.find((file) => file.path === path) ?? null
    },
    // …then the batch patch endpoint for anything still missing, seeding per-path cache entries.
    fetchPatches: async (paths, signal) => {
      const fetched = await fetchFilePatches(owner, repo, number, paths, signal)
      for (const file of fetched) {
        queryClient.setQueryData(filePatchKey(owner, repo, number, file.path), file)
      }
      return fetched
    },
  })
  onCleanup(hydrator.dispose)

  const parsed = createMemo<ParsedFile[]>(() => {
    const parsedFiles = parsedByPath()
    return (files.data ?? []).map((file) => {
      const parsedFile = parsedFiles.get(file.path)
      if (parsedFile) return parsedFile
      return { file, diff: [{ kind: 'load', file, status: hydrator.status(file.path) === 'error' ? 'error' : 'loading' }] }
    })
  })

  const filesSignature = createMemo(() => (files.data ?? []).map((file) => `${file.path}:${file.sha}:${file.additions}:${file.deletions}`).join('\0'))
  createEffect(on(filesSignature, (signature, previous) => {
    lastTarget = ''
    setParsedByPath(new Map())
    setExpanded(new Map())
    setCollapsedFiles(new Set<string>())
    setLineComposer(null)
    // The empty → populated transition is initial query hydration, not a changed PR. A genuine
    // signature change invalidates the old pixel position because the diff's geometry changed.
    if (previous && signature !== previous) resetScrollPosition(true)
    hydrator.reset(files.data ?? [], typeof searchParams.file === 'string' ? searchParams.file : undefined)
  }))

  createEffect(on(
    () => [filesSignature(), typeof searchParams.file === 'string' ? searchParams.file : ''] as const,
    ([, selectedPath]) => {
      const list = files.data ?? []
      if (!list.length) return
      const selected = selectedPath ? list.find((file) => file.path === selectedPath) : undefined
      const target = selected ?? list[0]
      if (target) hydrator.prioritize(target.path)
    },
  ))

  const rows = createMemo<Row[]>(() => buildRenderableRows(parsed(), detail.data?.threads, expanded(), collapsedFiles()))
  const rowKeys = createMemo(() => rowIdentityKeys(rows()))

  // Fetch the file's head body once (cached by immutable sha), slice the gap's hidden lines, and
  // splice them into the row stream by recording them in `expanded`.
  const handleExpand = async (gap: GapRow) => {
    if (gap.sha == null) return
    const body = await queryClient.fetchQuery(fileBlobOptions(owner, repo, gap.sha))
    const lines = expandGap(gap, body.text, await loadTokenizer())
    setExpanded((prev) => new Map(prev).set(gapId(gap), lines))
  }

  // Split bands from the same interleaved rows (see toBands). Keep this cold in unified mode:
  // building and keying split bands is pure overhead while the main diff list is active.
  const bands = createMemo<SplitBand[]>(() => (viewMode() === 'split' ? toBands(rows()) : []))
  const bandKeys = createMemo(() => splitBandIdentityKeys(bands()))

  // Scroll element as a signal so the virtualizer re-attaches when it (re)mounts (it lives behind a
  // `<Show>` — no PR / split mode — so it's absent at this component's onMount). The virtualizer
  // reads the element's size only when getScrollElement first returns it; publishing the ref inside
  // requestAnimationFrame guarantees that read happens AFTER layout (offsetHeight is real), not in
  // the same tick a cached query fills rows() — otherwise it freezes a 0-height viewport and the
  // range stays empty. measure() then drives that post-layout re-read.
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
    const commands = registerCommands([
      { id: 'github.diff.find', title: 'Find in diff', category: 'navigation', run: find.openFind },
    ])
    const bindings = registerKeybindings([{
      id: 'github.diff.find', command: 'github.diff.find', description: 'Find in diff', category: 'Pull requests',
      defaultChord: 'meta+f', when: props.router ? 'typing-exempt' : 'pane',
      ...(props.router ? {} : { pane: 'pr' }),
    }])
    onCleanup(() => { bindings.dispose(); commands.dispose() })
  })

  const shouldMeasureRow = (row: Row) => row.kind === 'thread' || isCodeRow(row)
  const shouldMeasureBand = (band: SplitBand) => band.kind === 'pair' || (band.kind === 'full' && band.row.kind === 'thread')

  const find = createDiffFindController({ rows, bands, viewMode, unified: virt, split: splitVirt })

  const [scrollTop, setScrollTop] = createSignal(0)
  const { virtualRows, virtualBands, stickyFile } = createDiffStickyFile({
    rows,
    bands,
    viewMode,
    virt,
    splitVirt,
    scrollTop,
    files: () => files.data ?? [],
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

  const threadLayoutSignature = createMemo(() => {
    const collapsed = threadCollapsed()
    return (detail.data?.threads ?? []).map((thread) => `${thread.threadId}:${thread.resolved}:${collapsed.get(thread.threadId) ?? thread.resolved}`).join('\0')
  })
  const threadCollapseFor = (thread: Thread): ThreadCollapseController => ({
    collapsed: () => threadCollapsed().get(thread.threadId) ?? thread.resolved,
    setCollapsed: (collapsed) =>
      setThreadCollapsed((prev) => {
        const next = new Map(prev)
        next.set(thread.threadId, collapsed)
        return next
      }),
  })
  let serverThreadResolved = new Map<string, boolean>()
  createEffect(() => {
    const threads = detail.data?.threads ?? []
    const ids = new Set(threads.map((thread) => thread.threadId))
    const resolvedChanges = new Map<string, boolean>()
    for (const thread of threads) {
      const previous = serverThreadResolved.get(thread.threadId)
      if (previous != null && previous !== thread.resolved) resolvedChanges.set(thread.threadId, thread.resolved)
    }
    serverThreadResolved = new Map(threads.map((thread) => [thread.threadId, thread.resolved]))
    setThreadCollapsed((prev) => {
      if (prev.size === 0 && resolvedChanges.size === 0) return prev
      let changed = false
      const next = new Map(prev)
      for (const id of next.keys()) {
        if (!ids.has(id)) {
          next.delete(id)
          changed = true
        }
      }
      for (const [id, resolved] of resolvedChanges) {
        if (!resolved) {
          if (next.delete(id)) changed = true
        } else if (!next.has(id)) {
          next.set(id, true)
          changed = true
        }
      }
      return changed ? next : prev
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
  // Depend on the composer *key* via a memo (equality-checked), not the composer object — the
  // object is replaced on every keystroke, and re-measuring per keystroke remounts the virtual
  // rows, which destroys the focused textarea (flicker + lost selection). Only opening/closing/
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
  const scrollRestoration = createDiffScrollRestoration({
    scope: reviewScope,
    viewMode,
    filesSignature,
    selectedPath: () => typeof searchParams.file === 'string' ? searchParams.file : '',
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
      if (!detail || detail.routeKey !== props.route.key) return
      lastTarget = ''
      scrollToFile(detail.path, true)
    })
    onCleanup(off)
  })

  // Scroll to the file named in `?file=` once summaries have created the file headers. Loading that
  // file's patch is prioritized separately so navigation doesn't wait for tokenization.
  createEffect(() => {
    const path = typeof searchParams.file === 'string' ? searchParams.file : ''
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
      side: side as 'LEFT' | 'RIGHT',
      lineNo: lineNo ?? 0,
      key: lineNo == null ? '' : commentTargetKey(r.path, side, lineNo),
      canAdd: !!headSha() && lineNo != null,
    }
  }

  const commentTargetKey = (path: string, side: 'LEFT' | 'RIGHT', lineNo: number) => JSON.stringify([path, side, lineNo])
  // Persist an in-progress new-line comment per line so it survives navigation/reload. The composer
  // is single-slot (one open line at a time), so we seed body from the draft when it opens and write
  // back on edit; submitting sets body to '' which removes the key.
  const lineDraftKey = (key: string) => `line-comment:${owner}/${repo}/${number}:${key}`
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

  const splitComposer = (r: CodeRow | null, side: 'LEFT' | 'RIGHT') => {
    const lineNo = side === 'LEFT' ? r?.oldNo : r?.newNo
    return r && lineNo != null ? composerFor(commentTargetKey(r.path, side, lineNo)) : undefined
  }

  return (
    <Show
      when={files.data?.length}
      fallback={<p class="placeholder">{files.isLoading ? 'Loading…' : 'No files.'}</p>}
    >
      <DiffToolbar find={find} viewMode={viewMode} setViewMode={setViewMode} />
      <DiffCanvas
        viewMode={viewMode}
        rows={rows}
        bands={bands}
        virt={virt}
        splitVirt={splitVirt}
        stickyHead={stickyHead}
        onScroll={(element) => scrollRestoration.onScroll(element)}
        scheduleElementMeasure={scheduleElementMeasure}
        shouldMeasureRow={shouldMeasureRow}
        shouldMeasureBand={shouldMeasureBand}
        onMutated={invalidate}
        resolveThread={(threadId, resolved) => resolveThread(owner, repo, number, threadId, resolved)}
        replyReview={(databaseId, body) => replyReview(owner, repo, number, databaseId, body)}
        expandGap={handleExpand}
        retryDiff={(path) => hydrator.retry(path)}
        mentions={mentionsList}
        threadCollapse={threadCollapseFor}
        fileCollapsed={(path) => collapsedFiles().has(path)}
        onToggleFileCollapse={toggleFileCollapse}
        lineComment={lineComment}
        addComment={(body, path, lineNo, side) => addReviewComment(owner, repo, number, body, path, lineNo, side)}
        composerFor={composerFor}
        splitComposer={splitComposer}
        headSha={headSha}
        invalidate={invalidate}
        findHighlight={find.findHighlight}
      />

    </Show>
  )
}
