import { createResource, createSignal, Match, Show, Switch } from 'solid-js'
import { EmptyState, Heading, Select, Stack, Text } from '@acorn/plugin-api/ui/tree'
import type { AcornBridge } from '@acorn/plugin-api/ui/sdk'
import { projectRoute, projectsRoute, type Project, type ProjectsResponse } from '@acorn/protocol/api.ts'
import HttpPanel from './HttpPanel'
import HttpVariables from './HttpVariables'

// Two renderers, three manifest surfaces (docs/http-client.md § Client). What a pane draws is decided
// by the props the host mounted this slot with, which is the tree contract's version of what the frame
// contract called `context`: the host says what this region was opened to look at.
//
//   pane (task)     `taskId` + `projectId`.
//   pane (project)  `projectId` and no task, mounted beside the rail list at /p/:projectId. Lets a rail
//                   row click open something outside a task.
//   settings        neither. The settings modal only knows a workspace, so that surface picks a
//                   project first, and it is a renderer of its own rather than a fourth branch here.
//
// A selection into an already-mounted project pane arrives as `onSelect`, because remounting per click
// would throw away the draft the panel is holding.

const nameOf = (project: Project | undefined): string => project?.name ?? ''

/** What the host mounts a pane tree with: the surface's subject, minted by the shell per slot. */
export type HttpPaneProps = { taskId?: string; projectId?: string; item?: string }

export function HttpPaneApp(props: HttpPaneProps & { bridge: AcornBridge }) {
  // The project is read from core rather than carried in the mount props, which hold an id and not a
  // name. One read, no refetch: a slot is remounted when its subject changes.
  const [project] = createResource(
    () => props.projectId,
    (id) => props.bridge.api.get<Project>(projectRoute(id)),
  )

  return (
    <Switch>
      <Match when={!props.projectId}>
        {/* A pane with no project. Reachable in principle — the host binds `projectId` from the task or
            the route, and a task whose project row has gone is not a state this plugin can fix. */}
        <Stack gap="row">
          <Heading level={2}>API</Heading>
          <Text tone="muted" wrap>This surface needs a project. Open it from a task or from a project's rail.</Text>
        </Stack>
      </Match>
      <Match when={project.loading}>
        <EmptyState align="start" busy>Loading project…</EmptyState>
      </Match>
      <Match when={project.error}>
        <Stack gap="row">
          <Heading level={2}>API</Heading>
          <Text tone="muted" wrap>Could not load this project.</Text>
        </Stack>
      </Match>
      <Match when={project()}>
        {(row) => (
          <HttpPanel
            bridge={props.bridge}
            projectId={row().id}
            projectName={row().name}
            {...(props.taskId ? { taskId: props.taskId } : {})}
            {...(props.item ? { initialRequestId: props.item } : {})}
          />
        )}
      </Match>
    </Switch>
  )
}

// The variables settings surface. A picker rather than an inferred project: variables belong to a
// project and the settings modal is workspace-shaped.
export function HttpSettingsApp(props: { bridge: AcornBridge }) {
  const [projects] = createResource(() => props.bridge.api.get<ProjectsResponse>(projectsRoute))
  const [selected, setSelected] = createSignal('')
  const visible = () => (projects()?.projects ?? []).filter((candidate) => !candidate.hidden)
  const chosen = () => visible().find((candidate) => candidate.id === selected())

  return (
    <Stack gap="section">
      <Text tone="muted" wrap>
        Variables for the API panel, saved per project. Pick a project to edit its variables.
      </Text>
      <Select
        label="Project"
        value={selected()}
        onChange={(value: string) => setSelected(value)}
        options={[{ value: '', label: 'Choose a project…' }, ...visible().map((candidate) => ({ value: candidate.id, label: candidate.name }))]}
      />
      <Show when={chosen()}>
        {(candidate) => <HttpVariables projectId={candidate().id} projectName={nameOf(candidate())} />}
      </Show>
    </Stack>
  )
}
