import { createMemo, createSignal, For, Show } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import type { Integration, IntegrationMapping, IntegrationProject, Project, Workspace } from '@acorn/protocol/api.ts'
import { connectionName } from '@acorn/protocol/integrations.ts'
import { integrationMappingsKey, integrationMappingsOptions, integrationProjectsOptions, workspacesOptions } from '../../infra/queries'
import { setIntegrationMappings } from '../workspaces/workspaceMutations'
import { Alert, Button, EmptyState, Select, Table, TableCell, TableHead, TableRow } from '../../kit/components/primitives'
import { SettingRow } from '../../kit/components/layout/SettingRow'
import { createSettingSave } from './settingSave'

// Settings > Services, on one connection's page: where that connection's external projects show up
// (docs/integrations.md § Project sources). One connection often serves every workspace on the
// machine, so the map is edited from the connection's side rather than a workspace at a time; the
// rows it writes are the same core-owned rows either way.
//
// A target is a workspace, or one project inside a workspace. The narrow form is what makes a rail
// differ between two repos in the same workspace. Without it, every repo there shows the same list.
//
// Given a `workspace` or a `project`, the same map is drawn from that side, on its settings page: only
// the links that reach it, and a new link can only point there. On a project's page, a link that covers
// its whole workspace reaches every project in it, so it is listed but changed only from the
// connection's or the workspace's side. Either way a write replaces the connection's whole map, which
// is why the unfiltered list is what gets written.

// A dropdown value has to be one string, and a target is two. The workspace alone is the wide form.
const encodeTarget = (workspaceId: string, projectId?: string) => projectId ? `${workspaceId}/${projectId}` : workspaceId
const decodeTarget = (value: string): { workspaceId: string; projectId?: string } => {
  const [workspaceId, projectId] = value.split('/')
  return projectId ? { workspaceId, projectId } : { workspaceId }
}
const sameMapping = (a: IntegrationMapping, b: IntegrationMapping) =>
  a.workspaceId === b.workspaceId && a.externalId === b.externalId && (a.projectId ?? '') === (b.projectId ?? '')

