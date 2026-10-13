import { For, Show, createEffect, createSignal } from 'solid-js'
import type {
  BridgeAgentSession,
  BridgeHandoff,
  BridgePendingRequest,
  BridgeProject,
  BridgeSessionRead,
  BridgeTask,
} from '@acorn/protocol/extensionBridge.ts'
import { pageHandoffs, type PageHandoff } from '../handoffs'
import { AgentSelect, agentChoice } from './agentChoice'
import type { BridgeClient } from './bridgeClient'
import type { PageCapture } from './capture'
import { conversationItems } from './conversationWindow'
import { Handoff } from './Handoff'
import { State, agentName, agentState } from './state'

// Home's sections below Waiting for you. Workspace owns the state they draw.

// What the panel knows about the page beside it: the handoffs it matches, a handoff in progress, and
// the project its site associations suggest, with that project's open tasks to make current.
export function ThisPage(props: {
  client: BridgeClient
  nodeId: string
  online: boolean
  opensLinks: boolean
  pageUrl: string | undefined
  handoffs: readonly BridgeHandoff[]
  handoff: PageHandoff | null
  startHandoff(handoff: PageHandoff): void
  dismissHandoff(): void
  openHandoffTask(projectId: string, taskId: string, capture: PageCapture): void
  chooseHandoffTask(capture: PageCapture): void
  startedHandoffTask(
    projectId: string,
    taskId: string,
    sessionId: string,
    draft: { text: string; capture: PageCapture },
  ): void
  waitingContext: PageCapture | null
  dropWaitingContext(): void
  projects: readonly BridgeProject[] | null
  suggested: readonly string[]
  // The page matches several projects and the person hasn't chosen one.
  several: boolean
  project: string | null
  pickProject(id: string | null): void
  tasks: readonly BridgeTask[] | null
  currentTaskId: string | null
  pickTask(projectId: string, taskId: string): void
}) {
  const offers = () => pageHandoffs(props.handoffs, props.pageUrl)
  const host = () => (props.pageUrl && URL.canParse(props.pageUrl) ? new URL(props.pageUrl).host : '')

  return (
    <section aria-label="This page">
      <div class="section-head">
        <h2>This page</h2>
        <span class="quiet">{host()}</span>
      </div>
      <Show when={!props.pageUrl}>
        <p class="quiet">Acorn can't read this page. Click the Acorn button in the toolbar while it's showing.</p>
      </Show>
      {/* Looking the page up sends its address to the Node, so it waits for the person's click. */}
      <Show when={offers().length && !props.handoff}>
        <div class="row">
          <For each={offers()}>
            {(handoff) => (
              <button
                type="button"
                onClick={() =>
                  props.startHandoff({
                    pluginId: handoff.pluginId,
                    handoffId: handoff.id,
                    label: handoff.label,
                    url: props.pageUrl!,
                  })
                }
              >
                Look up in Acorn
              </button>
            )}
          </For>
        </div>
      </Show>
      <Show when={props.handoff} keyed>
        {(handoff) => (
          <Handoff
            client={props.client}
            nodeId={props.nodeId}
            handoff={handoff}
            online={props.online}
            opensLinks={props.opensLinks}
            openTask={props.openHandoffTask}
            chooseTask={props.chooseHandoffTask}
            startedTask={props.startedHandoffTask}
            dismiss={props.dismissHandoff}
          />
        )}
      </Show>
      <Show when={props.waitingContext}>
        {(capture) => (
          <div class="notice row" aria-label="Waiting context">
            <span class="grow">{capture().title} goes into the draft of the conversation you open next.</span>
            <button type="button" class="quiet" onClick={() => props.dropWaitingContext()}>
              Leave it out
            </button>
          </div>
        )}
      </Show>
      <Show when={props.projects} fallback={<p class="quiet">Projects show once the Node answers.</p>}>
        {(loaded) => (
          <Show when={loaded().length} fallback={<p class="quiet">This Node has no projects.</p>}>
            <label>
              Project
              <select name="project" onChange={(event) => props.pickProject(event.currentTarget.value || null)}>
                <option value="" selected={!props.project}>
                  Choose a project
                </option>
                <Show
                  when={props.suggested.length}
                  fallback={<ProjectOptions projects={loaded()} selected={props.project} />}
                >
                  <optgroup label="Suggested for this page">
                    <ProjectOptions
                      projects={loaded().filter((row) => props.suggested.includes(row.id))}
                      selected={props.project}
                    />
                  </optgroup>
                  <optgroup label="Other projects">
                    <ProjectOptions
                      projects={loaded().filter((row) => !props.suggested.includes(row.id))}
                      selected={props.project}
                    />
                  </optgroup>
                </Show>
              </select>
            </label>
          </Show>
        )}
      </Show>
      <Show when={props.several}>
        <p class="notice">Several projects match this page. Choose one.</p>
      </Show>
      <Show when={props.project}>
        {(projectId) => (
          <Show when={props.tasks} fallback={<p class="quiet">Loading tasks…</p>}>
            {(tasks) => (
              <Show when={tasks().length} fallback={<p class="quiet">This project has no open tasks.</p>}>
                <ul class="rows" aria-label="Tasks">
                  <For each={tasks()}>
                    {(task) => (
                      <li>
                        <button
                          type="button"
                          class="row-button"
                          aria-current={task.id === props.currentTaskId}
                          onClick={() => props.pickTask(projectId(), task.id)}
                        >
                          <strong>{task.title}</strong>
                          <Show when={task.branch}>{(branch) => <span class="quiet">{branch()}</span>}</Show>
                        </button>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            )}
          </Show>
        )}
      </Show>
    </section>
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

// How far back a row's last line is looked for.
const TAIL_EVENTS = 20
// shortcut: only the newest conversations get a last line, one read each; raise it if tasks with
// more conversations turn out to be common.
const TAIL_SESSIONS = 10

// The last thing said in each conversation, for its row: read from the conversation's end, and again
// only once the conversation has moved on.
export function lastLines(read: (sessionId: string, afterSeq: number, limit: number) => Promise<BridgeSessionRead>) {
  const [lines, setLines] = createSignal<Record<string, string>>({})
  const readAt = new Map<string, number>()
  return {
    line: (sessionId: string): string | undefined => lines()[sessionId],
    follow(sessions: readonly BridgeAgentSession[]) {
      for (const session of sessions.slice(0, TAIL_SESSIONS)) {
        if (readAt.get(session.id) === session.lastEventSeq) continue
        readAt.set(session.id, session.lastEventSeq)
        void read(session.id, Math.max(0, session.lastEventSeq - TAIL_EVENTS), TAIL_EVENTS)
          .then((page) => {
            const last = conversationItems(page.records).at(-1)
            const text = !last ? '' : last.kind === 'tool' ? last.title : last.text
            setLines((current) => ({ ...current, [session.id]: text.trim().split('\n').at(-1) ?? '' }))
          })
          .catch(() => readAt.delete(session.id))
      }
    },
  }
}

// Every conversation in the current task: its agent, title, state, and last line. A row opens it,
// and New chat starts another.
export function Agents(props: {
  client: BridgeClient
  nodeId: string
  taskId: string
  online: boolean
  sessions: readonly BridgeAgentSession[] | null
  requests: readonly BridgePendingRequest[]
  lines: ReturnType<typeof lastLines>
  open(sessionId: string): void
  newChat: boolean
  setNewChat(open: boolean): void
  started(session: BridgeAgentSession): void
}) {
  createEffect(() => props.sessions && props.lines.follow(props.sessions))
  const waiting = (sessionId: string) => props.requests.some((request) => request.sessionId === sessionId)

  return (
    <section aria-label="Agents">
      <h2>Agents</h2>
      <Show when={props.sessions} fallback={<p class="quiet">Loading conversations…</p>}>
        {(sessions) => (
          <Show when={sessions().length} fallback={<p class="quiet">This task has no conversation yet.</p>}>
            <ul class="rows">
              <For each={sessions()}>
                {(session) => {
                  const state = () => agentState(session, waiting(session.id))
                  return (
                    <li>
                      <button type="button" class="row-button" onClick={() => props.open(session.id)}>
                        <span class="row">
                          <strong class="grow">
                            {agentName(session)} · {session.title}
                          </strong>
                          <State tone={state().tone}>{state().label}</State>
                        </span>
                        <Show when={props.lines.line(session.id)}>{(line) => <span class="quiet">{line()}</span>}</Show>
                      </button>
                    </li>
                  )
                }}
              </For>
            </ul>
          </Show>
        )}
      </Show>
      <NewChat
        client={props.client}
        nodeId={props.nodeId}
        taskId={props.taskId}
        online={props.online}
        open={props.newChat}
        setOpen={props.setNewChat}
        started={props.started}
      />
    </section>
  )
}

// Starts a conversation in one task with the agent the person picks.
function NewChat(props: {
  client: BridgeClient
  nodeId: string
  taskId: string
  online: boolean
  open: boolean
  setOpen(open: boolean): void
  started(session: BridgeAgentSession): void
}) {
  const agents = agentChoice(props.client, props.nodeId)
  createEffect(() => props.open && void agents.load())

  const start = async () => {
    const session = await agents.start(props.taskId)
    if (session) props.started(session)
  }

  return (
    <>
      <Show
        when={props.open}
        fallback={
          <button type="button" class="quiet" onClick={() => props.setOpen(true)}>
            New chat
          </button>
        }
      >
        <div class="row">
          <AgentSelect agents={agents} />
          <Show when={agents.chosen()}>
            <button type="button" disabled={agents.starting() || !props.online} onClick={() => void start()}>
              {agents.starting() ? 'Starting…' : 'Start chat'}
            </button>
          </Show>
          <button type="button" class="quiet" onClick={() => props.setOpen(false)}>
            Cancel
          </button>
        </div>
      </Show>
      <Show when={agents.problem()}>
        {(message) => (
          <p class="problem" role="alert">
            {message()}
          </p>
        )}
      </Show>
    </>
  )
}

// The task the person last used. It stays here whatever page is showing, so a capture always has a
// conversation to go to.
export function CurrentTask(props: { task: BridgeTask | null; projectName: string | null; findTask(): void }) {
  return (
    <section aria-label="Current task">
      <div class="section-head">
        <h2>Current task</h2>
        <button type="button" class="link" onClick={() => props.findTask()}>
          Find a task
        </button>
      </div>
      <Show when={props.task} fallback={<p class="quiet">No task yet. Choose one under This page, or find one.</p>}>
        {(task) => (
          <p>
            <strong>{task().title}</strong>
            <span class="quiet">
              {' '}
              {props.projectName}
              {task().branch ? ` · ${task().branch}` : ''}
            </span>
          </p>
        )}
      </Show>
    </section>
  )
}
