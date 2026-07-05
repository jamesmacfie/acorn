import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { useParams, useSearchParams } from '@solidjs/router'
import { filesKey } from '../shared/api'
import { fetchFilePatches, fileBlobOptions, filePatchKey, filesOptions, mentionsOptions, prefsKey, prefsOptions, pullDetailOptions, pullKey, type PullFile, type Thread } from './queries'
import { addReviewComment, replyReview, resolveThread, setPref } from './mutations'
import { getHighlighter } from './shiki'
import { FILE_SCROLL_EVENT, routeKey as makeRouteKey, type FileScrollDetail } from './fileNavigation'
import { DiffLine, NonCodeRow, SplitCell, type LineComposerController, type ThreadCollapseController } from './features/diff/DiffRows'
import { createDiffHydrator } from './features/diff/hydration'
import { createDiffMeasureSchedulers, createDiffVirtualizer } from './features/diff/virtualization'
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
} from './features/diff/model'

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
type PullRoute = {
  owner: string
  repo: string
  number: string
  key: string
}
const HIGHLIGHT_MAX_PATCH_CHARS = 120_000
const HIGHLIGHT_MAX_PATCH_LINES = 2_000

export default function DiffView() {
  const params = useParams()
  const route = createMemo<PullRoute | null>(() => {
    if (!params.owner || !params.repo || !params.number) return null
    return {
      owner: params.owner,
      repo: params.repo,
      number: params.number,
      key: makeRouteKey(params.owner, params.repo, params.number),
    }
  })

  return (
    <Show when={route()} keyed fallback={<p class="placeholder">Select a PR.</p>}>
      {(r) => <DiffForPull route={r} />}
    </Show>
  )
}

