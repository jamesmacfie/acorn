import type { Task, Workspace } from '@acorn/protocol/api.ts'

export type WorkspaceView = { source: string } | { taskId: string }

export type WorkspaceViewTransition =
  | { kind: 'keep-task'; task: Task }
  | { kind: 'restore-task'; task: Task }
  | { kind: 'restore-source'; source: string }

type WorkspaceViewTransitionInput = {
  previousWorkspace: Workspace
  nextWorkspace: Workspace
  selectedSource: string | null
  activeTaskId: string | null
  tasks: readonly Task[]
  rememberedNextView?: WorkspaceView
}

const ownsTask = (workspace: Workspace, task: Task): boolean =>
  workspace.repos.some((repo) => repo.owner === task.repoOwner && repo.name === task.repoName)

// Plan one route-derived workspace change without touching signals or navigation. Task selection
// changes its signals before the router updates, so the active task may already belong to the
// destination. That is an intentional cross-workspace task jump and must win over remembered view
// restoration. Conversely, that incoming task must never be recorded against the workspace being
// left. Membership checks also make stale memories self-healing after repo reassignment.
export function planWorkspaceViewTransition(input: WorkspaceViewTransitionInput): {
  previousView?: WorkspaceView
  next: WorkspaceViewTransition
} {
  const activeTask = input.activeTaskId
    ? input.tasks.find((task) => task.id === input.activeTaskId)
    : undefined

  const previousView: WorkspaceView | undefined = input.selectedSource
    ? { source: input.selectedSource }
    : activeTask && ownsTask(input.previousWorkspace, activeTask)
      ? { taskId: activeTask.id }
      : undefined

  if (!input.selectedSource && activeTask && ownsTask(input.nextWorkspace, activeTask)) {
    return { previousView, next: { kind: 'keep-task', task: activeTask } }
  }

  if (input.rememberedNextView && 'taskId' in input.rememberedNextView) {
    const rememberedTaskId = input.rememberedNextView.taskId
    const rememberedTask = input.tasks.find((task) => task.id === rememberedTaskId)
    if (rememberedTask && ownsTask(input.nextWorkspace, rememberedTask)) {
      return { previousView, next: { kind: 'restore-task', task: rememberedTask } }
    }
  }

  return {
    previousView,
    next: {
      kind: 'restore-source',
      source: input.rememberedNextView && 'source' in input.rememberedNextView
        ? input.rememberedNextView.source
        : 'github',
    },
  }
}
