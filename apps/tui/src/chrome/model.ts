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

import { batch, createEffect, createMemo, type Accessor } from 'solid-js'
import { createQuery } from '@tanstack/solid-query'
import { integrationsOptions, tasksOptions, workspacesOptions, type Task, type Workspace } from '@acorn/client-core/infra/queries.ts'
import {
  activeTaskId, rememberWorkspaceView, selectedSource, setActiveTaskId, setSelectedSource, workspaceView,
} from '@acorn/client-core/features/tasks/tasks.ts'
import { activateTaskSignals } from '@acorn/client-core/features/tasks/activate.ts'
import { availableSources, type SourceEntry } from '@acorn/client-core/features/tabs/railSources.ts'
import { noteWorkspaceVisit } from '@acorn/client-core/features/workspaces/lastWorkspace.ts'
import { createSourceScope } from '@acorn/client-core/features/tabs/sourceScope.ts'
import { scheduleSettle } from '../keys/regions'
import { chosenWorkspace, placeRestored, setChosenWorkspace } from './state'

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
  /** Whether the node has answered with both rosters. `allTasks()` and `workspaces()` fall back to an
   *  empty array, which reads the same as a node with nothing on it, so anything that must not act on
   *  a guess asks this instead (./restore.ts). */
  ready: Accessor<boolean>
}

export function createShellModel(): ShellModel {
  const workspacesQuery = createQuery(() => workspacesOptions(true))
  const tasksQuery = createQuery(() => tasksOptions(true))

  const integrationsQuery = createQuery(() => integrationsOptions(true))

  const allTasks = createMemo(() => tasksQuery.data ?? [])
  const workspaces = createMemo(() => workspacesQuery.data ?? [])
  const ready = createMemo(() => !!workspacesQuery.data && !!tasksQuery.data)
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

  // `;` goes back to the workspace before this one, and this memo is where this host settles which
  // workspace that is (client-core features/workspaces/lastWorkspace.ts). Reported from here rather
  // than from `chooseWorkspace`, because following the open task changes workspace too.
  createEffect(() => {
    const current = workspace()
    if (current) noteWorkspaceVisit(current.id)
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

  // Where you are in this workspace, recorded as you move: which browse source, or which task. Coming
  // back to the workspace returns you to it, and so does the next run of `acorn`, because the store
  // behind this is persisted per workspace (client-core features/tasks/tasks.ts, ./restore.ts).
  //
  // Recorded as you go rather than on the way out, which is where the desktop records it. The desktop
  // can wait, because relaunching it restores a last task and a last source of its own; this host has
  // neither, so the workspace that was open when the process ended has to already know its own view.
  //
  // Not until the restore has run, or the default source the effect above picks for the first
  // workspace on screen lands here before the stored view has been read, and overwrites it with a
  // choice nobody made (./state.ts § placeRestored).
  createEffect(() => {
    const current = workspace()
    if (!current || !placeRestored()) return
    const source = selectedSource()
    if (source) return rememberWorkspaceView(current.id, { source })
    const taskId = activeTaskId()
    if (taskId) rememberWorkspaceView(current.id, { taskId })
  })

  // A workspace switch is a change of roster, so whatever was open in the old one is not open in the
  // new one — but whatever was open in the *new* one is what you want back, so restore it. A
  // remembered task is checked against the workspace it is being restored into, which is what makes a
  // memory left over from a repo moving between workspaces heal instead of reopening the wrong task.
  //
  // In one batch, because there is no coherent intermediate state here: the two effects above both
  // read the workspace and the selection together, and either one seeing "new workspace, old
  // selection" writes the wrong answer. Falling through with nothing selected is not a gap — it is
  // how an unremembered workspace has always opened, on the first source its Menu draws.
  const chooseWorkspace = (workspaceId: string): void => {
    const entering = workspaces().find((entry) => entry.id === workspaceId)
    const remembered = entering ? workspaceView(entering.id) : undefined
    const task = remembered && 'taskId' in remembered
      ? allTasks().find((row) => row.id === remembered.taskId)
      : undefined
    batch(() => {
      setActiveTaskId(null)
      setSelectedSource(null)
      if (task && entering?.projects.some((project) => project.id === task.projectId)) activateTaskSignals(task)
      else if (remembered && 'source' in remembered) setSelectedSource(remembered.source)
      setChosenWorkspace(workspaceId)
    })
    // The focused Menu row is about to be destroyed with the old roster. The landing rule re-enters
    // the region once reconciliation has produced the new rows, on the row the new workspace's caret
    // is on — which is the restore above (../keys/regions.ts § entryStop).
    scheduleSettle()
  }

  return { workspaces, allTasks, workspace, tasks, task, sources, chooseWorkspace, ready }
}
