import { For, Show } from 'solid-js'
import { createQuery } from '@tanstack/solid-query'
import type { Project, Workspace } from '@acorn/protocol/api.ts'
import { integrationsOptions } from '../../infra/queries'
import { Button, EmptyState } from '../../kit/components/primitives'
import { SettingsSection } from '../../kit/components/layout/SettingsSection'
import ConnectionProjectMap from './ConnectionProjectMap'
import { openConnectionPage, SERVICES_PAGE } from './connections/connections'
import type { SettingsNavigate } from '../../host/registries/shell/settings'

// The services a workspace or a project follows: which provider projects show up in its rail, from each
// connection that lists projects. The same map a connection's page draws, from the other side
// (./ConnectionProjectMap.tsx), so every page reads and writes the same rows. Each connection links to
// its own page, where it is renamed, signed in again, or disconnected.

function FollowedServices(props: { workspace?: Workspace; project?: Project; navigate: SettingsNavigate; description: string }) {
  const status = createQuery(() => integrationsOptions(true))
  const providers = () => new Map((status.data?.providers ?? []).map((provider) => [provider.id, provider]))
  const listing = () => (status.data?.integrations ?? []).filter((connection) => providers().get(connection.providerId)?.supportsProjects)
  return (
    <SettingsSection
      id="connections"
      label="Connections"
      description={props.description}
      actions={<Button size="sm" variant="ghost" onPress={() => props.navigate(SERVICES_PAGE)}>Open Services</Button>}
    >
      <Show
        when={listing().length}
        fallback={<EmptyState align="start">{status.isPending ? 'Reading connections…' : 'No connection on this node lists projects. Add one on Services.'}</EmptyState>}
      >
        <For each={listing()}>
          {(connection) => (
            <ConnectionProjectMap
              connection={connection}
              {...(props.project ? { project: props.project } : {})}
              {...(props.workspace ? { workspace: props.workspace } : {})}
              manage={() => openConnectionPage(props.navigate, connection, providers().get(connection.providerId))}
            />
          )}
        </For>
      </Show>
    </SettingsSection>
  )
}

/** A project page's Connections tab. */
export function ProjectConnections(props: { project: Project; navigate: SettingsNavigate }) {
  return <FollowedServices project={props.project} navigate={props.navigate} description="Which projects from each connection show up in the rail for this project." />
}

/** A workspace page's Connections section. */
export function WorkspaceConnections(props: { workspace: Workspace; navigate: SettingsNavigate }) {
  return <FollowedServices workspace={props.workspace} navigate={props.navigate} description="Which projects from each connection show up in this workspace's rail." />
}
