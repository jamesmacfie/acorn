import { createEffect, createSignal, lazy, Match, on, onCleanup, onMount, Show, Switch, untrack } from 'solid-js'
import { createQuery, useIsRestoring, useQueryClient } from '@tanstack/solid-query'
import { useMatch, useNavigate, useParams } from '@solidjs/router'
import { Dynamic } from 'solid-js/web'
import { clear } from 'idb-keyval'
import { readJson } from '@acorn/client-core/apiClient.ts'
import { filesKey, forceRefreshPull, meKey, meOptions, pinsOptions, prefsOptions, pullKey, pullsKey, pullsRoute, pullsPrefixKey, reposKey, reposOptions, reposRefreshRoute, tasksOptions, workspacesKey, workspacesOptions, type Pull } from '@acorn/client-core/queries.ts'
import { bootstrapWorkspaces } from '@acorn/client-core/workspaces/mutations.ts'
import RepoPicker from '@acorn/client-core/ui/RepoPicker.tsx'
import WorkspacePicker from '@acorn/client-core/ui/WorkspacePicker.tsx'
import { workspaceForRepo } from '@acorn/client-core/workspaces/activeWorkspace.ts'
import { planWorkspaceViewTransition } from '@acorn/client-core/workspaces/workspaceViewTransition.ts'
import PullList from '@acorn/plugin-github/client/PullList.tsx'
import AccountMenu from '@acorn/client-core/AccountMenu.tsx'
import { initWorkflowNotices } from '@acorn/client-core/notifications/notifications.ts'
import { initSessions, sessions } from '@acorn/client-core/tasks/agentSessions.ts'
import TabRail from '@acorn/client-core/tabs/TabRail.tsx'
import RailTips from '@acorn/client-core/tooltip/RailTips.tsx'
import { activeTaskId, focusedPane, isTerminalMax, isTerminalOpen, maximizedPane, rememberWorkspaceView, selectedSource, setMaximizedPane, setSelectedSource, setTerminalMax, setTerminalOpen, toggleFocusedPaneMax, workspaceView } from '@acorn/client-core/tasks/tasks.ts'
import { isTerminalTarget } from '@acorn/client-core/lib/isTypingTarget.ts'
import { activateTaskSignals, pathForTask } from '@acorn/client-core/tasks/activate.ts'
import { taskStatus } from '@acorn/client-core/tasks/taskStatus.ts'
import { capabilities } from '@acorn/client-core/capabilities.ts'
import TaskView from './TaskView'
import Acorn from '@acorn/client-core/Acorn.tsx'
import { registerCommands } from '@acorn/client-core/registries/commands.ts'
import { KeybindingDispatcher, registerKeybindings } from '@acorn/client-core/registries/keybindings.tsx'
import { confirmWillEvent, registerWillHandler, WillConfirmationHost } from '@acorn/client-core/registries/willPhase.tsx'
import { startClientPollers } from '@acorn/client-core/registries/pollers.ts'
import { SlotHost, type UiSlotContext } from '@acorn/client-core/registries/uiSlots.tsx'
import { createAppStartupRestore } from '@acorn/client-core/persistence/appStartup.ts'
import { PrefKeys } from '@acorn/client-core/persistence/prefKeys.ts'
import { sourceRegistry } from '@acorn/client-core/registries/sources.ts'

