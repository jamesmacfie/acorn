import { createEffect, createSignal, For, lazy, Match, on, onCleanup, onMount, Show, Switch, untrack } from 'solid-js'
import { createQuery, useIsRestoring, useQueryClient } from '@tanstack/solid-query'
import { useLocation, useMatch, useNavigate, useParams } from '@solidjs/router'
import { Dynamic } from 'solid-js/web'
import { clear } from 'idb-keyval'
import { integrationsOptions, prefsOptions, projectsOptions, tasksOptions, workspacesOptions } from '@acorn/client-core/queries.ts'
import WorkspacePicker from '@acorn/client-core/ui/WorkspacePicker.tsx'
import { workspaceForProject } from '@acorn/client-core/workspaces/activeWorkspace.ts'
import { createFleetWorkspaces, selectFleetWorkspace } from '@acorn/client-core/workspaces/fleetWorkspaces.ts'
import { planWorkspaceViewTransition } from '@acorn/client-core/workspaces/workspaceViewTransition.ts'
import AccountMenu from '@acorn/client-core/AccountMenu.tsx'
import { initWorkflowNotices } from '@acorn/client-core/notifications/notifications.ts'
import { initSessions, sessions } from '@acorn/client-core/tasks/agentSessions.ts'
import TabRail from '@acorn/client-core/tabs/TabRail.tsx'
import RailTips from '@acorn/client-core/tooltip/RailTips.tsx'
import { activeTaskId, focusedPane, isTerminalMax, isTerminalOpen, rememberWorkspaceView, selectedSource, setMaximizedPane, setSelectedSource, setTerminalMax, setTerminalOpen, toggleFocusedPaneMax, workspaceView } from '@acorn/client-core/tasks/tasks.ts'
import { isTerminalTarget } from '@acorn/client-core/lib/isTypingTarget.ts'
import { activateTaskSignals, pathForTask } from '@acorn/client-core/tasks/activate.ts'
import { taskStatus } from '@acorn/client-core/tasks/taskStatus.ts'
import { capabilities } from '@acorn/client-core/capabilities.ts'
import NodeGate from '@acorn/client-core/node/NodeGate.tsx'
import NodeChip from '@acorn/client-core/node/NodeChip.tsx'
import { activeNodeId, nodeReady, setActiveNode } from '@acorn/client-core/node/activeNode.ts'
import { nodes } from '@acorn/client-core/node/fleet.ts'
import { warnOnceAboutDisk } from '@acorn/client-core/node/nodeSecurity.ts'
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
import { createTaskDeepLink } from '@acorn/client-core/tasks/taskDeepLink.ts'
import { defaultSourceId, sourceRegistry } from '@acorn/client-core/registries/sources.ts'
import { CREATE_TASK_ROUTE, projectPath } from '@acorn/client-core/registries/corePaths.ts'
import { availableSources } from '@acorn/client-core/tabs/sources.ts'

// The shell and PR list are the startup path. Heavy/conditional surfaces stay behind their actual
// navigation intent so Monaco, xterm, Shiki/diff rendering, settings plugins, and onboarding do not
// compete with the first interactive paint.
const SettingsModal = lazy(() => import('@acorn/client-core/settings/SettingsModal.tsx'))

