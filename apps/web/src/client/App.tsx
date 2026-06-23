import { createEffect, createSignal, For, Show } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'

type Me = { login: string; name: string; avatar: string; scopes: string[] }
type Repo = {
  id: number
  owner: string
  name: string
  private: boolean
  defaultBranch: string | null
  pushedAt: number | null
}

// Bare three-pane skeleton (docs/ui-style.md §5). Real components fill these panes later.
export default function App() {
  const queryClient = useQueryClient()

  // 401 is a valid "logged out" state, not an error → return null rather than throw.
  const me = createQuery(() => ({
    queryKey: ['me'],
    queryFn: async (): Promise<Me | null> => {
      const res = await fetch('/api/me')
      if (res.status === 401) return null
      if (!res.ok) throw new Error(`/api/me ${res.status}`)
      return res.json()
    },
  }))

  // Repo list — first read of the D1 mirror. Only fetched once logged in.
  const reposQuery = createQuery(() => ({
    queryKey: ['repos'],
    enabled: !!me.data,
    queryFn: async (): Promise<Repo[]> => {
      const res = await fetch('/api/repos')
      if (!res.ok) throw new Error(`/api/repos ${res.status}`)
      return res.json()
    },
  }))

  // ponytail: selection lifts to a context/route param when the PR list reads it; no persistence yet.
  const [selectedRepo, setSelectedRepo] = createSignal<number | null>(null)
  createEffect(() => {
    const list = reposQuery.data
    if (list?.length && selectedRepo() === null) setSelectedRepo(list[0].id)
  })

  async function logout() {
    await fetch('/auth/logout', { method: 'POST' })
    await queryClient.invalidateQueries({ queryKey: ['me'] })
  }

  return (
    <div class="app">
      <header class="topbar">
        <div class="topbar-side">
          <Show when={reposQuery.data?.length}>
            <select
              class="repo-select"
              value={selectedRepo() ?? ''}
              onChange={(e) => setSelectedRepo(Number(e.currentTarget.value))}
            >
              <For each={reposQuery.data}>
                {(repo) => (
                  <option value={repo.id}>
                    {repo.owner}/{repo.name}
                  </option>
                )}
              </For>
            </select>
          </Show>
        </div>
        <span class="brand">gurthurd</span>
        <div class="topbar-side topbar-end">
        <Show
          when={me.data}
          fallback={
            <a class="auth-control" href="/auth/login">
              Login
            </a>
          }
        >
          {(user) => (
            <span class="auth-control">
              <img class="avatar" src={user().avatar} alt={user().login} width="20" height="20" />
              <button class="auth-logout" type="button" onClick={logout}>
                Logout
              </button>
            </span>
          )}
        </Show>
        </div>
      </header>
      <main class="panes">
        <section class="pane pane-left">
          <div class="section-header">Reviews</div>
          <p class="placeholder">PR list — coming soon.</p>
        </section>
        <section class="pane pane-mid">
          <div class="section-header">Navigator</div>
          <p class="placeholder">Select a PR.</p>
        </section>
        <section class="pane pane-right">
          <div class="section-header">Diff</div>
          <p class="placeholder">Nothing here.</p>
        </section>
      </main>
    </div>
  )
}
