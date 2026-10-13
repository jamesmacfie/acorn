import { For, Match, Show, Switch, createEffect, createSignal } from 'solid-js'
import type {
  BridgeAgentSession,
  BridgeHandoff,
  BridgePendingRequest,
  BridgeProject,
  BridgeSessionRead,
  BridgeTask,
} from '@acorn/protocol/extensionBridge.ts'
import { parseSiteAddress, type SiteAssociation } from '@acorn/protocol/siteAssociations.ts'
import { itemTaskLink, projectLink } from '../acornLinks'
import { pageHandoffs, type PageHandoff } from '../handoffs'
import { CallFailure } from '../messages'
import type { PageTask } from '../taskPages'
import { AgentSelect, agentChoice } from './agentChoice'
import type { BridgeClient } from './bridgeClient'
import type { PageCapture } from './capture'
import { conversationItems } from './conversationWindow'
import { errorGuidance } from './guidance'
import { Handoff } from './Handoff'
import { OpenInAcorn } from './OpenInAcorn'
import { State, agentName, agentState } from './state'

// Home's sections below Waiting for you. Workspace owns the state they draw.

// What the panel knows about the page beside it, in one of four states: a task it belongs to, an
// item no task holds yet, a project site with no item, or nothing. A handoff in progress replaces them.
// docs/browser-extension/task-pages.md.
export function ThisPage(props: {
  client: BridgeClient
  nodeId: string
  online: boolean
  opensLinks: boolean
  pageUrl: string | undefined
  handoffs: readonly BridgeHandoff[]
  // The tasks the page belongs to, matched in the browser.
  pageTasks: readonly PageTask[]
  projectName(id: string): string
  // Opens a task's newest conversation, or the new-chat picker when it has none.
  chat(projectId: string, taskId: string): void
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
  // The page is on a site tied to a project, or the person chose a project for it.
  onSite: boolean
  sitesChanged(projectId: string, sites: SiteAssociation[]): void
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
      <Switch>
        <Match when={props.handoff} keyed>
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
        </Match>
        <Match when={!props.pageUrl}>
          <p class="quiet">Acorn can't read this page. Click the Acorn button in the toolbar while it's showing.</p>
        </Match>
        <Match when={props.pageTasks.length}>
          <ul class="rows" aria-label="Page tasks">
            <For each={props.pageTasks}>
              {({ task, source }) => (
                <li>
                  <div class="grow">
                    <strong>{task.title}</strong>
                    <span class="quiet">
                      Task in {props.projectName(task.projectId)}
                      {task.branch ? ` · ${task.branch}` : ''}
                    </span>
                  </div>
                  <OpenInAcorn href={itemTaskLink(props.nodeId, source, task.id)} opensLinks={props.opensLinks} />
                  <button type="button" class="quiet" onClick={() => props.chat(task.projectId, task.id)}>
                    Chat
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Match>
        {/* Looking the page up sends its address to the Node, so it waits for the person's click. */}
        <Match when={offers().length}>
          <div class="row">
            <span class="quiet grow">No task in Acorn for this yet.</span>
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
        </Match>
        <Match when={props.onSite}>
          <SiteProject {...props} />
        </Match>
        <Match when={props.pageUrl}>
          {(url) => (
            <TieSite
              client={props.client}
              nodeId={props.nodeId}
              online={props.online}
              pageUrl={url()}
              projects={props.projects}
              changed={props.sitesChanged}
            />
          )}
        </Match>
      </Switch>
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
    </section>
  )
}

// A page on a project's site with no item: the project its associations suggest, its open tasks to
// make current, and New task, which opens the project in the desktop app.
function SiteProject(props: {
  nodeId: string
  opensLinks: boolean
  projects: readonly BridgeProject[] | null
  suggested: readonly string[]
  several: boolean
  project: string | null
  pickProject(id: string | null): void
  tasks: readonly BridgeTask[] | null
  currentTaskId: string | null
  pickTask(projectId: string, taskId: string): void
}) {
  return (
    <>
      <Show when={props.projects} fallback={<p class="quiet">Projects show once the Node answers.</p>}>
        {(loaded) => (
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
        )}
      </Show>
      <Show when={props.several}>
        <p class="notice">Several projects match this page. Choose one.</p>
      </Show>
      <Show when={props.project}>
        {(projectId) => (
          <>
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
            <OpenInAcorn
              href={projectLink(props.nodeId, projectId())}
              opensLinks={props.opensLinks}
              label="New task in Acorn"
              class="quiet"
            />
          </>
        )}
      </Show>
    </>
  )
}

// A page that matches nothing: one line, and an offer to tie its site to a project, so the panel
// suggests that project here from now on (docs/browser-extension/project-sites.md).
function TieSite(props: {
  client: BridgeClient
  nodeId: string
  online: boolean
  pageUrl: string
  projects: readonly BridgeProject[] | null
  changed(projectId: string, sites: SiteAssociation[]): void
}) {
  const [projectId, setProjectId] = createSignal('')
  const [busy, setBusy] = createSignal(false)
  const [problem, setProblem] = createSignal<string | null>(null)
  const site = () => {
    const parsed = parseSiteAddress(props.pageUrl)
    return parsed.ok ? { origin: parsed.site.origin, pathPrefix: '/' } : null
  }
  const tie = async (forSite: SiteAssociation) => {
    setBusy(true)
    setProblem(null)
    try {
      const result = await props.client.call({
        op: 'site.add',
        nodeId: props.nodeId,
        projectId: projectId(),
        site: forSite,
      })
      props.changed(result.projectId, result.sites)
    } catch (error) {
      setProblem(error instanceof CallFailure ? errorGuidance(error) : String(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <p class="quiet">Nothing in Acorn matches this page.</p>
      <Show when={site()}>
        {(forSite) => (
          <Show when={props.projects?.length}>
            <div class="row">
              <select
                name="tie-project"
                aria-label="Project"
                onChange={(event) => setProjectId(event.currentTarget.value)}
              >
                <option value="" selected={!projectId()}>
                  Choose a project
                </option>
                <ProjectOptions projects={props.projects ?? []} selected={projectId()} />
              </select>
              <button
                type="button"
                class="quiet"
                disabled={!projectId() || busy() || !props.online}
                onClick={() => void tie(forSite())}
              >
                Tie {forSite().origin} to it
              </button>
            </div>
          </Show>
        )}
      </Show>
      <Show when={problem()}>
        {(message) => (
          <p class="problem" role="alert">
            {message()}
          </p>
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
