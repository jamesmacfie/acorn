import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show } from 'solid-js'
import { createInfiniteQuery, createQuery, useQueryClient } from '@tanstack/solid-query'
import { A, useNavigate, useParams } from '@solidjs/router'
import { createVirtualizer } from '@tanstack/solid-virtual'
import { checksState, formatRelativeTime } from './displayMeta'
import { prefetchOpenPulls, schedulePullSummaryPrefetch } from './prefetch'
import { closedPullsInfiniteOptions, pullDetailOptions, pullsOptions, reposOptions } from './queries'
import { filterPulls } from './features/pullList/model'

// Left-pane PR list for the routed repo. Access checks live on the server; this pane only needs
// route params before it can ask for the repo's PRs. The list is virtualized in its own scroll
// container (rows are uniform var(--row-h)).
export default function PullList() {
  const params = useParams()
  const navigate = useNavigate()
  const [tab, setTab] = createSignal<'open' | 'closed'>('open')
  const [filter, setFilter] = createSignal('')
  const queryClient = useQueryClient()
  const repos = createQuery(() => reposOptions(true))
  const repoKnown = () => !!repos.data?.some((r) => r.owner === params.owner && r.name === params.repo)
  const hasRepoParams = () => !!params.owner && !!params.repo
  // Open: full mirror in one shot. Closed: paginated on demand (load-more), so only the active tab fetches.
  const openPulls = createQuery(() => pullsOptions(params.owner ?? '', params.repo ?? '', 'open', hasRepoParams() && tab() === 'open'))
  const closedPulls = createInfiniteQuery(() => closedPullsInfiniteOptions(params.owner ?? '', params.repo ?? '', hasRepoParams() && tab() === 'closed'))
  const closedRows = createMemo(() => closedPulls.data?.pages?.flatMap((p) => p.pulls) ?? [])
  const list = () => (tab() === 'open' ? (openPulls.data ?? []) : closedRows())
  const ready = () => (tab() === 'open' ? openPulls.data !== undefined : closedPulls.data !== undefined)
  const isError = () => (tab() === 'open' ? openPulls.isError : closedPulls.isError)

  // Once the repo is known on the repo overview, warm per-PR caches so navigating is instant.
  // Direct PR routes skip first-load warm-up so detail/files own the critical path.
  createEffect(on(
    () => (repoKnown() && !params.number ? `${params.owner}/${params.repo}` : ''),
    (key) => {
      if (!key) return
      const ac = new AbortController()
      void prefetchOpenPulls(queryClient, params.owner ?? '', params.repo ?? '', ac.signal).catch(() => {})
      onCleanup(() => ac.abort())
    },
  ))

  createEffect(on(
    () => `${params.owner ?? ''}/${params.repo ?? ''}`,
    () => {
      setTab('open')
      setFilter('')
    },
    { defer: true },
  ))

  // Client-side text filter over the loaded tab (title / author / #number).
  const shown = createMemo(() => filterPulls(list(), filter()))

  // j/k move to the next/prev PR in the list (docs/ui-style.md keyboard nav). Ignore while typing.
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'j' && e.key !== 'k') return
    const el = document.activeElement
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return
    const list = shown()
    if (!list.length) return
    const i = list.findIndex((p) => String(p.number) === params.number)
    const next = e.key === 'j' ? Math.min((i < 0 ? -1 : i) + 1, list.length - 1) : Math.max((i < 0 ? 1 : i) - 1, 0)
    e.preventDefault()
    navigate(`/${params.owner}/${params.repo}/${list[next].number}`)
  }
  onMount(() => window.addEventListener('keydown', onKey))
  onCleanup(() => window.removeEventListener('keydown', onKey))

  let rowPrefetch: { cancel: () => void } | null = null
  const cancelRowPrefetch = () => {
    rowPrefetch?.cancel()
    rowPrefetch = null
  }
  const queueRowPrefetch = (number: number) => {
    if (!params.owner || !params.repo) return
    cancelRowPrefetch()
    rowPrefetch = schedulePullSummaryPrefetch(queryClient, params.owner, params.repo, number)
  }
  onCleanup(cancelRowPrefetch)

  const [scrollEl, setScrollEl] = createSignal<HTMLDivElement>()
  const virt = createVirtualizer({
    get count() {
      return shown().length
    },
    getScrollElement: () => scrollEl() ?? null,
    estimateSize: () => 36, // --row-h
    overscan: 12,
  })
  let publishFrame = 0
  let measureFrame = 0
  onCleanup(() => {
    cancelAnimationFrame(publishFrame)
    cancelAnimationFrame(measureFrame)
  })
  const publishScrollEl = (el: HTMLDivElement) => {
    cancelAnimationFrame(publishFrame)
    publishFrame = requestAnimationFrame(() => {
      setScrollEl(el)
      virt.measure()
    })
  }
  const measureSoon = () => {
    cancelAnimationFrame(measureFrame)
    measureFrame = requestAnimationFrame(() => virt.measure())
  }
  const resetVirtualList = () => {
    const el = scrollEl()
    if (el) {
      el.scrollTop = 0
      el.scrollLeft = 0
    }
    measureSoon()
  }
  createEffect(() => {
    if (scrollEl()) measureSoon()
  })
  createEffect(on([tab, filter], resetVirtualList, { defer: true }))
  createEffect(on(() => shown().length, measureSoon, { defer: true }))
  const virtualRows = createMemo(() => {
    const list = shown()
    return virt.getVirtualItems().flatMap((vi) => {
      const pr = list[vi.index]
      return pr ? [{ vi, pr }] : []
    })
  })

  return (
    <>
      <div class="pr-tabs">
        <button type="button" classList={{ active: tab() === 'open' }} onClick={() => setTab('open')}>
          Open
        </button>
        <button type="button" classList={{ active: tab() === 'closed' }} onClick={() => setTab('closed')}>
          Closed
        </button>
        <input class="pr-filter" placeholder="Filter…" value={filter()} onInput={(e) => setFilter(e.currentTarget.value)} />
      </div>
      {/* Scroll element stays mounted from first render so the virtualizer always observes it —
          publish the ref after layout so the first observed rect has the flexed pane height. */}
      <div class="pr-list-scroll" ref={publishScrollEl}>
        <Show when={ready()} fallback={<p class="placeholder">{isError() ? 'Failed to load PRs.' : 'Loading…'}</p>}>
          <Show when={shown().length} fallback={<p class="placeholder">No matching PRs.</p>}>
            <div class="pr-list" style={{ height: `${virt.getTotalSize()}px`, position: 'relative' }}>
              <For each={virtualRows()}>
                {({ vi, pr }) => {
                  // Reactively read the warmed detail cache (enabled:false → no fetch) so the rolled-up
                  // checks dot appears as prefetchOpenPulls seeds each PR. No checks → no dot.
                  const detail = createQuery(() => pullDetailOptions(params.owner ?? '', params.repo ?? '', String(pr.number), false))
                  const checks = () => detail.data?.checks ?? []
                  return (
                    <A
                      class="pr-row"
                      classList={{ active: params.number === String(pr.number) }}
                      href={`/${params.owner}/${params.repo}/${pr.number}`}
                      onFocus={() => queueRowPrefetch(pr.number)}
                      onBlur={cancelRowPrefetch}
                      onMouseEnter={() => queueRowPrefetch(pr.number)}
                      onMouseLeave={cancelRowPrefetch}
                      style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${vi.start}px)`, height: `${vi.size}px` }}
                    >
                      <span class="pr-num">#{pr.number}</span>
                      <Show when={checks().length}>
                        <span class={`checks-dot checks-dot-${checksState(checks())}`} />
                      </Show>
                      <span class="pr-title">{pr.title}</span>
                      <Show when={pr.draft}>
                        <span class="pr-badge">draft</span>
                      </Show>
                      <Show when={pr.author}>
                        <span class="pr-author muted">{pr.author}</span>
                      </Show>
                      <span class="pr-time muted">{formatRelativeTime(pr.updatedAt)}</span>
                    </A>
                  )
                }}
              </For>
            </div>
          </Show>
          {/* Load-more only on closed; hidden while filtering since the filter only sees loaded pages. */}
          <Show when={tab() === 'closed' && closedPulls.hasNextPage && !filter().trim()}>
            <button
              type="button"
              class="pr-load-more"
              disabled={closedPulls.isFetchingNextPage}
              onClick={() => void closedPulls.fetchNextPage()}
            >
              {closedPulls.isFetchingNextPage ? 'Loading…' : 'Load more'}
            </button>
          </Show>
        </Show>
      </div>
    </>
  )
}