// The shell and PR list are the startup path. Heavy/conditional surfaces stay behind their actual
// navigation intent so Monaco, xterm, Shiki/diff rendering, settings plugins, and onboarding do not
// compete with the first interactive paint.
const OnboardingModal = lazy(() => import('@acorn/plugin-onboarding/client/OnboardingModal.tsx'))
const PullDetail = lazy(() => import('@acorn/plugin-github/client/PullDetail.tsx'))
const CreatePullForm = lazy(() => import('@acorn/plugin-github/client/CreatePullForm.tsx'))
const ComparePreview = lazy(() => import('@acorn/plugin-github/client/ComparePreview.tsx'))
const DiffView = lazy(() => import('@acorn/plugin-github/client/DiffView.tsx'))
const SettingsModal = lazy(() => import('@acorn/client-core/settings/SettingsModal.tsx'))
const TerminalPanel = lazy(() => import('@acorn/plugin-terminal/client/TerminalPanel.tsx'))

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

  // Shell-owned commands are registered once; the single dispatcher below owns the only global
  // keydown listener. Maximize is focus-directed and never enters persisted TaskLayout state.
  onMount(() => {
    const commands = registerCommands([
      { id: 'core.settings.open', title: 'Open settings', category: 'navigation', run: () => openSettings() },
      {
        id: 'core.surface.toggle-maximize', title: 'Toggle focused surface maximize', category: 'pane',
        when: inTaskView,
        run: () => {
          const taskId = activeTaskId()
          if (!taskId) return
          const inTerminal = isTerminalTarget(document.activeElement)
          if (inTerminal) {
            setMaximizedPane(taskId, null)
            setTerminalMax(taskId, !isTerminalMax(taskId))
          } else if (focusedPane(taskId)) {
            setTerminalMax(taskId, false)
            toggleFocusedPaneMax(taskId)
          } else if (isTerminalMax(taskId)) {
            setTerminalMax(taskId, false)
          } else if (isTerminalOpen(taskId)) {
            setTerminalOpen(taskId, false)
          }
        },
      },
    ])
    const bindings = registerKeybindings([
      { id: 'core.settings.open', command: 'core.settings.open', description: 'Open settings', category: 'Global', defaultChord: 'meta+,', when: 'global' },
      { id: 'core.surface.toggle-maximize', command: 'core.surface.toggle-maximize', description: 'Toggle focused pane or terminal maximize', category: 'Panes', defaultChord: 'meta+shift+enter', when: 'task' },
    ])
    onCleanup(() => { bindings.dispose(); commands.dispose() })
  })

  onMount(() => {
    const offDirty = registerWillHandler('task:archive', 'Changes', ({ taskId }) => {
      const status = taskStatus(taskId)
      return status?.dirty
        ? { id: `dirty:${taskId}`, feature: 'Changes', message: `${status.dirtyCount ?? 0} uncommitted files`, severity: 'danger' }
        : null
    })
    const offSessions = registerWillHandler('task:archive', 'Terminal', ({ taskId }) => {
      const active = sessions().filter((session) => session.taskId === taskId && session.status === 'running')
      return active.length
        ? { id: `sessions:${taskId}`, feature: 'Terminal', message: `${active.length} active session${active.length === 1 ? '' : 's'}`, severity: 'warn' }
        : null
    })
    const offQuit = registerWillHandler('app:quit', 'Terminal', () => {
      const active = sessions().filter((session) => session.status === 'running')
      return active.length
        ? { id: 'sessions:all', feature: 'Terminal', message: `${active.length} active session${active.length === 1 ? '' : 's'}`, severity: 'warn' }
        : null
    })
    onCleanup(() => { offQuit(); offSessions(); offDirty() })
  })
  onMount(() => {
    const off = window.acorn?.onWillQuit?.(() => confirmWillEvent({
      kind: 'app:quit', payload: {}, title: 'Quit acorn', actionLabel: 'Quit',
    }))
    if (off) onCleanup(off)
  })

  // Track terminal sessions globally (independent of the drawer) so the tab rail and the topbar
  // badge can show agent-working activity. No-op when the terminal bridge is absent (plain browser
  // via dev:node) — the terminal is always on when the bridge exists (capabilities()).
  onMount(() => {
    if (!capabilities().terminal) return
    onCleanup(initSessions())
    onCleanup(startClientPollers())
    onCleanup(initWorkflowNotices())
  })

  const me = createQuery(() => meOptions())
  const repos = createQuery(() => reposOptions(!!me.data))
  const prefs = createQuery(() => prefsOptions(!!me.data))
  const pins = createQuery(() => pinsOptions(!!me.data))
  const tasks = createQuery(() => tasksOptions(!!me.data))
  const workspaces = createQuery(() => workspacesOptions(!!me.data))
  const [collapsed, setCollapsed] = createSignal(false)

  createAppStartupRestore({
    queryClient,
    prefs: () => prefs.data,
    cacheRestoring: isRestoring,
    repos: () => repos.data,
    tasks: () => tasks.data,
    params,
    navigate,
    collapsed,
    setCollapsed,
  })

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

  // Remember the last view per workspace (a rail source or a task) so switching workspaces returns
  // you to exactly what you were looking at, not always GitHub. On each real workspace change: record
  // the view we're leaving, then restore the one we're entering (default GitHub). `defer` skips the
  // startup null→workspace resolution so the persisted-state pipeline's `last_source`/`last_task`
  // restore still wins on first load; the `prevWs` guard likewise leaves that first entry untouched.
  createEffect(
    on(activeWorkspace, (ws, prevWs) => {
      if (!ws || !prevWs || ws.id === prevWs.id) return
      const transition = planWorkspaceViewTransition({
        previousWorkspace: prevWs,
        nextWorkspace: ws,
        selectedSource: untrack(selectedSource),
        activeTaskId: untrack(activeTaskId),
        tasks: tasks.data ?? [],
        rememberedNextView: workspaceView(ws.id),
      })
      if (transition.previousView) rememberWorkspaceView(prevWs.id, transition.previousView)

      if (transition.next.kind === 'keep-task') {
        // An explicit task jump already selected the destination task before navigation. Keep it,
        // and seed the destination memory so a later workspace switch returns to the same task.
        rememberWorkspaceView(ws.id, { taskId: transition.next.task.id })
      } else if (transition.next.kind === 'restore-task') {
        activateTaskSignals(transition.next.task)
        navigate(pathForTask(transition.next.task), { replace: true })
      } else {
        // Also overwrites an invalid remembered task, so old cross-workspace pollution heals in
        // the current session rather than requiring a restart.
        rememberWorkspaceView(ws.id, { source: transition.next.source })
        setSelectedSource(transition.next.source)
      }
    }, { defer: true }),
  )

  const activeTask = () => tasks.data?.find((w) => w.id === activeTaskId()) ?? null
  const slotContext = (): UiSlotContext => ({
    taskActive: inTaskView(),
    terminalOpen: termOpen(),
    toggleTerminal: toggleTerm,
    openSettings,
    selectTask: (taskId) => {
      const task = tasks.data?.find((candidate) => candidate.id === taskId)
      if (!task) return
      activateTaskSignals(task)
      navigate(pathForTask(task))
    },
  })

  const toggleCollapsed = () => setCollapsed((value) => !value)

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
    try {
      const { detail, files } = await forceRefreshPull(params.owner, params.repo, params.number)
      queryClient.setQueryData(pullKey(params.owner, params.repo, params.number), detail)
      queryClient.setQueryData(filesKey(params.owner, params.repo, params.number), files)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: pullsPrefixKey(params.owner, params.repo) }),
        // Linked Linear tickets (list enrichment + any open detail) — refetch their status too.
        queryClient.invalidateQueries({ queryKey: ['linear-issues'] }),
        queryClient.invalidateQueries({ queryKey: ['linear-issue'] }),
      ])
    } finally {
      setRefreshingPull(false)
    }
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
                // The last view (source or task) is restored per-workspace by the activeWorkspace
                // effect above, which may re-navigate to a remembered task's own path.
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
          <SlotHost slot="topbar.right" context={slotContext()} />
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
        <Match when={sourceRegistry.get(selectedSource() ?? '')?.component}>
          {(component) => <Dynamic component={component()} />}
        </Match>
        <Match when={!selectedSource() && activeTask()}>
          {/* Key the task surface by id so changing tasks disposes the old task scope before the new
              one mounts. Read activeTask directly rather than a Match accessor, which can go stale
              while this branch is being disposed. */}
          <Show keyed when={activeTaskId()}>
            {(_taskId) => (
              <TaskView
                task={activeTask()!}
                terminalOpen={termOpen()}
                onToggleTerminal={() => void toggleTerm()}
                onOpenTerminal={() => { if (!termOpen()) void toggleTerm() }}
              />
            )}
          </Show>
        </Match>
      </Switch>
      <KeybindingDispatcher prefs={prefs.data ?? {}} taskActive={inTaskView()} focusedPane={focusedPane(activeTaskId())} />
      <WillConfirmationHost />
      <Show when={settingsOpen()}>
        <SettingsModal initialTab={settingsTab()} onPermissions={permissions} onClose={() => setSettingsOpen(false)} />
      </Show>
      <Show when={!onboardingDismissed() && !!me.data && prefs.data !== undefined && prefs.data?.[PrefKeys.onboarded] !== '1' && (workspaces.data?.length ?? 0) > 0}>
        <OnboardingModal onClose={() => setOnboardingDismissed(true)} />
      </Show>
      <Show when={termOpen()}>
        <TerminalPanel onClose={() => { const id = activeTaskId(); if (id) setTerminalOpen(id, false) }} task={activeTask()} />
      </Show>
      <SlotHost slot="overlay" context={slotContext()} />
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
