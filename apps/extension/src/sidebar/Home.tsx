import { For, Match, Show, Switch, createEffect, createSignal, onMount } from 'solid-js'
import type {
  BridgeAgentChoice,
  BridgeAgentSession,
  BridgeHandoff,
  BridgePageTask,
  BridgePendingRequest,
  BridgeProject,
  BridgeWorkspace,
} from '@acorn/protocol/extensionBridge.ts'
import Icon from '@acorn/client-core/kit/components/content/Icon.tsx'
import Picker from '@acorn/client-core/kit/components/inputs/Picker.tsx'
import { Chip, Field } from '@acorn/client-core/kit/components/primitives.tsx'
import { brandMarkRegistry } from '@acorn/client-core/kit/tokens'
import { runtimeIcon, runtimeTone } from '@acorn/plugin-agents/contract/runtimeState.ts'
import { projectLink } from '../acornLinks'
import type { BrowserApi } from '../browser'
import { onHandoffPage, pageHandoffs, type PageHandoff } from '../handoffs'
import type { AgentCounts, PageTask } from '../taskPages'
import { AgentPicker, agentChoice } from './agentChoice'
import type { BridgeClient } from './bridgeClient'
import type { PageCapture } from '../capture'
import { CAPTURE_NAMES } from './Composer'
import { Handoff } from './Handoff'
import { OpenInAcorn } from './OpenInAcorn'
import { openTabs } from './openTabs'
import { State } from './state'
import { PageTaskRow, TaskRow } from './TaskRow'

// Home's sections below Needs you. Workspace owns the state they draw.

// What the panel knows about the page beside it, in one of three states: a task it belongs to, an
// item no task holds yet, or a project site with no item. A handoff in progress replaces them, and a
// page that matches nothing never gets here.
// docs/browser-extension/task-pages.md.
export function ThisPage(props: {
  client: BridgeClient
  api: BrowserApi
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
  projectWorkspace(id: string): string | undefined
  agents(taskId: string): AgentCounts
  openTask(taskId: string): void
  handoff: PageHandoff | null
  startHandoff(handoff: PageHandoff): void
  dismissHandoff(): void
  createdHandoffTask(projectId: string, taskId: string, item: PageCapture): void
  startedHandoffWorkflow(projectId: string, taskId: string, runId: string): void
  projects: readonly BridgeProject[] | null
  suggested: readonly string[]
  // The page is on a site tied to a project, or the person chose a project for it.
  onSite: boolean
  project: string | null
  pickProject(id: string | null): void
  // The open tasks of the project shown for a project site, and the tasks the page belongs to.
  tasks: readonly BridgePageTask[]
  pageTaskIds: readonly string[]
}) {
  const offers = () => pageHandoffs(props.handoffs, props.pageUrl)
  const host = () => (props.pageUrl && URL.canParse(props.pageUrl) ? new URL(props.pageUrl).host : '')

  // Home looks up the item on the page beside it. A page several handoffs match waits for the person
  // to pick one.
  createEffect(() => {
    const only = offers().length === 1 ? offers()[0]! : null
    if (!only || props.handoff || props.pageTasks.length || !props.online) return
    props.startHandoff({
      pluginId: only.pluginId,
      handoffId: only.id,
      label: only.label,
      url: props.pageUrl!,
      auto: true,
    })
  })

  return (
    <section class="this-page" aria-label="This page">
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
              projectName={props.projectName}
              projectWorkspace={props.projectWorkspace}
              agents={props.agents}
              openTask={props.openTask}
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
                <PageTaskRow
                  title={task.title}
                  project={props.projectName(task.projectId)}
                  branch={task.branch}
                  agents={props.agents(task.id)}
                  state={
                    <Show when={page.status}>
                      {(status) => (
                        <State tone={status().tone}>
                          {status().label} {status().state}
                        </State>
                      )}
                    </Show>
                  }
                  onPress={() => props.openTask(task.id)}
                />
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
        {/* A page several handoffs match, or an offline Node, leaves it to a click. */}
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
    </section>
  )
}

