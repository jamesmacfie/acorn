import { Show } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'

type Me = { login: string; name: string; avatar: string; scopes: string[] }

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

  async function logout() {
    await fetch('/auth/logout', { method: 'POST' })
    await queryClient.invalidateQueries({ queryKey: ['me'] })
  }

  return (
    <div class="app">
      <header class="topbar">
        <span class="muted">gurthurd</span>
        <span class="muted">PR review</span>
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
