import { Portal } from 'solid-js/web'
// The desktop's own chrome, and why it is here rather than in client-core: it is the arrangement, not
// the parts. Routing and the overlay slots are what this composition root decides. The topbar and rail
// are exclusive slots it fills with core's provider or a device plugin's (docs/frontend.md).
import {
  createEffect,
  createMemo,
  createSignal,
  lazy,
  Match,
  on,
  onCleanup,
  onMount,
  Show,
  Switch,
  untrack,
} from 'solid-js'
import { createQuery, useIsRestoring, useQueryClient } from '@tanstack/solid-query'
import { useLocation, useMatch, useNavigate, useParams } from '@solidjs/router'
import {
  integrationsOptions,
  prefsOptions,
  type Project,
  projectsKey,
  projectsOptions,
  type Task,
  tasksKey,
  tasksOptions,
  type Workspace,
  workspacesOptions,
} from '@acorn/client-core/infra/queries.ts'
import { setProjectsLookup } from '@acorn/client-core/features/projects/projectLookup.ts'
import { setTaskLookup } from '@acorn/client-core/features/tasks'
import {
  addProjectFromFolder,
  canAddProjectFromFolder,
  createFleetWorkspaces,
  createProjectAddNavigation,
  createWorkspacesMode,
  noProjectsScreenVisible,
  onboardingWizardVisible,
  noteWorkspaceVisit,
  planWorkspaceViewTransition,
  selectFleetWorkspace,
  workspaceWords,
  viewToRemember,
  workspaceForProject,
  workspaceOwnsPath,
} from '@acorn/client-core/features/workspaces'
import { initSoundNotices } from '@acorn/client-core/features/notifications'
import { sessionSummaries } from '@acorn/client-core/features/tasks'
import { workspaceRailShown } from '@acorn/client-core/features/workspaces/workspaceRailPrefs.ts'
import TabRail from '@acorn/client-core/features/tabs/TabRail.tsx'
import Tips from '@acorn/client-core/kit/components/overlays/tips.tsx'
import { ToastHost } from '@acorn/client-core/features/notifications/ToastHost.tsx'
import {
  activeTaskId,
  focusedPane,
  isTerminalMax,
  isTerminalOpen,
  rememberWorkspaceView,
  selectedSource,
  setMaximizedPane,
  setSelectedSource,
  setTerminalMax,
  setTerminalOpen,
  toggleFocusedPaneMax,
  workspaceView,
} from '@acorn/client-core/features/tasks/tasks.ts'
import { isTerminalTarget } from '@acorn/client-core/host/keys'
import { activateTaskSignals, pathForTask } from '@acorn/client-core/features/tasks/activate.ts'
import { desktopExtras } from '@acorn/client-core/infra/platform'
import {
  activeNodeId,
  activeNodeStarting,
  nodeGateHolds,
  nodeReadiness,
  nodeReady,
  selectActiveNode,
  setActiveNode,
} from '@acorn/client-core/infra/node/activeNode.ts'
import { nodes, nodeState } from '@acorn/client-core/infra/node/fleet.ts'
import { warnOnceAboutDisk } from '@acorn/client-core/infra/node'
import { applyNodePlugins, clientPlugins, clientPluginsReady, retryClientPlugins } from './activate'
import { createLogger, openFeature } from '@acorn/client-core/infra/telemetry'
import { registerAddressHostWhenReady } from './addressHostRegistration'
import { ContributionBoundary } from '@acorn/client-core/kit/components/content/ContributionBoundary.tsx'
import { clearCache } from './clearCache'
import { topbarBreadcrumb } from './breadcrumb'
import TaskView from './TaskView'
import Acorn from '@acorn/client-core/kit/components/content/Acorn.tsx'
import { clientEvents } from '@acorn/client-core/host/registries/commands'
import { registerCommands } from '@acorn/client-core/host/registries/commands'
import {
  appearanceCommands,
  notificationCommands,
  settingsPageCommands,
} from '@acorn/client-core/host/registries/commands'
import { KeybindingDispatcher, registerKeybindings } from '@acorn/client-core/host/registries/commands'
import { CheatSheet } from '@acorn/client-core/host/keys/CheatSheet.tsx'
import {
  confirmWillEvent,
  registerWillHandler,
  WillConfirmationHost,
} from '@acorn/client-core/host/registries/shell/willPhase.tsx'
import { taskBridge } from '@acorn/client-core/features/tasks'
import { RefPanelHost } from '@acorn/client-core/host/registries/panes/refPanelHost.tsx'
import { createLinkPreviewBoundary } from '@acorn/client-core/host/linkPreview/linkPreview.ts'
import { LinkPreviewHost } from '@acorn/client-core/host/linkPreview/LinkPreviewHost.tsx'
import { SlotHost } from '@acorn/client-core/host/registries/extensionPoints/uiSlots.tsx'
import type { UiSlotContext } from '@acorn/client-core/host/registries/extensionPoints/slots.ts'
import { createAppStartupRestore } from '@acorn/client-core/infra/persistence'
import { createTaskDeepLink } from '@acorn/client-core/features/tasks'
import { defaultSourceId, sourceIsProjectScoped, sourceRegistry } from '@acorn/client-core/host/registries/sources'
import { SourceSurface } from '@acorn/client-core/host/registries/sources/SourceSurface.tsx'
import {
  CREATE_TASK_ROUTE,
  copyLink,
  projectPath,
  sourcePlaceFromPath,
  taskPlace,
  type Place,
} from '@acorn/client-core/host/registries/commands'
import { availableSources } from '@acorn/client-core/features/tabs'
import { createSourceScope } from '@acorn/client-core/features/tabs'
import { setTelemetryEnabled } from '@acorn/client-core/infra/telemetry/emitter.ts'
import { emitBootSpans } from './boot'
import { claimStartupAccount, emitStartupMilestones, markShellDrawn } from './startupMilestones'
import { createStartupStage, stageHoldsShell } from './startupStage'
import StartupScreen from './StartupScreen'
import { telemetryOn } from '@acorn/client-core/features/settings'
import type { TopbarProps } from '@acorn/protocol/chrome.ts'
import Topbar from '@acorn/client-core/host/chrome/Topbar.tsx'
import ExclusiveSlotHost from '@acorn/client-core/host/plugins/ExclusiveSlotHost.tsx'
import { mintSlotRef } from '@acorn/client-core/host/plugins/NestedChromeSlot.tsx'
import { registerCoreExclusiveSlot } from '@acorn/client-core/host/registries/extensionPoints'
import { PrefKeys } from '@acorn/client-core/infra/persistence'
import { savePref } from '@acorn/client-core/features/settings/savePref.ts'
import type { SettingsRequest } from '@acorn/client-core/features/settings/SettingsView.tsx'
import { isPanelStudioOpen } from '@acorn/client-core/features/dashboards/studio/studioOpen.ts'

