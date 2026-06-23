import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { useParams, useSearchParams } from '@solidjs/router'
import { createVirtualizer } from '@tanstack/solid-virtual'
import { filesOptions, prefsKey, prefsOptions, pullDetailOptions, pullKey, type PullFile } from './queries'
import { addReviewComment, replyReview, resolveThread, setPref } from './mutations'
import { getHighlighter } from './shiki'
import { FILE_SCROLL_EVENT, routeKey as makeRouteKey, type FileScrollDetail } from './fileNavigation'
import { DiffLine, NonCodeRow, SplitCell } from './features/diff/DiffRows'
import {
  buildDiffRows,
  buildRenderableRows,
  estimateRowSize,
  fileAnchor,
  highlighterTokenize,
  isCodeRow,
  plainTokenize,
  toBands,
  type CodeRow,
  type DiffRow,
  type ParsedFile,
  type Row,
  type SplitBand,
  type ViewMode,
} from './features/diff/model'

// Right (Diff) pane: render EVERY changed file's diff stacked one after another in a single
// virtualized list (docs/git-diff.md, docs/ui-style.md §6). Each file opens with a header row;
// `?file=` no longer picks which file is shown — it's the scroll target (the file list, finder,
// and [ / ] all set it), so selecting a file scrolls the combined diff to it.
//
// Parsing + Shiki highlighting all files up front would block on large PRs, so files are parsed in
// chunks of 10 and appended as each chunk lands — the list grows progressively and stays scrollable
// while later files are still tokenizing. Review threads are interleaved at render time (matched by
// path) so thread mutations rerender without re-tokenizing patches.
//
type PullRoute = {
  owner: string
  repo: string
  number: string
  key: string
}

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
  const headSha = () => detail.data?.pull?.headSha ?? null
  let lastTarget = ''

  const viewMode = (): ViewMode => (prefs.data?.diff_view === 'split' ? 'split' : 'unified')
  const setViewMode = async (mode: ViewMode) => {
    await setPref('diff_view', mode)
    queryClient.invalidateQueries({ queryKey: prefsKey })
  }

  const invalidate = () => queryClient.invalidateQueries({ queryKey: pullKey(owner, repo, number) })

  // Parse + highlight every file off the render path, in chunks of 10, appending as each chunk
  // lands so a large PR paints progressively instead of blocking on the full set. Re-runs only when
  // the file set itself changes (thread edits don't touch files.data → no re-tokenize).
  const [parsed, setParsed] = createSignal<ParsedFile[]>([])
  let parseRun = 0
  createEffect(() => {
    const list = files.data ?? []
    const run = ++parseRun
    let cancelled = false
    onCleanup(() => {
      cancelled = true
    })
    lastTarget = ''
    setParsed([])
    resetScrollPosition()
    if (!list.length) return
    void (async () => {
      const tokenize = await getHighlighter().then(highlighterTokenize).catch(() => plainTokenize)
      if (cancelled || run !== parseRun) return
      const acc: ParsedFile[] = []
      for (let i = 0; i < list.length; i += 10) {
        if (cancelled || run !== parseRun) return
        for (const file of list.slice(i, i + 10)) acc.push({ file, diff: buildDiffRows(file, tokenize) })
        if (cancelled || run !== parseRun) return
        setParsed([...acc])
        await new Promise((r) => setTimeout(r, 0)) // yield so this chunk paints before the next 10
      }
    })()
  })

  const rows = createMemo<Row[]>(() => buildRenderableRows(parsed(), detail.data?.threads))

  // Split bands from the same interleaved rows (see toBands).
  const bands = createMemo<SplitBand[]>(() => toBands(rows()))

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
    estimateSize: (index) => estimateRowSize(rows()[index]),
    overscan: 20,
  })
  createEffect(() => {
    if (scrollEl()) virt.measure()
  })
  createEffect(() => {
    rows().length
    if (scrollEl()) queueMicrotask(() => virt.measure())
  })
  let scrollFrame = 0
  onCleanup(() => cancelAnimationFrame(scrollFrame))
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
    })
  }

  const scrollToFile = (path: string, force = false) => {
    const all = rows()
    const idx = all.findIndex((r) => r.kind === 'file' && r.file.path === path)
    if (idx < 0) return false
    if (!force && path === lastTarget) return true
    lastTarget = path
    if (viewMode() === 'split') {
      queueMicrotask(() => document.getElementById(fileAnchor(path))?.scrollIntoView({ block: 'start' }))
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

  // Scroll to the file named in `?file=` once it has been parsed. Tracks rows() so a file still in a
  // not-yet-parsed chunk scrolls as soon as its chunk lands; `lastTarget` keeps later chunk appends
  // (or thread edits) from yanking the scroll back after the initial jump.
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
    return { side: side as 'LEFT' | 'RIGHT', lineNo: lineNo ?? 0, canAdd: !!headSha() && lineNo != null }
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
              <For each={virt.getVirtualItems()}>
                {(vi) => {
                  const row = () => rows()[vi.index]
                  return (
                    <div
                      class="diff-row"
                      classList={{
                        'diff-hunk': row().kind === 'hunk',
                        'diff-add': row().kind === 'insert',
                        'diff-del': row().kind === 'delete',
                        'diff-file-row': row().kind === 'file',
                        'diff-thread-row': row().kind === 'thread' || row().kind === 'nodiff',
                      }}
                      data-index={vi.index}
                      ref={(el) => queueMicrotask(() => virt.measureElement(el))}
                      style={{ transform: `translateY(${vi.start}px)` }}
                    >
                      <Show
                        when={isCodeRow(row()) ? (row() as CodeRow) : null}
                        fallback={
                          <NonCodeRow
                            row={row() as Exclude<Row, CodeRow>}
                            onMutated={invalidate}
                            resolveThread={(threadId, resolved) => resolveThread(owner, repo, number, threadId, resolved)}
                            reply={(databaseId, body) => replyReview(owner, repo, number, databaseId, body)}
                          />
                        }
                      >
                        {(r) => {
                          const lc = lineComment(r())
                          return <DiffLine r={r()} canAdd={lc.canAdd} addComment={(body) => addReviewComment(owner, repo, number, body, r().path, lc.lineNo, lc.side)} onMutated={invalidate} />
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
        {/* Split mode renders non-virtualized — pairing two columns into bands plus the
            full-width thread/composer interleave makes a measureElement virtualizer materially more
            complex. Now that it spans every file, a very large PR in split mode mounts every row;
            upgrade path is the same band-aware virtualizer if that bites. Unified stays virtualized. */}
        <div class="diff diff-split" ref={publishSplitScrollEl}>
          <div class="diff-split-rows">
            <For each={bands()}>
              {(band) => (
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
                          (band as Extract<SplitBand, { kind: 'full' }>).row.kind === 'nodiff',
                      }}
                    >
                      <NonCodeRow
                        row={(band as Extract<SplitBand, { kind: 'full' }>).row}
                        onMutated={invalidate}
                        resolveThread={(threadId, resolved) => resolveThread(owner, repo, number, threadId, resolved)}
                        reply={(databaseId, body) => replyReview(owner, repo, number, databaseId, body)}
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
                      />
                      <SplitCell
                        r={pair().right}
                        gutter={pair().right?.newNo ?? null}
                        canAdd={!!headSha() && pair().right?.newNo != null}
                        addComment={(body) => addReviewComment(owner, repo, number, body, pair().right!.path, pair().right!.newNo!, 'RIGHT')}
                        onMutated={invalidate}
                      />
                    </div>
                  )}
                </Show>
              )}
            </For>
          </div>
        </div>
      </Show>
    </Show>
  )
}