// A page on a project's site with no item: a project picker that lists the projects the site's
// associations suggest first, the chosen project's open tasks, and New task in Acorn, which opens the
// project in the desktop app.
function SiteProject(props: {
  api: BrowserApi
  nodeId: string
  opensLinks: boolean
  projects: readonly BridgeProject[] | null
  projectWorkspace(id: string): string | undefined
  suggested: readonly string[]
  project: string | null
  pickProject(id: string | null): void
  tasks: readonly BridgePageTask[]
  pageTaskIds: readonly string[]
  agents(taskId: string): AgentCounts
  openTask(taskId: string): void
}) {
  const tabs = openTabs(props.api)
  // Suggested projects first, each group in the Node's order.
  const items = (projects: readonly BridgeProject[]) =>
    [true, false].flatMap((suggested) =>
      projects
        .filter((project) => props.suggested.includes(project.id) === suggested)
        .map((project) => ({
          id: project.id,
          label: project.name,
          note: props.projectWorkspace(project.id),
          ...(props.suggested.length ? { group: suggested ? 'Suggested for this page' : 'Other projects' } : {}),
          active: project.id === props.project,
        })),
    )

  return (
    <>
      <Show when={props.projects} fallback={<p class="quiet">Projects show once the Node answers.</p>}>
        {(loaded) => (
          <Field label="Project" layout="row">
            <Picker
              label={loaded().find((project) => project.id === props.project)?.name ?? 'Choose a project'}
              ariaLabel="Project"
              size="sm"
              placeholder="Filter projects"
              emptyText="No project matches."
              items={items(loaded())}
              onPick={props.pickProject}
            />
          </Field>
        )}
      </Show>
      <Show when={props.project}>
        {(projectId) => (
          <>
            <Show when={props.tasks.length} fallback={<p class="quiet">This project has no open tasks.</p>}>
              <ul class="task-rows" aria-label="Tasks">
                <For each={props.tasks}>
                  {(task) => (
                    <TaskRow
                      api={props.api}
                      tabs={tabs()}
                      task={task}
                      here={props.pageTaskIds.includes(task.id)}
                      agents={props.agents(task.id)}
                      openTask={props.openTask}
                    />
                  )}
                </For>
              </ul>
            </Show>
            <div class="row">
              <OpenInAcorn
                href={projectLink(props.nodeId, projectId())}
                opensLinks={props.opensLinks}
                label="New task in Acorn"
              />
            </div>
          </>
        )}
      </Show>
    </>
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
                  {(task) => (
                    <TaskRow
                      api={props.api}
                      tabs={tabs()}
                      task={task}
                      here={props.pageTaskIds.includes(task.id)}
                      agents={props.agents(task.id)}
                      openTask={props.openTask}
                    />
                  )}
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
// person. A row opens it, and New chat's picker starts another. The item waiting for the task's first
// conversation shows as a chip the person can remove.
export function Agents(props: {
  client: BridgeClient
  nodeId: string
  taskId: string
  online: boolean
  sessions: readonly BridgeAgentSession[] | null
  requests: readonly BridgePendingRequest[]
  pendingItem: PageCapture | null
  dropPendingItem(): void
  open(sessionId: string): void
  started(session: BridgeAgentSession): void
}) {
  const waiting = (sessionId: string) => props.requests.some((request) => request.sessionId === sessionId)

  return (
    <section aria-label="Agents">
      <Show when={props.pendingItem}>
        {(item) => (
          <div class="pending-item" aria-label="Pending item">
            <Chip
              leading={<Icon name={item().kind === 'link' ? 'link' : 'file-text'} />}
              onRemove={() => props.dropPendingItem()}
            >
              {CAPTURE_NAMES[item().kind]} · {item().title}
            </Chip>
            <span class="quiet">Goes with your first message.</span>
          </div>
        )}
      </Show>
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
