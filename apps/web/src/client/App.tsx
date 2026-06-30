import { createEffect, createSignal, onCleanup, onMount, Show } from 'solid-js'
import { createQuery, useIsRestoring, useQueryClient } from '@tanstack/solid-query'
import { useLocation, useMatch, useNavigate, useParams } from '@solidjs/router'
import { clear } from 'idb-keyval'
import { readJson } from './apiClient'
import { meKey, meOptions, pinsOptions, prefsKey, prefsOptions, pullPrefixKey, pullsKey, pullsRoute, pullsPrefixKey, reposKey, reposOptions, reposRefreshRoute, type Pull } from './queries'
import { setPref } from './mutations'
import RepoPicker from './RepoPicker'
import PullList from './PullList'
import PullDetail from './PullDetail'
import CreatePullForm from './CreatePullForm'
import ComparePreview from './ComparePreview'
import DiffView from './DiffView'
import Shortcuts from './Shortcuts'
import AccountMenu from './AccountMenu'
import IntegrationsModal from './features/integrations/IntegrationsModal'
import TerminalPanel from './features/terminal/TerminalPanel'
import { initSessions, workingCountFor } from './features/terminal/sessions'
import TabRail from './features/tabs/TabRail'
import { PREFS_KEY as tabsPrefsKey, recordLocation, seedFromPrefs } from './features/tabs/tabs'
import Acorn from './Acorn'

// vNext Phase 0 flag: terminal only exists on desktop (Electron IPC) and stays behind a flag —
// enable in devtools with `localStorage.setItem('acorn:term','1')` then reload. ponytail.
const terminalEnabled = !!window.acorn?.desktop && localStorage.getItem('acorn:term') === '1'

