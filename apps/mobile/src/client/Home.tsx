import { createEffect, createMemo, createSignal, For, lazy, Show } from 'solid-js'
import { useNavigate } from '@solidjs/router'
import { createQuery } from '@tanstack/solid-query'
import { createAttentionInbox } from '@acorn/client-core/features/notifications'
import type { TaskDraft } from '@acorn/client-core/features/tabs/taskDraftStore.ts'
import { workspaceForProject } from '@acorn/client-core/features/workspaces'
import { requestTaskAnnotations } from '@acorn/client-core/host/annotations/taskAnnotations.ts'
import { activeNodeId } from '@acorn/client-core/infra/node/activeNode.ts'
import { projectsOptions, tasksOptions, workspacesOptions, type Task } from '@acorn/client-core/infra/queries.ts'
import { Text } from '@acorn/client-core/kit/components/content'
import { Button, EmptyState, Row, SectionHeader } from '@acorn/client-core/kit/components/primitives.tsx'
import { NeedsYou } from './NeedsYou'
import { rosterReady } from './roster'
import { TopBar } from './TopBar'
import { taskState } from './taskState'

// The first screen doesn't draw it, and it brings the draft form's branch pickers and icon picker.
const TaskDraftDialog = lazy(async () => ({
  default: (await import('@acorn/client-core/features/tabs/TaskDraftDialog.tsx')).TaskDraftDialog,
}))

/** `/`: what is waiting on a person, then every task on the Node, grouped by workspace in the Node's
 *  order, each with its state. */
export function Home() {
  const navigate = useNavigate()
  const tasks = createQuery(() => tasksOptions(true))
  const workspaces = createQuery(() => workspacesOptions(true))
  const projects = createQuery(() => projectsOptions(true))
  // The inbox reads the registered attention sources once, when it is made, so it waits for the roster.
  const inbox = createMemo(() => (rosterReady() ? createAttentionInbox() : undefined))
  const waiting = () => inbox()?.().rows ?? []
  const [draft, setDraft] = createSignal<TaskDraft | null>(null)
  const visibleProjects = () => (projects.data ?? []).filter((project) => !project.hidden)
  // The desktop's rail offers the active workspace's projects. A phone has no active workspace, so
  // it offers every visible one.
  const startTask = () => {
    const [first] = visibleProjects()
    if (first) setDraft({ mode: 'new', nodeId: activeNodeId(), projects: visibleProjects(), projectId: first.id })
  }
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
      <TopBar
        title={waiting().length ? `Tasks · ${waiting().length} waiting` : 'Tasks'}
        action={
          <Button disabled={!visibleProjects().length} onPress={startTask}>
            New task
          </Button>
        }
      />
      <main class="mobile-body">
        <NeedsYou rows={waiting()} tasks={tasks.data} />
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
      <Show when={draft()} keyed>
        {(open) => <TaskDraftDialog draft={open} tasks={() => tasks.data} onClose={() => setDraft(null)} />}
      </Show>
    </>
  )
}
