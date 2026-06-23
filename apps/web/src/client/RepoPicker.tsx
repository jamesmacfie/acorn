import { createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import { useQueryClient } from '@tanstack/solid-query'
import { setPin } from './mutations'
import type { Repo } from './queries'

// Searchable repo picker replacing the native <select>. A button shows the current owner/name;
// clicking opens a popover with a filter input + scrollable list. Pinned repos float to the top
// (★); the rest keep the server's recent-push order. Esc / outside-click close it.
export default function RepoPicker(props: {
  repos: Repo[]
  pinned: number[]
  selected: string // "owner/name" or ""
  onSelect: (value: string) => void
}) {
  const queryClient = useQueryClient()
  const [open, setOpen] = createSignal(false)
  const [filter, setFilter] = createSignal('')
  const [refreshing, setRefreshing] = createSignal(false)
  const [refreshFailed, setRefreshFailed] = createSignal(false)
  let rootRef: HTMLDivElement | undefined
  let inputRef: HTMLInputElement | undefined

  const pinnedSet = createMemo(() => new Set(props.pinned))

  // Filter by substring on owner/name, then stable-sort pinned-first. The incoming list is already
  // pushed-desc, so a stable partition preserves recency within each group.
  const visible = createMemo(() => {
    const q = filter().trim().toLowerCase()
    const list = q ? props.repos.filter((r) => `${r.owner}/${r.name}`.toLowerCase().includes(q)) : props.repos
    const set = pinnedSet()
    const pins = list.filter((r) => set.has(r.id))
    const rest = list.filter((r) => !set.has(r.id))
    return [...pins, ...rest]
  })

  function close() {
    setOpen(false)
    setFilter('')
  }
  function toggle() {
    if (open()) close()
    else {
      setOpen(true)
      queueMicrotask(() => inputRef?.focus())
    }
  }
  function choose(repo: Repo) {
    props.onSelect(`${repo.owner}/${repo.name}`)
    close()
  }
  async function togglePin(e: MouseEvent, repo: Repo) {
    e.stopPropagation()
    await setPin(repo.id, !pinnedSet().has(repo.id))
    queryClient.invalidateQueries({ queryKey: ['pins'] })
  }
  async function refreshRepos() {
    setRefreshing(true)
    setRefreshFailed(false)
    try {
      const res = await fetch('/api/repos/refresh', { method: 'POST' })
      if (res.status === 401) {
        window.location.href = '/auth/login'
        return
      }
      if (!res.ok) throw new Error(`/api/repos/refresh ${res.status}`)
      await queryClient.invalidateQueries({ queryKey: ['repos'] })
    } catch {
      setRefreshFailed(true)
    } finally {
      setRefreshing(false)
    }
  }

  const onDocPointer = (e: PointerEvent) => {
    if (open() && rootRef && !rootRef.contains(e.target as Node)) close()
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && open()) {
      e.preventDefault()
      close()
    }
  }
  onMount(() => {
    document.addEventListener('pointerdown', onDocPointer)
    window.addEventListener('keydown', onKey)
  })
  onCleanup(() => {
    document.removeEventListener('pointerdown', onDocPointer)
    window.removeEventListener('keydown', onKey)
  })

  return (
    <div class="repo-picker" ref={rootRef}>
      <button type="button" class="repo-picker-button" aria-haspopup="listbox" aria-expanded={open()} onClick={toggle}>
        <span class="repo-picker-label">{props.selected || 'Select a repo'}</span>
        <span class="repo-picker-chevron" aria-hidden="true">
          ▾
        </span>
      </button>
      <Show when={open()}>
        <div class="repo-picker-popover" role="listbox">
          <div class="repo-picker-tools">
            <input
              ref={inputRef}
              class="repo-picker-filter"
              placeholder="Filter repos…"
              value={filter()}
              onInput={(e) => setFilter(e.currentTarget.value)}
            />
            <button
              type="button"
              class="repo-picker-refresh"
              title="Refresh repos"
              aria-label="Refresh repos"
              disabled={refreshing()}
              onClick={refreshRepos}
            >
              {refreshing() ? '...' : '↻'}
            </button>
          </div>
          <Show when={refreshFailed()}>
            <p class="repo-picker-status" role="status">
              Refresh failed.
            </p>
          </Show>
          <Show
            when={visible().length}
            fallback={<p class="repo-picker-empty">No matching repos.</p>}
          >
            <ul class="repo-picker-list">
              <For each={visible()}>
                {(repo) => {
                  const value = `${repo.owner}/${repo.name}`
                  const isPinned = () => pinnedSet().has(repo.id)
                  return (
                    <li class="repo-picker-row" classList={{ active: value === props.selected }}>
                      <button
                        type="button"
                        class="repo-pin"
                        classList={{ pinned: isPinned() }}
                        title={isPinned() ? 'Unpin' : 'Pin'}
                        aria-pressed={isPinned()}
                        onClick={(e) => togglePin(e, repo)}
                      >
                        {isPinned() ? '★' : '☆'}
                      </button>
                      <button type="button" class="repo-picker-name" onClick={() => choose(repo)}>
                        {value}
                      </button>
                    </li>
                  )
                }}
              </For>
            </ul>
          </Show>
        </div>
      </Show>
    </div>
  )
}
