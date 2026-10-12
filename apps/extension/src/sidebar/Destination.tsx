import { For, Show, batch, createEffect, createSignal, on, onMount } from 'solid-js'
import type {
  BridgeAgentHint,
  BridgeAgentProfile,
  BridgeAgentSession,
  BridgeProject,
  BridgeTask,
} from '@acorn/protocol/extensionBridge.ts'
import type { BrowserApi } from '../browser'
import { CallFailure } from '../messages'
import type { BridgeClient } from './bridgeClient'
import type { CaptureKind, PageCapture } from './capture'
import { Conversation } from './Conversation'
import { errorGuidance } from './guidance'
import { loadDestination, saveDestination, type Destination as Remembered } from './localState'

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
    } catch (error) {
      if (projectId() === forProject) report(error)
    }
  }

  const loadSessions = async (forTask: string) => {
    try {
      const result = await props.client.call({ op: 'sessions.list', nodeId, taskId: forTask })
      if (taskId() !== forTask) return
      setSessions(result.sessions)
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
      choose(() => chooseSession(session.id))
    } catch (error) {
      if (error instanceof CallFailure && UNCERTAIN.has(error.code))
        setProblem("The Node didn't confirm the new chat. Start it again to retry; the Node won't make a second one.")
      else report(error)
    } finally {
      setStarting(false)
    }
  }

  onMount(async () => {
    remembered = await loadDestination(props.storage, nodeId)
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
  const task = () => tasks()?.find((row) => row.id === taskId()) ?? null
  const session = () => sessions()?.find((row) => row.id === sessionId()) ?? null

  return (
    <>
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
                <select
                  name="project"
                  onChange={(event) => choose(() => chooseProject(event.currentTarget.value || null))}
                >
                  <option value="" selected={!projectId()}>
                    Choose a project
                  </option>
                  <For each={loaded()}>
                    {(row) => (
                      <option value={row.id} selected={row.id === projectId()}>
                        {row.name}
                      </option>
                    )}
                  </For>
                </select>
              </label>
            </Show>
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
                    onChange={(event) => choose(() => chooseSession(event.currentTarget.value || null))}
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
