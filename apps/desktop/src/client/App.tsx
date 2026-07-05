import { createEffect, createSignal, Match, onCleanup, onMount, Show, Switch } from 'solid-js'
import { createQuery, useIsRestoring, useQueryClient } from '@tanstack/solid-query'
import { useMatch, useNavigate, useParams } from '@solidjs/router'
import { clear } from 'idb-keyval'
import { readJson } from './apiClient'
import { meKey, meOptions, pinsOptions, prefsKey, prefsOptions, pullPrefixKey, pullsKey, pullsRoute, pullsPrefixKey, reposKey, reposOptions, reposRefreshRoute, tasksOptions, workspacesKey, workspacesOptions, type Pull } from './queries'
import { bootstrapWorkspaces, setPref } from './mutations'
import RepoPicker from './RepoPicker'
import WorkspacePicker from './WorkspacePicker'
import OnboardingModal from './features/workspaces/OnboardingModal'
import { workspaceForRepo } from './features/workspaces/activeWorkspace'
import PullList from './PullList'
import PullDetail from './PullDetail'
import CreatePullForm from './CreatePullForm'
import ComparePreview from './ComparePreview'
import DiffView from './DiffView'
import Shortcuts from './Shortcuts'
import AccountMenu from './AccountMenu'
import SettingsModal from './features/settings/SettingsModal'
import TerminalPanel from './features/terminal/TerminalPanel'
import CommandPalette from './features/palette/CommandPalette'
import FilePalette from './features/palette/FilePalette'
import NotificationBell from './features/notifications/NotificationBell'
import { hydrateNotices, initWorkflowNotices, notices, serializeNotices } from './features/notifications/notifications'
import { editorStateByTask, hydrateEditorState, serializeEditorState } from './features/editor/editorState'
import { initSessions } from './features/terminal/sessions'
import TabRail from './features/tabs/TabRail'
import RailTips from './features/tooltip/RailTips'
import { activeTaskId, hydrateTaskLayouts, isSourceId, isTerminalOpen, selectedSource, setActiveTaskId, setSelectedSource, setTerminalOpen, taskLayouts } from './features/tasks/tasks'
import { activateTaskSignals, pathForTask } from './features/tasks/activate'
import { parseTaskLayouts } from './features/tasks/layout'
import { initTaskStatuses } from './features/tasks/taskStatus'
import { capabilities } from './features/capabilities'
import TaskView from './features/tasks/TaskView'
import LinearBrowse from './features/tasks/LinearBrowse'
import RollbarBrowse from './features/tasks/RollbarBrowse'
import Acorn from './Acorn'

