/** @jsxImportSource @acorn/tui/jsx */
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
  type Accessor,
  type JSX,
} from 'solid-js'
import { createQuery } from '@tanstack/solid-query'
import type { Renderable } from '../tree/compat'
import type { KeyEvent } from '../keyEvent'
import { prefsOptions } from '@acorn/client-core/infra/queries.ts'
import { WORKSPACES_PREF_KEY, workspacesMode } from '@acorn/protocol/workspacesMode.ts'
import { workspaceWords } from '@acorn/client-core/features/workspaces'
import { registerSourceOpeners } from '@acorn/client-core/features/tabs'
import { nodes } from '@acorn/client-core/infra/node/fleet.ts'
import { activeNodeId } from '@acorn/client-core/infra/node/activeNode.ts'
import { createLogger } from '@acorn/client-core/infra/telemetry'
import { PrefKeys } from '@acorn/client-core/infra/persistence'
import { keymap } from '@acorn/client-core/kit/keys/keymapHost.ts'
import { setActiveItem } from '@acorn/client-core/kit/keys'
import { focusedPane, selectedSource, setSelectedSource } from '@acorn/client-core/features/tasks/tasks.ts'
import { isTerminalOpen, setTerminalOpen } from '@acorn/client-core/features/tasks/tasks.ts'
import {
  buildLink,
  clientEvents,
  registerCommands,
  registerNavigationCommands,
  sourcePlaceFromPath,
  taskPlace,
  type Place,
} from '@acorn/client-core/host/registries/commands'
import { registerKeybindings } from '@acorn/client-core/host/registries/commands'
import { registerNoticeTargetHandler } from '@acorn/client-core/features/notifications'
import { sourceRegistry } from '@acorn/client-core/host/registries/sources'
import { sourceIsProjectScoped } from '@acorn/client-core/host/registries/sources'
import { currentPath } from '../kit/router'
import { copyToTerminal } from '../kit/copy'
import { pendingTerminalTrust } from '@acorn/client-core/host/plugins/distribution.ts'
import { Dynamic } from '../tree/renderer'
import { Line } from '../kit/cells'
import { EmptyState, keyedRows, Row, Rows } from '../kit/showing'
import { Modal, ModalBody } from '../kit/grouping'
import { PanelBody } from '../panel'
import { installCommandLayer } from '../keys/commandLayer'
import {
  focusWithin,
  regionFocus,
  requestRenderableFocus,
  scheduleSettle,
  setPaneCycler,
  setTopology,
} from '../keys/regions'
import { itemByIdentity } from '../keys/collectionRegistry'
import { startSpinner } from '../kit/tick'
import { createShellModel, type ShellModel } from './model'
import { installRestore } from './restore'
import { chooseProject, installRouting, routedProjectId } from './routing'
import { closeOverlay, isOverlayOpen, openOverlay, topOverlay } from './state'
import { taskLaunchRequest } from '@acorn/client-core/features/tabs/taskLaunch.ts'
import { actionPickerRequest } from '@acorn/client-core/host/registries/commands'
import { closeLinkPreviewOnNodeChange, linkPreview } from '@acorn/client-core/host/linkPreview/linkPreview.ts'
import { clientCapability } from '@acorn/client-core/infra/node'
import {
  WORKFLOW_GIT_LAUNCH,
  workflowGitLaunchRequest,
  closeWorkflowGitLaunch,
} from '@acorn/plugin-workflows/contract/gitLaunch.ts'
import { cyclePane } from './panes'
import { Rail, railCells, sourceCollectionId } from './Rail'
import { PANES, SOURCE, topology } from './topology'
import { Topbar } from './Topbar'
import { PaneBody, PaneStrip } from './PaneRow'
import { Footer } from './Footer'
import { Notifications } from './Notifications'
import { Inbox, initInbox } from './Inbox'
import { trustPromptComponent } from '../plugins/trustPromptLoader'
import { Palette } from './Palette'
import { createShellPalette } from './paletteSession'
import { shellNavigation } from './navigation'
import { CheatSheet } from './CheatSheet'
import type { SetupStep } from './Setup'
import { promotionRequest } from './promotionStore'
import { activeFilePrompt } from './filePrompt'
import { closeSettings, openSettings, settingsPlace } from './settingsStore'
import { Confirmation } from './Confirmation'
import { activeConfirmation } from './confirmStore'
import type { Address } from '@acorn/client-core/host/registries/commands/addresses'
import { placeRestored } from './state'
import { startLinkRequest } from './linkRequest'
import type { ResolvedTerminalLink } from './link'

