import { For, Show, batch, createEffect, createMemo, createSignal, on, onMount } from 'solid-js'
import type { ProjectSite, SiteAssociation } from '@acorn/protocol/siteAssociations.ts'
import type {
  BridgeAgentHint,
  BridgeAgentProfile,
  BridgeAgentSession,
  BridgePendingRequest,
  BridgeProject,
  BridgeTask,
} from '@acorn/protocol/extensionBridge.ts'
import type { BrowserApi } from '../browser'
import { CallFailure, type RequestTarget } from '../messages'
import type { BridgeClient } from './bridgeClient'
import { CaptureFailure, withCapture, type CaptureKind, type PageCapture } from './capture'
import { Conversation } from './Conversation'
import { errorGuidance } from './guidance'
import { Handoff } from './Handoff'
import type { PageHandoff } from '../handoffs'
import { changeDraft, loadDestination, saveDestination, type Destination as Remembered } from './localState'
import { loadSiteChoices, pageScope, saveSiteChoices, type SiteChoices } from '../pageScope'
import { ProjectSites } from './ProjectSites'
import { Waiting } from './Waiting'

const UNCERTAIN = new Set(['ambiguous_mutation', 'host_unavailable', 'node_unreachable'])

// The profile a person may start a chat with, or why not.
const unavailableReason = (profile: BridgeAgentProfile): string | null => {
  if (!profile.installed) return profile.diagnostics[0] ?? 'Not installed on this Node'
  if (profile.authenticated === false) return 'Not signed in on this Node'
  return null
}

