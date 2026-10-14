import { For, Match, Show, Switch, createEffect } from 'solid-js'
import type {
  BridgeAgentSession,
  BridgeHandoff,
  BridgePendingRequest,
  BridgeProject,
  BridgeTask,
} from '@acorn/protocol/extensionBridge.ts'
import Icon from '@acorn/client-core/kit/components/content/Icon.tsx'
import { brandMarkRegistry } from '@acorn/client-core/kit/tokens'
import { runtimeIcon, runtimeTone } from '@acorn/plugin-agents/contract/runtimeState.ts'
import { itemTaskLink, projectLink } from '../acornLinks'
import { onHandoffPage, pageHandoffs, type PageHandoff } from '../handoffs'
import type { PageTask } from '../taskPages'
import { AgentSelect, agentChoice } from './agentChoice'
import type { BridgeClient } from './bridgeClient'
import type { PageCapture } from '../capture'
import { Handoff } from './Handoff'
import { OpenInAcorn } from './OpenInAcorn'
import { State } from './state'

// Home's sections below Waiting for you. Workspace owns the state they draw.

// What the panel knows about the page beside it, in one of three states: a task it belongs to, an
// item no task holds yet, or a project site with no item. A handoff in progress replaces them, and a
// page that matches nothing never gets here.
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
  markerHidden(origin: string): boolean
  showMarker(origin: string): void
  projectName(id: string): string
  // Opens a task's newest conversation, or the new-chat picker when it has none.
  chat(projectId: string, taskId: string): void
  handoff: PageHandoff | null
  startHandoff(handoff: PageHandoff): void
  dismissHandoff(): void
  openHandoffTask(projectId: string, taskId: string, capture: PageCapture): void
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
              onPage={onHandoffPage(props.handoffs, handoff, props.pageUrl)}
              online={props.online}
              opensLinks={props.opensLinks}
              openTask={props.openHandoffTask}
              startedTask={props.startedHandoffTask}
              dismiss={props.dismissHandoff}
            />
          )}
        </Match>
        <Match when={props.pageTasks.length}>
          <ul class="rows" aria-label="Page tasks">
            <For each={props.pageTasks}>
              {({ task, page }) => (
                <li>
                  {/* An app a plugin published for the task is named by its branch, with the
                      plugin's state, and its link goes to the plugin's pane, which has the logs. */}
                  <Show
                    when={page.status}
                    fallback={
                      <div class="grow">
                        <strong>{task.title}</strong>
                        <span class="quiet">
                          Task in {props.projectName(task.projectId)}
                          {task.branch ? ` · ${task.branch}` : ''}
                        </span>
                      </div>
                    }
                  >
                    {(status) => (
                      <div class="grow">
                        <strong>{task.branch ?? task.title}</strong>
                        <span class="quiet">
                          Task: {task.title} · {props.projectName(task.projectId)}
                        </span>
                        <State tone={status().tone}>
                          {status().label} {status().state}
                        </State>
                        <Show when={props.markerHidden(page.origin)}>
                          <button type="button" class="link" onClick={() => props.showMarker(page.origin)}>
                            Show the branch marker on this site
                          </button>
                        </Show>
                      </div>
                    )}
                  </Show>
                  <OpenInAcorn
                    href={itemTaskLink(props.nodeId, page.source, task.id)}
                    opensLinks={props.opensLinks}
                    label={page.status ? 'Logs in Acorn' : undefined}
                  />
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

// The kinds of conversation a task has, grouped and named as the desktop app's Agents sidebar groups them.
const SESSION_GROUPS: { label: string; has(session: BridgeAgentSession): boolean }[] = [
  { label: 'Managed sessions', has: (session) => !session.inline && session.kind !== 'workflow' },
  { label: 'Workflow runs', has: (session) => !session.inline && session.kind === 'workflow' },
  { label: 'Inline chats', has: (session) => session.inline },
]

// A provider's logo, when the agents plugin has one for it (main.tsx registers them).
const providerMark = (providerId: string) =>
  brandMarkRegistry.get(`agents/${providerId}`) ? `brand:agents/${providerId}` : undefined

// Every conversation in the Agents task, grouped by kind. A row is the desktop's: the state as an icon,
// the title, and the provider, model, and state in words, with a mark when the agent waits on the
// person. A row opens it, and New chat starts another.
export function Agents(props: {
  client: BridgeClient
  nodeId: string
  taskId: string
  online: boolean
  sessions: readonly BridgeAgentSession[] | null
  requests: readonly BridgePendingRequest[]
  open(sessionId: string): void
  newChat: boolean
  setNewChat(open: boolean): void
  started(session: BridgeAgentSession): void
}) {
  const waiting = (sessionId: string) => props.requests.some((request) => request.sessionId === sessionId)

  return (
    <section aria-label="Agents">
      <Show when={props.sessions} fallback={<p class="quiet">Loading conversations…</p>}>
        {(sessions) => (
          <Show when={sessions().length} fallback={<p class="quiet">This task has no conversation yet.</p>}>
            <For each={SESSION_GROUPS}>
              {(group) => {
                const rows = () => sessions().filter(group.has)
                return (
                  <Show when={rows().length}>
                    <h3>{group.label}</h3>
                    <ul class="rows" aria-label={group.label}>
                      <For each={rows()}>
                        {(session) => {
                          const icon = () => runtimeIcon(session.runtimeState)
                          return (
                            <li>
                              <button type="button" class="row-button agent-row" onClick={() => props.open(session.id)}>
                                {/* The loader turns, as a working session's does on the desktop. */}
                                <Icon
                                  name={icon()}
                                  tone={runtimeTone(session.runtimeState)}
                                  spin={icon() === 'loader-circle'}
                                />
                                <span class="agent-text">
                                  <strong>{session.title}</strong>
                                  <span class="quiet agent-meta">
                                    <Show when={providerMark(session.providerId)}>
                                      {(mark) => <Icon name={mark()} tone="brand" />}
                                    </Show>
                                    <span>
                                      {[session.providerId, session.model, session.runtimeState]
                                        .filter(Boolean)
                                        .join(' · ')}
                                    </span>
                                  </span>
                                </span>
                                <Show when={waiting(session.id)}>
                                  <Icon name="circle-alert" tone="warn" title="Waiting for you" />
                                </Show>
                              </button>
                            </li>
                          )
                        }}
                      </For>
                    </ul>
                  </Show>
                )
              }}
            </For>
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
export function CurrentTask(props: { task: BridgeTask | null; projectName: string | null }) {
  return (
    <section aria-label="Current task">
      <h2>Current task</h2>
      <Show when={props.task} fallback={<p class="quiet">No task yet. Choose one under This page.</p>}>
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