// Layout root (Router root): top bar + three panes. Panes are params-driven — PullList (left)
// and PullDetail (mid) read useParams() directly; routes exist only to populate params.
export default function App() {
  const queryClient = useQueryClient()
  const params = useParams()
  const navigate = useNavigate()
  const isRestoring = useIsRestoring()
  const [onboardingDismissed, setOnboardingDismissed] = createSignal(false)
  // The Settings page (account menu → Settings): workspace mapping, per-workspace pages,
  // integrations, shortcuts, permissions. `settingsTab` seeds which tab opens.
  const [settingsOpen, setSettingsOpen] = createSignal(false)
  const [settingsTab, setSettingsTab] = createSignal('workspaces')
  const openSettings = (tab = 'workspaces') => {
    setSettingsTab(tab)
    setSettingsOpen(true)
  }
  // The terminal drawer belongs to a task, not the app: it's shown only in the Task view (a Source
  // browse like Pull requests has no terminal) and its open/closed state is tracked per task, so
  // switching tabs swaps it. `termOpen` reflects the active task's state within the Task view.
  const inTaskView = () => !selectedSource() && !!activeTask()
  const termOpen = () => inTaskView() && isTerminalOpen(activeTaskId())
  const toggleTerm = () => {
    const id = activeTaskId()
    if (id) setTerminalOpen(id, !isTerminalOpen(id))
  }

  // Track terminal sessions globally (independent of the drawer) so the tab rail and the topbar
  // badge can show agent-working activity. No-op when the terminal bridge is absent (plain browser
  // via dev:node) — the terminal is always on when the bridge exists (capabilities()).
  onMount(() => {
    if (!capabilities().terminal) return
    onCleanup(initSessions())
    onCleanup(initTaskStatuses())
    onCleanup(initWorkflowNotices())
  })

  const me = createQuery(() => meOptions())
  const repos = createQuery(() => reposOptions(!!me.data))
  const prefs = createQuery(() => prefsOptions(!!me.data))
  const pins = createQuery(() => pinsOptions(!!me.data))
  const tasks = createQuery(() => tasksOptions(!!me.data))
  const workspaces = createQuery(() => workspacesOptions(!!me.data))

  // First-run bootstrap (idempotent): ensure a Default workspace exists and every mirrored repo is
  // assigned to a workspace, so the top selector + repo scoping always have data. Runs once the
  // repos mirror has loaded (so newly-fetched repos get assigned). The onboarding modal (P4) lets
  // the user re-group afterwards.
  let bootstrapped = false
  createEffect(() => {
    if (bootstrapped || !me.data || !repos.data) return
    bootstrapped = true
    void bootstrapWorkspaces().then(() => queryClient.invalidateQueries({ queryKey: workspacesKey }))
  })

  // Active workspace is derived from the current repo (partition — a repo is in exactly one).
  const activeWorkspace = () => workspaceForRepo(workspaces.data, params.owner, params.repo)
  // Repos scoped to the active workspace for the topbar sub-selector. Falls back to all repos before
  // the workspace mapping has loaded so the picker is never empty.
  const scopedRepos = () => {
    const ws = activeWorkspace()
    if (!ws) return repos.data ?? []
    const set = new Set((ws.repos ?? []).map((r) => `${r.owner}/${r.name}`))
    return (repos.data ?? []).filter((r) => set.has(`${r.owner}/${r.name}`))
  }

  // Focus a task once the list loads (no navigation — selecting a row in the rail is what
  // navigates). The terminal drawer + topbar badge key off this. Prefer the task focused last
  // session (persisted below), falling back to the first row; wait for prefs so we don't flash the
  // wrong one first.
  createEffect(() => {
    const list = tasks.data
    if (!list?.length || activeTaskId() || prefs.data === undefined) return
    const saved = prefs.data.last_task
    setActiveTaskId(saved && list.some((t) => t.id === saved) ? saved : list[0].id)
  })
  const activeTask = () => tasks.data?.find((w) => w.id === activeTaskId()) ?? null

  // Apply the saved theme. When following system, swap between the chosen light/dark
  // themes on the OS preference (and re-apply live when it changes).
  createEffect(() => {
    if (prefs.data === undefined) return
    const follow = (prefs.data.theme_follow_system ?? (prefs.data.theme ? 'false' : 'true')) === 'true'
    if (!follow) {
      document.documentElement.dataset.theme = prefs.data.theme ?? 'light'
      return
    }
    const light = prefs.data.theme_light ?? 'light'
    const dark = prefs.data.theme_dark ?? 'dark'
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      document.documentElement.dataset.theme = mq.matches ? dark : light
    }
    apply()
    mq.addEventListener('change', apply)
    onCleanup(() => mq.removeEventListener('change', apply))
  })

  // Open the repo used last session once the list loads and no repo is in the URL (falling back to
  // the first repo). Electron always boots at the origin root, so this is what restores the
  // workspace/repo — the active workspace is derived from the repo. Wait for the persisted cache to
  // finish restoring — mounting PullList mid-restore drops its gated pulls fetch (the enabled flip
  // races the isRestoring boundary), so the list never populates — and for prefs, so we don't flash
  // the first repo before the saved one.
  createEffect(() => {
    if (isRestoring() || prefs.data === undefined) return
    const list = repos.data
    if (!list?.length || params.owner) return
    // The saved path carries the PR number too (e.g. /owner/repo/123), so a PR task/detail reopens
    // on the right pull. Validate its repo still exists before honouring it.
    const saved = prefs.data.last_path
    const [, sOwner, sRepo] = saved?.split('/') ?? []
    const ok = saved && list.some((r) => r.owner === sOwner && r.name === sRepo)
    navigate(ok ? saved : `/${list[0].owner}/${list[0].name}`, { replace: true })
  })

  // Restore the rest of last session's view once, after prefs load: which Source was selected (a
  // task view was saved as '') and each task's last-used pane. `restored` then gates the persist
  // effects below so they don't clobber the saved values with startup defaults.
  const [restored, setRestored] = createSignal(false)
  createEffect(() => {
    if (prefs.data === undefined || restored()) return
    setRestored(true)
    const src = prefs.data.last_source
    if (src === '') setSelectedSource(null)
    else if (isSourceId(src)) setSelectedSource(src) // validated against the SourceId union in one place
    try {
      hydrateTaskLayouts(parseTaskLayouts(prefs.data.task_layouts, prefs.data.task_panes))
    } catch {
      /* ignore malformed pane map */
    }
    hydrateNotices(prefs.data.notices)
    hydrateEditorState(prefs.data.editor_open_files)
  })

  // Persist the current view so a relaunch reopens it. Separate effects so each writes only when its
  // own slice changes. No prefsKey invalidation — these keys are read once at startup, and skipping
  // it avoids a write→refetch loop.
  createEffect(() => {
    if (restored() && params.owner && params.repo) {
      void setPref('last_path', `/${params.owner}/${params.repo}${params.number ? `/${params.number}` : ''}`)
    }
  })
  createEffect(() => {
    if (restored()) void setPref('last_source', selectedSource() ?? '')
  })
  createEffect(() => {
    const id = activeTaskId()
    if (restored() && id) void setPref('last_task', id)
  })
  createEffect(() => {
    const layouts = taskLayouts()
    if (restored()) void setPref('task_layouts', JSON.stringify(layouts))
  })
  createEffect(() => {
    void notices()
    if (restored()) void setPref('notices', serializeNotices())
  })
  createEffect(() => {
    void editorStateByTask()
    if (restored()) void setPref('editor_open_files', serializeEditorState())
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
          <Show when={workspaces.data?.length}>
            <WorkspacePicker
              workspaces={workspaces.data ?? []}
              active={activeWorkspace()}
              onSelect={(w) => {
                // Selecting a workspace navigates to its first repo; the active workspace is derived
                // from the repo, so no extra state. Empty workspaces stay put.
                const first = w.repos[0]
                if (!first) return
                if (!selectedSource()) setSelectedSource('github')
                navigate(`/${first.owner}/${first.name}`)
              }}
            />
          </Show>
          <Show when={scopedRepos().length}>
            <RepoPicker
              repos={scopedRepos()}
              pinned={pins.data ?? []}
              selected={selected()}
              /* In a task view the repo is fixed to that worktree — switching repos is meaningless,
                 so disable it. The workspace selector stays live (it swaps the whole UI). */
              disabled={!selectedSource() && !!activeTask()}
              onSelect={(value) => {
                // From a task view, picking a repo returns to the GitHub browse; from a Source
                // (GitHub/Linear) it just re-scopes that source to the chosen repo.
                if (!selectedSource()) setSelectedSource('github')
                navigate(`/${value}`)
              }}
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
          <NotificationBell
            onSelectTask={(taskId) => {
              const t = tasks.data?.find((x) => x.id === taskId)
              if (!t) return
              activateTaskSignals(t)
              navigate(pathForTask(t))
            }}
          />
          <Show when={capabilities().terminal && inTaskView()}>
            <button type="button" class="theme-toggle" title="Terminal" aria-pressed={termOpen()} onClick={toggleTerm}>
              ▣
            </button>
          </Show>
          <Show
            when={me.data}
            fallback={
              <a class="auth-control" href="/auth/login">
                Login
              </a>
            }
          >
            {(user) => (
              <AccountMenu user={user()} onSettings={() => openSettings()} onClearCache={clearCache} onLogout={logout} />
            )}
          </Show>
        </div>
      </header>
      <Switch
        fallback={
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
        }
      >
        <Match when={selectedSource() === 'linear'}>
          <LinearBrowse />
        </Match>
        <Match when={selectedSource() === 'rollbar'}>
          <RollbarBrowse />
        </Match>
        <Match when={!selectedSource() && activeTask()}>
          {(task) => (
            <TaskView
              task={task()}
              terminalOpen={termOpen()}
              onToggleTerminal={() => void toggleTerm()}
              onOpenTerminal={() => { if (!termOpen()) void toggleTerm() }}
            />
          )}
        </Match>
      </Switch>
      <Shortcuts onOpenShortcuts={() => openSettings('shortcuts')} />
      <Show when={settingsOpen()}>
        <SettingsModal initialTab={settingsTab()} onPermissions={permissions} onClose={() => setSettingsOpen(false)} />
      </Show>
      <Show when={!onboardingDismissed() && !!me.data && prefs.data !== undefined && prefs.data?.onboarded !== '1' && (workspaces.data?.length ?? 0) > 0}>
        <OnboardingModal onClose={() => setOnboardingDismissed(true)} />
      </Show>
      <Show when={termOpen()}>
        <TerminalPanel onClose={() => { const id = activeTaskId(); if (id) setTerminalOpen(id, false) }} task={activeTask()} />
      </Show>
      <CommandPalette />
      <FilePalette />
    </div>
    <RailTips />
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
