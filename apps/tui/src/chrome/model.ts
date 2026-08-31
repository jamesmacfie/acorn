// What the whole shell reads: the workspace being looked at, the tasks in it, and the task that is
// open.
//
// Built once, in `Shell.tsx`, and handed to the topbar, the rail, the pane row and the palette as one
// prop. Not module state and not four `createQuery` calls in four components: a query lives in a
// reactive root under the `QueryClientProvider`, and four subscriptions to the same key would be four
// chances for two pieces of chrome to disagree about which workspace this is.
//
// Everything derived here is derived from state client-core already owns
// (docs/state-ownership.md). The one thing this file adds is the workspace choice, which the desktop
// reads off its router and a terminal has no router to read.

import { createMemo, type Accessor } from 'solid-js'
import { createQuery } from '@tanstack/solid-query'
import { tasksOptions, workspacesOptions, type Task, type Workspace } from '@acorn/client-core/infra/queries.ts'
import { activeTaskId, selectedSource, setSelectedSource } from '@acorn/client-core/features/tasks/tasks.ts'
import { chosenWorkspace, setChosenWorkspace } from './state'

export type ShellModel = {
  workspaces: Accessor<Workspace[]>
  /** Every task on the node, whichever workspace it belongs to. The palette's go-to-task list. */
  allTasks: Accessor<Task[]>
  /** The workspace the rail is showing, or null before the first answer arrives. */
  workspace: Accessor<Workspace | null>
  /** The tasks in that workspace, in the order the node returned them. */
  tasks: Accessor<Task[]>
  /** The open task, or null when a browse source has the pane instead. */
  task: Accessor<Task | null>
  /** Show a workspace's tasks. Here rather than as a bare setter so every caller — the topbar's menu
   *  and the palette's row — makes the same two writes. */
  chooseWorkspace: (workspaceId: string) => void
}

export function createShellModel(): ShellModel {
  const workspacesQuery = createQuery(() => workspacesOptions(true))
  const tasksQuery = createQuery(() => tasksOptions(true))

  const allTasks = createMemo(() => tasksQuery.data ?? [])
  const workspaces = createMemo(() => workspacesQuery.data ?? [])
  const task = createMemo(() => (selectedSource() ? null : allTasks().find((row) => row.id === activeTaskId()) ?? null))

  // An explicit choice wins; otherwise follow the open task, and fall back to the first workspace so
  // the rail has something to draw before anything has been opened. The desktop's derivation is the
  // middle case alone, because its URL always carries a project.
  const workspace = createMemo(() => {
    const chosen = chosenWorkspace()
    const all = workspaces()
    if (chosen) return all.find((entry) => entry.id === chosen) ?? all[0] ?? null
    const projectId = task()?.projectId
    if (projectId) {
      const owner = all.find((entry) => entry.projects.some((project) => project.id === projectId))
      if (owner) return owner
    }
    return all[0] ?? null
  })

  const tasks = createMemo(() => {
    const current = workspace()
    if (!current) return allTasks()
    const projects = new Set(current.projects.map((project) => project.id))
    return allTasks().filter((row) => projects.has(row.projectId))
  })

  // A workspace switch is a change of roster, so whatever was open in the old one is not open in the
  // new one. Clearing the source rather than picking one leaves the shell on its empty state until a
  // task is chosen, which is what a terminal with no browse surface registered has to say anyway.
  const chooseWorkspace = (workspaceId: string): void => {
    setChosenWorkspace(workspaceId)
    setSelectedSource(null)
  }

  return { workspaces, allTasks, workspace, tasks, task, chooseWorkspace }
}
