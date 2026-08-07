import { createEffect, createSignal, For, lazy, Match, on, onCleanup, onMount, Show, Switch, untrack } from 'solid-js'
import { createQuery, useIsRestoring, useQueryClient } from '@tanstack/solid-query'
import { useMatch, useNavigate, useParams } from '@solidjs/router'
import { Dynamic } from 'solid-js/web'
import { clear } from 'idb-keyval'
import { pinsOptions, prefsOptions, reposOptions, tasksOptions, workspacesKey, workspacesOptions } from '@acorn/client-core/queries.ts'
import { bootstrapWorkspaces } from '@acorn/client-core/workspaces/mutations.ts'
import RepoPicker from '@acorn/client-core/ui/RepoPicker.tsx'
import WorkspacePicker from '@acorn/client-core/ui/WorkspacePicker.tsx'
import { workspaceForRepo } from '@acorn/client-core/workspaces/activeWorkspace.ts'
import { planWorkspaceViewTransition } from '@acorn/client-core/workspaces/workspaceViewTransition.ts'
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
import NodeGate from '@acorn/client-core/node/NodeGate.tsx'
import NodeChip from '@acorn/client-core/node/NodeChip.tsx'
import { activeNodeId, nodeReady, setActiveNode } from '@acorn/client-core/node/activeNode.ts'
import { nodes } from '@acorn/client-core/node/fleet.ts'
import { applyNodePlugins } from './activate'
import TaskView from './TaskView'
import Acorn from '@acorn/client-core/Acorn.tsx'
import { clientEvents } from '@acorn/client-core/registries/clientEvents.ts'
import { registerCommands } from '@acorn/client-core/registries/commands.ts'
import { KeybindingDispatcher, registerKeybindings } from '@acorn/client-core/registries/keybindings.tsx'
import { confirmWillEvent, registerWillHandler, WillConfirmationHost } from '@acorn/client-core/registries/willPhase.tsx'
import { startClientPollers } from '@acorn/client-core/registries/pollers.ts'
import { SlotHost, type UiSlotContext } from '@acorn/client-core/registries/uiSlots.tsx'
import { createAppStartupRestore } from '@acorn/client-core/persistence/appStartup.ts'
import { sourceRegistry } from '@acorn/client-core/registries/sources.ts'

// The shell and PR list are the startup path. Heavy/conditional surfaces stay behind their actual
// navigation intent so Monaco, xterm, Shiki/diff rendering, settings plugins, and onboarding do not
// compete with the first interactive paint.
const SettingsModal = lazy(() => import('@acorn/client-core/settings/SettingsModal.tsx'))

