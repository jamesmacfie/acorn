import type { Task, Workspace } from '@acorn/protocol/api.ts'
import { projectIdFromPath } from '../../host/registries/commands/corePaths'

// `path` is the page a source was showing, so a relaunch lands on the pull request you had open and
// not only on the source that lists it. Optional because the terminal client has no address to give.
export type WorkspaceView = { source: string; path?: string } | { taskId: string }

export type WorkspaceViewTransition =
  | { kind: 'keep-task'; task: Task }
  | { kind: 'restore-task'; task: Task }
  | { kind: 'restore-source'; source: string; path?: string }

type WorkspaceViewTransitionInput = {
  workspace: Workspace
  selectedSource: string | null
  activeTaskId: string | null
  tasks: readonly Task[]
  defaultSource: string
  rememberedView?: WorkspaceView
}

const ownsProject = (workspace: Workspace, projectId: string): boolean =>
  workspace.projects.some((project) => project.id === projectId)

/** Whether a path names a project in this workspace. A task path names none. */
export const workspaceOwnsPath = (workspace: Workspace, path: string): boolean => {
  const projectId = projectIdFromPath(path)
  return !!projectId && ownsProject(workspace, projectId)
}

// Plan what to show on entering a workspace, without touching signals or navigation. Task selection
// changes its signals before the router updates, so the active task may already belong to the
// destination. That is an intentional cross-workspace task jump and must win over remembered view
// restoration. Membership checks also make stale memories self-healing after repo reassignment.
export function planWorkspaceViewTransition(input: WorkspaceViewTransitionInput): WorkspaceViewTransition {
  const activeTask = input.activeTaskId
    ? input.tasks.find((task) => task.id === input.activeTaskId)
    : undefined

  if (!input.selectedSource && activeTask && ownsProject(input.workspace, activeTask.projectId)) {
    return { kind: 'keep-task', task: activeTask }
  }

  const remembered = input.rememberedView
  if (remembered && 'taskId' in remembered) {
    const rememberedTask = input.tasks.find((task) => task.id === remembered.taskId)
    if (rememberedTask && ownsProject(input.workspace, rememberedTask.projectId)) {
      return { kind: 'restore-task', task: rememberedTask }
    }
  }

  if (remembered && 'source' in remembered) {
    const path = remembered.path && workspaceOwnsPath(input.workspace, remembered.path) ? remembered.path : undefined
    return { kind: 'restore-source', source: remembered.source, ...(path ? { path } : {}) }
  }
  return { kind: 'restore-source', source: input.defaultSource }
}

// What to remember about the workspace on screen, or nothing when the selection belongs elsewhere.
// A task jump sets its signals before the route moves, so for a beat the workspace being left sees
// the incoming task. The membership check is what keeps that task out of the wrong memory.
export function viewToRemember(
  workspace: Workspace,
  selectedSource: string | null,
  activeTask: Task | null,
  path: string,
): WorkspaceView | undefined {
  if (selectedSource) {
    return workspaceOwnsPath(workspace, path) ? { source: selectedSource, path } : { source: selectedSource }
  }
  if (activeTask && ownsProject(workspace, activeTask.projectId)) return { taskId: activeTask.id }
  return undefined
}
