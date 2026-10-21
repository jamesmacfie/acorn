import { createEffect, For, onCleanup, Show } from 'solid-js'
import { useNavigate, useParams } from '@solidjs/router'
import { createQuery } from '@tanstack/solid-query'
import { RailTab } from '@acorn/client-core/features/tabs/RailTab.tsx'
import {
  releasePaneAnnotations,
  requestPaneAnnotations,
} from '@acorn/client-core/host/annotations/statusAnnotations.ts'
import { paneAvailable, paneContributions, paneRegistry } from '@acorn/client-core/host/registries/panes/panes.ts'
import { markersFor } from '@acorn/client-core/host/registries/rail'
import { pluginRosterKnown } from '@acorn/client-core/infra/node'
import { workspaceForProject } from '@acorn/client-core/features/workspaces'
import { tasksOptions, workspacesOptions } from '@acorn/client-core/infra/queries.ts'
import { ContributionBoundary } from '@acorn/client-core/kit/components/content/ContributionBoundary.tsx'
import { EmptyState } from '@acorn/client-core/kit/components/primitives.tsx'
import { rosterReady } from './roster'
import { TopBar } from './TopBar'
import { taskState } from './taskState'

/**
 * `/t/:taskId/:paneId`: one pane of a task, with a bar of the task's panes along the bottom.
 * `/t/:taskId` opens the first pane the task offers.
 *
 * The pane is the contribution's own component, as the terminal client draws it, rather than
 * `TaskPaneHost`. That host draws a row of panes from the task's saved layout, which the desktop
 * shares, with the desktop's switcher and its pin and close buttons. Here the route is which pane is
 * shown, so the phone never writes a layout.
 */
export function TaskScreen() {
  const params = useParams<{ taskId: string; paneId?: string }>()
  const navigate = useNavigate()
  const tasks = createQuery(() => tasksOptions(true))
  const workspaces = createQuery(() => workspacesOptions(true))
  const task = () => tasks.data?.find((candidate) => candidate.id === params.taskId)
  // The route keeps no workspace, so a link from a notification lands here too. Back goes to the
  // tasks of the workspace the task's project is in.
  const back = () => {
    const workspace = workspaceForProject(workspaces.data, task()?.projectId)
    return workspace ? `/w/${workspace.id}/tasks` : '/'
  }
  // The desktop switcher's list. Empty until the roster registers, after the first frame.
  const panes = () => {
    const shown = task()
    return shown
      ? paneContributions().filter((pane) => pane.showInSwitcher !== false && paneAvailable(pane, shown))
      : []
  }
  const pane = () => panes().find((candidate) => candidate.id === params.paneId)
  const paneHref = (paneId: string) => `/t/${params.taskId}/${paneId}`

  // Which panes a task offers settles once the built-in plugins have registered and the Node has said
  // which of them it runs. Before that, the first pane on offer is only the first to arrive. A named
  // pane is never swapped for another: some offer themselves only once their own data has loaded.
  const settled = () => rosterReady() && pluginRosterKnown()
  createEffect(() => {
    const first = panes()[0]
    if (settled() && !params.paneId && first) navigate(paneHref(first.id), { replace: true })
  })
  // The `core:pane` markers on the bar's buttons, as the desktop's switcher asks for them.
  createEffect(() => requestPaneAnnotations(params.taskId, panes()))
  onCleanup(() => releasePaneAnnotations(params.taskId))

  return (
    <Show
      when={task()}
      fallback={
        <>
          <TopBar title="Task" back="/" />
          <Show when={tasks.data} fallback={<EmptyState busy title="Loading the task" />}>
            <EmptyState title="No such task">
              It may have been archived. Go back to see the tasks on this Node.
            </EmptyState>
          </Show>
        </>
      }
    >
      {(shown) => (
        <>
          <TopBar title={shown().title} detail={taskState(shown().id)} back={back()} />
          <main class="mobile-pane">
            {/* Remounted for each pane, and for each task, because a pane captures its task's model
                when it mounts. */}
            <Show
              when={pane()}
              keyed
              fallback={
                <EmptyState busy={!settled()} title={settled() ? 'Not on this task' : 'Loading panes'}>
                  {settled() ? 'Pick a pane below.' : undefined}
                </EmptyState>
              }
            >
              {(drawn) => (
                <Show when={shown().id} keyed>
                  {/* Solid redraws a keyed child on a new key only when the child takes the key. */}
                  {(_taskId) => (
                    <ContributionBoundary contributionId={drawn.id} owner={paneRegistry.ownerOf(drawn.id)}>
                      <drawn.component task={shown()} />
                    </ContributionBoundary>
                  )}
                </Show>
              )}
            </Show>
          </main>
          <nav class="mobile-bar mobile-tabs" aria-label="Task panes">
            <For each={panes()}>
              {(entry) => (
                <RailTab
                  label={entry.label}
                  glyph={entry.glyph}
                  sublabel={entry.label}
                  active={entry.id === params.paneId}
                  aria-current={entry.id === params.paneId ? 'page' : undefined}
                  markers={markersFor({ kind: 'pane', id: entry.id, taskId: shown().id })}
                  onClick={() => navigate(paneHref(entry.id))}
                />
              )}
            </For>
          </nav>
        </>
      )}
    </Show>
  )
}
