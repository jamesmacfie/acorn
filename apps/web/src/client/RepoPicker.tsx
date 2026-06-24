import { createMemo, createSignal, Show } from 'solid-js'
import { useQueryClient } from '@tanstack/solid-query'
import { setPin } from './mutations'
import { pinsKey, reposKey, reposRefreshRoute, type Repo } from './queries'
import Picker from './Picker'

// Searchable repo picker (the topbar selector). Owns repo-specific bits — pinned-first ordering,
// the ★ pin toggle, the ↻ refresh — and delegates the popover/filter chrome to the shared Picker,
// the same primitive the create-PR branch selectors use.
export default function RepoPicker(props: {
  repos: Repo[]
  pinned: number[]
  selected: string // "owner/name" or ""
  onSelect: (value: string) => void
}) {
  const queryClient = useQueryClient()
  const [refreshing, setRefreshing] = createSignal(false)
  const [refreshFailed, setRefreshFailed] = createSignal(false)
  const pinnedSet = createMemo(() => new Set(props.pinned))

  // Filter by substring on owner/name, then stable-sort pinned-first. The incoming list is already
  // pushed-desc, so a stable partition preserves recency within each group.
  const results = (query: string) => {
    const q = query.trim().toLowerCase()
    const list = q ? props.repos.filter((r) => `${r.owner}/${r.name}`.toLowerCase().includes(q)) : props.repos
    const set = pinnedSet()
    return [...list.filter((r) => set.has(r.id)), ...list.filter((r) => !set.has(r.id))]
  }

  async function togglePin(e: MouseEvent, repo: Repo) {
    e.stopPropagation()
    await setPin(repo.id, !pinnedSet().has(repo.id))
    queryClient.invalidateQueries({ queryKey: pinsKey })
  }
  async function refreshRepos() {
    setRefreshing(true)
    setRefreshFailed(false)
    try {
      const res = await fetch(reposRefreshRoute, { method: 'POST' })
      if (res.status === 401) {
        window.location.href = '/auth/login'
        return
      }
      if (!res.ok) throw new Error(`/api/repos/refresh ${res.status}`)
      await queryClient.invalidateQueries({ queryKey: reposKey })
    } catch {
      setRefreshFailed(true)
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <Picker<Repo>
      label={props.selected || 'Select a repo'}
      placeholder="Filter repos…"
      emptyText="No matching repos."
      results={results}
      rowLabel={(r) => `${r.owner}/${r.name}`}
      isActive={(r) => `${r.owner}/${r.name}` === props.selected}
      onSelect={(r) => props.onSelect(`${r.owner}/${r.name}`)}
      leading={(r) => {
        const isPinned = () => pinnedSet().has(r.id)
        return (
          <button
            type="button"
            class="repo-pin"
            classList={{ pinned: isPinned() }}
            title={isPinned() ? 'Unpin' : 'Pin'}
            aria-pressed={isPinned()}
            onClick={(e) => togglePin(e, r)}
          >
            {isPinned() ? '★' : '☆'}
          </button>
        )
      }}
      tools={
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
      }
      status={
        <Show when={refreshFailed()}>
          <p class="repo-picker-status" role="status">
            Refresh failed.
          </p>
        </Show>
      }
    />
  )
}
