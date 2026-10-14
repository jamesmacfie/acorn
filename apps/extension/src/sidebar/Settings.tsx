import { For, Show, createResource, createSignal, onCleanup, onMount } from 'solid-js'
import type { BridgeHandoff, BridgeNodes, BridgeProject } from '@acorn/protocol/extensionBridge.ts'
import type { ProjectSite, SiteAssociation } from '@acorn/protocol/siteAssociations.ts'
import type { BrowserApi } from '../browser'
import { STYLES, THEMES, loadAppearance, saveAppearance, type Appearance } from './appearance'
import type { BridgeClient } from './bridgeClient'
import { loadDestination } from '../localState'
import { ProjectSites } from './ProjectSites'
import { SiteAccess } from './SiteAccess'

// Everything that isn't the work: the Nodes and pairing, which sites the extension may read, each
// project's sites, notifications, and appearance.
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
  // The apps plugins published for the selected Node's tasks, whose sites can be allowed.
  apps: readonly SiteAssociation[]
  pageUrl: string | undefined
  sitesChanged(projectId: string, sites: SiteAssociation[]): void
}) {
  return (
    <div class="view" aria-label="Settings">
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
          />
        )}
      </Show>
      <SiteAccess api={props.api} handoffs={props.handoffs} sites={props.sites} apps={props.apps} />
      <Notifications permissions={props.api.permissions} />
      <AppearanceSettings storage={props.api.storage.local} />
    </div>
  )
}

// The selected Node's project sites. Mounted per Node, so a list read for one never fills another's.
function NodeSettings(props: {
  client: BridgeClient
  storage: BrowserApi['storage']['local']
  nodeId: string
  online: boolean
  sites: readonly ProjectSite[]
  pageUrl: string | undefined
  sitesChanged(projectId: string, sites: SiteAssociation[]): void
}) {
  const nodeId = props.nodeId
  const [projects, setProjects] = createSignal<BridgeProject[]>([])
  // The current task's project, to start the sites editor on.
  const [sitesProject, setSitesProject] = createSignal<string | null>(null)
  onMount(async () => {
    setSitesProject((await loadDestination(props.storage, nodeId)).projectId)
    // A failed read leaves Project sites hidden until Settings opens again.
    const result = await props.client.call({ op: 'projects.list', nodeId }).catch(() => null)
    if (result) setProjects(result.projects.filter((project) => !project.hidden))
  })

  return (
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
