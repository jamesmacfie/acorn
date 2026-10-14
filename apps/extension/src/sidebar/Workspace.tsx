import { Show, createEffect, createMemo, createSignal, on, onCleanup, onMount } from 'solid-js'
import type { ProjectSite } from '@acorn/protocol/siteAssociations.ts'
import type {
  BridgeAgentHint,
  BridgeAgentSession,
  BridgeHandoff,
  BridgePendingRequest,
  BridgeProject,
  BridgeTask,
  BridgeWorkflowRun,
  BridgeWorkflowStep,
} from '@acorn/protocol/extensionBridge.ts'
import type { BrowserApi } from '../browser'
import { pageHandoffs, type PageHandoff } from '../handoffs'
import { CallFailure, type RequestTarget } from '../messages'
import { loadSiteChoices, pageScope, saveSiteChoices, type SiteChoices } from '../pageScope'
import type { PageTask } from '../taskPages'
import type { BridgeClient } from './bridgeClient'
import { CaptureFailure, withCapture, type PageCapture } from '../capture'
import { Conversation } from './Conversation'
import type { Heading } from './Header'
import { errorGuidance } from './guidance'
import { Agents, CurrentTask, ThisPage } from './Home'
import { changeDraft, loadDestination, saveDestination, type Destination } from '../localState'
import { Waiting } from './Waiting'
import { Workflows } from './Workflows'