// Project, task, and conversation on one Node, each chosen explicitly. The parent mounts one per
// selected Node, so nothing here outlives a switch. Each list read checks on its return that the
// choice it was made for is still the choice, so a slow reply can't fill the wrong list.
export function Destination(props: {
  client: BridgeClient
  storage: BrowserApi['storage']['local']
  nodeId: string
  nodeLabel: string
  online: boolean
  hint: BridgeAgentHint | null
  reconnects: number
  capture(kind: CaptureKind): Promise<PageCapture>
  // A handoff the person asked for, from a site button or the sidebar's own offer.
  handoff: PageHandoff | null
  dismissHandoff(): void
  // The page beside the sidebar, when it may be read, and the Node's site associations to match it with.
  pageUrl: string | undefined
  sites: readonly ProjectSite[]
  sitesChanged(projectId: string, sites: SiteAssociation[]): void
  // Every request the Node's agents are waiting on, and one whose conversation the person asked to
  // open from an OS notification.
  permissions: BrowserApi['permissions']
  requests: readonly BridgePendingRequest[]
  openRequest: RequestTarget | null
  openedRequest(): void
}) {
  const nodeId = props.nodeId
  const [projects, setProjects] = createSignal<BridgeProject[] | null>(null)
  const [tasks, setTasks] = createSignal<BridgeTask[] | null>(null)
  const [sessions, setSessions] = createSignal<BridgeAgentSession[] | null>(null)
  const [projectId, setProjectId] = createSignal<string | null>(null)
  const [taskId, setTaskId] = createSignal<string | null>(null)
  const [sessionId, setSessionId] = createSignal<string | null>(null)
  const [problem, setProblem] = createSignal<string | null>(null)
  const [profiles, setProfiles] = createSignal<BridgeAgentProfile[] | null>(null)
  const [starting, setStarting] = createSignal(false)
  const [choice, setChoice] = createSignal<string>('')
  // An unconfirmed start keeps its key, so starting the same chat again can't make a second one.
  const [pendingStart, setPendingStart] = createSignal<{ key: string; taskId: string; choice: string } | null>(null)
  let remembered: Remembered = { projectId: null, taskId: null, sessionId: null }
  // A remembered or handed-off task is on its way, so the page's suggestion mustn't move the project.
  const [restoringTask, setRestoringTask] = createSignal(false)
  const [siteChoices, setSiteChoices] = createSignal<SiteChoices>({})
  // A handed-off item's context, waiting for the person to open a conversation. It goes into that
  // conversation's draft for review, never straight to an agent.
  const [waitingContext, setWaitingContext] = createSignal<PageCapture | null>(null)
  // A task a handoff opened. When its conversations load, the newest opens, or the new-chat picker
  // shows when it has none.
  let openingTask: string | null = null

  const report = (error: unknown) => {
    // A reply refused because the Node changed under it is expected, and a missing bridge has its banner.
    if (error instanceof CallFailure && (error.code === 'not_selected' || error.code === 'host_unavailable')) return
    setProblem(error instanceof CallFailure ? errorGuidance(error) : String(error))
  }

  const loadProjects = async () => {
    setProblem(null)
    try {
      const result = await props.client.call({ op: 'projects.list', nodeId })
      const visible = result.projects.filter((project) => !project.hidden)
      setProjects(visible)
      if (!projectId() && visible.some((project) => project.id === remembered.projectId))
        chooseProject(remembered.projectId)
      else if (!projectId()) setRestoringTask(false)
    } catch (error) {
      setProjects(null)
      report(error)
    }
  }

  const loadTasks = async (forProject: string) => {
    try {
      const result = await props.client.call({ op: 'tasks.list', nodeId, projectId: forProject })
      if (projectId() !== forProject) return
      setTasks(result.tasks)
      if (!taskId() && result.tasks.some((task) => task.id === remembered.taskId)) chooseTask(remembered.taskId)
      setRestoringTask(false)
    } catch (error) {
      if (projectId() !== forProject) return
      setRestoringTask(false)
      report(error)
    }
  }

  const loadSessions = async (forTask: string) => {
    try {
      const result = await props.client.call({ op: 'sessions.list', nodeId, taskId: forTask })
      if (taskId() !== forTask) return
      setSessions(result.sessions)
      if (openingTask === forTask) {
        openingTask = null
        const newest = result.sessions[0]
        if (newest) void openSession(forTask, newest.id)
        else void loadProfiles()
        return
      }
      if (!sessionId() && result.sessions.some((session) => session.id === remembered.sessionId))
        chooseSession(remembered.sessionId)
    } catch (error) {
      if (taskId() === forTask) report(error)
    }
  }

  const loadProfiles = async () => {
    try {
      const result = await props.client.call({ op: 'agents.profiles', nodeId })
      setProfiles(result.profiles)
      setChoice(result.profiles.find((profile) => !unavailableReason(profile))?.providerId ?? '')
    } catch (error) {
      report(error)
    }
  }

  // Each choice clears the ones below it in the same batch, so a conversation is never mounted with
  // a task it doesn't belong to.
  function chooseProject(id: string | null) {
    batch(() => {
      setProjectId(id)
      setTasks(null)
      setTaskId(null)
      setSessions(null)
      setSessionId(null)
    })
    if (id) void loadTasks(id)
  }
  function chooseTask(id: string | null) {
    batch(() => {
      setTaskId(id)
      setSessions(null)
      setSessionId(null)
    })
    if (id) void loadSessions(id)
  }
  const chooseSession = (id: string | null) => setSessionId(id)

  // Only the person's own choices are remembered, so a restore that stops part-way loses nothing.
  const choose = (pick: () => void) => {
    pick()
    void saveDestination(props.storage, nodeId, { projectId: projectId(), taskId: taskId(), sessionId: sessionId() })
  }

  // The person opened a conversation. Waiting context joins its stored draft first, through the same
  // helper a send that finished elsewhere uses, so the composer finds it when it mounts.
  async function openSession(forTask: string, id: string) {
    const capture = waitingContext()
    if (capture) {
      try {
        await changeDraft(props.storage, { nodeId, taskId: forTask, sessionId: id }, (draft) => {
          const captures = draft.captures ?? []
          // The same item handed off twice is one capture.
          if (captures.some((other) => other.kind === 'context' && other.url === capture.url)) return draft
          return { ...draft, captures: withCapture(captures, capture) }
        })
        setWaitingContext(null)
      } catch (error) {
        setProblem(
          error instanceof CaptureFailure
            ? error.message
            : 'Browser storage is full, so the item was not added to the draft.',
        )
      }
    }
    if (taskId() === forTask) choose(() => chooseSession(id))
  }

  const openHandoffTask = (forProject: string, forTask: string, capture: PageCapture) => {
    setWaitingContext(capture)
    remembered = { projectId: forProject, taskId: forTask, sessionId: null }
    setRestoringTask(true)
    openingTask = forTask
    props.dismissHandoff()
    choose(() => chooseProject(forProject))
  }

  const chooseHandoffTask = (forProject: string | null, capture: PageCapture) => {
    setWaitingContext(capture)
    props.dismissHandoff()
    if (forProject) choose(() => chooseProject(forProject))
  }

  const start = async () => {
    const forTask = taskId()
    const profile = profiles()?.find((candidate) => candidate.providerId === choice())
    if (!forTask || !profile || unavailableReason(profile) || starting()) return
    const previous = pendingStart()
    const key =
      previous && previous.taskId === forTask && previous.choice === profile.providerId
        ? previous.key
        : crypto.randomUUID()
    setPendingStart({ key, taskId: forTask, choice: profile.providerId })
    setStarting(true)
    setProblem(null)
    try {
      const { session } = await props.client.call({
        op: 'session.create',
        nodeId,
        taskId: forTask,
        providerId: profile.providerId,
        profileId: profile.profileId,
        key,
      })
      setPendingStart(null)
      setProfiles(null)
      if (taskId() !== forTask) return
      setSessions((current) => [session, ...(current ?? []).filter((row) => row.id !== session.id)])
      await openSession(forTask, session.id)
    } catch (error) {
      if (error instanceof CallFailure && UNCERTAIN.has(error.code))
        setProblem("The Node didn't confirm the new chat. Start it again to retry; the Node won't make a second one.")
      else report(error)
    } finally {
      setStarting(false)
    }
  }

  // Projects for the page beside the sidebar. Every project with an association covering the page is a
  // candidate. The person's choice on this site, if any, replaces them; otherwise a single candidate is
  // the suggestion and several are left to the picker.
  const scope = createMemo(() =>
    pageScope(props.sites, new Set((projects() ?? []).map((project) => project.id)), siteChoices(), props.pageUrl),
  )
  const suggested = () => scope().suggested
  const choiceKey = () => scope().choiceKey
  const pageProjects = createMemo((): string[] => scope().projects, [], { equals: (a, b) => a.join() === b.join() })
  // Follows the page only while no task is chosen: one candidate is chosen, and a project the page's
  // candidates leave out is cleared so the person picks one. An unmatched page changes nothing. A
  // chosen task, with its conversation and draft, stays put; the notice below says what the page
  // suggests instead.
  createEffect(
    on([pageProjects, restoringTask], ([ids, restoring]) => {
      if (restoring || taskId() !== null) return
      const current = projectId()
      if (ids.length === 1 && ids[0] !== current) chooseProject(ids[0]!)
      else if (ids.length > 1 && current && !ids.includes(current)) chooseProject(null)
    }),
  )
  // The waiting requests the sidebar lists: the page's projects, as the badge counts them, or the
  // project chosen in the picker when the page suggests none.
  const waitingScope = (): string[] => {
    if (pageProjects().length) return pageProjects()
    const chosen = projectId()
    return chosen ? [chosen] : []
  }
  const waiting = () => props.requests.filter((request) => waitingScope().includes(request.projectId))
  const waitingOn = () => {
    const names = waitingScope().map((id) => projectName(id))
    return names.length ? names.join(' or ') : 'this page'
  }

  // Opens a request's conversation the way a remembered destination is restored: project, then task,
  // then conversation, each once its list has loaded.
  const openConversation = (target: Pick<RequestTarget, 'projectId' | 'taskId' | 'sessionId'>) => {
    remembered = { projectId: target.projectId, taskId: target.taskId, sessionId: target.sessionId }
    setRestoringTask(true)
    chooseProject(target.projectId)
    void saveDestination(props.storage, nodeId, remembered)
  }
  createEffect(
    on([() => props.openRequest, projects], ([target, loaded]) => {
      if (!target || !loaded) return
      props.openedRequest()
      if (target.nodeId === nodeId) openConversation(target)
    }),
  )

  const mismatch = () => (taskId() && !pageProjects().includes(projectId()!) ? pageProjects() : [])

  // The person picked a project. When it differs from what this site suggests, it is remembered for
  // the site, so coming back here shows it again.
  const pickProject = (id: string | null) => {
    setRestoringTask(false)
    choose(() => chooseProject(id))
    const key = choiceKey()
    if (key === null) return
    const plain = suggested().length === 1 ? suggested()[0]! : null
    const next = { ...siteChoices() }
    if (id === plain) delete next[key]
    else next[key] = id ?? ''
    setSiteChoices(next)
    void saveSiteChoices(props.storage, nodeId, next)
  }

  onMount(async () => {
    remembered = await loadDestination(props.storage, nodeId)
    setRestoringTask(remembered.taskId !== null)
    setSiteChoices(await loadSiteChoices(props.storage, nodeId))
    await loadProjects()
  })

  // Another client started, renamed, or finished a conversation in this task, or the Node dropped
  // frames: read the list again. The open conversation reads its own hints.
  createEffect(
    on(
      () => props.hint,
      (hint) => {
        const forTask = taskId()
        if (hint?.nodeId === nodeId && forTask && (hint.missed || hint.tasks.includes(forTask)))
          void loadSessions(forTask)
      },
      { defer: true },
    ),
  )
  createEffect(
    on(
      () => props.reconnects,
      () => {
        if (!projects()) void loadProjects()
        const forTask = taskId()
        if (forTask) void loadSessions(forTask)
      },
      { defer: true },
    ),
  )

  const project = () => projects()?.find((row) => row.id === projectId()) ?? null
  const projectName = (id: string) => projects()?.find((row) => row.id === id)?.name ?? id
  const task = () => tasks()?.find((row) => row.id === taskId()) ?? null
  const session = () => sessions()?.find((row) => row.id === sessionId()) ?? null

  return (
    <>
      <Show when={props.handoff} keyed>
        {(handoff) => (
          <Handoff
            client={props.client}
            nodeId={nodeId}
            handoff={handoff}
            online={props.online}
            openTask={openHandoffTask}
            chooseTask={chooseHandoffTask}
            dismiss={props.dismissHandoff}
          />
        )}
      </Show>
      <Show when={waitingContext()}>
        {(capture) => (
          <section class="card notice" aria-label="Waiting context">
            <p>{capture().title} goes into the draft of the conversation you open next.</p>
            <button type="button" class="quiet" onClick={() => setWaitingContext(null)}>
              Leave it out
            </button>
          </section>
        )}
      </Show>
      <Waiting
        permissions={props.permissions}
        requests={waiting()}
        scope={waitingOn()}
        open={(request) => openConversation(request)}
      />
      <section class="card" aria-label="Destination">
        <Show when={problem()}>
          <p class="problem" role="alert">
            {problem()}
          </p>
        </Show>
        <Show
          when={projects()}
          fallback={<p class="quiet">{problem() ? 'Projects are unavailable.' : 'Loading projects…'}</p>}
        >
          {(loaded) => (
            <Show when={loaded().length} fallback={<p class="quiet">No projects.</p>}>
              <label>
                Project
                <select name="project" onChange={(event) => pickProject(event.currentTarget.value || null)}>
                  <option value="" selected={!projectId()}>
                    Choose a project
                  </option>
                  <Show
                    when={suggested().length}
                    fallback={<ProjectOptions projects={loaded()} selected={projectId()} />}
                  >
                    <optgroup label="Suggested for this page">
                      <ProjectOptions
                        projects={loaded().filter((row) => suggested().includes(row.id))}
                        selected={projectId()}
                      />
                    </optgroup>
                    <optgroup label="Other projects">
                      <ProjectOptions
                        projects={loaded().filter((row) => !suggested().includes(row.id))}
                        selected={projectId()}
                      />
                    </optgroup>
                  </Show>
                </select>
              </label>
            </Show>
          )}
        </Show>
        <Show when={!projectId() && pageProjects().length > 1}>
          <p class="notice">Several projects match this page. Choose one.</p>
        </Show>
        <Show when={mismatch().length}>
          <div class="notice" data-testid="page-mismatch">
            <p>
              This page suggests {mismatch().map(projectName).join(' or ')}. The conversation stays in {project()?.name}
              .
            </p>
            <For each={mismatch()}>
              {(id) => (
                <button type="button" class="quiet" onClick={() => pickProject(id)}>
                  Switch to {projectName(id)}
                </button>
              )}
            </For>
          </div>
        </Show>
        <Show when={projectId()} keyed>
          {(chosen) => (
            <ProjectSites
              client={props.client}
              nodeId={nodeId}
              projectId={chosen}
              sites={props.sites
                .filter((site) => site.projectId === chosen)
                .map(({ origin, pathPrefix }) => ({ origin, pathPrefix }))}
              pageUrl={props.pageUrl}
              online={props.online}
              changed={props.sitesChanged}
            />
          )}
        </Show>
        <Show when={projectId()}>
          <Show when={tasks()} fallback={<p class="quiet">Loading tasks…</p>}>
            {(loaded) => (
              <Show when={loaded().length} fallback={<p class="quiet">This project has no open tasks.</p>}>
                <label>
                  Task
                  <select name="task" onChange={(event) => choose(() => chooseTask(event.currentTarget.value || null))}>
                    <option value="" selected={!taskId()}>
                      Choose a task
                    </option>
                    <For each={loaded()}>
                      {(row) => (
                        <option value={row.id} selected={row.id === taskId()}>
                          {row.title}
                        </option>
                      )}
                    </For>
                  </select>
                </label>
              </Show>
            )}
          </Show>
        </Show>
        <Show when={taskId()}>
          <Show when={sessions()} fallback={<p class="quiet">Loading conversations…</p>}>
            {(loaded) => (
              <Show when={loaded().length} fallback={<p class="quiet">This task has no conversation yet.</p>}>
                <label>
                  Conversation
                  <select
                    name="session"
                    onChange={(event) => {
                      const id = event.currentTarget.value
                      if (id) void openSession(taskId()!, id)
                      else choose(() => chooseSession(null))
                    }}
                  >
                    <option value="" selected={!sessionId()}>
                      Choose a conversation
                    </option>
                    <For each={loaded()}>
                      {(row) => (
                        <option value={row.id} selected={row.id === sessionId()}>
                          {row.title}
                        </option>
                      )}
                    </For>
                  </select>
                </label>
              </Show>
            )}
          </Show>
          <Show
            when={profiles()}
            fallback={
              <button type="button" class="quiet" onClick={() => void loadProfiles()}>
                New chat
              </button>
            }
          >
            {(loaded) => (
              <Show
                when={loaded().some((profile) => !unavailableReason(profile))}
                fallback={
                  <p class="notice">
                    No agent can start on this Node.{' '}
                    {loaded()
                      .map((profile) => `${profile.label}: ${unavailableReason(profile)}`)
                      .join('. ')}
                  </p>
                }
              >
                <div class="row">
                  <select name="profile" onChange={(event) => setChoice(event.currentTarget.value)}>
                    <For each={loaded()}>
                      {(profile) => (
                        <option
                          value={profile.providerId}
                          disabled={unavailableReason(profile) !== null}
                          selected={profile.providerId === choice()}
                        >
                          {unavailableReason(profile)
                            ? `${profile.label} (${unavailableReason(profile)})`
                            : profile.label}
                        </option>
                      )}
                    </For>
                  </select>
                  <button type="button" disabled={starting() || !props.online} onClick={() => void start()}>
                    {starting() ? 'Starting…' : 'Start chat'}
                  </button>
                  <button type="button" class="quiet" onClick={() => setProfiles(null)}>
                    Cancel
                  </button>
                </div>
              </Show>
            )}
          </Show>
        </Show>
      </section>

      <Show when={sessionId()} keyed>
        {(chosen) => (
          <Conversation
            client={props.client}
            storage={props.storage}
            target={{ nodeId, taskId: taskId()!, sessionId: chosen }}
            lastEventSeq={session()?.lastEventSeq ?? 0}
            destination={[props.nodeLabel, project()?.name, task()?.title, session()?.title]
              .filter(Boolean)
              .join(' › ')}
            online={props.online}
            hint={props.hint}
            reconnects={props.reconnects}
            capture={props.capture}
          />
        )}
      </Show>
    </>
  )
}

function ProjectOptions(props: { projects: readonly BridgeProject[]; selected: string | null }) {
  return (
    <For each={props.projects}>
      {(row) => (
        <option value={row.id} selected={row.id === props.selected}>
          {row.name}
        </option>
      )}
    </For>
  )
}
