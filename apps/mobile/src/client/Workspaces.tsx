import { createMemo, For, Show } from 'solid-js'
import { useNavigate } from '@solidjs/router'
import { createQuery } from '@tanstack/solid-query'
import { WORKSPACES_PREF_KEY } from '@acorn/protocol/workspacesMode.ts'
import { createWorkspaceWords, pickerWorkspaces, workspaceForProject } from '@acorn/client-core/features/workspaces'
import { WorkspaceIdentity } from '@acorn/client-core/features/workspaces/WorkspaceIcon.tsx'
import { activeNodeId } from '@acorn/client-core/infra/node/activeNode.ts'
import { prefsOptions, projectsOptions, tasksOptions, workspacesOptions } from '@acorn/client-core/infra/queries.ts'
import { Text } from '@acorn/client-core/kit/components/content'
import { EmptyState, Row } from '@acorn/client-core/kit/components/primitives.tsx'
import { NeedsYou } from './NeedsYou'
import { TopBar } from './TopBar'
import { useWaiting, waitingWorkspaceId, waitsOnNode } from './waiting'

/** `/`: the workspaces in the Node's order, or the visible projects when workspaces are off, the
 *  desktop picker's list. Each row counts its tasks and what waits in it. What waits on the Node
 *  itself is under the list, since it belongs to no workspace. */
export function Workspaces() {
  const navigate = useNavigate()
  const words = createWorkspaceWords()
  const tasks = createQuery(() => tasksOptions(true))
  const workspaces = createQuery(() => workspacesOptions(true))
  const projects = createQuery(() => projectsOptions(true))
  const prefs = createQuery(() => prefsOptions(true))
  const waiting = useWaiting()
  const list = createMemo(() =>
    workspaces.data && projects.data && prefs.data
      ? pickerWorkspaces(workspaces.data, projects.data, prefs.data[WORKSPACES_PREF_KEY])
      : undefined,
  )
  const counts = createMemo(() => {
    const byWorkspace = new Map<string, { tasks: number; waiting: number }>()
    const count = (id: string | undefined, key: 'tasks' | 'waiting') => {
      if (!id) return
      const entry = byWorkspace.get(id) ?? { tasks: 0, waiting: 0 }
      entry[key] += 1
      byWorkspace.set(id, entry)
    }
    for (const task of tasks.data ?? []) count(workspaceForProject(list(), task.projectId)?.id, 'tasks')
    for (const row of waiting()) count(waitingWorkspaceId(row, tasks.data, workspaces.data), 'waiting')
    return byWorkspace
  })
  const summary = (id: string) => {
    const { tasks: taskCount = 0, waiting: waitingCount = 0 } = counts().get(id) ?? {}
    const parts = [taskCount === 1 ? '1 task' : `${taskCount} tasks`]
    if (waitingCount) parts.push(`${waitingCount} waiting`)
    return parts.join(' · ')
  }
  return (
    <>
      <TopBar title={words().capitalizedPlural} />
      <main class="mobile-body">
        <Show when={list()} fallback={<EmptyState busy title={`Loading ${words().plural}`} />}>
          <For
            each={list()}
            fallback={<EmptyState title={`No ${words().plural}`}>Add one in Acorn on your computer.</EmptyState>}
          >
            {(workspace) => (
              <Row
                variant="stacked"
                href={`/w/${workspace.id}`}
                onPress={() => navigate(`/w/${workspace.id}`)}
                leading={
                  <WorkspaceIdentity name={workspace.name} appearance={workspace.appearance} nodeId={activeNodeId()} />
                }
              >
                <Text emphasis="strong">{workspace.name}</Text>
                <Text emphasis="muted">{summary(workspace.id)}</Text>
              </Row>
            )}
          </For>
        </Show>
        <NeedsYou rows={waiting().filter(waitsOnNode)} tasks={tasks.data} />
      </main>
    </>
  )
}
