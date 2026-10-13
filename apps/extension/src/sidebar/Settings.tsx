import { For, Show, createResource, createSignal, onCleanup, onMount } from 'solid-js'
import type { BridgeHandoff, BridgeNodes, BridgeProject, BridgeTask } from '@acorn/protocol/extensionBridge.ts'
import type { ProjectSite, SiteAssociation } from '@acorn/protocol/siteAssociations.ts'
import type { BrowserApi } from '../browser'
import { STYLES, THEMES, loadAppearance, saveAppearance, type Appearance } from './appearance'
import type { BridgeClient } from './bridgeClient'
import { loadDestination, saveDestination } from './localState'
import { ProjectSites } from './ProjectSites'
import { SiteAccess } from './SiteAccess'

// Everything that isn't the work: the Nodes and pairing, a search for any task, which sites the
// extension may read, each project's sites, notifications, and appearance.
export function Settings(props: {
  api: BrowserApi
  client: BridgeClient
  fleet: BridgeNodes | null
  online: boolean
  pair(): void
  select(nodeId: string): void
  forget(nodeId: string): void
  handoffs: readonly BridgeHandoff[]
  sites: readonly ProjectSite[]
  pageUrl: string | undefined
  sitesChanged(projectId: string, sites: SiteAssociation[]): void
  close(): void
}) {
  return (
    <div class="view" aria-label="Settings">
      <div class="view-head">
        <button type="button" class="icon" aria-label="Back" onClick={() => props.close()}>
          ‹
        </button>
        <span class="title">Settings</span>
      </div>
      <section aria-label="Nodes">
        <h2>Nodes</h2>
        <Show
          when={props.fleet?.nodes.length}
          fallback={
            <p class="quiet">
              {/* Pairings live in the bridge, so until it answers the panel can't say there are none. */}
              {props.fleet
                ? 'No Node is paired with this browser yet.'
                : 'The paired Nodes show once the bridge answers.'}
            </p>
          }
        >
          <ul class="rows">
            <For each={props.fleet?.nodes}>
              {(node) => (
                <li>
                  <div class="grow">
                    <strong>{node.label}</strong>
                    <span class="quiet">{node.endpoint}</span>
                  </div>
                  <Show
                    when={node.nodeId === props.fleet?.activeNodeId}
                    fallback={
                      <button type="button" onClick={() => props.select(node.nodeId)}>
                        Use
                      </button>
                    }
                  >
                    <span class="quiet">Selected</span>
                  </Show>
                  <button type="button" class="quiet" onClick={() => props.forget(node.nodeId)}>
                    Forget
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Show>
        <button type="button" onClick={() => props.pair()}>
          Pair a Node
        </button>
      </section>
      <Show when={props.fleet?.activeNodeId} keyed>
        {(nodeId) => (
          <NodeSettings
            client={props.client}
            storage={props.api.storage.local}
            nodeId={nodeId}
            online={props.online}
            sites={props.sites}
            pageUrl={props.pageUrl}
            sitesChanged={props.sitesChanged}
            chose={props.close}
          />
        )}
      </Show>
      <SiteAccess api={props.api} handoffs={props.handoffs} sites={props.sites} />
      <Notifications permissions={props.api.permissions} />
      <AppearanceSettings storage={props.api.storage.local} />
    </div>
  )
}

// The selected Node's tasks and project sites. Mounted per Node, so a list read for one never fills
// another's.
function NodeSettings(props: {
  client: BridgeClient
  storage: BrowserApi['storage']['local']
  nodeId: string
  online: boolean
  sites: readonly ProjectSite[]
  pageUrl: string | undefined
  sitesChanged(projectId: string, sites: SiteAssociation[]): void
  // A task was chosen; Home opens on it.
  chose(): void
}) {
  const nodeId = props.nodeId
  const [projects, setProjects] = createSignal<BridgeProject[]>([])
  // Every project's active tasks, read once Settings opens. The Node has no search across projects.
  const [tasks, setTasks] = createSignal<{ task: BridgeTask; project: BridgeProject }[] | null>(null)
  const [failed, setFailed] = createSignal(false)
  // The current task's project, to start the sites editor on.
  const [sitesProject, setSitesProject] = createSignal<string | null>(null)
  onMount(async () => {
    setSitesProject((await loadDestination(props.storage, nodeId)).projectId)
    try {
      const result = await props.client.call({ op: 'projects.list', nodeId })
      const visible = result.projects.filter((project) => !project.hidden)
      setProjects(visible)
      const lists = await Promise.all(
        visible.map(async (project) => {
          const listed = await props.client.call({ op: 'tasks.list', nodeId, projectId: project.id })
          return listed.tasks.map((task) => ({ task, project }))
        }),
      )
      setTasks(lists.flat())
    } catch {
      setFailed(true)
    }
  })
  const [query, setQuery] = createSignal('')
  const matches = () => {
    const words = query().trim().toLowerCase()
    return (tasks() ?? []).filter(({ task, project }) =>
      [task.title, task.branch ?? '', project.name].some((field) => field.toLowerCase().includes(words)),
    )
  }
  const choose = async (project: BridgeProject, task: BridgeTask) => {
    await saveDestination(props.storage, nodeId, { projectId: project.id, taskId: task.id, sessionId: null })
    props.chose()
  }

  return (
    <>
      <section aria-label="Tasks">
        <h2>Tasks</h2>
        <input
          name="task-search"
          type="search"
          placeholder="Search tasks by title, branch, or project"
          value={query()}
          onInput={(event) => setQuery(event.currentTarget.value)}
        />
        <Show when={!failed()} fallback={<p class="problem">The tasks couldn't be read. Open Settings again.</p>}>
          <Show when={tasks()} fallback={<p class="quiet">Loading tasks…</p>}>
            <Show when={matches().length} fallback={<p class="quiet">No open task matches.</p>}>
              <ul class="rows">
                <For each={matches()}>
                  {({ task, project }) => (
                    <li>
                      <button type="button" class="row-button" onClick={() => void choose(project, task)}>
                        <strong>{task.title}</strong>
                        <span class="quiet">
                          {project.name}
                          {task.branch ? ` · ${task.branch}` : ''}
                        </span>
                      </button>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </Show>
        </Show>
      </section>
      <Show when={projects().length}>
        <section aria-label="Project sites">
          <h2>Project sites</h2>
          <select name="sites-project" onChange={(event) => setSitesProject(event.currentTarget.value || null)}>
            <option value="" selected={!sitesProject()}>
              Choose a project
            </option>
            <For each={projects()}>
              {(project) => (
                <option value={project.id} selected={project.id === sitesProject()}>
                  {project.name}
                </option>
              )}
            </For>
          </select>
          <Show when={sitesProject()} keyed>
            {(projectId) => (
              <ProjectSites
                client={props.client}
                nodeId={nodeId}
                projectId={projectId}
                sites={props.sites
                  .filter((site) => site.projectId === projectId)
                  .map(({ origin, pathPrefix }) => ({ origin, pathPrefix }))}
                pageUrl={props.pageUrl}
                online={props.online}
                changed={props.sitesChanged}
              />
            )}
          </Show>
        </section>
      </Show>
    </>
  )
}

const NOTIFICATIONS = { permissions: ['notifications'] }

// The opt-in for OS notifications. The browser permission is the setting, so turning it off in the
// browser's settings turns it off here. docs/browser-extension/notifications.md.
export function Notifications(props: { permissions: BrowserApi['permissions'] }) {
  const [allowed, { refetch }] = createResource(() => props.permissions.contains(NOTIFICATIONS))
  const onAccess = () => void refetch()
  onMount(() => {
    props.permissions.onAdded.addListener(onAccess)
    props.permissions.onRemoved.addListener(onAccess)
  })
  onCleanup(() => {
    props.permissions.onAdded.removeListener(onAccess)
    props.permissions.onRemoved.removeListener(onAccess)
  })
  // `request` must run inside the person's click, so nothing is awaited before it.
  // A declined prompt fires no permission event, so the box is set from the browser's answer.
  const toggle = (box: HTMLInputElement) => {
    const asked = box.checked ? props.permissions.request(NOTIFICATIONS) : props.permissions.remove(NOTIFICATIONS)
    void asked
      .catch(() => false)
      .then(async () => {
        box.checked = await props.permissions.contains(NOTIFICATIONS)
      })
  }
  return (
    <section aria-label="Notifications">
      <h2>Notifications</h2>
      <label class="check">
        <input
          type="checkbox"
          name="notify"
          checked={allowed() === true}
          onChange={(event) => toggle(event.currentTarget)}
        />
        Notify me when an agent waits on the projects of the page I'm on
      </label>
    </section>
  )
}

// The panel's theme and style pack. Saving is enough: every open panel applies the stored choice.
function AppearanceSettings(props: { storage: BrowserApi['storage']['local'] }) {
  const [appearance, setAppearance] = createSignal<Appearance>({ theme: null, style: 'terminal' })
  onMount(async () => setAppearance(await loadAppearance(props.storage)))
  const change = (next: Partial<Appearance>) => {
    setAppearance({ ...appearance(), ...next })
    void saveAppearance(props.storage, appearance())
  }
  return (
    <section aria-label="Appearance">
      <h2>Appearance</h2>
      <label>
        Theme
        <select name="theme" onChange={(event) => change({ theme: event.currentTarget.value || null })}>
          <option value="" selected={!appearance().theme}>
            System (Light or Dark)
          </option>
          <For each={THEMES}>
            {([id, label]) => (
              <option value={id} selected={id === appearance().theme}>
                {label}
              </option>
            )}
          </For>
        </select>
      </label>
      <label>
        Style
        <select name="style" onChange={(event) => change({ style: event.currentTarget.value })}>
          <For each={STYLES}>
            {([id, label]) => (
              <option value={id} selected={id === appearance().style}>
                {label}
              </option>
            )}
          </For>
        </select>
      </label>
    </section>
  )
}
