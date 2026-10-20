import { Index, Match, Show, Switch, createEffect, createMemo, createSignal, on, onCleanup, onMount } from 'solid-js'
import type { NodeStatus } from '@acorn/protocol/broker.ts'
import type { ProjectSite } from '@acorn/protocol/siteAssociations.ts'
import type {
  BridgeAgentHint,
  BridgeAgentSession,
  BridgeHandoff,
  BridgePageTask,
  BridgePanel,
  BridgePendingRequest,
  BridgeProject,
  BridgeWorkflowRun,
  BridgeWorkflowStep,
  BridgeWorkspace,
} from '@acorn/protocol/extensionBridge.ts'
import type { BrowserPanelView } from '@acorn/protocol/plugin/handoffs.ts'
import type { RailMarker } from '@acorn/client-core/features/tabs'
import { RailTab } from '@acorn/client-core/features/tabs/RailTab.tsx'
import { Button } from '@acorn/client-core/kit/components/primitives.tsx'
import { agentRailMarkers } from '@acorn/plugin-agents/contract/runtimeState.ts'
import type { BrowserApi } from '../browser'
import { pageHandoffs, type PageHandoff } from '../handoffs'
import { CallFailure, expectedFailure } from '../messages'
import { loadSiteChoices, pageScope, saveSiteChoices, type SiteChoices } from '../pageScope'
import { agentCounts, type PageTask } from '../taskPages'
import type { BridgeClient } from './bridgeClient'
import { CaptureFailure, withCapture, type PageCapture } from '../capture'
import { Conversation } from './Conversation'
import { errorGuidance } from './guidance'
import { GoToTask } from './GoToTask'
import { Agents } from './Agents'
import { Tasks, ThisPage } from './Home'
import {
  changeDraft,
  changedPendingItem,
  dropPendingItems,
  loadHomeWorkspace,
  loadPendingItem,
  savePendingItem,
  saveHomeWorkspace,
  type TaskTab,
} from '../localState'
import { locationTask, type Navigation } from './location'
import { NeedsYou, type RequestReads } from './NeedsYou'
import { PluginPanel, panelMarker } from './PluginPanel'
import type { Heading } from './TopBar'
import { Runs, runsLive } from './Runs'

// The tab glyph of a plugin panel that names none.
const PANEL_GLYPH = 'puzzle'

