import { Portal } from 'solid-js/web'
// The desktop's own chrome, and why it is here rather than in client-core: it is the arrangement, not
// the parts. Routing and the overlay slots are what this composition root decides. The topbar and rail
// are exclusive slots it fills with core's provider or a device plugin's (docs/frontend.md).
import { createEffect, createMemo, createSignal, lazy, Match, on, onCleanup, onMount, Show, Switch, untrack } from 'solid-js'
import { createQuery, useIsRestoring, useQueryClient } from '@tanstack/solid-query'
import { useLocation, useMatch, useNavigate, useParams } from '@solidjs/router'
import { integrationsOptions, prefsOptions, type Project, projectsKey, projectsOptions, type Task, tasksKey, tasksOptions, type Workspace, workspacesOptions } from '@acorn/client-core/infra/queries.ts'
import { setProjectsLookup } from '@acorn/client-core/features/projects/projectLookup.ts'
import { setTaskLookup } from '@acorn/client-core/features/tasks'
import {
  createFleetWorkspaces, noteWorkspaceVisit, planWorkspaceViewTransition, selectFleetWorkspace,
  viewToRemember, workspaceForProject, workspaceOwnsPath,
} from '@acorn/client-core/features/workspaces'
import { initSystemNotices, initWorkflowNotices } from '@acorn/client-core/features/notifications/deliver.ts'
import { initSoundNotices } from '@acorn/client-core/features/notifications'
import { sessionSummaries } from '@acorn/client-core/features/tasks'
import TabRail from '@acorn/client-core/features/tabs/TabRail.tsx'
import Tips from '@acorn/client-core/kit/components/overlays/tips.tsx'
import { ToastHost } from '@acorn/client-core/features/notifications/ToastHost.tsx'
import { activeTaskId, focusedPane, isTerminalMax, isTerminalOpen, rememberWorkspaceView, selectedSource, setMaximizedPane, setSelectedSource, setTerminalMax, setTerminalOpen, toggleFocusedPaneMax, workspaceView } from '@acorn/client-core/features/tasks/tasks.ts'
import { isTerminalTarget } from '@acorn/client-core/host/keys'
import { activateTaskSignals, pathForTask } from '@acorn/client-core/features/tasks/activate.ts'
import { desktopExtras } from '@acorn/client-core/infra/platform'
import NodeGate from '@acorn/client-core/features/fleet/NodeGate.tsx'
import { activeNodeId, nodeGateHolds, nodeReady, setActiveNode } from '@acorn/client-core/infra/node/activeNode.ts'
import { nodes, nodeState } from '@acorn/client-core/infra/node/fleet.ts'
import { warnOnceAboutDisk } from '@acorn/client-core/infra/node'
import { applyNodePlugins } from './activate'
import { clearCache } from './clearCache'
import TaskView from './TaskView'
import Acorn from '@acorn/client-core/kit/components/content/Acorn.tsx'
import { clientEvents } from '@acorn/client-core/host/registries/commands'
import { registerCommands } from '@acorn/client-core/host/registries/commands'
import { appearanceCommands, notificationCommands, settingsPageCommands } from '@acorn/client-core/host/registries/commands'
import { KeybindingDispatcher, registerKeybindings } from '@acorn/client-core/host/registries/commands'
import { CheatSheet } from '@acorn/client-core/host/keys/CheatSheet.tsx'
import { confirmWillEvent, registerWillHandler, WillConfirmationHost } from '@acorn/client-core/host/registries/shell/willPhase.tsx'
import { taskBridge } from '@acorn/client-core/features/tasks'
import { RefPanelHost } from '@acorn/client-core/host/registries/panes/refPanelHost.tsx'
import { startClientSchedules } from '@acorn/client-core/host/registries/shell'
import { SlotHost, type UiSlotContext } from '@acorn/client-core/host/registries/extensionPoints/uiSlots.tsx'
import { createAppStartupRestore } from '@acorn/client-core/infra/persistence'
import { createTaskDeepLink } from '@acorn/client-core/features/tasks'
import { defaultSourceId, sourceIsProjectScoped, sourceRegistry } from '@acorn/client-core/host/registries/sources'
import { SourceSurface } from '@acorn/client-core/host/registries/sources/SourceSurface.tsx'
import { CREATE_TASK_ROUTE, projectPath } from '@acorn/client-core/host/registries/commands'
import { availableSources } from '@acorn/client-core/features/tabs'
import { createSourceScope } from '@acorn/client-core/features/tabs'
import { setTelemetryEnabled } from '@acorn/client-core/infra/telemetry/emitter.ts'
import { emitBootSpans } from './boot'
import { telemetryOn } from '@acorn/client-core/features/settings'
import type { TopbarProps } from '@acorn/protocol/chrome.ts'
import Topbar from '@acorn/client-core/host/chrome/Topbar.tsx'
import ExclusiveSlotHost from '@acorn/client-core/host/plugins/ExclusiveSlotHost.tsx'
import { mintSlotRef } from '@acorn/client-core/host/plugins/NestedChromeSlot.tsx'
import { registerCoreExclusiveSlot } from '@acorn/client-core/host/registries/extensionPoints'
import { PrefKeys } from '@acorn/client-core/infra/persistence'
import { savePref } from '@acorn/client-core/features/settings/savePref.ts'
import type { SettingsRequest } from '@acorn/client-core/features/settings/SettingsView.tsx'