// The work on one Node: the current task, the page beside the panel, and the conversations and
// workflow runs of the page's task, or of the current task on its project's site. Home shows the page
// and the current task; Agents lists the conversations, and Workflows the runs and their steps. Opening a conversation makes its task current, shows Agents, and
// replaces the list until the person goes back. The parent mounts one
// per selected Node, and again each time Settings closes, so it restores the current task from
// storage. Each list read checks on its return that the choice it was made for is still the choice,
// so a slow reply can't fill the wrong list.
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
  // The bottom bar's tab, asking for Agents when a conversation opens or Workflows when a run starts,
  // whether there are runs to show there, and the two tabs' top bar heading.
  tab: 'home' | 'agents' | 'workflows'
  showAgents(): void
  showWorkflows(): void
  hasWorkflows(has: boolean): void
  // The remembered conversation came back as the panel opened.
  resumed(): void
  heading(heading: Heading | null): void
  // The page beside the panel, when it may be read, with the handoffs and site associations it is
  // matched against here in the browser.
  pageUrl: string | undefined
  handoffs: readonly BridgeHandoff[]
  sites: readonly ProjectSite[]
  // The tasks the page belongs to, matched in the browser, and a task chip's click asking to show
  // the page's task, with a new chat about the page for `chat`.
  pageTasks: readonly PageTask[]
  // Whether the person hid the branch marker on an origin, and showing it there again.
  markerHidden(origin: string): boolean
  showMarker(origin: string): void
  showTask: { chat: { url: string; title: string } | null } | null
  shownTask(): void
  // A handoff the person asked for, from a task chip or This page's offer.
  handoff: PageHandoff | null
  startHandoff(handoff: PageHandoff): void
  dismissHandoff(): void
  // A handed-off item's context, waiting for the person to open a conversation. It goes into that
  // conversation's draft for review, never straight to an agent.
  waitingContext: PageCapture | null
  setWaitingContext(capture: PageCapture | null): void
  // Every request the Node's agents are waiting on, and one whose conversation the person asked to
  // open from an OS notification.
  requests: readonly BridgePendingRequest[]
  openRequest: RequestTarget | null
  openedRequest(): void
}) {
  const nodeId = props.nodeId
  const [projects, setProjects] = createSignal<BridgeProject[] | null>(null)
  const [taskLists, setTaskLists] = createSignal<Record<string, BridgeTask[]>>({})
  const [current, setCurrent] = createSignal<Destination>({ projectId: null, taskId: null, sessionId: null })
  // Each task's conversations, as last read. Keyed by task, so a slow reply fills only its own list.
  const [sessionLists, setSessionLists] = createSignal<Record<string, BridgeAgentSession[]>>({})
  // Each task's workflow runs, as last read, the run Workflows shows in a task, and the step whose
  // conversation is open there. The last two name their task, so they only show while it's shown.
  const [runLists, setRunLists] = createSignal<Record<string, BridgeWorkflowRun[]>>({})
  const [selectedRun, setSelectedRun] = createSignal<{ taskId: string; runId: string } | null>(null)
  const [openStep, setOpenStep] = createSignal<{
    taskId: string
    run: BridgeWorkflowRun
    step: BridgeWorkflowStep
  } | null>(null)
  // The project This page shows, apart from the current task's.
  const [pageProject, setPageProject] = createSignal<string | null>(null)
  const [siteChoices, setSiteChoices] = createSignal<SiteChoices>({})
  const [problem, setProblem] = createSignal<string | null>(null)
  // Counts the tasks made current, so a restore whose task list answers late can't undo a later choice.
  let chosen = 0

  const report = (error: unknown) => {
    // A reply refused because the Node changed under it is expected, and a missing bridge has its banner.
    if (error instanceof CallFailure && (error.code === 'not_selected' || error.code === 'host_unavailable')) return
    setProblem(error instanceof CallFailure ? errorGuidance(error) : String(error))
  }
  // Only the person's own choices are remembered, so a restore that stops part-way loses nothing.
  const remember = () => void saveDestination(props.api.storage.local, nodeId, current())

  const loadProjects = async () => {
    setProblem(null)
    try {
      const result = await props.client.call({ op: 'projects.list', nodeId })
      setProjects(result.projects.filter((project) => !project.hidden))
    } catch (error) {
      setProjects(null)
      report(error)
    }
  }

  const loadTasks = async (projectId: string): Promise<BridgeTask[] | null> => {
    try {
      const result = await props.client.call({ op: 'tasks.list', nodeId, projectId })
      setTaskLists((lists) => ({ ...lists, [projectId]: result.tasks }))
      return result.tasks
    } catch (error) {
      report(error)
      return null
    }
  }

  // The task Home's Agents shows: the page's, or the current task on its project's site. A page tied
  // to neither shows no task's conversations.
  const pageTask = () => props.pageTasks[0] ?? null
  const agentsTask = (): { projectId: string | null; taskId: string | null } => {
    const page = pageTask()
    if (page) return { projectId: page.task.projectId, taskId: page.task.id }
    const { projectId } = current()
    return projectId && pageProjects().includes(projectId) ? current() : { projectId: null, taskId: null }
  }

  // Reads a task's conversations, then hands them to `then` if the task is still current.
  const loadSessions = async (forTask: string, then?: (list: BridgeAgentSession[]) => void) => {
    try {
      const result = await props.client.call({ op: 'sessions.list', nodeId, taskId: forTask })
      setSessionLists((lists) => ({ ...lists, [forTask]: result.sessions }))
      if (current().taskId === forTask) then?.(result.sessions)
    } catch (error) {
      if (current().taskId === forTask || agentsTask().taskId === forTask) report(error)
    }
  }

  // A Node without the workflows plugin answers with a failure, which leaves Workflows hidden.
  const loadRuns = async (forTask: string) => {
    try {
      const result = await props.client.call({ op: 'workflow.runs', nodeId, taskId: forTask })
      setRunLists((lists) => ({ ...lists, [forTask]: result.runs }))
    } catch {
      // Without the runs there is no Workflows tab; everything else still works.
    }
  }

  // Every change of task closes the conversation in the same write, so a conversation is never
  // mounted with a task it doesn't belong to.
  function useTask(projectId: string, taskId: string, then?: (list: BridgeAgentSession[]) => void) {
    chosen++
    setCurrent({ projectId, taskId, sessionId: null })
    void loadSessions(taskId, then)
  }

  // A task named by storage, a request, or a handoff becomes current once its project's fresh list
  // shows it is still open. A task the person chose since wins.
  async function restore(projectId: string, taskId: string, then?: (list: BridgeAgentSession[]) => void) {
    const mine = ++chosen
    const tasks = await loadTasks(projectId)
    if (mine === chosen && tasks?.some((task) => task.id === taskId)) useTask(projectId, taskId, then)
  }

  const showSession = (id: string) => setCurrent((destination) => ({ ...destination, sessionId: id }))

  // The person opened a conversation, which makes its task current. Waiting context joins its stored
  // draft first, through the same helper a send that finished elsewhere uses, so the composer finds it
  // when it mounts.
  async function openSession(target: { projectId: string; taskId: string }, id: string) {
    const forTask = target.taskId
    const mine = chosen
    const capture = props.waitingContext
    if (capture) {
      try {
        await changeDraft(props.api.storage.local, { nodeId, taskId: forTask, sessionId: id }, (draft) => {
          const captures = draft.captures ?? []
          // The same item handed off twice is one capture.
          if (captures.some((other) => other.kind === 'context' && other.url === capture.url)) return draft
          return { ...draft, captures: withCapture(captures, capture) }
        })
        props.setWaitingContext(null)
      } catch (error) {
        setProblem(
          error instanceof CaptureFailure
            ? error.message
            : 'Browser storage is full, so the item was not added to the draft.',
        )
      }
    }
    // Another task was chosen meanwhile.
    if (mine !== chosen) return
    if (current().taskId !== forTask) {
      chosen++
      void loadTasks(target.projectId)
    }
    setCurrent({ projectId: target.projectId, taskId: forTask, sessionId: id })
    props.showAgents()
    remember()
  }

  const pickTask = (projectId: string, taskId: string) => {
    useTask(projectId, taskId)
    remember()
  }

  // Home skips list hints while a conversation is open, so it reads the list again on the way back.
  const back = () => {
    setCurrent((destination) => ({ ...destination, sessionId: null }))
    remember()
    const shown = agentsTask().taskId
    if (shown) void loadSessions(shown)
  }

  // A task's newest conversation opens, or Agents with its new-chat picker when it has none.
  const chatInTask = (projectId: string, taskId: string) =>
    void restore(projectId, taskId, (list) => {
      remember()
      const newest = list[0]
      if (newest) void openSession({ projectId, taskId }, newest.id)
      else props.showAgents()
    })

  // A handoff's linked or new task, with the item's context waiting for the conversation.
  const openHandoffTask = (projectId: string, taskId: string, capture: PageCapture) => {
    props.setWaitingContext(capture)
    props.dismissHandoff()
    chatInTask(projectId, taskId)
  }

  // Create task made the item's task. It becomes current, and Home shows it, with the item's context
  // waiting for the first conversation the person opens.
  const createdHandoffTask = (projectId: string, taskId: string, capture: PageCapture) => {
    props.setWaitingContext(capture)
    props.dismissHandoff()
    void restore(projectId, taskId, () => remember())
  }

  // Start workflow made the item's task and started a run in it, which Workflows shows.
  const startedHandoffWorkflow = (projectId: string, taskId: string, runId: string) => {
    props.dismissHandoff()
    setSelectedRun({ taskId, runId })
    void loadRuns(taskId)
    props.showWorkflows()
    void restore(projectId, taskId, () => remember())
  }

  // Opens a request's conversation, as a remembered one is restored.
  const openConversation = (target: Destination & { projectId: string; taskId: string }) => {
    void saveDestination(props.api.storage.local, nodeId, target)
    void restore(target.projectId, target.taskId, (list) => {
      if (list.some((session) => session.id === target.sessionId)) showSession(target.sessionId!)
      props.showAgents()
    })
  }
  createEffect(
    on([() => props.openRequest, projects], ([target, loaded]) => {
      if (!target || !loaded) return
      props.openedRequest()
      if (target.nodeId === nodeId) openConversation(target)
    }),
  )

  // A task chip was clicked: Home shows the page's task, and for New chat about this page, Agents with
  // the page's link waiting for the conversation the person starts or opens next.
  createEffect(
    on(
      () => props.showTask,
      (request) => {
        if (!request) return
        props.shownTask()
        if (current().sessionId) back()
        if (!request.chat) return
        const { url, title } = request.chat
        props.setWaitingContext({ kind: 'link', id: crypto.randomUUID(), url, title, capturedAt: Date.now() })
      },
    ),
  )
  // The page's task changed: read its conversations.
  createEffect(
    on(
      () => pageTask()?.task.id,
      (taskId) => taskId && void loadSessions(taskId),
    ),
  )
  // The task Agents and Workflows show changed: read its runs, and say whether it has any.
  createEffect(
    on(
      () => agentsTask().taskId,
      (taskId) => taskId && void loadRuns(taskId),
    ),
  )
  createEffect(() => props.hasWorkflows(!!runLists()[agentsTask().taskId ?? '']?.length))
  onCleanup(() => props.hasWorkflows(false))
  const step = () => {
    const open = openStep()
    return open && open.taskId === agentsTask().taskId ? open : null
  }
  // A conversation open in another task follows the page to its task's newest conversation. Drafts
  // stay with the conversation they were written in.
  createEffect(
    on(
      () => pageTask()?.task.id,
      (taskId) => {
        const task = pageTask()?.task
        if (task && current().sessionId && current().taskId !== taskId) chatInTask(task.projectId, task.id)
      },
      { defer: true },
    ),
  )

  // A handoff shows on Home, so it closes the conversation.
  createEffect(
    on(
      () => props.handoff,
      (handoff) => handoff && current().sessionId && back(),
      { defer: true },
    ),
  )

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
  const showProject = (id: string | null) => {
    setPageProject(id)
    if (id) void loadTasks(id)
  }
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

  onMount(async () => {
    const remembered = await loadDestination(props.api.storage.local, nodeId)
    setSiteChoices(await loadSiteChoices(props.api.storage.local, nodeId))
    await loadProjects()
    // A request opened from a notification while this loaded chose already.
    if (chosen || !remembered.projectId || !remembered.taskId) return
    void restore(remembered.projectId, remembered.taskId, (list) => {
      if (!list.some((session) => session.id === remembered.sessionId)) return
      showSession(remembered.sessionId!)
      props.resumed()
    })
  })

  // Another client started, renamed, or finished a conversation in this task, an agent moved one on,
  // or the Node dropped frames: read the list again. An open conversation reads its own hints.
  createEffect(
    on(
      () => props.hint,
      (hint) => {
        const { taskId } = agentsTask()
        if (hint?.nodeId !== nodeId || !taskId) return
        const listed = (id: string) => sessionLists()[taskId]?.some((session) => session.id === id)
        if (!hint.missed && !hint.tasks.includes(taskId) && !hint.sessions.some(listed)) return
        void loadRuns(taskId)
        if (!current().sessionId) void loadSessions(taskId)
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
        const forTask = current().sessionId ? current().taskId : agentsTask().taskId
        if (forTask) void loadSessions(forTask)
        if (agentsTask().taskId) void loadRuns(agentsTask().taskId!)
      },
      { defer: true },
    ),
  )

  const task = () => taskLists()[current().projectId ?? '']?.find((row) => row.id === current().taskId) ?? null
  const session = () => sessionLists()[current().taskId ?? '']?.find((row) => row.id === current().sessionId) ?? null
  const projectName = (id: string) => projects()?.find((row) => row.id === id)?.name ?? id
  // Agents and Workflows name their list and its count in the top bar. An open conversation names itself.
  createEffect(() => {
    const { taskId } = agentsTask()
    if (props.tab === 'workflows') {
      // The Runs header below carries the count, as the desktop's does.
      if (!step()) props.heading({ title: 'Workflows' })
      return
    }
    if (current().sessionId) return
    props.heading({ title: 'Agents', count: taskId ? sessionLists()[taskId]?.length : undefined })
  })
  onCleanup(() => props.heading(null))

  return (
    <>
      <Show when={problem()}>
        <p class="banner problem" role="alert">
          {problem()}
        </p>
      </Show>
      <Show when={props.tab === 'home'}>
        <div class="view" aria-label="Home">
          <Waiting
            client={props.client}
            nodeId={nodeId}
            requests={props.requests}
            online={props.online}
            open={(request) => openConversation(request)}
          />
          {/* A page tied to no task, item, or project shows only the Acorn mark. */}
          <Show
            when={pageMatched()}
            fallback={
              <div class="idle">
                <img src="icon-128.png" alt="Acorn" />
              </div>
            }
          >
            <ThisPage
              client={props.client}
              nodeId={nodeId}
              online={props.online}
              opensLinks={props.opensLinks}
              pageUrl={props.pageUrl}
              handoffs={props.handoffs}
              pageTasks={props.pageTasks}
              markerHidden={props.markerHidden}
              showMarker={props.showMarker}
              projectName={projectName}
              chat={chatInTask}
              handoff={props.handoff}
              startHandoff={props.startHandoff}
              dismissHandoff={props.dismissHandoff}
              openHandoffTask={openHandoffTask}
              createdHandoffTask={createdHandoffTask}
              startedHandoffWorkflow={startedHandoffWorkflow}
              waitingContext={props.waitingContext}
              dropWaitingContext={() => props.setWaitingContext(null)}
              projects={projects()}
              suggested={scope().suggested}
              onSite={onSite()}
              several={!pageProject() && pageProjects().length > 1}
              project={pageProject()}
              pickProject={pickProject}
              tasks={pageProject() ? (taskLists()[pageProject()!] ?? null) : null}
              currentTaskId={current().taskId}
              pickTask={pickTask}
            />
            {/* The task the person last used stays pinned when the page is not its own. */}
            <Show when={!pageTask() || (current().taskId && current().taskId !== pageTask()!.task.id)}>
              <CurrentTask task={task()} projectName={current().projectId ? projectName(current().projectId!) : null} />
            </Show>
          </Show>
        </div>
      </Show>
      <Show when={props.tab === 'agents'}>
        <Show
          when={current().sessionId}
          keyed
          fallback={
            <div class="view" aria-label="Agents">
              <Show
                when={agentsTask().taskId}
                keyed
                fallback={<p class="empty quiet">This page belongs to no task. Choose one under Home.</p>}
              >
                {(taskId) => {
                  const target = () => ({ projectId: agentsTask().projectId!, taskId })
                  return (
                    <Agents
                      client={props.client}
                      nodeId={nodeId}
                      taskId={taskId}
                      online={props.online}
                      sessions={sessionLists()[taskId] ?? null}
                      requests={props.requests}
                      open={(id) => void openSession(target(), id)}
                      started={(started) => {
                        setSessionLists((lists) => ({
                          ...lists,
                          [taskId]: [started, ...(lists[taskId] ?? []).filter((row) => row.id !== started.id)],
                        }))
                        void openSession(target(), started.id)
                      }}
                    />
                  )
                }}
              </Show>
            </div>
          }
        >
          {(sessionId) => (
            <>
              {/* The page beside the panel belongs to another task. The conversation stays, because pages
                  are often visited to capture them into it; Switch opens that task, and drafts are kept. */}
              <Show when={pageTask() && pageTask()!.task.id !== current().taskId ? pageTask() : null}>
                {(other) => (
                  <div class="banner notice row" role="status">
                    <span class="grow">This page is in task {other().task.title}.</span>
                    <button
                      type="button"
                      class="quiet"
                      onClick={() => chatInTask(other().task.projectId, other().task.id)}
                    >
                      Switch
                    </button>
                  </div>
                )}
              </Show>
              <Conversation
                client={props.client}
                storage={props.api.storage}
                target={{ nodeId, taskId: current().taskId!, sessionId }}
                session={session()!}
                taskTitle={task()?.title ?? ''}
                back={back}
                heading={props.heading}
                online={props.online}
                opensLinks={props.opensLinks}
                hint={props.hint}
                reconnects={props.reconnects}
              />
            </>
          )}
        </Show>
      </Show>
      <Show when={props.tab === 'workflows'}>
        <Show
          when={step()}
          keyed
          fallback={
            <div class="view" aria-label="Workflows">
              <Show
                when={agentsTask().taskId}
                keyed
                fallback={<p class="empty quiet">This page belongs to no task. Choose one under Home.</p>}
              >
                {(taskId) => (
                  <Workflows
                    client={props.client}
                    nodeId={nodeId}
                    taskId={taskId}
                    runs={runLists()[taskId] ?? null}
                    selected={selectedRun()?.taskId === taskId ? selectedRun()!.runId : null}
                    select={(runId) => setSelectedRun({ taskId, runId })}
                    refreshRuns={() => void loadRuns(taskId)}
                    open={(run, step) => setOpenStep({ taskId, run, step })}
                  />
                )}
              </Show>
            </div>
          }
        >
          {/* A step's conversation, named for the step under its run, with the way back to the run. */}
          {(open) => (
            <Conversation
              client={props.client}
              storage={props.api.storage}
              target={{ nodeId, taskId: open.step.session!.taskId, sessionId: open.step.session!.id }}
              session={open.step.session!}
              taskTitle={open.run.name}
              back={() => setOpenStep(null)}
              heading={(heading) => props.heading({ ...heading, title: open.step.name })}
              online={props.online}
              opensLinks={props.opensLinks}
              hint={props.hint}
              reconnects={props.reconnects}
            />
          )}
        </Show>
      </Show>
    </>
  )
}
