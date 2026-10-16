import { For, Match, Show, Switch, createEffect, createSignal, onMount } from 'solid-js'
import type {
  BridgeAgentChoice,
  BridgeAgentSession,
  BridgeHandoff,
  BridgePageTask,
  BridgePendingRequest,
  BridgeProject,
  BridgeTask,
  BridgeWorkspace,
} from '@acorn/protocol/extensionBridge.ts'
import Icon from '@acorn/client-core/kit/components/content/Icon.tsx'
import { IconButton } from '@acorn/client-core/kit/components/inputs'
import Picker from '@acorn/client-core/kit/components/inputs/Picker.tsx'
import { Row } from '@acorn/client-core/kit/components/primitives.tsx'
import { brandMarkRegistry } from '@acorn/client-core/kit/tokens'
import { agentRailMarkers, runtimeIcon, runtimeTone } from '@acorn/plugin-agents/contract/runtimeState.ts'
import { projectLink } from '../acornLinks'
import type { BrowserApi } from '../browser'
import { onHandoffPage, pageHandoffs, type PageHandoff } from '../handoffs'
import type { AgentCounts, PageTask } from '../taskPages'
import { AgentPicker, agentChoice } from './agentChoice'
import type { BridgeClient } from './bridgeClient'
import type { PageCapture } from '../capture'
import { Handoff } from './Handoff'
import { OpenInAcorn } from './OpenInAcorn'
import { openTabs, showPage, tabFor } from './openTabs'
import { State } from './state'