// The shell is the startup path. Heavy/conditional surfaces stay behind their actual
// navigation intent so the editor, xterm, Shiki/diff rendering, settings plugins, and onboarding do not
// compete with the first interactive paint.
const SettingsView = lazy(() => import('@acorn/client-core/features/settings/SettingsView.tsx'))
const NoProjects = lazy(() => import('@acorn/client-core/features/workspaces/NoProjects.tsx'))
const WorkspaceRail = lazy(() =>
  import('@acorn/client-core/features/workspaces/WorkspaceRail.tsx').then((module) => ({
    default: module.WorkspaceRail,
  })),
)
// Opened by an acorn:// link that promotes an item. Its code arrives in a few milliseconds from the app
// bundle, so it has no placeholder; a failed import draws the boundary's Try again below.
const PromoteToTaskModal = lazy(() =>
  import('@acorn/client-core/features/integrations/PromoteToTaskModal.tsx').then((module) => ({
    default: module.PromoteToTaskModal,
  })),
)

// The Router root: the top bar, the rails, and a content region that draws the selected source or the
// active task. Routes render nothing themselves; they exist to populate params.
export default function App() {
  const linkLog = createLogger('links')
  const queryClient = useQueryClient()
  const mountedNodeId = activeNodeId()
  const params = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const isRestoring = useIsRestoring()
  // Settings: a full-window layer over the shell, not a route, so the workspace under it stays mounted.
  // `null` is closed. A request is a fresh object per
  // call, so a deep link that arrives while settings is open still navigates. With no target it opens on
  // the last page used; a target is `settings/<pageId>#<sectionId>` or a bare page id.
  const [settingsRequest, setSettingsRequest] = createSignal<SettingsRequest | null>(null)
  const [settingsLink, setSettingsLink] = createSignal<{
    nodeId: string
    place: Extract<Place, { kind: 'settings' }>
  } | null>(null)
  const [linkPromotion, setLinkPromotion] = createSignal<{
    projectId: string
    sourceId: string
    item: unknown
    itemTitle: string
  } | null>(null)
  // Settings' opening record starts at the request rather than in SettingsView, so a first opening
  // also counts loading the view's code (docs/telemetry/renderer.md § Feature openings).
  let cancelSettingsOpening = () => {}
  onCleanup(() => cancelSettingsOpening())
  const openSettings = (target?: string): void => {
    if (!settingsRequest())
      cancelSettingsOpening = openFeature('settings', 'core', { kind: 'settings', reportsUsable: true })
    setSettingsRequest(target ? { target } : {})
  }
  // Panes deep-link here rather than receiving an `openSettings` prop: the layer is the shell's, and
  // threading a callback through every pane that might ever want one is worse than one event.
  onMount(() => onCleanup(clientEvents.on('presentation:open-settings', ({ tab }) => openSettings(tab))))
  // The terminal drawer belongs to a task, not the app: it's shown only in the Task view (a Source
  // browse like Pull requests has no terminal) and its open/closed state is tracked per task, so
  // switching tabs swaps it. `termOpen` reflects the active task's state within the Task view.
  const inTaskView = () => !selectedSource() && !!activeTask()
  const visibleLinkPlace = (): Extract<Place, { kind: 'task' | 'project' | 'source' }> | null => {
    if (inTaskView()) {
      const task = activeTask()!
      return taskPlace(task, focusedPane(task.id))
    }
    const source = selectedSource()
    if (!source) return null
    return isNew() ? null : sourcePlaceFromPath(location.pathname, source, sourceIsProjectScoped(source))
  }
  const copyVisibleLink = () => {
    if (settingsRequest()) {
      const settings = settingsLink()
      if (settings) void copyLink(settings.nodeId, settings.place)
      return
    }
    const place = visibleLinkPlace()
    if (place) void copyLink(activeNodeId(), place)
  }
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
  // client-core's module-level task lookup needs (`setTaskLookup` states why it cannot reach either
  // itself). Installed before anything is clickable, so a content-link click can ask whether a
  // pane is available on the task it names rather than claiming the event and rendering nothing.
  setTaskLookup((taskId) => queryClient.getQueryData<Task[]>(tasksKey)?.find((task) => task.id === taskId))
  // Same argument, one entity over: a content-link path resolver asks whether an external URL names a
  // repo acorn tracks, and only the project rows know.
  setProjectsLookup(() => queryClient.getQueryData<Project[]>(projectsKey) ?? [])

  // Shell-owned commands are registered once; the single dispatcher below owns the only global
  // keydown listener. Maximize is focus-directed and never enters persisted TaskLayout state.
  onMount(() => {
    const commands = registerCommands([
      {
        id: 'core.copy-link',
        title: 'Copy link',
        category: 'action',
        palette: true,
        when: () => (settingsRequest() ? !!settingsLink() : !!visibleLinkPlace()),
        run: copyVisibleLink,
      },
      {
        id: 'core.settings.open',
        title: 'Open settings',
        hint: 'on the page you used last',
        category: 'navigation',
        palette: true,
        run: () => openSettings(),
      },
      {
        id: 'core.project.add',
        title: 'Add project',
        hint: 'from a folder',
        category: 'workspace',
        palette: true,
        when: () => canAddProjectFromFolder() && !!workspaceMode(),
        run: () => {
          const mode = workspaceMode()
          if (mode) void addProjectFromFolder(queryClient, mode, mode === 'on' ? activeWorkspace()?.id : undefined)
        },
      },
      { id: 'core.rail.toggle', title: 'Toggle rail', category: 'navigation', run: () => toggleRail() },
      {
        id: 'core.surface.toggle-maximize',
        title: 'Toggle focused surface maximize',
        category: 'pane',
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
      {
        id: 'core.settings.open',
        command: 'core.settings.open',
        description: 'Open settings',
        category: 'Global',
        defaultChord: 'meta+,',
        when: 'global',
      },
      {
        id: 'core.rail.toggle',
        command: 'core.rail.toggle',
        description: 'Toggle rail',
        category: 'Global',
        defaultChord: 'meta+b',
        when: 'global',
      },
      {
        id: 'core.surface.toggle-maximize',
        command: 'core.surface.toggle-maximize',
        description: 'Maximize or restore the focused pane',
        category: 'Panes',
        defaultChord: 'meta+shift+enter',
        when: 'task',
      },
      // The command is the palette's own Last workspace row, registered with the rest of the Go to
      // group (client-core/host/registries/commands/navigationCommands.ts); this is the chord that reaches it.
    ])
    createEffect(() => {
      const description = `Switch to the last ${workspaceWords(workspaceMode()).singular}`
      const binding = registerKeybindings([
        {
          id: 'core.goto.workspace-last',
          command: 'core.goto.workspace-last',
          description,
          category: 'Global',
          defaultChord: 'meta+;',
          when: 'global',
        },
      ])
      onCleanup(() => binding.dispose())
    })
    // The two settings core owns, as bounded choices with the current value marked. Both write through
    // the same accessors Settings → Appearance and Settings → Notifications call, so there is one
    // persistence path per value and not two.
    //
    // Registered here rather than in client-core because this app is what contributes those pages: a
    // host with no Appearance page has nothing for an Appearance command to agree with.
    const settings = registerCommands([...appearanceCommands(queryClient), ...notificationCommands(queryClient)])
    onCleanup(() => {
      settings.dispose()
      bindings.dispose()
      commands.dispose()
    })
  })

  // One row per registered Settings page, rebuilt when the roster changes: a plugin contributes pages,
  // so a list taken once would go stale the moment one loads or is disabled.
  createEffect(() => {
    const pages = registerCommands(settingsPageCommands(openSettings, workspaceMode()))
    onCleanup(() => pages.dispose())
  })

  onMount(() => {
    // The client's only archive producer, and it produces nothing of its own: it asks the node, which
    // is where every plugin declares what it has to say about archiving a task.
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
      })),
    )
    // Quitting has no node meaning: a node does not know a window is closing, so this one stays a
    // client handler over the session store.
    const offQuit = registerWillHandler('app:quit', 'Terminal', () => {
      const active = sessionSummaries().filter((session) => session.running)
      return active.length
        ? {
            id: 'sessions:all',
            feature: 'Terminal',
            message: `${active.length} terminal${active.length === 1 ? ' is' : 's are'} still running`,
            severity: 'warn',
          }
        : null
    })
    onCleanup(() => {
      offQuit()
      offNode()
    })
  })
  onMount(() => {
    const off = desktopExtras()?.onWillQuit(
      async () =>
        (
          await confirmWillEvent({
            kind: 'app:quit',
            payload: {},
            title: 'Quit acorn',
            actionLabel: 'Quit',
          })
        ).confirmed,
    )
    if (off) onCleanup(off)
  })

  // The sound channel. Every unseen notice the gate lets through, whatever raised it. The workflow and
  // system channels are the shared runtime's.
  onMount(() => onCleanup(initSoundNotices()))

  // Which plugins the node this shell is showing runs.
  //
  // Not `on(activeNodeId, …, { defer: true })`, which never fires. index.tsx mounts App inside a
  // `<Show keyed>` on the active node, so a switch disposes this component and builds a new one: the
  // fresh effect records the new node and defers, and the dying one is disposed during Solid's pure
  // pass before user effects flush. A plain effect reading the signal runs once on mount, which is once
  // per node. The duplicate for the first node is a no-op: `applyNodePlugins` skips a node whose list
  // it has already applied.
  //
  // Re-reads on the node's connection state as well as its identity, which is what makes it a retry.
  // The boot attempt in index.tsx starts before the local node is up and can fail against nothing
  // listening; `applyNodePlugins` leaves itself unapplied when the node did not answer, so this runs
  // again after the startup gate releases. `offline` is skipped because a request then cannot succeed.
  createEffect(() => {
    const nodeId = activeNodeId()
    if (nodeId && nodeState(nodeId) !== 'offline') void applyNodePlugins(nodeId)
  })

  // The one-time disk-encryption warning (docs/security/audit.md § Filesystem and backup: "the app surfaces a one-time
  // warning if the disk isn't encrypted"). Once per (device, node), which is why it sits here beside the
  // plugin apply rather than at boot: a node the owner pairs later has never been checked, and the same
  // remount that makes the effect above correct makes this one fire for it.
  //
  // `warnOnceAboutDisk` swallows its own failures and records the acknowledgement before pushing, so this
  // can never be the thing that fails a boot or repeats every launch.
  //
  // Gated on `nodeReady()`, because a read that fails counts as "do not warn": asked at mount, before
  // the local node is adopted, the warning would never run.
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
  const prefs = createQuery(() => prefsOptions(nodeReady()))
  // The startup restore waits for the node's own answer, so ask for it every time the node becomes
  // reachable. `refetchOnMount` can't do this. On a cold launch the query is still disabled at mount,
  // and enabling it later only fetches once the cached answer is past its stale time. A relaunch
  // inside that window would otherwise never restore.
  createEffect(on(createMemo(nodeReady), (ready) => void (ready && prefs.refetch())))
  const workspaceMode = createWorkspacesMode()
  const mountedAt = Date.now()
  const integrations = createQuery(() => integrationsOptions(nodeReady()))
  const projects = createQuery(() => projectsOptions(nodeReady()))
  const tasks = createQuery(() => tasksOptions(nodeReady()))
  const workspaces = createQuery(() => workspacesOptions(nodeReady()))
  const showNoProjects = () =>
    noProjectsScreenVisible({
      projectCount: projects.data?.length,
      projectsError: projects.isError,
      wizardVisible: onboardingWizardVisible(),
    })
  // Drawers mount in a body portal, so shell geometry must also reach those siblings.
  createEffect(() =>
    document.documentElement.style.setProperty(
      '--left-rails-w',
      showNoProjects() ? '0px' : workspaceRailShown(prefs.data) ? 'calc(2 * var(--tabrail-w))' : 'var(--tabrail-w)',
    ),
  )
  onCleanup(() => document.documentElement.style.removeProperty('--left-rails-w'))
  const openAddedProject = (id: string) => {
    const source = defaultSourceId()
    if (source) setSelectedSource(source)
    navigate(projectPath(id))
  }
  const beginProjectAdd = createProjectAddNavigation({
    nodeId: activeNodeId,
    pathname: () => location.pathname,
    settingsOpen: () => !!settingsRequest(),
    openProject: openAddedProject,
  })
  const railCollapsed = () => prefs.data?.[PrefKeys.leftCollapsed] === 'true'
  const toggleRail = () => void savePref(queryClient, PrefKeys.leftCollapsed, String(!railCollapsed()))

  const startup = createAppStartupRestore({
    queryClient,
    prefs: () => prefs.data,
    // Timestamps rather than `isFetchedAfterMount`, which also counts the cache arriving from IndexedDB
    // after this component subscribed. A failed fetch counts, and so does a node known to be offline:
    // in both the cache is all there is.
    prefsSettled: () =>
      Math.max(prefs.dataUpdatedAt, prefs.errorUpdatedAt) >= mountedAt ||
      (!nodeGateHolds() && nodeState(activeNodeId() ?? '') === 'offline'),
    cacheRestoring: isRestoring,
    contributionsReady: clientPluginsReady,
    projects: () => projects.data,
    tasks: () => tasks.data,
    workspaces: () => workspaces.data,
  })

  // `/t/:taskId?pane=…&item=…`: open a pane on a selected item, once, then strip the params
  // (`createTaskDeepLink`).
  createTaskDeepLink({
    taskId: () => (startup.restored() ? activeTaskId() : null),
    search: () => location.query,
    navigate,
  })

  const activeTask = () => tasks.data?.find((w) => w.id === activeTaskId()) ?? null
  // TaskView registers callbacks with the keymap, whose layer can still be evaluated while Solid is
  // disposing the view. Keep the last row available for that teardown tick after an archive removes
  // it from the query. Rendering still gates on `activeTask()` below, so a missing row is never shown.
  // Retaining the row instead of keying on the whole object also avoids remounting every pane when a
  // refetch changes task metadata without changing which task is open.
  const taskForView = createMemo<Task | null>((previous) => activeTask() ?? previous ?? null)
  // Which project the shell is "in". The generic task route (`/t/:taskId`) carries no projectId, so
  // without the task fallback the workspace and project pickers go blank the moment you open a task,
  // and the per-workspace view memory below never sees a workspace change.
  const contextProjectId = () => params.projectId ?? activeTask()?.projectId
  // Links on a project's own surfaces preview against the project. A task's panes claim their links
  // first, with the task's scope.
  const sourceLinkPreviews = createLinkPreviewBoundary(() => {
    const projectId = contextProjectId()
    return projectId ? { projectId } : {}
  })
  // Active workspace is derived from the current project, from the active node's list: the route
  // carries no node, so the workspace on screen is whichever one the active node has for this repo.
  //
  // A memo, and one that holds its last answer, for two reasons that both belong to the transition
  // effect below.
  //
  // `on` re-fires on identity, not on value, so keying it on a plain derivation would re-plan the whole
  // workspace change on every tasks, projects or params tick.
  //
  // And the derivation reports nothing for a beat in ordinary use: while the workspaces query is
  // cold, and between a task path and its task row landing. `on` would record that nothing as the
  // workspace we were leaving, and the guard below would then drop the next real switch, so the last
  // view would fail to come back. Holding the last known workspace also stops the topbar pickers and
  // the rail's scope blinking through the same gap.
  const activeWorkspace = createMemo<Workspace | null>(
    (previous) => workspaceForProject(workspaces.data, contextProjectId()) ?? previous ?? null,
  )
  const sourceScope = createSourceScope(() => activeWorkspace()?.id, nodeReady)

  // The one switch, read off the node and handed to the client's emitter (docs/telemetry/model.md § The
  // switch). An effect rather than a call at boot, because the preference arrives after the first
  // paint and can change while the app is open: the node's collector re-reads its own copy every
  // five seconds, and this is the renderer's half of the same promise. The boot account waits for the
  // switch as well as for the node, so this is one of the two places that can release it (./boot.ts).
  createEffect(() => {
    const on = telemetryOn(prefs.data)
    setTelemetryEnabled(on)
    if (on) {
      emitBootSpans()
      emitStartupMilestones()
    }
  })

  let explicitProjectPath: string | undefined

  // Whatever source was selected has to still be on offer. A workspace switch can take one away:
  // a browse source only appears where its provider is connected and the workspace links one of its
  // projects, and neither is a fact about the source alone.
  createEffect(() => {
    const current = selectedSource()
    const connected = integrations.data?.integrations
    if (!current || !connected) return
    // The linked source may belong to the workspace we are entering, not the one still on screen.
    const workspace = activeWorkspace()
    if (explicitProjectPath && (!workspace || !workspaceOwnsPath(workspace, explicitProjectPath))) return
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
      explicitProjectPath: explicitProjectPath === location.pathname ? explicitProjectPath : undefined,
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
  // The launch's restored and usable milestones (./startupMilestones.ts). They belong to the first Node
  // whose shell restores. A later switch to another Node drops any that weren't sent.
  const startupAccount = claimStartupAccount(mountedNodeId)
  createEffect(() => {
    if (placeRestored() || !startup.restored()) return
    untrack(() => {
      const urlTask = params.taskId ? tasks.data?.find((task) => task.id === params.taskId) : undefined
      if (urlTask) activateTaskSignals(urlTask)
      const all = workspaces.data ?? []
      const ws =
        activeWorkspace() ??
        all.find((candidate) => candidate.id === startup.lastWorkspaceId() && candidate.projects.length) ??
        all.find((candidate) => candidate.projects.length)
      if (ws) openWorkspaceView(ws)
    })
    setPlaceRestored(true)
    startupAccount.restored()
  })

  // Where the launch is, for the startup screen and the content region (./startupStage.ts). The reads
  // are the ones the restore waits on: without them it can't choose where to land.
  const initialReads = [prefs, projects, tasks, workspaces]
  const stage = createStartupStage(
    () => {
      const missing = initialReads.filter((query) => query.data === undefined)
      return {
        node: nodeReadiness(),
        nodeStarting: activeNodeStarting(),
        nodeOffline: nodeState(activeNodeId() ?? '') === 'offline',
        plugins: clientPlugins(),
        cacheRestoring: isRestoring(),
        restored: placeRestored(),
        readsMissing: missing.length > 0,
        readError: missing.find((query) => query.isError)?.error ?? undefined,
      }
    },
    (step) => startupAccount.stopped(step, step === 'offline' ? 'offline' : 'error'),
  )
  createEffect(() => {
    if (!stageHoldsShell(stage())) markShellDrawn()
  })
  // Each failure retries the thing that failed: the fleet selection, the roster, or the missing reads.
  const retryStartup = () => {
    const current = stage()
    if (current.kind === 'failed' && current.step === 'node') void selectActiveNode()
    else if (current.kind === 'failed' && current.step === 'registration') retryClientPlugins()
    else for (const query of initialReads) if (query.data === undefined) void query.refetch()
  }

  // A linked project chooses its own route and source. Keep that choice when the route enters a
  // workspace whose remembered view points elsewhere; ordinary workspace-picker changes still
  // restore their remembered view.
  createEffect(() => {
    if (!mountedNodeId || !placeRestored() || !clientPluginsReady()) return
    const unregister = registerAddressHostWhenReady(
      {
        nodeId: mountedNodeId,
        navigate: (path) => navigate(path),
        openProject: (path, source) => {
          setLinkPromotion(null)
          explicitProjectPath = path
          setSelectedSource(source)
          navigate(path)
        },
        openTask: (taskId, path, linkedTask) => {
          setLinkPromotion(null)
          const task = linkedTask ?? tasks.data?.find((candidate) => candidate.id === taskId)
          if (!task) return false
          if (linkedTask)
            queryClient.setQueryData<Task[]>(tasksKey, (current = []) =>
              current.some((candidate) => candidate.id === linkedTask.id)
                ? current.map((candidate) => (candidate.id === linkedTask.id ? linkedTask : candidate))
                : [...current, linkedTask],
            )
          activateTaskSignals(task)
          navigate(path)
          return true
        },
        hasProject: (projectId) =>
          !!queryClient.getQueryData<Project[]>(projectsKey)?.some((project) => project.id === projectId),
        loadProjects: async () => {
          await queryClient.ensureQueryData(projectsOptions(true))
        },
        showPromotion: setLinkPromotion,
      },
      (error) => linkLog.warn('Could not prepare loaded plugin routes for an Acorn link', error),
    )
    onCleanup(unregister)
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
  createEffect(
    on([activeWorkspace, selectedSource, activeTask, () => location.pathname, placeRestored], ([ws, , , , ready]) => {
      if (!ws || !ready) return
      if (enteredWorkspaceId && enteredWorkspaceId !== ws.id) openWorkspaceView(ws)
      if (explicitProjectPath === location.pathname && workspaceOwnsPath(ws, location.pathname)) {
        explicitProjectPath = undefined
      }
      enteredWorkspaceId = ws.id
      // Read again rather than taken from the arguments, because opening the workspace may have
      // just changed them.
      const view = viewToRemember(ws, selectedSource(), activeTask(), location.pathname)
      if (view) rememberWorkspaceView(ws.id, view)
    }),
  )

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
  // itself project-scoped. A task's project cannot change, so the task view names it in the
  // breadcrumb instead. Elsewhere, such as Home, the picker would look like navigation and move
  // nothing but the breadcrumb.
  //
  // Through `sourceIsProjectScoped` rather than a local check, so a palette command that switches
  // project can ask the same question and the two can never disagree.
  const showProjectPicker = () => scopedProjects().length > 0 && sourceIsProjectScoped(selectedSource())

  const rightSlotRef = mintSlotRef()
  const topbarProps = (): TopbarProps => {
    const active = activeNodeId()
    const empty = showNoProjects()
    const project = empty ? undefined : scopedProjects().find((candidate) => candidate.id === contextProjectId())
    const breadcrumb = topbarBreadcrumb({
      task: inTaskView() ? (activeTask() ?? null) : null,
      params: { projectId: params.projectId, number: params.number },
      isNew: isNew(),
      projectScoped: sourceIsProjectScoped(selectedSource()),
      pathname: location.pathname,
      projectName: (id) => projects.data?.find((candidate) => candidate.id === id)?.name ?? id,
      projectRoute: projectPath,
    })
    return {
      workspacesMode: workspaceMode() ?? null,
      workspacePickerVisible: !workspaceRailShown(prefs.data),
      workspace:
        !empty && activeWorkspace()
          ? { id: activeWorkspace()!.id, label: activeWorkspace()!.name, appearance: activeWorkspace()!.appearance }
          : null,
      workspaces: fleetWorkspaces().entries.map((entry) => ({
        id: entry.workspace.id,
        label: entry.workspace.name,
        appearance: entry.workspace.appearance,
        nodeId: entry.nodeId,
        nodeLabel: entry.node.label,
        projectCount: entry.workspace.projects.length,
      })),
      project: project ? { id: project.id, label: project.name } : null,
      projects: empty ? [] : scopedProjects().map((entry) => ({ id: entry.id, label: entry.name })),
      projectPickerVisible: workspaceMode() === 'on' && showProjectPicker(),
      projectPickerDisabled: false,
      breadcrumb,
      node: active
        ? {
            id: active,
            label: nodes().find((entry) => entry.nodeId === active)?.label ?? active,
            state: nodeState(active),
          }
        : null,
      nodes: nodes().map((entry) => ({ id: entry.nodeId, label: entry.label, state: nodeState(entry.nodeId) })),
      account: null,
      canAddProject: !!workspaceMode() && canAddProjectFromFolder(),
      slots: { right: rightSlotRef },
      pickWorkspace: (id, nodeId) => {
        const entry = fleetWorkspaces().entries.find(
          (candidate) => candidate.workspace.id === id && candidate.nodeId === nodeId,
        )
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
      pickNode: (id) => {
        if (nodes().some((candidate) => candidate.nodeId === id)) setActiveNode(id)
      },
      openSettings: () => openSettings(),
      navigate: (route) => {
        if (!breadcrumb.some((item) => item.route === route)) return
        // From a task, the project crumb leaves the task for the project's default source, as picking
        // a project does. The route alone would leave the task on screen.
        if (!selectedSource()) {
          const source = defaultSourceId()
          if (source) setSelectedSource(source)
        }
        navigate(route)
      },
      clearCache: () => clearCache(queryClient),
      addProject: () => {
        const mode = workspaceMode()
        if (mode) void addProjectFromFolder(queryClient, mode, mode === 'on' ? activeWorkspace()?.id : undefined)
      },
      copyLink: visibleLinkPlace()?.kind === 'project' ? copyVisibleLink : undefined,
    }
  }
  const coreTopbar = registerCoreExclusiveSlot('topbar', Topbar)
  onCleanup(() => coreTopbar.dispose())

  // The source on screen, when it has something to draw. A source that contributed neither a component
  // nor regions is a rail row and nothing else, and the Switch's empty state below is the honest
  // answer for it.
  const drawnSource = () => {
    const source = sourceRegistry.get(selectedSource() ?? '')
    return source && (source.component || source.regions) ? source : undefined
  }

  // New-task mode: core's own route, so the pattern is a constant rather than a registry lookup.
  const newMatch = useMatch(() => CREATE_TASK_ROUTE)
  const isNew = () => !!newMatch()

  // The startup screen covers the helper's fleet selection, the supervised local node's first
  // connection, and the roster's registration (docs/frontend/data-and-startup.md § Startup readiness).
  // That keeps pane-owned resources from issuing requests before their routes exist. The query cache's
  // IndexedDB read holds it too, because painting in front of it would show the empty shell and then
  // fill it. Restoring holds only the content region, so the rail and top bar draw as soon as they can.
  return (
    <Show
      when={!stageHoldsShell(stage())}
      fallback={
        <main class="node-gate">
          <StartupScreen stage={stage()} onRetry={retryStartup} />
        </main>
      }
    >
      <div class="shell">
        {/* Install the keymap before chrome collections run their mount callbacks. A rail enabled
          at startup must register its intent layer against the same engine as a later toggle.
          Settings and the panel studio cover the task, so its chords stand down while either is
          open; otherwise they could move focus into a terminal under the layer. */}
        <KeybindingDispatcher
          prefs={prefs.data ?? {}}
          taskActive={inTaskView() && !settingsRequest() && !isPanelStudioOpen()}
          focusedPane={focusedPane(activeTaskId())}
        />
        <header class="topbar-host">
          <ExclusiveSlotHost
            slot="topbar"
            value={topbarProps()}
            nestedSlots={[
              { ref: rightSlotRef, render: () => <SlotHost slot="topbar.right" context={slotContext()} /> },
            ]}
          />
        </header>
        <div class="shell-body">
          <Show when={!showNoProjects()}>
            <Show when={workspaceRailShown(prefs.data)}>
              <WorkspaceRail value={topbarProps()} />
            </Show>
            <TabRail />
          </Show>
          <div class="app" {...sourceLinkPreviews}>
            <Show when={showNoProjects()}>
              <NoProjects beginAdd={beginProjectAdd} />
            </Show>
            <Show when={!showNoProjects()}>
              <Switch
                fallback={
                  <main class="panes panes-empty">
                    <Show when={stage().kind !== 'ready'} fallback={<Acorn />}>
                      <div class="startup-region">
                        <StartupScreen stage={stage()} onRetry={retryStartup} />
                      </div>
                    </Show>
                  </main>
                }
              >
                <Match when={drawnSource()}>{(source) => <SourceSurface source={source()} />}</Match>
                <Match when={!selectedSource() && activeTask()}>
                  {/* Key by identity so task metadata refreshes do not remount its panes. `taskForView` holds
              the last non-null row until this keyed scope and its command matchers have disposed. */}
                  <Show keyed when={activeTaskId()}>
                    {(_taskId) => (
                      <TaskView
                        task={taskForView()!}
                        terminalOpen={termOpen()}
                        onToggleTerminal={() => void toggleTerm()}
                        onOpenTerminal={() => {
                          if (!termOpen()) void toggleTerm()
                        }}
                      />
                    )}
                  </Show>
                </Match>
              </Switch>
            </Show>
            {/* The active bindings, read back out of the keymap's own catalog. Mounted here rather than
          from the dispatcher because the keybindings registry is deliberately `.ts` and may not
          hold markup. */}
            <CheatSheet />
            {/* A referenced item from another provider, opened by any surface that renders content.
          Mounted at the shell because the state is the shell's. */}
            <RefPanelHost />
            <LinkPreviewHost />
            {/* The modal snapshots eligible tasks and used branches when it mounts. Wait for both lists
          before mounting so a cold Node does not offer an empty attachment/branch context. */}
            <Show
              keyed
              when={
                linkPromotion() &&
                params.projectId === linkPromotion()!.projectId &&
                projects.data?.some((project) => project.id === linkPromotion()!.projectId) &&
                tasks.data &&
                workspaces.data
                  ? linkPromotion()
                  : null
              }
            >
              {(promotion) => {
                const projectTasks = (tasks.data ?? []).filter((task) => task.projectId === promotion.projectId)
                const workspaceProjects = new Set(
                  workspaceForProject(workspaces.data, promotion.projectId)?.projects.map((project) => project.id) ??
                    [],
                )
                const ready = (task: Task) => {
                  setLinkPromotion(null)
                  void queryClient.invalidateQueries({ queryKey: tasksKey })
                  activateTaskSignals(task)
                  navigate(pathForTask(task))
                }
                return (
                  <ContributionBoundary contributionId="core:promote-to-task">
                    <PromoteToTaskModal
                      providerId={promotion.sourceId}
                      item={promotion.item}
                      itemTitle={promotion.itemTitle}
                      headerLabel="Create task"
                      attachTasks={(tasks.data ?? []).filter(
                        (task) => task.status === 'active' && workspaceProjects.has(task.projectId),
                      )}
                      existingBranches={projectTasks.flatMap((task) => (task.branch ? [task.branch] : []))}
                      onClose={() => setLinkPromotion(null)}
                      onCreated={ready}
                      onAttached={ready}
                    />
                  </ContributionBoundary>
                )
              }}
            </Show>
            <Show when={settingsRequest()}>
              {(request) => (
                <Portal>
                  <SettingsView
                    request={request()}
                    onClose={() => {
                      cancelSettingsOpening()
                      setSettingsRequest(null)
                      setSettingsLink(null)
                    }}
                    onLinkPlace={setSettingsLink}
                    onCopyLink={copyVisibleLink}
                  />
                </Portal>
              )}
            </Show>
            {/* After settings, so a confirmation a settings page asks for paints above the layer that asked. */}
            <WillConfirmationHost />
            {/* The terminal drawer arrives as a contribution from the terminal plugin. The shell owns
          the per-task `terminalOpen` flag, which the tab rail and topbar badge read too, and passes it
          through slotContext; it doesn't know what fills the drawer. Order matters: this host sits
          before the overlay host, so a dialog still paints above the drawer. */}
            <SlotHost slot="drawer" context={slotContext()} />
            <SlotHost slot="overlay" context={slotContext()} />
          </div>
        </div>
        <Portal>
          <Tips />
        </Portal>
        {/* One transient-feedback stack for the whole app, frames included. The bridge's ui.toast
        lands here too. */}
        <Portal>
          <ToastHost />
        </Portal>
      </div>
    </Show>
  )
}
