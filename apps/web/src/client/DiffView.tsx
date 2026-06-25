import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { useParams, useSearchParams } from '@solidjs/router'
import { createVirtualizer } from '@tanstack/solid-virtual'
import { fileBlobOptions, filesOptions, mentionsOptions, prefsKey, prefsOptions, pullDetailOptions, pullKey, type PullFile } from './queries'
import { addReviewComment, replyReview, resolveThread, setPref } from './mutations'
import { getHighlighter } from './shiki'
import { FILE_SCROLL_EVENT, routeKey as makeRouteKey, type FileScrollDetail } from './fileNavigation'
import { DiffLine, NonCodeRow, SplitCell, type LineComposerController } from './features/diff/DiffRows'
import { createDiffHydrator } from './features/diff/hydration'
import {
  buildDiffRows,
  buildRenderableRows,
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
// virtualized list (docs/git-diff.md, docs/ui-style.md §6). Each file opens with a header row;
// `?file=` no longer picks which file is shown — it's the scroll target (the file list, finder,
// and [ / ] all set it), so selecting a file scrolls the combined diff to it.
//
// The PR load fetches the full changed-file payload so every patch body is present for that PR.
// Parsing and Shiki highlighting still hydrate in priority order so large PRs do not turn one
// network gap into one giant main-thread block. Review threads are interleaved at render time
// (matched by path) so thread mutations rerender without re-tokenizing patches.
//
type PullRoute = {
  owner: string
  repo: string
  number: string
  key: string
}
const FALLBACK_ROW_ESTIMATE = 36
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
    owner,
    repo,
    number,
    queryClient,
    tokenizerForFile: (file) => (shouldUsePlainTokenizer(file) ? Promise.resolve(plainTokenize) : loadTokenizer()),
    parseFile: (file, tokenize) => ({ file, diff: buildDiffRows(file, tokenize) }),
    onParsed: (parsedFile) => setParsedByPath((prev) => new Map(prev).set(parsedFile.file.path, parsedFile)),
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
  const virt = createVirtualizer({
    get count() {
      return rows().length
    },
    getScrollElement: () => scrollEl() ?? null,
    getItemKey: (index) => rowKeys()[index] ?? `row:${index}`,
    estimateSize: (index) => {
      const row = rows()[index]
      return row ? estimateRowSize(row) : FALLBACK_ROW_ESTIMATE
    },
    overscan: 20,
  })
  const splitVirt = createVirtualizer({
    get count() {
      return bands().length
    },
    getScrollElement: () => scrollEl() ?? null,
    getItemKey: (index) => bandKeys()[index] ?? `band:${index}`,
    estimateSize: (index) => estimateSplitBandSize(bands()[index]),
    overscan: 20,
  })

  let virtualMeasureFrame = 0
  let needsUnifiedMeasure = false
  let needsSplitMeasure = false
  const scheduleVirtualMeasure = (target: 'unified' | 'split') => {
    if (target === 'unified') needsUnifiedMeasure = true
    else needsSplitMeasure = true
    if (virtualMeasureFrame) return
    virtualMeasureFrame = requestAnimationFrame(() => {
      virtualMeasureFrame = 0
      if (!scrollEl()) return
      if (needsUnifiedMeasure) virt.measure()
      if (needsSplitMeasure) splitVirt.measure()
      needsUnifiedMeasure = false
      needsSplitMeasure = false
    })
  }

  const pendingUnifiedMeasures = new Set<HTMLElement>()
  const pendingSplitMeasures = new Set<HTMLElement>()
  let elementMeasureFrame = 0
  const scheduleElementMeasure = (target: 'unified' | 'split', el: HTMLElement) => {
    if (target === 'unified') pendingUnifiedMeasures.add(el)
    else pendingSplitMeasures.add(el)
    if (elementMeasureFrame) return
    elementMeasureFrame = requestAnimationFrame(() => {
      elementMeasureFrame = 0
      for (const item of pendingUnifiedMeasures) {
        if (item.isConnected) virt.measureElement(item)
      }
      for (const item of pendingSplitMeasures) {
        if (item.isConnected) splitVirt.measureElement(item)
      }
      pendingUnifiedMeasures.clear()
      pendingSplitMeasures.clear()
    })
  }

  const shouldMeasureRow = (row: Row) => row.kind === 'thread'
  const shouldMeasureBand = (band: SplitBand) => band.kind === 'full' && band.row.kind === 'thread'

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
  const threadLayoutSignature = createMemo(() => (detail.data?.threads ?? []).map((thread) => `${thread.threadId}:${thread.resolved}`).join('\0'))
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
    cancelAnimationFrame(virtualMeasureFrame)
    cancelAnimationFrame(elementMeasureFrame)
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
                            'diff-hunk': (band as Extract<SplitBand, { kind: 'full' }>).row.kind === 'hunk',
                            'diff-file-row': (band as Extract<SplitBand, { kind: 'full' }>).row.kind === 'file',
                            'diff-thread-row':
                              (band as Extract<SplitBand, { kind: 'full' }>).row.kind === 'thread' ||
                              (band as Extract<SplitBand, { kind: 'full' }>).row.kind === 'nodiff' ||
                              (band as Extract<SplitBand, { kind: 'full' }>).row.kind === 'load',
                          }}
                        >
                          <NonCodeRow
                            row={(band as Extract<SplitBand, { kind: 'full' }>).row}
                            onMutated={invalidate}
                            resolveThread={(threadId, resolved) => resolveThread(owner, repo, number, threadId, resolved)}
                            reply={(databaseId, body) => replyReview(owner, repo, number, databaseId, body)}
                            expandGap={handleExpand}
                            retryDiff={(file) => hydrator.retry(file.path)}
                            mentions={mentionsList()}
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
