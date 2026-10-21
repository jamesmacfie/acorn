import { createEffect, createMemo, For, Show } from 'solid-js'
import { useNavigate } from '@solidjs/router'
import { createQuery } from '@tanstack/solid-query'
import { workspaceForProject } from '@acorn/client-core/features/workspaces'
import { requestTaskAnnotations } from '@acorn/client-core/host/annotations/taskAnnotations.ts'
import { tasksOptions, workspacesOptions, type Task } from '@acorn/client-core/infra/queries.ts'
import { Text } from '@acorn/client-core/kit/components/content'
import { EmptyState, Row, SectionHeader } from '@acorn/client-core/kit/components/primitives.tsx'
import { TopBar } from './TopBar'
import { taskState } from './taskState'

/** `/`: every task on the Node, grouped by workspace in the Node's order, each with its state. */
export function Home() {
  const navigate = useNavigate()
  const tasks = createQuery(() => tasksOptions(true))
  const workspaces = createQuery(() => workspacesOptions(true))
  // The markers `taskState` reads come from plugins that only work out the tasks someone asked about.
  createEffect(() => requestTaskAnnotations((tasks.data ?? []).map((task) => task.id)))
  const groups = createMemo(() => {
    const byWorkspace = new Map<string, { name: string; tasks: Task[] }>()
    for (const workspace of workspaces.data ?? []) byWorkspace.set(workspace.id, { name: workspace.name, tasks: [] })
    const other = { name: 'Other', tasks: [] as Task[] }
    for (const task of tasks.data ?? []) {
      const workspace = workspaceForProject(workspaces.data, task.projectId)
      ;(byWorkspace.get(workspace?.id ?? '') ?? other).tasks.push(task)
    }
    return [...byWorkspace.values(), other].filter((group) => group.tasks.length)
  })
  return (
    <>
      <TopBar title="Tasks" />
      <main class="mobile-body">
        <Show when={tasks.data} fallback={<EmptyState busy title="Loading tasks" />}>
          <For
            each={groups()}
            fallback={<EmptyState title="No tasks">Start one in Acorn on your computer.</EmptyState>}
          >
            {(group) => (
              <section>
                <SectionHeader level="group" count={group.tasks.length}>
                  {group.name}
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
      </main>
    </>
  )
}