// The arrangement: topbar, rail beside the pane, notifications, footer, and whatever overlay is on
// top of it all.
//
// The desktop's equivalent is `apps/desktop/src/client/App.tsx`, and its own header says why it lives
// in the app rather than in client-core: it is the arrangement, not the parts. Same here. Nothing in
// this file is a component another host could use; everything in it is a decision about where things
// go on one screen.
//
// The regions are ordered around the pane rather than inside it. A layout registers its regions at 0,
// 1, 2 from its own knowledge, so the chrome takes numbers outside that range and the cycle reads
// down the screen: rail, pane strip, the pane's own regions. The footer is not in it — it is a label,
// and a stop that does nothing is a hole a reader falls into (../keys/regions.ts § moveRegion).
const STRIP_ORDER = -50
const log = createLogger('tui-link')
// These screens mount only when their overlay opens. Keeping their hosts out of the shell's static
// chunk also keeps their fallback UI and dependencies out of the measured first-frame graph.
const SetupHost = lazy(() => import('./SetupHost').then(({ SetupHost }) => ({ default: SetupHost })))
const PromotionHost = lazy(() => import('./PromotionHost').then(({ PromotionHost }) => ({ default: PromotionHost })))
const SessionsHost = lazy(() => import('./SessionsHost').then(({ SessionsHost }) => ({ default: SessionsHost })))
const FileDialog = lazy(() => import('./FileDialog').then(({ FileDialog }) => ({ default: FileDialog })))
const SettingsHost = lazy(() => import('./SettingsHost').then(({ SettingsHost }) => ({ default: SettingsHost })))
const TaskLaunchHost = lazy(() => import('./TaskLaunchHost'))
const ActionPickerHost = lazy(() => import('./ActionPickerHost'))
const LinkPreviewDialog = lazy(() => import('./LinkPreviewDialog'))

