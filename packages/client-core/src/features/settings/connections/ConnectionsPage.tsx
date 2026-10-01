import { createEffect, createMemo, createSignal, Show, type JSX } from 'solid-js'
import { createQuery } from '@tanstack/solid-query'
import type { Integration } from '@acorn/protocol/api.ts'
import type { PublicIntegrationProvider } from '@acorn/protocol/integrations.ts'
import { integrationsOptions } from '../../../infra/queries'
import { Alert, Button } from '../../../kit/components/primitives'
import type { SettingsNavigate } from '../../../host/registries/shell/settings'
import { AddConnection } from './AddConnection'
import { ConnectionPage } from './ConnectionPage'
import {
  connectionPageOf, isModelProvider, needsYouFirst, openConnectionPage, SERVICES_PAGE, takeConnectionRequest, type ConnectionRequest,
} from './connections'

// What Services and AI models share: the node's connections, one connection open as a detail in the
// same pane, and the Add connection gallery. Each page draws its own list and hands it the connections
// it lists; a connection the other page lists opens there.

export type ConnectionsList = {
  /** The connections this page lists, a connection that needs its owner first. */
  connections: () => Integration[]
  providerOf: (connection: Integration) => PublicIntegrationProvider | undefined
  pending: () => boolean
  /** The node did not answer, so an empty list says nothing about what is connected. */
  failed: () => boolean
  openConnection: (connection: Integration) => void
  openAdd: () => void
}

export function ConnectionsPage(props: {
  page: string
  label: string
  navigate: SettingsNavigate
  children: (list: ConnectionsList) => JSX.Element
}) {
  const status = createQuery(() => integrationsOptions(true))
  const byId = createMemo(() => new Map((status.data?.providers ?? []).map((provider) => [provider.id, provider])))
  const providerOf = (connection: Integration) => byId().get(connection.providerId)
  const all = () => status.data?.integrations ?? []
  const [open, setOpen] = createSignal<ConnectionRequest>()

  // A link from elsewhere in settings: a project's Connections tab, a search result, the other page.
  createEffect(() => {
    const asked = takeConnectionRequest(props.page)
    if (asked) setOpen(asked)
  })

  const openConnection = (connection: Integration) => {
    if (connectionPageOf(providerOf(connection)) === props.page) setOpen({ kind: 'connection', id: connection.id })
    else openConnectionPage(props.navigate, connection, providerOf(connection))
  }
  const current = createMemo(() => {
    const target = open()
    return target?.kind === 'connection' ? all().find((connection) => connection.id === target.id) : undefined
  })
  const list: ConnectionsList = {
    connections: () => needsYouFirst(all().filter((connection) => connectionPageOf(providerOf(connection)) === props.page)),
    providerOf,
    pending: () => status.isPending,
    failed: () => status.isError,
    openConnection,
    openAdd: () => setOpen({ kind: 'add' }),
  }

  return (
    <Show
      when={open()?.kind === 'add'}
      fallback={
        // A connection that went away while its page was open, disconnected here or elsewhere, falls
        // back to the list.
        <Show
          when={current()}
          fallback={
            <>
              <Show when={status.isError}>
                <Alert actions={<Button size="sm" onPress={() => void status.refetch()}>Retry</Button>}>Could not read this node's connections.</Alert>
              </Show>
              {props.children(list)}
            </>
          }
        >
          {(connection) => (
            <ConnectionPage connection={connection()} provider={providerOf(connection())} listLabel={props.label} onBack={() => setOpen(undefined)} />
          )}
        </Show>
      }
    >
      <AddConnection
        providers={status.data?.providers ?? []}
        connections={all()}
        offers={props.page === SERVICES_PAGE ? undefined : isModelProvider}
        listedOn={props.page === SERVICES_PAGE ? (provider) => (isModelProvider(provider) ? 'Listed on AI models' : undefined) : undefined}
        openConnection={openConnection}
        listLabel={props.label}
        title={props.page === SERVICES_PAGE ? 'Add connection' : 'Add an API key'}
        onClose={() => setOpen(undefined)}
      />
    </Show>
  )
}