// Layout root (Router root): top bar + three panes. Panes are params-driven — PullList (left)
// and PullDetail (mid) read useParams() directly; routes exist only to populate params.
export default function App() {
  const queryClient = useQueryClient()
  const params = useParams()
  const location = useLocation()
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

  // Which plugins the node this shell is showing runs.
  //
  // NOT `on(activeNodeId, …, { defer: true })`, which is what this was and which never fired. index.tsx
  // mounts App inside a `<Show keyed>` on the active node, so a switch DISPOSES this component and builds a
  // new one: the fresh effect records the new node and defers, the dying one is disposed during Solid's pure
  // pass before user effects flush, and `applyNodePlugins` ran exactly once per window — at boot, from
  // index.tsx. Every node after the first kept the previous node's contributions, so a plugin disabled on
  // node B still had its pane, source, poller and settings page. The comment claiming "for the second one
  // onwards" was precisely backwards.
  //
  // A plain effect reading the signal is right BECAUSE of that remount: it runs once on mount, which is once
  // per node. The duplicate for the first node is a no-op — `applyNodePlugins` skips a node whose list it has
  // already applied.
  createEffect(() => {
    const nodeId = activeNodeId()
    if (nodeId) void applyNodePlugins(nodeId)
  })

  // The one-time disk-encryption warning (docs/data-layer.md § Backup: "the app surfaces a one-time
  // warning if the disk isn't encrypted"). Once per (device, node), which is why it sits here beside the
  // plugin apply rather than at boot: a node the owner pairs later has never been checked, and the same
  // remount that makes the effect above correct makes this one fire for it.
  //
  // `warnOnceAboutDisk` swallows its own failures and records the acknowledgement before pushing, so this
  // can never be the thing that fails a boot or repeats every launch.
  createEffect(() => {
    const nodeId = activeNodeId()
    if (!nodeId) return
    const label = nodes().find((candidate) => candidate.nodeId === nodeId)?.label ?? 'This node'
    void warnOnceAboutDisk(queryClient, nodeId, label)
  })

  // Gated on having a node to ask, not on an identity: there is no login. NodeGate below holds the
  // screen until `nodeReady()`, so these only ever fire against a selected node.
  const prefs = createQuery(() => prefsOptions(nodeReady()))
  const integrations = createQuery(() => integrationsOptions(nodeReady()))
  const projects = createQuery(() => projectsOptions(nodeReady()))
  const tasks = createQuery(() => tasksOptions(nodeReady()))
  const workspaces = createQuery(() => workspacesOptions(nodeReady()))
  const [collapsed, setCollapsed] = createSignal(false)

  createEffect(() => {
    const current = selectedSource()
    const connected = integrations.data?.integrations
    if (!current || !connected) return
    if (!availableSources(connected).some((source) => source.id === current)) {
      setSelectedSource(defaultSourceId() ?? null)
    }
  })

  createAppStartupRestore({
    queryClient,
    prefs: () => prefs.data,
    cacheRestoring: isRestoring,
    projects: () => projects.data,
    tasks: () => tasks.data,
    path: () => location.pathname,
    navigate,
    collapsed,
    setCollapsed,
  })

  // `/t/:taskId?pane=…&item=…` — open a pane on a selected item, once, then strip the params
  // (tasks/taskDeepLink.ts). The address a plugin pane could not previously be given.
  createTaskDeepLink({
    taskId: () => activeTaskId(),
    search: () => location.query,
    navigate,
  })

  // Active workspace is derived from the current project. The ACTIVE
  // node's list, deliberately: the route carries no node, so the workspace the shell is showing is
  // whichever one the active node has for this repo.
  const activeWorkspace = () => workspaceForProject(workspaces.data, params.projectId)
  // Every node's workspaces, for the topbar picker. Grouped rather than merged: a workspace belongs to
  // exactly one node, and two nodes both having a "Default" is the normal case.
  const fleetWorkspaces = createFleetWorkspaces()
  const activeFleetWorkspace = () => {
    const workspace = activeWorkspace()
    if (!workspace) return null
    return fleetWorkspaces().entries.find((entry) => entry.nodeId === activeNodeId() && entry.workspace.id === workspace.id) ?? null
  }
  // Projects scoped to the active workspace for the topbar selector. Falls back to all projects before
  // the workspace mapping has loaded so the picker is never empty.
  const scopedProjects = () => {
    const ws = activeWorkspace()
    const all = (projects.data ?? []).filter((project) => !project.hidden)
    if (!ws) return all
    return all.filter((project) => project.workspaceId === ws.id)
  }

  // Remember the last view per workspace (a rail source or a task) so switching workspaces returns
  // you to exactly what you were looking at, not always Home. On each real workspace change: record
  // the view we're leaving, then restore the one we're entering (core Home by default). `defer` skips the
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
        defaultSource: defaultSourceId() ?? '',
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

  // New-task mode: core's own route, so the pattern is a constant rather than a registry lookup.
  const newMatch = useMatch(() => CREATE_TASK_ROUTE)
  const isNew = () => !!newMatch()

  async function clearCache() {
    queryClient.clear()
    await clear() // wipe the persisted IndexedDB cache before reload so it can't rehydrate
    window.location.reload()
  }

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
          <Show when={fleetWorkspaces().entries.length}>
            <WorkspacePicker
              workspaces={fleetWorkspaces().entries}
              active={activeFleetWorkspace()}
              grouped={fleetWorkspaces().grouped}
              /* Switches node context before navigating, so the route resolves against the node that
                 owns the workspace (client-core's workspaces/fleetWorkspaces.ts explains the order).
                 The last view is then restored per-workspace by the activeWorkspace effect above. */
              onSelect={(entry) => selectFleetWorkspace(entry, navigate)}
            />
          </Show>
          <Show when={scopedProjects().length}>
            <select
              class="ui-input project-picker"
              aria-label="Project"
              value={params.projectId ?? ''}
              disabled={!selectedSource() && !!activeTask()}
              onChange={(event) => {
                const projectId = event.currentTarget.value
                if (!projectId) return
                if (!selectedSource()) {
                  const source = defaultSourceId()
                  if (source) setSelectedSource(source)
                }
                navigate(projectPath(projectId))
              }}
            >
              <For each={scopedProjects()}>{(project) => <option value={project.id}>{project.name}</option>}</For>
            </select>
          </Show>
        </div>
        <div class="breadcrumb">
          <Show when={params.projectId} fallback={<span class="brand">acorn</span>}>
            <button type="button" class="crumb crumb-link" onClick={() => navigate(projectPath(params.projectId ?? ''))}>
              {projects.data?.find((project) => project.id === params.projectId)?.name ?? params.projectId}
            </button>
            <Show when={params.number}>
              <span class="crumb-sep">/</span>
              <span class="crumb crumb-num">#{params.number}</span>
            </Show>
            <Show when={isNew()}>
              <span class="crumb-sep">/</span>
              <span class="crumb crumb-num">new</span>
            </Show>
          </Show>
        </div>
        <div class="topbar-side topbar-end">
          {/* Keep the node switcher out of production first-run until a second node exists. */}
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
          {/* The compact chip reports the active node's connection state; surfaces render their own
              freshness where they have useful scope. */}
          <Show when={activeNodeId()}>
            {(nodeId) => <NodeChip nodeId={nodeId()} compact={nodes().length <= 1} query={{}} />}
          </Show>
          <SlotHost slot="topbar.right" context={slotContext()} />
          <AccountMenu onSettings={() => openSettings()} onClearCache={clearCache} />
        </div>
      </header>
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
