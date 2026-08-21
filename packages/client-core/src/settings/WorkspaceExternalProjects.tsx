import { createSignal, For, Show } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import type { Integration, IntegrationProject, Workspace, WorkspaceExternalProject } from '@acorn/protocol/api.ts'
import { integrationProjectsOptions, integrationsOptions, workspaceExternalProjectsKey, workspaceExternalProjectsOptions } from '../queries'
import { setWorkspaceExternalProjects } from '../workspaces/mutations'
import { Alert, Button, Checkbox } from '../ui/primitives'

// Settings → per-workspace page: which of a connected integration's projects this workspace follows
// (docs/workspaces-and-tasks.md § Workspace and project, docs/integrations.md § Project sources). The
// host draws this for every provider, on core's table and core's route; a plugin cannot write it.
export default function WorkspaceExternalProjects(props: { workspace: Workspace }) {
  const queryClient = useQueryClient()
  const integrations = createQuery(() => integrationsOptions(true))
  const linked = createQuery(() => workspaceExternalProjectsOptions(props.workspace.id, true))
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal('')

  // Only connections whose provider declared a project source, and only ones the owner has not turned
  // off. `needs-auth` stays in: the route reports it per connection, and a row that says "reconnect"
  // is more use than a connection that quietly vanished from the list.
  const candidates = (): Integration[] => {
    const supported = new Set((integrations.data?.providers ?? []).filter((provider) => provider.supportsProjects).map((provider) => provider.id))
    return (integrations.data?.integrations ?? []).filter((row) => supported.has(row.providerId) && row.status !== 'disabled')
  }

  const current = (): WorkspaceExternalProject[] => linked.data?.projects ?? []
  const isLinked = (connectionId: string, externalId: string): boolean =>
    current().some((row) => row.integrationId === connectionId && row.externalId === externalId)

  /**
   * Add or remove exactly one pair and write the whole set back, because the route replaces the whole
   * set for the workspace.
   *
   * Deriving the next set from the current one keeps sibling mappings safe by construction rather
   * than by a merge step someone has to remember: editing Linear's selection carries Rollbar's rows
   * through verbatim, and so does a connection whose own list failed to load, since its rows are
   * still in `current()` even though the picker cannot show them.
   */
  const toggle = async (connectionId: string, externalId: string, next: boolean): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      const without = current().filter((row) => !(row.integrationId === connectionId && row.externalId === externalId))
      await setWorkspaceExternalProjects(props.workspace.id, next ? [...without, { integrationId: connectionId, externalId }] : without)
      await queryClient.invalidateQueries({ queryKey: workspaceExternalProjectsKey(props.workspace.id) })
    } catch {
      // The checkbox reads from the server's answer, so a failed write leaves it where it was; all this
      // has to do is say why nothing moved.
      setError('Could not save the project selection. Check the connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Show when={candidates().length}>
      <div class="settings-field">
        <span class="settings-label">Linked provider projects</span>
        <span class="muted settings-hint">
          Which projects this workspace follows. Its rails show items from these; with nothing linked, an
          integration is unscoped and shows whatever it can reach.
        </span>
        <Show when={error()}><Alert>{error()}</Alert></Show>
        <For each={candidates()}>
          {(connection) => (
            <ConnectionProjects
              connection={connection}
              busy={busy()}
              isLinked={(externalId) => isLinked(connection.id, externalId)}
              onToggle={(externalId, next) => void toggle(connection.id, externalId, next)}
            />
          )}
        </For>
      </div>
    </Show>
  )
}

// One connection's list, with its own query so its own failure stays its own: a Linear workspace that
// is down must not take the Rollbar row below it with it, which is why the route is per connection.
function ConnectionProjects(props: {
  connection: Integration
  busy: boolean
  isLinked: (externalId: string) => boolean
  onToggle: (externalId: string, next: boolean) => void
}) {
  const projects = createQuery(() => integrationProjectsOptions(props.connection.id, true))
  const rows = (): IntegrationProject[] => projects.data ?? []

  return (
    <div class="settings-field">
      <div class="settings-field-row">
        <span class="settings-label">{props.connection.label}</span>
        <Show when={projects.isError}>
          <Button size="sm" disabled={projects.isFetching} onClick={() => void projects.refetch()}>
            {projects.isFetching ? 'Retrying…' : 'Retry'}
          </Button>
        </Show>
      </div>
      <Show when={!projects.isPending} fallback={<p class="muted">Loading projects…</p>}>
        <Show
          when={!projects.isError}
          fallback={(
            <p class="muted" role="alert">
              Could not list projects for this connection.
              {props.connection.status === 'needs-auth' ? ' It needs reconnecting in Settings → Integrations.' : ''}
            </p>
          )}
        >
          <For each={rows()} fallback={<p class="muted">No projects in this connection.</p>}>
            {(project) => (
              <Checkbox
                class="settings-field-row"
                nested
                label={project.label}
                disabled={props.busy}
                checked={props.isLinked(project.id)}
                onChange={(event) => props.onToggle(project.id, event.currentTarget.checked)}
              />
            )}
          </For>
        </Show>
      </Show>
    </div>
  )
}