export default function ConnectionProjectMap(props: {
  connection: Integration
  workspace?: Workspace
  project?: Project
  /** Open the connection's own page, from a workspace's or a project's side. */
  manage?: () => void
}) {
  const queryClient = useQueryClient()
  const projects = createQuery(() => integrationProjectsOptions(props.connection.id, true))
  const mappings = createQuery(() => integrationMappingsOptions(props.connection.id, true))
  const workspaces = createQuery(() => workspacesOptions(true))

  const [externalId, setExternalId] = createSignal('')
  const [target, setTarget] = createSignal('')
  const [busy, setBusy] = createSignal(false)
  // Following and removing are list edits that write at once, so the row says Saved or why not, the
  // same as any other setting.
  const save = createSettingSave()

  const all = (): IntegrationMapping[] => mappings.data ?? []
  // A write replaces the connection's whole list, so it waits for the stored one. Written over a list
  // still loading, or one that failed to read, it would drop every link that list held.
  const locked = () => busy() || !mappings.isSuccess
  const reaches = (row: IntegrationMapping, project: Project) =>
    row.workspaceId === project.workspaceId && (!row.projectId || row.projectId === project.id)
  const rows = (): IntegrationMapping[] => {
    const project = props.project
    const workspace = props.workspace
    if (project) return all().filter((row) => reaches(row, project))
    return workspace ? all().filter((row) => row.workspaceId === workspace.id) : all()
  }
  const offered = (): IntegrationProject[] => projects.data ?? []
  const spaces = (): Workspace[] => workspaces.data ?? []

  // The provider's label for an external id, falling back to the id itself: a row that is already
  // stored has to stay readable even when the connection can't be reached to name it.
  const labels = createMemo(() => new Map(offered().map((project) => [project.id, project.label])))

  // Every place a link can point, flat and carrying its workspace in the text. Flat because Select
  // draws its own list and has no notion of an option group; carrying the workspace because that is
  // what makes the list's filter box answer "everything under Runn". One list, so a stored row and
  // the picker always name a target the same way.
  const targets = createMemo(() => spaces().filter((workspace) => !props.workspace || workspace.id === props.workspace.id).flatMap((workspace) => [
    { value: workspace.id, label: `${workspace.name} · All projects` },
    ...workspace.projects.map((project) => ({
      value: encodeTarget(workspace.id, project.id),
      label: `${workspace.name} · ${project.name}`,
    })),
  ]))
  const names = createMemo(() => new Map(targets().map((target) => [target.value, target.label])))

  const write = async (next: IntegrationMapping[]): Promise<void> => {
    setBusy(true)
    try {
      await save.run(async () => {
        try {
          await setIntegrationMappings(props.connection.id, next)
        } catch (cause) {
          // Every row here is drawn from the server's answer, so a failed write leaves the list where
          // it was; all this has to do is say why nothing moved. Read the status rather than blaming
          // the connection for everything: "check the connection" sent someone hunting a credential
          // problem when the node had simply not restarted into the schema the write needed.
          const status = Number((cause as Error).message.match(/(\d{3})$/)?.[1])
          throw new Error(status === 403
            ? 'That connection is no longer available. Sign in to it again on its page, then try again.'
            : "Couldn't save that change. If it keeps happening, restart acorn.")
        }
        await queryClient.invalidateQueries({ queryKey: integrationMappingsKey(props.connection.id) })
        // The rail decides whether to draw this provider's source from the workspace-side read of the
        // same rows (tabs/sources.ts), so that key has to go too, for every workspace at once.
        await queryClient.invalidateQueries({ queryKey: ['workspace-external-projects'] })
      })
    } finally {
      setBusy(false)
    }
  }

  const add = (): void => {
    const chosen = props.project ? { workspaceId: props.project.workspaceId, projectId: props.project.id } : decodeTarget(target())
    const mapping: IntegrationMapping = { workspaceId: chosen.workspaceId, externalId: externalId(), ...(chosen.projectId ? { projectId: chosen.projectId } : {}) }
    if (all().some((row) => sameMapping(row, mapping))) return
    setExternalId('')
    setTarget('')
    void write([...all(), mapping])
  }

  return (
    <div class="integration-map">
      <SettingRow
        label={props.project || props.workspace ? connectionName(props.connection) : 'Followed projects'}
        description={props.project
          ? undefined
          : props.workspace
            ? 'Pick All projects to show it across this workspace, or one project to show it only there.'
            : 'Pick a workspace to follow a project everywhere in it, or one repository to follow it there alone.'}
        help={props.project ? "Projects followed by the whole workspace show here too. Change those on the workspace's page." : undefined}
        layout="stacked"
        savedAt={save.savedAt()}
        error={save.error()}
      >
        <Show when={projects.isError}>
          <Alert>
            Couldn't load this service's projects.
            {props.connection.status === 'needs-auth' ? (props.manage ? ' Sign in to it again on its page.' : ' Sign in to it again above.') : ''}
            <Button size="sm" disabled={projects.isFetching} onPress={() => void projects.refetch()}>
              {projects.isFetching ? 'Retrying…' : 'Retry'}
            </Button>
          </Alert>
        </Show>

        <Show when={mappings.isError}>
          <Alert>
            Couldn't load what this service follows.
            <Button size="sm" disabled={mappings.isFetching} onPress={() => void mappings.refetch()}>
              {mappings.isFetching ? 'Retrying…' : 'Retry'}
            </Button>
          </Alert>
        </Show>

        {/* A small table, the shape the page's other lists of records take (run targets). */}
        <Show
          when={rows().length}
          fallback={<Show when={mappings.isSuccess}><EmptyState align="start" size="sm">Not following any projects.</EmptyState></Show>}
        >
          <Table size="sm">
            <TableRow head>
              <TableHead>Project</TableHead>
              <TableHead>Shows up in</TableHead>
              <TableHead align="end"><span class="sr-only">Remove</span></TableHead>
            </TableRow>
            <For each={rows()}>
              {(row) => (
                <TableRow>
                  <TableCell header>{labels().get(row.externalId) ?? row.externalId}</TableCell>
                  <TableCell>{names().get(encodeTarget(row.workspaceId, row.projectId)) ?? row.workspaceId}</TableCell>
                  <TableCell align="end">
                    <Show when={!props.project || row.projectId}>
                      <Button
                        variant="ghost"
                        tone="danger"
                        size="sm"
                        disabled={locked()}
                        onPress={() => void write(all().filter((other) => !sameMapping(other, row)))}
                      >
                        Remove
                      </Button>
                    </Show>
                  </TableCell>
                </TableRow>
              )}
            </For>
          </Table>
        </Show>

        <div class="integration-map-row">
          <Select
            value={externalId()}
            disabled={busy() || !offered().length}
            label={`${connectionName(props.connection)} projects`}
            onChange={(value) => setExternalId(value)} options={[{ value: '', label: projects.isPending ? 'Loading projects…' : 'Choose a project…' }, ...offered().map((project) => ({ value: project.id, label: project.label }))]} />
          <Show when={!props.project}>
            <Select
              value={target()}
              disabled={busy() || !targets().length}
              label="Where it shows up"
              onChange={(value) => setTarget(value)} options={[{ value: '', label: 'Choose where…' }, ...targets().map((entry) => ({ value: entry.value, label: entry.label }))]} />
          </Show>
          <Button disabled={locked() || !externalId() || (!props.project && !target())} onPress={add}>Follow</Button>
        </div>
        <Show when={props.manage}>
          {(manage) => <div><Button variant="bare" size="sm" onPress={manage()}>Manage {connectionName(props.connection)}</Button></div>}
        </Show>
      </SettingRow>
    </div>
  )
}