// Layout root (Router root): top bar + three panes. Panes are params-driven — PullList (left)
// and PullDetail (mid) read useParams() directly; routes exist only to populate params.
export default function App() {
  const queryClient = useQueryClient()
  const params = useParams()
  const navigate = useNavigate()
  const isRestoring = useIsRestoring()
  // The Settings page (account menu → Settings): workspace mapping, per-workspace pages,
  // integrations, shortcuts. `settingsTab` seeds which tab opens.
  const [settingsOpen, setSettingsOpen] = createSignal(false)
  const [settingsTab, setSettingsTab] = createSignal('workspaces')
  const openSettings = (tab = 'workspaces') => {
    setSettingsTab(tab)
    setSettingsOpen(true)
  }
  // Panes deep-link here rather than receiving an `openSettings` prop: the modal is the shell's, and
  // threading a callback through every pane that might ever want one is worse than one event.
  onMount(() => onCleanup(clientEvents.on('presentation:open-settings', ({ tab }) => openSettings(tab))))
  // The terminal drawer belongs to a task, not the app: it's shown only in the Task view (a Source
  // browse like Pull requests has no terminal) and its open/closed state is tracked per task, so
  // switching tabs swaps it. `termOpen` reflects the active task's state within the Task view.
  const inTaskView = () => !selectedSource() && !!activeTask()
  const termOpen = () => inTaskView() && isTerminalOpen(activeTaskId())
  const toggleTerm = () => {
    const id = activeTaskId()
    if (id) setTerminalOpen(id, !isTerminalOpen(id))
  }
  // Idempotent, unlike the toggle. The drawer contribution closes itself when its last tab goes, and that path
  // can fire twice (TerminalPanel.closeTab decides after two awaits, so two racing closes both see an empty
  // roster) — a second toggle would reopen the drawer and auto-launch a profile into it.
  const closeTerm = () => {
    const id = activeTaskId()
    if (id) setTerminalOpen(id, false)
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

  // Which plugins the node we just switched to runs. `defer` because index.tsx already applied the list
  // for the node this window opened on, and re-running the host during the first render would dispose and
  // re-register every contribution mid-paint. Not for the initial node — for the second one onwards.
  createEffect(on(activeNodeId, () => void applyNodePlugins(), { defer: true }))

  // Gated on having a node to ask, not on an identity: there is no login. NodeGate below holds the
  // screen until `nodeReady()`, so these only ever fire against a selected node.
  const repos = createQuery(() => reposOptions(nodeReady()))
  const prefs = createQuery(() => prefsOptions(nodeReady()))
  const pins = createQuery(() => pinsOptions(nodeReady()))
  const tasks = createQuery(() => tasksOptions(nodeReady()))
  const workspaces = createQuery(() => workspacesOptions(nodeReady()))
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
    if (bootstrapped || !nodeReady() || !repos.data) return
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
    closeTerminal: closeTerm,
    openSettings,
    activeTask: activeTask(),
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

  async function clearCache() {
    queryClient.clear()
    await clear() // wipe the persisted IndexedDB cache before reload so it can't rehydrate
    window.location.reload()
  }

  // The two force-refresh handlers that used to live here (refreshAllPulls / refreshCurrentPull, with their
  // `refreshing*` signals) are GONE, not moved: Phase 3 COPIED them into plugins/github's GithubBrowse.tsx along
  // with the rest of the three-pane layout, and left these behind unreferenced. Nothing rendered the buttons that
  // called them once the shell stopped rendering the browse surface, so they were dead code holding the shell's
  // last four imports of github query keys.

  // Hold the bare gate until there is a node AND the persisted cache has finished rehydrating. The
  // second half is not about auth — it never was: rendering mid-restore flashes empty panes that fill
  // in a beat later.
  return (
    <Show when={nodeReady() && !isRestoring()} fallback={<NodeGate />}>
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
          {/* plan.md § 69's "minimal node switcher in the dev UI", and nothing more — the real fleet UX
              (fleet home, node badges on every row) is Phase 4. Hidden with a single node in a
              production build, because first-run must never mention nodes (ui.md § New surfaces). */}
          <Show when={nodes().length > 1 || import.meta.env.DEV}>
            <select
              class="ui-input node-switcher"
              data-width="auto"
              aria-label="Active node"
              value={activeNodeId() ?? ''}
              onChange={(event) => setActiveNode(event.currentTarget.value || null)}
            >
              <For each={nodes()}>{(node) => <option value={node.nodeId}>{node.label}</option>}</For>
            </select>
          </Show>
          {/* One of the two places freshness is rendered in Phase 1 (the other is the Nodes settings
              rows). Keyed on any node-backed query would be arbitrary, so the chip reports the
              connection alone; per-surface freshness is Phase 4. */}
          <Show when={activeNodeId()}>
            {(nodeId) => <NodeChip nodeId={nodeId()} compact={nodes().length <= 1} query={{}} />}
          </Show>
          <SlotHost slot="topbar.right" context={slotContext()} />
          <AccountMenu onSettings={() => openSettings()} onClearCache={clearCache} />
        </div>
      </header>
      {/* The GitHub browse surface used to live HERE, as this Switch's fallback: three panes, five imported
          components and two force-refresh handlers, because tabs/sources.ts hardcoded `github` ahead of the
          source registry. It is an ordinary source contribution now (plugins/github's GithubBrowse.tsx), so
          the first Match below renders it exactly as it renders Linear, Docker or Agents — and the fallback
          is what it always should have been: no source selected and no task open. */}
      <Switch fallback={<main class="panes panes-empty"><Acorn /></main>}
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
        <SettingsModal initialTab={settingsTab()} onClose={() => setSettingsOpen(false)} />
      </Show>
      {/* The terminal drawer arrives as a contribution (plugins/terminal's drawerContribution.tsx). The
          shell still owns the per-task `terminalOpen` flag — the tab rail and topbar badge read it too — and
          passes it through slotContext; it no longer knows what fills the drawer. Order matters: this host
          sits BEFORE the overlay host, so a dialog still paints above the drawer. */}
      <SlotHost slot="drawer" context={slotContext()} />
      <SlotHost slot="overlay" context={slotContext()} />
    </div>
    <RailTips />
    </div>
    </Show>
  )
}