// The shell and PR list are the startup path. Heavy/conditional surfaces stay behind their actual
// navigation intent so the editor, xterm, Shiki/diff rendering, settings plugins, and onboarding do not
// compete with the first interactive paint.
const SettingsView = lazy(() => import('@acorn/client-core/features/settings/SettingsView.tsx'))

// Layout root (Router root): top bar + three panes. Panes are params-driven: PullList (left)
// and PullDetail (mid) read useParams() directly; routes exist only to populate params.
export default function App() {
  const queryClient = useQueryClient()
  const params = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const isRestoring = useIsRestoring()
  // Settings: a full-window layer over the shell, not a route, so the workspace under it stays mounted
  // (client-core/features/settings/SettingsView.tsx). `null` is closed. A request is a fresh object per
  // call, so a deep link that arrives while settings is open still navigates. With no target it opens on
  // the last page used; a target is `settings/<pageId>#<sectionId>` or a bare page id.
  const [settingsRequest, setSettingsRequest] = createSignal<SettingsRequest | null>(null)
  const openSettings = (target?: string): void => { setSettingsRequest(target ? { target } : {}) }
  // Panes deep-link here rather than receiving an `openSettings` prop: the layer is the shell's, and
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
  // Idempotent, unlike the toggle. The drawer contribution closes itself when its last tab goes, and
  // that path can fire twice (TerminalPanel.closeTab decides after two awaits, so two racing closes
  // both see an empty roster). A second toggle would reopen the drawer and auto-launch a profile into
  // it.
  const closeTerm = () => {
    const id = activeTaskId()
    if (id) setTerminalOpen(id, false)
  }

  // The one place that holds both the QueryClient and the whole mounted app, which is what
  // client-core's module-level task lookup needs (tasks/taskLookup.ts states why it cannot reach
  // either itself). Installed before anything is clickable, so a content-link click can ask whether a
  // pane is available on the task it names rather than claiming the event and rendering nothing.
  setTaskLookup((taskId) => queryClient.getQueryData<Task[]>(tasksKey)?.find((task) => task.id === taskId))
  // Same argument, one entity over: a content-link path resolver asks whether an external URL names a
  // repo acorn tracks, and only the project rows know (projects/projectLookup.ts).
  setProjectsLookup(() => queryClient.getQueryData<Project[]>(projectsKey) ?? [])

  // Shell-owned commands are registered once; the single dispatcher below owns the only global
  // keydown listener. Maximize is focus-directed and never enters persisted TaskLayout state.
  onMount(() => {
    const commands = registerCommands([
      { id: 'core.settings.open', title: 'Open settings', hint: 'on the page used last', category: 'navigation', palette: true, run: () => openSettings() },
      { id: 'core.rail.toggle', title: 'Toggle rail', category: 'navigation', run: () => toggleRail() },
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
      { id: 'core.rail.toggle', command: 'core.rail.toggle', description: 'Toggle rail', category: 'Global', defaultChord: 'meta+b', when: 'global' },
      { id: 'core.surface.toggle-maximize', command: 'core.surface.toggle-maximize', description: 'Toggle focused pane or terminal maximize', category: 'Panes', defaultChord: 'meta+shift+enter', when: 'task' },
      // The command is the palette's own Last workspace row, registered with the rest of the Go to
      // group (client-core/host/palette/navigationCommands.ts); this is the chord that reaches it.
      { id: 'core.goto.workspace-last', command: 'core.goto.workspace-last', description: 'Switch to the last workspace', category: 'Global', defaultChord: 'meta+;', when: 'global' },
    ])
    // The two settings core owns, as bounded choices with the current value marked. Both write through
    // the same accessors Settings → Appearance and Settings → Notifications call
    // (client-core/host/registries/commands/coreCommands.ts), so there is one persistence path per
    // value and not two.
    //
    // Registered here rather than in client-core because this app is what contributes those pages
    // (./pageContributions.tsx): a host with no Appearance page has nothing for an Appearance command
    // to agree with.
    const settings = registerCommands([...appearanceCommands(queryClient), ...notificationCommands(queryClient)])
    onCleanup(() => { settings.dispose(); bindings.dispose(); commands.dispose() })
  })

  // One row per registered Settings page, rebuilt when the roster changes: a plugin contributes pages,
  // so a list taken once would go stale the moment one loads or is disabled.
  createEffect(() => {
    const pages = registerCommands(settingsPageCommands(openSettings))
    onCleanup(() => pages.dispose())
  })

  onMount(() => {
    // The one archive producer left on the client, and it produces nothing of its own: it asks the
    // node, which is where every plugin now declares what it has to say about archiving a task
    // (node-core/server/pluginHost/taskChecks.ts). The docker, changes and terminal warnings that used to
    // be registered here and in the docker client bundle all arrive through this.
    //
    // Mapped rather than passed through because a node concern carries no callback: the cleanup the
    // owner ticks is a route the node runs at the right point in the archive, and the id below is
    // what the archive request hands back to name it.
    const offNode = registerWillHandler('task:archive', 'plugins', async ({ taskId }) =>
      (await taskBridge().task.archiveConcerns(taskId)).map((concern) => ({
        id: concern.id,
        feature: concern.pluginId,
        message: concern.message,
        severity: concern.severity,
        ...(concern.details ? { details: concern.details } : {}),
        ...(concern.detailsMore ? { detailsMore: concern.detailsMore } : {}),
        ...(concern.action ? { checkbox: concern.action } : {}),
      })))
    // Quitting has no node meaning: a node does not know a window is closing, so this one stays a
    // client handler over the session store.
    const offQuit = registerWillHandler('app:quit', 'Terminal', () => {
      const active = sessionSummaries().filter((session) => session.running)
      return active.length
        ? { id: 'sessions:all', feature: 'Terminal', message: `${active.length} active session${active.length === 1 ? '' : 's'}`, severity: 'warn' }
        : null
    })
    onCleanup(() => { offQuit(); offNode() })
  })
  onMount(() => {
    const off = desktopExtras()?.onWillQuit(async () => (await confirmWillEvent({
      kind: 'app:quit', payload: {}, title: 'Quit acorn', actionLabel: 'Quit',
    })).confirmed)
    if (off) onCleanup(off)
  })

  // The session-source owners start their own roster subscriptions at activation. The shell starts
  // its schedules once the node can answer. App mounts before the startup gate releases, and each
  // schedule runs once on start and then waits for its interval or an event. Started at mount, the
  // first run went to a local node the broker had not adopted yet, failed, and left task statuses
  // empty for up to 10 s and workflow run counts for up to 2 min.
  //
  // Started once and kept, because the gate can briefly hold again while Settings → Nodes re-reads
  // the fleet.
  let stopSchedules: (() => void) | undefined
  createEffect(() => {
    if (!stopSchedules && nodeReady()) stopSchedules = startClientSchedules()
  })
  onCleanup(() => stopSchedules?.())

  // Workflow notices are broadcast over `/v1/events` by main, not by the terminal plugin, and a node
  // without a terminal still runs workflows. They were inside the guard above, which meant no gate
  // notice at all on such a node.
  onMount(() => onCleanup(initWorkflowNotices()))

  // The sound channel. Every unseen notice the gate lets through, whatever raised it.
  onMount(() => onCleanup(initSoundNotices()))

  // The system channel, on the same terms. The dock badge is the bell's, because it is the bell's
  // number (features/notifications/NotificationBell.tsx).
  onMount(() => onCleanup(initSystemNotices()))

  // Which plugins the node this shell is showing runs.
  //
  // Not `on(activeNodeId, …, { defer: true })`, which is what this was and which never fired. index.tsx
  // mounts App inside a `<Show keyed>` on the active node, so a switch disposes this component and
  // builds a new one: the fresh effect records the new node and defers, the dying one is disposed
  // during Solid's pure pass before user effects flush, and `applyNodePlugins` ran exactly once per
  // window, at boot, from index.tsx. Every node after the first kept the previous node's
  // contributions, so a plugin disabled on node B still had its pane, source, poller and settings
  // page. The comment claiming "for the second one onwards" was precisely backwards.
  //
  // A plain effect reading the signal is right because of that remount: it runs once on mount, which
  // is once per node. The duplicate for the first node is a no-op: `applyNodePlugins` skips a node
  // whose list it has already applied.
  // Re-reads on the node's connection state as well as its identity, which is what makes it a retry.
  // The boot attempt in index.tsx starts before the local node is up and can fail against nothing
  // listening; `applyNodePlugins` leaves itself unapplied when the node did not answer, so this runs
  // again after the startup gate releases. `offline` is skipped because a request then cannot succeed.
  createEffect(() => {
    const nodeId = activeNodeId()
    if (nodeId && nodeState(nodeId) !== 'offline') void applyNodePlugins(nodeId)
  })

  // The one-time disk-encryption warning (docs/data-layer.md § Backup: "the app surfaces a one-time
  // warning if the disk isn't encrypted"). Once per (device, node), which is why it sits here beside the
  // plugin apply rather than at boot: a node the owner pairs later has never been checked, and the same
  // remount that makes the effect above correct makes this one fire for it.
  //
  // `warnOnceAboutDisk` swallows its own failures and records the acknowledgement before pushing, so this
  // can never be the thing that fails a boot or repeats every launch.
  //
  // Gated on `nodeReady()`, because a read that fails counts as "do not warn": asked at mount, before
  // the local node was adopted, the warning never ran at all.
  createEffect(() => {
    const nodeId = activeNodeId()
    if (!nodeId || !nodeReady()) return
    const label = nodes().find((candidate) => candidate.nodeId === nodeId)?.label ?? 'This node'
    void warnOnceAboutDisk(queryClient, nodeId, label)
  })

  // Gated on having a node to ask, not on an identity: there is no login. App mounts before the startup
  // gate releases, so these are created while the local node may still be starting. `nodeReady()` holds
  // them until the broker has the node, which is also when the gate releases, and it still lets a
  // known offline remote node draw cached data.
  // Always refetched on mount, because the startup restore waits for the node's answer and a cached
  // value inside its stale time would otherwise never be asked for again.
  const prefs = createQuery(() => ({ ...prefsOptions(nodeReady()), refetchOnMount: 'always' as const }))
  const mountedAt = Date.now()
  const integrations = createQuery(() => integrationsOptions(nodeReady()))
  const projects = createQuery(() => projectsOptions(nodeReady()))
  const tasks = createQuery(() => tasksOptions(nodeReady()))
  const workspaces = createQuery(() => workspacesOptions(nodeReady()))
  const railCollapsed = () => prefs.data?.[PrefKeys.leftCollapsed] === 'true'
  const toggleRail = () => void savePref(queryClient, PrefKeys.leftCollapsed, String(!railCollapsed()))

  const startup = createAppStartupRestore({
    queryClient,
    prefs: () => prefs.data,
    // Timestamps rather than `isFetchedAfterMount`, which also counts the cache arriving from IndexedDB
    // after this component subscribed. A failed fetch counts, and so does a node known to be offline:
    // in both the cache is all there is.
    prefsSettled: () => Math.max(prefs.dataUpdatedAt, prefs.errorUpdatedAt) >= mountedAt
      || (!nodeGateHolds() && nodeState(activeNodeId() ?? '') === 'offline'),
    cacheRestoring: isRestoring,
    projects: () => projects.data,
    tasks: () => tasks.data,
    workspaces: () => workspaces.data,
  })

  // `/t/:taskId?pane=…&item=…`: open a pane on a selected item, once, then strip the params
  // (tasks/taskDeepLink.ts). The address a plugin pane could not previously be given.
  createTaskDeepLink({
    taskId: () => activeTaskId(),
    search: () => location.query,
    navigate,
  })

  // Active workspace is derived from the current project. The active node's list, because the route
  // carries no node, so the workspace the shell is showing is whichever one the active node has for
  // this repo.
  const activeTask = () => tasks.data?.find((w) => w.id === activeTaskId()) ?? null
  // TaskView registers callbacks with the keymap, whose layer can still be evaluated while Solid is
  // disposing the view. Keep the last row available for that teardown tick after an archive removes
  // it from the query. Rendering still gates on `activeTask()` below, so a missing row is never shown.
  // Retaining the row instead of keying on the whole object also avoids remounting every pane when a
  // refetch changes task metadata without changing which task is open.
  const taskForView = createMemo<Task | null>((previous) => activeTask() ?? previous ?? null)
  // Which project the shell is "in". The generic task route (`/t/:taskId`) carries no projectId, so
  // without the task fallback the workspace and project pickers went blank the moment you opened a
  // task, and the per-workspace view memory below never saw a workspace change.
  const contextProjectId = () => params.projectId ?? activeTask()?.projectId
  // A memo, and one that holds its last answer, for two reasons that both belong to the transition
  // effect below.
  //
  // `on` re-fires on identity, not on value, so keying it on a plain derivation re-planned the whole
  // workspace change on every tasks, projects or params tick.
  //
  // And the derivation reports nothing for a beat in ordinary use: while the workspaces query is
  // cold, and between a task path and its task row landing. `on` would record that nothing as the
  // workspace we were leaving, and the guard below then dropped the next real switch, which is one
  // way the last view fails to come back. Holding the last known workspace also stops the topbar
  // pickers and the rail's scope blinking through the same gap.
  const activeWorkspace = createMemo<Workspace | null>((previous) =>
    workspaceForProject(workspaces.data, contextProjectId()) ?? previous ?? null)
  const sourceScope = createSourceScope(() => activeWorkspace()?.id, nodeReady)

  // The one switch, read off the node and handed to the client's emitter (docs/telemetry.md § The
  // switch). An effect rather than a call at boot, because the preference arrives after the first
  // paint and can change while the app is open: the node's collector re-reads its own copy every
  // five seconds, and this is the renderer's half of the same promise. The boot account waits for the
  // switch as well as for the node, so this is one of the two places that can release it (./boot.ts).
  createEffect(() => {
    const on = telemetryOn(prefs.data)
    setTelemetryEnabled(on)
    if (on) emitBootSpans()
  })

  // Whatever source was selected has to still be on offer. A workspace switch can take one away:
  // a browse source only appears where its provider is connected and the workspace links one of its
  // projects, and neither is a fact about the source alone.
  createEffect(() => {
    const current = selectedSource()
    const connected = integrations.data?.integrations
    if (!current || !connected) return
    if (!availableSources(connected, sourceScope()).some((source) => source.id === current)) {
      setSelectedSource(defaultSourceId() ?? null)
    }
  })

  // Every node's workspaces, for the topbar picker. Grouped rather than merged: a workspace belongs to
  // exactly one node, and two nodes both having a "Default" is the normal case.
  const fleetWorkspaces = createFleetWorkspaces()
  // Projects scoped to the active workspace for the topbar selector. Falls back to all projects before
  // the workspace mapping has loaded so the picker is never empty.
  const scopedProjects = () => {
    const ws = activeWorkspace()
    const all = (projects.data ?? []).filter((project) => !project.hidden)
    if (!ws) return all
    return all.filter((project) => project.workspaceId === ws.id)
  }

  // Show what this workspace was last left on. A task opens at its own address. A source keeps the
  // address when it already names a project here, because a switch or a reload put it there; only
  // an address from elsewhere, such as `/` at launch, is replaced by the remembered page.
  const openWorkspaceView = (ws: Workspace) => {
    const plan = planWorkspaceViewTransition({
      workspace: ws,
      selectedSource: selectedSource(),
      activeTaskId: activeTaskId(),
      tasks: tasks.data ?? [],
      defaultSource: defaultSourceId() ?? '',
      rememberedView: workspaceView(ws.id),
    })
    if (plan.kind === 'restore-task') {
      activateTaskSignals(plan.task)
      navigate(pathForTask(plan.task), { replace: true })
    } else if (plan.kind === 'restore-source') {
      setSelectedSource(plan.source)
      const landing = plan.path ?? (ws.projects[0] ? projectPath(ws.projects[0].id) : undefined)
      if (landing && !workspaceOwnsPath(ws, location.pathname)) navigate(landing, { replace: true })
    }
  }

  // Reopen where the window was left. An address that names a place wins, which is what a reload
  // keeps. Otherwise `last_workspace` says which workspace, and its memory says what was open in it.
  // Waits for the whole restore pass, because opening a task with no layout in memory gives it a
  // default one, and the saved layouts land in the last phase.
  const [placeRestored, setPlaceRestored] = createSignal(false)
  createEffect(() => {
    if (placeRestored() || !startup.restored()) return
    untrack(() => {
      const urlTask = params.taskId ? tasks.data?.find((task) => task.id === params.taskId) : undefined
      if (urlTask) activateTaskSignals(urlTask)
      const all = workspaces.data ?? []
      const ws = activeWorkspace()
        ?? all.find((candidate) => candidate.id === startup.lastWorkspaceId() && candidate.projects.length)
        ?? all.find((candidate) => candidate.projects.length)
      if (ws) openWorkspaceView(ws)
    })
    setPlaceRestored(true)
  })

  // The route is the authority for what actually opened. Wait until the saved pair and the startup
  // destination have both landed, or a transient first route would displace the previous workspace.
  createEffect(() => {
    if (!placeRestored()) return
    const ws = activeWorkspace()
    if (ws) noteWorkspaceVisit(ws.id)
  })

  // Record what each workspace is showing as you move, so the one open when the window closes
  // already knows its own view. The same effect handles a switch: the route moves before the
  // selection does, so a separate recorder could write the old workspace's source into the new
  // one's memory before the switch read it.
  let enteredWorkspaceId: string | undefined
  createEffect(on(
    [activeWorkspace, selectedSource, activeTask, () => location.pathname, placeRestored],
    ([ws, , , , ready]) => {
      if (!ws || !ready) return
      if (enteredWorkspaceId && enteredWorkspaceId !== ws.id) openWorkspaceView(ws)
      enteredWorkspaceId = ws.id
      // Read again rather than taken from the arguments, because opening the workspace may have
      // just changed them.
      const view = viewToRemember(ws, selectedSource(), activeTask(), location.pathname)
      if (view) rememberWorkspaceView(ws.id, view)
    },
  ))

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

  // The project picker appears where choosing a project changes something: a source that declared
  // itself project-scoped, or a task view, where it is the only thing naming the task's project
  // (`/t/:taskId` carries no projectId, so the breadcrumb shows the brand instead). On Home it used to
  // sit there looking like navigation and move nothing but the breadcrumb.
  //
  // Through `sourceIsProjectScoped` rather than a local check, so a palette command that switches
  // project can ask the same question and the two can never disagree.
  const showProjectPicker = () => scopedProjects().length > 0
    && (inTaskView() || sourceIsProjectScoped(selectedSource()))

  const rightSlotRef = mintSlotRef()
  const topbarProps = (): TopbarProps => {
    const active = activeNodeId()
    const project = scopedProjects().find((candidate) => candidate.id === contextProjectId())
    const breadcrumb: { label: string; route?: string }[] = []
    if (params.projectId) {
      breadcrumb.push({ label: projects.data?.find((candidate) => candidate.id === params.projectId)?.name ?? params.projectId,
        route: projectPath(params.projectId) })
      if (params.number) breadcrumb.push({ label: `#${params.number}` })
      if (isNew()) breadcrumb.push({ label: 'new' })
    }
    return {
      workspace: activeWorkspace() ? { id: activeWorkspace()!.id, label: activeWorkspace()!.name } : null,
      workspaces: fleetWorkspaces().entries.map((entry) => ({
        id: entry.workspace.id, label: entry.workspace.name, nodeId: entry.nodeId,
        nodeLabel: entry.node.label, projectCount: entry.workspace.projects.length,
      })),
      project: project ? { id: project.id, label: project.name } : null,
      projects: scopedProjects().map((entry) => ({ id: entry.id, label: entry.name })),
      projectPickerVisible: showProjectPicker(),
      projectPickerDisabled: !selectedSource() && !!activeTask(),
      breadcrumb,
      node: active ? { id: active, label: nodes().find((entry) => entry.nodeId === active)?.label ?? active, state: nodeState(active) } : null,
      nodes: nodes().map((entry) => ({ id: entry.nodeId, label: entry.label, state: nodeState(entry.nodeId) })),
      account: null,
      railCollapsed: railCollapsed(),
      slots: { right: rightSlotRef },
      pickWorkspace: (id, nodeId) => {
        const entry = fleetWorkspaces().entries.find((candidate) => candidate.workspace.id === id && candidate.nodeId === nodeId)
        if (entry) selectFleetWorkspace(entry, navigate)
      },
      pickProject: (id) => {
        if (!scopedProjects().some((candidate) => candidate.id === id)) return
        if (!selectedSource()) {
          const source = defaultSourceId()
          if (source) setSelectedSource(source)
        }
        navigate(projectPath(id))
      },
      pickNode: (id) => { if (nodes().some((candidate) => candidate.nodeId === id)) setActiveNode(id) },
      openSettings: () => openSettings(),
      collapseRail: toggleRail,
      navigate: (route) => { if (breadcrumb.some((item) => item.route === route)) navigate(route) },
      clearCache: () => clearCache(queryClient),
    }
  }
  const coreTopbar = registerCoreExclusiveSlot('topbar', Topbar)
  onCleanup(() => coreTopbar.dispose())

  // The source on screen, when it has something to draw. A source that contributed neither a component
  // nor regions is a rail row and nothing else, and the Switch's empty state below is the honest
  // answer for it — which is what asking for `?.component` used to get us before `regions` existed.
  const drawnSource = () => {
    const source = sourceRegistry.get(selectedSource() ?? '')
    return source && (source.component || source.regions) ? source : undefined
  }

  // New-task mode: core's own route, so the pattern is a constant rather than a registry lookup.
  const newMatch = useMatch(() => CREATE_TASK_ROUTE)
  const isNew = () => !!newMatch()

  // The gate covers the helper's fleet selection and the supervised local node's first connection
  // (docs/frontend.md § Startup readiness). That keeps pane-owned resources from issuing requests
  // before their routes exist. The `isRestoring` gate stays too: it is an IndexedDB read, and painting
  // in front of it would show the empty shell and then fill it.
  return (
    <Show when={!nodeGateHolds() && !isRestoring()} fallback={<NodeGate />}>
    <div class="shell">
    <header class="topbar-host">
      <ExclusiveSlotHost slot="topbar" value={topbarProps()}
        nestedSlots={[{ ref: rightSlotRef, render: () => <SlotHost slot="topbar.right" context={slotContext()} /> }]} />
    </header>
    <div class="shell-body">
    <TabRail />
    <div class="app">
      <Switch fallback={<main class="panes panes-empty"><Acorn /></main>}
      >
        <Match when={drawnSource()}>
          {(source) => <SourceSurface source={source()} />}
        </Match>
        <Match when={!selectedSource() && activeTask()}>
          {/* Key by identity so task metadata refreshes do not remount its panes. `taskForView` holds
              the last non-null row until this keyed scope and its command matchers have disposed. */}
          <Show keyed when={activeTaskId()}>
            {(_taskId) => (
              <TaskView
                task={taskForView()!}
                terminalOpen={termOpen()}
                onToggleTerminal={() => void toggleTerm()}
                onOpenTerminal={() => { if (!termOpen()) void toggleTerm() }}
              />
            )}
          </Show>
        </Match>
      </Switch>
      {/* Settings covers the task, so the task's own chords stand down while it is open: a pane chord
          would act on a surface nobody can see, and could move focus into a terminal under the layer. */}
      <KeybindingDispatcher prefs={prefs.data ?? {}} taskActive={inTaskView() && !settingsRequest()} focusedPane={focusedPane(activeTaskId())} />
      {/* The active bindings, read back out of the keymap's own catalog. Mounted here rather than
          from the dispatcher because `registries/keybindings.ts` is deliberately `.ts` and may not
          hold markup. */}
      <CheatSheet />
      {/* A referenced item from another provider, opened by any surface that renders content
          (client-core/host/registries/panes/refPanels.ts). Mounted at the shell because the state is the shell's.
          Before this, the only place in the app that could open one was github's PR conversation. */}
      <RefPanelHost />
      <Show when={settingsRequest()}>
        {(request) => <Portal><SettingsView request={request()} onClose={() => setSettingsRequest(null)} /></Portal>}
      </Show>
      {/* After settings, so a confirmation a settings page asks for paints above the layer that asked. */}
      <WillConfirmationHost />
      {/* The terminal drawer arrives as a contribution (plugins/terminal's drawerContribution.tsx). The
          shell still owns the per-task `terminalOpen` flag, which the tab rail and topbar badge read
          too, and passes it through slotContext; it no longer knows what fills the drawer. Order
          matters: this host sits before the overlay host, so a dialog still paints above the drawer. */}
      <SlotHost slot="drawer" context={slotContext()} />
      <SlotHost slot="overlay" context={slotContext()} />
    </div>
    </div>
    <Portal><Tips /></Portal>
    {/* One transient-feedback stack for the whole app, frames included. The bridge's ui.toast
        lands here too. */}
    <Portal><ToastHost /></Portal>
    </div>
    </Show>
  )
}
