import { createEffect, For, Show } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { useNavigate, useParams } from '@solidjs/router'
import { meOptions, prefsOptions, reposOptions } from './queries'
import { setPref } from './mutations'
import PullList from './PullList'
import PullDetail from './PullDetail'
import DiffView from './DiffView'
import Shortcuts from './Shortcuts'

// Layout root (Router root): top bar + three panes. Panes are params-driven — PullList (left)
// and PullDetail (mid) read useParams() directly; routes exist only to populate params.
export default function App() {
  const queryClient = useQueryClient()
  const params = useParams()
  const navigate = useNavigate()

  const me = createQuery(() => meOptions())
  const repos = createQuery(() => reposOptions(!!me.data))
  const prefs = createQuery(() => prefsOptions(!!me.data))

  // Apply the saved theme (falls back to prefers-color-scheme when unset).
  createEffect(() => {
    const theme = prefs.data?.theme
    if (theme) document.documentElement.dataset.theme = theme
  })
  const toggleTheme = async () => {
    const current = prefs.data?.theme ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    const next = current === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = next
    await setPref('theme', next)
    queryClient.invalidateQueries({ queryKey: ['prefs'] })
  }

  // Default to the first repo once the list loads and no repo is in the URL.
  createEffect(() => {
    const list = repos.data
    if (list?.length && !params.owner) navigate(`/${list[0].owner}/${list[0].name}`, { replace: true })
  })

  const selected = () => (params.owner && params.repo ? `${params.owner}/${params.repo}` : '')

  async function logout() {
    await fetch('/auth/logout', { method: 'POST' })
    window.dispatchEvent(new Event('gurthurd:logout')) // wipe the persisted IndexedDB cache
    queryClient.clear()
    await queryClient.invalidateQueries({ queryKey: ['me'] })
  }

  return (
    <div class="app">
      <header class="topbar">
        <div class="topbar-side">
          <Show when={repos.data?.length}>
            <select class="repo-select" value={selected()} onChange={(e) => navigate(`/${e.currentTarget.value}`)}>
              <For each={repos.data}>
                {(repo) => (
                  <option value={`${repo.owner}/${repo.name}`}>
                    {repo.owner}/{repo.name}
                  </option>
                )}
              </For>
            </select>
          </Show>
        </div>
        <span class="brand">gurthurd</span>
        <div class="topbar-side topbar-end">
          <button type="button" class="theme-toggle" title="Toggle theme" onClick={toggleTheme}>
            ◑
          </button>
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
          <PullList />
        </section>
        <section class="pane pane-mid">
          <div class="section-header">Navigator</div>
          <PullDetail />
        </section>
        <section class="pane pane-right">
          <div class="section-header">Diff</div>
          <DiffView />
        </section>
      </main>
      <Shortcuts />
    </div>
  )
}