export function Shell(props: {
  nodeId: string
  supervised: boolean
  onQuit: () => void
  link?: Address
  linkReady?: Accessor<boolean>
}) {
  createEffect(() => {
    if (taskLaunchRequest()) openOverlay('task-launch')
    else closeOverlay('task-launch')
  })
  createEffect(() => {
    if (actionPickerRequest()) openOverlay('action-picker')
    else closeOverlay('action-picker')
  })
  createEffect(() => {
    if (linkPreview()) openOverlay('link-preview')
    else closeOverlay('link-preview')
  })
  closeLinkPreviewOnNodeChange()
  createEffect(() => {
    if (workflowGitLaunchRequest()) openOverlay('workflow-launch')
    else closeOverlay('workflow-launch')
  })
  const model = createShellModel()
  // One session for the whole shell, not one per open: `./Palette.tsx` is mounted only while the
  // overlay is up, and a shortcut aimed at a group has to be able to open it (./paletteSession.ts).
  const palette = createShellPalette(model)
  // Open <label> for every source the Menu lists, from the table the desktop's rows come from. No
  // shortcuts: this shell's keys are its own keymap's. The keys land on the new Menu row once the
  // palette closes, because the Menu picks whichever row takes focus, and otherwise focus would go
  // back to the old row and pick the old source again.
  registerSourceOpeners({
    sources: model.sources,
    open: (source) => {
      const menu = sourceCollectionId(model.workspace()?.id ?? 'loading')
      setActiveItem(menu, source.id)
      setSelectedSource(source.id)
      const row = itemByIdentity(`${menu}\u0000${source.id}`)
      if (row) requestRenderableFocus(row)
    },
  })
  // A navigation search opened during node startup may see an empty roster. Refresh only that
  // frame when its local source changes; the shared session still owns its query and selection.
  createEffect(
    on(
      () => [model.ready(), model.workspaces(), model.allTasks(), nodes()],
      () => {
        const frame = untrack(palette.frame)
        if (untrack(palette.open) && frame?.kind === 'search' && frame.commandId?.startsWith('core.goto.')) {
          palette.retry()
        }
      },
      { defer: true },
    ),
  )
  const prefs = createQuery(() => prefsOptions(true))
  // Keep the last confirmed wording on screen during a refetch. The empty-node decision below still
  // requires fresh successful reads, so retained labels cannot turn cached zero into an empty Node.
  const mode = createMemo((previous: ReturnType<typeof workspacesMode> | undefined) => {
    const projects = model.projects()
    return prefs.isSuccess && !prefs.isFetching && projects
      ? workspacesMode(prefs.data[WORKSPACES_PREF_KEY], projects.length)
      : previous
  })
  const words = () => workspaceWords(mode())
  let root: Renderable | undefined
  const [strip, setStrip] = createSignal<Renderable | undefined>()
  // The shell's own width, so the left column can take a share of it rather than a fixed number of
  // cells (./Rail.tsx § railCells). The one width anything in the chrome reads, and it is this box's
  // rather than the terminal's — the same rule a layout keeps
  // (docs/tui/rectangles.md § What the TUI never does).
  const [cells, setCells] = createSignal(80)
  // One way to lose the left column: a reader asked, on `/`. A source list keeps `/` as its filter,
  // because its intent layer answers before this command does (../keys/tiers.ts).
  const [hidden, setHidden] = createSignal(false)
  const firstSetupStep = (): SetupStep => {
    if (!prefs.data?.[WORKSPACES_PREF_KEY] && !model.projects()?.length) return 'mode'
    return mode() === 'on' ? 'workspace' : 'project'
  }
  const [setupStep, setSetupStep] = createSignal<SetupStep>('mode')
  const openSetup = (step?: SetupStep) => {
    setSetupStep(step ?? firstSetupStep())
    openOverlay('setup')
  }

  // An empty node has no project or task that the rail can create. Wait for the Node's real roster
  // before offering setup: the cached startup path may briefly look empty while the Node boots.
  let emptyNode: string | null = null
  createEffect(() => {
    const node = activeNodeId()
    const projects = model.projects()
    if (!node || !projects || !prefs.isSuccess || prefs.isFetching) return
    if (projects.length) {
      emptyNode = null
      return
    }
    if (emptyNode === node) return
    emptyNode = node
    openSetup()
  })
  // Agent handoff and terminal commands both set the shared per-task drawer flag. On this host the
  // flag opens a full screen session view instead of a desktop drawer; closing it returns to the
  // pane without stopping the Node-owned PTY.
  createEffect(() => {
    const taskId = model.task()?.id
    if (taskId && isTerminalOpen(taskId)) openOverlay('sessions')
    else closeOverlay('sessions')
  })
  createEffect(() => {
    if (activeFilePrompt()) openOverlay('file')
    else closeOverlay('file')
  })

  const source = () => sourceRegistry.get(selectedSource() ?? '')

  // What the path says, read into the shell: which task to open, which source claims it, and which
  // project every project-scoped browse surface reads (./routing.ts).
  installRouting(model)

  // …and where the last run left off: the workspace that was open, and from there the per-workspace
  // memory of what was open in it (./restore.ts).
  installRestore(model, () => prefs.data)
  const [settingsReady, setSettingsReady] = createSignal(false)
  const reportLinkError = (error: unknown): void => log.warn('could not open terminal link', error)
  const [resolvedLink, setResolvedLink] = createSignal<{
    place: ResolvedTerminalLink
    open: (place: ResolvedTerminalLink, model: ShellModel) => void
  } | null>(null)
  let loadingLink = false
  let linked = false
  let cancelLinkRequest: (() => void) | undefined
  onCleanup(() => cancelLinkRequest?.())
  createEffect(() => {
    const link = props.link
    if (!link || loadingLink || !props.linkReady?.() || !placeRestored() || !model.ready() || !settingsReady()) return
    loadingLink = true
    cancelLinkRequest = startLinkRequest({
      load: () => import('./link'),
      apply: ({ resolveTerminalLink, openTerminalLink }) =>
        setResolvedLink({
          place: resolveTerminalLink(link, model),
          open: openTerminalLink,
        }),
      currentNodeId: activeNodeId,
      nodeId: props.nodeId,
      onError: reportLinkError,
    })
  })
  createEffect(() => {
    const resolved = resolvedLink()
    if (!resolved || linked || activeNodeId() !== props.nodeId) return
    // A project source is visible only after the destination workspace's provider scope answers.
    // Switch first, then let this effect run again with that workspace's source list.
    const projectId = resolved.place.projectId
    const owner =
      projectId &&
      model.workspaces().find((workspace) => workspace.projects.some((project) => project.id === projectId))
    if (owner && model.workspace()?.id !== owner.id) {
      model.chooseWorkspace(owner.id)
      return
    }
    if (!model.sourcesReady()) return
    linked = true
    try {
      resolved.open(resolved.place, model)
    } catch (error) {
      reportLinkError(error)
    }
  })

  // A bundle this device has never decided about. Raised rather than opened by a key, because nobody
  // asked for it: the distribution pass found code a node is offering and nothing runs until the
  // reader answers (../plugins/TrustPrompt.tsx). Escape drops the queue entry, which is what closes
  // this again.
  createEffect(() => {
    if (pendingTerminalTrust().length) openOverlay('trust')
    else closeOverlay('trust')
  })

  // The pane chords, answered by the shell because this host draws one pane and "the next pane" is a
  // switch rather than a walk (./panes.ts).
  setPaneCycler((delta) => cyclePane(model.task(), delta))
  onCleanup(() => setPaneCycler(null))

  // The arrangement, as the three questions the keys module cannot answer for itself: where Escape
  // goes from the top of a region, which region takes the keys when the screen first has any, and
  // which of them is chrome a first crossing passes over. Installed rather than imported, for the
  // same reason the pane cycler is: that module is the keys' and must not reach into this one
  // (./topology.ts).
  setTopology(topology)
  onCleanup(() => setTopology(null))

  // Hiding the main row is one of the two ways the keys can go off screen without anybody being told.
  // `visible` is per node: hiding this box leaves a focused descendant with its own `visible` still
  // true, so nothing tells the landing rule its node has gone behind the overlay. Asking for a pass is
  // the whole fix, because the pass walks the parents before it decides
  // (../keys/regions.ts § The landing rule, § onScreen).
  createEffect(() => {
    if (topOverlay() || activeConfirmation()) scheduleSettle()
  })

  // One tick for every spinner on screen (../kit/tick.ts).
  onMount(() => onCleanup(startSpinner()))

  // What is waiting. The workflow and system notices that feed it are the shared runtime's
  // (client-core/host/clientRuntime.ts); the system channel answers here with an escape sequence
  // rather than an OS banner (../platform.ts, ../kit/notify.ts).
  initInbox()

  // The command layer, tier 0: every keybinding the app and its plugins registered, over the command
  // registry, with the reader's own overrides applied. The scope questions are the shell's signals.
  onMount(() => {
    const engine = keymap<Renderable, KeyEvent>()
    if (engine) {
      installCommandLayer(engine, {
        prefs: () => ({
          ...(prefs.data?.[PrefKeys.keybindings] ? { keybindings: prefs.data[PrefKeys.keybindings] } : {}),
        }),
        taskActive: () => !!model.task(),
        // Always undefined, so a `pane`-scoped binding never fires here. The scope means "the keys are
        // in this pane and no other", and this host draws one pane at a time; a binding scoped to the
        // pane on screen would be a binding scoped to everything.
        focusedPane: () => undefined,
      })
    }
  })

  // The shell's own commands. Registered rather than written into a key handler, so each one is also
  // a palette row and each chord is one the reader can rebind, which is what every other command in
  // the app already is (docs/command-palette-and-shortcuts.md).
  const linkPlace = (): Extract<Place, { kind: 'task' | 'project' | 'settings' | 'source' }> | null => {
    if (isOverlayOpen('settings'))
      return { kind: 'settings', ...(settingsPlace().pageId ? { pageId: settingsPlace().pageId } : {}) }
    const source = selectedSource()
    if (!source) {
      const task = model.task()
      if (!task) return null
      return taskPlace(task, focusedPane(task.id))
    }
    return sourcePlaceFromPath(currentPath(), source, sourceIsProjectScoped(source))
  }
  onMount(() => {
    const quit = () => {
      // A node this TUI started dies with it, and a reader who typed `q` by accident should not
      // discover that afterwards. One this TUI only attached to is left running, so there is nothing
      // to confirm (docs/tui/process.md § Attach or start).
      if (props.supervised) openOverlay('quit')
      else props.onQuit()
    }
    const commands = registerCommands([
      {
        id: 'core.copy-link',
        title: 'Copy link',
        category: 'action',
        palette: true,
        when: () => !!linkPlace(),
        run: () => {
          const place = linkPlace()
          if (!place) return
          const href = buildLink(props.nodeId, place)
          return copyToTerminal(href) ? { effect: 'close' as const } : { effect: 'stay' as const, status: href }
        },
      },
      { id: 'core.palette.open', title: 'Commands', category: 'navigation', run: () => palette.openRoot() },
      {
        id: 'core.shortcuts.cheat-sheet',
        title: 'Help',
        hint: 'what the keyboard does right here',
        category: 'navigation',
        palette: true,
        run: () => openOverlay('help'),
      },
      {
        id: 'core.settings.open',
        title: 'Open settings',
        hint: 'every settings page, grouped as on the desktop',
        category: 'navigation',
        palette: true,
        run: () => openSettings(),
      },
      {
        id: 'core.setup.open',
        title: 'Set up acorn',
        hint: () =>
          mode() === 'off' ? 'projects, tasks, and providers' : 'workspaces, projects, tasks, and providers',
        category: 'workspace',
        palette: true,
        run: () => openSetup(),
      },
      {
        id: 'core.task.create',
        title: 'New task',
        hint: 'create a task in a project',
        category: 'task',
        palette: true,
        run: () => openSetup(model.projects()?.length ? 'task' : undefined),
      },
      {
        id: 'core.terminal.sessions',
        title: 'Open terminal sessions',
        hint: 'start or resume a task terminal',
        category: 'task',
        palette: true,
        requires: { plugin: 'terminal' },
        when: () => !!model.task(),
        run: () => {
          const task = model.task()
          if (task) setTerminalOpen(task.id, true)
        },
      },
      // Chord-only. The overlay pickers stay — `w` and `p` are how a reader switches without opening
      // the palette at all — but the palette's own row for each is the search under Go to, and two rows
      // saying "Switch workspace" is one too many
      // (client-core/host/registries/commands/navigationCommands.ts).
      {
        id: 'core.workspace.switch',
        title: () => `Switch ${words().singular}`,
        category: 'workspace',
        palette: false,
        run: () => openOverlay('workspace'),
      },
      {
        id: 'core.project.switch',
        title: 'Switch project',
        category: 'workspace',
        palette: false,
        run: () => openOverlay(mode() === 'off' ? 'workspace' : 'project'),
      },
      {
        id: 'core.rail.toggle',
        title: 'Rail',
        hint: 'hide or show the left column',
        keywords: ['sidebar', 'collapse', 'hide', 'show'],
        category: 'navigation',
        palette: true,
        run: () => {
          setHidden((value) => !value)
        },
      },
      {
        id: 'core.notifications.open',
        title: 'Notifications',
        hint: 'what needs you, and what happened',
        category: 'navigation',
        palette: true,
        run: () => openOverlay('notifications'),
      },
      { id: 'core.quit', title: 'Quit', category: 'action', palette: true, run: quit },
    ])
    // Ctrl and not `meta`, which is acorn's spelling for the platform command key: a terminal
    // emulator keeps Cmd for itself and never delivers it, so a `meta` chord here would be one
    // nobody can press. Same reason the intent table is installed at Ctrl (../keys/install.ts).
    createEffect(() => {
      const label = words().capitalized
      const bindings = registerKeybindings([
        {
          id: 'core.palette.open',
          command: 'core.palette.open',
          description: 'Commands',
          category: 'Global',
          defaultChord: 'ctrl+k',
          when: 'global',
        },
        {
          id: 'core.shortcuts.cheat-sheet',
          command: 'core.shortcuts.cheat-sheet',
          description: 'Help',
          category: 'Global',
          defaultChord: '?',
          when: 'global',
        },
        {
          id: 'core.workspace.switch',
          command: 'core.workspace.switch',
          description: label,
          category: 'Global',
          defaultChord: 'w',
          when: 'global',
        },
        {
          id: 'core.project.switch',
          command: 'core.project.switch',
          description: 'Project',
          category: 'Global',
          defaultChord: 'p',
          when: 'global',
        },
        // Beside `w`, because it is the other half of switching workspace, and bare for the same
        // reason. The command is the palette's Last workspace row
        // (client-core/host/registries/commands/navigationCommands.ts), and it is dropped from this
        // layer while there is nowhere to go back to.
        {
          id: 'core.goto.workspace-last',
          command: 'core.goto.workspace-last',
          description: `Last ${words().singular}`,
          category: 'Global',
          defaultChord: ';',
          when: 'global',
        },
        {
          id: 'core.rail.toggle',
          command: 'core.rail.toggle',
          description: 'Rail',
          category: 'Global',
          defaultChord: '/',
          when: 'global',
        },
        {
          id: 'core.notifications.open',
          command: 'core.notifications.open',
          description: 'Notifications',
          category: 'Global',
          defaultChord: 'n',
          when: 'global',
        },
        {
          id: 'core.terminal.sessions',
          command: 'core.terminal.sessions',
          description: 'Terminal sessions',
          category: 'Task',
          defaultChord: 't',
          when: 'task',
        },
        {
          id: 'core.quit',
          command: 'core.quit',
          description: 'Quit',
          category: 'Global',
          defaultChord: 'q',
          when: 'global',
        },
      ])
      onCleanup(() => bindings.dispose())
    })
    // Go to task, switch workspace, go to project and switch node, as one group of searches. A search
    // rather than one command per paired node, which would put the whole roster in the root.
    const navigation = registerNavigationCommands(shellNavigation(model, words))
    onCleanup(() => {
      navigation.dispose()
      commands.dispose()
    })
  })

  // Settings: core's pages from the table the desktop draws from, beside the pages the roster's plugins
  // register, and the ways in besides the palette. A plugin or a notice asks for a page by id, the
  // same request the desktop's shell answers (./settingsPages.tsx, ./settingsStore.ts).
  //
  // The desktop's palette rows for each page and section are not registered here. Every one of them
  // carries the Settings breadcrumb and a low order, so they rank level with or above this shell's
  // own commands: `notifications` would open the settings page instead of the inbox, and `new task`
  // Keyboard shortcuts. **Open settings** is the one row, and the route's lists reach every page.
  //
  // The pages register behind a loader, because the table and the page graph are not needed to draw the
  // first frame. The registry is a signal, so the route and anything reading it fill in when they land.
  onMount(() => {
    let unregister: (() => void) | undefined
    let live = true
    void import('./settingsPages').then(({ registerCoreSettingsPages }) => {
      if (live) {
        unregister = registerCoreSettingsPages()
        setSettingsReady(true)
      }
    })
    const offEvent = clientEvents.on('presentation:open-settings', ({ tab }) => openSettings(tab))
    const offTarget = registerNoticeTargetHandler('settings', (_taskId, target) => openSettings(target.resourceId))
    onCleanup(() => {
      live = false
      offTarget()
      offEvent()
      unregister?.()
    })
  })

  return (
    <box
      flexDirection="column"
      flexGrow={1}
      ref={(element: Renderable) => {
        root = element
        setCells(element.width)
      }}
      onSizeChange={() => setCells(root?.width ?? 80)}
    >
      <Topbar model={model} nodeId={props.nodeId} />
      {/* Hidden, not unmounted: opening an overlay must not tear down the rail and the pane
          behind it and throw away their queries and their models. `visible` is yoga's
          `display: none`, so the row gives up its height and the overlay below takes it.
          That is what a cell host has instead of a floating layer, and it is the same thing
          `TabPanel` does for a hidden tab. */}
      <box flexDirection="row" flexGrow={1} visible={!topOverlay() && !activeConfirmation()}>
        {/* No rule between the column and the pane: each panel draws its own frame, and a rule beside
            a border is two lines saying one thing (../panel.tsx). */}
        <Show when={!hidden()}>
          <Rail model={model} cells={railCells(cells())} nodeId={props.nodeId} />
        </Show>
        <box flexDirection="column" flexGrow={1}>
          {/* The strip is a region only while a task gives it something to draw. A ref outside this
              Show would leave an empty, focusable box in the source-view Tab cycle. */}
          <Show when={model.task()}>
            {(task) => (
              <box
                flexShrink={0}
                flexDirection="column"
                ref={(element: Renderable) => {
                  setStrip(element)
                  regionFocus(PANES, STRIP_ORDER)(element)
                }}
              >
                <PaneStrip task={task()} focused={focusWithin(strip())} />
              </box>
            )}
          </Show>
          {/* Under `PanelBody`, because a browse source's component is a `lazy()` and a pending one
              resolves to an empty string — which a cell host refuses outright, where the DOM would
              have shrugged and drawn a text node nobody sees. The same guard the pane mount path
              already has for the same reason (../layouts/index.ts). It carries the error boundary
              too, so a surface that throws says what it threw rather than leaving the main panel
              blank (../panel.tsx). */}
          <PanelBody name="main" nodeId={props.nodeId} region={SOURCE}>
            <Switch fallback={<EmptyState title="Nothing open">Choose a task in the rail.</EmptyState>}>
              {/* A source that declared regions has its list in the Browse panel already, so the
                  main panel is its detail alone. One that did not keeps its whole surface here
                  (client-core/host/registries/sources/sources.ts § regions). */}
              {/* A new source owns a new region lifetime. Reusing the Match while a lazy source
                  starts a resource would retain the previous tree and dispose the new focus claim. */}
              <Match when={source()?.regions?.detail} keyed>
                {(detail) => (
                  <SourceRegion>
                    <Dynamic component={detail} />
                  </SourceRegion>
                )}
              </Match>
              <Match when={source()?.component} keyed>
                {(component) => (
                  <SourceRegion>
                    <Dynamic component={component} />
                  </SourceRegion>
                )}
              </Match>
              <Match when={model.task()}>{(task) => <PaneBody task={task()} nodeId={props.nodeId} />}</Match>
            </Switch>
          </PanelBody>
        </box>
      </box>
      {/* The overlay layer is a sibling of the row, not a child of the pane column. An overlay
          belongs to the screen: mounted in the column it would draw in the pane's width with the
          rail still beside it, and read as one more panel rather than the thing being asked. `flexGrow` here keeps the footer at the bottom; the `Modal` inside stays at its
          own content height (../kit/grouping.tsx). */}
      <Show when={topOverlay()}>
        {(name) => (
          <box flexDirection="column" flexGrow={1} visible={!activeConfirmation()}>
            <Switch>
              <Match when={name() === 'palette'}>
                <Palette session={palette} />
              </Match>
              <Match when={name() === 'help'}>
                <CheatSheet />
              </Match>
              <Match when={name() === 'workspace'}>
                <WorkspacePicker model={model} words={words} />
              </Match>
              <Match when={name() === 'project'}>
                <ProjectPicker model={model} />
              </Match>
              <Match when={name() === 'quit'}>
                <QuitConfirm onQuit={props.onQuit} />
              </Match>
              <Match when={name() === 'trust'}>
                <Dynamic component={trustPromptComponent() ?? undefined} />
              </Match>
              <Match when={name() === 'notifications'}>
                <Inbox model={model} />
              </Match>
              <Match when={name() === 'setup'}>
                <Show when={activeNodeId()} keyed>
                  {(nodeId) => (
                    <SetupHost
                      model={model}
                      nodeId={nodeId}
                      initialStep={setupStep()}
                      onClose={() => closeOverlay('setup')}
                    />
                  )}
                </Show>
              </Match>
              <Match when={name() === 'task-launch'}>
                <Show when={taskLaunchRequest()} keyed>
                  {(request) => <TaskLaunchHost request={request} />}
                </Show>
              </Match>
              <Match when={name() === 'action-picker'}>
                <Show when={actionPickerRequest()} keyed>
                  {(request) => <ActionPickerHost request={request} />}
                </Show>
              </Match>
              <Match when={name() === 'link-preview'}>
                <Show when={linkPreview()} keyed>
                  {(request) => <LinkPreviewDialog request={request} nodeId={props.nodeId} model={model} />}
                </Show>
              </Match>
              <Match when={name() === 'workflow-launch'}>
                <Show when={workflowGitLaunchRequest()} keyed>
                  {(request) => (
                    <Dynamic
                      component={clientCapability(WORKFLOW_GIT_LAUNCH)?.Dialog}
                      request={request}
                      onClose={() => closeWorkflowGitLaunch(request)}
                    />
                  )}
                </Show>
              </Match>
              <Match when={name() === 'settings'}>
                <SettingsHost nodeId={props.nodeId} onClose={closeSettings} onSetup={() => openSetup()} />
              </Match>
              <Match when={name() === 'promotion'}>
                <Show when={promotionRequest()}>{(request) => <PromotionHost request={request()} />}</Show>
              </Match>
              <Match when={name() === 'sessions'}>
                <Show when={model.task()}>
                  {(task) => <SessionsHost task={task()} onClose={() => closeOverlay('sessions')} />}
                </Show>
              </Match>
              <Match when={name() === 'file'}>
                <Show when={activeFilePrompt()}>{(prompt) => <FileDialog prompt={prompt()} />}</Show>
              </Match>
            </Switch>
          </box>
        )}
      </Show>
      {/* The confirmation goes over whatever has the screen, and that stays mounted and hidden under it,
          the way the main row stays under an overlay. So the page that asked is still there, with its
          state, when the answer lands (./confirmStore.ts). */}
      <Show when={activeConfirmation()} keyed>
        {(request) => (
          <box flexDirection="column" flexGrow={1}>
            <Confirmation request={request} />
          </box>
        )}
      </Show>
      <Notifications />
      <Footer nodeId={props.nodeId} />
    </box>
  )
}