// The work on one Node, under the top bar: Home, or the task the location names with its tabs, or one
// of its conversations. The parent mounts one per selected Node. Each list is keyed by its task, so a
// slow reply fills only its own list, and anything that awaits checks on its return that the location
// is still the one it started from.
export function Workspace(props: {
  client: BridgeClient
  api: BrowserApi
  nodeId: string
  online: boolean
  // Whether Open in Acorn may open the desktop app, or copies its link.
  opensLinks: boolean
  hint: BridgeAgentHint | null
  reconnects: number
  projectChanges: number
  // Where the sidebar is, and what the top bar names under a task or in a conversation.
  nav: Navigation
  heading(heading: Heading | null): void
  // Whether Go to task is open, closing it, and the top bar it hangs under. Its footer names the Node.
  goToTask: boolean
  closeGoToTask(): void
  topBar: HTMLElement | undefined
  nodeLabel: string
  status: NodeStatus | null
  // Counts conversations the top bar archived, after which the open task's list reads again.
  archives: number
  // The Node's plugin panels, null until it answers.
  panels: readonly BridgePanel[] | null
  // The page beside the panel, when it may be read, with the handoffs and site associations it is
  // matched against here in the browser.
  pageUrl: string | undefined
  handoffs: readonly BridgeHandoff[]
  sites: readonly ProjectSite[]
  // Every active task on the Node with its links, null until the background sends them, and the tasks
  // the page belongs to, matched in the browser.
  tasks: readonly BridgePageTask[] | null
  pageTasks: readonly PageTask[]
  // Whether the person hid the branch marker on an origin, and showing it there again.
  markerHidden(origin: string): boolean
  showMarker(origin: string): void
  // A handoff the person asked for, from a task chip or This page's offer.
  handoff: PageHandoff | null
  startHandoff(handoff: PageHandoff): void
  dismissHandoff(): void
  // Every request the Node's agents are waiting on, and their conversations as read.
  requests: readonly BridgePendingRequest[]
  requestReads: RequestReads
}) {
  const nodeId = props.nodeId
  const nav = props.nav
  const location = nav.location
  const [projects, setProjects] = createSignal<BridgeProject[] | null>(null)
  const [workspaces, setWorkspaces] = createSignal<BridgeWorkspace[] | null>(null)
  // The workspace the person chose for Home's task list, if any.
  const [workspaceChoice, setWorkspaceChoice] = createSignal<string | null>(null)
  // Each task's conversations and workflow runs, as last read.
  const [sessionLists, setSessionLists] = createSignal<Record<string, BridgeAgentSession[]>>({})
  // Each workspace's conversations, as Home last read them, for its task rows' agent marks.
  const [workspaceSessions, setWorkspaceSessions] = createSignal<Record<string, BridgeAgentSession[]>>({})
  const [runLists, setRunLists] = createSignal<Record<string, BridgeWorkflowRun[]>>({})
  // Whether the Node runs the workflows plugin, which a failed runs read says it doesn't. Unknown until
  // the first read answers.
  const [runsAvailable, setRunsAvailable] = createSignal<boolean | null>(null)
  // Which runs the person opened or closed on Runs, by run ID, for every task. Not stored. The step
  // whose conversation is open names its task.
  const [runFolds, setRunFolds] = createSignal<Record<string, boolean>>({})
  const [openStep, setOpenStep] = createSignal<{
    taskId: string
    run: BridgeWorkflowRun
    step: BridgeWorkflowStep
  } | null>(null)
  // The project This page shows for a page on a project's site.
  const [pageProject, setPageProject] = createSignal<string | null>(null)
  const [siteChoices, setSiteChoices] = createSignal<SiteChoices>({})
  // Each plugin's panel for the task, by plugin: null when it has none for the task. Why the last read
  // of a panel failed, and the log source the person picked in each.
  const [panelViews, setPanelViews] = createSignal<Record<string, BrowserPanelView | null>>({})
  const [panelProblems, setPanelProblems] = createSignal<Record<string, string>>({})
  const [panelSources, setPanelSources] = createSignal<Record<string, string>>({})
  // The item waiting for the shown task's first conversation, as storage holds it.
  const [pendingItem, setPendingItem] = createSignal<PageCapture | null>(null)
  // Which of the Agents tab's folds are open, by label, for every task. Not stored: a fold opens closed
  // in a new panel.
  const [agentFolds, setAgentFolds] = createSignal<Record<string, boolean>>({})
  // Which conversations' tool runs are open, by session and run. Not stored either.
  const [toolFolds, setToolFolds] = createSignal<Record<string, boolean>>({})
  const foldTools = (key: string, open: boolean) => setToolFolds((folds) => ({ ...folds, [key]: open }))
  // The conversation just started here, whose message box takes the cursor when it opens.
  const [startedSession, setStartedSession] = createSignal<string | null>(null)
  const [problem, setProblem] = createSignal<string | null>(null)

  // The task the location shows. A memo, so a move within the task reads nothing again.
  const taskId = createMemo(() => locationTask(location()))
  const tab = (): TaskTab | null => {
    const here = location()
    return here.level === 'task' ? here.tab : null
  }
  const task = () => props.tasks?.find((row) => row.id === taskId()) ?? null
  const pageTask = () => props.pageTasks[0] ?? null
  const projectName = (id: string) => projects()?.find((row) => row.id === id)?.name ?? id
  const projectWorkspace = (id: string) => {
    const workspaceId = projects()?.find((row) => row.id === id)?.workspaceId
    return workspaces()?.find((workspace) => workspace.id === workspaceId)?.name
  }

  const report = (error: unknown) => {
    if (expectedFailure(error)) return
    setProblem(error instanceof CallFailure ? errorGuidance(error) : String(error))
  }

  const loadProjects = async () => {
    setProblem(null)
    try {
      const result = await props.client.call({ op: 'projects.list', nodeId })
      setProjects(result.projects.filter((project) => !project.hidden))
      setWorkspaces(result.workspaces)
    } catch (error) {
      setProjects(null)
      setWorkspaces(null)
      report(error)
    }
  }

  // Reads a task's conversations, and returns them, or null when the read failed.
  const loadSessions = async (forTask: string): Promise<BridgeAgentSession[] | null> => {
    try {
      const result = await props.client.call({ op: 'sessions.list', nodeId, taskId: forTask })
      setSessionLists((lists) => ({ ...lists, [forTask]: result.sessions }))
      return result.sessions
    } catch (error) {
      if (taskId() === forTask) report(error)
      return null
    }
  }

  // The newest 100 across the workspace's tasks. A working session is a recent one, so the cut drops
  // only idle ones. If it ever drops working ones, filter the Node's route by state rather than page.
  const loadWorkspaceSessions = async (workspaceId: string) => {
    try {
      const result = await props.client.call({ op: 'sessions.list', nodeId, workspaceId })
      setWorkspaceSessions((lists) => ({ ...lists, [workspaceId]: result.sessions }))
    } catch (error) {
      report(error)
    }
  }

  // A Node without the workflows plugin answers with a failure, which leaves Runs out of the tabs.
  const loadRuns = async (forTask: string) => {
    try {
      const result = await props.client.call({ op: 'workflow.runs', nodeId, taskId: forTask })
      setRunLists((lists) => ({ ...lists, [forTask]: result.runs }))
      setRunsAvailable(true)
    } catch (error) {
      if (!expectedFailure(error)) setRunsAvailable(false)
    }
  }

  // A panel read keeps the last good view when it fails, and is dropped if the task changed meanwhile.
  const loadPanel = async (pluginId: string, forTask: string) => {
    const source = panelSources()[pluginId]
    try {
      const result = await props.client.call({
        op: 'plugin.panel',
        nodeId,
        pluginId,
        taskId: forTask,
        ...(source ? { source } : {}),
      })
      if (taskId() !== forTask) return
      setPanelViews((views) => ({ ...views, [pluginId]: result.view }))
      setPanelProblems(({ [pluginId]: _cleared, ...rest }) => rest)
    } catch (error) {
      if (taskId() !== forTask || expectedFailure(error)) return
      const message = error instanceof CallFailure ? errorGuidance(error) : String(error)
      setPanelProblems((problems) => ({ ...problems, [pluginId]: message }))
    }
  }
  const openPanel = () => tab()?.match(/^panel:(.+)$/)?.[1] ?? null
  const reloadOpenPanel = () => {
    const pluginId = openPanel()
    const forTask = taskId()
    if (pluginId && forTask) void loadPanel(pluginId, forTask)
  }

  // The person opened a conversation. The item waiting in its task joins its stored draft first,
  // through the same helper a send that finished elsewhere uses, so the composer finds it when it mounts.
  async function openSession(forTask: string, id: string) {
    const started = location()
    const storage = props.api.storage.local
    const item = await loadPendingItem(storage, nodeId, forTask)
    if (item) {
      try {
        await changeDraft(storage, { nodeId, taskId: forTask, sessionId: id }, (draft) => {
          const captures = draft.captures ?? []
          // The same item handed off twice is one capture.
          if (captures.some((other) => other.kind === item.kind && other.url === item.url)) return draft
          return { ...draft, captures: withCapture(captures, item) }
        })
        await dropPendingItems(storage, nodeId, [forTask])
      } catch (error) {
        setProblem(
          error instanceof CaptureFailure
            ? error.message
            : 'Browser storage is full, so the item was not added to the draft.',
        )
      }
    }
    if (location() === started) nav.openConversation(forTask, id)
  }

  // Create task made the item's task: it opens on Agents, with the item waiting for its first chat.
  const createdHandoffTask = async (_projectId: string, forTask: string, item: PageCapture) => {
    props.dismissHandoff()
    try {
      await savePendingItem(props.api.storage.local, nodeId, forTask, item)
    } catch {
      setProblem('Browser storage is full, so the item will not go with the first message.')
    }
    nav.openTask(forTask, 'agents')
  }

  // A run just started opens on Runs, alone, and the task's runs are read again to show it.
  const openStartedRun = (forTask: string, runId: string) => {
    setRunFolds((folds) => ({
      ...folds,
      ...Object.fromEntries((runLists()[forTask] ?? []).map((run) => [run.id, false])),
      [runId]: true,
    }))
    void loadRuns(forTask)
  }

  // Start run made the item's task and started a run in it.
  const startedHandoffWorkflow = (_projectId: string, forTask: string, runId: string) => {
    props.dismissHandoff()
    openStartedRun(forTask, runId)
    nav.openTask(forTask, 'runs')
  }

  // The task changed: read its conversations, its runs, and the item waiting for its first chat.
  createEffect(
    on(taskId, async (id) => {
      setPendingItem(null)
      if (!id) return
      void loadSessions(id)
      void loadRuns(id)
      const item = await loadPendingItem(props.api.storage.local, nodeId, id)
      if (taskId() === id) setPendingItem(item)
    }),
  )
  // The item is added and removed in storage, by this view, by Create task, and by the task chip.
  const onStorage = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    const id = taskId()
    const item = area === 'local' && id ? changedPendingItem(nodeId, id, changes) : undefined
    if (item !== undefined) setPendingItem(item)
  }
  props.api.storage.onChanged.addListener(onStorage)
  onCleanup(() => props.api.storage.onChanged.removeListener(onStorage))
  // The task, or the Node's panels, changed: read every panel, which also says which tabs show. A
  // plugin answering no panel for the task has no tab.
  createEffect(
    on([taskId, () => props.panels], ([id, panels]) => {
      setPanelViews({})
      setPanelProblems({})
      if (id) for (const panel of panels ?? []) void loadPanel(panel.pluginId, id)
    }),
  )
  // An open panel reads again when the Node's tasks change, which includes a plugin reporting a change.
  createEffect(on(() => props.tasks, reloadOpenPanel, { defer: true }))

  // A tab the task turns out not to have gives way to Agents: Runs on a Node without workflows, or a
  // panel whose plugin stopped or answers none for the task.
  createEffect(() => {
    const here = location()
    if (here.level !== 'task' || here.tab === 'agents') return
    const pluginId = openPanel()
    const missing =
      here.tab === 'runs'
        ? runsAvailable() === false
        : (props.panels !== null && !props.panels.some((panel) => panel.pluginId === pluginId)) ||
          panelViews()[pluginId!] === null
    if (missing) nav.openTask(here.taskId, 'agents')
  })

  // Tasks were archived or deleted: the Node's list had them, and the next one doesn't. The shown one
  // gives way to Home, and none keeps a waiting item. A list without a task it never had says nothing,
  // because a task just made opens before the list has it.
  createEffect(
    on(
      () => props.tasks,
      (tasks, previous) => {
        if (!tasks || !previous) return
        const gone = previous.filter((row) => !tasks.some((next) => next.id === row.id)).map((row) => row.id)
        if (!gone.length) return
        void dropPendingItems(props.api.storage.local, nodeId, gone)
        const id = taskId()
        if (id && gone.includes(id)) nav.goHome()
      },
    ),
  )

  // The open conversation's row in its task's list, kept when a later read drops it, so the
  // conversation stays to say it's gone and keep its draft. And the open step, for a step's conversation.
  const session = createMemo<BridgeAgentSession | null>((last) => {
    const here = location()
    if (here.level !== 'conversation' || here.from !== 'agents') return null
    const row = sessionLists()[here.taskId]?.find((candidate) => candidate.id === here.sessionId)
    return row ?? (last?.id === here.sessionId ? last : null)
  }, null)
  const step = () => {
    const here = location()
    const open = openStep()
    if (here.level !== 'conversation' || here.from !== 'runs' || !open) return null
    return open.taskId === here.taskId && open.step.session?.id === here.sessionId ? open : null
  }
  // A conversation the list doesn't have yet, such as one a notification asked for, reads the list
  // again. One the fresh list doesn't have either gives way to its task's Agents.
  createEffect(
    on(
      () => {
        const here = location()
        return here.level === 'conversation' && here.from === 'agents' ? here.sessionId : null
      },
      async (sessionId) => {
        const here = location()
        if (!sessionId || here.level !== 'conversation' || session()) return
        const list = await loadSessions(here.taskId)
        if (list && location() === here && !list.some((row) => row.id === sessionId))
          nav.openTask(here.taskId, 'agents')
      },
    ),
  )

  // What the top bar names: the task with its project and branch, or the conversation under its task
  // or run. The page's own task is tagged.
  createEffect(() => {
    const here = location()
    const shown = task()
    if (here.level === 'task' && shown)
      return props.heading({
        title: shown.title,
        detail: [projectName(shown.projectId), shown.branch].filter(Boolean).join(' · '),
        here: props.pageTasks.some((page) => page.task.id === shown.id),
      })
    const open = step()
    if (open) return props.heading({ eyebrow: open.run.name, title: open.step.name })
    const row = session()
    props.heading(row ? { eyebrow: shown?.title, title: row.title } : null)
  })
  onCleanup(() => props.heading(null))

  // The task's tabs, as the desktop's pane rail draws them: Agents always, Runs while the Node runs
  // workflows, and each plugin with a panel for the task. The open tab stays drawn while its view
  // loads, so it doesn't vanish under the person. A conversation marks the tab it came from.
  const railTab = (): TaskTab | null => {
    const here = location()
    return here.level === 'conversation' ? here.from : tab()
  }
  const taskTabs = (): { id: TaskTab; label: string; glyph: string; markers?: RailMarker[] }[] => {
    const id = taskId()
    const open = railTab()
    if (!id) return []
    const { waiting, working } = agentCounts(id, sessionLists()[id], props.requests)
    return [
      { id: 'agents', label: 'Agents', glyph: 'bot', markers: agentRailMarkers({ working, attention: waiting }) },
      ...(runsAvailable() || open === 'runs'
        ? [
            {
              id: 'runs' as const,
              label: 'Runs',
              glyph: 'workflow',
              markers: runsLive(runLists()[id])
                ? [
                    {
                      id: 'running',
                      icon: 'loader-circle',
                      tone: 'accent' as const,
                      busy: true,
                      label: 'A run is running',
                      placements: ['top-end' as const],
                    },
                  ]
                : undefined,
            },
          ]
        : []),
      ...(props.panels ?? [])
        .filter((panel) => panelViews()[panel.pluginId] || open === `panel:${panel.pluginId}`)
        .map((panel) => ({
          id: `panel:${panel.pluginId}` as const,
          label: panel.label,
          glyph: panel.glyph ?? PANEL_GLYPH,
          markers: panelMarker(panelViews()[panel.pluginId]),
        })),
    ]
  }

  // One line under the bars when the page beside the panel isn't what the panel shows: another task's
  // page, or an item no task holds. The offline strip, drawn above, wins over both.
  const pageStrip = (): { kind: 'other'; task: BridgePageTask } | { kind: 'item' } | null => {
    const id = taskId()
    if (!id || !props.online) return null
    const other = pageTask()
    if (other) return other.task.id === id ? null : { kind: 'other', task: other.task }
    return pageHandoffs(props.handoffs, props.pageUrl).length ? { kind: 'item' } : null
  }

  // Projects for the page beside the panel. Every project with an association covering the page is a
  // candidate. The person's choice on this site, if any, replaces them; otherwise a single candidate
  // is the suggestion and several are left to the picker.
  const scope = createMemo(() =>
    pageScope(props.sites, new Set((projects() ?? []).map((project) => project.id)), siteChoices(), props.pageUrl),
  )
  const pageProjects = createMemo((): string[] => scope().projects, [], { equals: (a, b) => a.join() === b.join() })
  const onSite = () => scope().suggested.length > 0 || pageProjects().length > 0
  // The page belongs to a task, carries an item a handoff can look up, or is on a project's site.
  const pageMatched = () =>
    Boolean(props.handoff || pageTask() || pageHandoffs(props.handoffs, props.pageUrl).length || onSite())
  const showProject = (id: string | null) => setPageProject(id)
  // One candidate is shown, and a project the page's candidates leave out is cleared so the person
  // picks one. An unmatched page changes nothing.
  createEffect(
    on(pageProjects, (ids) => {
      const shown = pageProject()
      if (ids.length === 1 && ids[0] !== shown) showProject(ids[0]!)
      else if (ids.length > 1 && shown && !ids.includes(shown)) showProject(null)
    }),
  )
  // The person picked a project for the page. When it differs from what this site suggests, it is
  // remembered for the site, so coming back here shows it again.
  const pickProject = (id: string | null) => {
    showProject(id)
    const key = scope().choiceKey
    if (key === null) return
    const plain = scope().suggested.length === 1 ? scope().suggested[0]! : null
    const next = { ...siteChoices() }
    if (id === plain) delete next[key]
    else next[key] = id ?? ''
    setSiteChoices(next)
    void saveSiteChoices(props.api.storage.local, nodeId, next)
  }

  // Home lists the workspace the person chose, or else the page's task's, or else the first.
  const homeWorkspace = () => {
    const list = workspaces() ?? []
    const choice = workspaceChoice()
    if (choice && list.some((workspace) => workspace.id === choice)) return choice
    const pageProjectRow = projects()?.find((project) => project.id === pageTask()?.task.projectId)
    return pageProjectRow?.workspaceId ?? list[0]?.id ?? null
  }
  const pickWorkspace = (id: string) => {
    setWorkspaceChoice(id)
    void saveHomeWorkspace(props.api.storage.local, nodeId, id)
  }
  const homeProjects = () => (projects() ?? []).filter((project) => project.workspaceId === homeWorkspace())
  // The workspace Home shows, while it shows. Its sessions are read only then.
  const shownWorkspace = createMemo(() => (location().level === 'home' ? homeWorkspace() : null))
  // A task's agents, from the shown workspace's sessions. A page's task in another workspace shows only
  // whether an agent waits on the person, which the Node's requests say for every task.
  const taskAgents = (id: string) =>
    agentCounts(
      id,
      workspaceSessions()[homeWorkspace() ?? '']?.filter((row) => row.taskId === id),
      props.requests,
    )
  createEffect(
    on(shownWorkspace, (id) => {
      if (id) void loadWorkspaceSessions(id)
    }),
  )

  onMount(async () => {
    setSiteChoices(await loadSiteChoices(props.api.storage.local, nodeId))
    setWorkspaceChoice(await loadHomeWorkspace(props.api.storage.local, nodeId))
    await loadProjects()
  })

  // Another client started, renamed, or finished a conversation in this task, an agent moved one on,
  // or the Node dropped frames: read the list again, even under an open conversation, because the
  // Agents tab's marker counts from it. An open conversation also reads its own hints.
  createEffect(
    on(
      () => props.hint,
      (hint) => {
        const id = taskId()
        if (hint?.nodeId !== nodeId || !id) return
        const listed = (sessionId: string) => sessionLists()[id]?.some((row) => row.id === sessionId)
        if (!hint.missed && !hint.tasks.includes(id) && !hint.sessions.some(listed)) return
        void loadRuns(id)
        void loadSessions(id)
      },
      { defer: true },
    ),
  )
  // The same for Home, when a hinted task or conversation is in the workspace it shows.
  createEffect(
    on(
      () => props.hint,
      (hint) => {
        const id = shownWorkspace()
        if (hint?.nodeId !== nodeId || !id) return
        const inWorkspace = new Set(homeProjects().map((project) => project.id))
        const touches =
          hint.missed ||
          hint.tasks.some((taskId) =>
            props.tasks?.some((row) => row.id === taskId && inWorkspace.has(row.projectId)),
          ) ||
          hint.sessions.some((sessionId) => workspaceSessions()[id]?.some((row) => row.id === sessionId))
        if (touches) void loadWorkspaceSessions(id)
      },
      { defer: true },
    ),
  )
  createEffect(
    on(
      () => props.archives,
      () => {
        const id = taskId()
        if (id) void loadSessions(id)
      },
      { defer: true },
    ),
  )
  // A project was added, renamed, hidden, or removed, here or by another client.
  createEffect(
    on(
      () => props.projectChanges,
      () => void loadProjects(),
      { defer: true },
    ),
  )
  createEffect(
    on(
      () => props.reconnects,
      () => {
        if (!projects()) void loadProjects()
        const workspaceId = shownWorkspace()
        if (workspaceId) void loadWorkspaceSessions(workspaceId)
        const id = taskId()
        if (id) {
          void loadSessions(id)
          void loadRuns(id)
        }
        reloadOpenPanel()
      },
      { defer: true },
    ),
  )

  return (
    <>
      <GoToTask
        open={props.goToTask}
        close={props.closeGoToTask}
        anchor={props.topBar}
        tasks={props.tasks ?? []}
        projects={projects()}
        workspaces={workspaces()}
        pageTaskId={pageTask()?.task.id ?? null}
        shownTaskId={taskId()}
        nodeLabel={props.nodeLabel}
        status={props.status}
        goHome={nav.goHome}
        openTask={(id) => nav.openTask(id)}
        switchNode={nav.openSettings}
      />
      <Show when={location().level !== 'settings'}>
        <Show when={pageStrip()}>
          {(strip) => {
            const shown = strip()
            return shown.kind === 'other' ? (
              <div class="strip" role="status">
                <span class="grow">
                  This page is in <b>{shown.task.title}</b>
                </span>
                <Button label="Switch" onPress={() => nav.openTask(shown.task.id)} />
              </div>
            ) : (
              <div class="strip" role="status">
                <span class="grow">This page has no task</span>
                <Button label="Start task" onPress={() => nav.goHome()} />
              </div>
            )
          }}
        </Show>
        <Show when={problem()}>
          <p class="banner problem" role="alert">
            {problem()}
          </p>
        </Show>
        <Switch>
          <Match when={location().level === 'home'}>
            <div class="view" aria-label="Home">
              <NeedsYou
                client={props.client}
                nodeId={nodeId}
                requests={props.requests}
                reads={props.requestReads}
                online={props.online}
                openConversation={nav.openConversation}
              />
              <Show when={pageMatched()}>
                <ThisPage
                  client={props.client}
                  api={props.api}
                  nodeId={nodeId}
                  online={props.online}
                  opensLinks={props.opensLinks}
                  pageUrl={props.pageUrl}
                  handoffs={props.handoffs}
                  pageTasks={props.pageTasks}
                  markerHidden={props.markerHidden}
                  showMarker={props.showMarker}
                  projectName={projectName}
                  projectWorkspace={projectWorkspace}
                  agents={taskAgents}
                  openTask={(id) => nav.openTask(id)}
                  handoff={props.handoff}
                  startHandoff={props.startHandoff}
                  dismissHandoff={props.dismissHandoff}
                  createdHandoffTask={(projectId, forTask, item) => void createdHandoffTask(projectId, forTask, item)}
                  startedHandoffWorkflow={startedHandoffWorkflow}
                  projects={projects()}
                  suggested={scope().suggested}
                  onSite={onSite()}
                  project={pageProject()}
                  pickProject={pickProject}
                  tasks={(props.tasks ?? []).filter((row) => row.projectId === pageProject())}
                  pageTaskIds={props.pageTasks.map(({ task }) => task.id)}
                />
              </Show>
              <Tasks
                api={props.api}
                workspaces={workspaces()}
                workspaceId={homeWorkspace()}
                pickWorkspace={pickWorkspace}
                projects={homeProjects()}
                tasks={props.tasks ?? []}
                pageTaskIds={props.pageTasks.map(({ task }) => task.id)}
                agents={taskAgents}
                openTask={(id) => nav.openTask(id)}
              />
            </div>
          </Match>
          <Match when={tab() === 'agents' && taskId()} keyed>
            {(id) => (
              <div class="view" aria-label="Agents">
                <Agents
                  client={props.client}
                  nodeId={nodeId}
                  taskId={id}
                  online={props.online}
                  sessions={sessionLists()[id] ?? null}
                  requests={props.requests}
                  reads={props.requestReads}
                  pendingItem={pendingItem()}
                  dropPendingItem={() => void dropPendingItems(props.api.storage.local, nodeId, [id])}
                  folds={agentFolds()}
                  fold={(label, open) => setAgentFolds((folds) => ({ ...folds, [label]: open }))}
                  open={(sessionId) => void openSession(id, sessionId)}
                  started={(started) => {
                    setStartedSession(started.id)
                    setSessionLists((lists) => ({
                      ...lists,
                      [id]: [started, ...(lists[id] ?? []).filter((row) => row.id !== started.id)],
                    }))
                    void openSession(id, started.id)
                  }}
                />
              </div>
            )}
          </Match>
          <Match when={tab() === 'runs' && taskId()} keyed>
            {(id) => (
              <div class="view" aria-label="Runs">
                <Runs
                  client={props.client}
                  nodeId={nodeId}
                  taskId={id}
                  online={props.online}
                  project={task() ? { id: task()!.projectId, name: projectName(task()!.projectId) } : null}
                  runs={runLists()[id] ?? null}
                  folds={runFolds()}
                  fold={(runId, open) => setRunFolds((folds) => ({ ...folds, [runId]: open }))}
                  started={(runId) => openStartedRun(id, runId)}
                  refreshRuns={() => void loadRuns(id)}
                  open={(run, opened) => {
                    setOpenStep({ taskId: id, run, step: opened })
                    nav.openConversation(id, opened.session!.id, 'runs')
                  }}
                />
              </div>
            )}
          </Match>
          <Match when={openPanel() && taskId()} keyed>
            {(id) => (
              <Show when={(props.panels ?? []).find((panel) => panel.pluginId === openPanel())}>
                {(panel) => (
                  <PluginPanel
                    panel={panel()}
                    nodeId={nodeId}
                    taskId={id}
                    view={panelViews()[panel().pluginId]}
                    problem={panelProblems()[panel().pluginId] ?? null}
                    opensLinks={props.opensLinks}
                    refresh={() => loadPanel(panel().pluginId, id)}
                    pickSource={(source) => {
                      setPanelSources((sources) => ({ ...sources, [panel().pluginId]: source }))
                      return loadPanel(panel().pluginId, id)
                    }}
                  />
                )}
              </Show>
            )}
          </Match>
          {/* Keyed by the conversation, so every reply and draft inside is bound to it. */}
          <Match when={session()?.id} keyed>
            {(sessionId) => (
              <Conversation
                client={props.client}
                storage={props.api.storage}
                target={{ nodeId, taskId: taskId()!, sessionId }}
                session={session()!}
                focused={startedSession() === sessionId}
                online={props.online}
                opensLinks={props.opensLinks}
                hint={props.hint}
                reconnects={props.reconnects}
                folds={toolFolds()}
                fold={foldTools}
              />
            )}
          </Match>
          <Match when={step()} keyed>
            {(open) => (
              <Conversation
                client={props.client}
                storage={props.api.storage}
                target={{ nodeId, taskId: open.step.session!.taskId, sessionId: open.step.session!.id }}
                session={open.step.session!}
                online={props.online}
                opensLinks={props.opensLinks}
                hint={props.hint}
                reconnects={props.reconnects}
                folds={toolFolds()}
                fold={foldTools}
              />
            )}
          </Match>
        </Switch>
        {/* The desktop's pane rail, laid along the bottom edge. Last, so the view comes first in tab order. */}
        <Show when={taskId()}>
          <nav class="rail" aria-label="Task">
            {/* By position, so a tab whose marker changes keeps its button rather than redrawing it. */}
            <Index each={taskTabs()}>
              {(each) => (
                <RailTab
                  glyph={each().glyph}
                  label={each().label}
                  active={railTab() === each().id}
                  markers={each().markers}
                  aria-current={railTab() === each().id ? 'page' : undefined}
                  onClick={() => nav.pickTab(each().id)}
                />
              )}
            </Index>
          </nav>
        </Show>
      </Show>
    </>
  )
}
