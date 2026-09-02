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

import { createEffect, createMemo, type Accessor } from 'solid-js'
import { createQuery } from '@tanstack/solid-query'
import { integrationsOptions, tasksOptions, workspacesOptions, type Task, type Workspace } from '@acorn/client-core/infra/queries.ts'
import {
  activeTaskId, selectedSource, setActiveTaskId, setSelectedSource,
} from '@acorn/client-core/features/tasks/tasks.ts'
import { availableSources, type SourceEntry } from '@acorn/client-core/features/tabs/railSources.ts'
import { createSourceScope } from '@acorn/client-core/features/tabs/sourceScope.ts'
import { scheduleSettle } from '../keys/regions'
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
  /** The browse sources this workspace has, in rail order, and empty until every gate has answered.
   *  The Menu draws these and nothing else derives them (./Rail.tsx). */
  sources: Accessor<SourceEntry[]>
  /** Show a workspace's tasks. Here rather than as a bare setter so every caller — the topbar's menu
   *  and the palette's row — makes the same handoff. */
  chooseWorkspace: (workspaceId: string) => void
}

export function createShellModel(): ShellModel {
  const workspacesQuery = createQuery(() => workspacesOptions(true))
  const tasksQuery = createQuery(() => tasksOptions(true))

  const integrationsQuery = createQuery(() => integrationsOptions(true))

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

  const scope = createSourceScope(() => workspace()?.id)

  // Do not answer with a partial roster. Docker needs no provider, so mid-load it was briefly the only
  // source: the Menu drew it, the caret took it, and it stayed the collection's remembered active row
  // after GitHub arrived above it — so the shell selected GitHub while visibly focusing Docker. Both
  // gates load asynchronously, so wait for both and let the first drawn row be the first row the
  // default below picks.
  const sourcesReady = createMemo(() => {
    const scoped = scope()
    return !!integrationsQuery.data && scoped.providers !== undefined && scoped.linked !== undefined
  })
  const sources = createMemo(() => (sourcesReady()
    ? availableSources(integrationsQuery.data?.integrations, scope())
    : []))

  // Where a workspace starts: the first source the Menu actually draws. One truth rather than two
  // components agreeing because one of them waited for the other — the Rail used to hold this effect
  // and the shell used to read its answer back out of the selection.
  const defaultSource = createMemo(() => sources()[0] ?? null)

  // An explicit task path or source selection wins for that workspace. `chooseWorkspace` clears both,
  // so a new workspace receives its own default instead of the first one-shot being spent forever.
  let defaulted: string | null = null
  createEffect(() => {
    const current = workspace()
    if (!current || defaulted === current.id) return
    if (activeTaskId() || selectedSource()) {
      defaulted = current.id
      return
    }
    const first = defaultSource()
    if (!first) return
    defaulted = current.id
    setSelectedSource(first.id)
    // The Menu's rows arrive with this selection, and nothing else on the screen is mounting to
    // schedule the pass that lands the caret on the first of them. Without this the region holds the
    // keys on its own frame until some other region happens to mount (../keys/regions.ts § settle).
    scheduleSettle()
  })

  // A workspace switch is a change of roster, so whatever was open in the old one is not open in the
  // new one. Clearing the source rather than picking one leaves the shell on its empty state until a
  // source in the new roster is ready. Clear the old view before publishing the new workspace: the
  // defaulting effect above must never observe "new workspace, old selection" and conclude that the
  // new workspace was already initialized.
  const chooseWorkspace = (workspaceId: string): void => {
    setActiveTaskId(null)
    setSelectedSource(null)
    setChosenWorkspace(workspaceId)
    // The focused Menu row is about to be destroyed with the old roster. The landing rule re-enters the
    // region by its entry rule once reconciliation has produced the new rows.
    scheduleSettle()
  }

  return { workspaces, allTasks, workspace, tasks, task, sources, chooseWorkspace }
}