/** A browse surface in the main panel, as a region the keys can be in.
 *
 *  A pane registers its regions from its layout, and a browse source has no layout — so without this
 *  the main panel would be the one place on this screen Tab can't reach, and nothing in it could be
 *  driven: the diff couldn't scroll and a `Sections` strip couldn't hear `h` (../kit/grouping.tsx).
 *  Order 0, which is where a layout's first region sits, so the cycle still reads down the screen:
 *  Menu, Browse, Tasks, then this.
 */
function SourceRegion(props: { children: JSX.Element }) {
  return (
    <box flexDirection="column" flexGrow={1} minWidth={0} ref={regionFocus(SOURCE, 0)}>
      {props.children}
    </box>
  )
}

/** The two-way question, as a list, because a terminal `Button` is a run of text and not a stop: the
 *  only thing here a reader can drive is a collection, so the choice is one. */
function QuitConfirm(props: { onQuit: () => void }) {
  const close = () => closeOverlay('quit')
  return (
    <Modal onDismiss={close} title="Quit" size="sm">
      <ModalBody>
        <box flexDirection="column">
          <Line role="muted">acorn started this node, so quitting stops it.</Line>
          <Rows
            id="chrome.quit"
            ariaLabel="Quit"
            items={[
              { key: 'quit', label: 'Quit and stop the node' },
              { key: 'stay', label: 'Stay' },
            ]}
            onActivate={(key) => (key === 'quit' ? props.onQuit() : close())}
          >
            {(row, item) => <Row item={item}>{row.label}</Row>}
          </Rows>
        </box>
      </ModalBody>
    </Modal>
  )
}

