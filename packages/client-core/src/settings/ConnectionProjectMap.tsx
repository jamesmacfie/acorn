import { createMemo, createSignal, For, Show } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import type { Integration, IntegrationMapping, IntegrationProject, Workspace } from '@acorn/protocol/api.ts'
import { integrationMappingsKey, integrationMappingsOptions, integrationProjectsOptions, workspacesOptions } from '../queries'
import { setIntegrationMappings } from '../workspaces/mutations'
import { Alert, Button, EmptyState, Select } from '../ui/primitives'

// Settings → Integrations, under one connection: where that connection's external projects show up
// (docs/integrations.md § Project sources). One connection often serves every workspace on the
// machine, so the map is edited from the connection's side rather than a workspace at a time; the
// rows it writes are the same core-owned rows either way.
//
// A target is a workspace, or one project inside a workspace. The narrow form is what makes a rail
// differ between two repos in the same workspace — without it, every repo there shows the same list.

// A dropdown value has to be one string, and a target is two. The workspace alone is the wide form.
const encodeTarget = (workspaceId: string, projectId?: string) => projectId ? `${workspaceId}/${projectId}` : workspaceId
const decodeTarget = (value: string): { workspaceId: string; projectId?: string } => {
  const [workspaceId, projectId] = value.split('/')
  return projectId ? { workspaceId, projectId } : { workspaceId }
}
const sameMapping = (a: IntegrationMapping, b: IntegrationMapping) =>
  a.workspaceId === b.workspaceId && a.externalId === b.externalId && (a.projectId ?? '') === (b.projectId ?? '')

export default function ConnectionProjectMap(props: { connection: Integration }) {
  const queryClient = useQueryClient()
  const projects = createQuery(() => integrationProjectsOptions(props.connection.id, true))
  const mappings = createQuery(() => integrationMappingsOptions(props.connection.id, true))
  const workspaces = createQuery(() => workspacesOptions(true))

  const [externalId, setExternalId] = createSignal('')
  const [target, setTarget] = createSignal('')
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal('')

  const rows = (): IntegrationMapping[] => mappings.data ?? []
  const offered = (): IntegrationProject[] => projects.data ?? []
  const spaces = (): Workspace[] => workspaces.data ?? []

  // The provider's label for an external id, falling back to the id itself: a row that is already
  // stored has to stay readable even when the connection can't be reached to name it.
  const labels = createMemo(() => new Map(offered().map((project) => [project.id, project.label])))

  // Every place a link can point, flat and carrying its workspace in the text. Flat because Select
  // draws its own list and has no notion of an option group; carrying the workspace because that is
  // what makes the list's filter box answer "everything under Runn". One list, so a stored row and
  // the picker always name a target the same way.
  const targets = createMemo(() => spaces().flatMap((workspace) => [
    { value: workspace.id, label: `${workspace.name} · All projects` },
    ...workspace.projects.map((project) => ({
      value: encodeTarget(workspace.id, project.id),
      label: `${workspace.name} · ${project.name}`,
    })),
  ]))
  const names = createMemo(() => new Map(targets().map((target) => [target.value, target.label])))

  const write = async (next: IntegrationMapping[]): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      await setIntegrationMappings(props.connection.id, next)
      await queryClient.invalidateQueries({ queryKey: integrationMappingsKey(props.connection.id) })
      // The rail decides whether to draw this provider's source from the workspace-side read of the
      // same rows (tabs/sources.ts), so that key has to go too, for every workspace at once.
      await queryClient.invalidateQueries({ queryKey: ['workspace-external-projects'] })
    } catch (cause) {
      // Every row here is drawn from the server's answer, so a failed write leaves the list where it
      // was; all this has to do is say why nothing moved. Read the status rather than blaming the
      // connection for everything: "check the connection" sent someone hunting a credential problem
      // when the node had simply not restarted into the schema the write needed.
      const status = Number((cause as Error).message.match(/(\d{3})$/)?.[1])
      setError(status === 403
        ? 'That connection is no longer available. Reconnect it above, then try again.'
        : 'The node could not save that change. If it keeps failing, restart the app.')
    } finally {
      setBusy(false)
    }
  }

  const add = (): void => {
    const chosen = decodeTarget(target())
    const mapping: IntegrationMapping = { workspaceId: chosen.workspaceId, externalId: externalId(), ...(chosen.projectId ? { projectId: chosen.projectId } : {}) }
    if (rows().some((row) => sameMapping(row, mapping))) return
    setExternalId('')
    setTarget('')
    void write([...rows(), mapping])
  }

  return (
    <div class="integration-map">
      <span class="muted settings-hint">
        Where this connection's projects show up. Pick a workspace to follow a project everywhere in it,
        or one repository to follow it there alone.
      </span>

      <Show when={error()}><Alert>{error()}</Alert></Show>
      <Show when={projects.isError}>
        <Alert>
          Could not list this connection's projects.
          {props.connection.status === 'needs-auth' ? ' It needs reconnecting above.' : ''}
          <Button size="sm" disabled={projects.isFetching} onClick={() => void projects.refetch()}>
            {projects.isFetching ? 'Retrying…' : 'Retry'}
          </Button>
        </Alert>
      </Show>

      <For each={rows()} fallback={<EmptyState align="start">Nothing followed yet.</EmptyState>}>
        {(row) => (
          <div class="integration-map-row">
            <span class="integration-map-name">{labels().get(row.externalId) ?? row.externalId}</span>
            <span class="muted">→</span>
            <span class="integration-map-target">
              {names().get(encodeTarget(row.workspaceId, row.projectId)) ?? row.workspaceId}
            </span>
            <Button
              variant="ghost"
              tone="danger"
              size="sm"
              disabled={busy()}
              onClick={() => void write(rows().filter((other) => !sameMapping(other, row)))}
            >
              Remove
            </Button>
          </div>
        )}
      </For>

      <div class="integration-map-row">
        <Select
          value={externalId()}
          disabled={busy() || !offered().length}
          aria-label={`${props.connection.label} projects`}
          onChange={(event) => setExternalId(event.currentTarget.value)}
        >
          <option value="">{projects.isPending ? 'Loading projects…' : 'Choose a project…'}</option>
          <For each={offered()}>{(project) => <option value={project.id}>{project.label}</option>}</For>
        </Select>
        <Select
          value={target()}
          disabled={busy() || !targets().length}
          aria-label="where it shows up"
          onChange={(event) => setTarget(event.currentTarget.value)}
        >
          <option value="">Choose where…</option>
          <For each={targets()}>{(entry) => <option value={entry.value}>{entry.label}</option>}</For>
        </Select>
        <Button disabled={busy() || !externalId() || !target()} onClick={add}>Follow</Button>
      </div>
    </div>
  )
}
