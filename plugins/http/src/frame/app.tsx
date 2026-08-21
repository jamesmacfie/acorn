import { createResource, createSignal, For, Match, Show, Switch } from 'solid-js'
import { EmptyState, Select } from '@acorn/plugin-api/ui'
import type { AcornBridge } from '@acorn/plugin-api/ui/sdk'
import { projectRoute, projectsRoute, type Project, type ProjectsResponse } from '@acorn/protocol/api.ts'
import HttpPanel from './HttpPanel'
import HttpVariables from './HttpVariables'

// One bundle, three manifest surfaces (docs/http-client.md § Client). What it renders is decided by
// `bridge.context`, which is the whole point of the frame contract: the host says what this
// rectangle was opened to look at.
//
//   pane (task)     `context.taskId` + `context.projectId`.
//   pane (project)  `context.projectId` and no task, mounted beside the rail list at /p/:projectId.
//                   This is the surface the compiled rail Source used to be, and it is the reason a
//                   rail row click still opens something outside a task instead of being refused.
//   settings        neither. The settings modal only knows a workspace, so this surface picks a
//                   project first, same as the compiled settings page did.
//
// A selection into an already-mounted project pane arrives as `onSelect`, because `context` is a
// snapshot by contract and remounting per click would throw away the draft the panel is holding.
type Frame = 'task' | 'project' | 'settings' | 'unroutable'

const nameOf = (project: Project | undefined): string => project?.name ?? ''

export function HttpFrameApp(props: { bridge: AcornBridge }) {
  const context = props.bridge.context

  const kind = (): Frame => {
    if (context.target === 'settings') return 'settings'
    if (!context.projectId) return 'unroutable'
    return context.taskId ? 'task' : 'project'
  }

  // The project is read from core rather than carried in `context`, which holds an id and not a name. One
  // read, no refetch: a frame is recreated when its subject changes.
  const [project] = createResource(
    () => (kind() === 'task' || kind() === 'project' ? context.projectId : undefined),
    (id) => props.bridge.api.get<Project>(projectRoute(id)),
  )

  return (
    <Switch>
      <Match when={kind() === 'unroutable'}>
        {/* A pane frame with no project. Reachable in principle — the host binds `projectId` from the task
            or the route, and a task whose project row has gone is not a state this plugin can fix. */}
        <div class="http-choose-repo">
          <h2>API</h2>
          <p class="http-hint">This surface needs a project. Open it from a task or from a project's rail.</p>
        </div>
      </Match>
      <Match when={kind() === 'settings'}>
        <SettingsSurface bridge={props.bridge} />
      </Match>
      <Match when={project.loading}>
        <EmptyState align="start" busy>Loading project…</EmptyState>
      </Match>
      <Match when={project.error}>
        <div class="http-choose-repo">
          <h2>API</h2>
          <p class="http-hint">Could not load this project.</p>
        </div>
      </Match>
      <Match when={project()}>
        {(row) => (
          <HttpPanel
            bridge={props.bridge}
            projectId={row().id}
            projectName={row().name}
            {...(context.taskId ? { taskId: context.taskId } : {})}
            {...(context.item ? { initialRequestId: context.item } : {})}
          />
        )}
      </Match>
    </Switch>
  )
}

// The variables settings surface. Still a picker rather than an inferred project: variables belong
// to a project, the settings modal is workspace-shaped, and guessing which project someone meant
// would be worse than asking.
function SettingsSurface(props: { bridge: AcornBridge }) {
  const [projects] = createResource(() => props.bridge.api.get<ProjectsResponse>(projectsRoute))
  const [selected, setSelected] = createSignal('')
  const visible = () => (projects()?.projects ?? []).filter((candidate) => !candidate.hidden)
  const chosen = () => visible().find((candidate) => candidate.id === selected())

  return (
    <div class="settings-page">
      <p class="settings-hint">
        Variables for the API panel, saved per project. Pick a project to edit its variables.
      </p>
      <Select aria-label="Project" value={selected()} onChange={(event) => setSelected(event.currentTarget.value)}>
        <option value="">Choose a project…</option>
        <For each={visible()}>{(candidate) => <option value={candidate.id}>{candidate.name}</option>}</For>
      </Select>
      <Show when={chosen()}>
        {(candidate) => <HttpVariables projectId={candidate().id} projectName={nameOf(candidate())} />}
      </Show>
    </div>
  )
}