// Layout root (Router root): top bar + three panes. Panes are params-driven — PullList (left)
// and PullDetail (mid) read useParams() directly; routes exist only to populate params.
export default function App() {
  const queryClient = useQueryClient()
  const params = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const isRestoring = useIsRestoring()
  const [helpOpen, setHelpOpen] = createSignal(false)
  const [integrationsOpen, setIntegrationsOpen] = createSignal(false)
  // Terminal drawer open/closed, persisted via the `term_open` pref so a reload restores it (vNext
  // §10). Seed once from prefs (mirrors the left-collapse pattern), then user toggles win.
  const [termOpen, setTermOpen] = createSignal(false)
  const [termTouched, setTermTouched] = createSignal(false)
  createEffect(() => {
    const v = prefs.data?.term_open
    if (terminalEnabled && v !== undefined && !termTouched()) setTermOpen(v === '1')
  })
  const toggleTerm = async () => {
    const next = !termOpen()
    setTermTouched(true)
    setTermOpen(next)
    await setPref('term_open', next ? '1' : '0')
    queryClient.invalidateQueries({ queryKey: prefsKey })
  }

  // Track terminal sessions globally (independent of the drawer) so the tab rail and the topbar
  // badge can show agent-working activity. No-op when the terminal bridge is absent.
  onMount(() => {
    if (!terminalEnabled) return
    onCleanup(initSessions())
  })

  const me = createQuery(() => meOptions())
  const repos = createQuery(() => reposOptions(!!me.data))
  const prefs = createQuery(() => prefsOptions(!!me.data))
  const pins = createQuery(() => pinsOptions(!!me.data))

  // Workspace tabs: seed the store once from the persisted blob (or the current path), then track
  // every navigation into the active tab so switching tabs restores where you were.
  createEffect(() => {
    if (prefs.data) seedFromPrefs(prefs.data[tabsPrefsKey], location.pathname)
  })
  createEffect(() => recordLocation(location.pathname))

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
    queryClient.invalidateQueries({ queryKey: prefsKey })
  }

  // Default to the first repo once the list loads and no repo is in the URL. Wait for the
  // persisted cache to finish restoring — mounting PullList mid-restore drops its gated pulls
  // fetch (the enabled flip races the isRestoring boundary), so the list never populates.
  createEffect(() => {
    if (isRestoring()) return
    const list = repos.data
    if (list?.length && !params.owner) navigate(`/${list[0].owner}/${list[0].name}`, { replace: true })
  })

  // Left-pane collapse, persisted via the `left_collapsed` pref. Seed the local signal from prefs
  // once it loads (and the user hasn't toggled since), so reloads restore the saved state.
  const [collapsed, setCollapsed] = createSignal(false)
  const [touched, setTouched] = createSignal(false)
  createEffect(() => {
    const v = prefs.data?.left_collapsed
    if (v !== undefined && !touched()) setCollapsed(v === '1')
  })
  const toggleCollapsed = async () => {
    const next = !collapsed()
    setTouched(true)
    setCollapsed(next)
    await setPref('left_collapsed', next ? '1' : '0')
    queryClient.invalidateQueries({ queryKey: prefsKey })
  }

  const selected = () => (params.owner && params.repo ? `${params.owner}/${params.repo}` : '')
  // Create-PR mode: the static /:owner/:repo/new route (outranks the :number param route).
  const newMatch = useMatch(() => '/:owner/:repo/new')
  const isNew = () => !!newMatch()

  async function logout() {
    await fetch('/auth/logout', { method: 'POST' })
    window.dispatchEvent(new Event('acorn:logout')) // wipe the persisted IndexedDB cache
    sessionStorage.setItem('acorn:loggedout', '1') // else LoginGate bounces to GitHub and silently re-auths
    queryClient.clear()
    await queryClient.invalidateQueries({ queryKey: meKey })
  }
  async function clearCache() {
    queryClient.clear()
    await clear() // wipe the persisted IndexedDB cache before reload so it can't rehydrate
    window.location.reload()
  }
  async function permissions() {
    await fetch(reposRefreshRoute, { method: 'POST' }).catch(() => {})
    queryClient.invalidateQueries({ queryKey: reposKey })
    window.location.href = '/auth/permissions'
  }

  const [refreshingPulls, setRefreshingPulls] = createSignal(false)
  const [refreshingPull, setRefreshingPull] = createSignal(false)
  async function refreshAllPulls() {
    if (!params.owner || !params.repo) return
    setRefreshingPulls(true)
    try {
      const data = await readJson<Pull[]>(`${pullsRoute(params.owner, params.repo, 'open')}&force=true`)
      queryClient.setQueryData(pullsKey(params.owner, params.repo, 'open'), data)
    } finally {
      setRefreshingPulls(false)
    }
  }
  async function refreshCurrentPull() {
    if (!params.owner || !params.repo || !params.number) return
    setRefreshingPull(true)
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: pullPrefixKey(params.owner, params.repo) }),
      queryClient.invalidateQueries({ queryKey: pullsPrefixKey(params.owner, params.repo) }),
      queryClient.invalidateQueries({ queryKey: ['files', params.owner, params.repo, params.number] }),
      // Linked Linear tickets (list enrichment + any open detail) — refetch their status too.
      queryClient.invalidateQueries({ queryKey: ['linear-issues'] }),
      queryClient.invalidateQueries({ queryKey: ['linear-issue'] }),
    ])
    setRefreshingPull(false)
  }

  // Logged out: no chrome, just the mark — bounce straight to GitHub OAuth. While auth is still
  // unknown (initial load / cache restore) show the bare mark without redirecting, to avoid a flash.
  const settled = () => !isRestoring() && !me.isPending && !me.data
  // Settled-logged-out: bounce to GitHub UNLESS the user explicitly logged out (else GitHub silently
  // re-auths and logout is a no-op). In that case hold the gate and offer a manual Login.
  const settledLoggedOut = () => settled() && sessionStorage.getItem('acorn:loggedout') !== '1'
  const didLogout = () => settled() && sessionStorage.getItem('acorn:loggedout') === '1'
  return (
    <Show when={me.data} fallback={<LoginGate redirecting={settledLoggedOut()} loggedOut={didLogout()} />}>
    <div class="shell">
    <TabRail />
    <div class="app" classList={{ 'left-collapsed': collapsed() }}>
      <header class="topbar">
        <div class="topbar-side">
          <button
            type="button"
            class="collapse-toggle"
            title={collapsed() ? 'Show left pane' : 'Hide left pane'}
            aria-pressed={collapsed()}
            onClick={toggleCollapsed}
          >
            {collapsed() ? '»' : '«'}
          </button>
          <Show when={repos.data?.length}>
            <RepoPicker
              repos={repos.data ?? []}
              pinned={pins.data ?? []}
              selected={selected()}
              onSelect={(value) => navigate(`/${value}`)}
            />
          </Show>
        </div>
        <div class="breadcrumb">
          <Show when={params.owner} fallback={<span class="brand">acorn</span>}>
            <button type="button" class="crumb crumb-link" onClick={() => navigate(`/${params.owner}/${params.repo}`)}>
              {params.owner}
            </button>
            <span class="crumb-sep">/</span>
            <button type="button" class="crumb crumb-link" onClick={() => navigate(`/${params.owner}/${params.repo}`)}>
              {params.repo}
            </button>
            <Show when={params.number}>
              <span class="crumb-sep">/</span>
              <a class="crumb crumb-num crumb-link" href={`https://github.com/${params.owner}/${params.repo}/pull/${params.number}`} target="_blank" rel="noopener noreferrer">#{params.number}</a>
            </Show>
            <Show when={isNew()}>
              <span class="crumb-sep">/</span>
              <span class="crumb crumb-num">new</span>
            </Show>
          </Show>
        </div>
        <div class="topbar-side topbar-end">
          <Show when={terminalEnabled}>
            <button type="button" class="theme-toggle" title="Terminal" aria-pressed={termOpen()} onClick={toggleTerm}>
              ▣
            </button>
            <Show when={workingCountFor(params.owner, params.repo) > 0}>
              <span class="term-working" title="Agents working">
                <span class="spin">✻</span> ({workingCountFor(params.owner, params.repo)})
              </span>
            </Show>
          </Show>
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
              <AccountMenu user={user()} onShortcuts={() => setHelpOpen(true)} onIntegrations={() => setIntegrationsOpen(true)} onPermissions={permissions} onClearCache={clearCache} onLogout={logout} />
            )}
          </Show>
        </div>
      </header>
      <Show when={params.owner} fallback={<main class="panes panes-empty"><Acorn /></main>}>
        <main class="panes">
          <section class="pane pane-left">
            <div class="section-header">
              Reviews
              <button type="button" class="new-pr-btn" title="New pull request" onClick={() => navigate(`/${params.owner}/${params.repo}/new`)}>
                + New PR
              </button>
              <button type="button" class="section-refresh" title="Refresh reviews" aria-label="Refresh reviews" disabled={refreshingPulls()} onClick={refreshAllPulls}>
                {refreshingPulls() ? '...' : '↻'}
              </button>
            </div>
            <PullList />
          </section>
          <Show
            when={isNew()}
            fallback={
              <Show
                when={params.number}
                fallback={
                  <section class="pane pane-mid pane-empty" style={{ 'grid-column': '2 / -1' }}>
                    <Acorn />
                  </section>
                }
              >
                <section class="pane pane-mid">
                  <div class="section-header">Navigator</div>
                  <PullDetail />
                </section>
                <section class="pane pane-right">
                  <div class="section-header">
                    Diff
                    <button type="button" class="section-refresh" style={{ 'margin-left': 'auto' }} title="Refresh diff" aria-label="Refresh diff" disabled={refreshingPull()} onClick={refreshCurrentPull}>
                      {refreshingPull() ? '...' : '↻'}
                    </button>
                  </div>
                  <DiffView />
                </section>
              </Show>
            }
          >
            <section class="pane pane-mid">
              <div class="section-header">New pull request</div>
              <CreatePullForm />
            </section>
            <section class="pane pane-right">
              <div class="section-header">Compare</div>
              <ComparePreview />
            </section>
          </Show>
        </main>
      </Show>
      <Shortcuts helpOpen={helpOpen()} onHelpOpenChange={setHelpOpen} />
      <IntegrationsModal open={integrationsOpen()} onClose={() => setIntegrationsOpen(false)} />
      <Show when={termOpen()}>
        <TerminalPanel onClose={() => setTermOpen(false)} />
      </Show>
    </div>
    </div>
    </Show>
  )
}

// Full-screen mark shown when there's no session. Once auth resolves to logged-out, redirect to
// the OAuth start; before that just hold the mark so we don't flash a redirect mid-restore.
function LoginGate(props: { redirecting: boolean; loggedOut: boolean }) {
  createEffect(() => {
    if (props.redirecting) window.location.href = '/auth/login?return_to=' + encodeURIComponent(window.location.pathname + window.location.search)
  })
  const login = () => {
    sessionStorage.removeItem('acorn:loggedout')
    window.location.href = '/auth/login'
  }
  return (
    <main class="login-gate">
      <Acorn label={props.redirecting ? 'redirecting to github…' : props.loggedOut ? 'logged out' : 'acorn'} />
      <Show when={props.loggedOut}>
        <button class="auth-control" type="button" onClick={login}>Login</button>
      </Show>
    </main>
  )
}