/** The project picker. `p` where `w` is the workspace, and an overlay for the same reason: the whole
 *  screen changes when a row is chosen, and a list drawn under the topbar leaves the keys wherever
 *  they already are.
 *
 *  Choosing writes a path rather than a signal. Every project-scoped surface reads `params.projectId`
 *  — that is what makes the GitHub browse list know which repository it is listing — so there has to
 *  be exactly one place the answer lives, and it is the path (./routing.ts). */
function ProjectPicker(props: { model: ShellModel }) {
  const close = () => closeOverlay('project')
  const projects = () => props.model.workspace()?.projects ?? []
  // Kept rather than rebuilt, for the reason the rail's are (../kit/showing/collection.tsx § keyedRows).
  const rows = keyedRows(projects, (project) => ({ key: project.id, ...project }))
  return (
    <Modal onDismiss={close} title="Project" size="sm">
      <ModalBody>
        <box flexDirection="column">
          <Show when={projects().length} fallback={<Line role="muted">No projects available.</Line>}>
            <Rows
              id="chrome.projects"
              ariaLabel="Projects"
              items={rows()}
              onActivate={(id) => {
                chooseProject(id)
                close()
              }}
            >
              {(project, item) => (
                <Row item={item} selected={project.id === routedProjectId()}>
                  {project.name}
                </Row>
              )}
            </Rows>
          </Show>
        </box>
      </ModalBody>
    </Modal>
  )
}

/** The workspace picker, as an overlay rather than a list under the topbar: it is the shell's chord
 *  that opens it, the whole screen changes when a row is chosen, and a list drawn under the topbar
 *  leaves the keys wherever they already are, a list the reader can't drive. An overlay is the shape
 *  that takes the keys and gives them back (./state.ts, ../keys/regions.ts). */
function WorkspacePicker(props: { model: ShellModel; words: () => ReturnType<typeof workspaceWords> }) {
  const close = () => closeOverlay('workspace')
  const rows = keyedRows(
    () => props.model.workspaces(),
    (workspace) => ({ key: workspace.id, ...workspace }),
  )
  return (
    <Modal onDismiss={close} title={props.words().capitalized} size="sm">
      <ModalBody>
        <box flexDirection="column">
          <Rows
            id="chrome.workspaces"
            ariaLabel={props.words().capitalizedPlural}
            items={rows()}
            onActivate={(id) => {
              props.model.chooseWorkspace(id)
              close()
            }}
          >
            {(workspace, item) => (
              <Row item={item} selected={workspace.id === props.model.workspace()?.id}>
                {workspace.name}
              </Row>
            )}
          </Rows>
        </box>
      </ModalBody>
    </Modal>
  )
}
