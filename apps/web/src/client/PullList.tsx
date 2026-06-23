import { createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import { createQuery } from '@tanstack/solid-query'
import { A, useNavigate, useParams } from '@solidjs/router'
import { createVirtualizer } from '@tanstack/solid-virtual'
import { pullsOptions, reposOptions } from './queries'

// Left-pane PR list for the routed repo. Reads the shared repos cache to gate the request
// until the repo is known to the server (avoids a 404 race on a cold URL). The list is
// virtualized in its own scroll container (rows are uniform var(--row-h)).
export default function PullList() {
  const params = useParams()
  const navigate = useNavigate()
  const [tab, setTab] = createSignal<'open' | 'closed'>('open')
  const [filter, setFilter] = createSignal('')
  const repos = createQuery(() => reposOptions(true))
  const repoKnown = () => !!repos.data?.some((r) => r.owner === params.owner && r.name === params.repo)
  const pulls = createQuery(() => pullsOptions(params.owner ?? '', params.repo ?? '', tab(), repoKnown()))

  // Client-side text filter over the loaded tab (title / author / #number).
  const shown = createMemo(() => {
    const q = filter().trim().toLowerCase()
    const list = pulls.data ?? []
    if (!q) return list
    return list.filter((p) => `#${p.number} ${p.title} ${p.author ?? ''}`.toLowerCase().includes(q))
  })

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

  let scrollEl: HTMLDivElement | undefined
  const virt = createVirtualizer({
    get count() {
      return shown().length
    },
    getScrollElement: () => scrollEl ?? null,
    estimateSize: () => 34, // --row-h
    overscan: 12,
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
      <Show when={pulls.data} fallback={<p class="placeholder">{pulls.isError ? 'Failed to load PRs.' : 'Loading…'}</p>}>
        <Show when={shown().length} fallback={<p class="placeholder">No matching PRs.</p>}>
          <div class="pr-list-scroll" ref={scrollEl}>
            <div class="pr-list" style={{ height: `${virt.getTotalSize()}px`, position: 'relative' }}>
              <For each={virt.getVirtualItems()}>
                {(vi) => {
                  const pr = () => shown()[vi.index]
                  return (
                    <A
                      class="pr-row"
                      classList={{ active: params.number === String(pr().number) }}
                      href={`/${params.owner}/${params.repo}/${pr().number}`}
                      style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${vi.start}px)`, height: `${vi.size}px` }}
                    >
                      <span class="pr-num">#{pr().number}</span>
                      <span class="pr-title">{pr().title}</span>
                      <Show when={pr().draft}>
                        <span class="pr-badge">draft</span>
                      </Show>
                      <Show when={pr().author}>
                        <span class="pr-author muted">{pr().author}</span>
                      </Show>
                    </A>
                  )
                }}
              </For>
            </div>
          </div>
        </Show>
      </Show>
    </>
  )
}