function DiffForPull(props: { route: PullRoute }) {
  const [searchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const owner = props.route.owner
  const repo = props.route.repo
  const number = props.route.number

  const files = createQuery(() => filesOptions(owner, repo, number, true))
  const detail = createQuery(() => pullDetailOptions(owner, repo, number, true))
  const prefs = createQuery(() => prefsOptions(true))
  const mentionsQuery = createQuery(() => mentionsOptions(owner, repo, true))
  const mentionsList = () => mentionsQuery.data ?? []
  const headSha = () => detail.data?.pull?.headSha ?? null
  let lastTarget = ''

  const viewMode = (): ViewMode => (prefs.data?.diff_view === 'split' ? 'split' : 'unified')
  const setViewMode = async (mode: ViewMode) => {
    await setPref('diff_view', mode)
    queryClient.invalidateQueries({ queryKey: prefsKey })
  }

  const invalidate = () => queryClient.invalidateQueries({ queryKey: pullKey(owner, repo, number) })

  // Patch bodies arrive with the PR's files query. Hydration then parses/tokenizes automatically in
  // priority order: selected/visible file first, the rest in small idle batches.
  const [parsedByPath, setParsedByPath] = createSignal<Map<string, ParsedFile>>(new Map())
  // Context lines revealed by clicking a gap, keyed by that gap's stable identity. Reset when the file
  // set changes.
  const [expanded, setExpanded] = createSignal<Map<string, CodeRow[]>>(new Map())
  const [lineComposer, setLineComposer] = createSignal<{ key: string; body: string } | null>(null)
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
  createEffect(on(filesSignature, () => {
    lastTarget = ''
    setParsedByPath(new Map())
    setExpanded(new Map())
    setLineComposer(null)
    resetScrollPosition()
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

  const rows = createMemo<Row[]>(() => buildRenderableRows(parsed(), detail.data?.threads, expanded()))
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

  const shouldMeasureRow = (row: Row) => row.kind === 'thread' || isCodeRow(row)
  const shouldMeasureBand = (band: SplitBand) => band.kind === 'pair' || (band.kind === 'full' && band.row.kind === 'thread')

  const virtualRows = createMemo(() => {
    const list = rows()
    return virt.getVirtualItems().flatMap((vi) => {
      const row = list[vi.index]
      return row ? [{ vi, row }] : []
    })
  })
  const virtualBands = createMemo(() => {
    const list = bands()
    return splitVirt.getVirtualItems().flatMap((vi) => {
      const band = list[vi.index]
      return band ? [{ vi, band }] : []
    })
  })
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
  createEffect(() => {
    lineComposer()?.key
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
  let scrollFrame = 0
  onCleanup(() => {
    cancelAnimationFrame(scrollFrame)
    cancelMeasures()
  })
  const resetScrollPosition = () => {
    const el = scrollEl()
    if (!el) return
    el.scrollTop = 0
    el.scrollLeft = 0
  }
  const publishScrollEl = (el: HTMLDivElement) => {
    cancelAnimationFrame(scrollFrame)
    scrollFrame = requestAnimationFrame(() => {
      setScrollEl(el)
      resetScrollPosition()
      virt.measure()
    })
  }
  const publishSplitScrollEl = (el: HTMLDivElement) => {
    cancelAnimationFrame(scrollFrame)
    scrollFrame = requestAnimationFrame(() => {
      setScrollEl(el)
      resetScrollPosition()
      splitVirt.measure()
    })
  }

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
    const onFileScroll = (event: Event) => {
      const detail = (event as CustomEvent<FileScrollDetail>).detail
      if (!detail || detail.routeKey !== props.route.key) return
      lastTarget = ''
      scrollToFile(detail.path, true)
    }
    window.addEventListener(FILE_SCROLL_EVENT, onFileScroll)
    onCleanup(() => window.removeEventListener(FILE_SCROLL_EVENT, onFileScroll))
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
  const composerFor = (key: string): LineComposerController => ({
    isOpen: () => lineComposer()?.key === key,
    body: () => {
      const current = lineComposer()
      return current?.key === key ? current.body : ''
    },
    setOpen: (open) => {
      setLineComposer((current) => {
        if (open) return { key, body: current?.key === key ? current.body : '' }
        return current?.key === key ? null : current
      })
    },
    setBody: (body) => setLineComposer({ key, body }),
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
      <div class="diff-toolbar">
        <div class="diff-viewmode" role="group" aria-label="Diff view mode">
          <button
            type="button"
            class="diff-viewmode-btn"
            classList={{ active: viewMode() === 'unified' }}
            aria-pressed={viewMode() === 'unified'}
            onClick={() => setViewMode('unified')}
          >
            Unified
          </button>
          <button
            type="button"
            class="diff-viewmode-btn"
            classList={{ active: viewMode() === 'split' }}
            aria-pressed={viewMode() === 'split'}
            onClick={() => setViewMode('split')}
          >
            Split
          </button>
        </div>
      </div>
      <Show
        when={viewMode() === 'split'}
        fallback={
          <div class="diff" ref={publishScrollEl}>
            <div class="diff-rows" style={{ height: `${virt.getTotalSize()}px` }}>
              <For each={virtualRows()}>
                {({ vi, row }) => {
                  let rowEl: HTMLDivElement | undefined
                  const measureRow = () => {
                    if (rowEl) scheduleElementMeasure('unified', rowEl)
                  }
                  return (
                    <div
                      class="diff-row"
                      classList={{
                        'diff-hunk': row.kind === 'hunk',
                        'diff-add': row.kind === 'insert',
                        'diff-del': row.kind === 'delete',
                        'diff-file-row': row.kind === 'file',
                        'diff-thread-row': row.kind === 'thread' || row.kind === 'nodiff' || row.kind === 'load',
                      }}
                      data-index={vi.index}
                      ref={(el) => {
                        rowEl = el
                        if (shouldMeasureRow(row)) scheduleElementMeasure('unified', el)
                      }}
                      style={{ transform: `translateY(${vi.start}px)` }}
                    >
                      <Show
                        when={isCodeRow(row) ? row : null}
                        fallback={
                          <NonCodeRow
                            row={row as Exclude<Row, CodeRow>}
                            onMutated={invalidate}
                            resolveThread={(threadId, resolved) => resolveThread(owner, repo, number, threadId, resolved)}
                            reply={(databaseId, body) => replyReview(owner, repo, number, databaseId, body)}
                            expandGap={handleExpand}
                            retryDiff={(file) => hydrator.retry(file.path)}
                            mentions={mentionsList()}
                            threadCollapse={threadCollapseFor}
                            onLayoutChange={measureRow}
                          />
                        }
                      >
                        {(r) => {
                          const lc = lineComment(r())
                          return (
                            <DiffLine
                              r={r()}
                              canAdd={lc.canAdd}
                              addComment={(body) => addReviewComment(owner, repo, number, body, r().path, lc.lineNo, lc.side)}
                              onMutated={invalidate}
                              composer={lc.canAdd ? composerFor(lc.key) : undefined}
                              mentions={mentionsList()}
                            />
                          )
                        }}
                      </Show>
                    </div>
                  )
                }}
              </For>
            </div>
          </div>
        }
      >
        <div class="diff diff-split" ref={publishSplitScrollEl}>
          <div class="diff-split-rows" style={{ height: `${splitVirt.getTotalSize()}px` }}>
            <For each={virtualBands()}>
              {({ vi, band }) => {
                let bandEl: HTMLDivElement | undefined
                const measureBand = () => {
                  if (bandEl) scheduleElementMeasure('split', bandEl)
                }
                // The <Show> fallback below only renders when the band is NOT a pair, so this
                // narrowed accessor is safe there — one cast instead of one per use.
                const fullRow = () => (band as Extract<SplitBand, { kind: 'full' }>).row
                return (
                  <div
                    class="diff-split-band"
                    data-index={vi.index}
                    ref={(el) => {
                      bandEl = el
                      if (shouldMeasureBand(band)) scheduleElementMeasure('split', el)
                    }}
                    style={{ transform: `translateY(${vi.start}px)` }}
                  >
                    <Show
                      when={band.kind === 'pair' ? (band as Extract<SplitBand, { kind: 'pair' }>) : null}
                      fallback={
                        <div
                          class="diff-split-full"
                          classList={{
                            'diff-hunk': fullRow().kind === 'hunk',
                            'diff-file-row': fullRow().kind === 'file',
                            'diff-thread-row': fullRow().kind === 'thread' || fullRow().kind === 'nodiff' || fullRow().kind === 'load',
                          }}
                        >
                          <NonCodeRow
                            row={fullRow()}
                            onMutated={invalidate}
                            resolveThread={(threadId, resolved) => resolveThread(owner, repo, number, threadId, resolved)}
                            reply={(databaseId, body) => replyReview(owner, repo, number, databaseId, body)}
                            expandGap={handleExpand}
                            retryDiff={(file) => hydrator.retry(file.path)}
                            mentions={mentionsList()}
                            threadCollapse={threadCollapseFor}
                            onLayoutChange={measureBand}
                          />
                        </div>
                      }
                    >
                      {(pair) => (
                        <div class="diff-split-pair">
                          <SplitCell
                            r={pair().left}
                            gutter={pair().left?.oldNo ?? null}
                            canAdd={!!headSha() && pair().left?.oldNo != null}
                            addComment={(body) => addReviewComment(owner, repo, number, body, pair().left!.path, pair().left!.oldNo!, 'LEFT')}
                            onMutated={invalidate}
                            composer={splitComposer(pair().left, 'LEFT')}
                            mentions={mentionsList()}
                          />
                          <SplitCell
                            r={pair().right}
                            gutter={pair().right?.newNo ?? null}
                            canAdd={!!headSha() && pair().right?.newNo != null}
                            addComment={(body) => addReviewComment(owner, repo, number, body, pair().right!.path, pair().right!.newNo!, 'RIGHT')}
                            onMutated={invalidate}
                            composer={splitComposer(pair().right, 'RIGHT')}
                            mentions={mentionsList()}
                          />
                        </div>
                      )}
                    </Show>
                  </div>
                )
              }}
            </For>
          </div>
        </div>
      </Show>
    </Show>
  )
}
