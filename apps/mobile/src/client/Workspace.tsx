import { createEffect, createMemo, createSignal, For, lazy, Show } from 'solid-js'
import { useNavigate, useParams } from '@solidjs/router'
import { createQuery } from '@tanstack/solid-query'
import type { TaskDraft } from '@acorn/client-core/features/tabs/taskDraftStore.ts'
import { RailTab } from '@acorn/client-core/features/tabs/RailTab.tsx'
import { createWorkspaceWords } from '@acorn/client-core/features/workspaces'
import { requestTaskAnnotations } from '@acorn/client-core/host/annotations/taskAnnotations.ts'
import { activeNodeId } from '@acorn/client-core/infra/node/activeNode.ts'
import { projectsOptions, tasksOptions, workspacesOptions } from '@acorn/client-core/infra/queries.ts'
import { Text } from '@acorn/client-core/kit/components/content'
import { Button, EmptyState, Row, SectionHeader } from '@acorn/client-core/kit/components/primitives.tsx'
import { NeedsYou } from './NeedsYou'
import { TopBar } from './TopBar'
import { taskState } from './taskState'
import { useWaiting, waitingWorkspaceId } from './waiting'

// The first screen doesn't draw it, and it brings the draft form's branch pickers and icon picker.
const TaskDraftDialog = lazy(async () => ({
  default: (await import('@acorn/client-core/features/tabs/TaskDraftDialog.tsx')).TaskDraftDialog,
}))

/**
 * `/w/:workspaceId` and `/w/:workspaceId/tasks`: a workspace's dashboard, which is empty for now, or
 * what waits in it and its tasks grouped by project. A bar of the two views runs along the bottom,
 * and Tasks carries a marker while something waits, so someone on the dashboard can see it.
 */
export function Workspace(props: { view: 'dashboard' | 'tasks' }) {
  const params = useParams<{ workspaceId: string }>()
  const navigate = useNavigate()
  const words = createWorkspaceWords()
  const tasks = createQuery(() => tasksOptions(true))
  const workspaces = createQuery(() => workspacesOptions(true))
  const projects = createQuery(() => projectsOptions(true))
  const allWaiting = useWaiting()
  const workspace = () => workspaces.data?.find((candidate) => candidate.id === params.workspaceId)
  const waiting = () =>
    allWaiting().filter((row) => waitingWorkspaceId(row, tasks.data, workspaces.data) === params.workspaceId)
  // In the workspace's own order, as the desktop's rail lists them.
  const visibleProjects = createMemo(() =>
    (workspace()?.projects ?? []).flatMap((ref) => {
      const project = projects.data?.find((candidate) => candidate.id === ref.id)
      return project && !project.hidden ? [project] : []
    }),
  )
  const groups = createMemo(() =>
    visibleProjects()
      .map((project) => ({ project, tasks: (tasks.data ?? []).filter((task) => task.projectId === project.id) }))
      .filter((group) => group.tasks.length),
  )
  // The markers `taskState` reads come from plugins that only work out the tasks someone asked about.
  createEffect(() => requestTaskAnnotations(groups().flatMap((group) => group.tasks.map((task) => task.id))))
  const [draft, setDraft] = createSignal<TaskDraft | null>(null)
  // The desktop offers the active workspace's visible projects, and so does this.
  const startTask = () => {
    const [first] = visibleProjects()
    if (first) setDraft({ mode: 'new', nodeId: activeNodeId(), projects: visibleProjects(), projectId: first.id })
  }
  const viewHref = (view: 'dashboard' | 'tasks') =>
    view === 'tasks' ? `/w/${params.workspaceId}/tasks` : `/w/${params.workspaceId}`

  return (
    <>
      <TopBar
        title={workspace()?.name ?? words().capitalized}
        back="/"
        action={
          <Show when={props.view === 'tasks'}>
            <Button disabled={!visibleProjects().length} onPress={startTask}>
              New task
            </Button>
          </Show>
        }
      />
      <main class="mobile-body">
        <Show when={workspaces.data} fallback={<EmptyState busy title={`Loading the ${words().singular}`} />}>
          <Show
            when={workspace()}
            fallback={
              <EmptyState title={`No such ${words().singular}`}>
                It may have been removed. Go back to see the {words().plural} on this Node.
              </EmptyState>
            }
          >
            <Show
              when={props.view === 'tasks'}
              fallback={<EmptyState title="Nothing on the dashboard yet">Its tasks are under Tasks.</EmptyState>}
            >
              <NeedsYou rows={waiting()} tasks={tasks.data} />
              <Show when={tasks.data} fallback={<EmptyState busy title="Loading tasks" />}>
                <For each={groups()} fallback={<EmptyState title="No tasks">Start one with New task.</EmptyState>}>
                  {(group) => (
                    <section>
                      <SectionHeader level="group" count={group.tasks.length}>
                        {group.project.name}
                      </SectionHeader>
                      <For each={group.tasks}>
                        {(task) => (
                          <Row variant="stacked" href={`/t/${task.id}`} onPress={() => navigate(`/t/${task.id}`)}>
                            <Text emphasis="strong">{task.title}</Text>
                            <Show when={taskState(task.id)}>{(state) => <Text emphasis="muted">{state()}</Text>}</Show>
                          </Row>
                        )}
                      </For>
                    </section>
                  )}
                </For>
              </Show>
            </Show>
          </Show>
        </Show>
      </main>
      <nav class="mobile-bar mobile-tabs" aria-label={words().capitalized}>
        <RailTab
          label="Dashboard"
          glyph="layout-grid"
          sublabel="Dashboard"
          active={props.view === 'dashboard'}
          aria-current={props.view === 'dashboard' ? 'page' : undefined}
          onClick={() => navigate(viewHref('dashboard'))}
        />
        <RailTab
          label="Tasks"
          glyph="list-checks"
          sublabel="Tasks"
          active={props.view === 'tasks'}
          aria-current={props.view === 'tasks' ? 'page' : undefined}
          markers={
            waiting().length
              ? [{ id: 'waiting', label: `${waiting().length} waiting`, dotTone: 'warn', placements: ['top-end'] }]
              : []
          }
          onClick={() => navigate(viewHref('tasks'))}
        />
      </nav>
      <Show when={draft()} keyed>
        {(open) => <TaskDraftDialog draft={open} tasks={() => tasks.data} onClose={() => setDraft(null)} />}
      </Show>
    </>
  )
}