// Home's sections below Needs you. Workspace owns the state they draw.

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
  agents(taskId: string): AgentCounts
  openTask(taskId: string): void
  handoff: PageHandoff | null
  startHandoff(handoff: PageHandoff): void
  dismissHandoff(): void
  openHandoffTask(projectId: string, taskId: string, capture: PageCapture): void
  createdHandoffTask(projectId: string, taskId: string, capture: PageCapture): void
  startedHandoffWorkflow(projectId: string, taskId: string, runId: string): void
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
}) {
  const offers = () => pageHandoffs(props.handoffs, props.pageUrl)
  const host = () => (props.pageUrl && URL.canParse(props.pageUrl) ? new URL(props.pageUrl).host : '')

  // Home looks up the item on the page beside it, once per page and Node, so a card the person
  // dismissed stays closed. A page several handoffs match waits for the person to pick one.
  let lookedUp = ''
  createEffect(() => {
    const key = `${props.nodeId} ${props.pageUrl}`
    const only = offers().length === 1 ? offers()[0]! : null
    if (!only || props.handoff || props.pageTasks.length || !props.online || key === lookedUp) return
    lookedUp = key
    props.startHandoff({
      pluginId: only.pluginId,
      handoffId: only.id,
      label: only.label,
      url: props.pageUrl!,
      auto: true,
    })
  })

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
              createdTask={props.createdHandoffTask}
              startedWorkflow={props.startedHandoffWorkflow}
              dismiss={props.dismissHandoff}
            />
          )}
        </Match>
        <Match when={props.pageTasks.length}>
          {/* An app a plugin published for the task, such as a running stack, adds the plugin's state. */}
          <ul class="task-rows" aria-label="Page tasks">
            <For each={props.pageTasks}>
              {({ task, page }) => (
                <li>
                  <Row
                    variant="stacked"
                    onPress={() => props.openTask(task.id)}
                    leading={<AgentMark agents={props.agents(task.id)} />}
                    trailing={
                      <>
                        <Show when={page.status}>
                          {(status) => (
                            <State tone={status().tone}>
                              {status().label} {status().state}
                            </State>
                          )}
                        </Show>
                        <Icon name="chevron-right" tone="muted" />
                      </>
                    }
                  >
                    <strong class="row-title">{task.title}</strong>
                    <span class="row-meta">
                      {props.projectName(task.projectId)}
                      <Show when={task.branch}>
                        {(branch) => (
                          <>
                            {' · '}
                            <span class="branch">{branch()}</span>
                          </>
                        )}
                      </Show>
                    </span>
                  </Row>
                </li>
              )}
            </For>
          </ul>
          <For each={props.pageTasks.filter(({ page }) => page.status && props.markerHidden(page.origin))}>
            {({ page }) => (
              <button type="button" class="link" onClick={() => props.showMarker(page.origin)}>
                Show the branch marker on this site
              </button>
            )}
          </For>
        </Match>
        {/* A dismissed card, a page several handoffs match, or an offline Node leaves it to a click. */}
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
// open, and New task, which opens the project in the desktop app.
function SiteProject(props: {
  nodeId: string
  opensLinks: boolean
  projects: readonly BridgeProject[] | null
  suggested: readonly string[]
  several: boolean
  project: string | null
  pickProject(id: string | null): void
  tasks: readonly BridgeTask[] | null
  openTask(taskId: string): void
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
                          <button type="button" class="row-button" onClick={() => props.openTask(task.id)}>
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

// A task's agents as the desktop marks them: an amber alert while one waits on the person, which wins
// over the spinner while one works, and an idle dot otherwise.
function AgentMark(props: { agents: AgentCounts }) {
  const marker = () => agentRailMarkers({ working: props.agents.working, attention: props.agents.waiting })[0]
  return (
    <Show when={marker()} fallback={<span class="idle-dot" aria-hidden="true" />}>
      {(shown) => <Icon name={shown().icon!} tone={shown().tone} spin={shown().busy} title={shown().label} />}
    </Show>
  )
}

// Home's task list: one workspace's open tasks, grouped by project in the workspace's order, and
// narrowed by title and branch. A row opens its task, whose ⋯ menu has its links.
export function Tasks(props: {
  api: BrowserApi
  workspaces: readonly BridgeWorkspace[] | null
  workspaceId: string | null
  pickWorkspace(id: string): void
  // The workspace's visible projects.
  projects: readonly BridgeProject[]
  tasks: readonly BridgePageTask[]
  pageTaskIds: readonly string[]
  agents(taskId: string): AgentCounts
  openTask(taskId: string): void
}) {
  const tabs = openTabs(props.api)
  const [filter, setFilter] = createSignal('')
  const projectTasks = (projectId: string) => {
    const query = filter().trim().toLowerCase()
    return props.tasks.filter(
      (task) => task.projectId === projectId && `${task.title} ${task.branch ?? ''}`.toLowerCase().includes(query),
    )
  }
  const listed = () => props.projects.some((project) => projectTasks(project.id).length)

  return (
    <section aria-label="Tasks">
      <div class="section-head">
        <h2>Tasks</h2>
        <Show when={props.workspaces}>
          {(workspaces) => (
            <Picker
              label={workspaces().find((workspace) => workspace.id === props.workspaceId)?.name ?? 'Workspace'}
              ariaLabel="Workspace"
              size="sm"
              variant="ghost"
              placement="bottom-end"
              placeholder="Filter workspaces"
              emptyText="No workspace matches."
              items={workspaces().map((workspace) => ({
                id: workspace.id,
                label: workspace.name,
                active: workspace.id === props.workspaceId,
              }))}
              onPick={props.pickWorkspace}
            />
          )}
        </Show>
      </div>
      <label class="filter">
        <Icon name="list-filter" tone="muted" />
        <input
          name="task-filter"
          placeholder="Filter tasks"
          aria-label="Filter tasks"
          value={filter()}
          onInput={(event) => setFilter(event.currentTarget.value)}
        />
      </label>
      <Show
        when={listed()}
        fallback={
          <p class="quiet">{filter().trim() ? 'No open task matches.' : 'This workspace has no open tasks.'}</p>
        }
      >
        <For each={props.projects}>
          {(project) => (
            <Show when={projectTasks(project.id).length}>
              <h3>{project.name}</h3>
              <ul class="task-rows" aria-label={project.name}>
                <For each={projectTasks(project.id)}>
                  {(task) => {
                    const here = () => props.pageTaskIds.includes(task.id)
                    // One of the task's pages open in another tab, such as its pull request.
                    const tabPage = () => (here() ? undefined : task.pages.find((page) => tabFor(tabs(), page)))
                    const agents = () => props.agents(task.id)
                    return (
                      <li>
                        <Row
                          variant="stacked"
                          onPress={() => props.openTask(task.id)}
                          leading={<AgentMark agents={agents()} />}
                          trailing={
                            <Show
                              when={here()}
                              fallback={
                                <Show when={tabPage()}>
                                  {(page) => (
                                    <IconButton
                                      icon="arrow-right-left"
                                      label="Switch to its tab"
                                      onPress={() => void showPage(props.api, tabs(), page())}
                                    />
                                  )}
                                </Show>
                              }
                            >
                              <span class="here">This page</span>
                            </Show>
                          }
                        >
                          <span class="row-title">{task.title}</span>
                          <span class="row-meta">
                            <Show when={task.branch} fallback="Project checkout">
                              {(branch) => <span class="branch">{branch()}</span>}
                            </Show>
                            <Show when={agents().waiting} fallback={agents().working ? ' · working' : ''}>
                              {' · '}
                              <span class="needs-you">needs you</span>
                            </Show>
                          </span>
                        </Row>
                      </li>
                    )
                  }}
                </For>
              </ul>
            </Show>
          )}
        </For>
      </Show>
    </section>
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
// person. A row opens it, and New chat's picker starts another.
export function Agents(props: {
  client: BridgeClient
  nodeId: string
  taskId: string
  online: boolean
  sessions: readonly BridgeAgentSession[] | null
  requests: readonly BridgePendingRequest[]
  open(sessionId: string): void
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
        started={props.started}
      />
    </section>
  )
}

// Starts a conversation in one task from the agent the person picks.
function NewChat(props: {
  client: BridgeClient
  nodeId: string
  taskId: string
  online: boolean
  started(session: BridgeAgentSession): void
}) {
  const agents = agentChoice(props.client, props.nodeId)
  onMount(() => void agents.load())

  const start = async (choice: BridgeAgentChoice) => {
    const session = await agents.start(props.taskId, choice)
    if (session) props.started(session)
  }

  return (
    <>
      <div class="row">
        <AgentPicker agents={agents} disabled={!props.online} pick={(choice) => void start(choice)} />
      </div>
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
